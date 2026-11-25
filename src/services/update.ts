// Update checks. Two sources, checked in this order:
//  1. Local (developers): `npm run release` builds a new installer into <project>/releases. The buddy
//     finds it (src-tauri/src/update.rs) and offers an "Update" button that installs it and relaunches.
//  2. GitHub Releases (everyone else): about twice a day the buddy asks GitHub for the latest release.
//     If it is newer, "Download" opens the release page in your browser. Nothing is downloaded or run
//     automatically. Turn it off in Settings → App → "Check for updates".
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import type { Buddy } from "../buddy/buddy";
import type { Overlay } from "../ui/overlay";
import { flushBeforeQuit } from "./session";
import { loadSettings } from "../shared/settings";
import { isNewer } from "../shared/version";

/** The GitHub repository releases are published to. */
export const REPO = "nijil71/Deskbuddy";

interface LocalUpdate { version: string; current: string; path: string }
interface RemoteUpdate { version: string; current: string; url: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LATER_MS = 4 * 3600_000;
const GITHUB_EVERY_MS = 12 * 3600_000;

let offered = "";                            // version currently shown in a bubble
const snoozed: Record<string, number> = {};  // version → don't ask again until
let ghChecked = 0;                           // last GitHub request (epoch ms)
let ghFound: RemoteUpdate | null = null;     // its answer, reused between requests

async function localUpdate(): Promise<LocalUpdate | null> {
  try { return await invoke<LocalUpdate | null>("local_update"); }
  catch (e) { console.warn("local update check", e); return null; }
}

async function githubUpdate(force: boolean): Promise<RemoteUpdate | null> {
  if (!force && Date.now() - ghChecked < GITHUB_EVERY_MS) return ghFound;
  ghChecked = Date.now();
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return (ghFound = null); // 404 = no releases yet
    const rel = await r.json();
    const version = String(rel.tag_name ?? "").replace(/^v/, "");
    const current = await getVersion();
    ghFound = isNewer(version, current) ? { version, current, url: String(rel.html_url) } : null;
  } catch (e) {
    console.warn("github update check", e); // offline: try again next time
    ghChecked = 0;
  }
  return ghFound;
}

export async function checkForUpdate(b: Buddy, ui: Overlay, manual = false) {
  const local = await localUpdate();
  const remote = local ? null : (manual || (await loadSettings()).updates.check) ? await githubUpdate(manual) : null;
  const u = local ?? remote;
  if (!u) { if (manual) ui.say("I'm the newest version ✓", { ms: 2500 }); return; }
  if (!manual && ((snoozed[u.version] ?? 0) > Date.now() || offered === u.version)) return;
  if (!manual && b.priority >= 3) return; // busy with something important; next check will offer

  offered = u.version;
  const later = { label: "Later", fn: () => { snoozed[u.version] = Date.now() + LATER_MS; offered = ""; } };
  b.play("holdSign", { text: `v${u.version}!`, dur: 4 }, { force: true });
  if (local) {
    ui.say(`🎁 <b>Update available: v${esc(local.version)}</b><br><small>You're on v${esc(local.current)}. Takes a few seconds, then I'll be right back.</small>`, {
      html: true, ms: 0,
      buttons: [{ label: "Update", primary: true, fn: () => void install(b, ui, local) }, later],
    });
  } else if (remote) {
    ui.say(`🎁 <b>New version: v${esc(remote.version)}</b><br><small>You're on v${esc(remote.current)}. Download the installer and run it; your settings and notes are kept.</small>`, {
      html: true, ms: 0,
      buttons: [{ label: "Download", primary: true, fn: () => { offered = ""; void invoke("shell_open", { target: remote.url }); } }, later],
    });
  }
}

async function install(b: Buddy, ui: Overlay, u: LocalUpdate) {
  b.play("wave", { text: `Updating to v${u.version}… brb 👋` }, { force: true });
  await flushBeforeQuit(); // save short-term memory before the installer closes us
  try { await invoke("install_local_update", { path: u.path }); }
  catch (e) {
    offered = "";
    ui.say(`Update failed 😕<br><small>${esc(String(e)).slice(0, 140)}</small>`, { html: true, ms: 6000 });
  }
}

/** Check shortly after start, then every 2 minutes (the local check is just a folder listing;
 *  GitHub is asked at most every 12 hours). */
export function startUpdateChecks(b: Buddy, ui: Overlay) {
  if (import.meta.env.DEV) return; // `tauri dev` isn't installed; nothing to update
  setTimeout(() => void checkForUpdate(b, ui), 20_000);
  setInterval(() => void checkForUpdate(b, ui), 2 * 60_000);
}
