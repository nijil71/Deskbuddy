// The desktop as the buddy experiences it: monitors, the taskbar floor,
// window tops to stand on, gravity, and moving its own window around.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { CX, GROUND } from "./rig";

export interface Rect { x: number; y: number; w: number; h: number; }
export interface Monitor { bounds: Rect; work: Rect; scale: number; primary: boolean; }
export interface WinInfo { id: number; title: string; rect: Rect; pid: number; }

export type Surface =
  | { kind: "floor" }
  | { kind: "window"; id: number; title: string; x0: number; x1: number }
  | { kind: "air" };

const appWin = getCurrentWindow();

export class World {
  monitors: Monitor[] = [];
  /** Feet position in screen physical pixels. */
  fx = 0;
  fy = 0;
  vx = 0;
  vy = 0;
  surface: Surface = { kind: "floor" };
  /** buddy size multiplier from settings */
  size = 1;
  get scale() { return (window.devicePixelRatio || 1) * this.size; }
  onLand?: (impact: number, surface: Surface) => void;
  onFall?: () => void;
  /** Floor moved under our feet (auto-hide taskbar slid in/out). Return true if handled with an animation. */
  onFloorShift?: (from: number, to: number) => boolean;
  taskbars: Rect[] = [];
  private lastWin = { x: NaN, y: NaN };
  private platforms: WinInfo[] = [];
  private windowPoll = 0;

  async init() {
    await this.refreshMonitors();
    const m = this.monitors.find((m) => m.primary) ?? this.monitors[0];
    this.fx = m.work.x + m.work.w - 220 * this.scale;
    this.fy = m.work.y + m.work.h;
    this.applyPosition(true);
    setInterval(() => this.refreshMonitors(), 30_000);
  }

  async refreshMonitors() {
    try {
      this.monitors = await invoke<Monitor[]>("get_monitors");
      this.taskbars = await invoke<Rect[]>("get_taskbars");
    } catch { /* keep previous */ }
  }

  monitorAt(x: number, y = this.fy - 5): Monitor {
    let best = this.monitors[0];
    let bestD = Infinity;
    for (const m of this.monitors) {
      const b = m.bounds;
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return m;
      const d = Math.abs(x - (b.x + b.w / 2)) + Math.abs(y - (b.y + b.h / 2));
      if (d < bestD) { bestD = d; best = m; }
    }
    return best ?? { bounds: { x: 0, y: 0, w: 1920, h: 1080 }, work: { x: 0, y: 0, w: 1920, h: 1040 }, scale: 1, primary: true };
  }

  floorY(x = this.fx) {
    const m = this.monitorAt(x);
    let f = m.work.y + m.work.h;
    // An auto-hide taskbar isn't part of the work area; while it's slid up, stand on it.
    const bottom = m.bounds.y + m.bounds.h;
    for (const t of this.taskbars) {
      const atBottom = t.y + t.h >= bottom - 2 && t.y > m.bounds.y + m.bounds.h / 2;
      if (atBottom && x >= t.x && x <= t.x + t.w && t.y < bottom - 8) f = Math.min(f, t.y);
    }
    return f;
  }

  /** Horizontal walking range on the current surface (feet x, screen px). */
  range(): [number, number] {
    const pad = 70 * this.scale;
    if (this.surface.kind === "window") return [this.surface.x0 + 30 * this.scale, this.surface.x1 - 30 * this.scale];
    const w = this.monitorAt(this.fx).work;
    return [w.x + pad, w.x + w.w - pad];
  }

  /** Move the OS window so that the feet are at (fx, fy). Cheap: only when the integer pos changes. */
  applyPosition(force = false) {
    const s = this.scale;
    const x = Math.round(this.fx - CX * s);
    const y = Math.round(this.fy - GROUND * s);
    if (!force && x === this.lastWin.x && y === this.lastWin.y) return false;
    this.lastWin = { x, y };
    appWin.setPosition(new PhysicalPosition(x, y)).catch(() => {});
    return true;
  }

  windowOrigin() {
    return { x: this.fx - CX * this.scale, y: this.fy - GROUND * this.scale };
  }

  // ------------------------------------------------------------ physics

  launch(vx: number, vy: number) {
    this.vx = vx;
    this.vy = vy;
    this.surface = { kind: "air" };
    this.loadPlatforms();
  }

  async loadPlatforms() {
    try {
      this.platforms = await invoke<WinInfo[]>("get_windows");
    } catch { this.platforms = []; }
  }

  /** Is the top edge of window i visible at x (not covered by windows above it)? */
  private topVisible(list: WinInfo[], i: number, x: number) {
    const w = list[i];
    const y = w.rect.y + 2;
    for (let j = 0; j < i; j++) {
      const r = list[j].rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return false;
    }
    return true;
  }

  /** Step physics while airborne; returns true while still in the air. */
  stepAir(dt: number): boolean {
    const s = this.scale;
    const g = 2400 * s;
    const prevY = this.fy;
    this.vy += g * dt;
    this.vx *= Math.pow(0.6, dt);
    this.fx += this.vx * dt;
    this.fy += this.vy * dt;

    // side walls: bounce off the outer edges of the whole desktop
    const xs = this.monitors.map((m) => m.bounds);
    const minX = Math.min(...xs.map((b) => b.x)) + 40 * s;
    const maxX = Math.max(...xs.map((b) => b.x + b.w)) - 40 * s;
    if (this.fx < minX) { this.fx = minX; this.vx = Math.abs(this.vx) * 0.5; }
    if (this.fx > maxX) { this.fx = maxX; this.vx = -Math.abs(this.vx) * 0.5; }
    const top = this.monitorAt(this.fx, Math.max(this.fy, 0)).bounds.y + 200 * s;
    if (this.fy < top && this.vy < 0) { this.vy *= -0.3; }

    if (this.vy > 0) {
      // window tops first (they're above the floor)
      for (let i = 0; i < this.platforms.length; i++) {
        const w = this.platforms[i];
        const py = w.rect.y;
        if (prevY <= py && this.fy >= py && this.fx > w.rect.x + 24 * s && this.fx < w.rect.x + w.rect.w - 24 * s) {
          if (!this.topVisible(this.platforms, i, this.fx)) continue;
          if (py < this.monitorAt(this.fx, py).work.y + 40 * s) continue; // maximised windows: too high
          this.fy = py;
          const impact = this.vy;
          this.vx = 0; this.vy = 0;
          this.surface = { kind: "window", id: w.id, title: w.title, x0: w.rect.x, x1: w.rect.x + w.rect.w };
          this.onLand?.(impact / s, this.surface);
          return false;
        }
      }
      const floor = this.floorY();
      if (this.fy >= floor) {
        this.fy = floor;
        const impact = this.vy;
        this.vx = 0; this.vy = 0;
        this.surface = { kind: "floor" };
        this.onLand?.(impact / s, this.surface);
        return false;
      }
    }
    return true;
  }

  /** Keep standing on whatever we're on (window may move/close). Call each frame. */
  async follow(dt: number) {
    if (this.surface.kind === "floor") {
      const fy = this.floorY();
      if (Math.abs(fy - this.fy) > 1) {
        // taskbar slid in/out → hop up / drop down; otherwise (monitor change, busy) just snap
        if (!(Math.abs(fy - this.fy) > 12 && this.onFloorShift?.(this.fy, fy))) this.fy = fy;
      }
      return;
    }
    if (this.surface.kind !== "window") return;
    this.windowPoll -= dt;
    if (this.windowPoll > 0) return;
    this.windowPoll = 0.6;
    const sid = this.surface.id;
    let list: WinInfo[] = [];
    try { list = await invoke<WinInfo[]>("get_windows"); } catch { return; }
    if (this.surface.kind !== "window" || this.surface.id !== sid) return;
    const i = list.findIndex((w) => w.id === sid);
    const relX = this.fx - this.surface.x0;
    if (i < 0) return this.drop();
    const r = list[i].rect;
    // ride along with the window
    this.fx = r.x + Math.min(Math.max(relX, 20 * this.scale), r.w - 20 * this.scale);
    this.fy = r.y;
    this.surface.x0 = r.x;
    this.surface.x1 = r.x + r.w;
    if (!this.topVisible(list, i, this.fx) || r.y < this.monitorAt(this.fx, r.y).work.y + 20 * this.scale) this.drop();
  }

  drop() {
    this.launch(0, -100 * this.scale);
    this.onFall?.();
  }

  /** The foreground window's top edge, if it's a good place to sit. */
  async foregroundPerch(): Promise<WinInfo | null> {
    try {
      const w = await invoke<WinInfo | null>("get_foreground");
      if (!w) return null;
      const m = this.monitorAt(w.rect.x + w.rect.w / 2, w.rect.y + 10);
      if (w.rect.y < m.work.y + 120 * this.scale) return null; // maximised or too close to top
      if (w.rect.w < 300 * this.scale) return null;
      const list = await invoke<WinInfo[]>("get_windows");
      const i = list.findIndex((x) => x.id === w.id);
      if (i < 0 || !this.topVisible(list, i, w.rect.x + w.rect.w / 2)) return null;
      return w;
    } catch { return null; }
  }
}
