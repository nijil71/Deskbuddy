# Deskbud

A small desktop buddy for Windows, drawn in the same ink style as your avatar. It lives on your taskbar, keeps Teams green while you step away, reminds you to look after yourself, and has its own personality.

Built with **Tauri 2**. A Rust core handles the Windows APIs, and an SVG character is animated part by part in WebView2.

## Run

```powershell
npm install
npm run tauri dev      # development
npm run tauri build    # release build + installers in src-tauri/target/release/bundle/
```

## What it does

| Area | Feature | Animation |
|---|---|---|
| **Teams keep-alive** | After about 3.5 min idle (work hours only, Mon–Fri 9–18 by default), it moves the mouse 1 px and back and taps the invisible **F15** key. That resets the Windows idle timer Teams uses to decide "Away". It pauses while your mic is in use (you're in a call) and when the PC is locked. | Notices, runs to the cursor, shoves it, dusts off its hands: "Still green ✓" |
| **Presence** | Sleeps once you've been away 5 min. Greets you when you come back. | Zzz, glasses slide down, wakes with a stretch, waves or celebrates |
| **Calls** | Detects calls through microphone use. | "Shh…", then sits quietly |
| **Fullscreen** | Hides during fullscreen video, games and presentations. | Ducks down, pops back up |
| **Focus timer** | Pomodoro with configurable rounds; reminders wait until the break. | Laptop and headphones, typing, ring timer above its head |
| **Reminders** | Water, stretch, eyes (20-20-20) and posture. Each has its own interval, with Done/Snooze, and they only show while you're at the desk. | Drinks from a bottle, demonstrates stretches, binoculars with a countdown, slouch-then-sit-tall |
| **Meetings** | Quick-add "14:30 Standup". Warns you at T-5 and T-1 and offers to open Teams. | Holds up a sign |
| **System** | CPU > 88%, RAM > 92%, battery ≤ 20%, charger plugged in. | Fans itself and sweats, carries a heavy RAM box, droops holding a plug, happy bounce |
| **Clipboard** | Keeps your last 30 text copies, in memory only. Search, re-copy, delete. | Catches a flying paper |
| **Launcher** | **Ctrl+Alt+Space** anywhere opens fuzzy search over pinned apps, folders, URLs and `shell:`/`ms-settings:` targets, plus web search. | — |
| **Notes** | Colored sticky notes that save automatically. | Holds the note up |
| **Screenshot** | Opens the Windows snipping overlay. | Camera pose and flash |
| **Weather** | Open-Meteo (no key). Set your city in Settings. | Umbrella and rain, snowflakes, sunglasses |
| **Life** | Walks the taskbar, jumps onto the top edge of the focused window and rides along or falls off when it moves or closes, peeks from screen edges. Hobbies: reading, juggling, music, doodling, yo-yo, magic, coffee, thinking. Time of day: morning coffee, lunch sign, evening yawn, late-night nightcap. | — |
| **You** | Drag it, with dangling legs and swinging hair. Throw it: it follows a physics arc, bounces, and gets dizzy on hard landings. Click it to poke, double-click to wave, rub its head to pet it (blush and hearts), right-click for a menu. | — |

Every animation is built on always-on layers: breathing, random (double) blinks, eyes and a slight 3/4 head turn that follow your cursor, spring-driven hair tufts and ears, and a glint on the glasses. The outline "boils" a little so it looks hand-drawn.

**Tray menu:** keep-alive toggle, focus, reminders, notes, clipboard, launcher, hide/show, do-not-disturb, settings, and the **Animation lab**, which plays any animation on demand.

## Staying light

- The frame rate adapts: 60 fps for movement, 40 for effects, 24 idle, 10 while asleep, and 0 when hidden or locked.
- Only `transform`/`d` attributes change each frame. There are no SVG filters and no images.
- Background work in Rust is cheap polling: idle every 5 s, cursor at 25 Hz (2 Hz when hidden), system stats every 5 s, clipboard sequence number every 0.7 s.
- The window is click-through everywhere except the character, and the buddy never steals keyboard focus.
- The panel window is created on demand and destroyed when closed.
- Release builds use LTO, `opt-level="s"`, and strip symbols.

## Layout

```
src-tauri/src/win.rs   Win32: idle, SendInput, lock, fullscreen, mic-in-use, monitors, windows, CPU/RAM/battery, clipboard, shell
src-tauri/src/lib.rs   state, workers (presence/keep-alive, cursor+click-through, sysmon, clipboard), tray, panel, hotkey
src/buddy/rig.ts       the SVG puppet (head, hair tufts, glasses, eyes, mouths, rubber-hose limbs, props)
src/buddy/buddy.ts     frame loop, action blending, alive layers
src/buddy/world.ts     desktop physics: taskbar floor, window tops, gravity, window movement
src/buddy/brain.ts     needs-based idle picker + reactions + reminders/meetings/time-of-day
src/buddy/anims/*.ts   all animations
src/panel/             the panel window
```

## Notes

- Keep-alive uses only real input events (1 px mouse move and back, F15 key). It doesn't touch Teams itself, so it works with any presence system based on idle time.
- Settings are stored at `%APPDATA%\com.deskbud.app\deskbud.json`.
