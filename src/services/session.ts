// Short-term memory across restarts (updates, quitting, crashes): what you're doing right now,
// a running focus timer, today's work tracking. Saved every 30 s and right before quitting or
// updating; restored on start if it's recent. Long-term memory (notes, mood, days together,
// activity) already lives in the store and is backed up daily (src-tauri/src/backup.rs).
import { store } from "../shared/settings";
import type { FocusState } from "./focus";
import type { TrackerSnap } from "../buddy/state";

export interface Session { at: number; focus: FocusState; work: TrackerSnap }

export const loadSession = async (): Promise<Session | null> => ((await (await store()).get<Session>("session")) ?? null);

export async function saveSession(s: Session) {
  const st = await store();
  await st.set("session", s);
  await st.save(); // write now, not on the debounce: we may be about to exit
}

const beforeQuit: (() => Promise<void>)[] = [];
/** Run something right before the app quits or installs an update. */
export const onBeforeQuit = (fn: () => Promise<void>) => { beforeQuit.push(fn); };
export const flushBeforeQuit = () => Promise.allSettled(beforeQuit.map((f) => f())).then(() => {});
