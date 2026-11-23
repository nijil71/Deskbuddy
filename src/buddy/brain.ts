// Decides what the buddy does: needs-based idle behaviour + reactions to your
// desktop (presence, calls, system load, clipboard, reminders, meetings).
import { invoke } from "@tauri-apps/api/core";
import type { Buddy } from "./buddy";
import type { Overlay } from "../ui/overlay";
import { pick, rand } from "./pose";
import { Focus, chime, fmt } from "../services/focus";
import { fetchWeather, weatherText, type Weather } from "../services/weather";
import { today, type Settings } from "../shared/settings";

export interface Presence { idleMs: number; locked: boolean; fullscreen: boolean; inCall: boolean; keepalive: boolean; inHours: boolean; }
export interface SysStats { cpu: number; mem: number; hasBattery: boolean; battery: number; charging: boolean; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hour = () => new Date().getHours() + new Date().getMinutes() / 60;

const QUIPS = {
  any: ["You're doing great 💪", "*hums a little tune*", "Need anything? Right-click me!", "I like it here.", "Don't forget to blink 👀", "Tiny reminder: you're awesome.", "*stretches*", "Is it snack time?"],
  morning: ["Good morning! ☀️", "Coffee first, then code ☕", "Let's make today a good one."],
  afternoon: ["Afternoon slump? Try a short walk 🚶", "Halfway there!", "Water check 💧"],
  evening: ["Almost done for the day?", "Remember to log off on time 🌇"],
  night: ["It's getting late… 🌙", "Sleep is a feature, not a bug.", "*yaaawn*"],
};

export class Brain {
  focus: Focus;
  weather: Weather | null = null;
  presence: Presence = { idleMs: 0, locked: false, fullscreen: false, inCall: false, keepalive: true, inHours: true };
  private lastReal = Date.now();
  private lastNudge = 0;
  private away = false;
  private energy = 1;
  private boredom = 0.3;
  private last: Record<string, number> = {};
  private remindAt: Record<string, number> = {};
  private fired = new Set<string>();
  private hiddenByFullscreen = false;
  private stopped = false;

  constructor(private b: Buddy, private ui: Overlay, public s: Settings) {
    this.focus = new Focus(s.focus);
    const now = Date.now();
    for (const k of Object.keys(s.reminders)) this.remindAt[k] = now + (s.reminders as any)[k].every * 60_000;
    this.focus.onPhase = (n, p) => this.onFocusPhase(n, p);
    this.focus.onTick = (st) => {
      if (st.phase === "idle") return this.ui.setRing(false);
      this.ui.setRing(true, 1 - st.remaining / Math.max(1, st.total), st.paused ? "❚❚" : fmt(st.remaining), st.phase === "work" ? "work" : "break");
    };
  }

  setSettings(s: Settings) {
    this.s = s;
    this.focus.cfg = s.focus;
    this.ui.quiet = s.dnd;
  }

  /** Can we interrupt with something non-urgent? */
  private get calm() {
    return !this.s.dnd && !this.presence.inCall && !this.away && !this.b.dragging && !this.b.hidden;
  }
  private cooldown(key: string, ms: number) {
    const now = Date.now();
    if (now - (this.last[key] ?? 0) < ms) return false;
    this.last[key] = now;
    return true;
  }

  // ------------------------------------------------------------------ idle loop

  async run() {
    while (!this.stopped) {
      const b = this.b;
      if (b.hidden || b.dragging || b.world.surface.kind === "air") { await sleep(400); continue; }
      if (b.actionName && b.priority >= 1) { await b.whenDone(); continue; }
      const [name, args] = this.choose();
      await b.play(name, args);
      await sleep(30);
    }
  }

  private choose(): [string, any?] {
    const b = this.b, w = b.world;
    const h = hour();
    const late = h >= 23 || h < 5;
    const onWin = w.surface.kind === "window";

    if (this.away) return ["sleep", { sitting: true, cap: late }];
    if (this.focus.working) return ["focus"];
    if (this.presence.inCall) return ["quiet"];

    this.energy = Math.max(0, Math.min(1, this.energy - 0.02 + (late ? -0.02 : 0)));
    this.boredom = Math.min(1, this.boredom + 0.12);

    const roam = this.s.roam;
    const [lo, hi] = w.range();
    const opts: [number, () => [string, any?]][] = [
      [3, () => [onWin ? "sit" : "idle", { dur: rand(6, 16) }]],
      [roam && !onWin ? 2.2 : 0.4, () => [`walk`, { x: rand(lo, hi), maxT: 12 }]],
      [1.2, () => ["sit", { dur: rand(10, 22) }]],
      [0.9, () => ["lookAround"]],
      [1.2 * this.boredom, () => ["read"]],
      [1.0 * this.boredom, () => ["music"]],
      [0.8 * this.boredom, () => ["juggle"]],
      [0.7 * this.boredom, () => ["doodle"]],
      [0.6 * this.boredom, () => ["yoyo"]],
      [0.35 * this.boredom, () => ["magic"]],
      [0.5, () => ["think", { text: pick(["Hmm…", "What was I doing?", "🤔", "Big thoughts…"]) }]],
      [h > 14 || late ? 1 - this.energy + 0.3 : 0.15, () => ["yawn"]],
      [0.5, () => ["stretch"]],
      [h >= 7 && h < 11 ? 0.9 : 0.25, () => ["coffee"]],
      [roam && !onWin ? 0.4 : 0, () => ["peek"]],
      [roam ? (onWin ? 0.7 : 0.9) : 0, () => (onWin ? ["__hopDown"] : ["__climb"])],
      [0.4, () => ["turn"]],
      [late ? 1.2 : 0, () => ["sleep", { sitting: true, cap: true }]],
    ];
    let total = opts.reduce((a, [wgt]) => a + wgt, 0);
    let r = Math.random() * total;
    for (const [wgt, f] of opts) {
      r -= wgt;
      if (r <= 0) {
        const res = f();
        if (["read", "music", "juggle", "doodle", "yoyo", "magic"].includes(res[0])) this.boredom = 0;
        if (res[0] === "__climb") { this.climb(); return ["idle", { dur: 0.6 }]; }
        if (res[0] === "__hopDown") { this.hopDown(); return ["sit", { dur: 0.6 }]; }
        return res;
      }
    }
    return ["idle", { dur: 5 }];
  }

  private async climb() {
    const b = this.b, w = b.world;
    const win = await w.foregroundPerch();
    if (!win || b.priority >= 1) return;
    const s = w.scale;
    const x = Math.min(win.rect.x + win.rect.w - 80 * s, Math.max(win.rect.x + 80 * s, w.fx));
    // walk to just under the target spot, then a big cartoon jump
    if (Math.abs(x - w.fx) > 8 * s) await b.play("walk", { x, maxT: 8 });
    if (b.priority >= 2) return;
    const fresh = await w.foregroundPerch();
    if (!fresh || fresh.id !== win.id) return;
    await b.play("jumpTo", {
      x, y: fresh.rect.y,
      onLand: () => { w.surface = { kind: "window", id: fresh.id, title: fresh.title, x0: fresh.rect.x, x1: fresh.rect.x + fresh.rect.w }; },
    });
  }

  private async hopDown() {
    const b = this.b, w = b.world;
    const x = w.fx + rand(-120, 120) * w.scale;
    await b.play("jumpTo", { x, y: w.floorY(x), onLand: () => { w.surface = { kind: "floor" }; } });
  }

  // ------------------------------------------------------------------ events from Rust

  onPresence(p: Presence) {
    const prev = this.presence;
    this.presence = p;
    const now = Date.now();
    const nudgedRecently = now - this.lastNudge < 9000;
    if (p.idleMs < 6000 && !nudgedRecently && !p.locked) {
      if (this.away) this.welcomeBack(now - this.lastReal);
      this.lastReal = now - p.idleMs;
      this.away = false;
    } else if (!this.away && now - this.lastReal > 5 * 60_000 && !this.focus.working) {
      this.away = true;
      if (this.b.priority < 1) this.b.stop(); // let the loop pick "sleep"
    }

    // fullscreen apps / presentations: duck out of the way
    if (this.s.hideFullscreen && p.fullscreen && !this.hiddenByFullscreen) {
      this.hiddenByFullscreen = true;
      this.b.play("hideDuck", undefined, { force: true }).then(() => this.setWindowHidden(true));
    } else if (this.hiddenByFullscreen && !p.fullscreen) {
      this.hiddenByFullscreen = false;
      this.setWindowHidden(false);
      this.b.play("popUp", undefined, { force: true });
    }

    // lock: freeze rendering entirely
    if (p.locked !== prev.locked) this.b.setHidden(p.locked || this.hiddenByFullscreen);

    if (p.inCall && !prev.inCall && this.cooldown("shh", 10 * 60_000)) this.b.play("shh");
    if (!p.inCall && prev.inCall && this.b.actionName === "quiet") this.b.stop();

    this.ui.setBadge(!p.keepalive ? "off" : p.inHours ? "on" : "off");
  }

  onNudgeRequest() {
    this.lastNudge = Date.now();
    if (this.b.hidden) { invoke("do_nudge"); return; }
    this.ui.setBadge("active");
    this.b.play("nudge", undefined, { force: this.b.priority < 6 }).then(() => this.ui.setBadge("on"));
  }

  onNudgeDone() { this.lastNudge = Date.now(); }

  onSysmon(s: SysStats) {
    if (!this.calm) return;
    if (s.cpu > 88 && this.cooldown("cpu", 15 * 60_000)) this.b.play("sweaty", { cpu: s.cpu });
    else if (s.mem > 92 && this.cooldown("mem", 25 * 60_000)) this.b.play("heavyBox", { mem: s.mem });
    if (s.hasBattery) {
      if (!s.charging && s.battery <= 20 && this.cooldown("bat", 15 * 60_000)) this.b.play("lowBattery", { pct: s.battery });
      if (s.charging && this.last.wasDischarging && this.cooldown("chg", 60_000)) this.b.play("charging");
      this.last.wasDischarging = s.charging ? 0 : 1;
    }
  }

  onClipboard(preview: string) {
    if (!this.calm || this.b.priority >= 2) return;
    if (this.cooldown("clip", 25_000)) this.b.play("catchPaper", { text: preview.length > 40 ? preview.slice(0, 40) + "…" : preview });
  }

  // ------------------------------------------------------------------ scheduler (every 20s)

  tick() {
    const now = Date.now();
    const d = new Date();
    const h = hour();
    const active = now - this.lastReal < 90_000;

    // meetings: T-5, T-1, T-0
    for (const m of this.s.meetings) {
      if (m.date !== today()) continue;
      const [hh, mm] = m.time.split(":").map(Number);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
      const mins = (at - now) / 60_000;
      const fire = (stage: string, cond: boolean, f: () => void) => {
        const k = `${m.id}:${stage}`;
        if (cond && !this.fired.has(k)) { this.fired.add(k); f(); }
      };
      fire("5", mins <= 5 && mins > 1.2, () => {
        chime();
        this.b.play("holdSign", { text: "5 min!", dur: 7 }, { force: true });
        this.ui.say(`📅 "${m.title}" starts in 5 minutes`, { buttons: [{ label: "Open Teams", primary: true, fn: () => invoke("shell_open", { target: "msteams:" }) }, { label: "OK", fn: () => {} }] });
      });
      fire("1", mins <= 1.2 && mins > 0, () => {
        chime();
        this.b.play("holdSign", { text: "1 min!", dur: 6 }, { force: true });
        this.ui.say(`📅 "${m.title}" in 1 minute!`, { ms: 8000 });
      });
      fire("0", mins <= 0 && mins > -2, () => this.b.play("wave", { text: `"${m.title}" is starting now 🎬` }, { force: true }));
    }

    if (!active || this.s.dnd || this.presence.inCall) {
      // don't nag an empty chair; push reminders back a little
      for (const k in this.remindAt) this.remindAt[k] = Math.max(this.remindAt[k], now + 2 * 60_000);
      return;
    }

    // wellbeing reminders (skipped during focus work — they'll come in the break)
    if (!this.focus.working && this.b.priority < 2) {
      const R = this.s.reminders;
      const due = (Object.keys(R) as (keyof typeof R)[]).find((k) => R[k].on && now >= this.remindAt[k]);
      if (due) {
        this.remindAt[due] = now + R[due].every * 60_000;
        this.remind(due);
        return;
      }
    }

    // time-of-day moments (once a day each)
    const day = today();
    const once = (k: string, cond: boolean, f: () => void) => {
      if (cond && this.last[`tod:${k}`] !== +day.replace(/-/g, "")) { this.last[`tod:${k}`] = +day.replace(/-/g, ""); f(); return true; }
      return false;
    };
    if (this.calm && this.b.priority < 1) {
      if (once("morning", h >= 5 && h < 11, () => this.morning())) return;
      if (once("lunch", h >= 12.5 && h < 13.5, () => this.b.play("holdSign", { text: "Lunch? 🍜", dur: 5, say: "Don't skip lunch!" }))) return;
      if (once("evening", h >= 18 && h < 19.5, () => { this.b.play("yawn"); this.ui.say("Wrapping up soon? 🌇"); })) return;
      if (once("late", h >= 23 || h < 3, () => this.ui.say("It's really late… bed soon? 🌙"))) return;

      // chatter
      const every = { quiet: Infinity, normal: 9 * 60_000, chatty: 4 * 60_000 }[this.s.chatter];
      if (Number.isFinite(every) && this.cooldown("quip", every * rand(0.8, 1.4))) {
        const pool = h < 11 ? QUIPS.morning : h < 17 ? QUIPS.afternoon : h < 22 ? QUIPS.evening : QUIPS.night;
        this.ui.say(pick(Math.random() < 0.5 ? pool : QUIPS.any));
      }
    }
  }

  remind(kind: "water" | "stretch" | "eyes" | "posture") {
    chime();
    const snooze = () => { this.remindAt[kind] = Date.now() + 10 * 60_000; this.ui.say("Okay, in 10 minutes ⏰"); };
    const done = () => { this.b.play("celebrate", { text: pick(["Nice! 🎉", "Proud of you!", "That's the spirit!"]) }); };
    const buttons = [{ label: "Done ✓", primary: true, fn: done }, { label: "Snooze", fn: snooze }];
    if (kind === "water") { this.b.play("drink", { text: "Water break! 💧" }, { force: true }); setTimeout(() => this.ui.say("Have a glass of water?", { buttons }), 5200); }
    if (kind === "stretch") { this.b.play("breakTime", { text: "Stand up & stretch! 🙆" }, { force: true }); setTimeout(() => this.ui.say("Did you stretch?", { buttons }), 5200); }
    if (kind === "eyes") this.b.play("eyeBreak", { secs: 20 }, { force: true });
    if (kind === "posture") this.b.play("posture", undefined, { force: true });
  }

  private async morning() {
    await this.b.play("coffee", { text: `Good morning! ☕${this.weather ? "  " + weatherText(this.weather, this.s.weather.unit) : ""}` });
  }

  private welcomeBack(awayMs: number) {
    const mins = Math.round(awayMs / 60_000);
    this.b.play("wakeUp", undefined, { force: true }).then(() => {
      if (mins >= 30) this.b.play("celebrate", { text: `Welcome back! You were away ${mins >= 90 ? Math.round(mins / 60) + "h" : mins + " min"}.` });
      else this.b.play("wave", { text: pick(["Oh! You're back 👋", "Welcome back!", "Hey there!"]) });
    });
  }

  // ------------------------------------------------------------------ focus

  private onFocusPhase(next: string, prev: string) {
    if (next === "work") {
      chime("up");
      this.b.play("focus", undefined, { force: true });
      this.ui.say(`Focus mode: ${this.s.focus.work} min. I'll keep quiet 🎧`, { ms: 3000 });
    } else if (next === "short" || next === "long") {
      chime("down");
      this.ui.setRing(true, 0, "", "break");
      this.b.play("breakTime", { text: next === "long" ? "Long break! Go for a walk 🚶" : "Break time! Stretch with me 🙆" }, { force: true });
    } else if (next === "idle" && (prev === "short" || prev === "long")) {
      chime("up");
      this.ui.setRing(false);
      this.ui.say("Break's over. Ready for another round?", {
        buttons: [{ label: "Start focus", primary: true, fn: () => this.focus.cmd("start") }, { label: "Not now", fn: () => {} }],
      });
    } else if (next === "idle") {
      this.ui.setRing(false);
      if (this.b.actionName === "focus") this.b.stop();
    }
  }

  // ------------------------------------------------------------------ weather

  async refreshWeather() {
    const w = this.s.weather;
    if (w.lat == null || w.lon == null) return null;
    if (this.weather && Date.now() - this.weather.at < 25 * 60_000) return this.weather;
    this.weather = await fetchWeather(w.lat, w.lon, w.unit);
    return this.weather;
  }

  async showWeather() {
    if (this.s.weather.lat == null) {
      this.ui.say("Tell me your city in Settings and I'll check the weather ⛅", {
        buttons: [{ label: "Settings", primary: true, fn: () => invoke("open_panel", { tab: "settings" }) }],
      });
      return;
    }
    this.weather = null;
    const w = await this.refreshWeather();
    if (!w) return this.ui.say("Couldn't reach the weather service 😕");
    this.b.play("weather", { kind: w.kind, text: `${this.s.weather.city}: ${weatherText(w, this.s.weather.unit)}` }, { force: true });
  }

  private async setWindowHidden(h: boolean) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (h) await getCurrentWindow().hide(); else await getCurrentWindow().show();
    this.b.setHidden(h || this.presence.locked);
  }
}
