// Tiny pooled particle system for Zzz, hearts, notes, sweat, stars, confetti, steam…
const NS = "http://www.w3.org/2000/svg";

export type FxKind = "z" | "heart" | "note" | "sweat" | "star" | "confetti" | "steam" | "spark" | "dust" | "bang" | "q" | "bulb" | "drop" | "flake" | "ball";

const GLYPH: Record<FxKind, string> = {
  z: `<text font-size="18" font-weight="900" fill="var(--ink)" text-anchor="middle">Z</text>`,
  heart: `<path d="M0 6 C-10 -2 -6 -10 0 -5 C6 -10 10 -2 0 6z" fill="#e5484d" stroke="var(--ink)" stroke-width="1.6"/>`,
  note: `<path d="M-3 4 a3.5 3 0 1 1 0.1 0 M0.3 4 V-9 l7 2" fill="var(--ink)" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>`,
  sweat: `<path d="M0 -6 Q5 1 3 4 Q0 7 -3 4 Q-5 1 0 -6z" fill="#7cc4f5" stroke="var(--ink)" stroke-width="1.6"/>`,
  star: `<path d="M0 -7 l2 4.5 5 .6 -3.7 3.4 1 5 -4.3 -2.5 -4.3 2.5 1 -5 -3.7 -3.4 5 -.6z" fill="#f4c542" stroke="var(--ink)" stroke-width="1.4"/>`,
  confetti: `<rect x="-3" y="-1.5" width="6" height="3" rx="1"/>`,
  steam: `<path d="M0 6 q-4 -4 0 -8 q4 -4 0 -8" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" opacity=".55"/>`,
  spark: `<path d="M0 -6 V6 M-6 0 H6" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/>`,
  dust: `<circle r="4" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.6"/>`,
  bang: `<text font-size="22" font-weight="900" fill="var(--ink)" text-anchor="middle">!</text>`,
  q: `<text font-size="20" font-weight="900" fill="var(--ink)" text-anchor="middle">?</text>`,
  bulb: `<g><circle cy="-4" r="7" fill="#f4c542" stroke="var(--ink)" stroke-width="2"/><rect x="-3.5" y="3" width="7" height="5" rx="1" fill="var(--ink)"/></g>`,
  drop: `<path d="M0 -4 Q2 1 0 3 Q-2 1 0 -4z" fill="#7cc4f5"/>`,
  flake: `<path d="M0 -5 V5 M-4.3 -2.5 L4.3 2.5 M-4.3 2.5 L4.3 -2.5" stroke="#9cc9ee" stroke-width="1.8" stroke-linecap="round"/>`,
  ball: `<circle r="6" fill="var(--accent)" stroke="var(--ink)" stroke-width="2.4"/>`,
};
const CONFETTI = ["#e5484d", "#f4c542", "#46a758", "#3e63dd", "#8e4ec6"];

interface P {
  el: SVGGElement; on: boolean; kind: FxKind;
  x: number; y: number; vx: number; vy: number; g: number;
  life: number; max: number; rot: number; vr: number; s: number; s1: number; wob: number;
}

export interface EmitOpts { vx?: number; vy?: number; g?: number; life?: number; s?: number; s1?: number; vr?: number; wob?: number; }

export class Fx {
  private pool: P[] = [];
  constructor(private layer: SVGGElement) {}

  get active() { return this.pool.some((p) => p.on); }

  emit(kind: FxKind, x: number, y: number, o: EmitOpts = {}) {
    let p = this.pool.find((q) => !q.on);
    if (!p) {
      if (this.pool.length >= 48) return;
      const el = document.createElementNS(NS, "g") as SVGGElement;
      this.layer.appendChild(el);
      p = { el, on: false, kind: "z", x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, rot: 0, vr: 0, s: 1, s1: 1, wob: 0 };
      this.pool.push(p);
    }
    if (p.kind !== kind || !p.el.innerHTML) p.el.innerHTML = GLYPH[kind];
    if (kind === "confetti") (p.el.firstElementChild as SVGElement).setAttribute("fill", CONFETTI[(Math.random() * 5) | 0]);
    Object.assign(p, {
      on: true, kind, x, y, vx: o.vx ?? 0, vy: o.vy ?? -20, g: o.g ?? 0, life: 0, max: o.life ?? 1.4,
      rot: 0, vr: o.vr ?? 0, s: o.s ?? 1, s1: o.s1 ?? o.s ?? 1, wob: o.wob ?? 0,
    });
    p.el.style.display = "";
  }

  burst(kind: FxKind, x: number, y: number, n: number, speed = 90) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
      const v = speed * (0.6 + Math.random() * 0.6);
      this.emit(kind, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 260, life: 1.1 + Math.random() * 0.6, vr: (Math.random() - 0.5) * 720, s: 0.8 + Math.random() * 0.5 });
    }
  }

  clear() { for (const p of this.pool) { p.on = false; p.el.style.display = "none"; } }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.on) continue;
      p.life += dt;
      if (p.life >= p.max) { p.on = false; p.el.style.display = "none"; continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt + (p.wob ? Math.sin(p.life * 6) * p.wob * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const k = p.life / p.max;
      const s = p.s + (p.s1 - p.s) * k;
      const pop = Math.min(1, p.life * 8);
      const op = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      p.el.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${p.rot.toFixed(0)}) scale(${(s * pop).toFixed(2)})`);
      p.el.setAttribute("opacity", op.toFixed(2));
    }
  }
}
