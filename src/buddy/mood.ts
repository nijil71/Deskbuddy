// A slow mood that colours everything the buddy does. Two numbers:
//   v (valence)  -1 glum … +1 delighted — moved by how your day together goes
//   e (energy)    0 sleepy … 1 lively  — follows the clock, naps restore it
// Events nudge v and then it drifts back towards a cheerful baseline over ~2 hours,
// so the buddy is never punished into sadness (no Tamagotchi guilt).
import type { Pose } from "./pose";
import { clamp } from "./pose";
import { energyTarget, type Shift } from "../shared/shift";

const BASE_V = 0.3;

export class Mood {
  /** your working hours; energy follows them (perky at the start, tired after the end) */
  shift: Shift | null = null;
  constructor(public v = BASE_V, public e = 0.8) {}

  /** dt in seconds. Drift valence home; energy follows the time of day. */
  update(dt: number, sleeping: boolean) {
    const k = 1 - Math.exp(-dt / 3600); // back to baseline within ~2h
    this.v += (BASE_V - this.v) * k;
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    // natural daily curve: perky morning, post-lunch dip, tired late evening
    const target = this.shift ? energyTarget(this.shift) : h < 6 ? 0.25 : h < 11 ? 0.9 : h < 13.5 ? 0.8 : h < 15.5 ? 0.6 : h < 19 ? 0.75 : h < 22.5 ? 0.55 : 0.3;
    const ke = 1 - Math.exp(-dt / (sleeping ? 600 : 3600));
    this.e += ((sleeping ? 1 : target) - this.e) * ke;
    this.v = clamp(this.v, -0.6, 1);
    this.e = clamp(this.e, 0.1, 1);
  }

  nudge(dv: number, de = 0) {
    this.v = clamp(this.v + dv, -0.6, 1);
    this.e = clamp(this.e + de, 0.1, 1);
  }

  get label() {
    if (this.e < 0.3) return { icon: "faceSleep", text: "Sleepy" };
    if (this.v > 0.7) return { icon: "faceHappy", text: "Delighted" };
    if (this.v > 0.35) return { icon: "faceSmile", text: "Happy" };
    if (this.v > 0.05) return { icon: "faceCalm", text: "Content" };
    if (this.v > -0.25) return { icon: "faceMeh", text: "A bit bored" };
    return { icon: "faceSad", text: "Missing you" };
  }

  /** Walking pace multiplier: bouncier when happy & lively. */
  get pace() { return 0.8 + 0.25 * this.e + 0.15 * Math.max(0, this.v); }

  /** Colour a calm pose (idle, sit, walk) with the current mood. */
  apply(p: Pose, t: number) {
    const { v, e } = this;
    if (p.mouth === "o") {
      if (v > 0.45) p.mouth = "smile";
      else if (v < -0.2) p.mouth = "flat";
    }
    if (p.eyeMode === "normal") p.eyes *= 0.78 + 0.22 * e;       // heavy lids when tired
    p.blush = Math.max(p.blush, (v - 0.6) * 0.6);                 // rosy when delighted
    p.hipY += (1 - e) * 1.6;                                      // slump a little when tired
    p.head += v < -0.15 ? 4 : 0;                                  // head hangs when glum
    p.y -= v > 0.6 ? Math.max(0, Math.sin(t * 2.4)) * 1.5 : 0;    // tiny happy bounce
    p.aL1 += v > 0.5 ? 3 : 0; p.aR1 += v > 0.5 ? 3 : 0;           // open, relaxed arms
  }
}
