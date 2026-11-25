// Local self-update. `npm run release` bumps the version and builds a new installer into
// src-tauri/target/release/bundle/nsis; the buddy checks that folder (src-tauri/src/update.rs)
// and offers an "Update" button that installs it and relaunches the new version.
import { invoke } from "@tauri-apps/api/core";
import type { Buddy } from "../buddy/buddy";
import type { Overlay } from "../ui/overlay";

interface LocalUpdate { version: string; current: string; path: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LATER_MS = 4 * 3600_000;

let offered = "";                            // version currently shown in a bubble
const snoozed: Record<string, number> = {};  // version → don't ask again until

export async function checkForUpdate(b: Buddy, ui: Overlay, manual = false) {
  let u: LocalUpdate | null;
  try { u = await invoke<LocalUpdate | null>("local_update"); }
  catch (e) { console.warn("update check", e); u = null; }
  if (!u) { if (manual) ui.say("I'm the newest build ✓", { ms: 2500 }); return; }
  if (!manual && ((snoozed[u.version] ?? 0) > Date.now() || offered === u.version)) return;
  if (!manual && b.priority >= 3) return; // busy with something important; next check will offer

  offered = u.version;
  const upd = u;
  b.play("holdSign", { text: `v${upd.version}!`, dur: 4 }, { force: true });
  ui.say(`🎁 <b>Update available: v${esc(upd.version)}</b><br><small>You're on v${esc(upd.current)}. Takes a few seconds, then I'll be right back.</small>`, {
    html: true, ms: 0,
    buttons: [
      { label: "Update", primary: true, fn: () => void install(b, ui, upd) },
      { label: "Later", fn: () => { snoozed[upd.version] = Date.now() + LATER_MS; offered = ""; } },
    ],
  });
}

async function install(b: Buddy, ui: Overlay, u: LocalUpdate) {
  b.play("wave", { text: `Updating to v${u.version}… brb 👋` }, { force: true });
  try { await invoke("install_local_update", { path: u.path }); }
  catch (e) {
    offered = "";
    ui.say(`Update failed 😕<br><small>${esc(String(e)).slice(0, 140)}</small>`, { html: true, ms: 6000 });
  }
}

/** Check shortly after start, then every 2 minutes (it's just a folder listing). */
export function startUpdateChecks(b: Buddy, ui: Overlay) {
  if (import.meta.env.DEV) return; // `tauri dev` isn't installed; nothing to update
  setTimeout(() => void checkForUpdate(b, ui), 20_000);
  setInterval(() => void checkForUpdate(b, ui), 2 * 60_000);
}
