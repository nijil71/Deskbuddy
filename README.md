<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="128" alt="Deskbud logo: an ink-drawn character with round glasses">

# Deskbud

**A hand-drawn little buddy who lives on your Windows taskbar.**

He keeps you showing as Available while you grab a coffee, reminds you to drink water and rest your eyes,<br>
runs your focus timer, converts files you drop on him, and has a personality of his own.

[![Latest release](https://img.shields.io/github/v/release/nijil71/Deskbuddy?label=download&color=2ea44f)](https://github.com/nijil71/Deskbuddy/releases/latest)
[![CI](https://github.com/nijil71/Deskbuddy/actions/workflows/ci.yml/badge.svg)](https://github.com/nijil71/Deskbuddy/actions/workflows/ci.yml)
[![Platform: Windows 10/11](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[**Download**](https://github.com/nijil71/Deskbuddy/releases/latest) · [Features](#what-he-does) · [Privacy](#privacy) · [FAQ](#faq) · [Contributing](CONTRIBUTING.md)

</div>

<!-- A short GIF of the buddy walking, waving and reacting goes here, e.g.:
<p align="center"><img src="docs/demo.gif" width="600" alt="Deskbud walking along the taskbar and waving"></p>
-->

---

## Install

1. **Download** `Deskbud_x.y.z_x64-setup.exe` from the [latest release](https://github.com/nijil71/Deskbuddy/releases/latest).
2. **Run it.** No admin rights needed. If Windows says *"Windows protected your PC"*, click **More info → Run anyway** ([why?](#windows-protected-your-pc)).
3. **Say hi.** Your buddy drops onto the taskbar and waves. Right-click him for everything else.

That's it. He starts with Windows from now on (you can turn that off in Settings).

**Requirements:** Windows 10 or 11, 64-bit. Nothing else. The installer adds Microsoft WebView2 if your PC is missing it.

**Updating:** when a new version is out, your buddy holds up a sign. Click **Download**, run the new installer, and you're done. Your settings and notes are kept.

## Getting started

| To… | Do this |
|---|---|
| Open the menu | **Right-click** the buddy |
| Change settings, notes, reminders | Right-click → **Settings**, or click the tray icon |
| Pet him | Rub the cursor back and forth over his head |
| Move him | Drag him. Throw him if you like, he bounces |
| Search apps, folders, the web | Press **Ctrl + Alt + Space** anywhere |
| Convert a file | Drop it on him and press **Convert…** |
| Copy text from the screen | Right-click → **Copy text**, then select an area |
| Make him quiet | Right-click → **Shh for an hour**, or set Mode to **Quiet** in Settings |

## What he does

**Work helpers**

- 🟢 **Stays Available.** When you've been idle for about 3.5 minutes during work hours, he nudges the mouse by 1 pixel and back so Teams (and similar apps) don't mark you Away. He stops during calls and when your PC is locked.
- ⏱️ **Focus timer.** Pomodoro rounds with breaks. Reminders wait until the break.
- 💧 **Self-care reminders.** Water, stretching, 20-20-20 eye breaks and posture, each on its own schedule and only while you're at the desk.
- 📅 **Meeting nudges.** Quick-add "14:30 Standup" and he warns you 5 minutes and 1 minute before.
- 🔁 **Convert files.** Images, audio, video and documents. The original is never overwritten.
- 📋 **Copy text from anything.** Select an area of the screen and its text goes to your clipboard. Works offline.
- 🎬 **Save videos.** Copy a YouTube, Vimeo, X, Instagram, TikTok or Reddit link and he offers to save the video or an MP3.
- 📝 **Sticky notes, clipboard history and a quick launcher.**
- 🤖 **Claude Code alerts.** Optional: he tells you when a long [Claude Code](https://claude.com/claude-code) task finishes or needs your permission.

**Companion**

- 🚶 Walks along the taskbar, climbs on top of your windows and rides along when you move them, and walks over to your other monitor.
- 😴 Sleeps when you're away, greets you when you're back, ducks out of the way during fullscreen video and presentations.
- 🌦️ Reacts to the weather, your CPU and battery, the time of day, and your birthday.
- 🎨 Hobbies, moods and outfits. Blinks, breathes and watches your cursor.
- 🪶 Light on your PC: he slows to 24 frames per second when idle, 10 while asleep, and stops completely when hidden.

👉 **[See every feature in detail](docs/FEATURES.md)**

### Optional extras

Some features use free tools you can install with one command. The buddy tells you when one is needed and shows the command.

| For | Install |
|---|---|
| Audio and video conversion | `winget install Gyan.FFmpeg` |
| Document conversion (docx, xlsx, pptx → pdf…) | `winget install TheDocumentFoundation.LibreOffice` or `winget install JohnMacFarlane.Pandoc` |
| Video downloads | `winget install yt-dlp.yt-dlp` |

## Privacy

Deskbud has no account, no analytics and no tracking. Everything stays on your PC except the few requests below, and none of them include anything about you.

| What | When | Sent to | Turn it off |
|---|---|---|---|
| Weather | Only after you set a city | [Open-Meteo](https://open-meteo.com) (the city name or coordinates) | Leave the city empty |
| Hacker News stories | Every 20–40 minutes | [Hacker News API](https://github.com/HackerNews/API) | Panel → **News** tab |
| Update check | About twice a day | GitHub (asks for the latest release) | Settings → App → Check for updates |
| Video downloads | Only when you click Video or MP3 | The video site, through yt-dlp | Don't click it 🙂 |

**Stored only on your PC**, in `%APPDATA%\com.deskbud.app\`: settings, notes, meetings, mood, and the optional activity diary (app and site names plus time spent, never window contents). Backups of the last 7 days sit next to it in `backups\`.

**Never stored:** clipboard history lives in memory and is gone when Deskbud quits. "Type along" counts keystrokes but never records which keys.

## FAQ

### "Windows protected your PC"

Windows shows this for apps that aren't signed with a paid code-signing certificate, and Deskbud isn't signed yet. Click **More info → Run anyway**. If you'd rather check first, every release is built in the open by [GitHub Actions](https://github.com/nijil71/Deskbuddy/actions/workflows/release.yml) from this source code, and each release lists SHA-256 checksums of its files.

### Is the keep-alive feature allowed at my workplace?

It only simulates a 1-pixel mouse move and a press of the unused F15 key; it doesn't touch Teams. Whether it's appropriate is up to you and your workplace's policies. You can turn it off, or limit it to your work hours, in Settings → **Keep Teams green**.

### How do I change my work hours?

Settings → **My work hours**. The default is Monday–Friday, 09:00–18:00. Your buddy's whole day follows these: morning coffee, meal break, wrap-up time, and when keep-alive is active. Night shifts that cross midnight work too.

### He's too chatty / I'm in a meeting

Right-click → **Shh for an hour** silences him. For good, set **Mode** to **Work** (calm) or **Quiet** (no bubbles or reminders at all) in Settings. He also goes quiet by himself when your microphone is in use.

### How do I uninstall?

1. If you turned on Claude Code alerts, turn them off first in Settings so the hooks are removed from `~/.claude/settings.json`.
2. Windows Settings → **Apps** → **Deskbud** → **Uninstall**.
3. To also delete your notes and settings, delete the folder `%APPDATA%\com.deskbud.app`.

### Does it work on macOS or Linux?

Not yet. Deskbud relies on Windows features (taskbar position, idle time, built-in OCR). Contributions to port it are welcome.

### Something's wrong

Please [open a bug report](https://github.com/nijil71/Deskbuddy/issues/new?template=bug_report.yml). Your version number is shown in the tray menu, next to "Check for updates".

## Build from source

You need Windows 10/11, [Node.js](https://nodejs.org) 22.6+, [Rust](https://rustup.rs) and the Visual Studio C++ build tools. [CONTRIBUTING.md](CONTRIBUTING.md#set-up-your-computer) has one-line install commands for each.

```powershell
git clone https://github.com/nijil71/Deskbuddy.git
cd Deskbuddy
npm install
npm run tauri dev      # run with live reload
npm run tauri build    # make an installer in src-tauri/target/release/bundle/
```

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).
*Status: application in progress. Current releases are not signed yet.*

- **Committers and reviewers:** [@nijil71](https://github.com/nijil71). Changes from other contributors are merged only after review.
- **Approvers:** [@nijil71](https://github.com/nijil71). Every signed release is approved by hand.
- Only installers built from this repository by the [Release workflow](.github/workflows/release.yml) are signed. Third-party tools Deskbud can use (FFmpeg, yt-dlp, pandoc, LibreOffice) are not included or signed by this project.
- **Privacy:** see the [Privacy](#privacy) section. Deskbud sends no personal data anywhere. Its only network requests are listed there, and each one can be turned off.
- **System changes:** Deskbud starts with Windows (turn off in Settings), simulates a 1-pixel mouse move and an F15 key press only when keep-alive is on, and changes `~/.claude/settings.json` only when you turn on Claude Code alerts. It can be removed from Windows Settings → Apps.

## Contributing

Bug reports, ideas, new animations and code are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). It covers setup, how the code is organised, and how to open a pull request. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Built with

[Tauri 2](https://v2.tauri.app) and Rust for the Windows side, TypeScript and SVG for the buddy (no images: every part of him is drawn and animated in code), [Open-Meteo](https://open-meteo.com) for weather, and the Windows OCR engine for reading text.

## License

[MIT](LICENSE). Use it, change it, share it.
