// Settings shared by the buddy window and the panel window (tauri-plugin-store).
import { load, type Store } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

export interface KeepCfg {
  enabled: boolean;
  thresholdS: number;
  workHoursOnly: boolean;
  days: boolean[];      // Sun..Sat
  startMin: number;
  endMin: number;
  pauseInCall: boolean;
}

export interface Reminder { on: boolean; every: number; } // minutes

export interface LaunchItem { name: string; target: string; }
export interface Note { id: string; text: string; color: string; ts: number; }
export interface Meeting { id: string; time: string; title: string; date: string; } // date YYYY-MM-DD

export interface Settings {
  keep: KeepCfg;
  skin: "ink" | "night" | "color";
  accessory: "auto" | "none" | "cap" | "headphones" | "crown" | "sunglasses" | "party";
  size: number;             // 0.8 .. 1.3
  chatter: "quiet" | "normal" | "chatty";
  /** work: calm, stays on the taskbar, 2 unprompted bubbles/h · chill: full personality,
   *  5/h · quiet: sits still, no bubbles or reminders (meetings & keep-alive still work) */
  mode: "work" | "chill" | "quiet";
  shhUntil: number;         // epoch ms; "shh for 1 hour"
  userName: string;
  birthday: string;         // "MM-DD" or 
  roam: boolean;            // walk around / climb windows
  hideFullscreen: boolean;
  dnd: boolean;
  reminders: { water: Reminder; stretch: Reminder; eyes: Reminder; posture: Reminder };
  focus: { work: number; short: number; long: number; rounds: number };
  weather: { city: string; lat: number | null; lon: number | null; unit: "c" | "f" };
  launcher: LaunchItem[];
  meetings: Meeting[];
  autostart: boolean;
  firstRun: boolean;
}

export const DEFAULTS: Settings = {
  keep: {
    enabled: true, thresholdS: 210, workHoursOnly: true,
    days: [false, true, true, true, true, true, false], startMin: 9 * 60, endMin: 18 * 60, pauseInCall: true,
  },
  skin: "ink",
  accessory: "auto",
  size: 1,
  chatter: "normal",
  mode: "work",
  shhUntil: 0,
  userName: "",
  birthday: "",
  roam: true,
  hideFullscreen: true,
  dnd: false,
  reminders: {
    water: { on: true, every: 60 },
    stretch: { on: true, every: 50 },
    eyes: { on: true, every: 20 },
    posture: { on: false, every: 45 },
  },
  focus: { work: 25, short: 5, long: 15, rounds: 4 },
  weather: { city: "", lat: null, lon: null, unit: "c" },
  launcher: [
    { name: "Microsoft Teams", target: "msteams:" },
    { name: "Notepad", target: "notepad.exe" },
    { name: "Calculator", target: "calc.exe" },
    { name: "File Explorer", target: "explorer.exe" },
    { name: "Downloads", target: "shell:Downloads" },
    { name: "Task Manager", target: "taskmgr.exe" },
    { name: "Windows Settings", target: "ms-settings:" },
    { name: "Snipping Tool", target: "ms-screenclip:" },
  ],
  meetings: [],
  autostart: true,
  firstRun: true,
};

let storeP: Promise<Store> | null = null;
export const store = () => (storeP ??= load("deskbud.json", { autoSave: 300, defaults: {} }));

function merge<T>(base: T, over: any): T {
  if (over === undefined || over === null) return structuredClone(base);
  if (Array.isArray(base) || typeof base !== "object" || base === null) return over as T;
  if (typeof over !== "object" || Array.isArray(over)) return structuredClone(base);
  // union of keys: defaults fill gaps, and map-like fields (Record<…>) keep their entries
  const out: any = { ...over };
  for (const k of Object.keys(base as any)) out[k] = merge((base as any)[k], over[k]);
  return out;
}

export async function loadSettings(): Promise<Settings> {
  const s = await store();
  return merge(DEFAULTS, await s.get("settings"));
}

export async function saveSettings(v: Settings) {
  const s = await store();
  await s.set("settings", v);
  await s.save();
  await emit("settings-changed", v);
}

export async function patchSettings(fn: (s: Settings) => void) {
  const v = await loadSettings();
  fn(v);
  await saveSettings(v);
  return v;
}

export function onSettings(cb: (s: Settings) => void) {
  return listen<Settings>("settings-changed", (e) => cb(merge(DEFAULTS, e.payload)));
}

export async function loadNotes(): Promise<Note[]> {
  return ((await (await store()).get<Note[]>("notes")) ?? []) as Note[];
}
export async function saveNotes(n: Note[]) {
  const s = await store();
  await s.set("notes", n);
  await s.save();
  await emit("notes-changed", n);
}

export const uid = () => Math.random().toString(36).slice(2, 10);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const SKINS: Record<Settings["skin"], Record<string, string>> = {
  ink: { "--ink": "#161313", "--paper": "#ffffff", "--hair": "#161313", "--skin": "#ffffff", "--shirt": "#ffffff", "--pants": "#161313", "--accent": "#5aa9e6", "--glass": "#161313", "--blush": "#ff9aa2" },
  night: { "--ink": "#f3efe6", "--paper": "#24232a", "--hair": "#f3efe6", "--skin": "#24232a", "--shirt": "#24232a", "--pants": "#f3efe6", "--accent": "#7cc4f5", "--glass": "#f3efe6", "--blush": "#ff7a90" },
  color: { "--ink": "#1d1a1a", "--paper": "#ffffff", "--hair": "#2e211b", "--skin": "#f8dcc0", "--shirt": "#6fa8dc", "--pants": "#2f3a4d", "--accent": "#f29e4c", "--glass": "#1f3b73", "--blush": "#f59a9a" },
};

// ------------------------------------------------------------------ the buddy's memory of you

export interface Memory {
  firstMet: number;          // epoch ms
  lastSeen: number;          // updated every minute while running
  lastDay: string;           // YYYY-MM-DD of last session
  daysTogether: number;      // distinct days we've spent together
  lunchMin: number | null;   // learned usual lunch start (minutes after midnight)
  lunchN: number;
  mood: { v: number; e: number };   // valence -1..1, energy 0..1
  dismissed: Record<string, number>; // suggestion key -> times you waved it away
  muted: Record<string, true>;       // keys muted after 2 dismissals
  songs: Record<string, number>;     // title -> plays (today)
  songsDay: string;
  done: Record<string, string>;      // once-per-day/once-ever events -> day fired
  lastInteract: number;
}

export const MEMORY_DEFAULTS: Memory = {
  firstMet: 0, lastSeen: 0, lastDay: "", daysTogether: 0, lunchMin: null, lunchN: 0,
  mood: { v: 0.3, e: 0.8 }, dismissed: {}, muted: {}, songs: {}, songsDay: "", done: {}, lastInteract: 0,
};

export async function loadMemory(): Promise<Memory> {
  const s = await store();
  return merge(MEMORY_DEFAULTS, await s.get("memory"));
}
export async function saveMemory(m: Memory) {
  const s = await store();
  await s.set("memory", m);
  await s.save();
}
