/** A link to a single video/track that yt-dlp can download (not a channel or home page). */
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|reddit\.com|v\.redd\.it|twitch\.tv|facebook\.com|fb\.watch|dailymotion\.com|soundcloud\.com|bilibili\.com|streamable\.com|bandcamp\.com|loom\.com|ted\.com)$/i;
export function isVideoLink(url: string) {
  try {
    const u = new URL(url);
    if (!VIDEO_HOSTS.test(u.hostname)) return false;
    // A channel/home page isn't one video; posts on social sites usually are.
    if (/youtube\.com$/i.test(u.hostname)) return u.pathname === "/watch" || /^\/(shorts|live)\//.test(u.pathname);
    return u.pathname.length > 1;
  } catch { return false; }
}
