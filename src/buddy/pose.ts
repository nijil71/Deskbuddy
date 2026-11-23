// The pose is a flat bag of animation channels. Actions write targets into it
// each frame; always-on layers (breathing, blinking, look) add on top.

export type EyeMode = "normal" | "happy" | "closed" | "dizzy" | "wide" | "sad" | "squint" | "heart";
export type Mouth = "o" | "smile" | "grin" | "open" | "flat" | "yawn" | "frown" | "wavy" | "tongue" | "shh" | "sip";

export interface Pose {
  x: number; y: number;          // root offset (px)
  rot: number;                   // lean around feet (deg)
  sx: number; sy: number;        // squash & stretch around feet
  face: number;                  // facing: 1 right, -1 left (animated through 0 = turn)
  torso: number;                 // torso tilt (deg)
  hipY: number;                  // body bob
  head: number;                  // head tilt (deg)
  headX: number; headY: number;
  lookX: number; lookY: number;  // -1..1, features parallax (3/4 head turn)
  pupilX: number; pupilY: number;// -1..1 pupil inside eye
  eyes: number;                  // openness 0..1
  eyeMode: EyeMode;
  mouth: Mouth;
  blush: number;
  glassesY: number;              // glasses slipping down the nose
  aL1: number; aL2: number;      // left arm shoulder / elbow (out = +)
  aR1: number; aR2: number;      // right arm
  lL1: number; lL2: number;      // left leg hip (forward = +) / knee
  lR1: number; lR2: number;
  propL: string; propR: string;  // prop ids held in hands
  hat: string;                   // accessory on head ("" = skin default)
  shadow: number;                // ground shadow opacity multiplier
}

export const NUMERIC_KEYS = [
  "x", "y", "rot", "sx", "sy", "face", "torso", "hipY", "head", "headX", "headY", "lookX", "lookY",
  "pupilX", "pupilY", "eyes", "blush", "glassesY", "aL1", "aL2", "aR1", "aR2", "lL1", "lL2", "lR1", "lR2", "shadow",
] as const;
type NumKey = (typeof NUMERIC_KEYS)[number];

export function basePose(): Pose {
  return {
    x: 0, y: 0, rot: 0, sx: 1, sy: 1, face: 1, torso: 0, hipY: 0,
    head: 0, headX: 0, headY: 0, lookX: 0, lookY: 0, pupilX: 0, pupilY: 0,
    eyes: 1, eyeMode: "normal", mouth: "o", blush: 0, glassesY: 0,
    aL1: 8, aL2: 6, aR1: 8, aR2: 6, lL1: 0, lL2: 0, lR1: 0, lR2: 0,
    propL: "", propR: "", hat: "", shadow: 1,
  };
}

export function copyPose(dst: Pose, src: Pose) {
  for (const k of NUMERIC_KEYS) (dst as any)[k] = src[k];
  dst.eyeMode = src.eyeMode; dst.mouth = src.mouth;
  dst.propL = src.propL; dst.propR = src.propR; dst.hat = src.hat;
}

/** Blend numeric channels; discrete channels switch at the halfway point. */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number) {
  for (const k of NUMERIC_KEYS) (out as any)[k] = a[k as NumKey] + (b[k as NumKey] - a[k as NumKey]) * t;
  const d = t < 0.5 ? a : b;
  out.eyeMode = d.eyeMode; out.mouth = d.mouth; out.hat = d.hat;
  out.propL = b.propL || (t < 0.5 ? a.propL : ""); out.propR = b.propR || (t < 0.5 ? a.propR : "");
}

// ------------------------------------------------------------------ easing & motion math

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** 0→1→0 bump over [0,1] */
export const bump = (t: number) => Math.sin(clamp(t, 0, 1) * Math.PI);
/** Phase-windowed progress: maps t in [a,b] to 0..1 */
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(arr: T[]): T => arr[(Math.random() * arr.length) | 0];

/** Critically-damped-ish spring for secondary motion. */
export class Spring {
  v = 0;
  constructor(public x = 0, public k = 120, public d = 12) {}
  step(target: number, dt: number) {
    const a = (target - this.x) * this.k - this.v * this.d;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(v: number) { this.v += v; }
  get settled() { return Math.abs(this.v) < 0.02; }
}
