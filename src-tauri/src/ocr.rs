// Text from images with the OCR engine built into Windows (Windows.Media.Ocr): offline, free,
// nothing to download, uses your Windows display languages. Same idea as pot-desktop's OCR.
//   ocr_file(path)  — any image file the buddy is handed
//   ocr_snip()      — opens the snipping overlay, waits for the snip on the clipboard, reads it

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use windows::core::HSTRING;
use windows::Graphics::Imaging::{
    BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat, BitmapTransform, ColorManagementMode,
    ExifOrientationMode, SoftwareBitmap,
};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::{FileAccessMode, StorageFile};

fn com() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn load(path: &Path) -> windows::core::Result<SoftwareBitmap> {
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
    let stream = file.OpenAsync(FileAccessMode::Read)?.join()?;
    let dec = BitmapDecoder::CreateAsync(&stream)?.join()?;
    let (w, h) = (dec.PixelWidth()?, dec.PixelHeight()?);
    let max = OcrEngine::MaxImageDimension()?;
    let big = w.max(h).max(1);
    // Too large → shrink to the engine's limit. Small snips of UI text → 2× up, which reads much better.
    let scale = if big > max { max as f64 / big as f64 } else if big < 1200 && big * 2 <= max { 2.0 } else { 1.0 };
    let t = BitmapTransform::new()?;
    if scale != 1.0 {
        t.SetScaledWidth(((w as f64 * scale) as u32).max(1))?;
        t.SetScaledHeight(((h as f64 * scale) as u32).max(1))?;
        t.SetInterpolationMode(BitmapInterpolationMode::Fant)?;
    }
    dec.GetSoftwareBitmapTransformedAsync(
        BitmapPixelFormat::Bgra8,
        BitmapAlphaMode::Premultiplied,
        &t,
        ExifOrientationMode::RespectExifOrientation,
        ColorManagementMode::DoNotColorManage,
    )?
    .join()
}

pub fn ocr_file(path: &str) -> Result<String, String> {
    com();
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|_| "Windows has no OCR language installed (Settings → Time & language → Language)".to_string())?;
    let bmp = load(Path::new(path)).map_err(|e| format!("Couldn't read that image: {}", e.message()))?;
    let res = engine.RecognizeAsync(&bmp).and_then(|op| op.join()).map_err(|e| format!("OCR failed: {}", e.message()))?;
    let mut lines = vec![];
    for line in res.Lines().map_err(|e| e.message().to_string())? {
        let t = line.Text().map(|s| s.to_string()).unwrap_or_default();
        if !t.trim().is_empty() {
            lines.push(t);
        }
    }
    Ok(lines.join("\n"))
}

fn temp_png() -> PathBuf {
    std::env::temp_dir().join(format!("deskbud-ocr-{}.png", std::process::id()))
}

/// OCR whatever image is on the clipboard right now.
pub fn ocr_clipboard() -> Result<String, String> {
    let bmp = crate::win::clipboard_bmp().ok_or("There's no image on the clipboard")?;
    // Re-encode through the image crate: snips are 32-bit DIBs whose alpha is often 0, which
    // would read as fully transparent. RGB PNG sidesteps that.
    let img = image::load_from_memory_with_format(&bmp, image::ImageFormat::Bmp).map_err(|e| format!("Couldn't read the snip: {e}"))?;
    let tmp = temp_png();
    image::DynamicImage::ImageRgb8(img.to_rgb8()).save(&tmp).map_err(|e| e.to_string())?;
    let r = ocr_file(&tmp.to_string_lossy());
    let _ = std::fs::remove_file(&tmp);
    r
}

/// Open the snipping overlay, wait (up to 90 s) for a new image on the clipboard, OCR it.
pub fn ocr_snip() -> Result<String, String> {
    let seq = crate::win::clipboard_seq();
    let began = std::time::SystemTime::now();
    if !crate::win::shell_open("ms-screenclip:") {
        return Err("Couldn't open the snipping tool".into());
    }
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(90) {
        std::thread::sleep(Duration::from_millis(250));
        if crate::win::clipboard_seq() != seq {
            // The Snipping Tool also auto-saves the snip as a file; we only wanted the text.
            std::thread::spawn(move || remove_saved_snip(&crate::win::screenshots_dir(), began, Duration::from_secs(6)));
            std::thread::sleep(Duration::from_millis(200)); // let the snipping tool finish writing
            return ocr_clipboard().map_err(|_| "That wasn't a snip — cancelled".to_string());
        }
    }
    Err("No snip taken".into())
}

/// Delete the one screenshot file the Snipping Tool saved for our snip: an image in the
/// Screenshots folder created after `since`. Waits up to `wait` for it to appear. Never touches
/// anything older, and deletes at most one file.
fn remove_saved_snip(dir: &Path, since: std::time::SystemTime, wait: Duration) -> Option<PathBuf> {
    let since = since - Duration::from_secs(1); // filesystem timestamp granularity
    let start = Instant::now();
    while start.elapsed() < wait {
        let newest = std::fs::read_dir(dir).ok()?.flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                n.ends_with(".png") || n.ends_with(".jpg") || n.ends_with(".jpeg")
            })
            .filter_map(|e| Some((e.metadata().ok()?.created().ok()?, e.path())))
            .filter(|(t, _)| *t >= since)
            .max_by_key(|(t, _)| *t);
        if let Some((_, p)) = newest {
            std::thread::sleep(Duration::from_millis(300)); // let the tool finish writing it
            return std::fs::remove_file(&p).ok().map(|_| p);
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders "Hello Deskbud 42" with GDI+ via PowerShell, then reads it back.
    #[test]
    fn reads_rendered_text() {
        let out = std::env::temp_dir().join("deskbud-ocr-test.png");
        let _ = std::fs::remove_file(&out);
        let ps = format!(
            "Add-Type -AssemblyName System.Drawing; $b=New-Object Drawing.Bitmap 520,90; $g=[Drawing.Graphics]::FromImage($b); \
             $g.Clear([Drawing.Color]::White); $g.TextRenderingHint='AntiAlias'; \
             $g.DrawString('Hello Deskbud 42',(New-Object Drawing.Font 'Segoe UI',32),[Drawing.Brushes]::Black,10,10); \
             $b.Save('{}')",
            out.display()
        );
        let ok = std::process::Command::new("powershell").args(["-NoProfile", "-Command", &ps]).status().unwrap().success();
        assert!(ok && out.is_file());
        let text = ocr_file(&out.to_string_lossy()).unwrap();
        assert!(text.contains("Hello") && text.contains("Deskbud") && text.contains("42"), "got {text:?}");
    }

    #[test]
    fn removes_only_the_new_snip() {
        let d = std::env::temp_dir().join("deskbud-snip-test");
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let old = d.join("Screenshot old.png");
        std::fs::write(&old, b"x").unwrap();
        std::thread::sleep(Duration::from_millis(1600));
        let since = std::time::SystemTime::now();
        assert!(remove_saved_snip(&d, since, Duration::from_millis(600)).is_none(), "nothing new → nothing deleted");
        let new = d.join("Screenshot new.png");
        let new2 = new.clone();
        std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(400)); std::fs::write(new2, b"y").unwrap(); });
        assert_eq!(remove_saved_snip(&d, since, Duration::from_secs(3)), Some(new.clone()));
        assert!(old.is_file() && !new.exists());
    }

    #[test]
    fn dib_header_round_trip() {
        // a 2x1 24-bit image through BMP → strip file header (= CF_DIB) → rebuild → decode
        let mut bmp = std::io::Cursor::new(vec![]);
        image::RgbImage::from_raw(2, 1, vec![255, 0, 0, 0, 0, 255]).unwrap().write_to(&mut bmp, image::ImageFormat::Bmp).unwrap();
        let dib = &bmp.get_ref()[14..];
        let rebuilt = crate::win::dib_to_bmp_for_test(dib).unwrap();
        let img = image::load_from_memory_with_format(&rebuilt, image::ImageFormat::Bmp).unwrap().to_rgb8();
        assert_eq!(img.get_pixel(0, 0).0, [255, 0, 0]);
        assert_eq!(img.get_pixel(1, 0).0, [0, 0, 255]);
    }
}
