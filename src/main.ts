// Buddy window entry: builds the character, wires Rust events and mouse interactions.
import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Buddy } from "./buddy/buddy";
import { registerCore } from "./buddy/anims/core";
import { registerLife } from "./buddy/anims/life";
import { registerWork } from "./buddy/anims/work";
import { registerPlay } from "./buddy/anims/play";
import { setupDrop } from "./ui/drop";
import { checkForUpdate, startUpdateChecks } from "./services/update";
import { setupClaude } from "./services/claude";
import { ocrSnip } from "./ui/ocr";
import { Brain, type Presence, type SysStats, type Fg, type Media } from "./buddy/brain";
import { Voice } from "./buddy/voice";
import { Remember } from "./buddy/memory";
import { Overlay, type MenuModel } from "./ui/overlay";
import { W, H, CX, GROUND } from "./buddy/rig";
import { greetWord } from "./shared/shift";
import { repairPlan } from "./buddy/repair";
import { loadSettings, onSettings, patchSettings, SKINS, type Settings } from "./shared/settings";

const win = getCurrentWindow();
const stage = document.getElementById("stage")!;
const buddy = new Buddy(stage);
registerCore(buddy);
registerLife(buddy);
registerWork(buddy);
registerPlay(buddy);
const ui = new Overlay(stage, buddy);
// actions speak through here: reactions may be silenced, and carry their suggestion key
buddy.say = (text, opts = {}) => {
  if (buddy.silent) return;
  ui.say(text, { ...opts, key: opts.key ?? buddy.sayKey });
};

let settings: Settings;
let brain: Brain;
let voice: Voice;
const mem = new Remember();

// ------------------------------------------------------------------ appearance

function applyLook(s: Settings) {
  const vars = SKINS[s.skin];
  for (const k in vars) document.documentElement.style.setProperty(k, vars[k]);
  const acc = s.accessory;
  buddy.hat = acc === "auto" || acc === "none" ? "" : acc;
  if (buddy.world.size !== s.size) {
    buddy.world.size = s.size;
    stage.style.transform = `scale(${s.size})`;
    win.setSize(new LogicalSize(Math.round(W * s.size), Math.round(H * s.size))).then(() => buddy.world.applyPosition(true));
  }
}

function pushKeepalive(s: Settings) {
  invoke("set_keepalive", { cfg: s.keep }).catch(() => {});
}

// ------------------------------------------------------------------ pointer interactions

let down: { x: number; y: number; t: number; offX: number; offY: number; sx: number; sy: number; lx: number; ly: number } | null = null;
let dragSamples: { x: number; y: number; t: number }[] = [];
let clickTimer = 0;
let petDist = 0, petLast = { x: 0, y: 0 }, petDecay = 0;

const svg = buddy.rig.svg;

svg.addEventListener("pointerdown", async (e) => {
  if (e.button !== 0) return;
  ui.closeMenu();
  svg.setPointerCapture(e.pointerId);
  // where on his body you pressed (rig px) → which part reacts
  const r = svg.getBoundingClientRect(), sc = r.width / W;
  const d = { x: 0, y: 0, t: performance.now(), offX: NaN, offY: NaN, sx: e.screenX, sy: e.screenY, lx: (e.clientX - r.left) / sc, ly: (e.clientY - r.top) / sc };
  down = d;
  const [cx, cy] = await invoke<[number, number]>("get_cursor");
  Object.assign(d, { x: cx, y: cy, offX: buddy.world.fx - cx, offY: buddy.world.fy - cy });
  buddy.syncHitbox(null, true);
});

svg.addEventListener("pointermove", (e) => {
  if (down) {
    if (!buddy.dragging && Math.hypot(e.screenX - down.sx, e.screenY - down.sy) > 5) startDrag();
    return;
  }
  // petting: rubbing the head with the cursor
  const r = svg.getBoundingClientRect();
  const sc = r.width / W;
  const hx = (e.clientX - r.left) / sc, hy = (e.clientY - r.top) / sc;
  const hc = buddy.headPos();
  if (Math.abs(hx - hc.x) < 75 && Math.abs(hy - hc.y) < 90) {
    petDist += Math.hypot(hx - petLast.x, hy - petLast.y);
    petDecay = performance.now();
    if (petDist > 520 && buddy.priority < 4) { petDist = 0; buddy.play("pet"); brain?.onPet(); }
  }
  petLast = { x: hx, y: hy };
  if (performance.now() - petDecay > 900) petDist = 0;
});

function startDrag() {
  if (buddy.dragging || !down) return;
  buddy.dragging = true;
  dragSamples = [];
  ui.hideBubble();
  buddy.world.surface = { kind: "air" };
  buddy.play("dragged", undefined, { force: true });
}

svg.addEventListener("pointerup", (e) => {
  svg.releasePointerCapture(e.pointerId);
  const wasDown = down;
  down = null;
  if (buddy.dragging) {
    buddy.dragging = false;
    // throw velocity from the last ~80ms of samples
    const now = performance.now();
    const recent = dragSamples.filter((s) => now - s.t < 90);
    let vx = 0, vy = 0;
    if (recent.length >= 2) {
      const a = recent[0], z = recent[recent.length - 1];
      const dt = Math.max(16, z.t - a.t) / 1000;
      vx = (z.x - a.x) / dt; vy = (z.y - a.y) / dt;
    }
    const max = 3200 * buddy.world.scale;
    vx = Math.max(-max, Math.min(max, vx)); vy = Math.max(-max, Math.min(max, vy));
    buddy.world.launch(vx, vy);
    buddy.play("airborne", undefined, { force: true });
    return;
  }
  if (!wasDown) return;
  // click vs double-click
  if (clickTimer) {
    clearTimeout(clickTimer); clickTimer = 0;
    if (buddy.actionName === "sleep") buddy.play("wakeUp", undefined, { force: true });
    else { buddy.play("wave", { text: greeting() }, { force: true }); brain?.onWave(); }
  } else {
    clickTimer = window.setTimeout(() => {
      clickTimer = 0;
      if (buddy.actionName === "sleep") { buddy.play("wakeUp", undefined, { force: true }); return; }
      if (ui.bubbleVisible) { dismissBubble(); return; }
      brain?.play.touch(wasDown.lx, wasDown.ly); // hair boings, glasses get pushed up, belly giggles…
    }, 260);
  }
});

svg.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // right-click again = close (the pointerdown just before this may already have closed it)
  if (ui.menuOpen || performance.now() - ui.menuClosedAt < 300) { ui.closeMenu(); return; }
  const r = stage.getBoundingClientRect(), sc = r.width / W || 1;
  ui.openMenu(menuModel, { x: (e.clientX - r.left) / sc, y: (e.clientY - r.top) / sc });
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

/** You waved a bubble away: counts towards muting that kind of suggestion. */
function dismissBubble() {
  if (voice?.dismissed()) ui.say("Okay, I won't bring that up again 🤐", { ms: 2200 });
  else ui.hideBubble();
}
ui.bubble.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button")) return;
  dismissBubble();
});

function greeting() {
  return `${greetWord()}! 👋`;
}

const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${(s / 60) | 0}:${String(s % 60).padStart(2, "0")}`; };

/** What the right-click menu shows right now. Re-run on every settings change while it's open. */
function menuModel(): MenuModel {
  const f = brain.focus;
  // Every action reports failures in a bubble instead of failing silently.
  const oops = (what: string) => (e: unknown) => { console.error(what, e); ui.say(`Couldn't ${what} 😕`, { ms: 3000 }); };
  const panel = (tab: string) => () => invoke("open_panel", { tab }).catch(oops(`open ${tab}`));
  const keepOn = settings.keep.enabled;
  const shushed = voice.shushed;
  const asleep = buddy.actionName === "sleep";
  const snip = () => buddy.play("camera", {
    then: () => invoke<boolean>("shell_open", { target: "ms-screenclip:" })
      .then((ok) => { if (!ok) oops("open the snipping tool")(null); })
      .catch(oops("open the snipping tool")),
  }, { force: true });

  const status = f.running
    ? `${f.s.phase === "work" ? "Focus" : "Break"} ${f.s.paused ? "paused" : "on"} · ${mmss(f.s.paused ? f.s.remaining : f.s.endsAt - Date.now())}`
    : shushed ? `Shh until ${new Date(settings.shhUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : keepOn ? "Keeping you green" : "Keep-alive is off";

  return {
    title: greetWord(),
    status,
    head: [
      { label: "Settings", icon: "gear", fn: panel("settings") },
      { label: "Hide buddy", icon: "eyeOff", fn: () => invoke("set_buddy_visible", { visible: false }).catch(oops("hide")) },
    ],
    tiles: f.running
      ? [
          f.s.paused
            ? { label: "Resume", icon: "play", hint: mmss(f.s.remaining), accent: true, fn: () => f.cmd("resume") }
            : { label: "Pause", icon: "pause", hint: mmss(f.s.endsAt - Date.now()), accent: true, fn: () => f.cmd("pause") },
          { label: "Stop", icon: "stop", fn: () => f.cmd("stop") },
          { label: "Note", icon: "note", fn: panel("notes") },
          { label: "Snip", icon: "camera", fn: snip },
        ]
      : [
          { label: "Focus", icon: "headphones", hint: `${settings.focus.work} min`, accent: true, fn: () => f.cmd("start") },
          { label: "Note", icon: "note", fn: panel("notes") },
          { label: "Snip", icon: "camera", fn: snip },
        ],
    items: [
      { label: "Weather", icon: "cloud", fn: () => brain.showWeather().catch(oops("check the weather")) },
      { label: "News", icon: "news", fn: () => brain.showNews().catch(oops("get the news")) },
      { label: "Copy text", icon: "copy", fn: () => void ocrSnip(buddy, ui) },
      { label: "My day", icon: "comic", fn: panel("day") },
      { label: "Launcher", icon: "rocket", fn: panel("launcher") },
      { label: asleep ? "Wake up" : "Nap", icon: asleep ? "sun" : "moon", fn: () => asleep ? buddy.play("wakeUp", undefined, { force: true }) : buddy.play("sleep", { sitting: true }, { force: true }) },
      { label: "Surprise me", icon: "dice", fn: () => buddy.play(["juggle", "music", "magic", "celebrate", "yoyo", "doodle", "news"][(Math.random() * 7) | 0], undefined, { force: true }) },
    ],
    seg: {
      value: settings.mode,
      options: [
        { value: "work", label: "Work", icon: "briefcase" },
        { value: "chill", label: "Chill", icon: "sparkles" },
        { value: "quiet", label: "Quiet", icon: "mute" },
      ],
      pick: (v) => brain.setMode(v as Settings["mode"], true).catch(oops("change mode")),
    },
    toggles: [
      {
        label: "Keep Teams green", icon: "dot", on: keepOn, hint: keepOn ? "Nudges input when you're idle" : undefined,
        fn: () => patchSettings((s) => { s.keep.enabled = !keepOn; }).catch(oops("change keep-alive")),
      },
      {
        label: "Shh for an hour", icon: "mute", on: shushed, hint: shushed ? "Meetings still get through" : undefined,
        fn: () => (shushed ? brain.unshh(true) : brain.shh(60, true)).catch(oops("change shh")),
      },
    ],
  };
}

// ------------------------------------------------------------------ per-frame glue

let hitAcc = 0;
buddy.onFrame = (dt) => {
  const w = buddy.world;
  if (buddy.dragging && down) {
    invoke<[number, number]>("get_cursor").then(([x, y]) => {
      if (!down || Number.isNaN(down.offX)) return;
      w.fx = x + down.offX;
      w.fy = y + down.offY;
      dragSamples.push({ x: w.fx, y: w.fy, t: performance.now() });
      if (dragSamples.length > 12) dragSamples.shift();
    });
  } else if (w.surface.kind !== "air") {
    w.follow(dt);
  }
  w.applyPosition();
  ui.place();
  hitAcc += dt;
  if (hitAcc > 0.1) { hitAcc = 0; buddy.syncHitbox(ui.interactiveRect(), buddy.dragging || !!down || ui.menuOpen); }
};

buddy.world.onLand = (impact, surface) => {
  if (buddy.dragging) return;
  const hard = impact > 1900;
  if (hard) brain?.onRoughLanding();
  buddy.play("land", { impact }, { force: true }).then((ok) => {
    if (ok && hard) buddy.play("dizzy", undefined, { force: true });
    else if (ok && surface.kind === "window") buddy.play("sit", { dur: 4 });
  });
};
buddy.world.onFall = () => buddy.play("airborne", undefined, { force: true });

// ------------------------------------------------------------------ boot

async function boot() {
  settings = await loadSettings();
  applyLook(settings);
  await buddy.world.init();
  await mem.load();
  const gap = mem.startSession();
  voice = new Voice(ui, settings, mem.m, mem.save);
  brain = new Brain(buddy, ui, settings, mem, voice);
  brain.activity.on = settings.activity.on; brain.activity.ignore = settings.activity.ignore;
  await brain.activity.load();
  // the panel asks for fresh numbers / to forget a day; the diary lives here, so we do the writing
  await listen("activity-flush", () => brain.activity.flush().then(() => emit("activity-flushed")));
  await listen<string | null>("activity-forget", (e) => { brain.activity.forget(e.payload ?? undefined); brain.activity.flush().then(() => emit("activity-flushed")); });
  brain.setSettings(settings);
  pushKeepalive(settings);

  await listen<[number, number]>("cursor", (e) => { ui.onCursor(e.payload[0], e.payload[1]); buddy.setCursor(e.payload[0], e.payload[1]); brain.play.onCursor(e.payload[0], e.payload[1]); });
  await listen<[number, number]>("keys", (e) => brain.onKeys(e.payload[0], e.payload[1]));
  // what you're doing right now; the Lab tab can watch it live (heartbeat, so a closed panel stops the feed)
  let workWatchUntil = 0;
  await listen("workstate-watch", () => { workWatchUntil = Date.now() + 6000; });
  setInterval(() => {
    const w = brain.workTick();
    if (Date.now() < workWatchUntil) emit("workstate", { ...w, log: brain.work.log.slice(-25), totals: brain.work.totals, boundaries: brain.work.boundaries }).catch(() => {});
  }, 1000);
  await setupDrop(buddy, ui, () => brain.onPoke(0.04));
  startUpdateChecks(buddy, ui);
  await setupClaude({
    b: buddy, ui,
    dnd: () => settings.dnd,
    watching: () => (brain.category === "terminal" || brain.category === "code") && voice.idleMs < 15_000,
  });
  invoke("set_typing", { on: settings.play.typing }).catch(() => {});
  await listen<Presence>("presence", (e) => brain.onPresence(e.payload));
  await listen("nudge-request", () => brain.onNudgeRequest());
  await listen("nudge-done", () => brain.onNudgeDone());
  await listen<SysStats>("sysmon", (e) => brain.onSysmon(e.payload));
  await listen<string>("clipboard", (e) => brain.onClipboard(e.payload));
  await listen<Fg>("fg", (e) => brain.onForeground(e.payload));
  await listen<Media | null>("media", (e) => brain.onMedia(e.payload));
  await listen<boolean>("visibility", (e) => { brain.userVisible = e.payload; buddy.setHidden(!e.payload); });
  await listen<{ x: number; y: number; w: number; h: number }[]>("taskbars", (e) => { buddy.world.taskbars = e.payload; });
  // auto-hide taskbar slides up → hop onto it; slides away → drop back down
  let lastHop = -1e9;
  buddy.world.onFloorShift = (from, to) => {
    const busy = ["jumpTo", "airborne", "land", "dragged"].includes(buddy.actionName);
    if (busy) return true; // already mid-air: the landing will find the new floor
    if (buddy.priority >= 2 || buddy.actionName === "sleep" || buddy.actionName === "sit" || buddy.dragging) return false;
    if (performance.now() - lastHop < 15_000) return false; // don't make a show of it every time
    lastHop = performance.now();
    if (to < from) buddy.play("jumpTo", { x: buddy.world.fx, y: to }, { force: true });
    else { buddy.world.launch(0, 0); buddy.play("airborne", undefined, { force: true }); }
    return true;
  };
  await listen<boolean>("keepalive-toggled", (e) => {
    patchSettings((s) => { s.keep.enabled = e.payload; });
    ui.say(e.payload ? "Keep-alive on. I'll keep you green 🟢" : "Keep-alive off. Teams may show Away.", { ms: 2600 });
  });
  await listen<string>("tray", (e) => {
    if (e.payload === "summon") {
      const m = buddy.world.monitorAt(buddy.world.fx);
      if (buddy.world.fx < m.work.x || buddy.world.fx > m.work.x + m.work.w) buddy.world.fx = m.work.x + m.work.w / 2;
      buddy.play("wave", { text: greeting() }, { force: true });
    }
    if (e.payload === "dnd") patchSettings((s) => { s.dnd = !s.dnd; });
    if (e.payload === "shh") voice.shushed ? brain.unshh() : brain.shh(60);
    if (e.payload === "update") void checkForUpdate(buddy, ui, true);
  });
  await listen<{ action: string; args?: any }>("lab-play", (e) => {
    const { action, args } = e.payload;
    if (action === "__say") return ui.say(args, { ms: 3000 });
    if (action === "__weather") return brain.showWeather();
    if (action === "__news") return brain.showNews();
    if (action === "__remind") return brain.remind(args);
    if (action === "__throw") { buddy.world.launch(-900 * buddy.world.scale, -1400 * buddy.world.scale); buddy.play("airborne", undefined, { force: true }); return; }
    if (action === "__nudge") return brain.onNudgeRequest();
    if (action === "__climb") return (brain as any).climb();
    buddy.play(action, args, { force: true });
  });
  await onSettings((s) => {
    const keepChanged = JSON.stringify(s.keep) !== JSON.stringify(settings.keep);
    settings = s;
    applyLook(s);
    brain.setSettings(s);
    if (keepChanged) pushKeepalive(s);
    invoke("set_typing", { on: s.play.typing }).catch(() => {});
    invoke("set_dnd", { on: s.dnd });
    ui.refreshMenu(); // a switch in the menu flipped: show its new state
  });

  setInterval(() => brain.tick(), 20_000);
  setInterval(() => brain.refreshWeather(), 30 * 60_000);
  brain.refreshWeather();

  buddy.start();
  buddy.play("idle", { dur: 0.1 });
  await win.show();
  buddy.syncHitbox();

  // window watchdog: display changes (VDI/RDP fullscreen, docking, scaling) can resize or move our
  // window behind our back — check every 2 s and right after any scale change, repair what drifted
  let repairing = false;
  const repairWindow = async () => {
    if (repairing || !brain.userVisible) return;
    repairing = true;
    try {
      // window on screen but the loop thinks it's hidden (or the other way round): re-sync both
      const shown = await win.isVisible();
      if (shown && buddy.hidden && !brain.presence.locked) { await brain.syncWindow(); return; }
      if (buddy.hidden) return;
      const w = buddy.world;
      await w.refreshMonitors();
      const dpr = window.devicePixelRatio || 1;
      const [size, pos] = await Promise.all([win.innerSize(), win.outerPosition()]);
      const o = w.windowOrigin();
      const plan = repairPlan({
        actualSize: { w: size.width, h: size.height },
        wantSize: { w: Math.round(W * settings.size * dpr), h: Math.round(H * settings.size * dpr) },
        actualPos: { x: pos.x, y: pos.y }, wantPos: { x: Math.round(o.x), y: Math.round(o.y) },
        feet: { x: w.fx, y: w.fy }, monitors: w.monitors.map((m) => m.bounds),
        busy: buddy.dragging || w.surface.kind === "air" || ["jumpTo", "airborne", "dragged"].includes(buddy.actionName),
      });
      if (plan.resize) await win.setSize(new LogicalSize(Math.round(W * settings.size), Math.round(H * settings.size)));
      if (plan.rehome) {
        const m = w.monitors.find((x) => x.primary) ?? w.monitors[0];
        w.surface = { kind: "floor" };
        w.fx = m.work.x + m.work.w - 220 * w.scale;
        w.fy = w.floorY(w.fx);
      }
      if (plan.resize || plan.reposition) { w.applyPosition(true); buddy.syncHitbox(); }
      if (plan.rehome) buddy.play("land", { impact: 600 }, { force: true });
    } catch { /* window busy; try again next round */ } finally { repairing = false; }
  };
  setInterval(repairWindow, 2000);
  win.onScaleChanged(() => setTimeout(repairWindow, 300)).catch(() => {});
  win.onResized(() => setTimeout(repairWindow, 300)).catch(() => {});

  // entrance: drop in from above
  const w = buddy.world;
  const floor = w.fy;
  w.fy = floor - 420 * w.scale;
  w.applyPosition(true);
  w.launch(0, 0);
  await buddy.play("airborne", undefined, { force: true });

  if (!settings.firstRun) setTimeout(() => brain.greet(gap, false), 900);
  if (settings.firstRun) {
    setTimeout(() => {
      buddy.play("wave", { text: "Hi! I'm your desk buddy 👋" }, { force: true }).then(() =>
        ui.say("I'll keep Teams green when you step away, remind you to rest, and hang out. Right-click me for stuff!", {
          buttons: [{ label: "Nice!", primary: true, fn: () => {} }, { label: "Settings", fn: () => invoke("open_panel", { tab: "settings" }) }],
        }),
      );
      patchSettings((s) => { s.firstRun = false; });
    }, 1400);
  }
  brain.run();
}

boot();

// keep CX/GROUND imports used for type-checkers / future tweaks
void CX; void GROUND;
