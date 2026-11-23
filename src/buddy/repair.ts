// Display changes — a VDI/RDP client going fullscreen and back, docking, resolution or scaling
// changes — can make Windows move or resize the buddy's window behind our back. The app only
// moves its window when *it* thinks the position changed, so without this he'd stay clipped
// (just the hair showing) until restart. This decides what needs repairing; main.ts applies it.

export interface Rect { x: number; y: number; w: number; h: number }
export interface RepairInput {
  actualSize: { w: number; h: number };     // window inner size now (physical px)
  wantSize: { w: number; h: number };       // what it should be (physical px)
  actualPos: { x: number; y: number };      // window outer position now
  wantPos: { x: number; y: number };        // where we last put it
  feet: { x: number; y: number };           // buddy feet (screen px)
  monitors: Rect[];                         // current monitor bounds
  busy: boolean;                            // dragging / mid-air: the window moves on purpose
}
export interface RepairPlan { resize: boolean; reposition: boolean; rehome: boolean }

const off = (a: number, b: number, tol: number) => Math.abs(a - b) > tol;

export function repairPlan(i: RepairInput): RepairPlan {
  const resize = off(i.actualSize.w, i.wantSize.w, 3) || off(i.actualSize.h, i.wantSize.h, 3);
  // feet must be on some monitor (a little slack at the bottom edge: he stands *on* it)
  const onScreen = i.monitors.some((m) => i.feet.x >= m.x - 4 && i.feet.x <= m.x + m.w + 4 && i.feet.y >= m.y + 40 && i.feet.y <= m.y + m.h + 4);
  const rehome = !i.busy && i.monitors.length > 0 && !onScreen;
  const reposition = !i.busy && (rehome || off(i.actualPos.x, i.wantPos.x, 3) || off(i.actualPos.y, i.wantPos.y, 3));
  return { resize, reposition, rehome };
}
