// Drop things on the buddy: files, folders, images, links or a bit of text.
// He catches it, shows what it is, and offers something useful to do with it:
//   folder / file → pin to the launcher, open · image → holds it up · text file → reads it (word count)
//   link → save to the launcher, open · text snippet → save as a sticky note
// File paths come from WebView2 via postMessageWithAdditionalObjects (see src-tauri/src/input.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Buddy } from "../buddy/buddy";
import type { Overlay } from "./overlay";
import { dropKind, fmtBytes, niceName, wordStats, type DropKind } from "../buddy/play";
import { loadNotes, patchSettings, saveNotes, uid } from "../shared/settings";
import { icon } from "../shared/icons";

const ic = (n: string) => icon(n, `i ie ie-${n}`);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

interface Dropped { kind: DropKind; name: string; path?: string; size?: number; file?: File; url?: string; text?: string; more: number }

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
    react(b, ui, d);
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
    return { kind, name: f.name, path: paths[0], size: f.size, file: f, more: files.length - 1 };
  }
  const uri = (dt.getData("text/uri-list") || "").split(/\r?\n/).find((l) => l && !l.startsWith("#"));
  const text = dt.getData("text/plain") || "";
  if (uri && /^https?:\/\//i.test(uri)) return { kind: "link", name: niceName(uri), url: uri, more: 0 };
  if (/^https?:\/\/\S+$/i.test(text.trim())) return { kind: "link", name: niceName(text.trim()), url: text.trim(), more: 0 };
  if (text.trim()) return { kind: "snippet", name: "", text, more: 0 };
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

function react(b: Buddy, ui: Overlay, d: Dropped) {
  const more = d.more > 0 ? `<br><small>+ ${d.more} more</small>` : "";
  const btn = (label: string, fn: () => void, primary = false) => ({ label, fn, primary });
  const fileBtns = (name: string) => d.path ? [btn("Pin to launcher", () => pin(ui, name, d.path!), true), btn("Open", () => open(ui, d.path!))] : [];
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
      say(`${pick(["Ooh, nice picture!", "Look what you gave me!", "Framing this one!"])} ${ic("camera")}<br><small>${esc(short(d.name, 34))} · ${fmtBytes(d.size ?? 0)}</small>${more}`, fileBtns(d.name));
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
      say(`${ic("link")} <b>${esc(short(d.name, 34))}</b><br>Save it for later?`, [
        btn("Save to launcher", () => pin(ui, d.name, d.url!), true),
        btn("Open", () => open(ui, d.url!)),
      ]);
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

const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
