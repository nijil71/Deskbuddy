// The SVG puppet: built once, then posed every frame by writing transforms.
import { boilBlob, boilStroke, ellipsePts, roundRectPts, type Pt } from "./shapes";
import { HAND_PROPS, HATS, SCENE } from "./props";
import { Spring, type EyeMode, type Mouth, type Pose } from "./pose";

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

// ------------------------------------------------------------------ geometry (head-local, face centre = 0,0)

const HAIR: Pt[] = [
  [-66, 20, 1], [-62, -8], [-82, -22, 1], [-66, -36], [-78, -60, 1], [-52, -70], [-30, -86], [-8, -92],
  [14, -94], [36, -90], [58, -84], [90, -84, 1], [72, -62], [86, -40, 1], [68, -30], [66, 18, 1],
  [56, -4], [52, -20], [42, -16, 1], [32, -34], [18, -30, 1], [8, -40], [-12, -38], [-26, -40],
  [-30, -16, 1], [-40, -36], [-48, -22], [-54, 4],
];
// Separate tufts so they can bounce on springs (base centre, then shape relative to it)
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

const EYES: Record<EyeMode, string> = {
  normal: "", // built from outline + pupil
  happy: `<path d="M-10 4 Q0 -8 10 4" class="ln"/>`,
  closed: `<path d="M-10 -1 Q0 8 10 -1" class="ln"/>`,
  dizzy: `<path d="M0 0 m-2 0 a2 2 0 1 1 4 0 a4 4 0 1 1 -8 0 a6 6 0 1 1 12 0 a8 8 0 1 1 -16 0" class="ln thin"/>`,
  wide: "",
  sad: `<path d="M-11 2 Q0 -8 11 2 Q0 12 -11 2z" class="eye-w"/><circle cx="0" cy="3" r="5" class="ink-f"/><path d="M-12 -6 L10 -10" class="ln"/>`,
  squint: `<path d="M-11 -2 L9 1 M-11 4 L9 1" class="ln"/>`,
  heart: `<path d="M0 8 C-14 -2 -8 -12 0 -5 C8 -12 14 -2 0 8z" fill="#e5484d" class="ln thin"/>`,
};

const MOUTHS: Record<Mouth, string> = {
  o: `<ellipse cx="0" cy="0" rx="4.2" ry="3.6" class="ink-f"/>`,
  sip: `<ellipse cx="2" cy="0" rx="3" ry="2.6" class="ink-f"/>`,
  smile: `<path d="M-8 -2 Q0 7 8 -2" class="ln"/>`,
  grin: `<path d="M-10 -3 Q0 -3 10 -3 Q8 10 0 10 Q-8 10 -10 -3z" class="ink-f"/><path d="M-6 6 Q0 3 6 6" stroke="#e5484d" stroke-width="3" fill="none"/>`,
  open: `<ellipse cx="0" cy="1" rx="6" ry="7" class="ink-f"/>`,
  flat: `<path d="M-6 0 H6" class="ln"/>`,
  yawn: `<ellipse cx="0" cy="3" rx="8" ry="11" class="ink-f"/><ellipse cx="0" cy="8" rx="4" ry="3" fill="#e5484d"/>`,
  frown: `<path d="M-7 3 Q0 -5 7 3" class="ln"/>`,
  wavy: `<path d="M-9 0 q2.2 -3 4.5 0 t4.5 0 t4.5 0 t4.5 0" class="ln thin"/>`,
  tongue: `<path d="M-8 -2 Q0 6 8 -2" class="ln"/><path d="M-1 2 q3 8 6 0" fill="#e5484d" class="ln thin"/>`,
  shh: `<path d="M-5 0 H5" class="ln"/>`,
};

// ------------------------------------------------------------------ the rig

interface Limb { path: SVGElement; hand: SVGElement; prop: SVGElement; propId: string; ox: number; oy: number; l1: number; l2: number; back: boolean; }

export class Rig {
  svg: SVGSVGElement;
  fx: SVGGElement;
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
  private blushG!: SVGElement;
  private eyeG: SVGElement[] = [];
  private eyeModes: Record<string, SVGElement>[] = [];
  private pupils: SVGElement[] = [];
  private mouthModes: Record<string, SVGElement> = {};
  private hatG!: SVGElement;
  private sceneG!: SVGElement;
  private tufts: SVGElement[] = [];
  private legs: { path: SVGElement; foot: SVGElement; ox: number }[] = [];
  private arms: Limb[] = [];
  private armBack!: SVGElement;   // raised arms go behind the head
  private armFront!: SVGElement;
  private boilers: { el: SVGElement; d: string[] }[] = [];
  private boilI = 0;
  private cur = { eye: "", mouth: "", hat: "", scene: "", sceneText: "" };
  // secondary motion
  private tuftSpr = [new Spring(0, 90, 7), new Spring(0, 110, 8), new Spring(0, 95, 7)];
  private earSpr = new Spring(0, 140, 9);
  private glassSpr = new Spring(0, 160, 14);
  private prev = { head: 0, y: 0, x: 0, lookX: 0 };
  private glintT = 1;

  constructor(host: HTMLElement) {
    this.svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "rig" }) as SVGSVGElement;
    host.appendChild(this.svg);
    this.build();
    this.fx = el("g", { class: "fx" }, this.svg) as SVGGElement;
  }

  private boil(e: SVGElement, d: string[]) { e.setAttribute("d", d[0]); this.boilers.push({ el: e, d }); }

  private build() {
    const s = this.svg;
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
    const head = el("path", { class: "skin head" }, face);
    this.boil(head, boilBlob(ellipsePts(0, 0, 62, 57, 20), 0.9, 11));

    this.features = el("g", {}, face);
    this.blushG = el("g", { opacity: 0 }, this.features);
    el("ellipse", { cx: -42, cy: 28, rx: 9, ry: 5, class: "blush" }, this.blushG);
    el("ellipse", { cx: 42, cy: 28, rx: 9, ry: 5, class: "blush" }, this.blushG);
    // blush hatching like the drawing style
    el("path", { d: "M-47 30 l4 -6 M-42 31 l4 -6 M-37 30 l4 -6 M37 30 l4 -6 M42 31 l4 -6 M47 30 l4 -6", class: "ln hair-ln" }, this.blushG);

    const defs = el("defs", {}, this.svg);
    for (const [i, cx] of [LENS_L, LENS_R].entries()) {
      const g = el("g", { transform: `translate(${cx},${LENS_Y})` }, this.features);
      this.eyeG.push(g);
      const clip = el("clipPath", { id: `eyeclip${i}` }, defs);
      el("ellipse", { rx: 12.5, ry: 10, cx: 0, cy: 0 }, clip);
      const modes: Record<string, SVGElement> = {};
      const normal = el("g", {}, g);
      el("ellipse", { rx: 12.5, ry: 10, class: "eye-w" }, normal);
      const pg = el("g", { "clip-path": `url(#eyeclip${i})` }, normal);
      const pupil = el("g", {}, pg);
      el("circle", { r: 6.6, class: "ink-f" }, pupil);
      el("circle", { r: 1.8, cx: -2.2, cy: -2.2, fill: "var(--paper)" }, pupil);
      this.pupils.push(pupil);
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
      const lens = el("path", { class: "glass" }, this.glasses);
      this.boil(lens, boilBlob(roundRectPts(cx, LENS_Y, 52, 40, 15), 0.6, cx + 99));
    }
    el("path", { d: `M-2 ${LENS_Y - 6} Q0 ${LENS_Y - 10} 2 ${LENS_Y - 6}`, class: "glass" }, this.glasses);
    el("path", { d: `M-54 ${LENS_Y - 8} L-62 ${LENS_Y - 6} M54 ${LENS_Y - 8} L62 ${LENS_Y - 6}`, class: "glass" }, this.glasses);
    this.glint = el("path", { d: "M-44 -8 l10 -8 M-40 0 l14 -12 M12 -8 l10 -8 M16 0 l14 -12", class: "glint" }, this.glasses);

    const nose = el("path", { class: "ln thin" }, this.features);
    this.boil(nose, boilStroke([[-4, 18], [2, 15], [5, 20], [1, 25], [-2, 24]], 0.4, 4));
    const mouthG = el("g", { transform: "translate(1,37)" }, this.features);
    for (const m of Object.keys(MOUTHS) as Mouth[]) {
      const g = el("g", {}, mouthG);
      g.innerHTML = MOUTHS[m];
      g.style.display = "none";
      this.mouthModes[m] = g;
    }

    // hair over everything on the face
    this.hairG = el("g", {}, face);
    for (const t of TUFTS) {
      const g = el("g", {}, this.hairG);
      const p = el("path", { class: "hair" }, g);
      this.boil(p, boilBlob(t.pts, 0.8, t.at[0] + 50));
      this.tufts.push(g);
    }
    const mass = el("path", { class: "hair" }, this.hairG);
    this.boil(mass, boilBlob(HAIR, 1.1, 21));
    const shine = el("g", { class: "shine" }, this.hairG);
    for (const [x1, y1, x2, y2] of SHINE) el("path", { d: `M${x1} ${y1}L${x2} ${y2}` }, shine);
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

  /** Screen-space (window CSS px) position of the head centre, for eye tracking. */
  headCenter(p: Pose) {
    return { x: CX + p.x, y: HIP_Y + p.y + NECK + FACE };
  }

  render(p: Pose, dt: number) {
    const f = (n: number) => Math.round(n * 100) / 100;
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
      // rubber-hose "banzai": elbow out wide, hand popping up beside the hair. The forearm
      // angle (a2) and shoulder angle (a1) still swing the hand, so waves/flails read.
      const r0 = Math.max(0, Math.min(1, (a1 - 80) / 35));
      const raise = r0 * r0 * (3 - 2 * r0);
      if (raise > 0) {
        const phi = ((22 + (a2 - 34) + (a1 - 118) * 0.5) * Math.PI) / 180;
        // banzai targets live in head space, so a tilted head never swallows the hands
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
      const back = raise > 0.5; // tuck behind the head so the arm doesn't cross the face
      if (back !== A.back) {
        A.back = back;
        const parent = back ? this.armBack : this.armFront;
        parent.appendChild(A.path);
        parent.appendChild(A.hand);
      }
      const cx = ex + (ex - (sx + hx) / 2) * 0.5, cy = ey + (ey - (sy + hy) / 2) * 0.5;
      A.path.setAttribute("d", `M${f(sx)} ${f(sy)}Q${f(cx)} ${f(cy)} ${f(hx)} ${f(hy)}`);
      A.hand.setAttribute("transform", `translate(${f(hx)},${f(hy)})`);
      const id = props[i];
      if (id !== A.propId) {
        A.propId = id;
        const pr = HAND_PROPS[id];
        A.prop.innerHTML = pr ? pr.svg : "";
        A.prop.setAttribute("class", `prop prop-${id}`);
      }
      if (id && HAND_PROPS[id]) {
        const upright = HAND_PROPS[id].upright;
        const deg = upright ? -p.torso : (t2 * 180) / Math.PI + 180;
        A.prop.setAttribute("transform", `rotate(${f(deg)}) scale(${side < 0 ? -1 : 1},1)`);
      }
    });

    // secondary motion: hair tufts & ears react to head/body acceleration
    const dHead = (p.head - this.prev.head) / Math.max(dt, 1 / 120);
    const dY = (p.y + p.hipY - this.prev.y) / Math.max(dt, 1 / 120);
    const dX = (p.x - this.prev.x) / Math.max(dt, 1 / 120);
    this.prev.head = p.head; this.prev.y = p.y + p.hipY; this.prev.x = p.x;
    const drive = -dHead * 0.05 - dX * 0.03 * Math.sign(p.face || 1);
    this.tuftSpr.forEach((s, i) => {
      s.step(drive * (0.8 + i * 0.2) + dY * 0.02 * (i - 1), dt);
      const t = TUFTS[i];
      this.tufts[i].setAttribute("transform", `translate(${t.at[0]},${t.at[1]}) rotate(${f(Math.max(-25, Math.min(25, s.x)))})`);
    });
    const ear = this.earSpr.step(-dY * 0.01, dt);
    const gl = this.glassSpr.step(dY * 0.008, dt);

    this.head.setAttribute("transform", `translate(0,${NECK}) rotate(${f(p.head)}) translate(${f(p.headX)},${f(p.headY)})`);
    const lx = p.lookX, ly = p.lookY;
    this.features.setAttribute("transform", `translate(${f(lx * 8)},${f(ly * 5)})`);
    this.hairG.setAttribute("transform", `translate(${f(lx * 3)},${f(ly * 1.5)})`);
    this.hatG.setAttribute("transform", `translate(${f(lx * 4)},${f(ly * 2)})`);
    this.earL.setAttribute("transform", `translate(${f(-lx * 4 + (lx > 0 ? lx * 6 : 0))},${f(ear)}) rotate(${f(-ear * 2)},-62,8)`);
    this.earR.setAttribute("transform", `translate(${f(-lx * 4 + (lx < 0 ? lx * 6 : 0))},${f(ear)}) rotate(${f(ear * 2)},62,8)`);
    this.glasses.setAttribute("transform", `translate(0,${f(p.glassesY + gl)})`);

    // glasses glint when the head turns quickly
    if (Math.abs(lx - this.prev.lookX) > 0.06) this.glintT = 0;
    this.prev.lookX = lx;
    if (this.glintT < 1) {
      this.glintT = Math.min(1, this.glintT + dt * 2.5);
      this.glint.setAttribute("opacity", String(f(Math.sin(this.glintT * Math.PI) * 0.9)));
      this.glint.setAttribute("transform", `translate(${f((this.glintT - 0.5) * 16)},0)`);
    } else this.glint.setAttribute("opacity", "0");

    // eyes
    const eyeKey = p.eyes < 0.18 && (p.eyeMode === "normal" || p.eyeMode === "wide") ? "closed" : p.eyeMode;
    if (eyeKey !== this.cur.eye) {
      for (const modes of this.eyeModes) {
        if (modes[this.cur.eye]) modes[this.cur.eye].style.display = "none";
        modes[eyeKey].style.display = "";
      }
      this.cur.eye = eyeKey;
    }
    const open = eyeKey === "normal" || eyeKey === "wide" ? Math.max(0.18, p.eyes) : 1;
    this.eyeG.forEach((g, i) => g.setAttribute("transform", `translate(${i ? LENS_R : LENS_L},${LENS_Y + p.glassesY * 0.3}) scale(1,${f(open)})`));
    const px = Math.max(-1, Math.min(1, p.pupilX)) * 5.5, py = Math.max(-1, Math.min(1, p.pupilY)) * 4;
    for (const pu of this.pupils) pu.setAttribute("transform", `translate(${f(px)},${f(py)})`);

    if (p.mouth !== this.cur.mouth) {
      if (this.mouthModes[this.cur.mouth]) this.mouthModes[this.cur.mouth].style.display = "none";
      this.mouthModes[p.mouth].style.display = "";
      this.cur.mouth = p.mouth;
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
