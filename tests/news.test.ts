import { test } from "node:test";
import assert from "node:assert/strict";
import { pickStory, randomStory, type Story } from "../src/services/news.ts";

const now = Date.now() / 1000;
const st = (id: number, score: number, hoursAgo = 1): Story => ({ id, title: `Story ${id}`, url: "", score, comments: 0, by: "", time: now - hoursAgo * 3600, domain: "" });
const items = [st(1, 50), st(2, 120), st(3, 300), st(4, 900, 60)];
const cfg = { on: true, feed: "top" as const, minScore: 400, keywords: [] };

test("no big story → pickStory gives nothing, randomStory still finds a good read", () => {
  assert.equal(pickStory(items, {}, cfg), null);
  const ids = new Set(Array.from({ length: 50 }, (_, i) => randomStory(items, {}, () => i / 50)!.id));
  assert.deepEqual([...ids].sort(), [2, 3]); // not the 50-pointer, not the 60h-old one
});

test("randomStory skips stories already shown and returns null when exhausted", () => {
  assert.equal(randomStory(items, { 2: 1 }, () => 0)!.id, 3);
  assert.equal(randomStory(items, { 2: 1, 3: 1 }), null);
});
