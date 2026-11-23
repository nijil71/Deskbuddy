// Decides whether the buddy may speak up on its own. Rules (from what made Clippy hated
// and what Desktop Goose users asked for):
//  • a budget of unprompted bubbles per hour, set by the mode (quiet 0 · work 2 · chill 5)
//  • only at natural breakpoints: never while you're typing or in a call
//  • a suggestion you wave away twice is muted for good
//  • "shh for 1 hour" silences everything that isn't a meeting
// Anything you trigger yourself (clicking, the menu) bypasses all of this.
import type { Overlay } from "../ui/overlay";
import type { SayOpts } from "./buddy";
import type { Memory, Settings } from "../shared/settings";

const BUDGET = { quiet: 0, work: 2, chill: 5 } as const;

interface Pending { key: string; text: string; opts: SayOpts; at: number; }

export class Voice {
  private sent: number[] = [];
  private pending: Pending[] = [];
  inCall = false;
  idleMs = 0;

  constructor(private ui: Overlay, public s: Settings, public mem: Memory, private save: () => void) {}

  get mode(): Settings["mode"] {
    if (this.s.dnd || Date.now() < this.s.shhUntil) return "quiet";
    return this.s.mode;
  }
  get shushed() { return Date.now() < this.s.shhUntil; }

  muted(key: string) { return !!this.mem.muted[key]; }

  /** Spend one unit of the hourly budget, if the rules allow speaking now. */
  allow(key: string): boolean {
    if (this.muted(key) || this.inCall) return false;
    const now = Date.now();
    this.sent = this.sent.filter((t) => now - t < 3_600_000);
    if (this.sent.length >= BUDGET[this.mode]) return false;
    this.sent.push(now);
    return true;
  }

  /** Is a non-verbal reaction OK (animation only)? Looser than allow(): no budget. */
  mayReact(key: string) {
    return this.mode !== "quiet" && !this.inCall && !this.muted(key);
  }

  /** Queue an unprompted line; it's spoken at the next natural pause (if still allowed). */
  auto(key: string, text: string, opts: SayOpts = {}) {
    if (this.mode === "quiet" || this.muted(key)) return;
    if (this.pending.some((p) => p.key === key)) return;
    this.pending.push({ key, text, opts, at: Date.now() });
    if (this.pending.length > 3) this.pending.shift();
    this.flush();
  }

  /** Called on every presence update (≈5s) and app switch: speak if it's a good moment. */
  flush() {
    const now = Date.now();
    this.pending = this.pending.filter((p) => now - p.at < 10 * 60_000); // stale chatter is dropped
    if (!this.pending.length || this.ui.bubbleVisible || this.inCall) return;
    // natural breakpoint: you've paused for a moment (not mid-typing) but are still around
    if (this.idleMs < 2500 || this.idleMs > 10 * 60_000) return;
    const p = this.pending[0];
    if (!this.allow(p.key)) {
      if (this.muted(p.key) || this.mode === "quiet") this.pending.shift();
      return;
    }
    this.pending.shift();
    this.say(p.key, p.text, p.opts);
  }

  /** Speak now (budget already handled by the caller), remembering which key is showing. */
  say(key: string, text: string, opts: SayOpts = {}) {
    this.ui.say(text, { ...opts, key });
  }

  /** You clicked a bubble away or chose "Not now". Twice → that kind of suggestion stops. */
  dismissed(key = this.ui.currentKey): boolean {
    if (!key || key.startsWith("!")) return false;
    const n = (this.mem.dismissed[key] ?? 0) + 1;
    this.mem.dismissed[key] = n;
    let mutedNow = false;
    if (n >= 2 && !this.mem.muted[key]) {
      this.mem.muted[key] = true;
      mutedNow = true;
    }
    this.save();
    return mutedNow;
  }

  /** You engaged with a suggestion (Done / clicked the button): reset its dismiss count. */
  engaged(key: string) {
    if (this.mem.dismissed[key]) { delete this.mem.dismissed[key]; this.save(); }
  }

  unmuteAll() { this.mem.muted = {}; this.mem.dismissed = {}; this.save(); }
}
