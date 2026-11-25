// Version helpers for the update check (kept free of Tauri imports so tests can load them).

/** "v1.2.3" / "1.2.3-beta" → [1, 2, 3]; null if it isn't a version. Pre-release suffixes are ignored. */
export function parseVersion(s: string): [number, number, number] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** True when `candidate` is a strictly higher version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
