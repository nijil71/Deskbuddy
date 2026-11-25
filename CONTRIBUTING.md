# Contributing to Deskbud

Thanks for wanting to help! Bug reports, ideas, new animations, docs fixes and code are all welcome.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug.** [Open a bug report](https://github.com/nijil71/Deskbuddy/issues/new?template=bug_report.yml). Steps to reproduce and a screenshot make a huge difference.
- **Suggest an idea.** [Open a feature idea](https://github.com/nijil71/Deskbuddy/issues/new?template=feature_request.yml).
- **Fix something.** Issues labelled [`good first issue`](https://github.com/nijil71/Deskbuddy/labels/good%20first%20issue) are a nice place to start.
- **Improve the docs.** If something confused you, it will confuse the next person too.

For anything bigger than a small fix, please open an issue first so we can agree on the approach before you spend time on it.

## Set up your computer

Deskbud is a Windows app, so you need **Windows 10 or 11**. Install these once (copy each line into PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS      # Node.js 22.6 or newer
winget install Rustlang.Rustup        # Rust
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

The last line installs the C++ build tools Rust needs. Close and reopen your terminal afterwards so the new commands are found. WebView2 is already part of Windows 10 and 11. More detail is in the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

## Get the code running

```powershell
git clone https://github.com/nijil71/Deskbuddy.git
cd Deskbuddy
npm install
npm run tauri dev
```

The first run compiles the Rust side, which takes a few minutes. After that, changes to TypeScript files reload instantly. Changes to Rust files rebuild and restart the app automatically.

> **Tips**
> - If you already have Deskbud installed, quit it first (tray icon → Quit). Only one buddy can run at a time.
> - If your clone is inside OneDrive (or another synced folder), keep Rust's multi-GB build cache out of it by creating `src-tauri/.cargo/config.toml` with `[build]` and `target-dir = "C:/Users/<you>/AppData/Local/cargo-target/deskbud"`. That file is gitignored.

## Check your work

Run these before opening a pull request. CI runs the same ones.

```powershell
npm test               # TypeScript unit tests
npm run build          # type-check + build the frontend
cd src-tauri
cargo test             # Rust unit tests
```

To build a real installer: `npm run tauri build`. It lands in `src-tauri/target/release/bundle/`.

## How the code is organised

Deskbud is a [Tauri 2](https://v2.tauri.app) app. A Rust core talks to Windows, and the buddy is an SVG character animated part by part in a web view.

```
src/                      the buddy and the settings panel (TypeScript)
  main.ts                 starts everything in the buddy window
  buddy/rig.ts            the SVG puppet: head, hair, glasses, eyes, mouths, limbs, props
  buddy/buddy.ts          frame loop, blending between actions, always-on layers (breathing, blinking)
  buddy/world.ts          desktop physics: taskbar floor, window tops, gravity, two screens
  buddy/brain.ts          decides what to do next: idle choices, reactions, reminders, meetings
  buddy/anims/            every animation
  panel/                  the settings / notes / clipboard window
  services/               weather, news, focus timer, updates, Claude Code alerts…
  shared/settings.ts      all settings and their defaults
src-tauri/src/            the Windows side (Rust)
  lib.rs                  app state, background workers, tray menu, commands the UI can call
  win.rs                  Win32: idle time, input, monitors, windows, CPU/RAM/battery, clipboard
  convert.rs              file conversion (built-in images, FFmpeg, pandoc, LibreOffice)
  ocr.rs                  text from images (Windows.Media.Ocr)
  dl.rs                   video/audio downloads (yt-dlp)
  cc.rs                   Claude Code hooks
  update.rs               local self-update for developers
tests/                    TypeScript tests (Node's built-in test runner)
scripts/release.mjs       bump the version and build an installer locally
```

## Guidelines

- **Keep it light.** The buddy runs all day. Only change `transform`/`d` attributes per frame, don't add SVG filters, and keep background polling cheap. See [Staying light](docs/FEATURES.md#staying-light-on-your-pc).
- **Test animations at low frame rates too.** The buddy runs at 60 fps while moving but drops to 24 fps when idle and 10 fps when asleep (each frame is 0.1 s). Physics and springs must look right at 10 fps as well as 60.
- **Privacy first.** Nothing about the user (window titles, clipboard, notes, keystrokes) may leave the PC. A new network request needs a clear reason, a mention in the README's Privacy section, and ideally a setting to turn it off.
- **New settings** go in `src/shared/settings.ts` with a sensible default. Saved settings are merged with the defaults, so older installs pick up new fields automatically.
- **Files are UTF-8** with LF line endings (see `.editorconfig`). The code uses characters like `…` and `→`, so make sure scripts that edit files read and write UTF-8.
- **Match the style around you.** Small, focused functions; comments explain *why*, not *what*.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org) style, for example:

```
feat: buddy waves when you unlock the PC
fix: reminders no longer show during calls
docs: explain how to change work hours
```

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, and add tests where it makes sense.
3. If users will notice the change, add a line to [CHANGELOG.md](CHANGELOG.md) under **Unreleased**.
4. Open a pull request and fill in the template. For visual changes, a screenshot or short GIF helps reviewers a lot.

## Releasing (maintainers)

1. Move the **Unreleased** items in `CHANGELOG.md` under a new version heading.
2. Bump the version everywhere and build locally: `npm run release` (patch), `npm run release -- minor`, or `npm run release -- 2.0.0`.
3. Commit, tag and push:
   ```powershell
   git commit -am "release: v1.0.4"
   git tag v1.0.4
   git push origin main v1.0.4
   ```
4. The [Release workflow](.github/workflows/release.yml) builds the installers and publishes them on the [Releases page](https://github.com/nijil71/Deskbuddy/releases). Installed buddies offer the update within about 12 hours.

`npm run release` also copies the installer into `releases/`. A buddy you built yourself on the same PC picks it up within about 2 minutes and offers a one-click update. That local shortcut is turned off in the published builds.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
