// The interactive layer: decides how he reacts when you touch him, play with the cursor near him,
// or type. Rules (from the research — Petz, Bongo Cat, Desktop Goose, Clippy):
//  • touch always answers instantly, and differently per body part
//  • cursor games only start from something you clearly did (a wiggle, letting the cursor rest
//    right above his head) and never while he's busy, asleep, in focus mode, quiet mode or a call
//  • typing along is silent: no bubbles while you type, only the rhythm
import type { Buddy } from "./buddy";
import type { Brain } from "./brain";
import { ClickSpam, CursorPlay, Typing, touchZone, type Zone } from "./play";
import { pick } from "./pose";

/** actions that are fine to interrupt for play */
const CALM = new Set(["", "idle", "sit", "lookAround", "think", "turn", "stretch", "yawn"]);

export class Playtime {
  cp = new CursorPlay();
  typing = new Typing();
  private spam = new ClickSpam(5, 4000);
  private cool: Record<string, number> = {};
  private pounces = 0;
  private chaseUntil = 0;
  private lastCheck = 0;
  private fiveFor: ((x: number, y: number) => boolean) | null = null;

  constructor(private b: Buddy, private brain: Brain) {}

  private get cfg() { return this.brain.s.play; }
  private ready(key: string, ms: number) {
    const now = Date.now();
    if (now < (this.cool[key] ?? 0)) return false;
    this.cool[key] = now + ms;
    return true;
  }
  /** He's free to play: visible, on the ground, not busy, and you haven't asked for calm. */
  free(allowBusy = false) {
    const b = this.b, br = this.brain;
    if (b.hidden || b.dragging || b.world.surface.kind === "air") return false;
    if (br.isAway || br.focus.working || br.presence.inCall || br.presence.fullscreen || !br.mayPlay) return false;
    return allowBusy || CALM.has(b.actionName);
  }

  // ------------------------------------------------------------------ touch

  /** A single click on him at window-local CSS px. Returns the zone (for tests / logging). */
  touch(x: number, y: number): Zone {
    const b = this.b;
    const zone = touchZone(x, y, b.pose);
    if (b.actionName === "grumpy") { b.rig.impulse("head", 0.5); return zone; } // sulking: pokes bounce off
    if (this.spam.hit(Date.now())) {
      b.play("grumpy", { text: pick(["Hey! Enough poking 😤", "Okay, okay, I'm awake! 😤", "That's a lot of poking…"]) }, { force: true })
        .then((ok) => {
          if (!ok || !this.brain.s.roam) return;
          const [lo, hi] = b.world.range();
          const away = b.world.fx + b.facing * 260 * b.world.scale;
          b.play("walk", { x: Math.max(lo, Math.min(hi, away)), maxT: 4 });
        });
      this.brain.onPoke(-0.04);
      return zone;
    }
    const force = b.priority < 4;
    const act: Record<Zone, string> = { hair: "boing", glasses: "fixGlasses", nose: "boop", face: "poke", belly: "tickle", feet: "hop", arm: "poke" };
    if (b.actionName === "typeAlong" || b.actionName === "focus") {
      // busy working: a quick reaction that doesn't knock the laptop away
      b.rig.impulse(zone === "hair" ? "hair" : zone === "glasses" ? "glasses" : "head", 0.8);
    } else b.play(act[zone], zone === "face" ? { kind: pick(["giggle", "huh"]) } : undefined, { force });
    this.brain.onPoke(zone === "belly" || zone === "nose" ? 0.06 : 0.03);
    return zone;
  }

  // ------------------------------------------------------------------ cursor

  onCursor(x: number, y: number) {
    const now = Date.now();
    this.cp.add(x, y, now);
    if (this.fiveFor) return; // a high five is waiting for your cursor; checked per frame instead
    if (!this.cfg.cursor || now - this.lastCheck < 120) return;
    this.lastCheck = now;
    const b = this.b, w = b.world;
    const h = b.headPos(), o = w.windowOrigin(), s = w.scale;
    const ctx = { now, fx: w.fx, fy: w.fy, scale: s, headTop: { x: o.x + h.x * s, y: o.y + (h.y - 94) * s } };

    // laser pointer: chase and pounce while you keep wiggling
    const target = this.cp.laser(ctx);
    const chasing = b.actionName === "pounce" || (b.actionName === "run" && now < this.chaseUntil);
    if (target !== null && !chasing && (this.free() || (now < this.chaseUntil && b.priority <= 2))) {
      if (this.pounces >= 4) {
        if (this.ready("pant", 25_000)) { this.pounces = 0; b.play("pant", undefined, { force: true }); }
        return;
      }
      if (now > this.chaseUntil && !this.ready("laser", 4_000)) return;
      this.chaseUntil = now + 4_000;
      const dist = target - w.fx;
      const go = Math.abs(dist) > 110 * s
        ? b.play("walk", { x: target - Math.sign(dist) * 70 * s, run: true, maxT: 2.5 }, { force: true })
        : Promise.resolve(true);
      go.then((ok) => {
        if (!ok) return;
        const l = this.cp.last;
        this.pounces++;
        b.play("pounce", { x: l ? l.x : target }, { force: true });
      });
      return;
    }
    if (now > this.chaseUntil + 30_000) this.pounces = 0;

    // cursor resting just above his head: reach up, then jump for it
    if (this.free() && this.cp.dangling(ctx) && this.ready("reach", 45_000)) {
      const at = () => {
        const l = this.cp.last;
        if (!l) return null;
        const oo = b.world.windowOrigin(), ss = b.world.scale;
        return { x: (l.x - oo.x) / ss, y: (l.y - oo.y) / ss };
      };
      b.play("reachUp", { at, caught: () => this.brain.onPoke(0.08) }, { force: true });
    }
  }

  /** Raise a hand and wait for your cursor to touch it. */
  highFive(text?: string): Promise<boolean> {
    const b = this.b;
    if (!this.cfg.cursor) return b.play("wave", { text }, { force: true });
    let slapped = false;
    const since = Date.now();
    this.fiveFor = (x, y) => {
      const o = b.world.windowOrigin(), s = b.world.scale;
      const lx = (x - o.x) / s, ly = (y - o.y) / s;
      const h = b.headPos();
      // his raised hand pops up beside his head on the side he's facing (generous target)
      const hx = h.x + Math.sign(b.pose.face || 1) * 88, hy = h.y - 92;
      return Math.hypot(lx - hx, ly - hy) < 55;
    };
    const touched = () => {
      const l = this.cp.last;
      // only a cursor that *comes to* his hand counts (not one already parked there)
      return !!l && l.t > since && Date.now() - l.t < 800 && !!this.fiveFor && this.fiveFor(l.x, l.y);
    };
    return b.play("highFive", { text, touched, onSlap: () => { slapped = true; this.brain.onPoke(0.1); } }, { force: true })
      .then((ok) => { this.fiveFor = null; return ok && slapped; });
  }

  // ------------------------------------------------------------------ typing

  onKeys(n: number) {
    if (!this.cfg.typing) return;
    const now = Date.now();
    this.typing.add(n, now);
    this.b.onKeys(n);
    this.b.flow = this.typing.flow(now);
    if (this.typing.active(now) && this.free() && this.b.priority < 1) this.b.play("typeAlong");
  }

  /** For the idle picker: should he be typing along right now? */
  get typingNow() { return this.cfg.typing && this.typing.active(Date.now()); }
}
