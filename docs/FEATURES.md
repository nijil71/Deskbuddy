# Everything Deskbud can do

This is the full list. For a quick overview, see the [README](../README.md).

Most features can be turned on or off in **Settings** (right-click the buddy → **Settings**, or use the tray icon).

| Area | Feature | Animation |
|---|---|---|
| **Teams keep-alive** | After about 3.5 min idle (work hours only, Mon–Fri 09:00–18:00 by default; change it in Settings), it moves the mouse 1 px and back and taps the invisible **F15** key. That resets the Windows idle timer Teams uses to decide "Away". It pauses while your mic is in use (you're in a call) and when the PC is locked. | Notices, runs to the cursor, shoves it, dusts off its hands: "Still green ✓" |
| **Presence** | Sleeps once you've been away 5 min. Greets you when you come back. | Zzz, glasses slide down, wakes with a stretch, waves or celebrates |
| **Calls** | Detects calls through microphone use. | "Shh…", then sits quietly |
| **Fullscreen** | Hides during fullscreen video, games and presentations. | Ducks down, pops back up |
| **Focus timer** | Pomodoro with configurable rounds; reminders wait until the break. | Laptop and headphones, typing, ring timer above its head |
| **Reminders** | Water, stretch, eyes (20-20-20) and posture. Each has its own interval, with Done/Snooze, and they only show while you're at the desk. | Drinks from a bottle, demonstrates stretches, binoculars with a countdown, slouch-then-sit-tall |
| **Meetings** | Quick-add "14:30 Standup". Warns you at T-5 and T-1 and offers to open Teams. | Holds up a sign |
| **System** | CPU > 88%, RAM > 92%, battery ≤ 20%, charger plugged in. | Fans itself and sweats, carries a heavy RAM box, droops holding a plug, happy bounce |
| **Clipboard** | Keeps your last 30 text copies, in memory only. Search, re-copy, delete. | Catches a flying paper |
| **Launcher** | **Ctrl+Alt+Space** anywhere opens fuzzy search over pinned apps, folders, URLs and `shell:`/`ms-settings:` targets, plus web search. | — |
| **Convert files** | Drop a file on the buddy and press **Convert…**. It saves a copy next to the original and never overwrites. Images (jpg, png, webp, bmp, gif, tiff, ico) are converted built-in. Audio and video (mp4, mkv, webm, mov, avi, gif, mp3, wav, flac, m4a, ogg, opus) use [FFmpeg](https://ffmpeg.org) if installed. Documents use pandoc or LibreOffice (docx/xlsx/pptx → pdf, etc.) if installed. If the needed tool is missing, it offers the `winget` install command. Dropping several files of one type converts them all. | Waves a magic wand, then confetti |
| **Claude Code** | Settings → Claude Code adds three hooks to `~/.claude/settings.json` (a backup is kept). When Claude finishes a task that took more than about 25 s, or needs your permission, the buddy tells you. It stays quiet if you're already in your terminal or editor. Only the project name and Claude's message are passed along, never your prompts. | Confetti when it's done, holds up a "Claude!" sign when you're needed |
| **Copy text (OCR)** | Right-click → **Copy text** opens the snipping overlay. Snip anything and its text goes to your clipboard. The screenshot file the Snipping Tool auto-saves for that snip is deleted, since you only wanted the text. Dropped images get a **Copy text** button too. It uses the OCR engine built into Windows, so it works offline with nothing to install. | Reads the paper |
| **Video downloads** | Copy (or drop) a YouTube, Vimeo, X, Instagram, TikTok, Reddit (and more) link and the buddy offers **Video** (MP4) or **MP3**. Pressing **Not now** twice stops the offer, and right-click → **Download copied link** still works. It saves to Downloads with live progress. Uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) if installed (`winget install yt-dlp.yt-dlp`). | Magic wand, then confetti |
| **Two screens** | With more than one monitor, the buddy walks across to the other screen, hopping up or dropping down when the floors are at different heights. If the screens aren't side by side, he ducks out of one and pops up on the other. He follows you when you've worked on the other screen for about 90 s (at most every 10 min, not in Quiet mode or during focus), sometimes wanders over on his own in Chill mode, and goes on request from right-click → **Go to other screen**. | Walks over, jumps up or drops down at the edge, looks around |
| **Memory** | Long-term: notes, mood, days together, activity and settings live in `deskbud.json`, which is backed up daily (the last 7 days are kept in `backups\`) and restored automatically if it's ever missing or corrupt. Short-term: what you're doing right now, a running focus timer and today's work tracking are saved every 30 s and before quitting or updating, then restored if you restart within 30 minutes. | — |
| **Notes** | Colored sticky notes that save automatically. | Holds the note up |
| **Screenshot** | Opens the Windows snipping overlay. | Camera pose and flash |
| **Weather** | Open-Meteo (no key). Set your city in Settings. | Umbrella and rain, snowflakes, sunglasses |
| **Life** | Walks the taskbar, jumps onto the top edge of the focused window and rides along or falls off when it moves or closes, peeks from screen edges. Hobbies: reading, juggling, music, doodling, yo-yo, magic, coffee, thinking. Time of day: morning coffee, lunch sign, evening yawn, late-night nightcap. | — |
| **You** | Drag it, with dangling legs and swinging hair. Throw it: it follows a physics arc, bounces, and gets dizzy on hard landings. Click it to poke, double-click to wave, rub its head to pet it (blush and hearts), right-click for a menu. | — |

Every animation is built on always-on layers: breathing, random (double) blinks, eyes and a slight 3/4 head turn that follow your cursor, spring-driven hair tufts and ears, and a glint on the glasses. The outline "boils" a little so it looks hand-drawn.

**Tray menu:** keep-alive toggle, focus, reminders, notes, clipboard, launcher, hide/show, do-not-disturb, settings, and the **Animation lab**, which plays any animation on demand.

## Always-on details

Every animation is built on layers that are always running: breathing, random (sometimes double) blinks, eyes and a slight 3/4 head turn that follow your cursor, spring-driven hair tufts and ears, and a glint on the glasses. The outline "boils" a little so it looks hand-drawn.

## Tray menu

Keep-alive toggle, focus, reminders, notes, clipboard, launcher, hide/show, do not disturb, settings, check for updates, and the **Animation lab**, which plays any animation on demand.

## Staying light on your PC

- The frame rate adapts: 60 fps for movement, 40 for effects, 24 idle, 10 while asleep, and 0 when hidden or locked.
- Only `transform`/`d` attributes change each frame. There are no SVG filters and no images.
- Background work in Rust is cheap polling: idle every 5 s, cursor at 25 Hz (2 Hz when hidden), system stats every 5 s, clipboard sequence number every 0.7 s.
- The window is click-through everywhere except the character, and the buddy never steals keyboard focus.
- The panel window is created on demand and destroyed when closed.
- Release builds use LTO, `opt-level="s"`, and strip symbols.
