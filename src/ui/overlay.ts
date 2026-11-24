// HTML overlay above the SVG: speech bubbles, right-click menu, focus ring, badge.
import type { Buddy, SayOpts } from "../buddy/buddy";
import { icon, iconize } from "../shared/icons";
import { CX, HIP_Y, NECK, FACE, W, H } from "../buddy/rig";

interface Queued { text: string; opts: SayOpts; }

export class Overlay {
  bubble: HTMLDivElement;
  private bubbleText: HTMLDivElement;
  private bubbleBtns: HTMLDivElement;
  menu: HTMLDivElement;
  ring: HTMLDivElement;
  private ringArc: SVGCircleElement;
  private ringText: HTMLDivElement;
  badge: HTMLDivElement;
  private hideTimer = 0;
  private queue: Queued[] = [];
  private sticky = false;
  private pos = { x: -1, y: -1 };
  private bh = 0; // bubble height, so tall bubbles slide down instead of leaving the window
  menuOpen = false;
  currentKey = "";   // suggestion key of the visible bubble ("" = you asked for it)
  quiet = false; // DND: suppress non-essential bubbles

  constructor(private host: HTMLElement, private b: Buddy) {
    this.bubble = div("bubble");
    this.bubbleText = div("bubble-text", this.bubble);
    this.bubbleBtns = div("bubble-btns", this.bubble);
    host.appendChild(this.bubble);

    this.menu = div("menu");
    host.appendChild(this.menu);
    // ways out: Esc, or a click anywhere in the window that isn't the menu
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.menuOpen) this.closeMenu(); });
    document.addEventListener("pointerdown", (e) => {
      if (this.menuOpen && !this.menu.contains(e.target as Node)) this.closeMenu();
    }, true);

    this.ring = div("ring");
    this.ring.innerHTML = `<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" class="ring-bg"/><circle cx="22" cy="22" r="18" class="ring-fg"/></svg>`;
    this.ringArc = this.ring.querySelector(".ring-fg")!;
    this.ringText = div("ring-text", this.ring);
    host.appendChild(this.ring);

    this.badge = div("badge");
    this.badge.title = "Keeping Teams green";
    host.appendChild(this.badge);
  }

  /** Show a speech bubble. Important messages (with buttons) aren't replaced by chatter. */
  say = (text: string, opts: SayOpts = {}) => {
    if (this.quiet && !opts.buttons) return;
    if (this.sticky && !opts.buttons) {
      if (this.queue.length < 3) this.queue.push({ text, opts });
      return;
    }
    clearTimeout(this.hideTimer);
    this.currentKey = opts.key ?? "";
    this.bubble.classList.toggle("thought", !!opts.thought);
    if (opts.html) this.bubbleText.innerHTML = text; else this.bubbleText.innerHTML = iconize(text);
    this.bubbleBtns.innerHTML = "";
    this.sticky = !!opts.buttons?.length;
    for (const btn of opts.buttons ?? []) {
      const e = document.createElement("button");
      e.innerHTML = iconize(btn.label);
      if (btn.primary) e.className = "primary";
      e.onclick = (ev) => { ev.stopPropagation(); this.hideBubble(); btn.fn(); };
      this.bubbleBtns.appendChild(e);
    }
    this.bubble.classList.remove("show");
    void this.bubble.offsetWidth; // restart pop animation
    this.bubble.classList.add("show");
    this.bh = this.bubble.offsetHeight;
    if (!opts.thought) this.b.talk?.(text);
    this.pos = { x: -1, y: -1 };
    this.place();
    const ms = opts.ms ?? (opts.buttons ? 0 : Math.min(7000, 1800 + text.length * 55));
    if (ms > 0) this.hideTimer = window.setTimeout(() => this.hideBubble(), ms);
  };

  hideBubble() {
    clearTimeout(this.hideTimer);
    this.b.talkUntil = 0;
    this.bubble.classList.remove("show");
    this.sticky = false;
    const next = this.queue.shift();
    if (next) setTimeout(() => this.say(next.text, next.opts), 350);
  }

  get bubbleVisible() { return this.bubble.classList.contains("show"); }

  /** Keep bubble/ring anchored above the head. Called each frame; touches DOM only on change. */
  place() {
    const p = this.b.pose;
    const headTop = HIP_Y + p.y + NECK + FACE - 128;
    const x = Math.round(Math.min(W - 12, Math.max(12, CX + p.x)));
    const y = Math.round(Math.max(4 + (this.bubbleVisible ? this.bh + 4 : 0), headTop));
    if (x === this.pos.x && y === this.pos.y) return;
    this.pos = { x, y };
    this.bubble.style.setProperty("--x", `${x}px`);
    this.bubble.style.setProperty("--y", `${y}px`);
    this.ring.style.transform = `translate(${x + 56}px, ${y + 34}px)`;
  }

  setRing(on: boolean, frac = 0, label = "", kind: "work" | "break" = "work") {
    this.ring.classList.toggle("show", on);
    if (!on) return;
    this.ring.classList.toggle("break", kind === "break");
    const c = 2 * Math.PI * 18;
    this.ringArc.style.strokeDasharray = `${c}`;
    this.ringArc.style.strokeDashoffset = `${c * (1 - frac)}`;
    this.ringText.textContent = label;
  }

  setBadge(state: "off" | "on" | "active") {
    this.badge.className = `badge ${state}`;
  }

  // ------------------------------------------------------------------ right-click menu

  private build: (() => MenuModel) | null = null;
  private anchor = { x: CX, y: 200 };
  private menuTick = 0;
  private menuOpenedAt = 0;
  private menuEntered = false;
  private menuLeftAt = 0;
  private cursorRig = { x: -1e9, y: -1e9 };

  /** Open the menu at `at` (rig px, usually the click point). `build` is re-run by refreshMenu(). */
  openMenu(build: () => MenuModel, at?: { x: number; y: number }) {
    this.build = build;
    const p = this.b.pose;
    this.anchor = at ?? { x: CX + p.x, y: HIP_Y + p.y + NECK + FACE };
    if (!this.sticky) this.hideBubble();
    this.render();
    this.menu.classList.remove("show");
    void this.menu.offsetWidth; // restart pop animation
    this.menu.classList.add("show");
    this.menuOpen = true;
    this.menuOpenedAt = performance.now();
    this.menuEntered = false;
    this.menuLeftAt = 0;
    clearInterval(this.menuTick);
    this.menuTick = window.setInterval(() => this.checkMenuLeave(), 200);
  }

  /** Re-render in place (a toggle flipped, settings changed) without moving or re-animating. */
  refreshMenu() {
    if (this.menuOpen && this.build) this.render();
  }

  /** When the menu last closed — lets a second right-click close it instead of re-opening. */
  menuClosedAt = 0;

  closeMenu() {
    clearInterval(this.menuTick);
    if (this.menuOpen) this.menuClosedAt = performance.now();
    this.menu.classList.remove("show");
    this.menuOpen = false;
    this.build = null;
  }

  /** Cursor in screen physical px (from Rust); drives "close when you move away". */
  onCursor(sx: number, sy: number) {
    const w = this.b.world, o = w.windowOrigin(), s = w.scale;
    this.cursorRig = { x: (sx - o.x) / s, y: (sy - o.y) / s };
  }

  private checkMenuLeave() {
    if (!this.menuOpen) return;
    const m = this.menu, c = this.cursorRig, pad = 18;
    const inside = c.x >= m.offsetLeft - pad && c.x <= m.offsetLeft + m.offsetWidth + pad
      && c.y >= m.offsetTop - pad && c.y <= m.offsetTop + m.offsetHeight + pad;
    const now = performance.now();
    if (inside) { this.menuEntered = true; this.menuLeftAt = 0; return; }
    if (!this.menuEntered) { if (now - this.menuOpenedAt > 6000) this.closeMenu(); return; }
    if (!this.menuLeftAt) this.menuLeftAt = now;
    else if (now - this.menuLeftAt > 900) this.closeMenu();
  }

  /** Part of the window that's actually on screen and not under the taskbar (rig px). */
  private visibleArea() {
    const w = this.b.world, s = w.scale, o = w.windowOrigin();
    const k = w.monitorAt(w.fx).work;
    const bottom = Math.min(k.y + k.h, w.floorY());
    const v = {
      x0: Math.max(0, (k.x - o.x) / s) + 4, y0: Math.max(0, (k.y - o.y) / s) + 4,
      x1: Math.min(W, (k.x + k.w - o.x) / s) - 4, y1: Math.min(H, (bottom - o.y) / s) - 4,
    };
    // monitors not known yet / weird geometry: fall back to the whole window
    if (!(v.x1 - v.x0 > 120 && v.y1 - v.y0 > 120)) return { x0: 4, y0: 4, x1: W - 4, y1: H - 4 };
    return v;
  }

  private render() {
    const M = this.build!();
    const m = this.menu;
    m.innerHTML = "";
    m.setAttribute("role", "menu");
    const act = (it: MenuAct) => (ev: Event) => { ev.stopPropagation(); this.closeMenu(); it.fn(); };

    // header: who/what + icon buttons + close
    const head = div("mh", m);
    head.innerHTML = `<div class="mh-t"><b>${M.title}</b><span>${M.status}</span></div>`;
    for (const it of [...M.head, { label: "Close", icon: "x", fn: () => {} }]) {
      const e = btn("mh-b", head, `${icon(it.icon)}`);
      e.title = it.label; e.setAttribute("aria-label", it.label);
      e.onclick = act(it);
    }

    // big tiles: the things you open the menu for
    const tiles = div("mt", m);
    for (const it of M.tiles) {
      const e = btn(`mt-b${it.accent ? " accent" : ""}`, tiles, `${icon(it.icon)}<span>${it.label}</span>${it.hint ? `<small>${it.hint}</small>` : ""}`);
      e.onclick = act(it);
    }

    // everything else, compact
    const list = div("ml", m);
    for (const it of M.items) btn("ml-b", list, `${icon(it.icon)}<span>${it.label}</span>`).onclick = act(it);

    div("msep", m);

    // mode: pick directly instead of cycling blind
    const seg = div("mseg", m);
    seg.setAttribute("role", "radiogroup");
    for (const o of M.seg.options) {
      const on = o.value === M.seg.value;
      const e = btn(`mseg-b${on ? " on" : ""}`, seg, `${icon(o.icon)}<span>${o.label}</span>`);
      e.setAttribute("role", "radio"); e.setAttribute("aria-checked", String(on));
      e.onclick = (ev) => { ev.stopPropagation(); if (!on) M.seg.pick(o.value); };
    }

    // switches stay open so you see them flip
    for (const t of M.toggles) {
      const e = btn(`mrow${t.on ? " on" : ""}`, m, `${icon(t.icon)}<span class="mrow-l">${t.label}${t.hint ? `<small>${t.hint}</small>` : ""}</span><i class="sw"></i>`);
      e.setAttribute("role", "switch"); e.setAttribute("aria-checked", String(t.on));
      e.onclick = (ev) => { ev.stopPropagation(); t.fn(); };
    }

    this.placeMenu();
  }

  private placeMenu() {
    const m = this.menu, v = this.visibleArea();
    m.style.maxHeight = `${Math.round(v.y1 - v.y0)}px`;
    const mw = m.offsetWidth, mh = m.offsetHeight;
    const left = Math.min(v.x1 - mw, Math.max(v.x0, this.anchor.x - mw / 2));
    const top = Math.min(v.y1 - mh, Math.max(v.y0, this.anchor.y - 28));
    m.style.left = `${Math.round(left)}px`;
    m.style.top = `${Math.round(top)}px`;
    m.style.transformOrigin = `${Math.round(this.anchor.x - left)}px ${Math.round(this.anchor.y - top)}px`;
  }

  /** Extra interactive area to merge into the click-through hit box. */
  interactiveRect(): DOMRect | null {
    const rs: DOMRect[] = [];
    if (this.menuOpen) rs.push(this.menu.getBoundingClientRect());
    if (this.bubbleVisible && this.sticky) rs.push(this.bubble.getBoundingClientRect());
    if (!rs.length) return null;
    const scale = this.host.getBoundingClientRect().width / W || 1;
    const x0 = Math.min(...rs.map((r) => r.left)) / scale, y0 = Math.min(...rs.map((r) => r.top)) / scale;
    const x1 = Math.max(...rs.map((r) => r.right)) / scale, y1 = Math.max(...rs.map((r) => r.bottom)) / scale;
    return new DOMRect(x0, y0, x1 - x0, y1 - y0);
  }
}

export interface MenuAct { label: string; icon: string; fn: () => void; hint?: string; accent?: boolean; }
export interface MenuModel {
  title: string;
  status: string;
  head: MenuAct[];
  tiles: MenuAct[];
  items: MenuAct[];
  seg: { value: string; options: { value: string; label: string; icon: string }[]; pick: (v: string) => void };
  toggles: { label: string; icon: string; on: boolean; fn: () => void; hint?: string }[];
}

function btn(cls: string, parent: HTMLElement, html: string) {
  const b = document.createElement("button");
  b.className = cls;
  b.innerHTML = html;
  parent.appendChild(b);
  return b;
}

function div(cls: string, parent?: HTMLElement) {
  const d = document.createElement("div");
  d.className = cls;
  parent?.appendChild(d);
  return d;
}
