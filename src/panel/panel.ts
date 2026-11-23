// Panel window: focus timer, reminders & meetings, notes, clipboard, launcher, settings, animation lab.
import "./panel.css";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable as autoOn, disable as autoOff, isEnabled as autoIs } from "@tauri-apps/plugin-autostart";
import {
  loadSettings, saveSettings, loadNotes, saveNotes, uid, today, onSettings,
  type Settings, type Note,
} from "../shared/settings";
import { geocode } from "../services/weather";
import type { FocusState } from "../services/focus";

const win = getCurrentWindow();
const view = document.getElementById("view")!;
const tabsEl = document.getElementById("tabs")!;
document.getElementById("close")!.onclick = () => win.close();
document.getElementById("min")!.onclick = () => win.minimize();
document.addEventListener("keydown", (e) => { if (e.key === "Escape") win.close(); });
document.addEventListener("contextmenu", (e) => { if (!(e.target as HTMLElement).closest("input,textarea")) e.preventDefault(); });

const TABS = [
  ["focus", "🎧", "Focus"], ["reminders", "⏰", "Reminders"], ["notes", "📝", "Notes"],
  ["clipboard", "📋", "Clipboard"], ["launcher", "🚀", "Launcher"], ["settings", "⚙️", "Settings"], ["lab", "🎭", "Lab"],
] as const;
type Tab = (typeof TABS)[number][0];

let S: Settings;
let current: Tab = "focus";
let cleanup: (() => void)[] = [];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => view.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(view.querySelectorAll(sel)) as T[];
const save = async () => { await saveSettings(S); };
const lab = (action: string, args?: unknown) => emit("lab-play", { action, args });

function toast(msg: string) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 1600);
}

function renderTabs() {
  tabsEl.innerHTML = TABS.map(([id, icon, label]) =>
    `<button data-tab="${id}" class="${id === current ? "on" : ""}" title="${label}"><span>${icon}</span><em>${label}</em></button>`).join("");
  tabsEl.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => show(b.dataset.tab as Tab)));
}

function show(tab: Tab) {
  current = TABS.some((t) => t[0] === tab) ? tab : "focus";
  cleanup.forEach((f) => f()); cleanup = [];
  renderTabs();
  view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter");
  ({ focus, reminders, notes, clipboard, launcher, settings, lab: labTab } as Record<Tab, () => void>)[current]();
}

// ------------------------------------------------------------------ Focus

function focus() {
  const C = 2 * Math.PI * 70;
  view.innerHTML = `
    <section class="center">
      <div class="big-ring">
        <svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" class="bg"/><circle cx="80" cy="80" r="70" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C}"/></svg>
        <div class="ring-label"><b id="ft">${S.focus.work}:00</b><small id="fp">Ready</small></div>
      </div>
      <div class="row gap" id="fbtns"></div>
      <div class="chips" id="presets">
        ${[15, 25, 45, 60].map((m) => `<button class="chip" data-m="${m}">${m} min</button>`).join("")}
      </div>
    </section>
    <section class="card">
      <h3>Session setup</h3>
      <div class="grid2">
        <label>Focus <span><input type="number" id="fw" min="5" max="180" value="${S.focus.work}"> min</span></label>
        <label>Short break <span><input type="number" id="fs" min="1" max="30" value="${S.focus.short}"> min</span></label>
        <label>Long break <span><input type="number" id="fl" min="5" max="60" value="${S.focus.long}"> min</span></label>
        <label>Rounds before long <span><input type="number" id="fr" min="2" max="8" value="${S.focus.rounds}"></span></label>
      </div>
      <p class="muted">During focus your buddy sits with a laptop & headphones, stays quiet and holds reminders until the break.</p>
    </section>`;
  const fg = $(".fg") as unknown as SVGCircleElement;
  const render = (st: FocusState) => {
    const rem = st.paused || st.phase === "idle" ? st.remaining : Math.max(0, st.endsAt - Date.now());
    const frac = st.phase === "idle" ? 0 : 1 - rem / Math.max(1, st.total);
    fg.style.strokeDashoffset = String(C * (1 - frac));
    fg.classList.toggle("brk", st.phase === "short" || st.phase === "long");
    const s = Math.ceil(rem / 1000);
    $("#ft").textContent = st.phase === "idle" ? `${S.focus.work}:00` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    $("#fp").textContent = st.phase === "idle" ? "Ready" : st.paused ? "Paused" : st.phase === "work" ? `Focus · round ${st.round}` : st.phase === "long" ? "Long break" : "Short break";
    const btn = (a: string, l: string, cls = "") => `<button class="btn ${cls}" data-a="${a}">${l}</button>`;
    $("#fbtns").innerHTML = st.phase === "idle"
      ? btn("start", "▶ Start focus", "primary") + btn("break", "☕ Take a break")
      : (st.paused ? btn("resume", "▶ Resume", "primary") : btn("pause", "❚❚ Pause", "primary")) + btn("skip", "⏭ Skip") + btn("stop", "■ Stop");
    $$("#fbtns button").forEach((b) => (b.onclick = () => emit("focus-cmd", { action: b.dataset.a })));
  };
  render({ phase: "idle", endsAt: 0, remaining: S.focus.work * 60000, total: 1, round: 1, rounds: 4, paused: false });
  listen<FocusState>("focus-state", (e) => render(e.payload)).then((u) => cleanup.push(u));
  emit("focus-query");
  $$("#presets .chip").forEach((b) => (b.onclick = () => emit("focus-cmd", { action: "start", minutes: +b.dataset.m! })));
  const bind = (id: string, key: keyof Settings["focus"]) => {
    const i = $<HTMLInputElement>(id);
    i.onchange = () => { S.focus[key] = Math.max(+i.min, Math.min(+i.max, +i.value || S.focus[key])); i.value = String(S.focus[key]); save(); };
  };
  bind("#fw", "work"); bind("#fs", "short"); bind("#fl", "long"); bind("#fr", "rounds");
}

// ------------------------------------------------------------------ Reminders & meetings

function reminders() {
  const R = S.reminders;
  const items: [keyof typeof R, string, string][] = [
    ["water", "💧", "Drink water"], ["stretch", "🙆", "Stand & stretch"], ["eyes", "👀", "Eye break (20-20-20)"], ["posture", "🪑", "Posture check"],
  ];
  const opts = [10, 15, 20, 30, 45, 50, 60, 90, 120];
  const meetings = S.meetings.filter((m) => m.date >= today()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  view.innerHTML = `
    <section class="card">
      <h3>Wellbeing reminders</h3>
      ${items.map(([k, icon, label]) => `
        <div class="setting">
          <span class="ico">${icon}</span><span class="grow">${label}</span>
          <select data-every="${k}">${opts.map((o) => `<option value="${o}" ${R[k].every === o ? "selected" : ""}>every ${o} min</option>`).join("")}</select>
          <button class="mini" data-test="${k}" title="Try it">▶</button>
          <label class="switch"><input type="checkbox" data-on="${k}" ${R[k].on ? "checked" : ""}><i></i></label>
        </div>`).join("")}
      <p class="muted">Reminders only appear while you're at the desk, never during calls or focus sessions.</p>
    </section>
    <section class="card">
      <h3>Meeting countdown</h3>
      <div class="row gap">
        <input type="time" id="mt" value="${nextHalfHour()}">
        <input type="text" id="mn" placeholder="Standup, 1:1, demo…" class="grow">
        <button class="btn primary" id="madd">Add</button>
      </div>
      <ul class="list" id="ml">
        ${meetings.length ? meetings.map((m) => `<li><b>${m.time}</b><span class="grow">${esc(m.title)}</span><small>${m.date === today() ? "today" : m.date}</small><button class="mini" data-del="${m.id}">✕</button></li>`).join("") : `<li class="empty">No meetings yet. Your buddy will hold up a sign 5 min and 1 min before.</li>`}
      </ul>
    </section>`;
  $$("[data-every]").forEach((s) => ((s as HTMLSelectElement).onchange = () => { R[s.dataset.every as keyof typeof R].every = +(s as HTMLSelectElement).value; save(); }));
  $$("[data-on]").forEach((c) => ((c as HTMLInputElement).onchange = () => { R[c.dataset.on as keyof typeof R].on = (c as HTMLInputElement).checked; save(); }));
  $$("[data-test]").forEach((b) => (b.onclick = () => lab("__remind", b.dataset.test)));
  $("#madd").onclick = () => {
    const t = $<HTMLInputElement>("#mt").value, n = $<HTMLInputElement>("#mn").value.trim() || "Meeting";
    if (!t) return;
    const now = new Date(), [hh, mm] = t.split(":").map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
    const d = at.getTime() < now.getTime() - 60000 ? new Date(at.getTime() + 86400000) : at;
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    S.meetings = [...S.meetings.filter((m) => m.date >= today()), { id: uid(), time: t, title: n, date }];
    save().then(reminders);
    toast("Meeting added");
  };
  $<HTMLInputElement>("#mn").onkeydown = (e) => { if (e.key === "Enter") $("#madd").click(); };
  $$("[data-del]").forEach((b) => (b.onclick = () => { S.meetings = S.meetings.filter((m) => m.id !== b.dataset.del); save().then(reminders); }));
}

function nextHalfHour() {
  const d = new Date(Date.now() + 30 * 60000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ Notes

const COLORS = ["#fff4a8", "#ffd6e0", "#cdeffd", "#d7f5d0", "#eadcff"];
async function notes() {
  let list = await loadNotes();
  const draw = () => {
    view.innerHTML = `
      <section class="card">
        <textarea id="nt" rows="3" placeholder="Jot something down… (Ctrl+Enter to save)"></textarea>
        <div class="row gap"><div class="swatches">${COLORS.map((c, i) => `<button class="sw ${i === 0 ? "on" : ""}" data-c="${c}" style="background:${c}"></button>`).join("")}</div><span class="grow"></span><button class="btn primary" id="nadd">Add note</button></div>
      </section>
      <div class="notes">${list.length ? list.map((n) => `
        <article class="note" style="background:${n.color}" data-id="${n.id}">
          <div contenteditable="true" spellcheck="false">${esc(n.text)}</div>
          <footer><small>${new Date(n.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
          <span class="grow"></span><button class="mini" data-show title="Buddy holds it up">🙋</button><button class="mini" data-copy title="Copy">⧉</button><button class="mini" data-del title="Delete">✕</button></footer>
        </article>`).join("") : `<p class="muted center">No notes yet.</p>`}</div>`;
    let color = COLORS[0];
    $$(".sw").forEach((b) => (b.onclick = () => { $$(".sw").forEach((x) => x.classList.remove("on")); b.classList.add("on"); color = b.dataset.c!; }));
    const add = async () => {
      const t = $<HTMLTextAreaElement>("#nt").value.trim();
      if (!t) return;
      list = [{ id: uid(), text: t, color, ts: Date.now() }, ...list];
      await saveNotes(list); draw();
    };
    $("#nadd").onclick = add;
    $<HTMLTextAreaElement>("#nt").onkeydown = (e) => { if (e.key === "Enter" && e.ctrlKey) add(); };
    $<HTMLTextAreaElement>("#nt").focus();
    $$(".note").forEach((card) => {
      const id = card.dataset.id!;
      const n = list.find((x) => x.id === id) as Note;
      const body = card.querySelector("[contenteditable]") as HTMLElement;
      body.onblur = async () => { n.text = body.innerText.trim(); await saveNotes(list); };
      (card.querySelector("[data-del]") as HTMLElement).onclick = async () => { list = list.filter((x) => x.id !== id); await saveNotes(list); draw(); };
      (card.querySelector("[data-copy]") as HTMLElement).onclick = async () => { await invoke("clip_set", { text: n.text }); toast("Copied"); };
      (card.querySelector("[data-show]") as HTMLElement).onclick = () => lab("holdNote", { text: n.text.slice(0, 120) });
    });
  };
  draw();
}

// ------------------------------------------------------------------ Clipboard

async function clipboard() {
  let q = "";
  const draw = async () => {
    const items = await invoke<string[]>("clip_history");
    const f = items.filter((t) => t.toLowerCase().includes(q.toLowerCase()));
    $("#cl").innerHTML = f.length ? f.map((t, i) => `
      <li class="clip" data-i="${i}" title="Click to copy">
        <pre>${esc(t.length > 400 ? t.slice(0, 400) + "…" : t)}</pre>
        <button class="mini" data-del="${i}" title="Remove">✕</button>
      </li>`).join("") : `<li class="empty">${items.length ? "Nothing matches." : "Copy some text and it'll show up here (last 30, kept in memory only)."}</li>`;
    $$("#cl .clip").forEach((li) => {
      const t = f[+li.dataset.i!];
      li.onclick = async (e) => {
        if ((e.target as HTMLElement).closest("[data-del]")) { await invoke("clip_remove", { text: t }); draw(); return; }
        await invoke("clip_set", { text: t }); toast("Copied to clipboard"); draw();
      };
    });
  };
  view.innerHTML = `
    <div class="row gap"><input id="cq" class="grow" placeholder="Search clipboard history…"><button class="btn" id="cc">Clear all</button></div>
    <ul class="list clips" id="cl"></ul>`;
  $<HTMLInputElement>("#cq").oninput = (e) => { q = (e.target as HTMLInputElement).value; draw(); };
  $("#cc").onclick = async () => { await invoke("clip_remove", { text: null }); draw(); };
  $<HTMLInputElement>("#cq").focus();
  listen("clipboard", () => draw()).then((u) => cleanup.push(u));
  draw();
}

// ------------------------------------------------------------------ Launcher

function fuzzy(q: string, s: string) {
  q = q.toLowerCase(); s = s.toLowerCase();
  if (!q) return 1;
  if (s.startsWith(q)) return 3;
  if (s.includes(q)) return 2;
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

function launcher() {
  let sel = 0;
  view.innerHTML = `
    <input id="lq" class="search" placeholder="Type to launch an app, folder, URL…" autocomplete="off">
    <ul class="list launch" id="ll"></ul>
    <section class="card">
      <h3>Pin something</h3>
      <div class="row gap"><input id="pn" placeholder="Name" style="width:34%"><input id="pt" class="grow" placeholder="Path, app.exe, URL or shell:…"><button class="btn primary" id="padd">Pin</button></div>
      <p class="muted">Tip: press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> anywhere to open this.</p>
    </section>`;
  const q = $<HTMLInputElement>("#lq");
  const results = () => {
    const v = q.value.trim();
    const pins = S.launcher.map((it, i) => ({ ...it, i, score: Math.max(fuzzy(v, it.name), fuzzy(v, it.target) * 0.5) }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    const extra: { name: string; target: string; i: number; kind: string }[] = [];
    if (v) {
      const looksPath = /^([a-z]:\\|\\\\|https?:\/\/|www\.|[a-z-]+:|.+\.(exe|lnk|bat|cmd|msc)$)/i.test(v);
      if (looksPath) extra.push({ name: `Open ${v}`, target: /^www\./i.test(v) ? `https://${v}` : v, i: -1, kind: "open" });
      extra.push({ name: `Search the web for “${v}”`, target: `https://www.bing.com/search?q=${encodeURIComponent(v)}`, i: -1, kind: "web" });
    }
    return [...pins.map((p) => ({ ...p, kind: "pin" })), ...extra];
  };
  const draw = () => {
    const r = results();
    sel = Math.min(sel, Math.max(0, r.length - 1));
    $("#ll").innerHTML = r.map((it, k) => `
      <li class="${k === sel ? "sel" : ""}" data-k="${k}">
        <span class="ico">${it.kind === "web" ? "🔎" : it.kind === "open" ? "↗" : iconFor(it.target)}</span>
        <span class="grow"><b>${esc(it.name)}</b><small>${esc(it.target)}</small></span>
        ${it.kind === "pin" ? `<button class="mini" data-unpin="${it.i}" title="Unpin">✕</button>` : `<kbd>↵</kbd>`}
      </li>`).join("") || `<li class="empty">Nothing pinned matches.</li>`;
    $$("#ll li[data-k]").forEach((li) => (li.onclick = (e) => {
      const un = (e.target as HTMLElement).closest("[data-unpin]") as HTMLElement | null;
      if (un) { S.launcher.splice(+un.dataset.unpin!, 1); save().then(draw); return; }
      go(r[+li.dataset.k!]);
    }));
  };
  const go = async (it?: { target: string; name: string }) => {
    if (!it) return;
    const ok = await invoke<boolean>("shell_open", { target: it.target });
    if (ok) win.close(); else toast("Couldn't open that 😕");
  };
  q.oninput = () => { sel = 0; draw(); };
  q.onkeydown = (e) => {
    const n = results().length;
    if (e.key === "ArrowDown") { sel = (sel + 1) % Math.max(1, n); draw(); e.preventDefault(); }
    if (e.key === "ArrowUp") { sel = (sel - 1 + n) % Math.max(1, n); draw(); e.preventDefault(); }
    if (e.key === "Enter") go(results()[sel]);
  };
  $("#padd").onclick = () => {
    const name = $<HTMLInputElement>("#pn").value.trim(), target = $<HTMLInputElement>("#pt").value.trim();
    if (!target) return;
    S.launcher.push({ name: name || target, target });
    save().then(() => { $<HTMLInputElement>("#pn").value = ""; $<HTMLInputElement>("#pt").value = ""; draw(); toast("Pinned"); });
  };
  draw();
  setTimeout(() => q.focus(), 30);
}

function iconFor(t: string) {
  if (/^https?:/i.test(t)) return "🌐";
  if (/^ms-settings:/i.test(t)) return "⚙️";
  if (/^msteams:/i.test(t)) return "💬";
  if (/^shell:|\\$|^[a-z]:\\[^.]*$/i.test(t)) return "📁";
  if (/calc/i.test(t)) return "🧮";
  if (/notepad/i.test(t)) return "🗒️";
  if (/screenclip/i.test(t)) return "📸";
  return "⚡";
}

// ------------------------------------------------------------------ Settings

async function settings() {
  const K = S.keep;
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const tm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  let auto = false;
  try { auto = await autoIs(); } catch { /* dev mode */ }
  view.innerHTML = `
    <section class="card">
      <h3>🟢 Keep Teams green</h3>
      <div class="setting"><span class="grow">Keep me Available while I step away<small>Your buddy nudges the mouse (1 px) + taps an invisible F15 key before Teams marks you Away.</small></span><label class="switch"><input type="checkbox" id="ke" ${K.enabled ? "checked" : ""}><i></i></label></div>
      <div class="setting"><span class="grow">Nudge after being idle for</span>
        <select id="kt">${[60, 120, 180, 210, 240].map((s) => `<option value="${s}" ${K.thresholdS === s ? "selected" : ""}>${s < 120 ? s + " s" : s / 60 + " min"}</option>`).join("")}</select></div>
      <div class="setting"><span class="grow">Only during work hours</span><label class="switch"><input type="checkbox" id="kw" ${K.workHoursOnly ? "checked" : ""}><i></i></label></div>
      <div class="setting sub ${K.workHoursOnly ? "" : "dim"}"><span class="grow row gap">
        <input type="time" id="ks" value="${tm(K.startMin)}"> to <input type="time" id="kn" value="${tm(K.endMin)}"></span>
        <span class="days">${days.map((d, i) => `<button class="day ${K.days[i] ? "on" : ""}" data-d="${i}">${d}</button>`).join("")}</span></div>
      <div class="setting"><span class="grow">Pause while I'm in a call<small>Detected when any app is using your microphone.</small></span><label class="switch"><input type="checkbox" id="kc" ${K.pauseInCall ? "checked" : ""}><i></i></label></div>
    </section>

    <section class="card">
      <h3>🎨 Look & personality</h3>
      <div class="skins">
        ${(["ink", "night", "color"] as const).map((s) => `<button class="skin ${S.skin === s ? "on" : ""}" data-skin="${s}"><i class="sk-${s}"></i>${s === "ink" ? "Ink" : s === "night" ? "Night" : "Color"}</button>`).join("")}
      </div>
      <div class="setting"><span class="grow">Accessory</span><select id="acc">
        ${[["auto", "Automatic"], ["none", "None"], ["cap", "Cap"], ["headphones", "Headphones"], ["sunglasses", "Sunglasses"], ["crown", "Crown"], ["party", "Party hat"]].map(([v, l]) => `<option value="${v}" ${S.accessory === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>
      <div class="setting"><span class="grow">Size</span><input type="range" id="sz" min="0.7" max="1.4" step="0.05" value="${S.size}"></div>
      <div class="setting"><span class="grow">Chattiness</span><select id="ch">
        ${[["quiet", "Quiet"], ["normal", "Normal"], ["chatty", "Chatty"]].map(([v, l]) => `<option value="${v}" ${S.chatter === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>
      <div class="setting"><span class="grow">Roam around & climb windows</span><label class="switch"><input type="checkbox" id="ro" ${S.roam ? "checked" : ""}><i></i></label></div>
      <div class="setting"><span class="grow">Hide during fullscreen & presentations</span><label class="switch"><input type="checkbox" id="hf" ${S.hideFullscreen ? "checked" : ""}><i></i></label></div>
      <div class="setting"><span class="grow">Do not disturb<small>No chatter or reminders. Keep-alive still works.</small></span><label class="switch"><input type="checkbox" id="dnd" ${S.dnd ? "checked" : ""}><i></i></label></div>
    </section>

    <section class="card">
      <h3>⛅ Weather</h3>
      <div class="row gap"><input id="wc" class="grow" placeholder="Your city" value="${esc(S.weather.city)}"><select id="wu"><option value="c" ${S.weather.unit === "c" ? "selected" : ""}>°C</option><option value="f" ${S.weather.unit === "f" ? "selected" : ""}>°F</option></select><button class="btn" id="wf">Set</button></div>
      <p class="muted">Uses Open-Meteo (free, no account). Only the city name / coordinates are sent.</p>
    </section>

    <section class="card">
      <h3>🖥️ App</h3>
      <div class="setting"><span class="grow">Start with Windows</span><label class="switch"><input type="checkbox" id="as" ${auto ? "checked" : ""}><i></i></label></div>
      <div class="row gap"><button class="btn" id="summon">Bring buddy here</button><span class="grow"></span><button class="btn danger" id="quit">Quit Deskbud</button></div>
    </section>`;

  const chk = (id: string, f: (v: boolean) => void) => ($<HTMLInputElement>(id).onchange = (e) => { f((e.target as HTMLInputElement).checked); save(); });
  const sel = (id: string, f: (v: string) => void) => ($<HTMLSelectElement>(id).onchange = (e) => { f((e.target as HTMLSelectElement).value); save(); });
  const mins = (v: string) => { const [h, m] = v.split(":").map(Number); return h * 60 + m; };
  chk("#ke", (v) => (K.enabled = v));
  sel("#kt", (v) => (K.thresholdS = +v));
  chk("#kw", (v) => { K.workHoursOnly = v; $(".setting.sub").classList.toggle("dim", !v); });
  $<HTMLInputElement>("#ks").onchange = (e) => { K.startMin = mins((e.target as HTMLInputElement).value); save(); };
  $<HTMLInputElement>("#kn").onchange = (e) => { K.endMin = mins((e.target as HTMLInputElement).value); save(); };
  $$(".day").forEach((b) => (b.onclick = () => { const i = +b.dataset.d!; K.days[i] = !K.days[i]; b.classList.toggle("on", K.days[i]); save(); }));
  chk("#kc", (v) => (K.pauseInCall = v));
  $$(".skin").forEach((b) => (b.onclick = () => { S.skin = b.dataset.skin as Settings["skin"]; $$(".skin").forEach((x) => x.classList.toggle("on", x === b)); save(); }));
  sel("#acc", (v) => (S.accessory = v as Settings["accessory"]));
  $<HTMLInputElement>("#sz").onchange = (e) => { S.size = +(e.target as HTMLInputElement).value; save(); };
  sel("#ch", (v) => (S.chatter = v as Settings["chatter"]));
  chk("#ro", (v) => (S.roam = v));
  chk("#hf", (v) => (S.hideFullscreen = v));
  chk("#dnd", (v) => (S.dnd = v));
  sel("#wu", (v) => (S.weather.unit = v as "c" | "f"));
  $("#wf").onclick = async () => {
    const c = $<HTMLInputElement>("#wc").value.trim();
    if (!c) return;
    try {
      const g = await geocode(c);
      if (!g) return toast("City not found");
      S.weather = { ...S.weather, city: g.name, lat: g.lat, lon: g.lon };
      $<HTMLInputElement>("#wc").value = g.name;
      await save();
      toast(`Weather set for ${g.name}`);
      lab("__weather");
    } catch { toast("Couldn't reach the weather service"); }
  };
  $<HTMLInputElement>("#as").onchange = async (e) => {
    const on = (e.target as HTMLInputElement).checked;
    try { on ? await autoOn() : await autoOff(); S.autostart = on; save(); toast(on ? "Starts with Windows" : "Won't start with Windows"); }
    catch { toast("Couldn't change startup setting"); }
  };
  $("#summon").onclick = () => emit("tray", "summon");
  $("#quit").onclick = () => invoke("quit");
}

// ------------------------------------------------------------------ Animation lab

function labTab() {
  const groups: [string, [string, string, unknown?][]][] = [
    ["Moves", [["walk", "🚶 Walk"], ["__throw", "🤾 Throw"], ["__climb", "🧗 Climb window"], ["peek", "👀 Peek"], ["turn", "↩ Turn"], ["lookAround", "🔍 Look around"], ["dizzy", "💫 Dizzy"]]],
    ["Feelings", [["wave", "👋 Wave", { text: "Hello!" }], ["celebrate", "🎉 Celebrate", { text: "Woohoo!", hat: true }], ["pet", "🥰 Pet"], ["poke", "👉 Poke"], ["yawn", "🥱 Yawn"], ["stretch", "🙆 Stretch"], ["sleep", "💤 Sleep", { sitting: true }], ["wakeUp", "⏰ Wake"], ["shh", "🤫 Shh"], ["think", "🤔 Think"]]],
    ["Hobbies", [["read", "📖 Read"], ["juggle", "🤹 Juggle"], ["music", "🎧 Music"], ["doodle", "✏️ Doodle"], ["yoyo", "🪀 Yo-yo"], ["coffee", "☕ Coffee"], ["magic", "🪄 Magic"], ["holdPhone", "📱 Phone", { text: "Scrolling…" }]]],
    ["Work", [["__nudge", "🟢 Keep-alive nudge"], ["focus", "💻 Focus"], ["breakTime", "🧘 Break"], ["drink", "💧 Water"], ["eyeBreak", "👓 Eye break", { secs: 6 }], ["posture", "🪑 Posture"], ["holdSign", "🪧 Sign", { text: "Standup!" }], ["holdNote", "📝 Note", { text: "Buy milk" }]]],
    ["System", [["sweaty", "🥵 High CPU", { cpu: 93 }], ["heavyBox", "📦 High RAM", { mem: 94 }], ["lowBattery", "🪫 Low battery", { pct: 12 }], ["charging", "⚡ Charging"], ["camera", "📸 Camera"], ["catchPaper", "📋 Clipboard", { text: "copied text" }], ["__weather", "⛅ Weather"], ["weather", "🌧️ Rain", { kind: "rain", text: "Rainy!" }], ["weather", "❄️ Snow", { kind: "snow", text: "Snow!" }], ["weather", "😎 Sunny", { kind: "sun", text: "Sunny!" }]]],
  ];
  view.innerHTML = `<p class="muted">Tap any animation to see your buddy perform it.</p>` + groups.map(([g, list]) => `
    <section class="card"><h3>${g}</h3><div class="labgrid">
      ${list.map(([a, l, args], i) => `<button class="chip" data-a="${a}" data-args='${args ? esc(JSON.stringify(args)) : ""}' data-i="${i}">${l}</button>`).join("")}
    </div></section>`).join("");
  $$(".labgrid .chip").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a!;
    let args = b.dataset.args ? JSON.parse(b.dataset.args) : undefined;
    if (a === "walk") {
      const [x] = await invoke<[number, number]>("get_cursor");
      args = { x };
    }
    lab(a, args);
    b.classList.add("pop"); setTimeout(() => b.classList.remove("pop"), 250);
  }));
}

// ------------------------------------------------------------------ boot

(async () => {
  S = await loadSettings();
  onSettings((s) => { S = s; });
  const hash = location.hash.slice(1) as Tab;
  show(hash || "focus");
  listen<string>("tab", (e) => show(e.payload as Tab));
  await win.show();
  await win.setFocus();
})();
