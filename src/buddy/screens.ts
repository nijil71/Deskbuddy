// Multi-monitor geometry, kept pure (no Tauri) so it can be unit-tested.
// Monitors come from Windows in physical pixels; the buddy walks along their bottoms (floors).
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Mon { bounds: Rect; work: Rect; scale: number; primary: boolean; }

export const sameMon = (a: Mon | null | undefined, b: Mon | null | undefined) =>
  !!a && !!b && a.bounds.x === b.bounds.x && a.bounds.y === b.bounds.y && a.bounds.w === b.bounds.w && a.bounds.h === b.bounds.h;

/** The monitor at a point. Off-screen points (e.g. feet just past a shorter screen's bottom) go
 *  to the monitor whose columns contain x, then to the nearest one. */
export function monitorAt(mons: Mon[], x: number, y: number): Mon | null {
  for (const m of mons) {
    const b = m.bounds;
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return m;
  }
  let best: Mon | null = null, bestD = Infinity;
  for (const m of mons) {
    const b = m.bounds;
    if (x >= b.x && x < b.x + b.w) {
      const d = y < b.y ? b.y - y : y - (b.y + b.h);
      if (d < bestD) { bestD = d; best = m; }
    }
  }
  if (best) return best;
  for (const m of mons) {
    const b = m.bounds;
    const d = Math.abs(x - (b.x + b.w / 2)) + Math.abs(y - (b.y + b.h / 2));
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

/** Side-by-side neighbour you can walk to: shares a vertical edge and overlaps enough vertically. */
export function neighbor(mons: Mon[], here: Mon, dir: -1 | 1): Mon | null {
  const h = here.bounds;
  const edge = dir > 0 ? h.x + h.w : h.x;
  for (const m of mons) {
    if (sameMon(m, here)) continue;
    const b = m.bounds;
    const touches = dir > 0 ? Math.abs(b.x - edge) <= 8 : Math.abs(b.x + b.w - edge) <= 8;
    const overlap = Math.min(h.y + h.h, b.y + b.h) - Math.max(h.y, b.y);
    if (touches && overlap >= 200) return m;
  }
  return null;
}

export type Route =
  | { kind: "walk"; dir: -1 | 1; dest: Mon }   // side by side: walk across the shared edge
  | { kind: "hop"; dest: Mon };                // stacked / gap: duck out, pop up on the other screen

/** How to get from `here` to `to` (or to the nearest other screen when `to` is omitted). */
export function route(mons: Mon[], here: Mon, to?: Mon | null): Route | null {
  const others = mons.filter((m) => !sameMon(m, here));
  if (!others.length) return null;
  const right = neighbor(mons, here, 1), left = neighbor(mons, here, -1);
  if (to) {
    if (sameMon(to, here)) return null;
    if (sameMon(to, right)) return { kind: "walk", dir: 1, dest: to };
    if (sameMon(to, left)) return { kind: "walk", dir: -1, dest: to };
    return { kind: "hop", dest: to };
  }
  if (right && left) return Math.random() < 0.5 ? { kind: "walk", dir: 1, dest: right } : { kind: "walk", dir: -1, dest: left };
  if (right) return { kind: "walk", dir: 1, dest: right };
  if (left) return { kind: "walk", dir: -1, dest: left };
  return { kind: "hop", dest: others[0] };
}
