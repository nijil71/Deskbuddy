// Interactivity logic, kept free of DOM/Tauri so it can be tested headlessly:
//  • touch zones: where on the body a click landed (hair / glasses / nose / face / belly / feet)
//  • click-spam: five quick pokes → he's had enough
//  • cursor play: "laser pointer" wiggles near his floor, the cursor resting just above his head
//  • typing rhythm: turns the keystroke counts from Rust into "you're typing" / "you're in flow"
//  • drops: what kind of thing you dropped on him
import { HIP_Y, NECK, FACE, GROUND, CX } from "./rig";
import type { Pose } from "./pose";

// ------------------------------------------------------------------ touch zones

export type Zone = "hair" | "glasses" | "nose" | "face" | "belly" | "feet" | "arm";

/** x,y in window CSS px (the rig's own coordinate space). */
export function touchZone(x: number, y: number, p: Pose): Zone {
  const hx = CX + p.x + p.headX, hy = HIP_Y + p.y + NECK + FACE + p.headY; // face centre
  const dx = x - hx, dy = y - hy;
  const hips = HIP_Y + p.y, feet = GROUND + p.y;
  if (dy < -36 && Math.abs(dx) < 96) return "hair";
  if (Math.abs(dx) < 12 && dy > 15 && dy < 34) return "nose";
  if (Math.abs(dy - 3) < 18 && Math.abs(dx) < 54) return "glasses";
  if (dy >= -36 && dy < 64 && Math.abs(dx) < 78) return "face";
  if (y > hips + 6 && y <= feet + 30) return "feet";
  if (y > hy + 64 && y <= hips + 6 && Math.abs(x - (CX + p.x)) < 25) return "belly";
  return "arm";
}

/** Remembers recent clicks; true once you've poked him `n` times within `ms`. */
export class ClickSpam {
  private t: number[] = [];
  constructor(private n = 5, private ms = 4000) {}
  hit(now: number) {
    this.t = this.t.filter((x) => now - x < this.ms);
    this.t.push(now);
    if (this.t.length >= this.n) { this.t = []; return true; }
    return false;
  }
}

// ------------------------------------------------------------------ cursor play

export interface Sample { x: number; y: number; t: number }
export interface PlayCtx {
  now: number;            // ms
  fx: number; fy: number; // buddy feet (screen px)
  scale: number;          // screen px per rig px
  headTop: { x: number; y: number }; // top of his hair (screen px)
}

export class CursorPlay {
  private s: Sample[] = [];
  private stillSince = 0;
  private stillAt = { x: NaN, y: NaN };

  add(x: number, y: number, t: number) {
    this.s.push({ x, y, t });
    while (this.s.length && t - this.s[0].t > 1500) this.s.shift();
    if (Math.hypot(x - this.stillAt.x, y - this.stillAt.y) > 6) { this.stillAt = { x, y }; this.stillSince = t; }
  }

  get last(): Sample | undefined { return this.s[this.s.length - 1]; }

  /** A fast back-and-forth wiggle near the surface he stands on → screen x to chase, or null. */
  laser(c: PlayCtx): number | null {
    const win = this.s.filter((q) => c.now - q.t < 1100);
    if (win.length < 8) return null;
    const near = win.filter((q) => q.y > c.fy - 170 * c.scale && q.y < c.fy + 50 * c.scale && Math.abs(q.x - c.fx) < 800 * c.scale);
    if (near.length < win.length * 0.8) return null;
    let path = 0, flips = 0, dir = 0;
    for (let i = 1; i < near.length; i++) {
      const dx = near[i].x - near[i - 1].x;
      path += Math.hypot(dx, near[i].y - near[i - 1].y);
      if (Math.abs(dx) > 4 * c.scale) {
        const d = Math.sign(dx);
        if (dir && d !== dir) flips++;
        dir = d;
      }
    }
    if (path < 700 * c.scale || flips < 3) return null;
    return near[near.length - 1].x;
  }

  /** The cursor has rested for a while just above his head (within jumping reach). */
  dangling(c: PlayCtx, ms = 1400): boolean {
    const l = this.last;
    if (!l || c.now - this.stillSince < ms) return false;
    const dx = l.x - c.headTop.x, dy = c.headTop.y - l.y;
    return Math.abs(dx) < 60 * c.scale && dy > 8 * c.scale && dy < 110 * c.scale;
  }
}

// ------------------------------------------------------------------ typing rhythm

export class Typing {
  last = -1e9;          // ms of the last keystroke batch
  burstStart = -1e9;    // when the current run of typing began
  private hist: { t: number; n: number }[] = [];

  add(n: number, now: number) {
    if (now - this.last > 4000) this.burstStart = now; // a pause of 4 s ends a burst
    this.last = now;
    this.hist.push({ t: now, n });
    while (this.hist.length && now - this.hist[0].t > 5000) this.hist.shift();
  }

  /** keys per second over the last 5 s */
  rate(now: number) {
    const n = this.hist.filter((h) => now - h.t < 5000).reduce((a, h) => a + h.n, 0);
    return n / 5;
  }

  /** You're typing right now (a real run, not a stray shortcut). */
  active(now: number) { return now - this.last < 2500 && now - this.burstStart > 1500 && this.rate(now) >= 1.2; }

  /** Long, steady typing: deep in it. */
  flow(now: number) { return this.active(now) && now - this.burstStart > 90_000 && this.rate(now) >= 2; }
}

// ------------------------------------------------------------------ drops

export type DropKind = "folder" | "image" | "text" | "file" | "link" | "snippet";

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|log|json|ya?ml|toml|ini|cfg|conf|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|cs|cpp|cc|c|h|hpp|php|sh|ps1|bat|sql|swift|lua|r|vue|svelte)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i;

export function dropKind(d: { name?: string; type?: string; isDir?: boolean; url?: string; text?: string }): DropKind {
  if (d.isDir) return "folder";
  if (d.name) {
    if ((d.type ?? "").startsWith("image/") || IMG_EXT.test(d.name)) return "image";
    if ((d.type ?? "").startsWith("text/") || TEXT_EXT.test(d.name)) return "text";
    return "file";
  }
  if (d.url && /^https?:\/\//i.test(d.url)) return "link";
  return "snippet";
}

export function wordStats(text: string) {
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
  const mins = Math.max(1, Math.round(words / 230));
  return { words, lines, mins };
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/** A friendly launcher name for a path or URL. */
export function niceName(target: string) {
  try {
    if (/^https?:\/\//i.test(target)) { const u = new URL(target); return u.hostname.replace(/^www\./, "") + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, "").slice(0, 30) : ""); }
  } catch { /* not a URL */ }
  const base = target.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || target;
  return base.replace(/\.(lnk|url|exe)$/i, "");
}
