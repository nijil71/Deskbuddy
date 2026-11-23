// Reusable body-language building blocks for actions.
import type { Pose } from "../pose";
import { SIT_Y } from "../rig";

/** Walk/run cycle. phase in radians; amp 1 = walk, ~1.5 = run. */
export function gait(p: Pose, phase: number, amp = 1) {
  const s = Math.sin(phase), c = Math.cos(phase);
  p.lL1 = s * 26 * amp;
  p.lR1 = -s * 26 * amp;
  p.lL2 = Math.max(0, -c) * 34 * amp;
  p.lR2 = Math.max(0, c) * 34 * amp;
  p.aL1 = 12 + s * 12 * amp;
  p.aR1 = 12 - s * 12 * amp;
  p.aL2 = 10 + Math.max(0, s) * 20 * amp;
  p.aR2 = 10 + Math.max(0, -s) * 20 * amp;
  p.hipY = -Math.abs(c) * 3 * amp;
  p.y += -Math.abs(c) * 2.5 * (amp - 0.7);
  p.torso = 3 * amp;
  p.head = -Math.sin(phase * 2) * 1.5;
}

/** Sitting on an edge: hips on the ground line, legs dangling & swinging. */
export function sit(p: Pose, t: number, swing = 1) {
  p.y += SIT_Y;
  p.lL1 = 14 + Math.sin(t * 2.2) * 14 * swing;
  p.lR1 = 14 + Math.sin(t * 2.2 + 2.2) * 14 * swing;
  p.lL2 = 4 + Math.max(0, Math.sin(t * 2.2 + 1)) * 12 * swing;
  p.lR2 = 4 + Math.max(0, Math.sin(t * 2.2 + 3.2)) * 12 * swing;
  p.shadow = 0;
}

/** Hand near the mouth (right arm by default). */
export function handToMouth(p: Pose, side: "L" | "R" = "R", k = 1) {
  if (side === "R") { p.aR1 = 8 + (-142 - 8) * k; p.aR2 = 6 + (36 - 6) * k; }
  else { p.aL1 = 8 + (-142 - 8) * k; p.aL2 = 6 + (36 - 6) * k; }
}

/** Both hands held in front of the chest (book, phone…) */
export function holdFront(p: Pose, k = 1) {
  p.aL1 = 8 + (-48 - 8) * k; p.aL2 = 6 + (-62 - 6) * k;
  p.aR1 = 8 + (-48 - 8) * k; p.aR2 = 6 + (-62 - 6) * k;
}

/** Hands at chest-height to the sides holding a sign. */
export function holdSign(p: Pose, bob = 0) {
  // hands grip the sign's lower corners, clear of the text
  p.aL1 = 44 + bob; p.aL2 = -10;
  p.aR1 = 44 + bob; p.aR2 = -10;
}

/** Arms raised: the rig stretches them and tucks them behind the head, so the hands
 *  pop out beside the ears ("banzai"). spread opens them a little wider. */
export function armsUp(p: Pose, k = 1, spread = 0) {
  const a1 = 118 + spread * 0.15, a2 = 34;
  p.aL1 = 8 + (a1 - 8) * k; p.aL2 = 6 + (a2 - 6) * k;
  p.aR1 = 8 + (a1 - 8) * k; p.aR2 = 6 + (a2 - 6) * k;
}

/** One arm raised to the side for a wave; returns nothing, oscillates the forearm. */
export function wave(p: Pose, t: number, side: "L" | "R" = "R") {
  const w = Math.sin(t * 14) * 26;
  if (side === "R") { p.aR1 = 116; p.aR2 = 34 + w; }
  else { p.aL1 = 116; p.aL2 = 34 + w; }
}

/** Typing on a laptop on the lap. */
export function typing(p: Pose, t: number, speed = 1) {
  p.aL1 = -14; p.aR1 = -14;
  p.aL2 = -38 + Math.max(0, Math.sin(t * 22 * speed)) * 10;
  p.aR2 = -38 + Math.max(0, Math.sin(t * 22 * speed + 2.1)) * 10;
  p.lookY = 0.55; p.pupilY = 0.9;
  p.head = 4;
}

/** Arms crossed over the chest */
export function armsCrossed(p: Pose) {
  p.aL1 = -60; p.aL2 = -78; p.aR1 = -50; p.aR2 = -84;
}

export const wobble = (t: number, f = 1, a = 1) => Math.sin(t * f * 6.283) * a;
