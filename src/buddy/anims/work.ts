// Useful stuff: keep-alive nudge, focus, reminders, system reactions, utilities.
import { invoke } from "@tauri-apps/api/core";
import type { Buddy, Action } from "../buddy";
import { bump, clamp, easeInOut, easeOutBack, rand, seg } from "../pose";
import { armsUp, gait, handToMouth, holdFront, holdSign, sit, typing } from "./util";
import { CX, GROUND } from "../rig";
import { typeTaps } from "./play";

const every = (t: number, dt: number, period: number, offset = 0) =>
  Math.floor((t - offset) / period) !== Math.floor((t - offset - dt) / period) && t > offset;

export function registerWork(b: Buddy) {
  // ------------------------------------------------------------ Teams keep-alive nudge
  // Walk/run towards the cursor, push it (real 1px move + F15), dust off hands.
  b.register("nudge", (): Action => {
    let phase = 0, stage: "notice" | "go" | "push" | "dust" = "notice", st = 0, pushed = false;
    return {
      name: "nudge", dur: 14, fps: "high", priority: 6, noLook: false,
      update(b, t, dt, p) {
        const w = b.world;
        st += dt;
        const cur = b.cursorLocal;
        if (stage === "notice") {
          p.eyeMode = "wide"; p.mouth = "o"; p.y = -bump(st / 0.4) * 8;
          if (st < 0.05) b.fx.emit("bang", b.headPos().x + 50, b.headPos().y - 80, { vy: -30, life: 0.8 });
          if (st > 0.6) { stage = "go"; st = 0; }
          return;
        }
        if (stage === "go") {
          // walk under the cursor (screen x), but never more than ~3.5s
          const o = w.windowOrigin();
          const targetX = o.x + cur.x * w.scale - 60 * w.scale * Math.sign(cur.x - CX || 1);
          const [lo, hi] = w.range();
          const tx = clamp(targetX, lo, hi);
          const d = tx - w.fx;
          if (Math.abs(d) < 6 * w.scale || st > 3.5) { stage = "push"; st = 0; b.facing = Math.sign(cur.x - CX) || b.facing; return; }
          b.facing = Math.sign(d);
          const run = Math.abs(d) > 260 * w.scale;
          const step = Math.min(Math.abs(d), (run ? 210 : 90) * w.scale * dt);
          w.fx += Math.sign(d) * step;
          phase += (step / w.scale / (run ? 26 : 18)) * Math.PI;
          gait(p, phase, run ? 1.6 : 1);
          p.mouth = "open"; p.eyeMode = "normal";
          return;
        }
        if (stage === "push") {
          const k = st / 1.3;
          const wind = easeInOut(seg(k, 0, 0.35));
          const shove = easeOutBack(seg(k, 0.35, 0.55));
          const back = easeInOut(seg(k, 0.7, 1));
          const ext = (wind * 0.4 + shove * 0.6) * (1 - back);
          // both arms thrust towards the facing side
          p.aR1 = 8 + 90 * ext; p.aR2 = 6 - 10 * ext;
          p.aL1 = 8 - 80 * ext; p.aL2 = 6 + 20 * ext;
          p.torso = -6 * wind + 14 * shove * (1 - back);
          p.lL1 = 18 * shove * (1 - back); p.lR1 = -22 * shove * (1 - back); p.lR2 = 10 * shove;
          p.eyeMode = shove > 0.3 && back < 0.5 ? "squint" : "normal";
          p.mouth = shove > 0.3 && back < 0.5 ? "grin" : "flat";
          if (!pushed && k > 0.45) {
            pushed = true;
            invoke("do_nudge").catch(() => {});
            b.fx.burst("spark", CX + b.facing * 44, GROUND - 70, 4, 90);
          }
          if (k >= 1) { stage = "dust"; st = 0; }
          return;
        }
        // dust off hands, thumbs-up
        const k = st / 1.6;
        const clap = Math.abs(Math.sin(st * 18)) * (1 - seg(k, 0.5, 0.6));
        p.aL1 = -40 + clap * 10; p.aR1 = -40 + clap * 10; p.aL2 = -50; p.aR2 = -50;
        if (k > 0.6) { p.aR1 = 78; p.aR2 = 74; p.aL1 = 8; p.aL2 = 6; }
        p.eyeMode = "happy"; p.mouth = "smile";
        if (st < dt * 1.5) { b.fx.burst("dust", CX, GROUND - 60, 4, 40); b.say?.("Still green ✓", { ms: 1800 }); }
        if (k >= 1) return true;
      },
      exit() { if (!pushed) invoke("do_nudge").catch(() => {}); },
    };
  });

  // ------------------------------------------------------------ focus session (typing on laptop)
  b.register("focus", (a?: { dur?: number }): Action => ({
    name: "focus", dur: a?.dur ?? Infinity, fps: "idle", priority: 2, noLook: true, scene: "laptop", blend: 0.45,
    update(b, t, dt, p) {
      sit(p, t, 0.1);
      p.hat = "headphones";
      typeTaps(p, b, t); // in time with your real keystrokes
      p.mouth = t % 12 < 1 ? "tongue" : "flat";
      if (t % 14 > 12.6) { p.aR1 = -140; p.aR2 = 40; p.pupilY = 0; p.lookY = 0; } // sip/think pause
      if (every(t, dt, 3.2)) b.fx.emit("note", CX + rand(-70, 70), 140, { vy: -30, life: 1.6, wob: 25, s: 0.7 });
    },
  }));

  b.register("breakTime", (a?: { text?: string }): Action => ({
    name: "breakTime", dur: 5, fps: "high", priority: 3,
    enter(b) { b.say?.(a?.text ?? "Break time! Stretch with me 🙆", { ms: 4600 }); },
    update(_b, t, _dt, p) {
      const up = easeInOut(seg(t, 0, 0.6)) * (1 - easeInOut(seg(t, 4.3, 5)));
      armsUp(p, up, 10);
      const lean = Math.sin(seg(t, 0.8, 4.2) * Math.PI * 4) * 14 * up;
      p.rot = lean; p.torso = lean * 0.6; p.sy = 1 + 0.05 * up;
      p.eyeMode = "happy"; p.mouth = "smile";
    },
  }));

  // ------------------------------------------------------------ wellbeing reminders
  b.register("drink", (a?: { text?: string }): Action => ({
    name: "drink", dur: 5, fps: "mid", priority: 3,
    enter(b) { b.say?.(a?.text ?? "Water break! 💧", { ms: 4800 }); },
    update(b, t, dt, p) {
      p.propR = "bottle";
      const k = bump(seg(t, 0.8, 3.6));
      handToMouth(p, "R", Math.min(1, k * 1.3));
      p.head = -14 * k; p.lookY = -0.4 * k;
      p.mouth = k > 0.4 ? "sip" : "smile"; p.eyeMode = k > 0.4 ? "closed" : "happy";
      p.aL1 = 30 * k + 8;
      if (k > 0.5 && every(t, dt, 0.35)) b.fx.emit("drop", CX + 8, 190, { vx: rand(-20, 20), vy: -40, g: 300, life: 0.7 });
      if (t > 3.8 && t < 3.85) b.fx.emit("sweat", CX - 46, 205, { vy: -20, life: 0.8 });
    },
  }));

  b.register("eyeBreak", (a?: { secs?: number }): Action => {
    const secs = a?.secs ?? 20;
    return {
      name: "eyeBreak", dur: secs + 2, fps: "idle", priority: 3, noLook: true,
      enter(b) { b.say?.(`👀 20-20-20: look ~6 m away for ${secs}s`, { ms: 3500 }); },
      update(b, t, dt, p) {
        p.propR = "binoculars";
        const k = easeInOut(seg(t, 0, 0.6)) * (1 - easeInOut(seg(t, secs + 1.3, secs + 2)));
        p.aR1 = 8 + (-150) * k; p.aR2 = 6 + 34 * k;
        p.aL1 = 8 + (-140) * k; p.aL2 = 6 + 30 * k;
        p.lookX = Math.sin(t * 0.4) * 0.5 * k; p.head = Math.sin(t * 0.4) * 6 * k;
        p.eyeMode = k > 0.5 ? "squint" : "normal"; p.mouth = "o";
        if (Math.floor(t) !== Math.floor(t - dt) && t > 3 && t < secs) b.say?.(`${Math.ceil(secs - t)}…`, { ms: 1100 });
        if (t > secs && t - dt <= secs) b.say?.("Eyes refreshed ✨", { ms: 1800 });
      },
    };
  });

  b.register("posture", (): Action => ({
    name: "posture", dur: 4, fps: "mid", priority: 3,
    enter(b) { b.say?.("Posture check! Sit tall 🪑", { ms: 3600 }); },
    update(_b, t, _dt, p) {
      const slouch = 1 - easeOutBack(seg(t, 0.8, 1.4));
      p.torso = 7 * slouch; p.head = 9 * slouch; p.sy = 1 - 0.06 * slouch; p.hipY = 3 * slouch;
      p.eyeMode = slouch > 0.5 ? "sad" : "happy"; p.mouth = slouch > 0.5 ? "frown" : "smile";
      if (slouch < 0.5) { p.sy = 1.04; p.aR1 = 78; p.aR2 = 74; }
    },
  }));

  b.register("holdSign", (a: { text: string; dur?: number; say?: string }): Action => ({
    name: "holdSign", dur: a.dur ?? 6, fps: "mid", priority: 4, scene: "sign",
    enter(b) { b.rig.setSceneText(a.text); if (a.say) b.say?.(a.say, { ms: (a.dur ?? 6) * 1000 }); },
    update(b, t, _dt, p) {
      b.rig.setSceneText(a.text);
      const bob = Math.sin(t * 5) * 4;
      holdSign(p, bob);
      p.y = -Math.abs(Math.sin(t * 5)) * 3;
      p.mouth = "open"; p.eyeMode = "normal";
      p.lookY = -0.1;
    },
  }));

  b.register("holdNote", (a: { text: string }): Action => ({
    name: "holdNote", dur: 6, fps: "mid", priority: 3,
    enter(b) { b.say?.(`📝 ${a.text}`, { ms: 6000 }); },
    update(_b, t, _dt, p) {
      p.propR = "paper";
      const k = easeOutBack(seg(t, 0, 0.5));
      p.aR1 = 8 + 70 * k; p.aR2 = 6 + 64 * k;
      p.mouth = "smile"; p.head = 6;
    },
  }));

  // ------------------------------------------------------------ system awareness
  b.register("sweaty", (a?: { cpu?: number }): Action => ({
    name: "sweaty", dur: 6, fps: "mid", priority: 2,
    enter(b) { b.say?.(`Phew, CPU at ${Math.round(a?.cpu ?? 90)}%… 🥵`, { ms: 3200 }); },
    update(b, t, dt, p) {
      p.propR = "fan";
      p.aR1 = 70 + Math.sin(t * 16) * 10; p.aR2 = 80;
      p.mouth = "open"; p.eyeMode = "squint"; p.head = -4;
      p.sy = 1 + Math.sin(t * 9) * 0.01;
      if (every(t, dt, 0.45)) b.fx.emit("sweat", CX + rand(-56, 56), rand(150, 200), { vy: 20, g: 200, life: 0.9 });
    },
  }));

  b.register("heavyBox", (a?: { mem?: number }): Action => ({
    name: "heavyBox", dur: 6, fps: "mid", priority: 2, scene: "box",
    enter(b) { b.say?.(`Memory at ${a?.mem ?? 90}%! This is heavy 📦`, { ms: 3200 }); },
    update(b, t, dt, p) {
      holdSign(p, Math.sin(t * 10) * 3);
      p.aL1 = 46; p.aR1 = 46;
      p.sy = 0.95 + Math.sin(t * 10) * 0.015; p.rot = Math.sin(t * 3) * 3;
      p.lL1 = 8; p.lR1 = -8; p.lL2 = 18 + Math.sin(t * 10) * 4; p.lR2 = 18 - Math.sin(t * 10) * 4;
      p.mouth = "wavy"; p.eyeMode = "squint";
      if (every(t, dt, 0.8)) b.fx.emit("sweat", CX + rand(-50, 50), 170, { vy: 20, g: 200, life: 0.8 });
    },
  }));

  b.register("lowBattery", (a?: { pct?: number }): Action => ({
    name: "lowBattery", dur: 6, fps: "mid", priority: 3,
    enter(b) { b.say?.(`Battery ${a?.pct ?? 15}%… plug me in? 🔌`, { ms: 4000 }); },
    update(_b, t, _dt, p) {
      const k = easeInOut(seg(t, 0, 1));
      p.torso = 6 * k; p.head = 11 * k; p.sy = 1 - 0.07 * k; p.hipY = 3 * k;
      p.aL1 = 2; p.aR1 = 2; p.aL2 = 0; p.aR2 = 0;
      p.eyes = 0.45; p.mouth = "frown"; p.glassesY = 4 * k;
      if (t > 2.5) { p.propR = "plug"; p.aR1 = 60; p.aR2 = 50; p.head = 6; p.eyes = 0.7; }
    },
  }));

  b.register("charging", (): Action => ({
    name: "charging", dur: 2.6, fps: "high", priority: 3,
    enter(b) { b.say?.("⚡ Charging! Ahh, that's better.", { ms: 2400 }); b.fx.burst("spark", CX, 220, 8, 140); },
    update(_b, t, _dt, p) {
      const h = Math.max(bump(seg(t, 0, 0.5)), bump(seg(t, 0.6, 1.1)));
      p.y = -h * 20; armsUp(p, h, 20); p.eyeMode = "happy"; p.mouth = "grin";
    },
  }));

  // ------------------------------------------------------------ utilities
  b.register("camera", (a?: { then?: () => void }): Action => {
    let snapped = false;
    return {
      name: "camera", dur: 2.4, fps: "high", priority: 4,
      update(b, t, _dt, p) {
        p.propR = "camera";
        const k = easeOutBack(seg(t, 0, 0.5));
        p.aR1 = 8 + (-150 - 8) * k; p.aR2 = 6 + (38 - 6) * k;
        p.aL1 = 8 + (-130) * k; p.aL2 = 6 + 30 * k;
        p.eyeMode = t > 0.9 ? "squint" : "normal"; p.mouth = t > 1.2 ? "grin" : "flat";
        if (!snapped && t > 1.1) {
          snapped = true;
          b.fx.burst("spark", CX, 190, 10, 160);
          const flash = document.getElementById("flash");
          flash?.classList.remove("go"); void flash?.getBoundingClientRect(); flash?.classList.add("go");
          setTimeout(() => a?.then?.(), 250);
        }
      },
    };
  });

  b.register("catchPaper", (a?: { text?: string }): Action => {
    let paper: SVGGElement | null = null;
    const from = Math.random() < 0.5 ? -1 : 1;
    return {
      name: "catchPaper", dur: 2.4, fps: "high", priority: 2,
      enter(b) {
        paper = document.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
        paper.innerHTML = `<path d="M-9 -7 h14 l4 4 v10 h-18z" fill="var(--paper)" stroke="var(--ink)" stroke-width="2"/><path d="M-5 -2 h10 M-5 2 h8" stroke="var(--ink)" stroke-width="1.2"/>`;
        b.rig.fx.appendChild(paper);
        b.facing = from;
      },
      update(b, t, _dt, p) {
        const k = seg(t, 0, 0.7);
        const hx = CX + p.x + from * 30, hy = GROUND + p.y - 74;
        const x = hx + from * (1 - k) * 150, y = hy - Math.sin(k * Math.PI) * 50 - (1 - k) * 20;
        if (paper) {
          if (t < 0.7) paper.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(1 - k) * 360 * from})`);
          else paper.style.display = "none";
        }
        p.eyeMode = t < 0.7 ? "wide" : "happy";
        p.pupilX = from * (1 - k);
        if (t > 0.6) { p.propR = "paper"; p.aR1 = 8 + 68 * easeOutBack(seg(t, 0.6, 0.9)); p.aR2 = 60; p.mouth = "smile"; }
        else { p.aR1 = 60; p.aR2 = 30; p.mouth = "o"; }
        if (t > 0.7 && t < 0.75 && a?.text) b.say?.(`📋 ${a.text}`, { ms: 1800 });
      },
      exit() { paper?.remove(); },
    };
  });

  b.register("weather", (a: { kind: "rain" | "snow" | "sun" | "cloud" | "storm"; text: string }): Action => ({
    name: "weather", dur: 6, fps: "mid", priority: 2,
    enter(b) { b.say?.(a.text, { ms: 5000 }); },
    update(b, t, dt, p) {
      if (a.kind === "rain" || a.kind === "storm") {
        p.propR = "umbrella"; p.aR1 = 34; p.aR2 = -10; p.mouth = "flat"; p.lookY = -0.3; p.pupilY = -0.7;
        if (every(t, dt, 0.08)) b.fx.emit("drop", CX + rand(-120, 120), 40, { vy: 280, life: 0.5 });
      } else if (a.kind === "snow") {
        p.mouth = "o"; p.eyeMode = "happy"; p.rot = Math.sin(t * 20) * 1.2; // shiver
        if (every(t, dt, 0.18)) b.fx.emit("flake", CX + rand(-120, 120), 40, { vy: 50, life: 3, wob: 30, vr: 90 });
      } else if (a.kind === "sun") {
        p.hat = "sunglasses"; p.aR1 = 78; p.aR2 = 74; p.mouth = "grin"; p.head = 6;
      } else { p.pupilY = -1; p.lookY = -0.4; p.mouth = "o"; }
    },
  }));

  b.register("magic", (): Action => ({
    name: "magic", dur: 2.6, fps: "high", priority: 2,
    update(b, t, dt, p) {
      p.propR = "wand";
      p.aR1 = 72 + Math.sin(t * 8) * 22; p.aR2 = 50;
      p.eyeMode = "happy"; p.mouth = "grin";
      if (every(t, dt, 0.12)) b.fx.emit("star", CX + 60 + rand(-20, 20), 180 + rand(-30, 30), { vx: rand(-50, 50), vy: rand(-60, 0), life: 0.8, vr: 300, s: 0.6 });
    },
  }));

  b.register("holdPhone", (a?: { text?: string }): Action => ({
    name: "holdPhone", dur: 4, fps: "mid", priority: 2,
    enter(b) { if (a?.text) b.say?.(a.text, { ms: 3800 }); },
    update(_b, t, _dt, p) {
      holdFront(p); p.aL1 = 8; p.aL2 = 6;
      p.propR = "phone"; p.pupilY = 0.8; p.lookY = 0.4; p.head = 6;
      p.mouth = t % 2 < 1 ? "o" : "smile";
    },
  }));
}
