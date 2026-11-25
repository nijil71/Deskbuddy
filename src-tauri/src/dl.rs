// Drop a video link on the buddy → download the video (MP4) or just the audio (MP3) into
// Downloads. yt-dlp does the work (1800+ sites), with the FFmpeg we already find for conversions
// to merge/convert. Like the converter, it's used if installed: `winget install yt-dlp.yt-dlp`.

use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn ytdlp() -> Option<PathBuf> {
    crate::convert::find_tool("yt-dlp.exe", "yt-dlp")
}

#[derive(Serialize, Clone)]
struct Progress {
    pct: f32,
}

/// Download `url`; returns the saved file's path. Emits "dl-progress" {pct} while it runs.
pub fn download(app: &AppHandle, url: &str, audio: bool) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("That's not a web link".into());
    }
    let bin = ytdlp().ok_or("yt-dlp isn't installed")?;
    let dir = crate::win::downloads_dir();
    let mut c = Command::new(bin);
    c.creation_flags(CREATE_NO_WINDOW)
        .args(["--no-playlist", "--no-warnings", "--quiet", "--progress", "--newline", "--no-mtime"])
        .args(["--progress-template", "download:PROG %(progress._percent_str)s"])
        .args(["--print", "after_move:PATH %(filepath)s", "--no-simulate"])
        .arg("-P")
        .arg(&dir)
        .args(["-o", "%(title).90B [%(id)s].%(ext)s", "--windows-filenames"]);
    if let Some(ff) = crate::convert::ffmpeg() {
        if let Some(d) = ff.parent() {
            c.arg("--ffmpeg-location").arg(d);
        }
    }
    if audio {
        c.args(["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
    } else {
        // Prefer MP4/H.264 + AAC so it plays everywhere (Windows' Media Player, PowerPoint, phones).
        c.args(["-f", "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4]/bv*[height<=1080]+ba/b", "--merge-output-format", "mp4"]);
    }
    c.arg("--").arg(url); // never let a "URL" be read as an option
    let mut child = c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("Couldn't start yt-dlp: {e}"))?;

    let mut saved = None;
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if let Some(p) = line.strip_prefix("PROG ") {
                if let Ok(pct) = p.trim().trim_end_matches('%').trim().parse::<f32>() {
                    let _ = app.emit_to("main", "dl-progress", Progress { pct });
                }
            } else if let Some(p) = line.strip_prefix("PATH ") {
                saved = Some(p.trim().to_string());
            }
        }
    }
    let mut err = String::new();
    if let Some(mut e) = child.stderr.take() {
        use std::io::Read;
        let _ = e.read_to_string(&mut err);
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    match saved {
        Some(p) if status.success() => Ok(p),
        _ => {
            let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("download failed");
            Err(last.trim().trim_start_matches("ERROR: ").chars().take(160).collect())
        }
    }
}
