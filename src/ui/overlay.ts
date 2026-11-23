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
    this.pos = { x: -1, y: -1 };
    this.place();
    const ms = opts.ms ?? (opts.buttons ? 0 : Math.min(7000, 1800 + text.length * 55));
    if (ms > 0) this.hideTimer = window.setTimeout(() => this.hideBubble(), ms);
  };

  hideBubble() {
    clearTimeout(this.hideTimer);
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
    const y = Math.round(Math.max(4, headTop));
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

  openMenu(items: { label: string; icon: string; fn: () => void; sep?: boolean }[]) {
    this.menu.innerHTML = "";
    for (const it of items) {
      if (it.sep) { div("menu-sep", this.menu); continue; }
      const e = document.createElement("button");
      e.innerHTML = `<span class="mi${it.icon === "dot" ? " on" : ""}">${icon(it.icon)}</span>${it.label}`;
      e.onclick = (ev) => { ev.stopPropagation(); this.closeMenu(); it.fn(); };
      this.menu.appendChild(e);
    }
    // Measure, then clamp fully inside the buddy window (anything outside it can't be clicked).
    this.menu.style.left = "0px";
    this.menu.style.top = "0px";
    const mw = this.menu.offsetWidth, mh = this.menu.offsetHeight;
    const p = this.b.pose;
    const left = Math.min(W - mw - 4, Math.max(4, CX + p.x - mw / 2));
    const top = Math.min(H - mh - 4, Math.max(4, HIP_Y + p.y + NECK + FACE - 60));
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
    this.menu.classList.add("show");
    this.menuOpen = true;
  }

  closeMenu() {
    this.menu.classList.remove("show");
    this.menuOpen = false;
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

function div(cls: string, parent?: HTMLElement) {
  const d = document.createElement("div");
  d.className = cls;
  parent?.appendChild(d);
  return d;
}
