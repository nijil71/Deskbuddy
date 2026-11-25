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

test("claude: long task while you're away → done; short task or watching → nothing", () => {
  const w = new ClaudeWatcher();
  w.handle(ev("prompt", 0), false);
  assert.equal(w.working, 1);
  assert.deepEqual(w.handle(ev("stop", 60_000), false), { kind: "done", dur: 60_000 });
  assert.equal(w.working, 0);
  w.handle(ev("prompt", 100_000), false);
  assert.equal(w.handle(ev("stop", 105_000), false), null, "5 s task: you saw it");
  w.handle(ev("prompt", 200_000), false);
  assert.equal(w.handle(ev("stop", 300_000), true), null, "you were in the terminal");
});

test("claude: permission prompts alert; the idle reminder after a stop doesn't", () => {
  const w = new ClaudeWatcher();
  w.handle(ev("prompt", 0), false);
  assert.deepEqual(w.handle(ev("notify", 10_000, "Claude needs your permission to use Bash"), false), { kind: "needs" });
  w.handle(ev("stop", 60_000), false);
  assert.equal(w.handle(ev("notify", 120_000, "Claude is waiting for your input"), false), null);
  assert.deepEqual(w.handle(ev("notify", 120_000, "Claude is waiting for your input", "s2"), false), { kind: "needs" });
});

test("durations read nicely", () => {
  assert.equal(fmtDur(42_000), "42s");
  assert.equal(fmtDur(134_000), "2m 14s");
  assert.equal(fmtDur(3_900_000), "1h 5m");
});
