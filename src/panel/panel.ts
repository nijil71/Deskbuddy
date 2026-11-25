// Panel window: focus timer, reminders & meetings, notes, clipboard, launcher, settings, animation lab.
import "./panel.css";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable as autoOn, disable as autoOff, isEnabled as autoIs } from "@tauri-apps/plugin-autostart";
import {
  loadSettings, saveSettings, loadNotes, saveNotes, uid, today, onSettings, loadMemory, saveMemory,
  type Settings, type Note,
} from "../shared/settings";
import { geocode } from "../services/weather";
import { fetchNews, matches, hnThread, ago, type Feed, type Story } from "../services/news";
import { loadActivity, standup, topThings, fmtDur, fmtMin } from "../services/activity";
import { comicSvg, comicPng } from "../comic/comic";
import { icon } from "../shared/icons";
import type { FocusState } from "../services/focus";

const win = getCurrentWindow();
const view = document.getElementById("view")!;
const tabsEl = document.getElementById("tabs")!;
document.getElementById("close")!.innerHTML = icon("x");
document.getElementById("min")!.innerHTML = icon("minimize");
document.getElementById("close")!.onclick = () => win.close();
document.getElementById("min")!.onclick = () => win.minimize();
document.addEventListener("keydown", (e) => { if (e.key === "Escape") win.close(); });
document.addEventListener("contextmenu", (e) => { if (!(e.target as HTMLElement).closest("input,textarea")) e.preventDefault(); });

const TABS = [
  ["focus", "headphones", "Focus"], ["reminders", "clock", "Reminders"], ["notes", "note", "Notes"], ["news", "news", "News"], ["day", "comic", "My day"],
  ["clipboard", "clipboard", "Clipboard"], ["launcher", "rocket", "Launcher"], ["settings", "gear", "Settings"], ["lab", "film", "Lab"],
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
  tabsEl.innerHTML = TABS.filter(([id]) => id !== "lab" || current === "lab").map(([id, ic, label]) =>
    `<button data-tab="${id}" class="${id === current ? "on" : ""}" title="${label}"><span>${icon(ic)}</span><em>${label}</em></button>`).join("");
  tabsEl.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => show(b.dataset.tab as Tab)));
}

function show(tab: Tab) {
  current = TABS.some((t) => t[0] === tab) ? tab : "focus";
  cleanup.forEach((f) => f()); cleanup = [];
  renderTabs();
  view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter");
  ({ focus, reminders, notes, news, day, clipboard, launcher, settings, lab: labTab } as Record<Tab, () => void>)[current]();
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
      ? btn("start", `${icon("play")} Start focus`, "primary") + btn("break", `${icon("coffee")} Take a break`)
      : (st.paused ? btn("resume", `${icon("play")} Resume`, "primary") : btn("pause", `${icon("pause")} Pause`, "primary")) + btn("skip", `${icon("skip")} Skip`) + btn("stop", `${icon("stop")} Stop`);
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
    ["water", "droplet", "Drink water"], ["stretch", "stretch", "Stand & stretch"], ["eyes", "eye", "Eye break (20-20-20)"], ["posture", "chair", "Posture check"],
  ];
  const opts = [10, 15, 20, 30, 45, 50, 60, 90, 120];
  const meetings = S.meetings.filter((m) => m.date >= today()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  view.innerHTML = `
    <section class="card">
      <h3>Wellbeing reminders</h3>
      ${items.map(([k, ic, label]) => `
        <div class="setting">
          <span class="ico">${icon(ic)}</span><span class="grow">${label}</span>
          <select data-every="${k}">${opts.map((o) => `<option value="${o}" ${R[k].every === o ? "selected" : ""}>every ${o} min</option>`).join("")}</select>
          <button class="mini" data-test="${k}" title="Try it">${icon("play")}</button>
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
        ${meetings.length ? meetings.map((m) => `<li><b>${m.time}</b><span class="grow">${esc(m.title)}</span><small>${m.date === today() ? "today" : m.date}</small><button class="mini" data-del="${m.id}">${icon("x")}</button></li>`).join("") : `<li class="empty">No meetings yet. Your buddy will hold up a sign 5 min and 1 min before.</li>`}
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
          <span class="grow"></span><button class="mini" data-show title="Buddy holds it up">${icon("hand")}</button><button class="mini" data-copy title="Copy">${icon("copy")}</button><button class="mini" data-del title="Delete">${icon("x")}</button></footer>
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
        <button class="mini" data-del="${i}" title="Remove">${icon("x")}</button>
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

// ------------------------------------------------------------------ My day: comic + standup + diary

let dayIdx = 0; // 0 = most recent day

async function day() {
  // ask the buddy window to write out the latest numbers first (it owns the diary)
  await new Promise<void>((res) => {
    let done = false;
    listen("activity-flushed", () => { if (!done) { done = true; res(); } }).then((u) => cleanup.push(u));
    emit("activity-flush");
    setTimeout(() => { if (!done) { done = true; res(); } }, 600);
  });
  const all = await loadActivity();
  const days = Object.keys(all).sort().reverse();
  const A = S.activity;
  if (!days.length) {
    view.innerHTML = `
      <section class="card empty-day">
        <h3>${icon("comic")} Your day, as a comic</h3>
        <p class="muted">${A.on ? "Nothing logged yet. Work for a bit and your buddy will start sketching. At the end of the day he draws it as a comic, and each morning he writes your standup notes." : "The activity diary is off, so there's nothing to draw yet."}</p>
      </section>` + privacyCard(A);
    bindPrivacy();
    return;
  }
  dayIdx = Math.min(dayIdx, days.length - 1);
  const d = all[days[dayIdx]];
  const isToday = d.day === today();
  const label = isToday ? "Today" : dayIdx === 0 || days[dayIdx - 1] === today() ? "Yesterday" : new Date(d.day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const things = topThings(d, 7, 3 * 60);
  const max = Math.max(1, ...things.map(([, t]) => t.s));
  view.innerHTML = `
    <div class="day-nav">
      <button class="mini" id="dprev" ${dayIdx >= days.length - 1 ? "disabled" : ""} title="Earlier">${icon("chevL")}</button>
      <b>${label}</b>
      <button class="mini" id="dnext" ${dayIdx === 0 ? "disabled" : ""} title="Later">${icon("chevR")}</button>
    </div>
    <div class="comic" id="comic"><div class="muted">Drawing…</div></div>
    <div class="row-btns">
      <button class="btn primary" id="csave">${icon("download")} Save image</button>
      <button class="btn" id="copen">${icon("folder")} Open folder</button>
    </div>
    <section class="card">
      <h3>${icon("clock")} At a glance</h3>
      <div class="stats four">
        <div><b>${fmtDur(d.active)}</b><small>at the desk</small></div>
        <div><b>${d.first >= 0 ? fmtMin(d.first) : "–"}</b><small>first seen</small></div>
        <div><b>${d.calls}${d.callSec ? ` <em>${fmtDur(d.callSec)}</em>` : ""}</b><small>calls</small></div>
        <div><b>${d.focus} / ${d.breaks}</b><small>focus / breaks</small></div>
      </div>
      ${things.length ? `<div class="bars">${things.map(([n, t]) => `
        <div class="bar"><span class="grow">${esc(n)} <small>${esc(t.app)}</small></span><i style="--w:${Math.round((t.s / max) * 100)}%"></i><b>${fmtDur(t.s)}</b></div>`).join("")}</div>`
        : `<p class="muted">No named projects, documents or sites yet.</p>`}
    </section>
    <section class="card">
      <h3>${icon("note")} Standup notes</h3>
      <textarea id="sup" rows="8" spellcheck="false">${esc(standup(d, isToday ? "Today so far" : label))}</textarea>
      <div class="row-btns"><button class="btn primary" id="scopy">${icon("copy")} Copy</button></div>
    </section>
    ${privacyCard(A, d.day)}`;

  const svg = comicSvg(d, { name: S.userName, isToday, shift: { start: S.keep.startMin, end: S.keep.endMin } });
  $("#comic").innerHTML = svg;
  $("#dprev").onclick = () => { dayIdx++; day(); };
  $("#dnext").onclick = () => { dayIdx--; day(); };
  $("#csave").onclick = async () => {
    try {
      const bytes = await comicPng(svg);
      const path = await invoke<string>("save_png", { name: `deskbud-${d.day}`, bytes: Array.from(bytes) });
      toast("Saved to Pictures › Deskbud");
      lastSaved = path;
    } catch (e) { console.error(e); toast("Couldn't save the image"); }
  };
  $("#copen").onclick = () => invoke("shell_open", { target: lastSaved ? lastSaved.replace(/[\\/][^\\/]+$/, "") : "shell:My Pictures" });
  $("#scopy").onclick = () => invoke("clip_set", { text: $<HTMLTextAreaElement>("#sup").value }).then(() => toast("Copied — paste it in your standup"));
  bindPrivacy(d.day);
}
let lastSaved = "";

function privacyCard(A: Settings["activity"], dayKey?: string) {
  return `
    <section class="card">
      <h3>${icon("eyeOff")} Privacy</h3>
      <div class="setting"><span class="grow">Activity diary<small>Stays on this PC. Keeps only project, document and site names plus time spent — never window contents. Private/incognito windows are skipped.</small></span><label class="switch"><input type="checkbox" id="aon" ${A.on ? "checked" : ""}><i></i></label></div>
      <div class="setting"><span class="grow">Never log windows containing<small>Comma separated, e.g. a client name or "salary"</small></span></div>
      <input id="aig" class="full" placeholder="optional" value="${esc(A.ignore.join(", "))}">
      <div class="row-btns">
        ${dayKey ? `<button class="btn" id="aforget">${icon("trash")} Forget this day</button>` : ""}
        <button class="btn danger" id="aclear">${icon("trash")} Clear everything</button>
      </div>
    </section>`;
}

function bindPrivacy(dayKey?: string) {
  $<HTMLInputElement>("#aon").onchange = (e) => { S.activity.on = (e.target as HTMLInputElement).checked; save(); toast(S.activity.on ? "Diary on" : "Diary paused"); };
  $<HTMLInputElement>("#aig").onchange = (e) => {
    S.activity.ignore = (e.target as HTMLInputElement).value.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 30);
    save(); toast("Saved");
  };
  const forget = async (k: string | null) => {
    await new Promise<void>((res) => {
      let done = false;
      listen("activity-flushed", () => { if (!done) { done = true; res(); } }).then((u) => cleanup.push(u));
      emit("activity-forget", k);
      setTimeout(() => { if (!done) { done = true; res(); } }, 800);
    });
    toast(k ? "Forgotten" : "Diary cleared");
    dayIdx = 0; day();
  };
  const f = document.getElementById("aforget");
  if (f && dayKey) f.onclick = () => forget(dayKey);
  const c = $("#aclear");
  c.onclick = () => {
    if (c.dataset.sure) return forget(null);
    c.dataset.sure = "1"; c.innerHTML = `${icon("trash")} Really clear all?`;
    setTimeout(() => { delete c.dataset.sure; c.innerHTML = `${icon("trash")} Clear everything`; }, 3000);
  };
}

// ------------------------------------------------------------------ News (Hacker News)

function news() {
  const N = S.news;
  const FEEDS: [Feed, string][] = [["top", "Top"], ["best", "Best"], ["new", "New"], ["show", "Show"], ["ask", "Ask"]];
  const open = (u: string) => invoke("shell_open", { target: u }).catch(() => toast("Couldn't open that"));
  view.innerHTML = `
    <div class="news-bar">
      <span class="seg">${FEEDS.map(([f, l]) => `<button class="segb ${N.feed === f ? "on" : ""}" data-feed="${f}">${l}</button>`).join("")}</span>
      <button class="mini" id="nrf" title="Refresh">${icon("refresh")}</button>
    </div>
    <ol class="stories" id="stories"><li class="muted">Loading Hacker News…</li></ol>
    <section class="card">
      <h3>${icon("news")} Buddy news alerts</h3>
      <div class="setting"><span class="grow">Share Hacker News stories<small>Every 20–40 min: a big story if there is one, otherwise a random good read. Only within your mode's bubble budget.</small></span><label class="switch"><input type="checkbox" id="non" ${N.on ? "checked" : ""}><i></i></label></div>
      <div class="setting"><span class="grow">"Big" means at least</span>
        <select id="nms">${[100, 200, 300, 400, 600, 1000].map((v) => `<option value="${v}" ${N.minScore === v ? "selected" : ""}>${v} points</option>`).join("")}</select></div>
      <div class="setting"><span class="grow">My interests<small>Stories mentioning these get through sooner (from ~60 points). Comma separated.</small></span></div>
      <input id="nkw" class="full" placeholder="e.g. rust, tauri, claude, windows" value="${esc(N.keywords.join(", "))}">
    </section>`;
  const list = $("#stories");
  const load = async (fresh = false) => {
    list.innerHTML = `<li class="muted">Loading Hacker News…</li>`;
    let items: Story[] = [];
    try { items = await fetchNews(S.news.feed, 30, fresh); } catch { /* offline */ }
    if (!items.length) { list.innerHTML = `<li class="muted">Couldn't reach Hacker News. Check your connection and hit refresh.</li>`; return; }
    list.innerHTML = items.map((st, i) => {
      const kw = matches(st.title, S.news.keywords);
      return `<li class="story ${kw ? "hot" : ""}">
        <span class="rank">${i + 1}</span>
        <div class="grow">
          <a data-u="${esc(st.url)}">${esc(st.title)}</a>${st.domain ? ` <small class="dom">${esc(st.domain)}</small>` : ""}
          <div class="meta">${icon("arrowUp")}${st.score} · <a data-u="${esc(hnThread(st.id))}">${icon("chat")}${st.comments}</a> · ${ago(st.time)} · ${esc(st.by)}${kw ? ` · <b class="tag">${esc(kw)}</b>` : ""}</div>
        </div></li>`;
    }).join("");
    list.querySelectorAll<HTMLElement>("[data-u]").forEach((a) => (a.onclick = () => open(a.dataset.u!)));
  };
  $$("[data-feed]").forEach((b) => (b.onclick = () => {
    S.news.feed = b.dataset.feed as Feed; save();
    $$("[data-feed]").forEach((x) => x.classList.toggle("on", x === b));
    load();
  }));
  $("#nrf").onclick = () => load(true);
  $<HTMLInputElement>("#non").onchange = (e) => { S.news.on = (e.target as HTMLInputElement).checked; save(); };
  $<HTMLSelectElement>("#nms").onchange = (e) => { S.news.minScore = +(e.target as HTMLSelectElement).value; save(); };
  $<HTMLInputElement>("#nkw").onchange = (e) => {
    S.news.keywords = (e.target as HTMLInputElement).value.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 20);
    save(); load(); toast("Interests saved");
  };
  load();
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
        <span class="ico">${icon(it.kind === "web" ? "search" : it.kind === "open" ? "external" : iconFor(it.target))}</span>
        <span class="grow"><b>${esc(it.name)}</b><small>${esc(it.target)}</small></span>
        ${it.kind === "pin" ? `<button class="mini" data-unpin="${it.i}" title="Unpin">${icon("x")}</button>` : `<kbd>${icon("enter")}</kbd>`}
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
    if (ok) win.close(); else toast("Couldn't open that");
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
  if (/^https?:/i.test(t)) return "globe";
  if (/^ms-settings:/i.test(t)) return "gear";
  if (/^msteams:/i.test(t)) return "chat";
  if (/^shell:|\\$|^[a-z]:\\[^.]*$/i.test(t)) return "folder";
  if (/calc/i.test(t)) return "calculator";
  if (/notepad/i.test(t)) return "note";
  if (/screenclip/i.test(t)) return "camera";
  return "zap";
}

// ------------------------------------------------------------------ Settings

async function settings() {
  const K = S.keep;
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const tm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  let auto = false;
  try { auto = await autoIs(); } catch { /* dev mode */ }
  const ccOn = await invoke<boolean>("claude_hooks_status").catch(() => false);
  const mem = await loadMemory();
  const mv = mem.mood.v, me = mem.mood.e;
  const [mIc, mTxt] = me < 0.3 ? ["faceSleep", "Sleepy"] : mv > 0.7 ? ["faceHappy", "Delighted"] : mv > 0.35 ? ["faceSmile", "Happy"] : mv > 0.05 ? ["faceCalm", "Content"] : mv > -0.25 ? ["faceMeh", "A bit bored"] : ["faceSad", "Missing you"];
  const moodLabel = `${icon(mIc)} ${mTxt}`;
  const lunch = mem.lunchMin == null ? "still learning" : `${String(Math.floor(mem.lunchMin / 60)).padStart(2, "0")}:${String(mem.lunchMin % 60).padStart(2, "0")}`;
  const mutedN = Object.keys(mem.muted).length;
  const bday = S.birthday && /^\d{2}-\d{2}$/.test(S.birthday) ? `${new Date().getFullYear()}-${S.birthday}` : "";
  view.innerHTML = `
    <section class="card buddy-card">
      <h3>${icon("user")} You & your buddy</h3>
      <div class="stats">
        <div><b>${moodLabel}</b><small>mood</small></div>
        <div><b>${Math.max(1, mem.daysTogether)}</b><small>days together</small></div>
        <div><b>${lunch}</b><small>your usual lunch</small></div>
      </div>
      <div class="setting"><span class="grow">My work hours<small>Your buddy's whole day follows these: coffee at the start, meal break mid-shift, wrap-up, comic and standup notes. Keep-alive uses them too.</small></span>
        <span class="row gap"><input type="time" id="ks" value="${tm(K.startMin)}"> – <input type="time" id="kn" value="${tm(K.endMin)}"></span></div>
      <div class="setting"><span class="grow">Your name<small>Used in greetings. Stays on this PC.</small></span><input id="un" placeholder="optional" value="${esc(S.userName)}" style="width:150px"></div>
      <div class="setting"><span class="grow">Birthday<small>Expect a party</small></span><input type="date" id="bd" value="${bday}"></div>
      <div class="setting"><span class="grow">Mode</span>
        <span class="seg">${(["work", "chill", "quiet"] as const).map((m) => `<button class="segb ${S.mode === m ? "on" : ""}" data-mode="${m}">${m === "work" ? icon("briefcase") + " Work" : m === "chill" ? icon("sparkles") + " Chill" : icon("mute") + " Quiet"}</button>`).join("")}</span></div>
      <p class="muted">Work: calm, stays on the taskbar, at most 2 unprompted bubbles an hour. Chill: full personality, climbs windows, up to 5. Quiet: sits still and stays silent (meetings and keep-alive still work).</p>
      ${mutedN ? `<div class="setting"><span class="grow">Muted suggestions<small>${mutedN} kind${mutedN > 1 ? "s" : ""} of suggestion you waved away twice</small></span><button class="btn" id="unmute">Unmute all</button></div>` : ""}
    </section>

    <section class="card">
      <h3><span class="live"></span> Keep Teams green</h3>
      <div class="setting"><span class="grow">Keep me Available while I step away<small>Your buddy nudges the mouse (1 px) + taps an invisible F15 key before Teams marks you Away.</small></span><label class="switch"><input type="checkbox" id="ke" ${K.enabled ? "checked" : ""}><i></i></label></div>
      <div class="setting"><span class="grow">Nudge after being idle for</span>
        <select id="kt">${[60, 120, 180, 210, 240].map((s) => `<option value="${s}" ${K.thresholdS === s ? "selected" : ""}>${s < 120 ? s + " s" : s / 60 + " min"}</option>`).join("")}</select></div>
      <div class="setting"><span class="grow">Only during work hours</span><label class="switch"><input type="checkbox" id="kw" ${K.workHoursOnly ? "checked" : ""}><i></i></label></div>
      <div class="setting sub ${K.workHoursOnly ? "" : "dim"}"><span class="grow muted">${tm(K.startMin)}–${tm(K.endMin)} (set above)</span>
        <span class="days">${days.map((d, i) => `<button class="day ${K.days[i] ? "on" : ""}" data-d="${i}">${d}</button>`).join("")}</span></div>
      <div class="setting"><span class="grow">Pause while I'm in a call<small>Detected when any app is using your microphone.</small></span><label class="switch"><input type="checkbox" id="kc" ${K.pauseInCall ? "checked" : ""}><i></i></label></div>
    </section>

    <section class="card">
      <h3>${icon("palette")} Look & personality</h3>
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
      <h3>${icon("laptop")} Claude Code</h3>
      <div class="setting"><span class="grow">Tell me when Claude finishes or needs me<small>Only for tasks longer than about 25 s, and not while you're already in your terminal or editor. This adds three small hooks to ~/.claude/settings.json (a backup is kept).</small></span><label class="switch"><input type="checkbox" id="cch" ${ccOn ? "checked" : ""}><i></i></label></div>
      <p class="muted" id="cchMsg"></p>
    </section>

    <section class="card">
      <h3>${icon("hand")} Play with me</h3>
      <div class="setting"><span class="grow">Cursor games<small>Wiggle the cursor near him and he chases it; rest it above his head and he jumps for it; high fives when you come back.</small></span><label class="switch"><input type="checkbox" id="pcur" ${S.play.cursor ? "checked" : ""}><i></i></label></div>
      <div class="setting"><span class="grow">Type along with me<small>He types on his little laptop in rhythm with you. Only counts keystrokes, never which keys, and nothing is stored.</small></span><label class="switch"><input type="checkbox" id="ptyp" ${S.play.typing ? "checked" : ""}><i></i></label></div>
      <p class="muted">Also try: click his hair, glasses, nose, tummy or feet · drop a file, folder, link or text on him.</p>
    </section>

    <section class="card">
      <h3>${icon("cloud")} Weather</h3>
      <div class="row gap"><input id="wc" class="grow" placeholder="Your city" value="${esc(S.weather.city)}"><select id="wu"><option value="c" ${S.weather.unit === "c" ? "selected" : ""}>°C</option><option value="f" ${S.weather.unit === "f" ? "selected" : ""}>°F</option></select><button class="btn" id="wf">Set</button></div>
      <p class="muted">Uses Open-Meteo (free, no account). Only the city name / coordinates are sent.</p>
    </section>

    <section class="card">
      <h3>${icon("monitor")} App</h3>
      <div class="setting"><span class="grow">Start with Windows</span><label class="switch"><input type="checkbox" id="as" ${auto ? "checked" : ""}><i></i></label></div>
      <div class="setting"><span class="grow">Check for updates<small>About twice a day, asks GitHub whether a newer version exists. Nothing is downloaded until you click Download.</small></span><label class="switch"><input type="checkbox" id="upd" ${S.updates.check ? "checked" : ""}><i></i></label></div>
      <div class="row gap"><button class="btn" id="summon">Bring buddy here</button><button class="btn" id="openlab">${icon("film")} Animation lab</button><span class="grow"></span><button class="btn danger" id="quit">Quit Deskbud</button></div>
    </section>`;

  $("#openlab").onclick = () => show("lab");
  $<HTMLInputElement>("#un").onchange = (e) => { S.userName = (e.target as HTMLInputElement).value.trim().slice(0, 30); save(); toast("Nice to meet you!"); };
  $<HTMLInputElement>("#bd").onchange = (e) => { const v = (e.target as HTMLInputElement).value; S.birthday = v ? v.slice(5) : ""; save(); };
  $$(".segb").forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode as Settings["mode"]; S.shhUntil = 0; $$(".segb").forEach((x) => x.classList.toggle("on", x === b)); save(); }));
  const um = document.getElementById("unmute");
  if (um) um.onclick = async () => { const m = await loadMemory(); m.muted = {}; m.dismissed = {}; await saveMemory(m); toast("All suggestions unmuted"); settings(); };
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
  $<HTMLInputElement>("#cch").onchange = async (e) => {
    const el = e.target as HTMLInputElement, msg = $("#cchMsg");
    try {
      el.checked = await invoke<boolean>("claude_hooks_set", { on: el.checked });
      msg.textContent = el.checked ? "Connected. Takes effect in new Claude Code sessions." : "Disconnected.";
    } catch (err) { el.checked = !el.checked; msg.textContent = String(err); }
  };
  chk("#pcur", (v) => (S.play.cursor = v));
  chk("#ptyp", (v) => (S.play.typing = v));
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
  chk("#upd", (v) => (S.updates.check = v));
  $("#summon").onclick = () => emit("tray", "summon");
  $("#quit").onclick = () => invoke("quit");
}

// ------------------------------------------------------------------ Animation lab

function labTab() {
  const groups: [string, [string, string, string, unknown?][]][] = [
    ["Moves", [["walk", "walk", "Walk"], ["__throw", "throw", "Throw"], ["__climb", "mountain", "Climb window"], ["__screen", "monitor", "Other screen"], ["peek", "eye", "Peek"], ["turn", "turn", "Turn"], ["lookAround", "search", "Look around"], ["dizzy", "star", "Dizzy"]]],
    ["Play", [["boing", "sparkles", "Hair boing"], ["fixGlasses", "glasses", "Glasses"], ["boop", "heart", "Boop"], ["tickle", "faceHappy", "Tickle"], ["hop", "arrowUp", "Hop"], ["grumpy", "faceMeh", "Grumpy", { text: "Hey! Enough poking" }], ["pounce", "pointer", "Pounce", { x: 0 }], ["pant", "faceSmile", "Pant"], ["eager", "hand", "Eager"], ["typeAlong", "laptop", "Type along"]]],
    ["Feelings", [["wave", "hand", "Wave", { text: "Hello!" }], ["celebrate", "party", "Celebrate", { text: "Woohoo!", hat: true }], ["pet", "heart", "Pet"], ["poke", "pointer", "Poke"], ["yawn", "moon", "Yawn"], ["stretch", "stretch", "Stretch"], ["sleep", "zzz", "Sleep", { sitting: true }], ["wakeUp", "clock", "Wake"], ["shh", "mute", "Shh"], ["think", "bulb", "Think"]]],
    ["Hobbies", [["read", "book", "Read"], ["juggle", "juggle", "Juggle"], ["music", "headphones", "Music"], ["doodle", "pencil", "Doodle"], ["yoyo", "yoyo", "Yo-yo"], ["coffee", "coffee", "Coffee"], ["magic", "wand", "Magic"], ["news", "news", "Newspaper"], ["__news", "news", "HN headlines"], ["holdPhone", "phone", "Phone", { text: "Scrolling…" }]]],
    ["Work", [["__nudge", "dot", "Keep-alive nudge"], ["focus", "laptop", "Focus"], ["breakTime", "leaf", "Break"], ["drink", "droplet", "Water"], ["eyeBreak", "glasses", "Eye break", { secs: 6 }], ["posture", "chair", "Posture"], ["holdSign", "sign", "Sign", { text: "Standup!" }], ["holdNote", "note", "Note", { text: "Buy milk" }]]],
    ["System", [["sweaty", "thermo", "High CPU", { cpu: 93 }], ["heavyBox", "box", "High RAM", { mem: 94 }], ["lowBattery", "batteryLow", "Low battery", { pct: 12 }], ["charging", "charging", "Charging"], ["camera", "camera", "Camera"], ["catchPaper", "paper", "Clipboard", { text: "copied text" }], ["__weather", "cloud", "Weather"], ["weather", "rain", "Rain", { kind: "rain", text: "Rainy!" }], ["weather", "snow", "Snow", { kind: "snow", text: "Snow!" }], ["weather", "sun", "Sunny", { kind: "sun", text: "Sunny!" }]]],
  ];
  view.innerHTML = workCard() + `<p class="muted">Tap any animation to see your buddy perform it.</p>` + groups.map(([g, list]) => `
    <section class="card"><h3>${g}</h3><div class="labgrid">
      ${list.map(([a, ic, l, args], i) => `<button class="chip" data-a="${a}" data-args='${args ? esc(JSON.stringify(args)) : ""}' data-i="${i}">${icon(ic)}${l}</button>`).join("")}
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
  watchWork();
}

// ------------------------------------------------------------------ work state (live, for tuning)

const WS_LABEL: Record<string, string> = {
  deep: "Deep focus", working: "Working", reading: "Reading", stuck: "Stuck", between: "Between tasks",
  windingDown: "Winding down", idle: "Paused", away: "Away", call: "In a call",
};

function workCard() {
  return `<section class="card" id="ws"><h3><span class="live"></span>What I think you're doing</h3>
    <div class="ws-now"><b id="ws-state">…</b><span id="ws-for" class="muted"></span></div>
    <div class="ws-meter" title="How OK it is to interrupt you"><i id="ws-score"></i></div>
    <p class="muted" id="ws-why">Waiting for the buddy…</p>
    <div class="stats" id="ws-f"></div>
    <div class="row gap"><b class="grow" style="font-size:12px">Recent changes</b><button class="mini" id="ws-copy">${icon("clipboard")} Copy log</button></div>
    <ol class="ws-log" id="ws-log"></ol>
  </section>`;
}

function watchWork() {
  const ping = () => emit("workstate-watch").catch(() => {});
  ping();
  const hb = window.setInterval(ping, 2000);
  const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
  const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let lastLog: { t: number; from: string; to: string; why: string }[] = [];
  const un = listen<any>("workstate", (e) => {
    const w = e.payload, f = w.f;
    if (!$("#ws")) return;
    $("#ws-state").textContent = WS_LABEL[w.state] ?? w.state;
    $("#ws-for").textContent = ` for ${ago(w.since)}`;
    const sc = $("#ws-score"); sc.style.width = `${Math.round(w.score * 100)}%`; sc.dataset.lvl = w.score >= 0.6 ? "hi" : w.score >= 0.3 ? "mid" : "lo";
    $("#ws-why").textContent = `${w.why}${w.anchor ? ` · on ${w.anchor.replace(/^[a-z]+:/, "")}` : ""}`;
    $("#ws-f").innerHTML = [
      [f.kpm5.toFixed(0), "keys/min"], [`${Math.round(f.corr5 * 100)}%`, "corrections"], [`${f.active10}/10`, "typing min"],
      [f.switches10, "switches"], [f.pingPong10, "help hops"], [`${Math.round(f.dwellMin)}m`, "on this"],
    ].map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join("");
    lastLog = w.log;
    $("#ws-log").innerHTML = w.log.slice().reverse().slice(0, 8)
      .map((l: any) => `<li><span>${hhmm(l.t)}</span> ${esc(WS_LABEL[l.to] ?? l.to)} <small>${esc(l.why)}</small></li>`).join("");
  });
  $("#ws-copy").onclick = () => {
    const txt = lastLog.map((l) => `${new Date(l.t).toISOString()}\t${l.from} -> ${l.to}\t${l.why}`).join("\n");
    navigator.clipboard.writeText(txt).then(() => toast("Log copied"), () => toast("Couldn't copy"));
  };
  cleanup.push(() => { clearInterval(hb); un.then((f) => f()); });
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
