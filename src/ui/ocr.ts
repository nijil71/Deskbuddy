// "Copy text" from a snip or an image: Windows' built-in OCR (src-tauri/src/ocr.rs) reads it, the
// text goes on the clipboard (and into clipboard history), and the buddy shows what he read.
import { invoke } from "@tauri-apps/api/core";
import type { Buddy } from "../buddy/buddy";
import type { Overlay } from "./overlay";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let busy = false;

async function run(b: Buddy, ui: Overlay, read: () => Promise<string>, waitMsg: string, waitMs: number) {
  if (busy) return;
  busy = true;
  ui.say(waitMsg, { ms: waitMs });
  try {
    const text = (await read()).trim();
    if (!text) { ui.say("I couldn't find any text in that 🔍", { ms: 3500 }); return; }
    await invoke("clip_set", { text });
    const words = text.split(/\s+/).filter(Boolean).length;
    const preview = text.replace(/\s+/g, " ");
    b.play("holdUp", { prop: "paper", dur: 2.5, read: true }, { force: true });
    ui.say(`📋 Copied ${words.toLocaleString()} word${words === 1 ? "" : "s"}<br><small>“${esc(preview.length > 90 ? preview.slice(0, 89) + "…" : preview)}”</small>`, { html: true, ms: 6000 });
  } catch (e) {
    if (!/No snip taken/.test(String(e))) ui.say(`${esc(String(e))} 😕`, { html: true, ms: 3500 });
  } finally { busy = false; }
}

/** Menu: open the snipping overlay, read the snipped area. */
export const ocrSnip = (b: Buddy, ui: Overlay) =>
  run(b, ui, () => invoke<string>("ocr_snip"), "Snip the area with the text ✂️", 6000); // Esc in the overlay just times out quietly

/** A dropped image file. */
export const ocrFile = (b: Buddy, ui: Overlay, path: string) =>
  run(b, ui, () => invoke<string>("ocr_file", { path }), "Reading it… 🔍", 0);
