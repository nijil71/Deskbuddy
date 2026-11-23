// What the buddy remembers about you, across restarts (stored locally in deskbud.json).
import { loadMemory, saveMemory, today, type Memory } from "../shared/settings";
import { pick } from "./pose";

const DAY = 86_400_000;

export class Remember {
  m!: Memory;
  private dirty = false;
  private timer = 0;

  async load() {
    this.m = await loadMemory();
    if (!this.m.firstMet) this.m.firstMet = Date.now();
    return this;
  }

  /** Persist soon (coalesces bursts of changes into one write). */
  save = () => {
    this.dirty = true;
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.dirty) { this.dirty = false; saveMemory(this.m).catch(() => {}); }
    }, 1500);
  };

  get isNew() { return this.m.daysTogether === 0; }

  /** Called on launch: count the day, return how long you've been apart (ms). */
  startSession(): number {
    const gap = this.m.lastSeen ? Date.now() - this.m.lastSeen : 0;
    this.touch();
    return gap;
  }

  /** Every minute while running. */
  touch() {
    const d = today();
    if (this.m.lastDay !== d) {
      this.m.daysTogether += 1;
      this.m.lastDay = d;
    }
    if (this.m.songsDay !== d) { this.m.songs = {}; this.m.songsDay = d; }
    this.m.lastSeen = Date.now();
    this.save();
  }

  interacted() { this.m.lastInteract = Date.now(); this.save(); }

  /** Greeting for when the app starts, based on how long we've been apart. */
  greeting(name: string, gapMs: number): string {
    const n = name ? ` ${name}` : "";
    const h = new Date().getHours();
    const tod = h < 12 ? "Good morning" : h < 18 ? "Hey" : "Good evening";
    const dow = new Date().getDay();
    if (gapMs <= 0) return `Hi${n}! I'm your desk buddy 👋`;
    if (gapMs < 2 * 3_600_000) return pick([`Back already${n}? 😄`, `Oh hi again${n}!`]);
    const days = Math.floor(gapMs / DAY);
    if (days >= 14) return `${tod}${n}! It's been ${days} days… I kept your desk warm 🥺`;
    if (days >= 2) return `${tod}${n}! You were gone ${days} days — I missed you!`;
    if (dow === 1 && h < 12) return `Morning${n}. Monday again… coffee first? ☕`;
    if (dow === 5) return `${tod}${n}! Happy Friday 🎉`;
    return pick([`${tod}${n}! 👋`, `${tod}${n}! Good to see you.`, `${tod}${n}! Ready for today?`]);
  }

  /** Once-per-key guard. scope "day" re-arms daily, "ever" fires once. */
  once(key: string, scope: "day" | "ever" = "day"): boolean {
    const stamp = scope === "day" ? today() : "ever";
    if (this.m.done[key] === stamp) return false;
    this.m.done[key] = stamp;
    this.save();
    return true;
  }

  /** Milestone due today? (7, 30, 100, 365 days together) */
  milestone(): number | null {
    for (const d of [7, 30, 100, 200, 365]) {
      if (this.m.daysTogether >= d && this.once(`milestone:${d}`, "ever")) return d;
    }
    return null;
  }

  isBirthday(birthday: string) {
    if (!/^\d{2}-\d{2}$/.test(birthday)) return false;
    const d = new Date();
    return birthday === `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Learn your usual lunch time from away-periods that start between 11:00 and 14:30. */
  learnLunch(awayStart: Date, awayMs: number) {
    const min = awayStart.getHours() * 60 + awayStart.getMinutes();
    if (min < 11 * 60 || min > 14.5 * 60 || awayMs < 20 * 60_000 || awayMs > 120 * 60_000) return false;
    const n = Math.min(this.m.lunchN, 9); // moving average that adapts over ~10 lunches
    this.m.lunchMin = this.m.lunchMin == null ? min : Math.round((this.m.lunchMin * n + min) / (n + 1));
    this.m.lunchN += 1;
    this.save();
    return true;
  }

  lunchLabel() {
    const m = this.m.lunchMin;
    return m == null ? null : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  /** Count a song play; returns plays today. */
  playedSong(title: string) {
    const k = title.slice(0, 80);
    this.m.songs[k] = (this.m.songs[k] ?? 0) + 1;
    const keys = Object.keys(this.m.songs);
    if (keys.length > 60) delete this.m.songs[keys[0]];
    this.save();
    return this.m.songs[k];
  }
}
