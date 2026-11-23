// Interactive reactions: touching him, playing with the cursor, typing along, things you drop on him.
import type { Buddy, Action } from "../buddy";
import { bump, clamp, easeInOut, easeOut, easeOutBack, pick, rand, seg, type Pose } from "../pose";
import { armsCrossed, armsUp, handToMouth, holdFront, sit, typing } from "./util";
import { CX, GROUND } from "../rig";

const NS = "http://www.w3.org/2000/svg";
const every = (t: number, dt: number, period: number) => Math.floor(t / period) !== Math.floor((t - dt) / period);

/** Laptop typing driven by your real keystrokes (falls back to a gentle idle rhythm). */
export function typeTaps(p: Pose, b: Buddy, t: number) {
  if (b.typedWithin(1.5)) {
    p.aL1 = -14; p.aR1 = -14;
    p.aL2 = -30 - b.tapL * 12; p.aR2 = -30 - b.tapR * 12;
    p.head = 4 + (b.tapL - b.tapR) * 1.5;
    p.lookY = 0.55; p.pupilY = 0.9;
  } else typing(p, t, 0.35);
}

export function registerPlay(b: Buddy) {
  // ------------------------------------------------------------ touch: hair → boing
  b.register("boing", (): Action => ({
    name: "boing", dur: 1.3, fps: "high", priority: 4,
    enter(b) { b.rig.impulse("hair", 1.2); const h = b.headPos(); b.fx.emit("spark", h.x + rand(-30, 30), h.y - 100, { vy: -40, life: 0.6, s: 0.8 }); },
    update(_b, t, _dt, p) {
      const k = bump(seg(t, 0, 0.5));
      p.sy = 1 - k * 0.07; p.sx = 1 + k * 0.05;
      p.eyeMode = t < 0.45 ? "squint" : "happy"; p.mouth = t < 0.45 ? "o" : "smile";
      p.pupilY = -0.9; p.lookY = -0.4 * (1 - seg(t, 0.8, 1.3));
      // pats his hair back down
      const pat = seg(t, 0.4, 1.2);
      if (pat > 0 && pat < 1) { p.aR1 = 8 + 110 * bump(pat); p.aR2 = 6 + (24 + Math.sin(t * 22) * 8) * bump(pat); }
    },
  }));

  // ------------------------------------------------------------ touch: glasses → push them back up
  b.register("fixGlasses", (): Action => ({
    name: "fixGlasses", dur: 1.6, fps: "high", priority: 4,
    enter(b) { b.rig.impulse("glasses", 1); },
    update(_b, t, _dt, p) {
      const slip = 1 - easeInOut(seg(t, 0.55, 0.9));
      p.glassesY = 7 * easeOut(seg(t, 0, 0.12)) * slip;
      p.eyeMode = t < 0.5 ? "squint" : "normal";
      p.lidTilt = -0.45 * bump(seg(t, 0, 1.6)); // a mildly unimpressed look
      p.mouth = "flat";
      const k = bump(seg(t, 0.3, 1.25));
      handToMouth(p, "R", k);
      p.aR1 -= 14 * k; p.aR2 += 10 * k; // a little higher: finger to the bridge
      p.head = -3 * k; p.pupilX = 0; p.pupilY = 0;
    },
  }));

  // ------------------------------------------------------------ touch: nose → boop
  b.register("boop", (): Action => ({
    name: "boop", dur: 1.1, fps: "high", priority: 4,
    enter(b) { b.rig.impulse("head", 1); const h = b.headPos(); b.fx.emit("heart", h.x, h.y + 20, { vy: -60, life: 0.9, s: 0.6, s1: 1 }); },
    update(_b, t, _dt, p) {
      const k = bump(seg(t, 0, 0.35));
      p.head = -6 * k; p.headY = 3 * k; p.sy = 1 - 0.05 * k;
      p.eyeMode = t < 0.35 ? "squint" : "happy"; p.mouth = t < 0.35 ? "o" : "smile"; p.blush = 0.6 * bump(seg(t, 0, 1.1));
      p.pupilX = 0; p.pupilY = 0.2;
    },
  }));

  // ------------------------------------------------------------ touch: belly → tickle
  b.register("tickle", (): Action => ({
    name: "tickle", dur: 1.9, fps: "high", priority: 4,
    enter(b) { b.rig.impulse("head", 0.6); },
    update(b, t, dt, p) {
      const k = 1 - seg(t, 1.4, 1.9);
      p.eyeMode = "happy"; p.mouth = "grin"; p.blush = 0.7 * k;
      p.rot = Math.sin(t * 26) * 3.5 * k; p.torso = -8 * k; p.sy = 1 - 0.05 * k;
      p.head = Math.sin(t * 13) * 6 * k; p.headY = 2 * k;
      holdFront(p, 0.8 * k); p.aL2 -= 14 * k; p.aR2 -= 14 * k; // hugging his tummy
      p.lL2 = Math.max(0, Math.sin(t * 14)) * 16 * k;
      if (every(t, dt, 0.35) && t < 1.3) b.fx.emit("note", CX + rand(-50, 50), 150, { vy: -50, life: 0.9, wob: 18, s: 0.6 });
    },
  }));

  // ------------------------------------------------------------ touch: feet → hop
  b.register("hop", (): Action => ({
    name: "hop", dur: 0.8, fps: "high", priority: 4,
    update(b, t, _dt, p) {
      const crouch = bump(seg(t, 0, 0.16)), air = bump(seg(t, 0.12, 0.6)), land = bump(seg(t, 0.58, 0.8));
      p.y = -air * 34; p.sy = 1 - crouch * 0.12 + air * 0.08 - land * 0.1; p.sx = 1 / p.sy;
      p.lL2 = 34 * air; p.lR2 = 34 * air; p.lL1 = -12 * air; p.lR1 = 12 * air;
      armsUp(p, air * 0.55, 30);
      p.eyeMode = air > 0.2 ? "wide" : "normal"; p.mouth = air > 0.2 ? "open" : "o";
      if (t > 0.58 && t < 0.62) b.fx.burst("dust", CX, GROUND - 4, 3, 30);
    },
  }));

  // ------------------------------------------------------------ poked too much → grumpy
  b.register("grumpy", (a?: { text?: string }): Action => ({
    name: "grumpy", dur: 2.6, fps: "mid", priority: 4, noLook: true,
    enter(b) { if (a?.text) b.say?.(a.text, { ms: 2400 }); b.facing = -b.facing; },
    update(b, t, dt, p) {
      const k = easeOutBack(seg(t, 0, 0.35));
      armsCrossed(p);
      p.eyeMode = "normal"; p.eyes = 0.55; p.lidTilt = -0.8 * k; p.mouth = "frown";
      p.head = -8 * k; p.lookX = -0.5 * k; p.pupilX = 0.9; p.torso = -3;
      p.lR1 = Math.max(0, Math.sin(t * 9)) * 10 * seg(t, 0.5, 0.9) * (1 - seg(t, 1.6, 2)); // foot tap
      if (every(t, dt, 0.7) && t < 2) { const h = b.headPos(); b.fx.emit("steam", h.x + rand(-40, 40), h.y - 95, { vy: -40, life: 0.9, s: 1 }); }
    },
  }));

  // ------------------------------------------------------------ cursor resting above his head → reach & jump for it
  b.register("reachUp", (a: { at: () => { x: number; y: number } | null; caught?: () => void }): Action => {
    let jumped = false, got = false;
    return {
      name: "reachUp", dur: 3.4, fps: "high", priority: 2, noLook: true,
      update(b, t, dt, p) {
        const c = a.at();
        const h = b.headPos();
        if (c) { b.lookAt = c; b.facing = c.x >= CX + p.x ? 1 : -1; }
        p.pupilY = -1; p.lookY = -0.55; p.pupilX = c ? clamp((c.x - h.x) / 60, -1, 1) : 0;
        if (t < 1.5) { // tiptoe stretch, one arm up, wiggling fingers
          const k = easeOut(seg(t, 0, 0.4));
          p.y = -5 * k; p.sy = 1 + 0.04 * k; p.lL2 = 0; p.lR2 = 0;
          p.aR1 = 8 + 112 * k; p.aR2 = 6 + (26 + Math.sin(t * 16) * 9) * k;
          p.eyeMode = "normal"; p.mouth = "o";
          return;
        }
        // the jump: the hand reaches ~70px higher at the top
        const j = seg(t, 1.5, 2.35);
        const air = bump(j);
        p.y = -air * 46; p.sy = 1 + air * 0.08 - bump(seg(t, 1.42, 1.55)) * 0.1;
        armsUp(p, 1, 20); p.lL2 = 30 * air; p.lR2 = 30 * air;
        p.mouth = "open"; p.eyeMode = "wide";
        if (!jumped && j > 0.45) {
          jumped = true;
          // still hovering over his head at the top of the jump → tagged it
          got = !!c && Math.abs(c.x - h.x) < 110 && h.y - c.y > 60 && h.y - c.y < 240;
          if (got) { b.fx.burst("star", c!.x, c!.y, 4, 70); a.caught?.(); }
        }
        if (t > 2.35) {
          b.lookAt = null;
          p.y = 0; armsUp(p, 1 - seg(t, 2.35, 2.8));
          p.eyeMode = got ? "happy" : "normal"; p.mouth = got ? "grin" : "flat";
          if (!got) { p.lidTilt = -0.4; p.head = -6; }
        }
      },
      exit(b) { b.lookAt = null; },
    };
  });

  // ------------------------------------------------------------ "laser pointer": pounce on the cursor
  b.register("pounce", (a: { x: number }): Action => {
    let sx = 0, dx = 0;
    return {
      name: "pounce", dur: 0.95, fps: "high", priority: 2, noLook: true,
      enter(b) {
        const [lo, hi] = b.world.range();
        sx = b.world.fx;
        const tx = clamp(a.x, lo, hi);
        dx = clamp(tx - sx, -90 * b.world.scale, 90 * b.world.scale);
        if (Math.abs(dx) > 2) b.facing = Math.sign(dx);
      },
      update(b, t, _dt, p) {
        const crouch = seg(t, 0, 0.28), j = seg(t, 0.28, 0.7), land = seg(t, 0.7, 0.95);
        if (crouch < 1) { // wiggle the bum, eyes locked on
          const k = easeOut(crouch);
          // (lean kept small: his big head would poke out of the window)
          p.sy = 1 - 0.14 * k; p.sx = 1 + 0.08 * k; p.torso = 6 * k; p.rot = Math.sin(t * 40) * 2 * k; p.headY = 4 * k;
          p.lL2 = 36 * k; p.lR2 = 36 * k; p.aL1 = -20; p.aR1 = -20;
          p.eyeMode = "normal"; p.eyes = 0.8; p.mouth = "flat"; p.pupilX = 1; p.pupilY = 0.6;
          return;
        }
        b.world.fx = sx + dx * easeInOut(j);
        const air = bump(j);
        p.y = -air * 40; p.torso = 7; p.rot = 4 * air;
        p.aL1 = 70 + 20 * air; p.aR1 = 70 + 20 * air; p.aL2 = -20; p.aR2 = -20; // paws out front
        p.lL1 = -30 * air; p.lR1 = -40 * air; p.lL2 = 20; p.lR2 = 30;
        p.eyeMode = "wide"; p.mouth = "open";
        if (land > 0) {
          const k = Math.exp(-land * 5);
          p.y = 0; p.sy = 1 - 0.14 * k; p.sx = 1 + 0.1 * k; p.torso = 7 * k; p.aL1 = -40 * k; p.aR1 = -40 * k;
          p.eyeMode = "squint"; p.mouth = "smile";
        }
      },
    };
  });

  b.register("pant", (): Action => ({
    name: "pant", dur: 2.4, fps: "mid", priority: 2,
    update(_b, t, _dt, p) {
      p.mouth = "tongue"; p.eyeMode = "happy";
      p.sy = 1 + Math.sin(t * 14) * 0.02; p.torso = 8; p.head = 4;
      p.aL1 = -10; p.aR1 = -10; p.aL2 = -40; p.aR2 = -40; // hands on knees
      p.lL2 = 10; p.lR2 = 10; p.y = 2;
    },
  }));

  // ------------------------------------------------------------ high five (touch his raised hand with the cursor)
  b.register("highFive", (a: { text?: string; touched: () => boolean; onSlap?: () => void }): Action => {
    let slapT = -1;
    return {
      name: "highFive", dur: 7, fps: "high", priority: 2,
      enter(b) { if (a.text) b.say?.(a.text, { ms: 3000 }); },
      update(b, t, dt, p) {
        if (slapT < 0 && t > 0.3 && a.touched()) {
          slapT = t; b.rig.impulse("hair", 0.6);
          const h = b.headPos();
          b.fx.burst("star", h.x + b.facing * 70, h.y - 80, 6, 90);
          a.onSlap?.();
        }
        if (slapT >= 0) { // celebrate: a hop and a grin
          const u = t - slapT;
          p.y = -bump(seg(u, 0, 0.5)) * 24; armsUp(p, 1 - seg(u, 0.4, 0.9));
          p.eyeMode = "happy"; p.mouth = "grin"; p.blush = 0.4;
          if (u > 1.4) return true;
          return;
        }
        const k = easeOutBack(seg(t, 0, 0.35));
        p.aR1 = 8 + 110 * k; p.aR2 = 6 + 20 * k + Math.sin(t * 3) * 3; // palm up, waiting
        p.eyeMode = "normal"; p.mouth = t > 5 ? "flat" : "smile"; p.head = 6 * k;
        if (t > 5.5) { armsUp(p, 1 - seg(t, 5.5, 6.2)); p.lidTilt = 0.3; p.mouth = "flat"; } // …left hanging
        void dt;
      },
    };
  });

  // ------------------------------------------------------------ typing along with you
  b.register("typeAlong", (): Action => ({
    name: "typeAlong", dur: Infinity, fps: "mid", priority: 1, noLook: true, scene: "laptop", blend: 0.4,
    update(b, t, dt, p) {
      sit(p, t, 0.08);
      typeTaps(p, b, t);
      p.mouth = t % 9 < 0.8 ? "tongue" : "flat";
      if (t % 11 > 10) { p.lookY = 0; p.pupilY = 0; p.pupilX = 0.6; p.head = 0; } // glance over at you
      if (b.typedWithin(60) && !b.typedWithin(3.5)) return true; // you stopped → so does he
      if (b.flow && every(t, dt, 4.5)) b.fx.emit("spark", CX + rand(-60, 60), 170, { vy: -30, life: 1.2, s: 0.7, wob: 12 });
    },
  }));

  // ------------------------------------------------------------ something's being dragged over him
  b.register("eager", (): Action => ({
    name: "eager", dur: 8, fps: "mid", priority: 3,
    update(_b, t, _dt, p) {
      const k = easeOutBack(seg(t, 0, 0.3));
      p.aL1 = 8 + 52 * k; p.aR1 = 8 + 52 * k; p.aL2 = -40 * k; p.aR2 = -40 * k; // arms out, ready to catch
      p.eyeMode = "wide"; p.mouth = "o"; p.y = -Math.abs(Math.sin(t * 7)) * 4; p.head = Math.sin(t * 3) * 4;
    },
  }));

  // ------------------------------------------------------------ caught what you dropped: hold it up
  b.register("holdUp", (a: { prop: string; dur?: number; text?: string; html?: boolean; read?: boolean }): Action => ({
    name: "holdUp", dur: a.dur ?? 3, fps: "mid", priority: 3,
    enter(b) { b.rig.impulse("head", 0.8); },
    update(_b, t, _dt, p) {
      const k = easeOutBack(seg(t, 0, 0.4));
      p.y = -bump(seg(t, 0, 0.35)) * 10;
      if (a.read) { // reading it: eyes scan the lines
        holdFront(p, k); p.propR = a.prop;
        p.pupilX = Math.sin(t * 5) * 0.7; p.pupilY = 0.5 + (Math.floor(t * 0.8) % 3) * 0.15; p.lookY = 0.3;
        p.eyeMode = "normal"; p.mouth = "o";
      } else {
        p.propR = a.prop; p.aR1 = 8 + 70 * k; p.aR2 = 6 + 64 * k;
        p.eyeMode = t < 0.5 ? "wide" : "happy"; p.mouth = "smile"; p.head = 6;
      }
    },
  }));

  // ------------------------------------------------------------ a photo you dropped, held up like a sign
  b.register("showPhoto", (a: { src: string; dur?: number }): Action => {
    let g: SVGGElement | null = null;
    return {
      name: "showPhoto", dur: a.dur ?? 5, fps: "mid", priority: 3,
      enter(b) {
        g = document.createElementNS(NS, "g") as SVGGElement;
        g.innerHTML = `<rect x="-52" y="-46" width="104" height="92" rx="4" fill="var(--paper)" stroke="var(--ink)" stroke-width="3"/>
          <image href="${a.src}" x="-46" y="-40" width="92" height="70" preserveAspectRatio="xMidYMid slice"/>
          <rect x="-46" y="-40" width="92" height="70" fill="none" stroke="var(--ink)" stroke-width="1.5"/>`;
        b.rig.fx.appendChild(g);
      },
      update(b, t, _dt, p) {
        const k = easeOutBack(seg(t, 0, 0.45)) * (1 - easeInOut(seg(t, (a.dur ?? 5) - 0.4, a.dur ?? 5)));
        armsUp(p, k, 10); // held up high over his head, like a trophy
        p.eyeMode = t < 0.6 ? "wide" : "happy"; p.mouth = "grin"; p.blush = 0.3;
        p.pupilY = -0.8; p.lookY = -0.3; p.y = -Math.abs(Math.sin(t * 3)) * 3;
        const x = CX + p.x, y = GROUND + p.y - 262 - 10 * k;
        g?.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(Math.sin(t * 1.7) * 3).toFixed(2)}) scale(${(0.2 + 0.68 * k).toFixed(3)})`);
        void b;
      },
      exit() { g?.remove(); },
    };
  });

  void pick;
}
