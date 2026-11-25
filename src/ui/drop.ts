// Drop things on the buddy: files, folders, images, links or a bit of text.
// He catches it, shows what it is, and offers something useful to do with it:
//   folder / file → pin to the launcher, open · image → holds it up · text file → reads it (word count)
//   link → save to the launcher, open · text snippet → save as a sticky note
//   image → "Copy text" (OCR) · video link → download MP4 / MP3 (yt-dlp)
//   any convertible file → "Convert" to another format (jpg→png, mov→mp4, wav→mp3, docx→pdf…), see src-tauri/src/convert.rs
// File paths come from WebView2 via postMessageWithAdditionalObjects (see src-tauri/src/input.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Buddy } from "../buddy/buddy";
import type { Overlay } from "./overlay";
import { dropKind, fmtBytes, niceName, wordStats, type DropKind } from "../buddy/play";
import { isVideoLink } from "../shared/links";
import { loadNotes, patchSettings, saveNotes, uid } from "../shared/settings";
import { icon } from "../shared/icons";
import { ocrFile } from "./ocr";

const ic = (n: string) => icon(n, `i ie ie-${n}`);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

interface Dropped { kind: DropKind; name: string; path?: string; paths: string[]; size?: number; file?: File; url?: string; text?: string; more: number }

/** Ask the host for the dropped files' real paths (WebView2 only knows them on its side). */
let pathWaiter: ((p: string[]) => void) | null = null;
function askPaths(files: FileList): Promise<string[]> {
  const wv = (window as any).chrome?.webview;
  if (!wv?.postMessageWithAdditionalObjects) return Promise.resolve([]);
  return new Promise((res) => {
    const timer = setTimeout(() => { pathWaiter = null; res([]); }, 900);
    pathWaiter = (p) => { clearTimeout(timer); pathWaiter = null; res(p); };
    try { wv.postMessageWithAdditionalObjects("deskbud-drop", files); } catch { clearTimeout(timer); pathWaiter = null; res([]); }
  });
}

export async function setupDrop(b: Buddy, ui: Overlay, onTouch: () => void) {
  await listen<string[]>("drop-paths", (e) => pathWaiter?.(e.payload));

  let hovering = false;
  const isExternal = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].some((t) => t === "Files" || t === "text/uri-list" || t === "text/plain");

  document.addEventListener("dragenter", (e) => {
    if (!isExternal(e)) return;
    e.preventDefault();
    if (!hovering) {
      hovering = true;
      if (b.priority < 3 && !b.dragging) b.play("eager", undefined, { force: true });
    }
  });
  document.addEventListener("dragover", (e) => {
    if (!isExternal(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
  });
  document.addEventListener("dragleave", (e) => {
    if (e.relatedTarget) return; // still inside the page
    hovering = false;
    if (b.actionName === "eager") b.stop();
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    hovering = false;
    const dt = e.dataTransfer;
    if (!dt) return;
    onTouch();
    const d = await read(dt);
    if (!d) { if (b.actionName === "eager") b.stop(); return; }
    const targets = d.path && d.kind !== "folder" ? await convertTargets(d.path) : NO_TARGETS;
    react(b, ui, d, targets);
  });
}

async function read(dt: DataTransfer): Promise<Dropped | null> {
  const files = dt.files;
  if (files && files.length) {
    const f = files[0];
    const entry = dt.items?.[0]?.webkitGetAsEntry?.();
    const paths = await askPaths(files);
    const isDir = !!entry?.isDirectory;
    const kind = dropKind({ name: f.name, type: f.type, isDir });
    return { kind, name: f.name, path: paths[0], paths, size: f.size, file: f, more: files.length - 1 };
  }
  const uri = (dt.getData("text/uri-list") || "").split(/\r?\n/).find((l) => l && !l.startsWith("#"));
  const text = dt.getData("text/plain") || "";
  if (uri && /^https?:\/\//i.test(uri)) return { kind: "link", name: niceName(uri), url: uri, paths: [], more: 0 };
  if (/^https?:\/\/\S+$/i.test(text.trim())) return { kind: "link", name: niceName(text.trim()), url: text.trim(), paths: [], more: 0 };
  if (text.trim()) return { kind: "snippet", name: "", text, paths: [], more: 0 };
  return null;
}

async function pin(ui: Overlay, name: string, target: string) {
  let dup = false;
  await patchSettings((s) => {
    dup = s.launcher.some((i) => i.target.toLowerCase() === target.toLowerCase());
    if (!dup) s.launcher.push({ name: short(name, 40), target });
  });
  ui.say(dup ? "Already in your launcher 👍" : "Pinned! Press Ctrl+Alt+Space to launch it 🚀", { ms: 3000 });
}

const open = (ui: Overlay, target: string) =>
  invoke<boolean>("shell_open", { target }).then((ok) => { if (!ok) ui.say("Couldn't open that 😕", { ms: 2500 }); }).catch(() => ui.say("Couldn't open that 😕", { ms: 2500 }));

function react(b: Buddy, ui: Overlay, d: Dropped, targets: Targets) {
  const more = d.more > 0 ? `<br><small>+ ${d.more} more</small>` : "";
  const btn = (label: string, fn: () => void, primary = false) => ({ label, fn, primary });
  const convertBtn = targets.formats.length
    ? [btn("Convert…", () => offerConvert(b, ui, d, targets.formats))]
    : targets.missing ? [btn("Convert…", () => explainMissing(ui, d.name, targets.missing!))] : [];
  const fileBtns = (name: string) => d.path ? [btn("Pin to launcher", () => pin(ui, name, d.path!), true), btn("Open", () => open(ui, d.path!)), ...convertBtn] : [];
  const say = (html: string, buttons: ReturnType<typeof btn>[], ms = 9000) => ui.say(html, { html: true, buttons: buttons.length ? buttons : undefined, ms: buttons.length ? 0 : ms });

  switch (d.kind) {
    case "folder": {
      const name = niceName(d.path ?? d.name);
      b.play("holdUp", { prop: "folder", dur: 3 }, { force: true });
      say(`${ic("folder")} <b>${esc(short(name, 32))}</b>${more}<br>Want it one keypress away?`, fileBtns(name));
      break;
    }
    case "image": {
      const src = d.file ? URL.createObjectURL(d.file) : "";
      if (src) b.play("showPhoto", { src, dur: 5 }, { force: true }).then(() => setTimeout(() => URL.revokeObjectURL(src), 500));
      const ocr = d.path ? [btn("Copy text", () => void ocrFile(b, ui, d.path!))] : [];
      say(`${pick(["Ooh, nice picture!", "Look what you gave me!", "Framing this one!"])} ${ic("camera")}<br><small>${esc(short(d.name, 34))} · ${fmtBytes(d.size ?? 0)}</small>${more}`, [...fileBtns(d.name), ...ocr]);
      break;
    }
    case "text": {
      b.play("holdUp", { prop: "paper", dur: 3.2, read: true }, { force: true });
      if (d.file && (d.size ?? 0) <= 2 * 1024 * 1024) {
        d.file.text().then((t) => {
          const w = wordStats(t);
          say(`${ic("paper")} <b>${esc(short(d.name, 30))}</b>${more}<br>${w.words.toLocaleString()} words · ${w.lines.toLocaleString()} lines · ~${w.mins} min read`, fileBtns(d.name));
        }).catch(() => say(`${ic("paper")} <b>${esc(short(d.name, 30))}</b>`, fileBtns(d.name)));
      } else say(`${ic("paper")} <b>${esc(short(d.name, 30))}</b> · ${fmtBytes(d.size ?? 0)}${more}<br>Too long for me to read ${ic("faceSmile")}`, fileBtns(d.name));
      break;
    }
    case "file": {
      b.play("holdUp", { prop: "box", dur: 3 }, { force: true });
      say(`${ic("box")} <b>${esc(short(d.name, 30))}</b> · ${fmtBytes(d.size ?? 0)}${more}`, fileBtns(d.name));
      break;
    }
    case "link": {
      b.play("holdUp", { prop: "link", dur: 3 }, { force: true });
      const linkBtns = [btn("Save to launcher", () => pin(ui, d.name, d.url!), true), btn("Open", () => open(ui, d.url!))];
      if (isVideoLink(d.url!)) {
        invoke<boolean>("ytdlp_available").catch(() => false).then((ok) => say(
          `${ic("film")} <b>${esc(short(d.name, 34))}</b><br>Download it, or save it for later?`,
          ok ? [btn("Video", () => void download(b, ui, d.url!, false), true), btn("MP3", () => void download(b, ui, d.url!, true)), ...linkBtns]
             : [btn("Download…", () => explainMissing(ui, d.name, "yt-dlp")), ...linkBtns],
        ));
      } else say(`${ic("link")} <b>${esc(short(d.name, 34))}</b><br>Save it for later?`, linkBtns);
      break;
    }
    case "snippet": {
      const t = d.text!.trim();
      const w = wordStats(t);
      b.play("holdUp", { prop: "paper", dur: 3, read: true }, { force: true });
      say(`“${esc(short(t.replace(/\s+/g, " "), 70))}”<br><small>${w.words.toLocaleString()} word${w.words === 1 ? "" : "s"}</small>`, [
        btn("Save as note", async () => {
          const list = await loadNotes();
          await saveNotes([{ id: uid(), text: short(t, 2000), color: "#fff4a8", ts: Date.now() }, ...list]);
          b.play("holdNote", { text: short(t.replace(/\s+/g, " "), 40) }, { force: true });
        }, true),
        btn("Nope", () => ui.hideBubble()),
      ]);
      break;
    }
  }
}

// ------------------------------------------------------------------ convert

interface Targets { formats: string[]; missing: string | null }
const NO_TARGETS: Targets = { formats: [], missing: null };
const convertTargets = (path: string) => invoke<Targets>("convert_targets", { path }).catch(() => NO_TARGETS);
const extOf = (p: string) => (p.match(/\.([^.\\/]+)$/)?.[1] ?? "").toLowerCase();
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

const INSTALL: Record<string, string> = {
  FFmpeg: "winget install Gyan.FFmpeg",
  pandoc: "winget install JohnMacFarlane.Pandoc",
  LibreOffice: "winget install TheDocumentFoundation.LibreOffice",
  "yt-dlp": "winget install yt-dlp.yt-dlp",
};

function explainMissing(ui: Overlay, name: string, tool: string) {
  const cmd = INSTALL[tool] ?? "";
  ui.say(`To convert <b>${esc(short(name, 28))}</b> I need <b>${esc(tool)}</b>.<br><small>Install it once, then drop the file again:<br><code>${esc(cmd)}</code></small>`, {
    html: true, ms: 0,
    buttons: [
      { label: "Copy command", primary: true, fn: () => { invoke("clip_set", { text: cmd }).catch(() => {}); ui.say("Copied! Paste it in a terminal 📋", { ms: 2500 }); } },
      { label: "Later", fn: () => {} },
    ],
  });
}

function offerConvert(b: Buddy, ui: Overlay, d: Dropped, formats: string[]) {
  const ext = extOf(d.path!);
  // Several files dropped: convert every one of the same type as the first.
  const batch = d.paths.filter((p) => extOf(p) === ext);
  const what = batch.length > 1 ? `${batch.length} .${ext} files` : esc(short(d.name, 28));
  ui.say(`${ic("box")} Turn <b>${what}</b> into…`, {
    html: true, ms: 0,
    buttons: [
      ...formats.map((f, i) => ({ label: f.toUpperCase(), primary: i === 0, fn: () => runConvert(b, ui, batch.length ? batch : [d.path!], f) })),
      { label: "Cancel", fn: () => {} },
    ],
  });
}

let converting = false;
async function runConvert(b: Buddy, ui: Overlay, paths: string[], to: string) {
  if (converting) { ui.say("Hang on, I'm still converting the last one ⏳", { ms: 2500 }); return; }
  converting = true;
  const label = to.toUpperCase();
  b.play("magic", undefined, { force: true });
  const done: string[] = [];
  const failed: string[] = [];
  try {
    for (const [i, p] of paths.entries()) {
      ui.say(`Converting to ${label}${paths.length > 1 ? ` (${i + 1}/${paths.length})` : ""}… ✨`, { ms: 0 });
      try { done.push(await invoke<string>("convert_file", { path: p, to })); }
      catch (e) { failed.push(String(e)); }
    }
  } finally { converting = false; }

  if (!done.length) {
    b.play("poke", { kind: "startle" }, { force: true });
    ui.say(`Couldn't convert that 😕<br><small>${esc(short(failed[0] ?? "", 120))}</small>`, { html: true, ms: 6000 });
    return;
  }
  const last = done[done.length - 1];
  const head = done.length > 1 ? `${done.length} files → ${label}` : esc(short(baseName(last), 34));
  const fails = failed.length ? `<br><small>${failed.length} couldn't be converted</small>` : "";
  b.play("celebrate", undefined, { force: true });
  ui.say(`${ic("faceSmile")} Done! <b>${head}</b>${fails}<br><small>Saved next to the original</small>`, {
    html: true, ms: 0,
    buttons: [
      ...(done.length === 1 ? [{ label: "Open", primary: true, fn: () => open(ui, last) }] : []),
      { label: "Show in folder", primary: done.length > 1, fn: () => { invoke("reveal_file", { path: last }).catch(() => {}); } },
      { label: "OK", fn: () => {} },
    ],
  });
}

// ------------------------------------------------------------------ download (yt-dlp)

/** Offer Video / MP3 for a link: from the menu, or right after you copied one (`auto`). */
export async function offerDownload(b: Buddy, ui: Overlay, url: string, auto?: { notNow: () => void }) {
  const ok = await invoke<boolean>("ytdlp_available").catch(() => false);
  const name = niceName(url);
  if (!ok) { if (!auto) explainMissing(ui, name, "yt-dlp"); return; }
  if (auto && ui.bubbleVisible) return; // never push aside something already showing
  ui.say(`${ic("film")} Download <b>${esc(short(name, 34))}</b>?`, {
    html: true, ms: auto ? 9000 : 0,
    buttons: [
      { label: "Video", primary: true, fn: () => void download(b, ui, url, false) },
      { label: "MP3", fn: () => void download(b, ui, url, true) },
      { label: auto ? "Not now" : "Cancel", fn: () => auto?.notNow() },
    ],
  });
}

let downloading = false;
async function download(b: Buddy, ui: Overlay, url: string, audio: boolean) {
  if (downloading) { ui.say("One download at a time — still on the last one ⏳", { ms: 2500 }); return; }
  downloading = true;
  const what = audio ? "MP3" : "video";
  b.play("magic", undefined, { force: true });
  ui.say(`Downloading the ${what}… ⏳`, { ms: 0 });
  let shown = -1;
  const un = await listen<{ pct: number }>("dl-progress", (e) => {
    const p = Math.floor(e.payload.pct);
    if (p !== shown && p % 5 === 0) { shown = p; ui.say(`Downloading the ${what}… ${p}% ⏳`, { ms: 0 }); }
  });
  try {
    const path = await invoke<string>("download_media", { url, audio });
    b.play("celebrate", undefined, { force: true });
    ui.say(`${ic("download")} Saved to Downloads<br><small>${esc(short(baseName(path), 46))}</small>`, {
      html: true, ms: 0,
      buttons: [
        { label: audio ? "Play" : "Watch", primary: true, fn: () => open(ui, path) },
        { label: "Show in folder", fn: () => { invoke("reveal_file", { path }).catch(() => {}); } },
        { label: "OK", fn: () => {} },
      ],
    });
  } catch (e) {
    ui.say(`Couldn't download that 😕<br><small>${esc(short(String(e), 140))}</small>`, { html: true, ms: 7000 });
  } finally { un(); downloading = false; }
}

const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
