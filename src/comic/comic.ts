/// <reference types="vite/client" />
// "Your day as a comic": four panels drawn with the buddy's own rig, written from your activity diary.
// A hidden Buddy is driven frame-by-frame (no window, no loop) and frozen at a chosen moment of a real
// animation, then its SVG is placed into a panel. The result is a standalone SVG (and PNG for saving).
import { Buddy } from "../buddy/buddy";
import { registerCore } from "../buddy/anims/core";
import { registerLife } from "../buddy/anims/life";
import { registerWork } from "../buddy/anims/work";
import { CX, GROUND } from "../buddy/rig";
import { SKINS, type Settings } from "../shared/settings";
import { fmtDur, fmtMin, topApps, topThings, type DayLog } from "../services/activity";
import { sinceStart, shiftLen, mealWord, type Shift } from "../shared/shift";
import rigCss from "../style.css?raw";

export interface Scene {
  caption: string;
  action: string; args?: any; at: number;   // animation + moment (s) to freeze
  bg: "window" | "clock" | "night" | "desk" | "plain" | "sign";
  clock?: number;                           // minutes after midnight for the wall clock
  mood?: number;                            // valence for the face
}

const pick = <T,>(seed: number, xs: T[]) => xs[Math.abs(seed) % xs.length];
const short = (s: string, n = 22) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Turn a day into four scenes: arrival · the big thing · the middle of the day · the ending. */
export function scenes(d: DayLog, now = new Date(), isToday = true, shift: Shift = { start: 9 * 60, end: 18 * 60 }): Scene[] {
  const seed = [...d.day].reduce((a, c) => a + c.charCodeAt(0), 0);
  const dow = new Date(d.day + "T12:00:00").getDay();
  const out: Scene[] = [];

  // 1 — arrival
  const f = Math.max(0, d.first);
  out.push({
    caption: f < shift.start - 30 ? `Early bird! In at ${fmtMin(f)}.` : dow === 1 ? `Monday. ${fmtMin(f)}. Coffee first.` : pick(seed, [`${fmtMin(f)} — clocked in.`, `${fmtMin(f)}. Here we go!`, `${fmtMin(f)}. Coffee loading…`]),
    action: "coffee", at: 2.4, bg: "window", clock: f, mood: 0.5,
  });

  // 2 — the main thing
  const [top] = topThings(d, 1, 5 * 60);
  const [app] = topApps(d, 1);
  if (top) {
    const [name, t] = top;
    out.push(t.kind === "doc"
      ? { caption: `${fmtDur(t.s)} wrestling ${short(name)}`, action: "focus", args: { dur: 30 }, at: 3, bg: "desk" }
      : name === "YouTube"
        ? { caption: `"Research": ${fmtDur(t.s)} of YouTube`, action: "music", at: 2, bg: "plain" }
        : { caption: `${fmtDur(t.s)} on ${short(name)}`, action: "focus", args: { dur: 30 }, at: 3, bg: "desk" });
  } else if (app) {
    out.push({ caption: `${fmtDur(app[1])} in ${app[0]}`, action: "focus", args: { dur: 30 }, at: 3, bg: "desk" });
  } else {
    out.push({ caption: "Warming up…", action: "stretch", at: 1.6, bg: "plain" });
  }

  // 3 — the middle of the day
  const song = Object.entries(d.songs).sort((a, b) => b[1] - a[1])[0];
  if (d.callSec >= 2.5 * 3600) out.push({ caption: `${d.calls} calls. ${fmtDur(d.callSec)} of talking.`, action: "dizzy", at: 1.2, bg: "plain", mood: -0.1 });
  else if (d.callSec >= 20 * 60) out.push({ caption: `${d.calls || 1} call${d.calls > 1 ? "s" : ""}, ${fmtDur(d.callSec)} on mute (mostly)`, action: "holdPhone", args: { text: "" }, at: 1.6, bg: "plain" });
  else if (d.lunch != null) out.push({ caption: `${mealWord(d.lunch)} at ${fmtMin(d.lunch)}. Well earned.`, action: "holdSign", args: { text: mealWord(d.lunch) === "Meal break" ? "BREAK" : mealWord(d.lunch).toUpperCase() }, at: 1.4, bg: "sign", clock: d.lunch, mood: 0.7 });
  else if (d.focus >= 1) out.push({ caption: `${d.focus} focus session${d.focus > 1 ? "s" : ""}. In the zone.`, action: "music", at: 2, bg: "plain" });
  else if (d.breaks >= 2) out.push({ caption: `${d.breaks} breaks taken. Hydrated!`, action: "drink", at: 2.2, bg: "plain", mood: 0.6 });
  else if (song && song[1] >= 2) out.push({ caption: `On repeat: "${short(song[0], 18)}"`, action: "music", at: 2, bg: "plain" });
  else if (d.news >= 1) out.push({ caption: "Caught up on the news.", action: "news", at: 1.2, bg: "plain" });
  else out.push({ caption: pick(seed + 1, ["Thinking very hard.", "Big brain time.", "Hmm…"]), action: "think", at: 1.5, bg: "plain" });

  // 4 — the ending
  const L = shiftLen(shift) / 60;
  const last = Math.max(0, d.last);
  const lastSince = (last - shift.start) / 60;
  if (isToday && sinceStart(shift, now) < L - 1) out.push({ caption: "To be continued…", action: "wave", args: { text: "" }, at: 1.0, bg: "plain", mood: 0.5 });
  else if (lastSince >= L + 0.75) out.push({ caption: `Still here at ${fmtMin(last)}… go home!`, action: "yawn", at: 1.2, bg: "night", clock: last, mood: 0.1 });
  else if (d.active >= 6 * 3600) out.push({ caption: `${fmtDur(d.active)} at the desk. Done!`, action: "celebrate", args: { hat: true, text: "" }, at: 0.9, bg: "plain", mood: 0.9 });
  else out.push({ caption: `Logged off at ${fmtMin(last)}. Nice day.`, action: "wave", args: { text: "" }, at: 1.0, bg: "clock", clock: last, mood: 0.6 });
  return out;
}

// ------------------------------------------------------------------ rendering

let actor: Buddy | null = null;
function getActor(): Buddy {
  if (actor) return actor;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:280px;height:400px;pointer-events:none;opacity:0";
  document.body.appendChild(host);
  const b = new Buddy(host);
  registerCore(b); registerLife(b); registerWork(b);
  b.world.monitors = [{ bounds: { x: 0, y: 0, w: 1920, h: 1080 }, work: { x: 0, y: 0, w: 1920, h: 1040 }, scale: 1, primary: true }];
  return (actor = b);
}

/** Freeze the real animation at time `at` and return the rig's SVG markup. */
function pose(sc: Scene, k: number): string {
  const b = getActor();
  const bb: any = b;
  b.stop(); b.fx.clear();
  b.world.fx = 600; b.world.fy = 1040; b.world.surface = { kind: "floor" };
  b.facing = 1; bb.faceCur = 1;
  b.mood.v = sc.mood ?? 0.45; b.mood.e = 0.85; b.musicOn = false;
  b.setCursor(400, 300);
  const tick = (dt: number) => { b.time += dt; bb.tick(dt); };
  for (let i = 0; i < 20; i++) tick(1 / 30);
  b.play(sc.action, sc.args, { force: true });
  for (let t = 0; t < sc.at; t += 1 / 30) { bb.blinkT = -1; bb.blinkIn = 99; tick(1 / 30); } // never caught mid-blink
  return b.rig.svg.innerHTML.replace(/(rg\d+)_/g, `$1p${k}_`); // unique clip ids per panel
}

const RIG_CSS = rigCss.split("\n").filter((l) => l.startsWith(".rig ")).join("\n").replace(/\.rig /g, ".rg ");
const FONT = `"Segoe Print", "Comic Sans MS", "Segoe UI", cursive`;

function wrap(text: string, n: number) {
  const words = text.split(" "); const lines: string[] = []; let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function background(sc: Scene, w: number, h: number) {
  // stroke only: shapes that need a fill add their own (a duplicate fill="" breaks strict SVG parsing → PNG export)
  const S = `stroke="#161313" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
  const floor = `<path d="M10 ${h - 22} q${w / 2} -4 ${w - 20} 0" fill="none" ${S} opacity=".55"/>`;
  const clock = (cx: number, cy: number, min: number) => {
    const hh = ((min / 60) % 12) / 12 * Math.PI * 2, mm = (min % 60) / 60 * Math.PI * 2;
    return `<circle cx="${cx}" cy="${cy}" r="17" fill="#fff" ${S}/><path d="M${cx} ${cy} l${Math.sin(hh) * 8} ${-Math.cos(hh) * 8} M${cx} ${cy} l${Math.sin(mm) * 12} ${-Math.cos(mm) * 12}" fill="none" ${S}/>`;
  };
  switch (sc.bg) {
    case "window":
      return `<g transform="translate(${w - 78},74)"><rect width="56" height="62" rx="3" fill="#eaf4ff" ${S}/><path d="M28 0v62M0 31h56" fill="none" ${S}/><circle cx="40" cy="17" r="8" fill="#ffd34d" stroke="#161313" stroke-width="2"/></g>${sc.clock != null ? clock(w - 50, 170, sc.clock) : ""}${floor}`;
    case "clock": return `${clock(40, 172, sc.clock ?? 17 * 60)}${floor}`;
    case "night":
      return `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="8" fill="#2b2f4a" opacity=".16"/><g transform="translate(${w - 80},70)"><rect width="56" height="62" rx="3" fill="#2b2f4a" ${S}/><path d="M28 0v62M0 31h56" stroke="#fff" stroke-width="1.6" opacity=".5"/><path d="M40 10a9 9 0 1 0 6 14a7 7 0 0 1-6-14z" fill="#ffe9a8"/></g>${sc.clock != null ? clock(w - 50, 170, sc.clock) : ""}${floor}`;
    case "desk": return `<g transform="translate(${w - 52},${h - 62})" opacity=".85"><path d="M0 0h20l-3 18h-14z" fill="#fff" ${S}/><path d="M10 0c-8-10 6-14 0-24M10 0c6-8 14-6 12-16" fill="none" stroke="#3e9a52" stroke-width="2.4" stroke-linecap="round"/></g>${floor}`;
    case "sign": return `${sc.clock != null ? clock(40, 172, sc.clock) : ""}${floor}`;
    default: return floor;
  }
}

export interface ComicOpts { name?: string; skin?: Settings["skin"]; isToday?: boolean; now?: Date; shift?: Shift }

/** Build the whole strip as a standalone SVG string. */
export function comicSvg(d: DayLog, o: ComicOpts = {}): string {
  const sc = scenes(d, o.now ?? new Date(), o.isToday ?? true, o.shift);
  const PW = 260, PH = 232, G = 12, TOP = 54, W = PW * 2 + G * 3, H = TOP + PH * 2 + G * 2 + 34;
  const skin = Object.entries(SKINS[o.skin ?? "ink"]).map(([k, v]) => `${k}:${v}`).join(";");
  const date = new Date(d.day + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const title = `${o.name ? esc(o.name) + "'s" : "My"} day`;
  const panels = sc.map((s, i) => {
    const x = G + (i % 2) * (PW + G), y = TOP + Math.floor(i / 2) * (PH + G);
    const k = 0.62; // character scale inside a panel
    const tx = PW / 2 - CX * k + (s.bg === "window" || s.bg === "night" ? -30 : s.bg === "clock" || s.bg === "sign" ? 24 : 0);
    const ty = PH - 18 - GROUND * k;
    const lines = wrap(s.caption, 26);
    const capH = 12 + lines.length * 19;
    return `<g transform="translate(${x},${y})">
      <clipPath id="pc${i}"><rect width="${PW}" height="${PH}" rx="8"/></clipPath>
      <g clip-path="url(#pc${i})">
        <rect width="${PW}" height="${PH}" fill="#fffdf8"/>
        ${background(s, PW, PH)}
        <g class="rg" transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${k})">${pose(s, i)}</g>
      </g>
      <rect x="1.5" y="1.5" width="${PW - 3}" height="${PH - 3}" rx="8" fill="none" stroke="#161313" stroke-width="3"/>
      <g transform="translate(8,8)">
        <rect width="${Math.min(PW - 16, 18 + Math.max(...lines.map((l) => l.length)) * 8.6)}" height="${capH}" rx="4" fill="#fff4c2" stroke="#161313" stroke-width="2.2"/>
        ${lines.map((l, j) => `<text x="9" y="${20 + j * 19}" font-family='${FONT}' font-size="13.5" font-weight="700" fill="#161313">${esc(l)}</text>`).join("")}
      </g>
      <text x="${PW - 12}" y="${PH - 9}" text-anchor="end" font-family='${FONT}' font-size="11" fill="#161313" opacity=".5">${i + 1}</text>
    </g>`;
  }).join("");
  const stats = [`${fmtDur(d.active)} at the desk`, d.calls ? `${d.calls} call${d.calls > 1 ? "s" : ""}` : "", d.focus ? `${d.focus} focus` : "", d.breaks ? `${d.breaks} breaks` : ""].filter(Boolean).join("  ·  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="${skin}">
    <style>${RIG_CSS} .rg .shadow{fill:#000;opacity:.12}</style>
    <rect width="${W}" height="${H}" fill="#f4efe6"/>
    <text x="${G + 2}" y="36" font-family='${FONT}' font-size="24" font-weight="700" fill="#161313">${title}</text>
    <text x="${W - G - 2}" y="35" text-anchor="end" font-family='${FONT}' font-size="13" fill="#161313" opacity=".65">${esc(date)}</text>
    ${panels}
    <text x="${G + 2}" y="${H - 13}" font-family='${FONT}' font-size="11.5" fill="#161313" opacity=".7">${esc(stats)}</text>
    <text x="${W - G - 2}" y="${H - 13}" text-anchor="end" font-family='${FONT}' font-size="11.5" fill="#161313" opacity=".45">drawn by your Deskbud</text>
  </svg>`;
}

/** Rasterise the comic for saving/sharing (2× for crisp text). */
export async function comicPng(svg: string, scale = 2): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("render failed")); img.src = url; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth * scale; c.height = img.naturalHeight * scale;
    const g = c.getContext("2d")!;
    g.scale(scale, scale); g.drawImage(img, 0, 0);
    const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}
