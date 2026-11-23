// The buddy's day follows *your* working hours, not 9-to-5. Everything time-of-day related
// (coffee, meal break, standup, wrap-up, the comic, "it's late") asks this instead of the wall clock.
// Shifts that cross midnight (e.g. 22:00–06:00) work too.

export interface Shift { start: number; end: number } // minutes after midnight

export function shiftLen(s: Shift) { return ((s.end - s.start + 1440) % 1440) || 1440; }

/** Hours since your shift started (negative before it; wraps sensibly around midnight). */
export function sinceStart(s: Shift, d = new Date()) {
  const now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  let x = now - s.start;
  if (x < -12 * 60) x += 1440;       // e.g. 01:00 on a 22:00 shift → +3h
  if (x > 18 * 60) x -= 1440;
  return x / 60;
}

export type Phase = "before" | "start" | "early" | "mid" | "late" | "wrap" | "over" | "night";

/** Where you are in your working day. */
export function phase(s: Shift, d = new Date()): Phase {
  const h = sinceStart(s, d), L = shiftLen(s) / 60;
  if (h < -1) return h < -5 ? "night" : "before"; // long before your shift you are probably asleep
  if (h < 1.5) return "start";
  if (h < L * 0.4) return "early";
  if (h < L * 0.7) return "mid";
  if (h < L - 1) return "late";
  if (h < L + 0.5) return "wrap";
  if (h < L + 3) return "over";
  return "night";
}

/** Middle of the shift, where a meal break usually lands (minutes after midnight). */
export function mealGuess(s: Shift) { return (s.start + Math.round(shiftLen(s) * 0.5) - 30 + 1440) % 1440; }

/** Is this minute-of-day inside the window where a meal break is plausible? */
export function inMealWindow(s: Shift, min: number) {
  const mid = mealGuess(s);
  const dist = Math.min(Math.abs(min - mid), 1440 - Math.abs(min - mid));
  return dist <= 150;
}

/** "Lunch" during the day, "dinner"/"meal" for afternoon–night shifts. */
export function mealWord(min: number) { return min >= 10.5 * 60 && min < 15.5 * 60 ? "Lunch" : min >= 17 * 60 && min < 21.5 * 60 ? "Dinner" : "Meal break"; }

/** Energy target for the mood: perky at the start, dip after the meal, tired once you're past the end. */
export function energyTarget(s: Shift, d = new Date()) {
  const p = phase(s, d);
  return { night: 0.25, before: 0.6, start: 0.9, early: 0.85, mid: 0.65, late: 0.72, wrap: 0.6, over: 0.4 }[p];
}

export function greetWord(d = new Date()) {
  const h = d.getHours();
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : h >= 17 && h < 22 ? "Good evening" : "Hey";
}
