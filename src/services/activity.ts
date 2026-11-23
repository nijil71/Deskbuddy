// A private, on-device diary of your working day. It powers the standup notes and the daily comic.
// Only *derived* names are kept (project / document / site), never raw window titles, and
// nothing ever leaves this PC. Private-browsing windows and your ignore-words are skipped.
import { store, today } from "../shared/settings";

export interface Thing { s: number; app: string; kind: "project" | "doc" | "site" | "meeting" }
export interface DayLog {
  day: string;                          // YYYY-MM-DD
  first: number; last: number;          // minutes after midnight (first / last time at the desk)
  active: number;                       // seconds at the desk
  apps: Record<string, number>;         // friendly app name -> seconds
  things: Record<string, Thing>;        // project / doc / site -> seconds
  cats: Record<string, number>;         // code / office / browser / teams / … -> seconds
  calls: number; callSec: number;
  focus: number; breaks: number; nudges: number; pets: number; news: number;
  lunch: number | null;                 // minutes after midnight
  songs: Record<string, number>;
}

export const newDay = (day = today()): DayLog => ({
  day, first: -1, last: -1, active: 0, apps: {}, things: {}, cats: {}, calls: 0, callSec: 0,
  focus: 0, breaks: 0, nudges: 0, pets: 0, news: 0, lunch: null, songs: {},
});

export type Activity = Record<string, DayLog>;
const KEEP_DAYS = 21;

export async function loadActivity(): Promise<Activity> {
  return ((await (await store()).get<Activity>("activity")) ?? {}) as Activity;
}
export async function saveActivity(a: Activity) {
  const keys = Object.keys(a).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete a[k];
  const s = await store();
  await s.set("activity", a);
  await s.save();
}

// ------------------------------------------------------------------ naming

const APPS: Record<string, string> = {
  "code.exe": "VS Code", "cursor.exe": "Cursor", "devenv.exe": "Visual Studio", "idea64.exe": "IntelliJ",
  "pycharm64.exe": "PyCharm", "rider64.exe": "Rider", "webstorm64.exe": "WebStorm", "sublime_text.exe": "Sublime",
  "notepad++.exe": "Notepad++", "notepad.exe": "Notepad", "windowsterminal.exe": "Terminal", "wt.exe": "Terminal",
  "powershell.exe": "PowerShell", "pwsh.exe": "PowerShell", "cmd.exe": "Terminal",
  "msedge.exe": "Edge", "chrome.exe": "Chrome", "firefox.exe": "Firefox", "brave.exe": "Brave", "arc.exe": "Arc", "opera.exe": "Opera",
  "ms-teams.exe": "Teams", "teams.exe": "Teams", "slack.exe": "Slack", "discord.exe": "Discord", "zoom.exe": "Zoom",
  "olk.exe": "Outlook", "outlook.exe": "Outlook", "winword.exe": "Word", "excel.exe": "Excel", "powerpnt.exe": "PowerPoint",
  "onenote.exe": "OneNote", "explorer.exe": "File Explorer", "spotify.exe": "Spotify", "figma.exe": "Figma",
  "notion.exe": "Notion", "obsidian.exe": "Obsidian", "postman.exe": "Postman", "ssms.exe": "SQL Studio",
  "claude.exe": "Claude", "chatgpt.exe": "ChatGPT", "githubdesktop.exe": "GitHub Desktop",
};
export function appName(exe: string) {
  const e = exe.toLowerCase();
  return APPS[e] ?? (e.replace(/\.exe$/, "").replace(/^./, (c) => c.toUpperCase()) || "Something");
}

const SITES: [RegExp, string][] = [
  [/github/i, "GitHub"], [/gitlab/i, "GitLab"], [/azure devops|dev\.azure/i, "Azure DevOps"], [/jira/i, "Jira"],
  [/confluence/i, "Confluence"], [/stack ?overflow/i, "Stack Overflow"], [/youtube/i, "YouTube"], [/gmail/i, "Gmail"],
  [/outlook/i, "Outlook"], [/chatgpt/i, "ChatGPT"], [/claude/i, "Claude"], [/hacker news/i, "Hacker News"],
  [/linkedin/i, "LinkedIn"], [/figma/i, "Figma"], [/notion/i, "Notion"], [/google docs/i, "Google Docs"],
  [/google sheets/i, "Google Sheets"], [/reddit/i, "Reddit"], [/wikipedia/i, "Wikipedia"], [/sharepoint/i, "SharePoint"],
  [/microsoft learn|learn\.microsoft/i, "Microsoft Learn"], [/aws|amazon web services/i, "AWS"], [/azure portal|portal\.azure/i, "Azure Portal"],
];
const BROWSERS = /^(msedge|chrome|firefox|brave|arc|opera)\.exe$/i;
const PRIVATE = /inprivate|incognito|private browsing/i;

/** What you were working *on*: a project, a document or a site. Null = nothing worth naming. */
export function thingOf(exe: string, title: string, ignore: string[] = []): { name: string; kind: Thing["kind"] } | null {
  const e = exe.toLowerCase();
  const t = title.replace(/^[●•*]\s*/, "").trim();
  if (!t || PRIVATE.test(t)) return null;
  if (ignore.some((w) => w && t.toLowerCase().includes(w.toLowerCase()))) return null;
  const parts = t.split(/ [-–—|] /).map((s) => s.trim()).filter(Boolean);
  const clip = (s: string) => s.length > 40 ? s.slice(0, 39) + "…" : s;

  if (/^(code|cursor)\.exe$/.test(e)) {           // "file.ts - Project - Visual Studio Code"
    const p = parts.length >= 3 ? parts[parts.length - 2] : parts.length === 2 ? parts[0] : "";
    return p && !/visual studio code|cursor/i.test(p) ? { name: clip(p.replace(/ \(Workspace\)$/, "")), kind: "project" } : null;
  }
  if (e === "devenv.exe") return parts[0] ? { name: clip(parts[0]), kind: "project" } : null;
  if (/(idea|pycharm|rider|webstorm)64\.exe$/.test(e)) return parts[0] ? { name: clip(parts[0]), kind: "project" } : null;
  if (/^(winword|excel|powerpnt)\.exe$/.test(e)) {    // "Budget.xlsx - Excel"
    const d = parts[0]?.replace(/\s+(-\s+)?(saved|compatibility mode|read-only|autosaved).*$/i, "");
    return d && !/^(word|excel|powerpoint)$/i.test(d) ? { name: clip(d), kind: "doc" } : null;
  }
  if (BROWSERS.test(e)) {
    const hit = SITES.find(([re]) => re.test(t));
    if (!hit) return null;
    if (hit[1] === "GitHub") {
      const repo = t.match(/\b([\w.-]+\/[\w.-]+)\b/);
      if (repo && !/\.(com|org|io)$/.test(repo[1])) return { name: `GitHub: ${clip(repo[1])}`, kind: "site" };
    }
    return { name: hit[1], kind: "site" };
  }
  return null;
}

export function fmtDur(sec: number) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}`;
}
export const fmtMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

export function topThings(d: DayLog, n = 6, minSec = 8 * 60) {
  return Object.entries(d.things).filter(([, v]) => v.s >= minSec).sort((a, b) => b[1].s - a[1].s).slice(0, n);
}
export function topApps(d: DayLog, n = 4) {
  return Object.entries(d.apps).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Standup notes, ready to paste. */
export function standup(d: DayLog, label = "Yesterday") {
  const dt = new Date(d.day + "T12:00:00");
  const when = dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const lines = [`${label} (${when}):`];
  const things = topThings(d);
  for (const [name, v] of things) lines.push(`• ${name}${v.kind === "project" || v.kind === "doc" ? ` (${v.app})` : ""} — ${fmtDur(v.s)}`);
  if (!things.length) for (const [a, s] of topApps(d)) if (s >= 10 * 60) lines.push(`• ${a} — ${fmtDur(s)}`);
  if (d.callSec >= 5 * 60) lines.push(`• Calls & meetings — ${fmtDur(d.callSec)}${d.calls > 1 ? ` (${d.calls} calls)` : ""}`);
  if (d.focus) lines.push(`• ${d.focus} focus session${d.focus > 1 ? "s" : ""}`);
  lines.push("", "Today:", "• ", "", "Blockers: none");
  return lines.join("\n");
}

// ------------------------------------------------------------------ recorder (lives in the buddy window)

type Cat = string;
export class ActivityLog {
  all: Activity = {};
  private seg: { app: string; cat: Cat; thing: ReturnType<typeof thingOf> } | null = null;
  private lastTick = 0;
  private dirty = false;
  private wasInCall = false;
  on = true;
  ignore: string[] = [];

  async load() { try { this.all = await loadActivity(); } catch { this.all = {}; } }

  get day(): DayLog {
    const k = today();
    return (this.all[k] ??= newDay(k));
  }

  foreground(exe: string, title: string, cat: Cat) {
    this.credit();
    this.seg = { app: appName(exe), cat, thing: thingOf(exe, title, this.ignore) };
  }

  /** Every few seconds from the presence worker. Only time you're actually at the desk counts. */
  presence(idleMs: number, inCall: boolean, locked: boolean) {
    if (inCall && !this.wasInCall && this.on) { this.day.calls++; this.dirty = true; }
    this.wasInCall = inCall;
    this.credit(idleMs < 90_000 && !locked, inCall);
  }

  private credit(present = true, inCall = this.wasInCall) {
    const now = Date.now();
    const dt = this.lastTick ? Math.min(15, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    if (!this.on || !present || dt <= 0) return;
    const d = this.day;
    const m = new Date(); const min = m.getHours() * 60 + m.getMinutes();
    if (d.first < 0) d.first = min;
    d.last = min;
    d.active += dt;
    if (inCall) d.callSec += dt;
    const s = this.seg;
    if (s) {
      d.apps[s.app] = (d.apps[s.app] ?? 0) + dt;
      d.cats[s.cat] = (d.cats[s.cat] ?? 0) + dt;
      if (s.thing) {
        const t = (d.things[s.thing.name] ??= { s: 0, app: s.app, kind: s.thing.kind });
        t.s += dt;
      }
    }
    this.dirty = true;
  }

  count(k: "focus" | "breaks" | "nudges" | "pets" | "news") { if (this.on) { this.day[k]++; this.dirty = true; } }
  song(title: string) { if (this.on && title) { const s = this.day.songs; s[title] = (s[title] ?? 0) + 1; this.dirty = true; } }
  lunchAt(min: number) { if (this.on) { this.day.lunch = min; this.dirty = true; } }

  /** Most recent earlier day with real work in it (for "yesterday" — skips weekends/days off). */
  previous(minActive = 30 * 60): DayLog | null {
    const k = today();
    const days = Object.keys(this.all).filter((d) => d < k).sort().reverse();
    for (const d of days) if (this.all[d].active >= minActive) return this.all[d];
    return null;
  }

  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try { await saveActivity(this.all); } catch { this.dirty = true; }
  }

  forget(day?: string) {
    if (day) delete this.all[day]; else this.all = {};
    this.dirty = true;
  }
}
