// Shape helpers: point lists -> SVG path strings, with hand-drawn jitter.

/** [x, y, sharp?] — sharp points become corners (hair spikes), others are rounded. */
export type Pt = [number, number, number?];

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

const f = (n: number) => Math.round(n * 10) / 10;

/** Closed blob through points: rounded at normal points, pointy at sharp ones. */
export function blob(pts: Pt[]): string {
  const n = pts.length;
  const mid = (a: Pt, b: Pt) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  let d = `M${f(m0[0])} ${f(m0[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    if (p[2]) d += `L${f(p[0])} ${f(p[1])}L${f(m[0])} ${f(m[1])}`;
    else d += `Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
  }
  return d + "Z";
}

/** Open smooth stroke through points. */
export function stroke(pts: Pt[]): string {
  if (pts.length < 3) return `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join("L")}`;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const nx = (p[0] + pts[i + 1][0]) / 2;
    const ny = (p[1] + pts[i + 1][1]) / 2;
    d += `Q${f(p[0])} ${f(p[1])} ${i === pts.length - 2 ? f(pts[i + 1][0]) : f(nx)} ${i === pts.length - 2 ? f(pts[i + 1][1]) : f(ny)}`;
  }
  return d;
}

export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 18): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Slightly overshoot control points so the quadratic blob stays ellipse-sized.
    out.push([cx + Math.cos(a) * rx * 1.02, cy + Math.sin(a) * ry * 1.02]);
  }
  return out;
}

export function roundRectPts(cx: number, cy: number, w: number, h: number, r: number): Pt[] {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return [
    [x0 + r, y0], [cx, y0 - 0.5], [x1 - r, y0], [x1, y0], [x1, y0 + r], [x1 + 0.5, cy], [x1, y1 - r],
    [x1, y1], [x1 - r, y1], [cx, y1 + 0.5], [x0 + r, y1], [x0, y1], [x0, y1 - r], [x0 - 0.5, cy], [x0, y0 + r], [x0, y0],
  ];
}

export function jitter(pts: Pt[], amt: number, seed: number): Pt[] {
  const r = rng(seed);
  return pts.map((p) => [p[0] + (r() - 0.5) * 2 * amt, p[1] + (r() - 0.5) * 2 * amt, p[2]] as Pt);
}

/** Three "boiling" variants of a closed shape (hand-drawn wobble). */
export function boilBlob(pts: Pt[], amt = 0.9, seed = 7): string[] {
  return [0, 1, 2].map((i) => blob(i === 0 ? pts : jitter(pts, amt, seed * 31 + i * 977)));
}
export function boilStroke(pts: Pt[], amt = 0.8, seed = 7): string[] {
  return [0, 1, 2].map((i) => stroke(i === 0 ? pts : jitter(pts, amt, seed * 17 + i * 613)));
}
