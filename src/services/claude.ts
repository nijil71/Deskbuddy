// Claude Code → buddy (events arrive from src-tauri/src/cc.rs via Claude Code hooks).
//   prompt → a session started working      stop → it finished      notify → it needs you
// He only speaks up when it's useful: a task that ran a while, or Claude waiting on you, and
// not when you're already looking at your terminal/editor.
import { listen } from "@tauri-apps/api/event";
import type { Buddy } from "../buddy/buddy";
import type { Overlay } from "../ui/overlay";

export interface ClaudeEvent { event: "prompt" | "stop" | "notify"; project: string; session: string; message: string; ts: number }

interface Ctx {
  b: Buddy;
  ui: Overlay;
  dnd: () => boolean;
  /** You're in your terminal/editor and active right now (so you saw it yourself). */
  watching: () => boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LONG_TASK_MS = 25_000;

export function fmtDur(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Pure decision logic (unit-tested): what should the buddy do with this event? */
export class ClaudeWatcher {
  private started = new Map<string, number>(); // session → when the current task began
  private stoppedAt = new Map<string, number>(); // session → when it last finished

  handle(e: ClaudeEvent, watching: boolean): { kind: "done" | "needs"; dur?: number } | null {
    const key = e.session || e.project;
    if (e.event === "prompt") { this.started.set(key, e.ts); return null; }
    if (e.event === "stop") {
      const t0 = this.started.get(key);
      this.started.delete(key);
      this.stoppedAt.set(key, e.ts);
      const dur = t0 !== undefined ? e.ts - t0 : 0;
      return dur >= LONG_TASK_MS && !watching ? { kind: "done", dur } : null;
    }
    if (e.event === "notify") {
      // "waiting for your input" fires ~1 min after a stop we already announced: skip it.
      const idle = /waiting for your input/i.test(e.message);
      const last = this.stoppedAt.get(key);
      if (idle && last !== undefined && e.ts - last < 5 * 60_000) return null;
      return watching ? null : { kind: "needs" };
    }
    return null;
  }

  get working() { return this.started.size; }
}

export async function setupClaude(c: Ctx) {
  const w = new ClaudeWatcher();
  await listen<ClaudeEvent>("claude-event", ({ payload: e }) => {
    const r = w.handle(e, c.watching());
    if (!r || c.dnd()) return;
    const where = e.project ? ` in <b>${esc(e.project)}</b>` : "";
    if (r.kind === "done") {
      c.b.play("celebrate", undefined, { force: true });
      c.ui.say(`✅ Claude finished${where}<br><small>took ${fmtDur(r.dur ?? 0)}</small>`, { html: true, ms: 12_000 });
    } else {
      c.b.play("holdSign", { text: "Claude!", dur: 3.5 }, { force: true });
      const msg = e.message && !/waiting for your input/i.test(e.message) ? `<br><small>${esc(e.message.slice(0, 120))}</small>` : "";
      c.ui.say(`🔔 Claude needs you${where}${msg}`, { html: true, ms: 0, buttons: [{ label: "OK", primary: true, fn: () => {} }] });
    }
  });
}
