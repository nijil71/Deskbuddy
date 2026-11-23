// Decides what the buddy does: mood- and context-aware idle behaviour, reactions to
// what you're doing (apps, music, calls, system load), reminders, meetings, and
// memories — all filtered through Voice so it never becomes annoying.
import { invoke } from "@tauri-apps/api/core";
import type { Buddy } from "./buddy";
import type { Overlay } from "../ui/overlay";
import type { Voice } from "./voice";
import type { Remember } from "./memory";
import { pick, rand } from "./pose";
import { CX } from "./rig";
import { Focus, chime, fmt } from "../services/focus";
import { fetchWeather, weatherText, type Weather } from "../services/weather";
import { patchSettings, today, type Settings } from "../shared/settings";

export interface Presence { idleMs: number; locked: boolean; fullscreen: boolean; inCall: boolean; keepalive: boolean; inHours: boolean; }
export interface SysStats { cpu: number; mem: number; hasBattery: boolean; battery: number; charging: boolean; }
export interface Fg { id: number; title: string; exe: string; rect: { x: number; y: number; w: number; h: number }; }
export interface Media { title: string; artist: string; playing: boolean; app: string; }

type Category = "code" | "office" | "browser" | "video" | "teams" | "mail" | "terminal" | "files" | "other";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hour = () => new Date().getHours() + new Date().getMinutes() / 60;

const QUIPS = {
  any: ["You're doing great 💪", "*hums a little tune*", "I like it here.", "Don't forget to blink 👀", "Tiny reminder: you're awesome.", "Is it snack time?"],
  morning: ["Coffee first, then everything else ☕", "Let's make today a good one."],
  afternoon: ["Afternoon slump? A short walk helps 🚶", "Halfway there!"],
  evening: ["Almost done for the day?", "Remember to log off on time 🌇"],
  night: ["It's getting late… 🌙", "Sleep is a feature, not a bug."],
};

/** Map the foreground app to a coarse category (exe names, plus titles for browser video). */
export function categorize(exe: string, title: string): Category {
  const t = title.toLowerCase();
  if (/^(code|code - insiders|devenv|idea64|pycharm64|webstorm64|rider64|sublime_text|notepad\+\+|cursor|windsurf)\.exe$/.test(exe)) return "code";
  if (/^(ms-teams|teams)\.exe$/.test(exe)) return "teams";
  if (/^(outlook|olk|thunderbird)\.exe$/.test(exe)) return "mail";
  if (/^(excel|winword|powerpnt|onenote|acrord32|acrobat)\.exe$/.test(exe)) return "office";
  if (/^(windowsterminal|wt|powershell|pwsh|cmd|conhost)\.exe$/.test(exe)) return "terminal";
  if (exe === "explorer.exe") return "files";
  if (/^(vlc|wmplayer|video\.ui|microsoft\.media\.player|mpc-hc64|potplayermini64)\.exe$/.test(exe)) return "video";
  if (/^(chrome|msedge|firefox|brave|opera|arc|vivaldi)\.exe$/.test(exe)) {
    if (/youtube|netflix|prime video|twitch|disney\+|vimeo/.test(t)) return "video";
    if (/github|stack overflow|localhost|docs\./.test(t)) return "code";
    return "browser";
  }
  return "other";
}

export class Brain {
  focus: Focus;
  weather: Weather | null = null;
  presence: Presence = { idleMs: 0, locked: false, fullscreen: false, inCall: false, keepalive: true, inHours: true };
  category: Category = "other";
  private fg: Fg | null = null;
  private lastReal = Date.now();
  private awayStart = 0;
  private lastNudge = 0;
  private away = false;
  private boredom = 0.3;
  private last: Record<string, number> = {};
  private remindAt: Record<string, number> = {};
  private snoozes: Record<string, number> = {};
  private fired = new Set<string>();
  private hiddenByFullscreen = false;
  private covered = false;
  private song = "";
  private lookTimer = 0;
  private ticks = 0;
  private stopped = false;

  constructor(private b: Buddy, private ui: Overlay, public s: Settings, private mem: Remember, private voice: Voice) {
    this.focus = new Focus(s.focus);
    const now = Date.now();
    for (const k of Object.keys(s.reminders)) this.remindAt[k] = now + (s.reminders as any)[k].every * 60_000;
    this.focus.onPhase = (n, p) => this.onFocusPhase(n, p);
    this.focus.onTick = (st) => {
      if (st.phase === "idle") return this.ui.setRing(false);
      this.ui.setRing(true, 1 - st.remaining / Math.max(1, st.total), st.paused ? "❚❚" : fmt(st.remaining), st.phase === "work" ? "work" : "break");
    };
    b.mood.v = mem.m.mood.v;
    b.mood.e = mem.m.mood.e;
  }

  setSettings(s: Settings) {
    const wasQuiet = this.voice.mode === "quiet";
    this.s = s;
    this.voice.s = s;
    this.focus.cfg = s.focus;
    // leaving quiet mode: let the idle loop pick something livelier straight away
    if (wasQuiet && this.voice.mode !== "quiet" && this.b.actionName === "quiet") this.b.stop();
    if (!wasQuiet && this.voice.mode === "quiet" && this.b.priority < 1) this.b.stop();
  }

  private get calm() {
    return !this.presence.inCall && !this.away && !this.b.dragging && !this.b.hidden;
  }
  private cooldown(key: string, ms: number) {
    const now = Date.now();
    if (now - (this.last[key] ?? 0) < ms) return false;
    this.last[key] = now;
    return true;
  }

  /** Play a reaction: with its speech bubble if the budget allows, silently if only
   *  an animation is appropriate, or not at all (quiet mode / muted / in a call). */
  private react(action: string, args: any, key: string) {
    if (this.voice.allow(key)) {
      this.b.sayKey = key;
      return this.b.play(action, args).finally(() => { this.b.sayKey = ""; });
    }
    if (!this.voice.mayReact(key)) return Promise.resolve(false);
    this.b.silent = true;
    return this.b.play(action, args).finally(() => { this.b.silent = false; });
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
    const mode = this.voice.mode;
    const { v, e } = b.mood;
    if (this.lookTimer) { clearTimeout(this.lookTimer); this.lookTimer = 0; }
    b.lookAt = null;

    if (this.away) return ["sleep", { sitting: true, cap: late }];
    if (this.focus.working) return ["focus"];
    if (this.presence.inCall || mode === "quiet") return ["quiet"];

    this.boredom = Math.min(1, this.boredom + 0.12);
    const chill = mode === "chill";
    const hobby = (chill ? 1.3 : 0.6) * (0.6 + Math.max(0, v)) * (0.5 + e) * this.boredom;
    const glum = v < -0.15;
    const cat = this.category;

    // watching a video? sit down and watch it with you
    if (cat === "video" && this.fg && Math.random() < 0.6) {
      this.watch(this.fg);
      return ["sit", { dur: rand(15, 30) }];
    }

    const [lo, hi] = w.range();
    const roam = this.s.roam;
    const opts: [number, () => [string, any?]][] = [
      [3 + (glum ? 2 : 0), () => [onWin ? "sit" : "idle", { dur: rand(6, 16) }]],
      [roam && !onWin ? 2 * (0.6 + e) : 0.4, () => ["walk", { x: rand(lo, hi), maxT: 12 }]],
      [1.2 + (glum ? 1.5 : 0) + (1 - e), () => ["sit", { dur: rand(10, 22) }]],
      [0.9, () => ["lookAround"]],
      [1.2 * hobby + (cat === "office" || cat === "mail" ? 0.8 : 0), () => ["read"]],
      [1.0 * hobby + (b.musicOn ? 2.5 : 0), () => ["music"]],
      [0.8 * hobby, () => ["juggle"]],
      [0.7 * hobby, () => ["doodle"]],
      [0.6 * hobby, () => ["yoyo"]],
      [0.35 * hobby, () => ["magic"]],
      // mimic your work: a little laptop session while you code / write
      [cat === "code" || cat === "office" || cat === "terminal" ? 1.4 : 0, () => ["focus", { dur: rand(12, 25) }]],
      [0.5, () => ["think", { text: glum ? "*sigh*" : pick(["Hmm…", "What was I doing?", "🤔", "Big thoughts…"]) }]],
      [h > 14 || late ? 1.2 - e : 0.15, () => ["yawn"]],
      [0.5, () => ["stretch"]],
      [h >= 7 && h < 11 ? 0.9 : 0.25, () => ["coffee"]],
      [roam && chill && !onWin ? 0.4 : 0, () => ["peek"]],
      // climbing windows is "chill" behaviour; in work mode he stays on the taskbar
      [roam && chill ? (onWin ? 0.7 : 0.9) : onWin ? 1.5 : 0, () => (onWin ? ["__hopDown"] : ["__climb"])],
      [0.4, () => ["turn"]],
      [late ? 1.2 : 0, () => ["sleep", { sitting: true, cap: true }]],
    ];
    const total = opts.reduce((a, [wgt]) => a + wgt, 0);
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

  /** Look at a window (screen rect) for a while. */
  private watch(f: Fg, ms = 0) {
    const w = this.b.world, o = w.windowOrigin(), s = w.scale;
    this.b.lookAt = { x: (f.rect.x + f.rect.w / 2 - o.x) / s, y: (f.rect.y + f.rect.h / 2 - o.y) / s };
    if (ms) {
      if (this.lookTimer) clearTimeout(this.lookTimer);
      this.lookTimer = window.setTimeout(() => { this.b.lookAt = null; this.lookTimer = 0; }, ms);
    }
  }

  private async climb() {
    const b = this.b, w = b.world;
    const win = await w.foregroundPerch();
    if (!win || b.priority >= 1) return;
    const s = w.scale;
    const x = Math.min(win.rect.x + win.rect.w - 80 * s, Math.max(win.rect.x + 80 * s, w.fx));
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

  // ------------------------------------------------------------------ you, interacting

  onPet() { this.b.mood.nudge(0.12, 0.03); this.mem.interacted(); }
  onPoke() { this.b.mood.nudge(0.03); this.mem.interacted(); }
  onWave() { this.b.mood.nudge(0.05); this.mem.interacted(); }
  onRoughLanding() { this.b.mood.nudge(-0.03); this.mem.interacted(); }

  async setMode(m: Settings["mode"]) {
    await patchSettings((s) => { s.mode = m; s.shhUntil = 0; });
    const text = { work: "Work mode: calm and quiet-ish 💼", chill: "Chill mode: full personality! 🎈", quiet: "Quiet mode: I'll just sit here 🤐" }[m];
    this.ui.say(text, { ms: 2400 });
  }

  async shh(minutes = 60) {
    await patchSettings((s) => { s.shhUntil = Date.now() + minutes * 60_000; });
    this.b.play("shh", { text: `🤐 Shh for ${minutes === 60 ? "an hour" : minutes + " min"}. Meetings still get through.` }, { force: true });
  }

  async unshh() {
    await patchSettings((s) => { s.shhUntil = 0; });
    this.b.play("wave", { text: "I'm back! 👋" }, { force: true });
  }

  // ------------------------------------------------------------------ events from Rust

  onPresence(p: Presence) {
    const prev = this.presence;
    this.presence = p;
    this.voice.inCall = p.inCall;
    this.voice.idleMs = p.idleMs;
    const now = Date.now();
    const nudgedRecently = now - this.lastNudge < 9000;
    if (p.idleMs < 6000 && !nudgedRecently && !p.locked) {
      if (this.away) this.welcomeBack(now - this.lastReal);
      this.lastReal = now - p.idleMs;
      this.away = false;
    } else if (!this.away && now - this.lastReal > 5 * 60_000 && !this.focus.working) {
      this.away = true;
      this.awayStart = this.lastReal;
      if (this.b.priority < 1) this.b.stop();
    }

    if (this.s.hideFullscreen && p.fullscreen && !this.hiddenByFullscreen) {
      this.hiddenByFullscreen = true;
      this.b.play("hideDuck", undefined, { force: true }).then(() => this.setWindowHidden(true));
    } else if (this.hiddenByFullscreen && !p.fullscreen) {
      this.hiddenByFullscreen = false;
      this.setWindowHidden(false);
      this.b.play("popUp", undefined, { force: true });
    }

    if (p.locked !== prev.locked) this.b.setHidden(p.locked || this.hiddenByFullscreen);

    if (p.inCall && !prev.inCall && this.voice.mode !== "quiet" && this.cooldown("shh", 10 * 60_000)) this.b.play("shh");
    if (!p.inCall && prev.inCall && this.b.actionName === "quiet") this.b.stop();
    if (this.voice.mode === "quiet" && this.b.priority < 1 && this.b.actionName !== "quiet" && this.b.actionName !== "sleep") this.b.stop();

    this.ui.setBadge(!p.keepalive ? "off" : p.inHours ? "on" : "off");
    this.voice.flush(); // a presence tick is a chance for a queued line, if you've paused
  }

  onNudgeRequest() {
    this.lastNudge = Date.now();
    if (this.b.hidden) { invoke("do_nudge"); return; }
    this.ui.setBadge("active");
    this.b.play("nudge", undefined, { force: this.b.priority < 6 }).then(() => this.ui.setBadge("on"));
  }

  onNudgeDone() { this.lastNudge = Date.now(); }

  /** You switched apps (or moved the window you're in). */
  onForeground(f: Fg) {
    const switched = !this.fg || this.fg.id !== f.id;
    this.fg = f;
    const cat = categorize(f.exe, f.title);
    const catChanged = cat !== this.category;
    this.category = cat;
    const b = this.b, w = b.world;
    if (switched) {
      // glance at the window you just switched to (cheap, wordless, very "alive")
      if (b.priority < 1 && this.calm && this.voice.mayReact("glance")) this.watch(f, 1400);
      if (catChanged && b.priority < 1 && (cat === "video" || b.actionName === "focus")) b.stop();
      this.voice.flush(); // switching apps is a natural breakpoint
    }

    // a window dragged on top of him: startle and scoot out from under it
    const s = w.scale, o = w.windowOrigin(), hc = b.headPos();
    const hx = o.x + hc.x * s, hy = o.y + hc.y * s;
    const mon = w.monitorAt(hx).work;
    const big = f.rect.w > mon.w * 0.85 || f.rect.h > mon.h * 0.85;
    const over = !big && hx > f.rect.x && hx < f.rect.x + f.rect.w && hy > f.rect.y && hy < f.rect.y + f.rect.h;
    if (over && !this.covered && w.surface.kind === "floor" && b.priority < 2 && this.calm && this.voice.mayReact("covered") && this.cooldown("covered", 45_000)) {
      const left = f.rect.x - 90 * s, right = f.rect.x + f.rect.w + 90 * s;
      const [lo, hi] = w.range();
      const x = Math.abs(left - w.fx) < Math.abs(right - w.fx) && left > lo ? left : right < hi ? right : left;
      b.play("poke", { kind: "startle" }, { force: true }).then(() => b.play("walk", { x, run: true, maxT: 4 }));
      this.voice.auto("covered", pick(["Hey! I was standing there 😤", "Whoa, watch it! 😅", "Excuse me, coming through!"]));
    }
    this.covered = over;
  }

  /** Media session changed (song/video started, paused, changed). */
  onMedia(m: Media | null) {
    const playing = !!m?.playing && !!m.title;
    const was = this.b.musicOn;
    this.b.musicOn = playing;
    if (!playing || !m) { this.song = ""; return; }
    if (m.title === this.song) return;
    this.song = m.title;
    const plays = this.mem.playedSong(m.title);
    if (!was && this.b.priority < 1 && this.voice.mayReact("music")) this.b.stop(); // start bopping
    if (plays >= 4 && this.mem.once(`repeat:${m.title}`)) {
      this.voice.auto("repeat", `"${m.title}" again? That's ${plays} times today 🔁`);
    } else if (Math.random() < 0.35) {
      this.voice.auto("song", `🎵 ${m.title}${m.artist ? " — " + m.artist : ""}`);
    }
  }

  onSysmon(s: SysStats) {
    if (!this.calm) return;
    if (s.cpu > 88 && this.cooldown("cpu", 15 * 60_000)) this.react("sweaty", { cpu: s.cpu }, "cpu");
    else if (s.mem > 92 && this.cooldown("mem", 25 * 60_000)) this.react("heavyBox", { mem: s.mem }, "mem");
    if (s.hasBattery) {
      if (!s.charging && s.battery <= 20 && this.cooldown("bat", 15 * 60_000)) this.react("lowBattery", { pct: s.battery }, "!battery");
      if (s.charging && this.last.wasDischarging && this.cooldown("chg", 60_000)) this.react("charging", {}, "charging");
      this.last.wasDischarging = s.charging ? 0 : 1;
    }
  }

  onClipboard(preview: string) {
    if (!this.calm || this.b.priority >= 2) return;
    if (this.cooldown("clip", 25_000)) this.react("catchPaper", { text: preview.length > 40 ? preview.slice(0, 40) + "…" : preview }, "clip");
  }

  // ------------------------------------------------------------------ scheduler (every 20s)

  tick() {
    const now = Date.now();
    const d = new Date();
    const h = hour();
    const active = now - this.lastReal < 90_000;
    this.ticks++;
    if (this.ticks % 3 === 0) {
      this.mem.m.mood = { v: this.b.mood.v, e: this.b.mood.e };
      this.mem.touch();
    }

    // meetings always get through (T-5, T-1, T-0)
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

    // shh timer ran out
    if (this.s.shhUntil && now > this.s.shhUntil && this.mem.once(`unshh:${this.s.shhUntil}`, "ever")) {
      patchSettings((s) => { s.shhUntil = 0; });
    }

    if (!active || this.voice.mode === "quiet" || this.presence.inCall) {
      // don't nag an empty chair (or while shushed); push reminders back a little
      for (const k in this.remindAt) this.remindAt[k] = Math.max(this.remindAt[k], now + 2 * 60_000);
      return;
    }

    // feeling ignored? (active at the desk but no interaction for 3h) — gentle, never guilt
    if (now - this.mem.m.lastInteract > 3 * 3_600_000 && this.cooldown("lonely-drift", 3_600_000)) {
      this.b.mood.nudge(-0.06);
      if (this.b.mood.v < -0.1) this.voice.auto("lonely", pick(["*pokes you* Remember me? 🥺", "Pet me maybe? 👉👈"]));
    }

    // wellbeing reminders (held during focus work — they come in the break)
    if (!this.focus.working && this.b.priority < 2) {
      const R = this.s.reminders;
      const due = (Object.keys(R) as (keyof typeof R)[]).find((k) => R[k].on && now >= this.remindAt[k]);
      if (due) {
        this.remindAt[due] = now + R[due].every * 60_000;
        this.remind(due);
        return;
      }
    }

    if (!this.calm || this.b.priority >= 1) return;

    // special days
    if (this.mem.isBirthday(this.s.birthday) && this.mem.once("birthday")) {
      this.b.play("celebrate", { text: `Happy birthday${this.s.userName ? ", " + this.s.userName : ""}! 🎂🎉`, hat: true }, { force: true });
      this.b.mood.nudge(0.3);
      return;
    }
    const ms = this.mem.milestone();
    if (ms) {
      this.b.play("celebrate", { text: `We've been buddies for ${ms} days! 🎉`, hat: true }, { force: true });
      this.b.mood.nudge(0.2);
      return;
    }

    // time-of-day moments, once a day each (budgeted)
    const lunchMin = this.mem.m.lunchMin ?? 12 * 60 + 30;
    const mins = d.getHours() * 60 + d.getMinutes();
    if (h >= 5 && h < 11 && this.mem.once("morning")) { if (this.voice.allow("morning")) this.morning(); return; }
    if (mins >= lunchMin - 5 && mins < lunchMin + 45 && this.mem.once("lunch")) {
      if (this.voice.allow("lunch")) this.b.play("holdSign", { text: "Lunch? 🍜", dur: 5, say: this.mem.m.lunchMin != null ? "Your usual lunch time!" : "Don't skip lunch!" });
      return;
    }
    if (d.getDay() === 5 && h >= 15.5 && h < 18 && this.mem.once("friday")) { this.voice.auto("friday", "Almost weekend! 🎉"); return; }
    if (h >= 18 && h < 19.5 && this.mem.once("evening")) { this.voice.auto("evening", "Wrapping up soon? 🌇"); return; }
    if ((h >= 23 || h < 3) && this.mem.once("late")) { this.voice.auto("late", "It's really late… bed soon? 🌙"); return; }

    // chatter (frequency from settings; budget from mode)
    const every = { quiet: Infinity, normal: 12 * 60_000, chatty: 5 * 60_000 }[this.s.chatter];
    if (Number.isFinite(every) && this.cooldown("quip", every * rand(0.8, 1.4))) {
      const pool = h < 11 ? QUIPS.morning : h < 17 ? QUIPS.afternoon : h < 22 ? QUIPS.evening : QUIPS.night;
      this.voice.auto("quip", pick(Math.random() < 0.5 ? pool : QUIPS.any));
    }
  }

  remind(kind: "water" | "stretch" | "eyes" | "posture") {
    chime();
    const key = `remind:${kind}`;
    const snooze = () => {
      this.snoozes[kind] = (this.snoozes[kind] ?? 0) + 1;
      if (this.snoozes[kind] >= 2) {
        // snoozed twice in a row: stop asking about this one for the rest of the day
        const end = new Date(); end.setHours(23, 59, 0, 0);
        this.remindAt[kind] = end.getTime();
        this.snoozes[kind] = 0;
        this.ui.say("Got it — I'll leave that one for today 👍", { ms: 2400 });
      } else {
        this.remindAt[kind] = Date.now() + 10 * 60_000;
        this.ui.say("Okay, in 10 minutes ⏰", { ms: 2000 });
      }
    };
    const done = () => {
      this.snoozes[kind] = 0;
      this.voice.engaged(key);
      this.b.mood.nudge(0.08);
      this.mem.interacted();
      this.b.play("celebrate", { text: pick(["Nice! 🎉", "Proud of you!", "That's the spirit!"]) });
    };
    const buttons = [{ label: "Done ✓", primary: true, fn: done }, { label: "Snooze", fn: snooze }];
    if (kind === "water") { this.b.play("drink", { text: "Water break! 💧" }, { force: true }); setTimeout(() => this.voice.say(key, "Have a glass of water?", { buttons }), 5200); }
    if (kind === "stretch") { this.b.play("breakTime", { text: "Stand up & stretch! 🙆" }, { force: true }); setTimeout(() => this.voice.say(key, "Did you stretch?", { buttons }), 5200); }
    if (kind === "eyes") this.b.play("eyeBreak", { secs: 20 }, { force: true });
    if (kind === "posture") this.b.play("posture", undefined, { force: true });
  }

  private async morning() {
    await this.b.play("coffee", { text: `Good morning${this.s.userName ? ", " + this.s.userName : ""}! ☕${this.weather ? "  " + weatherText(this.weather, this.s.weather.unit) : ""}` });
  }

  /** On launch: a greeting that knows how long we've been apart. */
  async greet(gapMs: number, firstRun: boolean) {
    const text = this.mem.greeting(this.s.userName, firstRun ? 0 : gapMs);
    const days = gapMs / 86_400_000;
    if (days >= 2) this.b.mood.nudge(0.25); // so happy you're back
    // a morning launch greeting counts as the day's morning hello
    if (hour() >= 5 && hour() < 11) this.mem.once("morning");
    await this.b.play(days >= 2 ? "celebrate" : "wave", { text }, { force: true });
  }

  private welcomeBack(awayMs: number) {
    const mins = Math.round(awayMs / 60_000);
    const name = this.s.userName ? `, ${this.s.userName}` : "";
    const lunch = this.mem.learnLunch(new Date(this.awayStart || Date.now() - awayMs), awayMs);
    this.b.mood.nudge(mins >= 30 ? 0.12 : 0.05);
    this.b.play("wakeUp", undefined, { force: true }).then(() => {
      if (this.voice.mode === "quiet") return;
      if (lunch) this.b.play("wave", { text: pick([`How was lunch${name}? 🍜`, `Welcome back${name}! Good lunch?`]) });
      else if (mins >= 30) this.b.play("celebrate", { text: `Welcome back${name}! You were away ${mins >= 90 ? Math.round(mins / 60) + "h" : mins + " min"}.` });
      else this.b.play("wave", { text: pick([`Oh! You're back${name} 👋`, `Welcome back${name}!`, "Hey there!"]) });
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
      this.b.mood.nudge(0.1);
      this.ui.setRing(true, 0, "", "break");
      this.b.play("breakTime", { text: next === "long" ? "Long break! Go for a walk 🚶" : "Break time! Stretch with me 🙆" }, { force: true });
    } else if (next === "idle" && (prev === "short" || prev === "long")) {
      chime("up");
      this.ui.setRing(false);
      this.voice.say("focus-again", "Break's over. Ready for another round?", {
        buttons: [
          { label: "Start focus", primary: true, fn: () => { this.voice.engaged("focus-again"); this.focus.cmd("start"); } },
          { label: "Not now", fn: () => { this.voice.dismissed("focus-again"); } },
        ],
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

void CX;
