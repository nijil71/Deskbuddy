// What you're doing *right now*, as one word — and how OK it is to interrupt you.
// Pure logic (no DOM / Tauri / imports) so it can be replayed headlessly from event traces.
//
// Inputs, at the rates the app already produces them:
//   keys(n, corr)  every 250 ms while typing (corr = Backspace/Delete presses)
//   fg(...)        on app / title changes (≈0.7 s polling)
//   presence(...)  every ≈5 s (idle time, call, lock)
//   focusBreak()   when the pomodoro reaches a break
//   tick(...)      ≈1 s: re-evaluate and return the current state
//
// The important output is the "between" state: a short window right after you finish one thing
// (left a project after a long stint, a call ended, you came back, a long typing run stopped).
// That's when interrupting costs least, so everything chatty should wait for it.

export type WorkState = "away" | "call" | "deep" | "stuck" | "working" | "reading" | "between" | "windingDown" | "idle";
export type Boundary = "project" | "callEnd" | "back" | "focusBreak" | "pause";

export interface Features {
  kpm5: number;        // keys per minute, last 5 min
  corr5: number;       // corrections / (keys + corrections), last 5 min
  active10: number;    // minutes (of the last 10) with real typing
  switches10: number;  // app / thing changes, last 10 min
  pingPong10: number;  // work → help-site hops, last 10 min
  dwellMin: number;    // minutes on the current anchor (project / doc / app)
  comms10: number;     // share of the last 10 min in mail / Teams
  idleSec: number;
  typingNow: boolean;
}

export interface StateOut {
  state: WorkState;
  since: number;       // ms epoch
  score: number;       // interruptibility 0 (don't you dare) … 1 (perfect moment)
  why: string;
  boundary: Boundary | null;  // set while in "between"
  anchor: string;
  f: Features;
}

export interface Transition { t: number; from: WorkState; to: WorkState; why: string; }

/** Serialized tracker (see WorkStateTracker.snapshot). Plain JSON. */
export interface TrackerSnap {
  v: 1; at: number;
  buckets: { t: number; k: number; c: number }[]; fgs: { t: number; key: string; cat: string; help: boolean }[];
  lastKeyT: number; idleMs: number; idleT: number; inCall: boolean; locked: boolean; wasAway: boolean;
  anchor: string; anchorSince: number; cand: string; candSince: number; runStart: number; runFired: boolean;
  boundary: Boundary | null; boundaryT: number; stuckLatch: boolean; deepLatch: boolean;
  cur: WorkState; curSince: number; log: Transition[]; totals: Partial<Record<WorkState, number>>; boundaries: number; lastTick: number;
}

/** Tunables. Exported so tests (and later, per-user tuning) can see them. */
export const T = {
  awayIdle: 5 * 60_000,
  idleIdle: 60_000,
  betweenMs: 90_000,
  betweenDiveKeys: 60,          // this many keys within 20 s (after 30 s) = you dove back in
  anchorConfirm: 60_000,        // a new thing must hold this long to become the anchor
  projectMinDwell: 15 * 60_000, // leaving something you worked on at least this long = boundary
  pauseRunMin: 10,              // a typing run of ≥ this many active minutes …
  pauseGap: 45_000,             // … that stops for this long = boundary
  activeMinKeys: 20,            // keys in a minute for it to count as a typing minute
  deepDwell: 10 * 60_000,
  deepActiveIn: 5, deepActiveOut: 3,
  deepSwitchIn: 5, deepSwitchOut: 8,
  stuckIn: 0.6, stuckOut: 0.35,
  windDownBefore: 45,           // minutes before shift end
  readingKeys60: 15,
};

const WORK = new Set(["code", "office", "terminal"]);
const COMMS = new Set(["mail", "teams"]);

/** Help-seeking: Q&A, docs, AI assistants, search. Title-based, browsers + desktop apps. */
export function isHelp(exe: string, title: string): boolean {
  if (/^(claude|chatgpt)\.exe$/i.test(exe)) return true;
  if (!/^(msedge|chrome|firefox|brave|arc|opera|vivaldi)\.exe$/i.test(exe)) return false;
  // NB: browser titles end in " - Google Chrome" / "— Microsoft Edge", so no bare "google" / "microsoft"
  return /stack ?overflow|stack exchange|super ?user|docs\.|documentation|api reference|microsoft learn|learn\.microsoft|\bmdn\b|chatgpt|claude|copilot|perplexity|google search|\bbing\b|duckduckgo|\bissue #|rust-lang\.org|docs\.rs|npmjs/i.test(title);
}

const MIN = 60_000;
const BUCKET = 5_000;
const KEEP = 15 * MIN;

interface Bucket { t: number; k: number; c: number; }
interface FgEv { t: number; key: string; cat: string; help: boolean; }

export class WorkStateTracker {
  private buckets: Bucket[] = [];
  private fgs: FgEv[] = [];
  private lastKeyT = -1e15;
  private idleMs = 0; private idleT = 0;
  private inCall = false; private locked = false;
  private wasAway = false;

  // anchor = the thing you're "on" (ignores short excursions and help sites)
  private anchor = ""; private anchorSince = 0;
  private cand = ""; private candSince = 0;

  // long typing run → pause boundary
  private runStart = -1; private runFired = false;

  private boundary: Boundary | null = null; private boundaryT = -1e15;
  private stuckLatch = false; private deepLatch = false;

  private cur: WorkState = "idle"; private curSince = 0;
  log: Transition[] = [];
  /** time spent in each state today-ish (caller resets); for the diary later */
  totals: Partial<Record<WorkState, number>> = {};
  boundaries = 0;
  private lastTick = 0;

  // ------------------------------------------------------------------ memory across restarts

  /** Everything the tracker knows, as plain JSON (saved so a restart/update doesn't forget it). */
  snapshot(t: number): TrackerSnap {
    return {
      v: 1, at: t,
      buckets: this.buckets, fgs: this.fgs.slice(-200), lastKeyT: this.lastKeyT, idleMs: this.idleMs, idleT: this.idleT,
      inCall: this.inCall, locked: this.locked, wasAway: this.wasAway,
      anchor: this.anchor, anchorSince: this.anchorSince, cand: this.cand, candSince: this.candSince,
      runStart: this.runStart, runFired: this.runFired, boundary: this.boundary, boundaryT: this.boundaryT,
      stuckLatch: this.stuckLatch, deepLatch: this.deepLatch, cur: this.cur, curSince: this.curSince,
      log: this.log.slice(-50), totals: this.totals, boundaries: this.boundaries, lastTick: this.lastTick,
    };
  }

  /** Pick up where a previous run left off, if that was recent (default: within 30 min). */
  restore(s: TrackerSnap | null | undefined, t: number, maxAgeMs = 30 * MIN): boolean {
    if (!s || s.v !== 1 || !(t - s.at >= 0 && t - s.at <= maxAgeMs)) return false;
    const { v: _v, at: _at, ...rest } = s;
    Object.assign(this, structuredClone(rest));
    return true;
  }

  // ------------------------------------------------------------------ inputs

  keys(n: number, corr: number, t: number) {
    const bt = t - (t % BUCKET);
    const last = this.buckets[this.buckets.length - 1];
    if (last && last.t === bt) { last.k += n; last.c += corr; } else this.buckets.push({ t: bt, k: n, c: corr });
    if (n > 0) { this.lastKeyT = t; this.idleMs = 0; this.idleT = t; }
  }

  /** cat = categorize(); thing = project/doc/site name or null; help = isHelp(). */
  fg(cat: string, thing: string | null, help: boolean, t: number) {
    const key = thing ? `${cat}:${thing}` : cat;
    const prev = this.fgs[this.fgs.length - 1];
    if (prev && prev.key === key) return;
    this.fgs.push({ t, key, cat, help });
    // anchor logic: help sites never become the anchor (looking something up isn't switching tasks)
    if (help || key === this.anchor) { this.cand = ""; return; }
    if (!this.anchor) { this.anchor = key; this.anchorSince = t; return; }
    this.cand = key; this.candSince = t;
  }

  presence(idleMs: number, inCall: boolean, locked: boolean, t: number) {
    if (this.inCall && !inCall) this.mark("callEnd", t);
    const away = locked || idleMs >= T.awayIdle;
    if (this.wasAway && !away) this.mark("back", t);
    this.wasAway = away;
    this.inCall = inCall; this.locked = locked;
    // trust the freshest of: OS idle time, or our own last keystroke
    if (t - this.lastKeyT > idleMs || this.idleT === 0) { this.idleMs = idleMs; this.idleT = t; }
  }

  focusBreak(t: number) { this.mark("focusBreak", t); }

  private mark(b: Boundary, t: number) {
    this.boundary = b; this.boundaryT = t; this.boundaries++;
    this.runStart = -1; // whatever you were typing belonged to the thing that just ended
  }

  // ------------------------------------------------------------------ features

  private sum(ms: number, t: number, f: (b: Bucket) => number) {
    let s = 0;
    for (let i = this.buckets.length - 1; i >= 0 && this.buckets[i].t > t - ms; i--) s += f(this.buckets[i]);
    return s;
  }

  private activeMinutes(mins: number, t: number) {
    const per = new Map<number, number>();
    for (let i = this.buckets.length - 1; i >= 0 && this.buckets[i].t > t - mins * MIN; i--) {
      const m = Math.floor((t - this.buckets[i].t) / MIN);
      per.set(m, (per.get(m) ?? 0) + this.buckets[i].k);
    }
    let n = 0;
    for (const v of per.values()) if (v >= T.activeMinKeys) n++;
    return n;
  }

  /** fg events within the window, plus the one already active when it started */
  private fgWindow(ms: number, t: number) {
    const from = t - ms;
    let i = this.fgs.length - 1;
    while (i > 0 && this.fgs[i].t > from) i--;
    return this.fgs.slice(Math.max(0, i));
  }

  private shareOf(cats: Set<string>, ms: number, t: number) {
    const w = this.fgWindow(ms, t);
    if (!w.length) return 0;
    let inside = 0;
    for (let i = 0; i < w.length; i++) {
      const a = Math.max(w[i].t, t - ms), b = i + 1 < w.length ? w[i + 1].t : t;
      if (b > a && cats.has(w[i].cat)) inside += b - a;
    }
    return inside / ms;
  }

  features(t: number): Features {
    const k5 = this.sum(5 * MIN, t, (b) => b.k), c5 = this.sum(5 * MIN, t, (b) => b.c);
    const w10 = this.fgWindow(10 * MIN, t);
    const inWin = w10.filter((e) => e.t > t - 10 * MIN);
    let pp = 0;
    for (let i = 1; i < w10.length; i++) if (w10[i].help && WORK.has(w10[i - 1].cat) && w10[i].t > t - 10 * MIN) pp++;
    const idle = this.idleMs + (t - this.idleT);
    return {
      kpm5: k5 / 5,
      corr5: k5 + c5 > 0 ? c5 / (k5 + c5) : 0,
      active10: this.activeMinutes(10, t),
      switches10: inWin.length,
      pingPong10: pp,
      dwellMin: this.anchor ? (t - this.anchorSince) / MIN : 0,
      comms10: this.shareOf(COMMS, 10 * MIN, t),
      idleSec: Math.max(0, idle) / 1000,
      typingNow: t - this.lastKeyT < 3000,
    };
  }

  // ------------------------------------------------------------------ evaluation

  /** nowMin: minutes after midnight; shiftEnd: minutes after midnight (null = unknown). */
  tick(t: number, nowMin: number, shiftEnd: number | null = null): StateOut {
    this.prune(t);

    // a candidate that held long enough becomes the new anchor; leaving a long stint = boundary
    if (this.cand && t - this.candSince >= T.anchorConfirm) {
      const stint = this.candSince - this.anchorSince;
      if (this.anchor && stint >= T.projectMinDwell) this.mark("project", this.candSince + T.anchorConfirm);
      this.anchor = this.cand; this.anchorSince = this.candSince; this.cand = "";
    }

    const f = this.features(t);

    // long typing run that stops → pause boundary
    const typingMinute = this.sum(MIN, t, (b) => b.k) >= T.activeMinKeys;
    if (typingMinute) { if (this.runStart < 0) { this.runStart = t; this.runFired = false; } }
    const gap = t - this.lastKeyT;
    const onHelp = !!this.fgs[this.fgs.length - 1]?.help; // stopped to look something up = still mid-task
    if (this.runStart >= 0 && gap >= T.pauseGap && !onHelp) {
      const runMin = (this.lastKeyT - this.runStart) / MIN;
      if (runMin >= T.pauseRunMin && !this.runFired && f.idleSec * 1000 < T.awayIdle) { this.mark("pause", t); this.runFired = true; }
      if (gap >= 2 * MIN) this.runStart = -1;
    }

    let state: WorkState, score: number, why: string;
    const sinceB = t - this.boundaryT;
    const dove = sinceB > 30_000 && this.sum(20_000, t, (b) => b.k) >= T.betweenDiveKeys;
    const away = this.locked || f.idleSec * 1000 >= T.awayIdle;

    // stuck evidence: hopping to help sites, lots of deleting, stop-start typing
    const ev = Math.min(1, f.pingPong10 / 3) * 0.6
      + (f.kpm5 >= 20 ? Math.min(1, f.corr5 / 0.2) * 0.4 : 0)
      + (f.active10 >= 2 && f.active10 <= 5 && f.switches10 >= 6 ? 0.15 : 0);
    this.stuckLatch = this.stuckLatch ? ev >= T.stuckOut : ev >= T.stuckIn;

    const deepIn = f.dwellMin * MIN >= T.deepDwell && f.active10 >= T.deepActiveIn && f.switches10 <= T.deepSwitchIn;
    const deepHold = f.active10 >= T.deepActiveOut && f.switches10 <= T.deepSwitchOut;
    // a quick glance elsewhere (< 30 s) doesn't break deep focus; staying away does (and blocks re-entry)
    const excursion = !!this.cand && t - this.candSince >= 30_000;
    this.deepLatch = !excursion && (this.deepLatch ? deepHold : deepIn);

    const nearEnd = shiftEnd != null && nowMin >= shiftEnd - T.windDownBefore && nowMin < shiftEnd + 120;

    if (away) { state = "away"; score = 0; why = this.locked ? "locked" : `idle ${Math.round(f.idleSec / 60)}m`; this.deepLatch = false; }
    else if (this.inCall) { state = "call"; score = 0; why = "mic in use"; }
    else if (this.boundary && sinceB < T.betweenMs && !dove) {
      state = "between"; score = 1 - 0.4 * (sinceB / T.betweenMs); why = `just finished (${this.boundary})`; this.deepLatch = false;
    }
    else if (this.deepLatch) { state = "deep"; score = 0.1; why = `${Math.round(f.dwellMin)}m on ${short(this.anchor)} · ${f.active10}/10 typing min · ${f.switches10} switches`; }
    else if (this.stuckLatch) { state = "stuck"; score = 0.35; why = `${f.pingPong10} help hops · ${(f.corr5 * 100) | 0}% corrections`; }
    else if (f.idleSec * 1000 >= T.idleIdle) { state = "idle"; score = 0.6; why = `no input ${Math.round(f.idleSec)}s`; }
    else if (nearEnd && (f.comms10 >= 0.5 || f.kpm5 < 15)) { state = "windingDown"; score = 0.7; why = `near shift end · ${(f.comms10 * 100) | 0}% mail/Teams`; }
    else if (this.sum(MIN, t, (b) => b.k) < T.readingKeys60) { state = "reading"; score = 0.55; why = "mouse, hardly typing"; }
    else { state = "working"; score = 0.45; why = `${f.kpm5.toFixed(0)} keys/min · ${f.switches10} switches`; }

    if (state !== "between" && this.boundary && sinceB >= T.betweenMs) this.boundary = null;
    if (f.typingNow && state !== "away" && state !== "call") score *= 0.4; // never mid-keystroke

    if (state !== this.cur) {
      this.log.push({ t, from: this.cur, to: state, why });
      if (this.log.length > 300) this.log.shift();
      this.cur = state; this.curSince = t;
    }
    if (this.lastTick) this.totals[state] = (this.totals[state] ?? 0) + Math.min(5000, t - this.lastTick);
    this.lastTick = t;

    return { state, since: this.curSince, score, why, boundary: state === "between" ? this.boundary : null, anchor: this.anchor, f };
  }

  get state() { return this.cur; }

  private prune(t: number) {
    while (this.buckets.length && this.buckets[0].t < t - KEEP) this.buckets.shift();
    // keep one fg event older than the window so shares know what was active at its start
    while (this.fgs.length > 1 && this.fgs[1].t < t - KEEP) this.fgs.shift();
  }
}

const short = (s: string) => { const x = s.replace(/^[a-z]+:/, ""); return x.length > 24 ? x.slice(0, 23) + "…" : x; };
