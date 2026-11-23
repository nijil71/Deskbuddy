// The SVG puppet: built once, then posed every frame.
//
// v2 "deformer" rig — the techniques pro character tools (Rive / Live2D) use, done in code:
//  • the face is a soft surface: head, hair, glasses, nose and ears are re-drawn every frame through
//    one warp (3/4 head turn on a sphere, nod, squash & stretch about the chin, cheek puff, jaw drop)
//  • the head is jelly: a spring squashes it on landings and stretches it on jumps
//  • hair has physics: the mass lags behind motion, tufts bend along their length, a slight breeze
//  • mouths morph between shapes (springs) and lip-flap while a speech bubble is showing
//  • real eyelids (blink sweep, heavy lids, sad / determined slant) instead of squashing the eyeball
//  • soft shading: fringe shadow, head volume, chin shadow
import { blob, jitter, stroke, ellipsePts, roundRectPts, boilBlob, type Pt } from "./shapes";
import { HAND_PROPS, HATS, SCENE } from "./props";
import { Spring, clamp, type EyeMode, type Mouth, type Pose } from "./pose";

export const W = 280, H = 400;
export const CX = 140, GROUND = 356;
export const HIP_Y = GROUND - 33;       // hips (body origin)
export const NECK = -40;                 // neck pivot, body coords
export const FACE = -58;                 // face centre above neck
export const SIT_Y = GROUND - HIP_Y;     // root offset that puts hips on the ground line

const NS = "http://www.w3.org/2000/svg";
const el = (tag: string, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent?.appendChild(e);
  return e as SVGElement;
};
let RIGS = 0;

// ------------------------------------------------------------------ geometry (head-local, face centre = 0,0)

const HAIR: Pt[] = [
  [-66, 20, 1], [-62, -8], [-82, -22, 1], [-66, -36], [-78, -60, 1], [-52, -70], [-30, -86], [-8, -92],
  [14, -94], [36, -90], [58, -84], [90, -84, 1], [72, -62], [86, -40, 1], [68, -30], [66, 18, 1],
  [56, -4], [52, -20], [42, -16, 1], [32, -34], [18, -30, 1], [8, -40], [-12, -38], [-26, -40],
  [-30, -16, 1], [-40, -36], [-48, -22], [-54, 4],
];
// Separate tufts: they bend on springs (base centre, then shape relative to it)
const TUFTS: { at: [number, number]; pts: Pt[] }[] = [
  { at: [-40, -76], pts: [[-22, 14], [-14, -6], [-12, -34, 1], [6, -10], [20, 12]] },
  { at: [6, -86], pts: [[-24, 16], [-12, -10], [4, -44, 1], [14, -12], [26, 14]] },
  { at: [46, -80], pts: [[-22, 14], [-6, -8], [20, -36, 1], [18, -8], [24, 16]] },
];
const SHINE: [number, number, number, number][] = [
  [-38, -58, -32, -68], [-10, -70, -4, -80], [22, -66, 28, -76], [44, -60, 48, -68],
  [-50, -38, -46, -46], [12, -48, 16, -54], [60, -48, 63, -54], [-22, -54, -19, -60],
];

const LENS_L = -28, LENS_R = 28, LENS_Y = 4;
const MOUTH_AT: [number, number] = [1, 37];

const EYES: Record<EyeMode, string> = {
  normal: "", // built from outline + pupil + lid
  happy: `<path d="M-10 4 Q0 -8 10 4" class="ln"/>`,
  closed: `<path d="M-10 -1 Q0 8 10 -1" class="ln"/>`,
  dizzy: `<path d="M0 0 m-2 0 a2 2 0 1 1 4 0 a4 4 0 1 1 -8 0 a6 6 0 1 1 12 0 a8 8 0 1 1 -16 0" class="ln thin"/>`,
  wide: "",
  sad: `<path d="M-11 2 Q0 -8 11 2 Q0 12 -11 2z" class="eye-w"/><circle cx="0" cy="3" r="5" class="ink-f"/><path d="M-12 -6 L10 -10" class="ln"/>`,
  squint: `<path d="M-11 -2 L9 1 M-11 4 L9 1" class="ln"/>`,
  heart: `<path d="M0 8 C-14 -2 -8 -12 0 -5 C8 -12 14 -2 0 8z" fill="#e5484d" class="ln thin"/>`,
};

// Discrete mouths (special drawings). The everyday ones are parametric and morph — see PARAM.
const MOUTHS: Partial<Record<Mouth, string>> = {
  grin: `<path d="M-10 -3 Q0 -3 10 -3 Q8 10 0 10 Q-8 10 -10 -3z" class="ink-f"/><path d="M-6 6 Q0 3 6 6" stroke="#e5484d" stroke-width="3" fill="none"/>`,
  yawn: `<ellipse cx="0" cy="3" rx="8" ry="11" class="ink-f"/><ellipse cx="0" cy="8" rx="4" ry="3" fill="#e5484d"/>`,
  wavy: `<path d="M-9 0 q2.2 -3 4.5 0 t4.5 0 t4.5 0 t4.5 0" class="ln thin"/>`,
  tongue: `<path d="M-8 -2 Q0 6 8 -2" class="ln"/><path d="M-1 2 q3 8 6 0" fill="#e5484d" class="ln thin"/>`,
};
/** Morphing mouth targets: open (0..1), smile (-1 frown .. 1), round (0 wide .. 1 "o"). */
const PARAM: Partial<Record<Mouth, [number, number, number]>> = {
  o: [0.5, 0, 1], sip: [0.3, 0, 1], smile: [0, 0.9, 0], open: [1, 0.05, 0.65],
  flat: [0, 0, 0.1], frown: [0, -0.8, 0.1], shh: [0, -0.1, 0.4],
};

// ------------------------------------------------------------------ the rig

interface Limb { path: SVGElement; hand: SVGElement; prop: SVGElement; propId: string; ox: number; oy: number; l1: number; l2: number; back: boolean; }
/** A face shape re-drawn through the deformer each frame, keeping 3 hand-drawn boil variants. */
interface Soft { el: SVGElement; v: Pt[][]; kind: "blob" | "stroke"; hair: number; dy?: number }

export class Rig {
  svg: SVGSVGElement;
  fx: SVGGElement;
  /** set by the engine while a speech bubble is up → lip flap */
  talking = false;
  private id = `rg${RIGS++}_`;
  private root!: SVGElement;
  private shadow!: SVGElement;
  private body!: SVGElement;
  private torso!: SVGElement;
  private head!: SVGElement;
  private features!: SVGElement;
  private hairG!: SVGElement;
  private earL!: SVGElement;
  private earR!: SVGElement;
  private glasses!: SVGElement;
  private glint!: SVGElement;
  private blush: SVGElement[] = [];
  private blushG!: SVGElement;
  private eyeG: SVGElement[] = [];
  private eyeModes: Record<string, SVGElement>[] = [];
  private pupils: SVGElement[] = [];
  private lidClip: SVGElement[] = [];
  private lidLine: SVGElement[] = [];
  private mouthG!: SVGElement;
  private mouthLine!: SVGElement;
  private mouthFill!: SVGElement;
  private mouthTongue!: SVGElement;
  private mouthModes: Record<string, SVGElement> = {};
  private hatG!: SVGElement;
  private sceneG!: SVGElement;
  private chinShade!: SVGElement;
  private headClip!: SVGElement;
  private volume!: SVGElement;
  private fringe!: SVGElement;
  private shine!: SVGElement;
  private soft: Soft[] = [];
  private headSoft!: Soft;
  private hairSoft!: Soft;
  private tuftEls: SVGElement[] = [];
  private tuftV: Pt[][][] = [];
  private tufts: SVGElement[] = [];
  private legs: { path: SVGElement; foot: SVGElement; ox: number }[] = [];
  private arms: Limb[] = [];
  private armBack!: SVGElement;   // raised arms go behind the head
  private armFront!: SVGElement;
  private boilers: { el: SVGElement; d: string[] }[] = [];
  private boilI = 0;
  private cur = { eye: "", mouth: "", hat: "", scene: "", sceneText: "", param: true };
  // secondary motion
  private tuftSpr = [new Spring(0, 90, 7), new Spring(0, 110, 8), new Spring(0, 95, 7)];
  private earSpr = new Spring(0, 140, 9);
  private glassSpr = new Spring(0, 160, 14);
  private jelly = new Spring(0, 380, 11);     // head squash (+) / stretch (−)
  private hairX = new Spring(0, 55, 6);      // hair lag (px at the top of the hair)
  private hairY = new Spring(0, 75, 7);
  private mOpen = new Spring(0.5, 520, 40);
  private mSmile = new Spring(0, 520, 40);
  private mRound = new Spring(1, 520, 40);
  private viseme = { t: 0, open: 0.4, round: 0.5 };
  private prev = { head: 0, y: 0, x: 0, lookX: 0 };
  private glintT = 1;
  private t = 0;
  // current deformation
  private D = { turn: 0, nod: 0, sq: 0, puff: 0, jaw: 0, hx: 0, hy: 0 };

  constructor(host: HTMLElement) {
    this.svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "rig" }) as SVGSVGElement;
    host.appendChild(this.svg);
    this.build();
    this.fx = el("g", { class: "fx" }, this.svg) as SVGGElement;
  }

  private boil(e: SVGElement, d: string[]) { e.setAttribute("d", d[0]); this.boilers.push({ el: e, d }); }
  private softShape(e: SVGElement, pts: Pt[], amt: number, seed: number, kind: Soft["kind"] = "blob", hair = 0, dy = 0) {
    const s: Soft = { el: e, v: [0, 1, 2].map((i) => (i === 0 ? pts : jitter(pts, amt, seed * 31 + i * 977))), kind, hair, dy };
    this.soft.push(s);
    return s;
  }

  private build() {
    const s = this.svg;
    const id = this.id;
    const defs = el("defs", {}, s);
    this.shadow = el("ellipse", { cx: CX, cy: GROUND + 1, rx: 30, ry: 5, class: "shadow" }, s);
    this.root = el("g", {}, s);
    this.body = el("g", {}, this.root);

    // legs (behind torso)
    for (const ox of [-9, 9]) {
      const path = el("path", { class: "leg" }, this.body);
      const foot = el("ellipse", { rx: 8.5, ry: 5.2, class: "ink-f" }, this.body);
      this.legs.push({ path, foot, ox });
    }

    this.torso = el("g", {}, this.body);
    const shirt = el("path", { class: "shirt" }, this.torso);
    this.boil(shirt, boilBlob([[-15, -42], [15, -42], [20, -20], [23, -1], [0, 2], [-23, -1], [-20, -20]], 0.7, 3));
    // shading: shirt side + chin shadow (light comes from the top-left)
    el("path", { d: "M10 -40 Q19 -22 21 -3 L12 -2 Q13 -22 6 -40z", fill: "#000", opacity: 0.07 }, this.torso);
    this.chinShade = el("ellipse", { cx: 0, cy: -39, rx: 15, ry: 4.5, fill: "#000", opacity: 0.16 }, this.torso);
    el("path", { d: "M-7 -40 Q0 -33 7 -40", class: "ln thin" }, this.torso);
    el("path", { d: "M-22 -4 H22", class: "ln", "stroke-width": 5 }, this.torso);
    this.sceneG = el("g", { class: "scene" }, this.torso);

    // head
    this.armBack = el("g", {}, this.torso);
    this.head = el("g", {}, this.torso);
    const face = el("g", { transform: `translate(0,${FACE})` }, this.head);
    this.earL = el("g", {}, face);
    this.earR = el("g", {}, face);
    for (const [g, sx] of [[this.earL, -1], [this.earR, 1]] as const) {
      const ear = el("path", { class: "skin" }, g);
      this.boil(ear, boilBlob(ellipsePts(sx * 62, 8, 13, 16, 10), 0.6, sx + 5));
      el("path", { d: `M${sx * 58} 0 q${sx * 9} -2 ${sx * 8} 8 q${-sx * 1} 6 ${-sx * 6} 6`, class: "ln thin" }, g);
    }
    const headEl = el("path", { class: "skin head" }, face);
    this.headSoft = this.softShape(headEl, ellipsePts(0, 0, 62, 57, 20), 0.9, 11);

    // soft shading, clipped to the (deforming) head
    const hc = el("clipPath", { id: `${id}head` }, defs);
    this.headClip = el("path", {}, hc);
    const shade = el("g", { "clip-path": `url(#${id}head)` }, face);
    this.volume = el("path", { fill: "#000", opacity: 0.055, "fill-rule": "evenodd" }, shade);
    this.fringe = el("path", { fill: "#000", opacity: 0.12 }, shade);

    this.features = el("g", {}, face);
    this.blushG = el("g", { opacity: 0 }, this.features);
    for (const sx of [-1, 1]) {
      const g = el("g", {}, this.blushG);
      el("ellipse", { cx: 0, cy: 0, rx: 9, ry: 5, class: "blush" }, g);
      el("path", { d: "M-5 2 l4 -6 M0 3 l4 -6 M5 2 l4 -6", class: "ln hair-ln" }, g);
      this.blush.push(g);
      void sx;
    }

    for (const [i] of [LENS_L, LENS_R].entries()) {
      const g = el("g", {}, this.features);
      this.eyeG.push(g);
      const clip = el("clipPath", { id: `${id}eye${i}` }, defs);
      el("ellipse", { rx: 12.5, ry: 10, cx: 0, cy: 0 }, clip);
      const lc = el("clipPath", { id: `${id}lid${i}` }, defs);
      this.lidClip.push(el("path", { d: "M-16 -16 H16 V16 H-16z" }, lc));
      const modes: Record<string, SVGElement> = {};
      const normal = el("g", {}, g);
      const lidded = el("g", { "clip-path": `url(#${id}lid${i})` }, normal);
      el("ellipse", { rx: 12.5, ry: 10, class: "eye-w" }, lidded);
      const pg = el("g", { "clip-path": `url(#${id}eye${i})` }, lidded);
      const pupil = el("g", {}, pg);
      el("circle", { r: 6.6, class: "ink-f" }, pupil);
      el("circle", { r: 1.8, cx: -2.2, cy: -2.2, fill: "var(--paper)" }, pupil);
      this.pupils.push(pupil);
      this.lidLine.push(el("path", { class: "ln", "stroke-width": 3.2 }, normal));
      modes.normal = normal;
      const wide = el("g", {}, g);
      el("ellipse", { rx: 14, ry: 12.5, class: "eye-w" }, wide);
      el("circle", { r: 3.6, class: "ink-f" }, wide);
      modes.wide = wide;
      for (const m of Object.keys(EYES) as EyeMode[]) {
        if (m === "normal" || m === "wide") continue;
        const mg = el("g", {}, g);
        mg.innerHTML = EYES[m];
        modes[m] = mg;
      }
      for (const k in modes) modes[k].style.display = "none";
      this.eyeModes.push(modes);
    }

    this.glasses = el("g", {}, this.features);
    for (const cx of [LENS_L, LENS_R]) {
      this.softShape(el("path", { class: "glass" }, this.glasses), roundRectPts(cx, LENS_Y, 52, 40, 15), 0.6, cx + 99);
    }
    this.softShape(el("path", { class: "glass" }, this.glasses), [[-2, LENS_Y - 6], [0, LENS_Y - 9], [2, LENS_Y - 6]], 0.2, 3, "stroke");
    this.softShape(el("path", { class: "glass" }, this.glasses), [[-54, LENS_Y - 8], [-58, LENS_Y - 7], [-62, LENS_Y - 6]], 0.2, 4, "stroke");
    this.softShape(el("path", { class: "glass" }, this.glasses), [[54, LENS_Y - 8], [58, LENS_Y - 7], [62, LENS_Y - 6]], 0.2, 5, "stroke");
    this.glint = el("path", { d: "M-44 -8 l10 -8 M-40 0 l14 -12 M12 -8 l10 -8 M16 0 l14 -12", class: "glint" }, this.glasses);

    this.softShape(el("path", { class: "ln thin" }, this.features), [[-4, 18], [2, 15], [5, 20], [1, 25], [-2, 24]], 0.4, 4, "stroke");
    this.mouthG = el("g", {}, this.features);
    this.mouthLine = el("path", { class: "ln" }, this.mouthG);
    this.mouthFill = el("path", { class: "ink-f" }, this.mouthG);
    this.mouthTongue = el("ellipse", { fill: "#e5484d" }, this.mouthG);
    for (const m of Object.keys(MOUTHS) as Mouth[]) {
      const g = el("g", {}, this.mouthG);
      g.innerHTML = MOUTHS[m]!;
      g.style.display = "none";
      this.mouthModes[m] = g;
    }

    // hair over everything on the face
    this.hairG = el("g", {}, face);
    for (const t of TUFTS) {
      const g = el("g", {}, this.hairG);
      const p = el("path", { class: "hair" }, g);
      this.tuftEls.push(p);
      this.tuftV.push([0, 1, 2].map((i) => (i === 0 ? t.pts : jitter(t.pts, 0.8, (t.at[0] + 50) * 31 + i * 977))));
      this.tufts.push(g);
    }
    this.hairSoft = this.softShape(el("path", { class: "hair" }, this.hairG), HAIR, 1.1, 21, "blob", 1);
    this.shine = el("path", { class: "shine-ln" }, el("g", { class: "shine" }, this.hairG));
    this.hatG = el("g", {}, face);

    // arms last: in front of torso AND head, so hands can reach the face
    this.armFront = el("g", {}, this.torso);
    for (const ox of [-15, 15]) {
      const path = el("path", { class: "arm" }, this.armFront);
      const hand = el("g", {}, this.armFront);
      el("circle", { r: 5.6, class: "hand" }, hand);
      const prop = el("g", {}, hand);
      this.arms.push({ path, hand, prop, propId: "", ox, oy: -36, l1: 16, l2: 15, back: false });
    }
  }

  /** Advance the hand-drawn line boil (called ~8x/sec). */
  boilStep() {
    this.boilI = (this.boilI + 1) % 3;
    for (const b of this.boilers) b.el.setAttribute("d", b.d[this.boilI]);
  }

  setSceneText(text: string) {
    if (this.cur.sceneText === text) return;
    this.cur.sceneText = text;
    const t = this.sceneG.querySelector(".sign-text");
    if (t) t.textContent = text;
  }

  /** Approximate hit box of the character (window CSS px). */
  bbox(p: Pose) {
    const cx = CX + p.x, top = HIP_Y + p.y - 140 * p.sy;
    return { x: cx - 88, y: top, w: 176, h: GROUND + p.y - top + (p.y > 10 ? 30 : 4) };
  }

  /** Being touched: an impulse into the secondary-motion springs (hair boing, head jiggle,
   *  glasses jump). k ≈ 1 is a normal tap. */
  impulse(part: "hair" | "head" | "glasses", k = 1) {
    const r = () => Math.random() - 0.5;
    if (part === "hair") {
      this.hairY.kick(-70 * k); this.hairX.kick(r() * 90 * k);
      this.tuftSpr.forEach((s, i) => s.kick(((i - 1) * 140 + r() * 200) * k));
      this.jelly.kick(2.5 * k);
    } else if (part === "head") this.jelly.kick(5 * k);
    else this.glassSpr.kick(-45 * k);
  }

  /** Screen-space (window CSS px) position of the head centre, for eye tracking. */
  headCenter(p: Pose) {
    return { x: CX + p.x, y: HIP_Y + p.y + NECK + FACE };
  }

  // ------------------------------------------------------------------ the deformer

  /** Face-space warp. `hair` = how much the point follows the hair lag. */
  private warp(x: number, y: number, hair = 0): [number, number] {
    const D = this.D;
    if (hair) { const w = clamp((-y - 6) / 80, 0, 1.4) * hair; x += D.hx * w; y += D.hy * w; }
    if (D.puff && y > 4) x += Math.sign(x) * D.puff * 4 * Math.min(1, (y - 4) / 30) * Math.min(1, Math.abs(x) / 48);
    if (D.jaw && y > 14) y += D.jaw * 6 * Math.min(1.2, (y - 14) / 43);
    // a sphere turning/nodding: the middle travels most, the silhouette edge barely moves
    const ux = Math.min(1, (x / 70) ** 2), uy = Math.min(1, (y / 66) ** 2);
    const far = x * D.turn < 0 ? 1 - Math.min(0.08, Math.abs(D.turn) * 0.009) : 1;
    x = x * far + D.turn * (1 - ux) * (1 - uy * 0.5);
    y += D.nod * (1 - uy) * (1 - ux * 0.5);
    // jelly squash about the chin
    x *= 1 + D.sq * 0.15;
    y = 57 + (y - 57) * (1 - D.sq * 0.13);
    return [x, y];
  }
  private wpts(pts: Pt[], hair: number, dy = 0): Pt[] {
    return pts.map((p) => { const [x, y] = this.warp(p[0], p[1] + dy, hair); return [x, y, p[2]] as Pt; });
  }

  private mouthPath(open: number, smile: number, round: number) {
    const f = (n: number) => Math.round(n * 10) / 10;
    const o = clamp(open, 0, 1.2), s = clamp(smile, -1, 1), r = clamp(round, 0, 1);
    const w = 8.5 - r * 4.3 + Math.max(0, s) * 1.6;
    if (o < 0.07) {
      const y0 = -s * 2.2, c = s * 7.5;
      return { line: `M${f(-w)} ${f(y0)}Q0 ${f(c)} ${f(w)} ${f(y0)}`, fill: "", tongue: 0, w, bot: 0 };
    }
    const h = o * 9.5, y0 = -s * 2;
    const top = y0 - s * 1.5 - h * 0.35, bot = h * 1.25 + Math.max(0, s) * 2.5;
    return {
      line: "", w, bot,
      fill: `M${f(-w)} ${f(y0)}Q0 ${f(top)} ${f(w)} ${f(y0)}Q${f(w * 0.95)} ${f(bot * 0.9)} 0 ${f(bot)}Q${f(-w * 0.95)} ${f(bot * 0.9)} ${f(-w)} ${f(y0)}Z`,
      tongue: o > 0.55 ? 1 : 0,
    };
  }

  render(p: Pose, dt: number) {
    const f = (n: number) => Math.round(n * 100) / 100;
    this.t += dt;
    // root: lean/squash around the feet
    // Front-facing character: never collapse to a sliver when turning. Snap the mirror at
    // zero and squash slightly (0.86..1) so a turn reads as a quick spin.
    const face = (p.face < 0 ? -1 : 1) * (0.86 + 0.14 * Math.abs(p.face));
    this.root.setAttribute(
      "transform",
      `translate(${f(CX + p.x)},${f(GROUND + p.y)}) rotate(${f(p.rot)}) scale(${f(p.sx * face)},${f(p.sy)}) translate(${-CX},${-GROUND})`,
    );
    const air = Math.max(0, -p.y);
    this.shadow.setAttribute("transform", `translate(${f(CX + p.x)},0) scale(${f(Math.max(0.3, 1 - air / 160))},1) translate(${-CX},0)`);
    this.shadow.setAttribute("opacity", String(f(Math.max(0, p.shadow * (1 - air / 220)))));

    this.body.setAttribute("transform", `translate(${CX},${f(HIP_Y + p.hipY)})`);
    this.torso.setAttribute("transform", `rotate(${f(p.torso)})`);

    // legs (FK, rubber-hose curve). Forward(+) = towards facing direction.
    const legAng = [[p.lL1, p.lL2], [p.lR1, p.lR2]];
    this.legs.forEach((L, i) => {
      const [a1, a2] = legAng[i];
      const t1 = (-a1 * Math.PI) / 180, t2 = t1 + (a2 * Math.PI) / 180;
      const sx = L.ox, sy = -2;
      const ex = sx - Math.sin(t1) * 15, ey = sy + Math.cos(t1) * 15;
      const hx = ex - Math.sin(t2) * 15, hy = ey + Math.cos(t2) * 15;
      const cx = ex + (ex - (sx + hx) / 2) * 0.6, cy = ey + (ey - (sy + hy) / 2) * 0.6;
      L.path.setAttribute("d", `M${f(sx)} ${f(sy)}Q${f(cx)} ${f(cy)} ${f(hx)} ${f(hy)}`);
      L.foot.setAttribute("transform", `translate(${f(hx + 3)},${f(hy + 1)}) rotate(${f((-t2 * 180) / Math.PI * 0.4)})`);
    });

    // arms: out(+) for both sides
    const armAng = [[p.aL1, p.aL2, -1], [p.aR1, p.aR2, 1]];
    const props = [p.propL, p.propR];
    this.arms.forEach((A, i) => {
      const [a1, a2, side] = armAng[i];
      const t1 = (-side * a1 * Math.PI) / 180, t2 = t1 + (-side * a2 * Math.PI) / 180;
      const sx = A.ox, sy = A.oy;
      let ex = sx - Math.sin(t1) * A.l1, ey = sy + Math.cos(t1) * A.l1;
      let hx = ex - Math.sin(t2) * A.l2, hy = ey + Math.cos(t2) * A.l2;
      // Chibi arms are far too short to get past the big head, so raised arms blend into a
      // rubber-hose "banzai": elbow out wide, hand popping up beside the hair.
      const r0 = Math.max(0, Math.min(1, (a1 - 80) / 35));
      const raise = r0 * r0 * (3 - 2 * r0);
      if (raise > 0) {
        const phi = ((22 + (a2 - 34) + (a1 - 118) * 0.5) * Math.PI) / 180;
        const hr = (p.head * Math.PI) / 180, hc = Math.cos(hr), hs = Math.sin(hr);
        const toBody = (x: number, y: number): [number, number] => {
          const dy = y - NECK;
          return [x * hc - dy * hs + p.headX, NECK + x * hs + dy * hc + p.headY];
        };
        const [bex, bey] = toBody(side * 76, -74);
        const [bhx, bhy] = toBody(side * (76 + Math.sin(phi) * 54), -74 - Math.cos(phi) * 54);
        ex += (bex - ex) * raise; ey += (bey - ey) * raise;
        hx += (bhx - hx) * raise; hy += (bhy - hy) * raise;
      }
      const back = raise > 0.5;
      if (back !== A.back) {
        A.back = back;
        const parent = back ? this.armBack : this.armFront;
        parent.appendChild(A.path);
        parent.appendChild(A.hand);
      }
      const cx = ex + (ex - (sx + hx) / 2) * 0.5, cy = ey + (ey - (sy + hy) / 2) * 0.5;
      A.path.setAttribute("d", `M${f(sx)} ${f(sy)}Q${f(cx)} ${f(cy)} ${f(hx)} ${f(hy)}`);
      A.hand.setAttribute("transform", `translate(${f(hx)},${f(hy)})`);
      const pid = props[i];
      if (pid !== A.propId) {
        A.propId = pid;
        const pr = HAND_PROPS[pid];
        A.prop.innerHTML = pr ? pr.svg : "";
        A.prop.setAttribute("class", `prop prop-${pid}`);
      }
      if (pid && HAND_PROPS[pid]) {
        const upright = HAND_PROPS[pid].upright;
        const deg = upright ? -p.torso : (t2 * 180) / Math.PI + 180;
        A.prop.setAttribute("transform", `rotate(${f(deg)}) scale(${side < 0 ? -1 : 1},1)`);
      }
    });

    // ---------------------------------------------------------- secondary motion
    const sdt = Math.max(dt, 1 / 120);
    const dHead = (p.head - this.prev.head) / sdt;
    const dY = (p.y + p.hipY - this.prev.y) / sdt;
    const dX = (p.x - this.prev.x) / sdt;
    this.prev.head = p.head; this.prev.y = p.y + p.hipY; this.prev.x = p.x;
    const fs = Math.sign(p.face || 1);
    const drive = -dHead * 0.05 - dX * 0.03 * fs;
    // jelly head: stretch while moving fast vertically, squash with the body; the spring overshoots
    const jt = clamp(-Math.abs(dY) * 0.0016, -0.45, 0) + clamp((1 - p.sy) * 2.6, -0.4, 0.6);
    const sq = clamp(this.jelly.step(jt, dt), -0.5, 0.75);
    // hair lags behind motion, with a slow breeze so it's never frozen
    const hx = this.hairX.step(clamp(-dX * 0.012 * fs - dHead * 0.1, -9, 9) + Math.sin(this.t * 1.13) * 0.6 + Math.sin(this.t * 2.7) * 0.25, dt);
    const hy = this.hairY.step(clamp(-dY * 0.009, -7, 7), dt);
    const ear = this.earSpr.step(-dY * 0.01, dt);
    const gl = this.glassSpr.step(dY * 0.008, dt);

    // mouth springs (morph) + lip flap while talking
    const param = PARAM[p.mouth];
    let [to, ts, tr] = param ?? [0, 0, 0];
    if (param && this.talking) {
      this.viseme.t -= dt;
      if (this.viseme.t <= 0) {
        this.viseme.t = 0.07 + Math.random() * 0.07;
        const shut = Math.random() < 0.18;
        this.viseme.open = shut ? 0.05 : 0.25 + Math.random() * 0.7;
        this.viseme.round = Math.random();
      }
      to = this.viseme.open; tr = this.viseme.round * 0.8; ts = Math.max(ts, 0) * 0.6;
    }
    const mo = this.mOpen.step(to, dt), ms = this.mSmile.step(ts, dt), mr = this.mRound.step(tr, dt);
    const special = p.mouth === "grin" ? 0.6 : p.mouth === "yawn" ? 1.3 : 0;

    // deformation for this frame (every input is bounded: a bad value must never warp the face)
    const D = this.D;
    const ok = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? clamp(v, lo, hi) : 0);
    D.turn = ok(p.lookX * 12, -12, 12); D.nod = ok(p.lookY * 6, -6, 6);
    D.sq = ok(sq, -0.5, 0.75); D.hx = ok(hx, -12, 12); D.hy = ok(hy, -9, 9);
    D.puff = ok((param ? Math.max(0, ms) * 0.8 : p.mouth === "grin" ? 1 : 0) + Math.max(0, p.blush) * 0.3, 0, 1.3);
    D.jaw = ok(param ? Math.max(0, mo - 0.3) * 0.9 : special, 0, 1.3);

    // ---------------------------------------------------------- the soft face
    for (const s of this.soft) {
      const pts = this.wpts(s.v[this.boilI], s.hair, s.dy);
      s.el.setAttribute("d", s.kind === "blob" ? blob(pts) : stroke(pts));
    }
    const headD = this.headSoft.el.getAttribute("d")!;
    this.headClip.setAttribute("d", headD);
    // volume: a soft crescent on the lower-right of the head (head minus itself shifted up-left)
    const shifted = blob(this.headSoft.v[this.boilI].map((q) => { const [x, y] = this.warp(q[0] - 7, q[1] - 7); return [x, y] as Pt; }));
    this.volume.setAttribute("d", headD + shifted);
    // fringe shadow: the hair shape dropped a few px onto the forehead
    this.fringe.setAttribute("d", blob(this.wpts(this.hairSoft.v[this.boilI], 1, 6)));
    // hair shine
    let sh = "";
    for (const [x1, y1, x2, y2] of SHINE) {
      const [a, b] = this.warp(x1, y1, 1), [c, d] = this.warp(x2, y2, 1);
      sh += `M${f(a)} ${f(b)}L${f(c)} ${f(d)}`;
    }
    this.shine.setAttribute("d", sh);
    // tufts: bend along their length (tip moves most), ride the hair lag and the squash
    this.tuftSpr.forEach((spr, i) => {
      const bend = clamp(spr.step(drive * (0.8 + i * 0.2) + dY * 0.02 * (i - 1), dt) + hx * 1.6, -32, 32);
      const t = TUFTS[i];
      const [bx, by] = this.warp(t.at[0], t.at[1], 1);
      const rad = (bend * Math.PI) / 180;
      const pts = this.tuftV[i][this.boilI].map((q) => {
        const len = Math.min(1, Math.max(0, -q[1]) / 40); // tip (most negative y) bends most
        const a = rad * len, c = Math.cos(a), sn = Math.sin(a);
        const x = q[0] * (1 + sq * 0.15), y = q[1] * (1 - sq * 0.13);
        return [x * c - y * sn, x * sn + y * c, q[2]] as Pt;
      });
      this.tufts[i].setAttribute("transform", `translate(${f(bx)},${f(by)})`);
      this.tuftEls[i].setAttribute("d", blob(pts));
    });

    this.head.setAttribute("transform", `translate(0,${NECK}) rotate(${f(p.head)}) translate(${f(p.headX)},${f(p.headY)})`);
    this.chinShade.setAttribute("transform", `translate(${f(p.headX * 0.7 + D.turn * 0.3)},0) scale(${f(1 + sq * 0.15)},1)`);
    // ears ride the warp, and swing opposite to the turn (they're behind the head → depth)
    for (const [g, sx, sgn] of [[this.earL, -62, -1], [this.earR, 62, 1]] as const) {
      const [wx, wy] = this.warp(sx, 8);
      g.setAttribute("transform", `translate(${f(wx - sx - D.turn * 0.35)},${f(wy - 8 + ear)}) rotate(${f(sgn * ear * 2)},${sx},8)`);
    }
    const [hatX, hatY] = this.warp(0, -88, 0.6);
    this.hatG.setAttribute("transform", `translate(${f(hatX)},${f(hatY + 88)})`);
    this.glasses.setAttribute("transform", `translate(0,${f(p.glassesY + gl)})`);
    [[-42, 28], [42, 28]].forEach(([bx, by], i) => {
      const [x, y] = this.warp(bx, by);
      this.blush[i].setAttribute("transform", `translate(${f(x)},${f(y)})`);
    });

    // glasses glint when the head turns quickly
    const lx = p.lookX;
    if (Math.abs(lx - this.prev.lookX) > 0.06) this.glintT = 0;
    this.prev.lookX = lx;
    if (this.glintT < 1) {
      this.glintT = Math.min(1, this.glintT + dt * 2.5);
      this.glint.setAttribute("opacity", String(f(Math.sin(this.glintT * Math.PI) * 0.9)));
      this.glint.setAttribute("transform", `translate(${f((this.glintT - 0.5) * 16 + D.turn * 0.6)},0)`);
    } else this.glint.setAttribute("opacity", "0");

    // ---------------------------------------------------------- eyes with real lids
    const eyeKey = p.eyes < 0.1 && (p.eyeMode === "normal" || p.eyeMode === "wide") ? "closed" : p.eyeMode;
    if (eyeKey !== this.cur.eye) {
      for (const modes of this.eyeModes) {
        if (modes[this.cur.eye]) modes[this.cur.eye].style.display = "none";
        modes[eyeKey].style.display = "";
      }
      this.cur.eye = eyeKey;
    }
    const open = clamp(p.eyes, 0, 1.08);
    const tilt = clamp(p.lidTilt, -1, 1);
    this.eyeG.forEach((g, i) => {
      const side = i ? 1 : -1;
      const [ex, ey] = this.warp(i ? LENS_R : LENS_L, LENS_Y);
      const narrow = 1 - Math.min(0.22, Math.max(0, -side * D.turn) * 0.022); // far eye foreshortens
      const sy = eyeKey === "wide" ? Math.max(0.2, open) : 1;
      g.setAttribute("transform", `translate(${f(ex)},${f(ey + p.glassesY * 0.3)}) scale(${f(narrow)},${f(sy)})`);
      if (eyeKey !== "normal") return;
      // lid height at the centre: open 1 → top of the eye, 0 → bottom; slant lowers the outer corner (sad)
      const yc = -10.6 + (1 - Math.min(1, open)) * 21;
      const yl = (x: number) => yc + tilt * 4.5 * ((x * side) / 12.5);
      this.lidClip[i].setAttribute("d", `M-16 ${f(yl(-16))}L16 ${f(yl(16))}L16 16L-16 16Z`);
      const showLid = open < 0.94 || Math.abs(tilt) > 0.08;
      if (showLid) {
        const hw = 12.5 * Math.sqrt(Math.max(0.04, 1 - (yc / 10.5) ** 2));
        this.lidLine[i].setAttribute("d", `M${f(-hw)} ${f(yl(-hw))}Q0 ${f(yc - 1.5)} ${f(hw)} ${f(yl(hw))}`);
        this.lidLine[i].setAttribute("opacity", "1");
      } else this.lidLine[i].setAttribute("opacity", "0");
    });
    const px = clamp(p.pupilX, -1, 1) * 5.5, py = clamp(p.pupilY, -1, 1) * 4;
    for (const pu of this.pupils) pu.setAttribute("transform", `translate(${f(px)},${f(py)})`);

    // ---------------------------------------------------------- mouth: morphing or special
    const [mx, my] = this.warp(MOUTH_AT[0], MOUTH_AT[1]);
    this.mouthG.setAttribute("transform", `translate(${f(mx)},${f(my)})`);
    const isParam = !!param;
    if (p.mouth !== this.cur.mouth || isParam !== this.cur.param) {
      if (this.mouthModes[this.cur.mouth]) this.mouthModes[this.cur.mouth].style.display = "none";
      if (!isParam && this.mouthModes[p.mouth]) this.mouthModes[p.mouth].style.display = "";
      this.cur.mouth = p.mouth; this.cur.param = isParam;
    }
    if (isParam) {
      const m = this.mouthPath(mo, ms, mr);
      this.mouthLine.setAttribute("d", m.line || "M0 0");
      this.mouthLine.style.display = m.line ? "" : "none";
      this.mouthFill.setAttribute("d", m.fill || "M0 0");
      this.mouthFill.style.display = m.fill ? "" : "none";
      this.mouthTongue.style.display = m.tongue ? "" : "none";
      if (m.tongue) { this.mouthTongue.setAttribute("cx", "0"); this.mouthTongue.setAttribute("cy", String(f(m.bot * 0.68))); this.mouthTongue.setAttribute("rx", String(f(m.w * 0.5))); this.mouthTongue.setAttribute("ry", String(f(m.bot * 0.22))); }
    } else {
      this.mouthLine.style.display = "none"; this.mouthFill.style.display = "none"; this.mouthTongue.style.display = "none";
    }
    this.blushG.setAttribute("opacity", String(f(p.blush)));

    if (p.hat !== this.cur.hat) {
      this.cur.hat = p.hat;
      this.hatG.innerHTML = HATS[p.hat] || "";
    }
  }

  setScene(id: string) {
    if (id === this.cur.scene) return;
    this.cur.scene = id;
    this.cur.sceneText = "";
    this.sceneG.innerHTML = SCENE[id] || "";
  }
}
