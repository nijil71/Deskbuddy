// The living core: frame loop, action playback with blending, and the always-on
// "alive" layers (breathing, blinking, looking, facing).
import { invoke } from "@tauri-apps/api/core";
import { Rig, CX, GROUND } from "./rig";
import { Fx } from "./fx";
import { World } from "./world";
import { Mood } from "./mood";
import { basePose, blendPose, copyPose, easeInOut, rand, Spring, clamp, type Pose } from "./pose";

export type Fps = "high" | "mid" | "idle" | "low";

export interface SayOpts {
  ms?: number;                     // auto-hide after; 0 = stay until dismissed
  thought?: boolean;               // cloud-style thought bubble
  buttons?: { label: string; fn: () => void; primary?: boolean }[];
  html?: boolean;
  key?: string;                    // which suggestion this is (for dismiss tracking)
}

export interface Action {
  name: string;
  /** seconds; Infinity = until finished by update() returning true or interrupted */
  dur: number;
  fps?: Fps;
  priority?: number;          // higher interrupts lower; default 1
  blend?: number;             // blend-in seconds
  noLook?: boolean;           // action drives eyes itself
  noBlink?: boolean;
  lookWeight?: number;        // 0..1 how much cursor-look applies
  scene?: string;             // scene prop (laptop/box/sign)
  enter?(b: Buddy): void;
  update(b: Buddy, t: number, dt: number, p: Pose): boolean | void;
  exit?(b: Buddy): void;
}

export type ActionFactory = (args?: any) => Action;

interface Running { a: Action; t: number; resolve: (ok: boolean) => void; }

const FPS: Record<Fps, number> = { high: 60, mid: 40, idle: 24, low: 10 };

export class Buddy {
  rig: Rig;
  fx: Fx;
  world = new World();
  pose = basePose();         // final output
  private target = basePose();
  private from = basePose();
  private blendT = 1;
  private blendDur = 0.22;
  private cur: Running | null = null;
  private registry: Record<string, ActionFactory> = {};
  private lastFrame = 0;
  private timer = 0;
  private running = false;
  private boilAcc = 0;
  time = 0;

  // alive layers
  facing = 1;
  private faceCur = 1;
  private blinkIn = 2;
  private blinkT = -1;
  private doubleBlink = false;
  private lookX = new Spring(0, 60, 11);
  private lookY = new Spring(0, 60, 11);
  private pupX = new Spring(0, 220, 18);
  private pupY = new Spring(0, 220, 18);
  private cursor = { x: 0, y: 0, moved: 0 };
  private saccade = { x: 0, y: 0, next: 0 };
  private micro = { x: 0, y: 0, next: 0 };
  /** externally forced look target in window px (e.g. at a prop), or null */
  lookAt: { x: number; y: number } | null = null;
  hat = "";                  // persistent accessory from settings/context
  mood = new Mood();
  musicOn = false;           // something is playing: bob along while idle
  silent = false;            // play reactions without their speech bubble
  sayKey = "";               // suggestion key attached to bubbles from the current reaction
  dragging = false;
  hidden = false;
  forceFps: Fps | null = null;
  onFrame?: (dt: number) => void;
  /** speech bubble hook, wired up by the UI layer */
  say?: (text: string, opts?: SayOpts) => void;
  /** while > time, the mouth lip-syncs (a speech bubble is up) */
  talkUntil = 0;
  talk(text: string) { this.talkUntil = this.time + Math.min(4, 0.5 + text.replace(/<[^>]*>/g, "").length * 0.05); }

  constructor(host: HTMLElement) {
    this.rig = new Rig(host);
    this.fx = new Fx(this.rig.fx);
  }

  register(name: string, f: ActionFactory) { this.registry[name] = f; }
  has(name: string) { return !!this.registry[name]; }
  get actionName() { return this.cur?.a.name ?? ""; }
  get priority() { return this.cur?.a.priority ?? 0; }

  /** Play an action. Resolves true when it completes, false if interrupted/refused. */
  play(name: string, args?: any, opts: { force?: boolean } = {}): Promise<boolean> {
    const f = this.registry[name];
    if (!f) return Promise.resolve(false);
    const a = f(args);
    a.name ||= name;
    const pr = a.priority ?? 1;
    if (this.cur && !opts.force && pr < (this.cur.a.priority ?? 1)) return Promise.resolve(false);
    return new Promise((resolve) => {
      if (this.cur) {
        const old = this.cur;
        this.cur = null;
        old.a.exit?.(this);
        old.resolve(false);
      }
      copyPose(this.from, this.pose);
      this.blendT = 0;
      this.blendDur = a.blend ?? 0.22;
      this.rig.setScene(a.scene ?? "");
      this.cur = { a, t: 0, resolve };
      a.enter?.(this);
      this.wake();
    });
  }

  /** Resolves when the currently running action ends (completes or is interrupted). */
  whenDone(): Promise<void> {
    const c = this.cur;
    if (!c) return Promise.resolve();
    return new Promise((res) => {
      const prev = c.resolve;
      c.resolve = (ok) => { prev(ok); res(); };
    });
  }

  stop() {
    if (!this.cur) return;
    const c = this.cur;
    this.cur = null;
    c.a.exit?.(this);
    c.resolve(false);
  }

  setCursor(x: number, y: number) {
    // screen physical -> window css
    const o = this.world.windowOrigin();
    const s = this.world.scale;
    const nx = (x - o.x) / s, ny = (y - o.y) / s;
    if (Math.abs(nx - this.cursor.x) + Math.abs(ny - this.cursor.y) > 2) this.cursor.moved = this.time;
    this.cursor.x = nx;
    this.cursor.y = ny;
  }

  get cursorLocal() { return this.cursor; }

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    this.schedule();
  }

  setHidden(h: boolean) {
    this.hidden = h;
    if (!h) this.wake();
  }

  /** Make sure the loop is ticking — after idle throttling *or* after being hidden. While hidden the
   *  loop stops completely (no frame queued), so un-hiding must start it again from scratch; before,
   *  it only restarted when a timer was pending and the buddy stayed frozen on his last frame. */
  private queued = false; // a timer or rAF frame is on its way
  wake() {
    if (!this.running || this.hidden) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; this.queued = false; }
    if (!this.queued) { this.lastFrame = performance.now(); this.schedule(true); }
  }

  private fpsNow(): Fps {
    if (this.forceFps) return this.forceFps;
    if (this.dragging || this.world.surface.kind === "air") return "high";
    let f: Fps = this.cur?.a.fps ?? "idle";
    if (this.blendT < 1 && f !== "high") f = "mid";
    if (this.fx.active && (f === "idle" || f === "low")) f = "mid";
    return f;
  }

  private schedule(now = false) {
    if (!this.running || this.hidden) return;
    this.queued = true;
    const fps = FPS[this.fpsNow()];
    if (fps >= 60 || now) requestAnimationFrame(this.frame);
    else this.timer = window.setTimeout(() => { this.timer = 0; requestAnimationFrame(this.frame); }, 1000 / fps - 4);
  }

  private frame = (now: number) => {
    this.queued = false;
    if (!this.running || this.hidden) return;
    const dt = clamp((now - this.lastFrame) / 1000, 0.001, 0.1);
    this.lastFrame = now;
    this.time += dt;
    this.tick(dt);
    this.schedule();
  };

  private tick(dt: number) {
    const p = this.target;
    copyPose(p, BASE);
    p.hat = this.hat;

    // facing turns smoothly through 0 (looks like a quick body turn)
    const dir = Math.sign(this.facing - this.faceCur);
    this.faceCur = dir ? clamp(this.faceCur + dir * dt * 9, -1, 1) : this.faceCur;
    if (Math.abs(this.facing - this.faceCur) < 0.01) this.faceCur = this.facing;
    p.face = this.faceCur;

    const c = this.cur;
    if (c) {
      c.t += dt;
      const done = c.a.update(this, c.t, dt, p) === true || c.t >= c.a.dur;
      if (done && this.cur === c) {
        this.cur = null;
        c.a.exit?.(this);
        c.resolve(true);
      }
    }
    const a = c?.a;

    // mood colours calm behaviour; music makes it bob along
    this.mood.update(dt, a?.name === "sleep");
    const calmAction = !a || (a.priority ?? 1) <= 1;
    if (calmAction && a?.name !== "sleep") {
      this.mood.apply(p, this.time);
      if (this.musicOn && a?.name !== "music" && a?.name !== "walk") {
        const beat = this.time * Math.PI * 2 * 1.9;
        p.head += Math.sin(beat) * 3.2;
        p.headY += Math.abs(Math.sin(beat)) * 1.2;
        p.lR2 += Math.max(0, Math.sin(beat)) * 12; // foot tap
      }
    }

    // breathing: visible chest rise that lifts the shoulders/arms; head lags a beat behind
    const T = this.time;
    const br = Math.sin(T * 2.1);
    p.sy *= 1 + br * 0.014;
    p.sx *= 1 - br * 0.006;
    p.headY += Math.sin(T * 2.1 - 0.6) * 1.3;
    p.aL1 += br * 2; p.aR1 += br * 2;

    // organic drift: sums of incommensurate sines never visibly loop, so even a
    // standing buddy is always subtly shifting (head tilt, lean, weight)
    const calm = a?.noLook ? 0.5 : 1;
    p.head += (Math.sin(T * 0.37) + Math.sin(T * 0.91 + 1.3) * 0.6) * 1.7 * calm;
    p.torso += Math.sin(T * 0.53 + 2.1) * 0.9 * calm;
    p.headX += Math.sin(T * 0.29 + 0.7) * 1.1 * calm;
    p.rot += Math.sin(T * 0.23 + 4) * 0.6 * calm;

    // blinking (with occasional double blinks)
    if (!a?.noBlink) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0 && this.blinkT < 0) { this.blinkT = 0; this.doubleBlink = Math.random() < 0.2; }
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const len = 0.16;
        const k = this.blinkT / len;
        p.eyes *= k < 1 ? Math.abs(Math.cos(k * Math.PI)) : 1;
        if (k >= 1) {
          if (this.doubleBlink) { this.doubleBlink = false; this.blinkT = 0; }
          else { this.blinkT = -1; this.blinkIn = rand(1.8, 5.5); }
        }
      }
    }

    // looking: cursor if it's been moving recently, otherwise idle saccades
    if (!a?.noLook) {
      const w = a?.lookWeight ?? 1;
      const hc = this.rig.headCenter(p);
      let tx: number, ty: number;
      if (this.lookAt) { tx = this.lookAt.x - hc.x; ty = this.lookAt.y - hc.y; }
      else if (this.time - this.cursor.moved < 5) { tx = this.cursor.x - hc.x; ty = this.cursor.y - hc.y; }
      else {
        if (this.time > this.saccade.next) {
          this.saccade = { x: rand(-160, 160), y: rand(-60, 80), next: this.time + rand(1.2, 4) };
        }
        tx = this.saccade.x; ty = this.saccade.y;
      }
      const fs = Math.sign(this.faceCur || 1);
      const lx = clamp(tx / 360, -1, 1) * 0.7 * fs, ly = clamp(ty / 300, -1, 1) * 0.6;
      p.lookX += this.lookX.step(lx * w, dt);
      p.lookY += this.lookY.step(ly * w, dt);
      // micro-saccades: tiny gaze jitter every 0.3-2s (static eyes read as "dead")
      if (this.time > this.micro.next) {
        this.micro = { x: rand(-0.12, 0.12), y: rand(-0.1, 0.1), next: this.time + rand(0.3, 2) };
      }
      p.pupilX += this.pupX.step(clamp((tx / 140) * fs, -1, 1) * w + this.micro.x, dt);
      p.pupilY += this.pupY.step(clamp(ty / 140, -1, 1) * w + this.micro.y, dt);
      p.head += this.lookX.x * 4;
    }

    // eyelids follow vertical gaze: lids drop when looking down, open a touch when looking up
    if (p.eyeMode === "normal") p.eyes *= clamp(1 - Math.max(0, p.pupilY) * 0.28 + Math.max(0, -p.pupilY) * 0.06, 0.6, 1.06);

    // blend into new action
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      blendPose(this.pose, this.from, p, easeInOut(this.blendT));
    } else copyPose(this.pose, p);

    this.rig.talking = this.time < this.talkUntil;
    this.rig.render(this.pose, dt);
    this.fx.update(dt);

    this.boilAcc += dt;
    if (this.boilAcc > 0.13) { this.boilAcc = 0; this.rig.boilStep(); }

    this.onFrame?.(dt);
  }

  /** Window-local CSS px → for effects positioned on the character. */
  headPos() { return this.rig.headCenter(this.pose); }
  handPos(side: "L" | "R") {
    // approximate: shoulders ±15 from centre
    const p = this.pose;
    const s = (side === "L" ? -1 : 1) * Math.sign(p.face || 1);
    return { x: CX + p.x + s * 26, y: GROUND + p.y - 55 };
  }

  /** Send the current hit box (screen physical) to Rust for click-through. */
  private lastHit = "";
  syncHitbox(extra?: DOMRect | null, lock = false) {
    const b = this.rig.bbox(this.pose);
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    if (extra) { x0 = Math.min(x0, extra.left); y0 = Math.min(y0, extra.top); x1 = Math.max(x1, extra.right); y1 = Math.max(y1, extra.bottom); }
    const o = this.world.windowOrigin();
    const s = this.world.scale;
    const hb = { x: Math.round(o.x + x0 * s), y: Math.round(o.y + y0 * s), w: Math.round((x1 - x0) * s), h: Math.round((y1 - y0) * s), lock };
    const key = `${hb.x},${hb.y},${hb.w},${hb.h},${lock}`;
    if (key === this.lastHit) return;
    this.lastHit = key;
    invoke("set_hitbox", hb).catch(() => {});
  }
}

const BASE = basePose();
