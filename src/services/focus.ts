// Pomodoro / focus timer. Owned by the buddy window; the panel controls it via events.
import { emit, listen } from "@tauri-apps/api/event";

export type Phase = "idle" | "work" | "short" | "long";
export interface FocusState { phase: Phase; endsAt: number; remaining: number; total: number; round: number; rounds: number; paused: boolean; }
export interface FocusCfg { work: number; short: number; long: number; rounds: number; }

export class Focus {
  s: FocusState = { phase: "idle", endsAt: 0, remaining: 0, total: 0, round: 1, rounds: 4, paused: false };
  private timer = 0;
  onPhase?: (next: Phase, prev: Phase) => void;
  onTick?: (s: FocusState) => void;

  constructor(public cfg: FocusCfg) {
    listen<{ action: string; minutes?: number }>("focus-cmd", (e) => this.cmd(e.payload.action, e.payload.minutes));
    listen("focus-query", () => this.broadcast());
  }

  cmd(action: string, minutes?: number) {
    if (action === "start") this.begin("work", minutes ?? this.cfg.work);
    else if (action === "break") this.begin("short", minutes ?? this.cfg.short);
    else if (action === "pause" && this.s.phase !== "idle" && !this.s.paused) {
      this.s.remaining = Math.max(0, this.s.endsAt - Date.now()); this.s.paused = true; this.broadcast();
    } else if (action === "resume" && this.s.paused) {
      this.s.endsAt = Date.now() + this.s.remaining; this.s.paused = false; this.broadcast();
    } else if (action === "stop") this.set("idle", 0);
    else if (action === "skip") this.finish();
  }

  get running() { return this.s.phase !== "idle"; }
  get working() { return this.s.phase === "work" && !this.s.paused; }

  private begin(phase: Phase, minutes: number) {
    this.s.rounds = this.cfg.rounds;
    this.set(phase, minutes * 60_000);
  }

  private set(phase: Phase, ms: number) {
    const prev = this.s.phase;
    this.s.phase = phase;
    this.s.total = ms;
    this.s.remaining = ms;
    this.s.endsAt = Date.now() + ms;
    this.s.paused = false;
    clearInterval(this.timer);
    if (phase !== "idle") this.timer = window.setInterval(() => this.tick(), 1000);
    this.onPhase?.(phase, prev);
    this.broadcast();
  }

  private tick() {
    if (this.s.paused) return;
    this.s.remaining = Math.max(0, this.s.endsAt - Date.now());
    if (this.s.remaining <= 0) return this.finish();
    this.onTick?.(this.s);
    this.broadcast();
  }

  private finish() {
    if (this.s.phase === "work") {
      const long = this.s.round % this.cfg.rounds === 0;
      this.set(long ? "long" : "short", (long ? this.cfg.long : this.cfg.short) * 60_000);
    } else if (this.s.phase === "short" || this.s.phase === "long") {
      this.s.round = this.s.phase === "long" ? 1 : this.s.round + 1;
      this.set("idle", 0);
    }
  }

  private broadcast() { emit("focus-state", this.s).catch(() => {}); this.onTick?.(this.s); }
}

/** Tiny synthesized chime (no audio files, no decoding cost). */
export function chime(kind: "up" | "down" = "up") {
  try {
    const ctx = new AudioContext();
    const notes = kind === "up" ? [659, 784, 1047] : [784, 659, 523];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t0); o.stop(t0 + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* audio unavailable */ }
}

export const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
