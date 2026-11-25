// Hacker News via the official public API (no key, no account). Cached for 10 minutes.
export type Feed = "top" | "best" | "show" | "ask" | "new";
export interface Story {
  id: number; title: string; url: string; score: number; comments: number;
  by: string; time: number; domain: string;
}
export interface NewsCfg { on: boolean; feed: Feed; minScore: number; keywords: string[]; }

const API = "https://hacker-news.firebaseio.com/v0";
export const hnThread = (id: number) => `https://news.ycombinator.com/item?id=${id}`;
const cache: Partial<Record<Feed, { at: number; items: Story[] }>> = {};

export async function fetchNews(feed: Feed = "top", n = 30, fresh = false): Promise<Story[]> {
  const c = cache[feed];
  if (!fresh && c && Date.now() - c.at < 10 * 60_000) return c.items;
  const ids: number[] = await (await fetch(`${API}/${feed}stories.json`)).json();
  const raw = await Promise.all(ids.slice(0, n).map((id) =>
    fetch(`${API}/item/${id}.json`).then((r) => r.json()).catch(() => null)));
  const items = raw
    .filter((x) => x && !x.dead && !x.deleted && x.title)
    .map((x): Story => {
      let domain = "";
      try { domain = x.url ? new URL(x.url).hostname.replace(/^www\./, "") : ""; } catch { /* bad url */ }
      return {
        id: x.id, title: x.title, url: x.url || hnThread(x.id), score: x.score ?? 0,
        comments: x.descendants ?? 0, by: x.by ?? "", time: x.time ?? 0, domain,
      };
    });
  cache[feed] = { at: Date.now(), items };
  return items;
}

/** Does the title match one of your interests? Whole-word-ish, case-insensitive. */
export function matches(title: string, keywords: string[]) {
  const t = ` ${title.toLowerCase()} `;
  return keywords.find((k) => {
    const w = k.trim().toLowerCase();
    return w && new RegExp(`[^a-z0-9]${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z0-9]`).test(t);
  });
}

/** Story worth interrupting for: a big one, or one about your interests that's taking off. */
export function pickStory(items: Story[], seen: Record<string, number>, cfg: NewsCfg): Story | null {
  const fresh = items.filter((s) => !seen[s.id] && Date.now() / 1000 - s.time < 24 * 3600);
  return fresh.find((s) => matches(s.title, cfg.keywords) && s.score >= Math.min(60, cfg.minScore))
    ?? fresh.find((s) => s.score >= cfg.minScore) ?? null;
}

/** Something to share when nothing's huge: a random decent story you haven't seen yet. */
export function randomStory(items: Story[], seen: Record<string, number>, rnd = Math.random): Story | null {
  const ok = items.filter((s) => !seen[s.id] && s.score >= 80 && Date.now() / 1000 - s.time < 48 * 3600);
  return ok.length ? ok[Math.floor(rnd() * ok.length)] : null;
}

export function ago(time: number) {
  const m = Math.max(1, Math.round((Date.now() / 1000 - time) / 60));
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
