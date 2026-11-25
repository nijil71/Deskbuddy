# Security Policy

## Supported versions

Only the [latest release](https://github.com/nijil71/Deskbuddy/releases/latest) gets security fixes. Please update before reporting.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report it privately through GitHub instead:

1. Go to the [Security tab](https://github.com/nijil71/Deskbuddy/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what an attacker could do with it.

You should get a reply within 7 days. Once a fix is released, you'll be credited in the release notes unless you'd rather not be.

## What is in scope

Deskbud runs on your desktop with your user permissions, so these areas matter most:

- **Running programs.** The launcher, file converter (FFmpeg, pandoc, LibreOffice), video downloader (yt-dlp) and OCR start other programs. Any way to make Deskbud run something you didn't choose is a vulnerability.
- **Simulated input.** The keep-alive feature sends a 1-pixel mouse move and an F15 key press. Any way to make it send other input is a vulnerability.
- **Claude Code hooks.** Turning this on edits `~/.claude/settings.json`. Anything that corrupts that file or leaks prompt contents is in scope.
- **Local data.** Notes, clipboard history (kept in memory only) and the activity diary must never leave the PC.
- **Updates.** Any way to make the update check point at something other than this repository's official releases.

Bugs in third-party tools that Deskbud calls (FFmpeg, yt-dlp, and so on) should go to those projects.
