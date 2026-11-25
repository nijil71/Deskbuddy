# Changelog

All notable changes to Deskbud are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Ready-made Windows installers published on [GitHub Releases](https://github.com/nijil71/Deskbuddy/releases).
- The buddy tells you when a new release is out (about twice a day it asks GitHub; turn it off in Settings → App).
- Installer now sets up Microsoft WebView2 automatically if it's missing.
- Open-source project files: license (MIT), contributing guide, code of conduct, security policy, issue and pull request templates, CI.

### Changed
- Default work hours are now Monday–Friday 09:00–18:00. Your saved hours are not touched.

## 1.0.3 - 2026-11-25

### Added
- Two screens: the buddy walks (or hops) to your other monitor, follows you there, or goes on request.
- Short-term memory: what you were doing, a running focus timer and today's work tracking survive a restart.
- Daily backups of your settings and notes (last 7 days), restored automatically if the file is damaged.

### Fixed
- Claude Code alerts now fire reliably for long tasks and permission prompts.

## 1.0.2 - 2026-11-25

### Fixed
- Copy text (OCR) no longer leaves the Snipping Tool's auto-saved screenshot behind.

### Added
- Copied video links offer a download.

## 1.0.1 - 2026-11-25

### Added
- File converter: drop a file on the buddy to convert images, audio, video and documents.
- Local self-update for builds made with `npm run release`.
- Claude Code alerts when a long task finishes or needs permission.
- Copy text from anything on screen (Windows OCR).
- Video and MP3 downloads through yt-dlp.
- Typing-along and work-state tracking.
- Cursor games, touch zones and high fives.
- Daily comic and private activity diary.
- Hacker News stories.
- Mood and memory system.

## 1.0.0 - 2026-11-23

- First version: the animated buddy, Teams keep-alive, focus timer, reminders, meetings, notes, clipboard history, launcher and weather.

[Unreleased]: https://github.com/nijil71/Deskbuddy/commits/main
