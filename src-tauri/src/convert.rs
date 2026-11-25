// File conversion: drop a file on the buddy, pick a format, get a converted copy next to the original.
//
// Rather than reinventing codecs, this does what ConvertX / File Converter / VERT do: route each
// format to a proven engine.
//   images            → the `image` crate, in-process (always available, nothing to install)
//   audio / video     → FFmpeg            (if installed: `winget install Gyan.FFmpeg`)
//   markup documents  → pandoc            (if installed: `winget install JohnMacFarlane.Pandoc`)
//   office documents  → LibreOffice       (if installed: `winget install TheDocumentFoundation.LibreOffice`)
// External tools are found on PATH (plus the usual install folders) and run without a console window.

use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Formats the `image` crate can read / write (see Cargo features).
const IMG_IN: &[&str] = &["png", "jpg", "jpeg", "jfif", "webp", "bmp", "gif", "tif", "tiff", "ico", "tga", "qoi", "pnm", "ppm", "pgm", "pbm"];
const IMG_OUT: &[&str] = &["png", "jpg", "webp", "bmp", "gif", "tiff", "ico"];
// Images only FFmpeg can decode.
const IMG_FF_IN: &[&str] = &["avif", "heic", "heif", "jxl"];

const VIDEO_IN: &[&str] = &["mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "m4v", "mpeg", "mpg", "3gp", "ts", "mts", "m2ts", "ogv"];
const VIDEO_OUT: &[&str] = &["mp4", "mkv", "webm", "mov", "avi", "gif"];
const AUDIO_IN: &[&str] = &["mp3", "wav", "flac", "aac", "m4a", "ogg", "oga", "opus", "wma", "aiff", "aif", "amr"];
const AUDIO_OUT: &[&str] = &["mp3", "wav", "flac", "m4a", "ogg", "opus"];

const PANDOC_IN: &[&str] = &["md", "markdown", "docx", "odt", "html", "htm", "epub", "rst", "tex", "org", "txt", "rtf", "ipynb"];
const PANDOC_OUT: &[&str] = &["docx", "odt", "html", "md", "epub", "rtf", "txt"];
const LO_WRITER: &[&str] = &["doc", "docx", "odt", "rtf", "txt", "wpd", "pages"];
const LO_CALC: &[&str] = &["xls", "xlsx", "ods", "csv"];
const LO_IMPRESS: &[&str] = &["ppt", "pptx", "odp", "key"];

fn has(list: &[&str], ext: &str) -> bool {
    list.contains(&ext)
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Normalise aliases so "jpeg" and "jpg" count as the same format.
fn canon(ext: &str) -> &str {
    match ext {
        "jpeg" | "jfif" => "jpg",
        "tif" => "tiff",
        "htm" => "html",
        "markdown" => "md",
        "aif" => "aiff",
        "mpeg" => "mpg",
        e => e,
    }
}

// ------------------------------------------------------------------ tool discovery

fn find_on_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(exe)).find(|p| p.is_file())
}

/// Find a command-line tool: PATH first, then winget's install folders (winget only adds them to
/// PATH for shells started later, so a buddy that's been running all day wouldn't see them).
pub fn find_tool(exe: &str, winget_hint: &str) -> Option<PathBuf> {
    if let Some(p) = find_on_path(exe) {
        return Some(p);
    }
    let winget = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Microsoft\\WinGet");
    let link = winget.join("Links").join(exe);
    if link.is_file() {
        return Some(link);
    }
    for pkg in std::fs::read_dir(winget.join("Packages")).ok()?.flatten() {
        if !pkg.file_name().to_string_lossy().to_ascii_lowercase().contains(winget_hint) {
            continue;
        }
        let root = pkg.path();
        let mut dirs = vec![root.clone()];
        if let Ok(rd) = std::fs::read_dir(&root) {
            dirs.extend(rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
        }
        for d in dirs {
            for p in [d.join(exe), d.join("bin").join(exe)] {
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    None
}

pub fn ffmpeg() -> Option<PathBuf> {
    find_tool("ffmpeg.exe", "ffmpeg")
}

fn pandoc() -> Option<PathBuf> {
    find_on_path("pandoc.exe").or_else(|| {
        let p = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Pandoc\\pandoc.exe");
        p.is_file().then_some(p)
    })
}

fn soffice() -> Option<PathBuf> {
    find_on_path("soffice.exe").or_else(|| {
        ["ProgramFiles", "ProgramFiles(x86)"].iter().find_map(|v| {
            let p = PathBuf::from(std::env::var_os(v)?).join("LibreOffice\\program\\soffice.exe");
            p.is_file().then_some(p)
        })
    })
}

// ------------------------------------------------------------------ what can this file become?

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Targets {
    /// Formats we can produce right now.
    pub formats: Vec<String>,
    /// If the file type is convertible but the engine isn't installed, which one is missing.
    pub missing: Option<String>,
}

pub fn targets(path: &str) -> Targets {
    let p = Path::new(path);
    if !p.is_file() {
        return Targets { formats: vec![], missing: None };
    }
    let ext = ext_of(p);
    let e = ext.as_str();
    let mut out: Vec<&str> = vec![];
    let mut missing = None;
    let ff = || ffmpeg().is_some();

    if has(IMG_IN, e) {
        out.extend(IMG_OUT);
        if e == "gif" {
            if ff() { out.extend(["mp4", "webm"]); }
        }
    } else if has(IMG_FF_IN, e) {
        if ff() { out.extend(IMG_OUT); } else { missing = Some("FFmpeg"); }
    } else if has(VIDEO_IN, e) {
        if ff() { out.extend(VIDEO_OUT); out.extend(["mp3", "m4a", "wav"]); } else { missing = Some("FFmpeg"); }
    } else if has(AUDIO_IN, e) {
        if ff() { out.extend(AUDIO_OUT); } else { missing = Some("FFmpeg"); }
    } else {
        let lo = soffice().is_some();
        let pd = pandoc().is_some();
        if lo && has(LO_WRITER, e) { out.extend(["pdf", "docx", "odt", "rtf", "txt", "html"]); }
        if lo && has(LO_CALC, e) { out.extend(["pdf", "xlsx", "ods", "csv"]); }
        if lo && has(LO_IMPRESS, e) { out.extend(["pdf", "pptx", "odp"]); }
        if pd && has(PANDOC_IN, e) { out.extend(PANDOC_OUT); }
        if out.is_empty() {
            if has(LO_WRITER, e) || has(LO_CALC, e) || has(LO_IMPRESS, e) { missing = Some("LibreOffice"); }
            else if has(PANDOC_IN, e) { missing = Some("pandoc"); }
        }
    }

    let me = canon(e);
    let mut formats: Vec<String> = vec![];
    for f in out {
        if canon(f) != me && !formats.iter().any(|x| x == f) {
            formats.push(f.to_string());
        }
    }
    Targets { formats, missing: missing.map(String::from) }
}

// ------------------------------------------------------------------ do it

/// `photo.jpg` → `photo.png`; never overwrites: `photo (1).png`, `photo (2).png`, …
fn out_path(src: &Path, to: &str) -> PathBuf {
    let dir = src.parent().unwrap_or(Path::new("."));
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("converted");
    let mut p = dir.join(format!("{stem}.{to}"));
    let mut n = 1;
    while p.exists() {
        p = dir.join(format!("{stem} ({n}).{to}"));
        n += 1;
    }
    p
}

pub fn convert(path: &str, to: &str) -> Result<String, String> {
    let src = Path::new(path);
    if !src.is_file() {
        return Err("I can't find that file anymore".into());
    }
    let to = to.trim_start_matches('.').to_ascii_lowercase();
    if !targets(path).formats.iter().any(|f| *f == to) {
        return Err(format!("I can't turn that into .{to}"));
    }
    let ext = ext_of(src);
    let e = ext.as_str();
    let dst = out_path(src, &to);

    let res = if has(IMG_IN, e) && has(IMG_OUT, &to) {
        image_convert(src, &dst, &to)
    } else if has(IMG_FF_IN, e) {
        // FFmpeg decodes (avif/heic/jxl) to a temp PNG, then the image path encodes it.
        let tmp = std::env::temp_dir().join(format!("deskbud-convert-{}.png", std::process::id()));
        let _ = std::fs::remove_file(&tmp);
        let r = ffmpeg_convert(src, &tmp, "png").and_then(|_| image_convert(&tmp, &dst, &to));
        let _ = std::fs::remove_file(&tmp);
        r
    } else if has(IMG_IN, e) || has(IMG_FF_IN, e) || has(VIDEO_IN, e) || has(AUDIO_IN, e) {
        ffmpeg_convert(src, &dst, &to)
    } else if soffice().is_some() && (has(LO_WRITER, e) || has(LO_CALC, e) || has(LO_IMPRESS, e))
        && !(pandoc().is_some() && has(PANDOC_IN, e) && has(PANDOC_OUT, &to) && to != "pdf")
    {
        libreoffice_convert(src, &dst, &to)
    } else {
        pandoc_convert(src, &dst, &to)
    };

    match res {
        Ok(()) if dst.is_file() => Ok(dst.to_string_lossy().into_owned()),
        Ok(()) => Err("The converter finished but didn't write a file".into()),
        Err(err) => {
            let _ = std::fs::remove_file(&dst); // don't leave half-written files behind
            Err(err)
        }
    }
}

fn image_convert(src: &Path, dst: &Path, to: &str) -> Result<(), String> {
    use image::{imageops::FilterType, DynamicImage, ImageFormat};
    let img = image::ImageReader::open(src)
        .map_err(|e| e.to_string())?
        .with_guessed_format() // trust the bytes, not the extension
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| format!("Couldn't read the image: {e}"))?;

    let (fmt, img) = match to {
        // JPEG has no alpha channel: flatten onto white instead of letting transparency go black.
        "jpg" => (ImageFormat::Jpeg, DynamicImage::ImageRgb8(flatten_white(&img))),
        "bmp" => (ImageFormat::Bmp, DynamicImage::ImageRgba8(img.to_rgba8())),
        // Icons max out at 256×256.
        "ico" => (
            ImageFormat::Ico,
            if img.width() > 256 || img.height() > 256 { img.resize(256, 256, FilterType::Lanczos3) } else { img },
        ),
        "png" => (ImageFormat::Png, img),
        "webp" => (ImageFormat::WebP, DynamicImage::ImageRgba8(img.to_rgba8())),
        "gif" => (ImageFormat::Gif, DynamicImage::ImageRgba8(img.to_rgba8())),
        "tiff" => (ImageFormat::Tiff, img),
        _ => return Err(format!("Unsupported image format .{to}")),
    };
    img.save_with_format(dst, fmt).map_err(|e| format!("Couldn't write the image: {e}"))
}

fn flatten_white(img: &image::DynamicImage) -> image::RgbImage {
    let rgba = img.to_rgba8();
    image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let a = a as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        image::Rgb([mix(r), mix(g), mix(b)])
    })
}

fn run(mut cmd: Command, what: &str) -> Result<(), String> {
    let out = cmd
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Couldn't start {what}: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("unknown error");
    Err(format!("{what} failed: {}", last.trim()))
}

fn ffmpeg_convert(src: &Path, dst: &Path, to: &str) -> Result<(), String> {
    let bin = ffmpeg().ok_or("FFmpeg isn't installed")?;
    let mut c = Command::new(bin);
    c.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]).arg(src);
    let a: &[&str] = match to {
        // video
        "mp4" | "mov" => &["-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
        "mkv" => &["-map", "0", "-c", "copy"], // MKV holds almost anything: just rewrap, instant
        "webm" => &["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-c:a", "libopus", "-b:a", "128k"],
        "avi" => &["-c:v", "mpeg4", "-q:v", "3", "-c:a", "libmp3lame", "-q:a", "3"],
        "gif" => &["-vf", "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0"],
        // audio (also "extract the audio" from a video)
        "mp3" => &["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
        "m4a" => &["-vn", "-c:a", "aac", "-b:a", "192k"],
        "ogg" => &["-vn", "-c:a", "libvorbis", "-q:a", "5"],
        "opus" => &["-vn", "-c:a", "libopus", "-b:a", "128k"],
        "flac" => &["-vn", "-c:a", "flac"],
        "wav" => &["-vn", "-c:a", "pcm_s16le"],
        // still images FFmpeg decodes (avif/heic/jxl): first frame only
        "png" | "jpg" | "bmp" | "tiff" | "webp" | "ico" => &["-frames:v", "1", "-update", "1"],
        _ => &[],
    };
    c.args(a).arg(dst);
    run(c, "FFmpeg")
}

fn pandoc_convert(src: &Path, dst: &Path, to: &str) -> Result<(), String> {
    let bin = pandoc().ok_or("pandoc isn't installed")?;
    let mut c = Command::new(bin);
    c.arg(src).arg("-o").arg(dst).arg("--standalone");
    // .txt input is read as markdown by default (good); outputs need an explicit writer.
    let writer = match to { "txt" => "plain", "md" => "gfm", "html" => "html5", w => w };
    c.args(["-t", writer]);
    run(c, "pandoc")
}

fn libreoffice_convert(src: &Path, dst: &Path, to: &str) -> Result<(), String> {
    let bin = soffice().ok_or("LibreOffice isn't installed")?;
    // LibreOffice picks the output name itself (<stem>.<ext>) inside --outdir, so convert in a
    // private temp folder and then move the result to the non-clobbering destination.
    let tmp = std::env::temp_dir().join(format!("deskbud-convert-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let mut c = Command::new(bin);
    // A separate profile lets this run even while the user has LibreOffice open.
    let profile = format!("-env:UserInstallation=file:///{}", tmp.join("profile").to_string_lossy().replace('\\', "/"));
    c.arg(profile).args(["--headless", "--norestore", "--convert-to", to, "--outdir"]).arg(&tmp).arg(src);
    let r = run(c, "LibreOffice").and_then(|_| {
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let made = tmp.join(format!("{stem}.{to}"));
        std::fs::rename(&made, dst)
            .or_else(|_| std::fs::copy(&made, dst).map(|_| ()))
            .map_err(|_| "LibreOffice didn't produce a file".to_string())
    });
    let _ = std::fs::remove_dir_all(&tmp);
    r
}

/// Open Explorer with the file selected.
pub fn reveal(path: &str) -> bool {
    Command::new("explorer.exe").arg(format!("/select,{path}")).spawn().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("deskbud-convert-test-{name}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn images_round_trip_every_format() {
        let d = tmpdir("img");
        let src = d.join("pic.png");
        // half-transparent gradient, 300x200 (so ICO has to shrink it)
        image::RgbaImage::from_fn(300, 200, |x, y| image::Rgba([x as u8, y as u8, 128, if x < 150 { 255 } else { 0 }])).save(&src).unwrap();
        let s = src.to_str().unwrap();
        let t = targets(s);
        assert!(!t.formats.contains(&"png".to_string()), "shouldn't offer the same format");
        for f in ["jpg", "webp", "bmp", "gif", "tiff", "ico"] {
            assert!(t.formats.contains(&f.to_string()), "missing {f}");
            let out = convert(s, f).unwrap_or_else(|e| panic!("{f}: {e}"));
            let img = image::open(&out).unwrap_or_else(|e| panic!("{f} unreadable: {e}"));
            if f == "ico" { assert!(img.width() <= 256); } else { assert_eq!((img.width(), img.height()), (300, 200)); }
            if f == "jpg" {
                let px = img.to_rgb8().get_pixel(299, 0).0;
                assert_eq!(px, [255, 255, 255], "transparent areas should flatten to white");
            }
        }
        // jpg → png, and no clobbering
        let jpg = d.join("pic.jpg");
        let a = convert(jpg.to_str().unwrap(), "png").unwrap();
        assert!(a.ends_with("pic (1).png"), "{a}");
        assert!(convert(s, "exe").is_err());
    }

    #[test]
    fn ffmpeg_media() {
        let Some(ff) = ffmpeg() else { eprintln!("ffmpeg not installed, skipping"); return };
        let d = tmpdir("ff");
        let mp4 = d.join("clip.mov");
        let st = Command::new(&ff).creation_flags(CREATE_NO_WINDOW)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=321x241:rate=10:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest"])
            .arg(&mp4).status().unwrap();
        assert!(st.success());
        let s = mp4.to_str().unwrap();
        let t = targets(s);
        for f in ["mp4", "webm", "gif", "mkv", "mp3"] {
            assert!(t.formats.contains(&f.to_string()), "missing {f}");
            let out = convert(s, f).unwrap_or_else(|e| panic!("{f}: {e}"));
            assert!(std::fs::metadata(&out).unwrap().len() > 100, "{f} empty");
        }
        let mp3 = d.join("clip.mp3");
        for f in ["wav", "flac", "m4a", "ogg", "opus"] {
            convert(mp3.to_str().unwrap(), f).unwrap_or_else(|e| panic!("{f}: {e}"));
        }
        // gif → mp4
        convert(d.join("clip.gif").to_str().unwrap(), "mp4").unwrap();
    }
}
