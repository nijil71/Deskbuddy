// Personality: hobbies, emotions, sleep.
import type { Buddy, Action } from "../buddy";
import { bump, clamp, easeInOut, easeOutBack, pick, rand, seg } from "../pose";
import { armsUp, handToMouth, holdFront, sit, wave } from "./util";
import { CX, GROUND } from "../rig";

const NS = "http://www.w3.org/2000/svg";
const every = (t: number, dt: number, period: number, offset = 0) =>
  Math.floor((t - offset) / period) !== Math.floor((t - offset - dt) / period) && t > offset;

export function registerLife(b: Buddy) {
  // ------------------------------------------------------------ sleep (until woken)
  b.register("sleep", (a?: { sitting?: boolean; cap?: boolean }): Action => ({
    name: "sleep", dur: Infinity, fps: "low", priority: 1, blend: 1.2, noLook: true, noBlink: true,
    update(b, t, dt, p) {
      const sitting = a?.sitting ?? true;
      if (sitting) sit(p, t, 0.15);
      const br = Math.sin(t * 1.3);
      p.head = 16 + br * 2; p.headY = 4 + br; p.torso = 5;
      p.sy *= 1 + br * 0.015;
      p.eyeMode = "closed"; p.mouth = t % 9 < 4.5 ? "o" : "flat";
      p.glassesY = 7;
      p.aL1 = -4; p.aR1 = -4; p.aL2 = -24; p.aR2 = -24;
      p.lookY = 0.4;
      if (a?.cap) p.hat = "nightcap";
      if (every(t, dt, 1.6, 0.8)) {
        const hc = b.headPos();
        b.fx.emit("z", hc.x + 62, hc.y - 104, { vx: 14, vy: -22, life: 2.4, s: 0.5, s1: 1.3, wob: 18 });
      }
    },
  }));

  b.register("wakeUp", (): Action => ({
    name: "wakeUp", dur: 2.4, fps: "high", priority: 2, noLook: true,
    update(b, t, _dt, p) {
      const k = seg(t, 0, 0.6);
      sit(p, t, 0);
      p.y *= 1 - easeInOut(seg(t, 1.6, 2.2));
      if (t < 0.6) { p.eyeMode = "closed"; p.head = 16 * (1 - k); }
      else if (t < 1.6) { // startled stretch
        armsUp(p, bump(seg(t, 0.6, 1.6)), 20); p.mouth = "yawn"; p.eyeMode = "closed"; p.head = -6;
      } else { p.eyeMode = "normal"; p.mouth = "smile"; }
      p.glassesY = 7 * (1 - seg(t, 1.4, 1.8));
      if (t > 1.4 && t < 1.8) handToMouth(p, "R", bump(seg(t, 1.4, 1.8)) * 0.7); // push glasses up
      if (t > 0.6 && t < 0.62) b.fx.emit("bang", b.headPos().x + 50, b.headPos().y - 80, { vy: -30, life: 0.8 });
    },
  }));

  // ------------------------------------------------------------ yawn & stretch
  b.register("yawn", (): Action => ({
    name: "yawn", dur: 2.6, fps: "mid", priority: 1,
    update(b, t, _dt, p) {
      const k = bump(seg(t, 0.1, 2.3));
      p.mouth = k > 0.3 ? "yawn" : "o"; p.eyeMode = k > 0.3 ? "closed" : "normal";
      p.head = -8 * k; p.sy = 1 + 0.03 * k;
      handToMouth(p, "R", k);
      p.aL1 = 8 + 112 * k; p.aL2 = 6 + 26 * k;
      if (t > 2.2 && t < 2.25) b.fx.emit("drop", b.headPos().x - 30, b.headPos().y + 10, { vy: 10, g: 100, life: 0.8 });
    },
  }));

  b.register("stretch", (): Action => ({
    name: "stretch", dur: 4.4, fps: "high", priority: 1,
    update(_b, t, _dt, p) {
      const up = easeInOut(seg(t, 0, 0.8)) * (1 - easeInOut(seg(t, 3.6, 4.4)));
      armsUp(p, up, 8);
      p.sy = 1 + 0.07 * up; p.sx = 1 - 0.03 * up;
      p.y = -4 * up; p.lL2 = 0; p.lR2 = 0;
      const lean = Math.sin(seg(t, 1, 3.4) * Math.PI * 2) * 12 * up;
      p.rot = lean; p.torso = lean * 0.5;
      p.eyeMode = up > 0.5 ? "closed" : "normal";
      p.mouth = up > 0.5 ? (t < 2 ? "yawn" : "smile") : "o";
      p.head = -6 * up;
    },
  }));

  // ------------------------------------------------------------ wave hello
  b.register("wave", (a?: { text?: string }): Action => ({
    name: "wave", dur: 2.2, fps: "high", priority: 2,
    enter(b) { if (a?.text) b.say?.(a.text, { ms: 2600 }); },
    update(_b, t, _dt, p) {
      const k = easeOutBack(seg(t, 0, 0.3)) * (1 - easeInOut(seg(t, 1.9, 2.2)));
      wave(p, t);
      p.aR1 = 8 + (116 - 8) * k;
      p.mouth = "grin"; p.eyeMode = "happy"; p.head = 8 * k; p.blush = 0.3 * k;
      p.y = -bump(seg(t, 0, 0.35)) * 6;
    },
  }));

  // ------------------------------------------------------------ celebrate
  b.register("celebrate", (a?: { text?: string; hat?: boolean }): Action => ({
    name: "celebrate", dur: 2.8, fps: "high", priority: 3,
    enter(b) {
      b.fx.burst("confetti", CX, 150, 22, 220);
      if (a?.text) b.say?.(a.text, { ms: 3000 });
    },
    update(b, t, dt, p) {
      const hop = (tt: number) => { const k = seg(t, tt, tt + 0.55); return bump(k); };
      const h = Math.max(hop(0.2), hop(0.9), hop(1.6));
      p.y = -h * 34;
      p.sy = 1 + (h > 0.1 ? 0.08 : -0.08 * (1 - h)); p.sx = 2 - p.sy;
      armsUp(p, 1, 30 - h * 20);
      p.aL2 = 30 + Math.sin(t * 20) * 12; p.aR2 = 30 + Math.sin(t * 20 + 1) * 12;
      p.lL2 = h * 40; p.lR2 = h * 40; p.lL1 = h * 10; p.lR1 = -h * 10;
      p.mouth = "grin"; p.eyeMode = "happy"; p.blush = 0.5;
      if (a?.hat) p.hat = "party";
      if (every(t, dt, 0.7, 0.2)) b.fx.burst("star", CX, 190, 2, 120);
    },
  }));

  // ------------------------------------------------------------ hobbies
  b.register("read", (): Action => ({
    name: "read", dur: rand(12, 20), fps: "idle", priority: 1, noLook: true, blend: 0.4,
    update(b, t, dt, p) {
      sit(p, t, 0.4);
      holdFront(p);
      p.propR = "book";
      p.lookY = 0.5; p.pupilY = 0.9; p.head = 6;
      p.pupilX = Math.sin(t * 1.6) * 0.7; // eyes scan lines
      const flip = t % 5 > 4.3;
      if (flip) { p.aL1 = -48 + Math.sin(((t % 5) - 4.3) / 0.7 * Math.PI) * 40; }
      p.mouth = t % 8 < 1 ? "smile" : "o";
      if (every(t, dt, 5, 4.6)) b.fx.emit("spark", CX + 18, GROUND - 24, { vy: -30, life: 0.5, s: 0.6 });
    },
  }));

  b.register("juggle", (): Action => {
    let g: SVGGElement | null = null;
    const balls: SVGElement[] = [];
    return {
      name: "juggle", dur: rand(7, 11), fps: "high", priority: 1, noLook: true,
      enter(b) {
        g = document.createElementNS(NS, "g") as SVGGElement;
        for (let i = 0; i < 3; i++) {
          const c = document.createElementNS(NS, "circle");
          c.setAttribute("r", "6");
          c.setAttribute("fill", ["#e5484d", "#f4c542", "#3e63dd"][i]);
          c.setAttribute("stroke", "var(--ink)");
          c.setAttribute("stroke-width", "2.4");
          g.appendChild(c); balls.push(c as SVGElement);
        }
        b.rig.fx.appendChild(g);
      },
      update(_b, t, _dt, p) {
        const sp = 3.6;
        const ph = t * sp;
        // hands alternate tossing
        p.aL1 = -36; p.aR1 = -36;
        p.aL2 = -56 + Math.sin(ph * 2) * 18; p.aR2 = -56 - Math.sin(ph * 2) * 18;
        // balls orbit up and around the big head, caught low between the hands
        const cx = CX + p.x, hy = GROUND + p.y - 46;
        balls.forEach((c, i) => {
          const th = -Math.PI / 2 + ph + (i * Math.PI * 2) / 3;
          const x = cx + Math.cos(th) * 74;
          const y = hy - 104 - Math.sin(th) * 112;
          c.setAttribute("cx", x.toFixed(1)); c.setAttribute("cy", y.toFixed(1));
        });
        const top = balls.reduce((m, c) => Math.min(m, +c.getAttribute("cy")!), 999);
        p.pupilY = clamp((top - (GROUND + p.y - 220)) / 60, -1, 1);
        p.lookY = -0.2;
        p.mouth = "tongue"; p.eyeMode = "normal";
        p.y = -Math.abs(Math.sin(ph)) * 2;
      },
      exit() { g?.remove(); },
    };
  });

  b.register("music", (): Action => ({
    name: "music", dur: rand(10, 16), fps: "mid", priority: 1, noLook: true,
    update(b, t, dt, p) {
      const beat = t * 2.2 * Math.PI;
      p.hat = "headphones";
      p.head = Math.sin(beat) * 7; p.headY = Math.abs(Math.sin(beat)) * 2;
      p.torso = Math.sin(beat) * 3;
      p.rot = Math.sin(beat / 2) * 2;
      p.eyeMode = "closed"; p.mouth = Math.sin(beat / 2) > 0 ? "o" : "smile";
      p.aL1 = 20 + Math.sin(beat) * 12; p.aR1 = 20 - Math.sin(beat) * 12; p.aL2 = 40; p.aR2 = 40;
      p.lR1 = -4; p.lR2 = Math.max(0, Math.sin(beat)) * 22; // foot tap
      if (every(t, dt, 0.9)) {
        const hc = b.headPos();
        b.fx.emit("note", hc.x + pick([-70, 70]), hc.y - 20, { vx: rand(-15, 15), vy: -40, life: 1.8, wob: 30, s: 0.9 });
      }
    },
  }));

  b.register("doodle", (): Action => ({
    name: "doodle", dur: 9, fps: "mid", priority: 1, noLook: true, blend: 0.4,
    enter(b) { setTimeout(() => b.actionName === "doodle" && b.say?.(pick(["Drew you a cat. 🐱", "Masterpiece. ✏️", "It's abstract.", "Modern art!"]), { ms: 2600 }), 7600); },
    update(_b, t, _dt, p) {
      sit(p, t, 0.3);
      const show = t > 7.4;
      p.propL = "paper"; p.propR = "pencil";
      if (!show) {
        p.aL1 = -40; p.aL2 = -66;
        p.aR1 = -30 + Math.sin(t * 13) * 6; p.aR2 = -60 + Math.cos(t * 17) * 10;
        p.lookY = 0.6; p.pupilY = 1; p.pupilX = -0.4; p.head = 8;
        p.mouth = t % 3 < 1.5 ? "tongue" : "o";
      } else {
        const k = easeOutBack(seg(t, 7.4, 7.8));
        p.aL1 = -40 + 118 * k; p.aL2 = -66 + 130 * k; p.aR1 = 10; p.aR2 = 10;
        p.mouth = "grin"; p.eyeMode = "happy"; p.blush = 0.4;
      }
    },
  }));

  b.register("yoyo", (): Action => ({
    name: "yoyo", dur: 7, fps: "high", priority: 1, noLook: true,
    update(b, t, _dt, p) {
      const ph = (t * 1.6) % 1;
      const len = Math.sin(ph * Math.PI) * 46; // down and back
      p.propR = "yoyo";
      p.aR1 = 40; p.aR2 = -40 - Math.max(0, Math.cos(ph * Math.PI * 2)) * 20;
      p.pupilY = 0.4 + len / 60; p.pupilX = 0.6;
      p.mouth = "o";
      const disc = b.rig.svg.querySelector(".prop-yoyo .yoyo-disc");
      const str = b.rig.svg.querySelector(".prop-yoyo path");
      disc?.setAttribute("transform", `translate(0,${(len - 20).toFixed(1)}) rotate(${(t * 900) % 360},0,24)`);
      str?.setAttribute("d", `M0 0 V${(len + 2).toFixed(1)}`);
    },
  }));

  b.register("coffee", (a?: { text?: string }): Action => ({
    name: "coffee", dur: 7, fps: "mid", priority: 1,
    enter(b) { if (a?.text) b.say?.(a.text, { ms: 3000 }); },
    update(b, t, dt, p) {
      p.propR = "mug";
      const sipK = Math.max(bump(seg(t, 1.2, 2.8)), bump(seg(t, 4.2, 5.8)));
      p.aR1 = -40 + (-100) * sipK; p.aR2 = -60 + 90 * sipK;
      p.mouth = sipK > 0.6 ? "sip" : t > 3 ? "smile" : "o";
      p.eyeMode = sipK > 0.6 ? "closed" : t > 3 ? "happy" : "normal";
      p.head = -4 * sipK; p.blush = 0.25 * sipK;
      if (every(t, dt, 0.7)) b.fx.emit("steam", CX + 26, GROUND - 80 - sipK * 30, { vy: -24, life: 1.4, wob: 12, s: 0.8, s1: 1.2 });
    },
  }));

  b.register("think", (a?: { text?: string }): Action => ({
    name: "think", dur: 4, fps: "mid", priority: 1, noLook: true,
    enter(b) { b.say?.(a?.text ?? "Hmm…", { ms: 3600, thought: true }); },
    update(b, t, dt, p) {
      handToMouth(p, "R", 0.85);
      p.aL1 = -50; p.aL2 = -80;
      p.pupilY = -1; p.pupilX = 0.6; p.lookY = -0.3; p.head = -5;
      p.mouth = "flat";
      if (every(t, dt, 3.3)) { const hc = b.headPos(); b.fx.emit("bulb", hc.x + 30, hc.y - 110, { vy: -10, life: 1.2, s: 1.2 }); }
    },
  }));

  // ------------------------------------------------------------ reactions to you
  b.register("pet", (): Action => ({
    name: "pet", dur: 2.6, fps: "high", priority: 4,
    update(b, t, dt, p) {
      const k = easeInOut(seg(t, 0, 0.3)) * (1 - easeInOut(seg(t, 2.2, 2.6)));
      p.eyeMode = "happy"; p.mouth = "smile"; p.blush = 0.8 * k;
      p.head = Math.sin(t * 6) * 8 * k; p.rot = Math.sin(t * 6) * 3 * k;
      p.sy = 1 - 0.04 * k;
      p.aL1 = -30 * k; p.aR1 = -30 * k; p.aL2 = -60 * k; p.aR2 = -60 * k;
      p.lL2 = Math.max(0, Math.sin(t * 8)) * 14 * k;
      if (every(t, dt, 0.5)) b.fx.emit("heart", CX + rand(-40, 40), 120, { vy: -40, life: 1.4, wob: 20, s: 0.8, s1: 1.1 });
    },
  }));

  b.register("poke", (a?: { kind?: "startle" | "giggle" | "huh" }): Action => {
    const kind = a?.kind ?? pick(["startle", "giggle", "huh"]);
    return {
      name: "poke", dur: 1.6, fps: "high", priority: 4,
      enter(b) { const hc = b.headPos(); b.fx.emit(kind === "huh" ? "q" : "bang", hc.x + 52, hc.y - 80, { vy: -30, life: 0.9 }); },
      update(_b, t, _dt, p) {
        if (kind === "startle") {
          const k = bump(seg(t, 0, 0.5));
          p.y = -k * 26; p.sy = 1 + k * 0.1; armsUp(p, k, 40); p.eyeMode = t < 0.9 ? "wide" : "normal"; p.mouth = t < 0.9 ? "open" : "smile";
          p.lL2 = k * 30; p.lR2 = k * 30;
        } else if (kind === "giggle") {
          p.eyeMode = "happy"; p.mouth = "grin"; p.rot = Math.sin(t * 24) * 3 * (1 - t / 1.6); p.blush = 0.5;
          handToMouth(p, "R", bump(t / 1.6));
        } else {
          p.head = 14 * bump(t / 1.6); p.eyeMode = "normal"; p.mouth = "o"; p.pupilY = -0.3;
          p.aR1 = 8 + 50 * bump(t / 1.6); p.aR2 = 60 * bump(t / 1.6);
        }
      },
    };
  });

  b.register("shh", (a?: { text?: string }): Action => ({
    name: "shh", dur: 3, fps: "mid", priority: 2,
    enter(b) { b.say?.(a?.text ?? "Shh… you're in a call 🤫", { ms: 2800 }); },
    update(_b, t, _dt, p) {
      const k = easeOutBack(seg(t, 0, 0.4)) * (1 - easeInOut(seg(t, 2.5, 3)));
      handToMouth(p, "R", k);
      p.aR2 += 10;
      p.mouth = "shh"; p.eyeMode = k > 0.5 ? "squint" : "normal"; p.head = 6 * k;
      p.sy = 1 - 0.03 * k;
    },
  }));

  // calm "quiet mode" idle while you're in a meeting: sits very still
  b.register("quiet", (): Action => ({
    name: "quiet", dur: Infinity, fps: "low", priority: 0, blend: 0.8, lookWeight: 0.3,
    update(_b, t, _dt, p) {
      sit(p, t, 0.15);
      p.aL1 = -6; p.aR1 = -6; p.aL2 = -30; p.aR2 = -30;
      p.mouth = "flat";
    },
  }));

  b.register("hideDuck", (): Action => ({
    name: "hideDuck", dur: 0.5, fps: "high", priority: 8,
    update(_b, t, _dt, p) {
      const k = easeInOut(t / 0.5);
      p.y = k * 120; p.sy = 1 - 0.1 * bump(t / 0.5); p.eyeMode = "squint";
    },
  }));

  b.register("popUp", (): Action => ({
    name: "popUp", dur: 0.8, fps: "high", priority: 3,
    update(_b, t, _dt, p) {
      const k = easeOutBack(seg(t, 0, 0.6));
      p.y = (1 - k) * 120; p.sy = 1 + 0.08 * bump(seg(t, 0.3, 0.8)); p.mouth = "smile";
    },
  }));
}
