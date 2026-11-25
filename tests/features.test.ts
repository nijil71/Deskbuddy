import { test } from "node:test";
import assert from "node:assert/strict";
import { isVideoLink } from "../src/shared/links.ts";
import { ClaudeWatcher, fmtDur, type ClaudeEvent } from "../src/services/claude.ts";

test("video links: single videos yes, channels/home pages/other sites no", () => {
  for (const u of ["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://www.youtube.com/shorts/abc",
    "https://vimeo.com/123", "https://x.com/someone/status/1", "https://www.instagram.com/reel/xyz/", "https://m.youtube.com/watch?v=a"])
    assert.ok(isVideoLink(u), u);
  for (const u of ["https://www.youtube.com/", "https://www.youtube.com/@channel", "https://example.com/video.mp4",
    "https://notyoutube.com/watch?v=1", "https://vimeo.com/", "not a url"])
    assert.ok(!isVideoLink(u), u);
});

const ev = (event: ClaudeEvent["event"], ts: number, message = "", session = "s1"): ClaudeEvent => ({ event, ts, message, session, project: "deskbud" });

test("claude: long task → done; short task → nothing", () => {
  const w = new ClaudeWatcher();
  w.handle(ev("prompt", 0));
  assert.equal(w.working, 1);
  assert.deepEqual(w.handle(ev("stop", 60_000)), { kind: "done", dur: 60_000 });
  assert.equal(w.working, 0);
  w.handle(ev("prompt", 100_000));
  assert.equal(w.handle(ev("stop", 105_000)), null, "5 s task: you saw it");
  // the real trace from your machine: 192 s and 167 s tasks must alert
  w.handle(ev("prompt", 200_000)); assert.deepEqual(w.handle(ev("stop", 392_000)), { kind: "done", dur: 192_000 });
});

test("claude: permission prompts alert; the idle reminder after a stop doesn't", () => {
  const w = new ClaudeWatcher();
  w.handle(ev("prompt", 0));
  assert.deepEqual(w.handle(ev("notify", 10_000, "Claude needs your permission to use Bash")), { kind: "needs" });
  w.handle(ev("stop", 60_000));
  assert.equal(w.handle(ev("notify", 120_000, "Claude is waiting for your input")), null);
  assert.deepEqual(w.handle(ev("notify", 120_000, "Claude is waiting for your input", "s2")), { kind: "needs" });
});

test("durations read nicely", () => {
  assert.equal(fmtDur(42_000), "42s");
  assert.equal(fmtDur(134_000), "2m 14s");
  assert.equal(fmtDur(3_900_000), "1h 5m");
});

import { WorkStateTracker } from "../src/buddy/state.ts";

test("work tracker: a restored snapshot carries on exactly; a stale one is ignored", () => {
  const a = new WorkStateTracker();
  let t = 1_000_000;
  a.fg("code", "deskbud", false, t);
  for (let i = 0; i < 2400; i++) { t += 250; a.keys(i % 3 ? 1 : 0, 0, t); if (i % 20 === 0) a.presence(0, false, false, t); if (i % 4 === 0) a.tick(t, 600, 1080); }
  const snap = JSON.parse(JSON.stringify(a.snapshot(t))); // through the store = through JSON
  const b = new WorkStateTracker();
  assert.ok(b.restore(snap, t + 5_000));
  for (let i = 0; i < 40; i++) {
    t += 1000; a.keys(2, 0, t + 5_000); b.keys(2, 0, t + 5_000);
    assert.deepEqual(b.tick(t + 5_000, 601, 1080), a.tick(t + 5_000, 601, 1080));
  }
  assert.equal(new WorkStateTracker().restore(snap, snap.at + 31 * 60_000), false, "older than 30 min");
});

import { monitorAt, neighbor, route, sameMon, type Mon } from "../src/buddy/screens.ts";

// Your real layout: 1920×1080 primary on the left, 1600×900 to its right, top-aligned.
const mon = (x: number, y: number, w: number, h: number, primary = false): Mon => ({ bounds: { x, y, w, h }, work: { x, y, w, h }, scale: 1, primary });
const A = mon(0, 0, 1920, 1080, true), B = mon(1920, 0, 1600, 900);

test("screens: side-by-side neighbours and walking routes", () => {
  assert.ok(sameMon(neighbor([A, B], A, 1), B));
  assert.equal(neighbor([A, B], A, -1), null);
  assert.ok(sameMon(neighbor([A, B], B, -1), A));
  assert.deepEqual(route([A, B], A), { kind: "walk", dir: 1, dest: B });
  assert.deepEqual(route([A, B], B, A), { kind: "walk", dir: -1, dest: A });
  assert.equal(route([A], A), null, "one screen: nowhere to go");
  assert.equal(route([A, B], A, A), null);
});

test("screens: stacked or gapped screens → hop instead of walk", () => {
  const top = mon(0, -1080, 1920, 1080);
  assert.deepEqual(route([A, top], A), { kind: "hop", dest: top });
  const far = mon(2500, 0, 1920, 1080); // gap between screens
  assert.equal(route([A, far], A)?.kind, "hop");
});

test("screens: feet just past the edge belong to the screen above them (floor steps up 180 px)", () => {
  // walking right along A's floor (y=1080): x=1925 is below B's bottom (900) — still B's column
  assert.ok(sameMon(monitorAt([A, B], 1925, 1075), B));
  assert.ok(sameMon(monitorAt([A, B], 1915, 1075), A));
  assert.ok(sameMon(monitorAt([A, B], 2500, 400), B));
});

test("update check: version comparison", async () => {
  const { isNewer, parseVersion } = await import("../src/shared/version.ts");
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("2.0"), [2, 0, 0]);
  assert.equal(parseVersion("nightly"), null);
  assert.ok(isNewer("v1.0.10", "1.0.9"));
  assert.ok(isNewer("2.0.0", "1.99.99"));
  assert.ok(!isNewer("1.0.3", "1.0.3"));
  assert.ok(!isNewer("1.0.2", "1.0.3"));
  assert.ok(!isNewer("garbage", "1.0.0"));
});
