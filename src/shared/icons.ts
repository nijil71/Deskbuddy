// One consistent line-icon set (24×24, round strokes, currentColor) used everywhere
// instead of emojis, so the UI matches the buddy's ink style on every Windows build.
const P: Record<string, string> = {
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  skip: '<path d="M5 5l10 7-10 7zM19 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  coffee: '<path d="M4 9h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 2.5v3M12 2.5v3"/>',
  cloud: '<path d="M7 19h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 10.5 4.3 4.3 0 0 0 7 19z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3"/>',
  storm: '<path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z"/><path d="M13 13l-3 4h4l-3 4"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M9 12h6M9 16h4"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M9 11h6M9 15h4"/>',
  rocket: '<path d="M12 15l-3-3c1.5-5 4.5-8 10-9-1 5.5-4 8.5-7 12z"/><path d="M9 12l-4 .5 3-4h3M12 15l-.5 4 4-3v-3M5.5 16.5C4 18 4 20 4 20s2 0 3.5-1.5"/><circle cx="15" cy="9" r="1.2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  ring: '<circle cx="12" cy="12" r="5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  sparkles: '<path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.5"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 5 10 7-.5 1-1.6 2.6-3.1 4M6.6 6.6C4.4 8 2.8 10.4 2 12c1 2 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  eye: '<path d="M2 12c1-2 5-7 10-7s9 5 10 7c-1 2-5 7-10 7S3 14 2 12z"/><circle cx="12" cy="12" r="3"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M5 3L2 6M19 3l3 3"/>',
  droplet: '<path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z"/>',
  stretch: '<circle cx="12" cy="4" r="2"/><path d="M5 7l7 2 7-2M12 9v6l-3 6M12 15l3 6"/>',
  chair: '<path d="M7 3v9h10V3M5 12h14M7 12v9M17 12v9M7 17h10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7c-2.5 0-4-1-5.5-3L3 15a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  enter: '<path d="M20 5v7a3 3 0 0 1-3 3H5M9 11l-4 4 4 4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  cake: '<path d="M4 21V13a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8M2 21h20M4 16c2 1.5 3 1.5 4 0s2-1.5 4 0 3 1.5 4 0 2-1.5 4 0M12 11V7M12 4.5v.01"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.5-4-8-9-8z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7.5" r="1" fill="currentColor"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M9 21l2.5-6.5L14 17v4M11.5 14.5l1-5.5-3.5 2v3M12.5 9l3 3 2.5.5"/>',
  throw: '<path d="M5 19C7 9 13 5 19 5M14 4l5 1-1 5"/>',
  mountain: '<path d="M2 20l7-12 4 6 3-4 6 10z"/><path d="M7.5 10.5l1.5 1.5 1.5-1.5"/>',
  turn: '<path d="M4 9a8 8 0 1 1 1.5 7.5M4 4v5h5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  party: '<path d="M3 21l5-14 9 9z"/><path d="M14 4l1 2M19 3l-1 3M20 9l-2 .5M13 8c1-1 3-1 4 0M16 12c1-1 3-1 4 0"/>',
  heart: '<path d="M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11z"/>',
  pointer: '<path d="M3 12h11M10 8l4 4-4 4M17 6v12"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
  juggle: '<circle cx="6" cy="16" r="2.5"/><circle cx="12" cy="6" r="2.5"/><circle cx="18" cy="16" r="2.5"/><path d="M8 13.5l2-5M14 8.5l2 5" stroke-dasharray="1.5 2"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  pencil: '<path d="M16 3l5 5L8 21H3v-5z"/><path d="M13 6l5 5"/>',
  yoyo: '<circle cx="12" cy="16" r="5"/><circle cx="12" cy="16" r="1.5"/><path d="M12 11V2"/>',
  wand: '<path d="M4 20L15 9M13 7l4 4"/><path d="M18 3v3M16.5 4.5h3M20 9v2M19 10h2M10 3v2M9 4h2"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-15-1 10-6 15-15 15z"/><path d="M5 19l8-8"/>',
  glasses: '<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M10 14c1-1 3-1 4 0M3 14l1-7M21 14l-1-7"/>',
  sign: '<rect x="3" y="4" width="18" height="10" rx="1.5"/><path d="M12 14v7M8 8h8M9 11h6"/>',
  thermo: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
  box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  batteryLow: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 10v4"/>',
  charging: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M11 9l-2 3h3l-2 3"/>',
  paper: '<path d="M3 11l18-8-5 18-4-7z"/><path d="M12 14l9-11"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  thumbsUp: '<path d="M7 11v10H3V11zM7 11l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.6 21H7"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  sunset: '<path d="M17 18a5 5 0 0 0-10 0M12 3v6M8 6l4 3 4-3M2 18h2M20 18h2M4.9 11.9l1.4 1.4M17.7 13.3l1.4-1.4M2 22h20"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  muscle: '<path d="M4 15c2-6 4-9 6-10l2 2-2 3c3-1 6 0 8 2s2 6-1 7-11 1-13-4z"/>',
  faceHappy: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1.5 2.5 6.5 2.5 8 0M9 9.5v.5M15 9.5v.5"/>',
  faceSmile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.5 1.5 5.5 1.5 7 0M9 10v.5M15 10v.5"/>',
  faceCalm: '<circle cx="12" cy="12" r="9"/><path d="M9 15h6M7.5 10c.8-.7 2.2-.7 3 0M13.5 10c.8-.7 2.2-.7 3 0"/>',
  faceMeh: '<circle cx="12" cy="12" r="9"/><path d="M9 15.5h6M9 10v.5M15 10v.5"/>',
  faceSad: '<circle cx="12" cy="12" r="9"/><path d="M8.5 16c1.5-2 5.5-2 7 0M9 10v.5M15 10v.5"/>',
  faceSleep: '<circle cx="12" cy="12" r="9"/><path d="M8 10.5h2.5M13.5 10.5H16M10.5 15.5h3"/>',
  zzz: '<path d="M4 9h5l-5 6h5M13 5h4l-4 5h4M17 14h3l-3 4h3"/>',
  cat: '<path d="M5 20V8l3 3h8l3-3v12z"/><path d="M9 15v.5M15 15v.5M11 17.5h2"/>',
  minimize: '<path d="M5 12h14"/>',
  comic: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 11h18M12 3v8M9 11l-2 10"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  news: '<path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v10a2 2 0 0 1-4 0M7 9h7M7 13h7M7 17h4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
};

/** Inline SVG for an icon name (unknown → empty). */
export function icon(name: string, cls = "i") {
  const d = P[name];
  return d ? `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>` : "";
}

// Emoji that might appear in speech → closest icon. Anything else gets dropped.
const EMOJI: Record<string, string> = {
  "👋": "hand", "🎉": "party", "🤐": "mute", "🤫": "mute", "⛅": "cloud", "🟢": "dot", "☕": "coffee", "🙆": "stretch",
  "🎧": "headphones", "📝": "note", "📋": "clipboard", "👀": "eye", "🥺": "faceSad", "💧": "droplet", "😕": "faceMeh",
  "📸": "camera", "💼": "briefcase", "🎈": "sparkles", "🚶": "walk", "⏰": "clock", "😄": "faceHappy", "🪑": "chair",
  "⚡": "zap", "🌇": "sunset", "🌙": "moon", "🤔": "bulb", "📅": "calendar", "🎂": "cake", "🍜": "coffee", "✓": "check",
  "🥵": "thermo", "📦": "box", "🌧": "rain", "❄": "snow", "☀": "sun", "⛈": "storm", "💪": "muscle", "😤": "faceMeh",
  "😅": "faceSmile", "🔁": "repeat", "🎵": "music", "🎬": "film", "👍": "thumbsUp", "🐱": "cat", "✨": "sparkles",
  "🔌": "plug", "✏": "pencil", "😴": "faceSleep", "💤": "zzz", "🙂": "faceSmile", "📰": "news", "🔥": "zap",
};
const EMOJI_RE = /\s?(\p{Extended_Pictographic}|✓)️?(‍\p{Extended_Pictographic}️?)*/gu;

/** Escape plain text and turn any emoji into matching inline icons. */
export function iconize(text: string) {
  const esc = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return esc.replace(EMOJI_RE, (m) => {
    const ch = m.trim().replace(/️/g, "");
    const name = EMOJI[ch] ?? EMOJI[[...ch][0]];
    return name ? (m.startsWith(" ") ? " " : "") + icon(name, `i ie ie-${name}`) : "";
  }).trim();
}
