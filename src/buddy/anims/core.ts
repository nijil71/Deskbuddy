// Core locomotion & physical reactions.
import type { Buddy, Action } from "../buddy";
import { bump, clamp, easeInOut, easeOut, rand, seg, Spring, type Pose } from "../pose";
import { gait, sit, armsCrossed } from "./util";
import { CX } from "../rig";

export function registerCore(b: Buddy) {
  // ------------------------------------------------------------ idle (standing)
  b.register("idle", (a?: { dur?: number }): Action => {
    let shift = 0, nextShift = rand(3, 7), fidget = "", fidgetT = 0;
    return {
      name: "idle", dur: a?.dur ?? Infinity, fps: "idle", priority: 0,
      update(_b, t, dt, p) {
        // occasional weight shift + small fidgets keep it from looking frozen
        nextShift -= dt;
        if (nextShift < 0) { shift = shift ? 0 : (Math.random() < 0.5 ? -1 : 1); nextShift = rand(3, 8); }
        p.rot = shift * 1.5;
        p.torso = -shift * 1.2;
        p.lL1 = shift > 0 ? 6 : 0; p.lR1 = shift < 0 ? -6 : 0;
        p.lL2 = shift > 0 ? 6 : 0; p.lR2 = shift < 0 ? 6 : 0;
        p.aL1 = 10 + Math.sin(t * 0.9) * 2; p.aR1 = 10 + Math.sin(t * 0.9 + 1) * 2;
        if (!fidget && Math.random() < dt * 0.06) { fidget = ["toe", "cross", "behind", "scratch"][(Math.random() * 4) | 0]; fidgetT = 0; }
        if (fidget) {
          fidgetT += dt;
          const k = bump(fidgetT / 3);
          if (fidget === "toe") { p.lR1 = -10 * k; p.lR2 = 30 * k + Math.max(0, Math.sin(fidgetT * 9)) * 10 * k; }
          if (fidget === "cross") { p.aL1 += (-60 - p.aL1) * k; p.aL2 += (-78 - p.aL2) * k; p.aR1 += (-50 - p.aR1) * k; p.aR2 += (-84 - p.aR2) * k; }
          if (fidget === "behind") { p.aL1 += (-20 - p.aL1) * k; p.aR1 += (-20 - p.aR1) * k; p.aL2 = 20 * k; p.aR2 = 20 * k; }
          if (fidget === "scratch") { p.aR1 = 8 + 150 * k; p.aR2 = 6 + (110 + Math.sin(fidgetT * 20) * 12) * k; p.head = -6 * k; p.eyeMode = k > 0.5 ? "squint" : "normal"; }
          if (fidgetT > 3) fidget = "";
        }
      },
    };
  });

  // ------------------------------------------------------------ sit on ledge (taskbar/window)
  b.register("sit", (a?: { dur?: number }): Action => ({
    name: "sit", dur: a?.dur ?? Infinity, fps: "idle", priority: 0, blend: 0.35,
    update(_b, t, _dt, p) {
      sit(p, t);
      p.aL1 = -6; p.aR1 = -6; p.aL2 = -30; p.aR2 = -30; // hands resting on knees
      p.torso = Math.sin(t * 0.7) * 1.5;
    },
  }));

  // ------------------------------------------------------------ walk / run to a screen x
  b.register("walk", (a: { x: number; run?: boolean; maxT?: number }): Action => {
    let phase = 0;
    const speed = a.run ? 190 : 72; // css px / s
    return {
      name: a.run ? "run" : "walk", dur: a.maxT ?? 30, fps: "high", priority: 1, blend: 0.18,
      update(b, t, dt, p) {
        const w = b.world;
        const [lo, hi] = w.range();
        const target = clamp(a.x, lo, hi);
        const d = target - w.fx;
        if (Math.abs(d) < 3 * w.scale) return true;
        b.facing = Math.sign(d);
        const accel = Math.min(1, t * 4);
        const step = Math.min(Math.abs(d), speed * w.scale * dt * accel);
        w.fx += Math.sign(d) * step;
        phase += (step / w.scale / (a.run ? 26 : 18)) * Math.PI;
        gait(p, phase, a.run ? 1.6 : 1);
        if (a.run) { p.torso = 9; p.mouth = "open"; p.aL2 += 50; p.aR2 += 50; }
        // little dust puffs when running
        if (a.run && Math.random() < dt * 8) b.fx.emit("dust", CX + p.x - b.facing * 14, 352, { vx: -b.facing * 30, vy: -14, life: 0.5, s: 0.6, s1: 1.2 });
      },
    };
  });

  // ------------------------------------------------------------ jump to a point (e.g. a window top)
  b.register("jumpTo", (a: { x: number; y: number; onLand?: () => void }): Action => {
    let sx = 0, sy = 0, T = 0.8, launched = false;
    return {
      name: "jumpTo", dur: Infinity, fps: "high", priority: 3, blend: 0.12,
      enter(b) { sx = b.world.fx; sy = b.world.fy; b.facing = Math.sign(a.x - sx) || b.facing; b.world.surface = { kind: "air" }; T = clamp(0.55 + Math.hypot(a.x - sx, a.y - sy) / b.world.scale / 1400, 0.6, 1.05); },
      update(b, t, _dt, p) {
        const w = b.world;
        const crouch = 0.28;
        if (t < crouch) { // anticipation
          const k = easeOut(t / crouch);
          p.sy = 1 - 0.16 * k; p.sx = 1 + 0.1 * k;
          p.lL2 = 40 * k; p.lR2 = 40 * k; p.lL1 = -20 * k; p.lR1 = -20 * k;
          p.aL1 = 8 - 30 * k; p.aR1 = 8 - 30 * k; p.eyeMode = "squint"; p.mouth = "flat";
          return;
        }
        if (!launched) { launched = true; b.fx.burst("dust", CX, 352, 5, 60); }
        const k = Math.min(1, (t - crouch) / T);
        const apex = Math.max(90 * w.scale, (sy - a.y) * 0.35 + 60 * w.scale);
        w.fx = sx + (a.x - sx) * k;
        w.fy = sy + (a.y - sy) * k - apex * 4 * k * (1 - k);
        const up = k < 0.5;
        p.sy = up ? 1.14 : 1.04; p.sx = up ? 0.9 : 0.97;
        p.lL1 = 18; p.lR1 = -10; p.lL2 = 30; p.lR2 = 50;
        p.aL1 = 150; p.aR1 = 150; p.aL2 = 20; p.aR2 = 20;
        p.mouth = "open"; p.eyeMode = "wide";
        p.torso = 6;
        if (k >= 1) { a.onLand?.(); return true; }
      },
      exit(b) { b.play("land", { impact: 900 }, { force: true }); },
    };
  });

  // ------------------------------------------------------------ airborne (thrown / fell)
  b.register("airborne", (): Action => {
    const legs = new Spring(0, 40, 4);
    return {
      name: "airborne", dur: Infinity, fps: "high", priority: 5, blend: 0.08, noLook: true,
      update(b, t, dt, p) {
        const w = b.world;
        const still = w.stepAir(dt);
        const vy = w.vy / w.scale, vx = w.vx / w.scale;
        if (Math.abs(vx) > 20) b.facing = Math.sign(vx);
        legs.step(clamp(vy / 30, -30, 30), dt);
        p.rot = clamp(vx / 40, -25, 25);
        p.sy = 1 + clamp(Math.abs(vy) / 4000, 0, 0.12); p.sx = 1 / p.sy;
        p.aL1 = 140 + Math.sin(t * 18) * 25; p.aR1 = 140 + Math.sin(t * 18 + 1.5) * 25;
        p.aL2 = 20; p.aR2 = 20;
        p.lL1 = 20 + legs.x + Math.sin(t * 15) * 15; p.lR1 = -10 - legs.x + Math.sin(t * 15 + 2) * 15;
        p.lL2 = 30; p.lR2 = 30;
        p.eyeMode = vy > 300 ? "wide" : "normal"; p.mouth = vy > 300 ? "yawn" : "open";
        p.pupilY = -0.8; p.lookY = -0.3;
        if (!still) return true; // landing is played from world.onLand
      },
    };
  });

  // ------------------------------------------------------------ landing squash
  b.register("land", (a?: { impact?: number }): Action => {
    const imp = clamp((a?.impact ?? 600) / 2200, 0.15, 1);
    return {
      name: "land", dur: 0.55, fps: "high", priority: 4, blend: 0.04,
      enter(b) { b.fx.burst("dust", CX - 16, 352, 3, 50 * imp + 20); b.fx.burst("dust", CX + 16, 352, 3, 50 * imp + 20); },
      update(_b, t, _dt, p) {
        const k = t / 0.55;
        const sq = Math.exp(-k * 6) * Math.cos(k * 14) * 0.28 * imp;
        p.sy = 1 - sq; p.sx = 1 + sq * 0.8;
        p.lL2 = 40 * imp * (1 - k); p.lR2 = 40 * imp * (1 - k); p.lL1 = -10 * imp * (1 - k); p.lR1 = -10 * imp * (1 - k);
        p.aL1 = 60 * imp * (1 - k) + 8; p.aR1 = 60 * imp * (1 - k) + 8;
        p.eyeMode = k < 0.4 ? "squint" : "normal";
        p.mouth = k < 0.4 ? "flat" : "o";
      },
    };
  });

  // ------------------------------------------------------------ being dragged
  b.register("dragged", (): Action => {
    const sw = new Spring(0, 50, 3.5);
    let lastX = 0;
    return {
      name: "dragged", dur: Infinity, fps: "high", priority: 9, blend: 0.1, noLook: true,
      enter(b) { lastX = b.world.fx; },
      update(b, t, dt, p) {
        const v = (b.world.fx - lastX) / b.world.scale / Math.max(dt, 0.001);
        lastX = b.world.fx;
        const s = sw.step(clamp(-v / 25, -40, 40), dt);
        // hanging from the scruff: whole body pendulum + dangling limbs
        p.y = -8; p.rot = s * 0.6; p.sy = 1.05; p.sx = 0.96;
        p.lL1 = s * 0.6 + Math.sin(t * 6) * 8; p.lR1 = s * 0.6 + Math.sin(t * 6 + 2) * 8;
        p.lL2 = 18 + Math.sin(t * 7) * 10; p.lR2 = 18 + Math.sin(t * 7 + 1) * 10;
        p.aL1 = 30 + s * 0.5 + Math.sin(t * 5) * 6; p.aR1 = 30 - s * 0.5 + Math.sin(t * 5 + 1) * 6;
        p.aL2 = 20; p.aR2 = 20;
        p.head = -s * 0.3;
        p.eyeMode = Math.abs(v) > 600 ? "dizzy" : "wide"; p.mouth = Math.abs(v) > 300 ? "wavy" : "o";
        p.pupilY = 0.6; p.shadow = 0.4;
      },
    };
  });

  // ------------------------------------------------------------ dizzy after a hard landing
  b.register("dizzy", (): Action => ({
    name: "dizzy", dur: 2.6, fps: "high", priority: 3, noLook: true,
    update(b, t, _dt, p) {
      p.rot = Math.sin(t * 5) * 6; p.head = Math.sin(t * 5 + 1) * 10;
      p.headX = Math.cos(t * 5) * 3;
      p.eyeMode = "dizzy"; p.mouth = "wavy";
      p.aL1 = 30 + Math.sin(t * 5) * 10; p.aR1 = 30 - Math.sin(t * 5) * 10;
      p.lL1 = Math.sin(t * 5) * 6; p.lR1 = -Math.sin(t * 5) * 6;
      if (Math.floor(t * 4) !== Math.floor((t - 0.016) * 4) && t < 2) {
        const hc = b.headPos(); const a = t * 5;
        b.fx.emit("star", hc.x + Math.cos(a) * 50, hc.y - 70 + Math.sin(a) * 10, { vx: -Math.sin(a) * 60, vy: -10, life: 0.8, vr: 200, s: 0.9 });
      }
    },
  }));

  // ------------------------------------------------------------ look around (curious)
  b.register("lookAround", (): Action => ({
    name: "lookAround", dur: 3.2, fps: "mid", priority: 1, noLook: true,
    update(_b, t, _dt, p) {
      const k = t / 3.2;
      const lx = k < 0.33 ? -1 : k < 0.66 ? 1 : 0;
      const e = easeInOut(seg(t % 1.07, 0, 0.35));
      p.lookX = lx * 0.8 * e; p.pupilX = lx; p.head = lx * 6 * e;
      armsCrossed(p);
    },
  }));

  // ------------------------------------------------------------ turn & idle on the spot
  b.register("turn", (): Action => ({
    name: "turn", dur: 0.4, fps: "high", priority: 1,
    enter(b) { b.facing = -b.facing; },
    update(_b, t, _dt, p) { p.y = -bump(t / 0.4) * 6; p.lL2 = 20 * bump(t / 0.4); p.lR2 = 20 * bump(t / 0.4); },
  }));

  // ------------------------------------------------------------ peek from screen edge
  b.register("peek", (): Action => {
    let side = 1, baseX = 0, edgeX = 0;
    return {
      name: "peek", dur: 7, fps: "mid", priority: 1,
      enter(b) {
        const m = b.world.monitorAt(b.world.fx).work;
        side = b.world.fx > m.x + m.w / 2 ? 1 : -1;
        baseX = b.world.fx;
        edgeX = side > 0 ? m.x + m.w + 40 * b.world.scale : m.x - 40 * b.world.scale;
      },
      update(b, t, _dt, p) {
        const w = b.world;
        const go = easeInOut(seg(t, 0, 1.4)) * (1 - easeInOut(seg(t, 5.6, 7)));
        w.fx = baseX + (edgeX - baseX) * go;
        b.facing = -side;
        p.rot = side * 12 * go;
        p.torso = side * 6 * go;
        p.lookX = -side * 0.6 * go;
        if (t > 1.4 && t < 5.6) { p.eyeMode = t % 2 < 0.3 ? "squint" : "normal"; p.aR1 = 90 * go; p.aR2 = 60; p.mouth = "smile"; }
        gait(p, t * 8 * (go > 0.02 && go < 0.98 ? 1 : 0), 0.6);
      },
      exit(b) {
        // if interrupted while off-screen, step back in
        const m = b.world.monitorAt(baseX).work;
        b.world.fx = clamp(b.world.fx, m.x + 60 * b.world.scale, m.x + m.w - 60 * b.world.scale);
      },
    };
  });
}

// keep type import alive for consumers
export type { Pose };
