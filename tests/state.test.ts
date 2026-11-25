// Replays synthetic days through the work-state tracker at the app's real event rates
// (keys every 250 ms, presence every 5 s, tick every 1 s — or slower, like a throttled window).
// Run: node --experimental-strip-types --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkStateTracker, isHelp, type StateOut } from "../src/buddy/state.ts";

const S = 1000, M = 60 * S;

interface Seg { kps?: number; corr?: number; mouse?: boolean; burst?: [number, number]; }

class Sim {
  t = Date.UTC(2026, 10, 24, 10, 0, 0);
  w = new WorkStateTracker();
  inCall = false; locked = false;
  lastInput = this.t;
  out!: StateOut;
  seen: StateOut[] = [];
  private acc = 0; private accC = 0;
  tickEvery: number; nowMin: number; shiftEnd: number | null;
  constructor(tickEvery = S, nowMin = 10 * 60, shiftEnd: number | null = 18 * 60) {
    this.tickEvery = tickEvery; this.nowMin = nowMin; this.shiftEnd = shiftEnd;
  }

  fg(cat: string, thing: string | null = null, help = false) { this.w.fg(cat, thing, help, this.t); }

  /** run for `ms`; kps keys/sec (bursty: [on s, off s]); corr = share of presses that are Backspace */
  run(ms: number, s: Seg = {}) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t += 250;
      const sec = Math.floor((this.t % (3600 * S)) / S);
      const on = !s.burst || sec % (s.burst[0] + s.burst[1]) < s.burst[0];
      if (s.kps && on) {
        this.acc += s.kps / 4; this.accC += (s.kps * (s.corr ?? 0)) / 4;
        const n = Math.floor(this.acc), c = Math.floor(this.accC);
        this.acc -= n; this.accC -= c;
        if (n || c) { this.w.keys(n, c, this.t); this.lastInput = this.t; }
      }
      if (s.mouse) this.lastInput = this.t;
      if (this.t % (5 * S) === 0) this.w.presence(this.t - this.lastInput, this.inCall, this.locked, this.t);
      if (this.t % this.tickEvery === 0) {
        this.nowMin += 0; // wall-clock minutes only matter for winding down; set explicitly there
        this.out = this.w.tick(this.t, this.nowMin + (this.t - Date.UTC(2026, 10, 24, 10, 0, 0)) / M, this.shiftEnd);
        this.seen.push(this.out);
      }
    }
    return this.out;
  }
  ever(st: string) { return this.seen.some((o) => o.state === st); }
  reset() { this.seen = []; }
}

const CODE: Seg = { kps: 4, burst: [20, 6], mouse: true };

for (const tick of [S, 5 * S]) {
  const tag = tick === S ? "1 Hz" : "0.2 Hz";

  test(`[${tag}] steady coding on one project becomes deep focus`, () => {
    const s = new Sim(tick);
    s.fg("code", "Deskbud");
    s.run(8 * M, CODE);
    assert.notEqual(s.out.state, "deep", "not deep before 10 min on it");
    s.run(4 * M, CODE);
    assert.equal(s.out.state, "deep");
    assert.ok(s.out.score <= 0.1, `score ${s.out.score}`);
  });

  test(`[${tag}] a 20 s glance at Teams doesn't break deep focus or count as a boundary`, () => {
    const s = new Sim(tick);
    s.fg("code", "Deskbud"); s.run(14 * M, CODE);
    assert.equal(s.out.state, "deep");
    const b0 = s.w.boundaries;
    s.fg("teams"); s.run(20 * S, { mouse: true });
    s.fg("code", "Deskbud"); s.run(2 * M, CODE);
    assert.equal(s.out.state, "deep");
    assert.equal(s.w.boundaries, b0);
  });

  test(`[${tag}] leaving a long stint for another project opens a "between" window`, () => {
    const s = new Sim(tick);
    s.fg("code", "Deskbud"); s.run(20 * M, CODE);
    s.reset();
    s.fg("code", "Website"); s.run(80 * S, { kps: 1, burst: [5, 10], mouse: true });
    const bs = s.seen.filter((o) => o.state === "between");
    assert.ok(bs.length, `states: ${[...new Set(s.seen.map((o) => o.state))]}`);
    assert.equal(bs[0].boundary, "project");
    // no flip-flopping while the switch is pending (deep → working → between, at most)
    const changes = s.seen.filter((o, i) => i > 0 && o.state !== s.seen[i - 1].state).length;
    assert.ok(changes <= 3, `${changes} changes: ${s.seen.map((o) => o.state).join(",")}`);
    // typing lowers the score, so look at the best moment in the window (a pause between bursts)
    assert.ok(Math.max(...bs.map((o) => o.score)) >= 0.6, `scores ${bs.map((o) => o.score.toFixed(2))}`);
    s.run(2 * M, { mouse: true });
    assert.notEqual(s.out.state, "between", "window closes after ~90 s");
  });

  test(`[${tag}] looking things up on Stack Overflow is not a task switch`, () => {
    const s = new Sim(tick);
    s.fg("code", "Deskbud"); s.run(20 * M, CODE);
    const b0 = s.w.boundaries;
    s.fg("browser", "Stack Overflow", true); s.run(3 * M, { mouse: true });
    s.fg("code", "Deskbud"); s.run(2 * M, CODE);
    assert.equal(s.w.boundaries, b0);
    assert.equal(s.out.anchor, "code:Deskbud");
  });

  test(`[${tag}] hopping to help sites while deleting a lot reads as stuck`, () => {
    const s = new Sim(tick);
    s.fg("code", "Deskbud"); s.run(3 * M, { kps: 3, burst: [10, 10], mouse: true });
    for (let i = 0; i < 5; i++) {
      s.fg("browser", "Stack Overflow", true); s.run(40 * S, { mouse: true });
      s.fg("code", "Deskbud"); s.run(80 * S, { kps: 3, corr: 0.3, burst: [8, 12], mouse: true });
    }
    assert.equal(s.out.state, "stuck", `why: ${s.out.why}`);
  });

  test(`[${tag}] mouse-only browsing is reading`, () => {
    const s = new Sim(tick);
    s.fg("browser", "GitHub: org/repo"); s.run(3 * M, { mouse: true });
    assert.equal(s.out.state, "reading");
  });

  test(`[${tag}] a call ending opens "between"`, () => {
    const s = new Sim(tick);
    s.fg("teams"); s.inCall = true; s.run(10 * M, { mouse: true });
    assert.equal(s.out.state, "call");
    assert.equal(s.out.score, 0);
    s.inCall = false; s.reset(); s.run(20 * S, { mouse: true });
    assert.equal(s.out.state, "between");
    assert.equal(s.out.boundary, "callEnd");
  });

  test(`[${tag}] away, then back, opens "between"`, () => {
    const s = new Sim(tick);
    s.fg("code", "Deskbud"); s.run(5 * M, CODE);
    s.run(7 * M, {}); // nothing at all
    assert.equal(s.out.state, "away");
    s.reset(); s.run(20 * S, { mouse: true });
    assert.equal(s.out.state, "between");
    assert.equal(s.out.boundary, "back");
  });

  test(`[${tag}] a long typing run that stops is a pause boundary`, () => {
    const s = new Sim(tick);
    s.fg("office", "Report.docx"); s.run(12 * M, { kps: 4, burst: [25, 5], mouse: true });
    s.reset(); s.run(60 * S, { mouse: true });
    const b = s.seen.find((o) => o.state === "between");
    assert.ok(b, `states: ${[...new Set(s.seen.map((o) => o.state))]}`);
    assert.equal(b!.boundary, "pause");
  });

  test(`[${tag}] near the end of the shift, mostly in Outlook = winding down`, () => {
    const s = new Sim(tick, 17 * 60 + 30, 18 * 60);
    s.fg("mail"); s.run(8 * M, { kps: 0.3, mouse: true });
    assert.equal(s.out.state, "windingDown");
  });

  test(`[${tag}] typing right now always lowers the score`, () => {
    const s = new Sim(tick);
    s.fg("browser", "GitHub: org/repo"); s.run(3 * M, { mouse: true });
    const calm = s.out.score;
    s.run(5 * S, { kps: 5, mouse: true }); // ≥ one tick even when throttled to 0.2 Hz
    assert.ok(s.out.score < calm, `${s.out.score} < ${calm}`);
  });
}

test("isHelp recognises help sites only in browsers / assistant apps", () => {
  assert.ok(isHelp("chrome.exe", "c# - How do I ... - Stack Overflow - Google Chrome"));
  assert.ok(isHelp("msedge.exe", "Array.prototype.map() - JavaScript | MDN — Microsoft Edge"));
  assert.ok(isHelp("claude.exe", "Claude"));
  assert.ok(!isHelp("code.exe", "stack overflow notes.md - Deskbud - Visual Studio Code"));
  assert.ok(!isHelp("chrome.exe", "YouTube - Google Chrome"));
});
