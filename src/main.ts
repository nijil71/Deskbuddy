// Buddy window entry: builds the character, wires Rust events and mouse interactions.
import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Buddy } from "./buddy/buddy";
import { registerCore } from "./buddy/anims/core";
import { registerLife } from "./buddy/anims/life";
import { registerWork } from "./buddy/anims/work";
import { Brain, type Presence, type SysStats, type Fg, type Media } from "./buddy/brain";
import { Voice } from "./buddy/voice";
import { Remember } from "./buddy/memory";
import { Overlay } from "./ui/overlay";
import { W, H, CX, GROUND } from "./buddy/rig";
import { loadSettings, onSettings, patchSettings, SKINS, type Settings } from "./shared/settings";

const win = getCurrentWindow();
const stage = document.getElementById("stage")!;
const buddy = new Buddy(stage);
registerCore(buddy);
registerLife(buddy);
registerWork(buddy);
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

let down: { x: number; y: number; t: number; offX: number; offY: number; sx: number; sy: number } | null = null;
let dragSamples: { x: number; y: number; t: number }[] = [];
let clickTimer = 0;
let petDist = 0, petLast = { x: 0, y: 0 }, petDecay = 0;

const svg = buddy.rig.svg;

svg.addEventListener("pointerdown", async (e) => {
  if (e.button !== 0) return;
  ui.closeMenu();
  svg.setPointerCapture(e.pointerId);
  const d = { x: 0, y: 0, t: performance.now(), offX: NaN, offY: NaN, sx: e.screenX, sy: e.screenY };
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
      buddy.play("poke", undefined, { force: buddy.priority < 4 });
      brain?.onPoke();
    }, 260);
  }
});

svg.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openMenu();
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
  const h = new Date().getHours();
  return h < 12 ? "Good morning! 👋" : h < 18 ? "Hey there! 👋" : "Good evening! 👋";
}

function openMenu() {
  const f = brain.focus;
  // Every action reports failures in a bubble instead of failing silently.
  const oops = (what: string) => (e: unknown) => { console.error(what, e); ui.say(`Couldn't ${what} 😕`, { ms: 3000 }); };
  const panel = (tab: string) => () => invoke("open_panel", { tab }).catch(oops(`open ${tab}`));
  const keepOn = settings.keep.enabled;
  ui.openMenu([
    f.running
      ? { label: f.s.paused ? "Resume" : "Pause", icon: f.s.paused ? "play" : "pause", fn: () => f.cmd(f.s.paused ? "resume" : "pause") }
      : { label: `Focus ${settings.focus.work}m`, icon: "headphones", fn: () => f.cmd("start") },
    f.running
      ? { label: "Stop focus", icon: "stop", fn: () => f.cmd("stop") }
      : { label: "Weather", icon: "cloud", fn: () => brain.showWeather().catch(oops("check the weather")) },
    { label: "News", icon: "news", fn: () => brain.showNews().catch(oops("get the news")) },
    { label: "Note", icon: "note", fn: panel("notes") },
    { label: "Clipboard", icon: "clipboard", fn: panel("clipboard") },
    { label: "Launcher", icon: "rocket", fn: panel("launcher") },
    {
      label: "Screenshot", icon: "camera",
      fn: () => buddy.play("camera", {
        then: () => invoke<boolean>("shell_open", { target: "ms-screenclip:" })
          .then((ok) => { if (!ok) oops("open the snipping tool")(null); })
          .catch(oops("open the snipping tool")),
      }, { force: true }),
    },
    { label: "Surprise!", icon: "dice", fn: () => buddy.play(["juggle", "music", "magic", "celebrate", "yoyo", "doodle", "news"][(Math.random() * 7) | 0], undefined, { force: true }) },
    { label: "", icon: "", fn: () => {}, sep: true },
    {
      label: keepOn ? "Keep-alive on" : "Keep-alive off", icon: keepOn ? "dot" : "ring",
      fn: () => patchSettings((s) => { s.keep.enabled = !keepOn; })
        .then(() => ui.say(!keepOn ? "Keep-alive on. I'll keep you green 🟢" : "Keep-alive off. Teams may show Away.", { ms: 2600 }))
        .catch(oops("change keep-alive")),
    },
    {
      label: `Mode: ${settings.mode === "work" ? "Work" : settings.mode === "chill" ? "Chill" : "Quiet"}`,
      icon: settings.mode === "work" ? "briefcase" : settings.mode === "chill" ? "sparkles" : "mute",
      fn: () => brain.setMode(settings.mode === "work" ? "chill" : settings.mode === "chill" ? "quiet" : "work"),
    },
    voice.shushed
      ? { label: "Un-shh", icon: "volume", fn: () => brain.unshh() }
      : { label: "Shh 1 hour", icon: "mute", fn: () => brain.shh(60) },
    { label: buddy.actionName === "sleep" ? "Wake up" : "Nap", icon: "moon", fn: () => buddy.actionName === "sleep" ? buddy.play("wakeUp", undefined, { force: true }) : buddy.play("sleep", { sitting: true }, { force: true }) },
    { label: "Settings", icon: "gear", fn: panel("settings") },
    { label: "Hide", icon: "eyeOff", fn: () => invoke("set_buddy_visible", { visible: false }).catch(oops("hide")) },
  ]);
  setTimeout(() => { if (ui.menuOpen) ui.closeMenu(); }, 9000);
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
  brain.setSettings(settings);
  pushKeepalive(settings);

  await listen<[number, number]>("cursor", (e) => buddy.setCursor(e.payload[0], e.payload[1]));
  await listen<Presence>("presence", (e) => brain.onPresence(e.payload));
  await listen("nudge-request", () => brain.onNudgeRequest());
  await listen("nudge-done", () => brain.onNudgeDone());
  await listen<SysStats>("sysmon", (e) => brain.onSysmon(e.payload));
  await listen<string>("clipboard", (e) => brain.onClipboard(e.payload));
  await listen<Fg>("fg", (e) => brain.onForeground(e.payload));
  await listen<Media | null>("media", (e) => brain.onMedia(e.payload));
  await listen<boolean>("visibility", (e) => buddy.setHidden(!e.payload));
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
    invoke("set_dnd", { on: s.dnd });
  });

  setInterval(() => brain.tick(), 20_000);
  setInterval(() => brain.refreshWeather(), 30 * 60_000);
  brain.refreshWeather();

  buddy.start();
  buddy.play("idle", { dur: 0.1 });
  await win.show();
  buddy.syncHitbox();

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
