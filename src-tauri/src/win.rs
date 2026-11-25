//! Thin, safe-ish wrappers around the Win32 calls Deskbud needs.
#![allow(clippy::missing_safety_doc)]

use serde::Serialize;
use std::ffi::c_void;
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{FILETIME, HANDLE, HGLOBAL, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, OpenInputDesktop, SwitchDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP,
};
use windows::Win32::System::SystemInformation::{GetLocalTime, GetTickCount, GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP, MOUSEEVENTF_MOVE,
    MOUSEINPUT, VK_F15,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::Shell::{
    FOLDERID_Downloads, FOLDERID_Pictures, FOLDERID_Screenshots, SHGetKnownFolderPath, KF_FLAG_DEFAULT,
    ShellExecuteW, SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetCursorPos, GetForegroundWindow, GetWindowLongW, GetWindowRect,
    GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, GWL_EXSTYLE,
    GWL_STYLE, SW_SHOWNORMAL, WS_CAPTION, WS_EX_TOOLWINDOW,
};

// ---------------------------------------------------------------- input / presence

/// Milliseconds since the last keyboard/mouse input anywhere in the session.
pub fn idle_ms() -> u64 {
    unsafe {
        let mut lii = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if GetLastInputInfo(&mut lii).as_bool() {
            GetTickCount().wrapping_sub(lii.dwTime) as u64
        } else {
            0
        }
    }
}

/// True when the workstation is locked (input desktop isn't switchable to).
pub fn is_locked() -> bool {
    unsafe {
        match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) {
            Ok(h) => {
                let ok = SwitchDesktop(h).is_ok();
                let _ = CloseDesktop(h);
                !ok
            }
            Err(_) => true,
        }
    }
}

/// Fullscreen game/video or presentation mode in the foreground.
/// A real fullscreen app (video, game, slideshow, F11 browser) — not just a maximised window.
/// With an auto-hiding taskbar Windows reports QUNS_BUSY for every maximised window, so we
/// double-check the foreground window: no title bar, not maximised, and covering its monitor.
pub fn is_fullscreen_busy() -> bool {
    unsafe {
        let s = match SHQueryUserNotificationState() {
            Ok(s) => s,
            Err(_) => return false,
        };
        if s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE {
            return true;
        }
        if s != QUNS_BUSY {
            return false;
        }
        let fg = GetForegroundWindow();
        if fg.0.is_null() || IsZoomed(fg).as_bool() {
            return false;
        }
        let style = GetWindowLongW(fg, GWL_STYLE) as u32;
        if style & WS_CAPTION.0 == WS_CAPTION.0 {
            return false;
        }
        let mut r = RECT::default();
        if GetWindowRect(fg, &mut r).is_err() {
            return false;
        }
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST), &mut mi).as_bool() {
            return false;
        }
        let b = mi.rcMonitor;
        r.left <= b.left && r.top <= b.top && r.right >= b.right && r.bottom >= b.bottom
    }
}

fn known_folder(id: &windows::core::GUID, fallback: &str) -> std::path::PathBuf {
    unsafe {
        if let Ok(p) = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None) {
            let s = p.to_string().unwrap_or_default();
            windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const core::ffi::c_void));
            if !s.is_empty() {
                return s.into();
            }
        }
    }
    std::env::var("USERPROFILE").map(|h| std::path::Path::new(&h).join(fallback)).unwrap_or_else(|_| ".".into())
}

/// The user's real Pictures folder (follows OneDrive / folder redirection).
pub fn pictures_dir() -> std::path::PathBuf {
    known_folder(&FOLDERID_Pictures, "Pictures")
}

/// Where Windows / the Snipping Tool auto-saves screenshots (e.g. OneDrive\Pictures\Screenshots 1).
pub fn screenshots_dir() -> std::path::PathBuf {
    known_folder(&FOLDERID_Screenshots, "Pictures\\Screenshots")
}

/// The user's real Downloads folder.
pub fn downloads_dir() -> std::path::PathBuf {
    known_folder(&FOLDERID_Downloads, "Downloads")
}

/// Where the taskbars are right now (they slide in/out when set to auto-hide).
pub fn taskbars() -> Vec<Rect> {
    let mut v = Vec::new();
    unsafe {
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let (main, sec) = (wide("Shell_TrayWnd"), wide("Shell_SecondaryTrayWnd"));
        let mut push = |h: HWND| {
            let mut r = RECT::default();
            if !h.0.is_null() && IsWindowVisible(h).as_bool() && GetWindowRect(h, &mut r).is_ok() {
                v.push(r.into());
            }
        };
        if let Ok(h) = FindWindowW(PCWSTR(main.as_ptr()), PCWSTR::null()) {
            push(h);
        }
        let mut prev: Option<HWND> = None;
        while let Ok(h) = FindWindowExW(None, prev, PCWSTR(sec.as_ptr()), PCWSTR::null()) {
            if h.0.is_null() {
                break;
            }
            push(h);
            prev = Some(h);
        }
    }
    v
}

fn mouse(dx: i32, dy: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT { dx, dy, mouseData: 0, dwFlags: MOUSEEVENTF_MOVE, time: 0, dwExtraInfo: 0 },
        },
    }
}

fn key(up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_F15,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// The keep-alive nudge: a 1px mouse wiggle (there and back) plus an F15 tap.
/// Both reset the system idle timer that Teams uses to decide "Away".
pub fn nudge_input() {
    unsafe {
        let seq = [mouse(1, 0), mouse(-1, 0), key(false), key(true)];
        SendInput(&seq, std::mem::size_of::<INPUT>() as i32);
    }
}

pub fn cursor_pos() -> (i32, i32) {
    unsafe {
        let mut p = POINT::default();
        let _ = GetCursorPos(&mut p);
        (p.x, p.y)
    }
}

/// Local time: (weekday 0=Sun, hour, minute)
pub fn local_time() -> (u16, u16, u16) {
    unsafe {
        let t = GetLocalTime();
        (t.wDayOfWeek, t.wHour, t.wMinute)
    }
}

// ---------------------------------------------------------------- monitors & windows

#[derive(Serialize, Clone, Copy, Debug, Default)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}
impl From<RECT> for Rect {
    fn from(r: RECT) -> Self {
        Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct Monitor {
    pub bounds: Rect,
    pub work: Rect,
    pub scale: f64,
    pub primary: bool,
}

unsafe extern "system" fn mon_cb(h: HMONITOR, _: HDC, _: *mut RECT, lp: LPARAM) -> BOOL {
    let out = &mut *(lp.0 as *mut Vec<Monitor>);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    if GetMonitorInfoW(h, &mut mi).as_bool() {
        let (mut dx, mut dy) = (96u32, 96u32);
        let _ = GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        out.push(Monitor {
            bounds: mi.rcMonitor.into(),
            work: mi.rcWork.into(),
            scale: dx as f64 / 96.0,
            primary: mi.dwFlags & 1 == 1,
        });
    }
    BOOL(1)
}

pub fn monitors() -> Vec<Monitor> {
    let mut v: Vec<Monitor> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(mon_cb), LPARAM(&mut v as *mut _ as isize));
    }
    v
}

#[derive(Serialize, Clone, Debug)]
pub struct WinInfo {
    pub id: isize,
    pub title: String,
    pub rect: Rect,
    pub pid: u32,
}

fn window_title(h: HWND) -> String {
    unsafe {
        let n = GetWindowTextLengthW(h);
        if n <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; n as usize + 1];
        let len = GetWindowTextW(h, &mut buf);
        String::from_utf16_lossy(&buf[..len.max(0) as usize])
    }
}

fn window_info(h: HWND) -> Option<WinInfo> {
    unsafe {
        if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
            return None;
        }
        if GetWindowLongW(h, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
            return None;
        }
        let mut cloaked: u32 = 0;
        let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut c_void, 4);
        if cloaked != 0 {
            return None;
        }
        let title = window_title(h);
        if title.is_empty() || title == "Program Manager" {
            return None;
        }
        let mut r = RECT::default();
        DwmGetWindowAttribute(
            h,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut r as *mut _ as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
        .ok()?;
        let rect: Rect = r.into();
        if rect.w < 120 || rect.h < 80 {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, Some(&mut pid));
        Some(WinInfo { id: h.0 as isize, title, rect, pid })
    }
}

unsafe extern "system" fn win_cb(h: HWND, lp: LPARAM) -> BOOL {
    let out = &mut *(lp.0 as *mut Vec<WinInfo>);
    if let Some(w) = window_info(h) {
        out.push(w);
    }
    BOOL(1)
}

/// Visible top-level app windows in z-order (topmost first).
pub fn windows() -> Vec<WinInfo> {
    let mut v: Vec<WinInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(win_cb), LPARAM(&mut v as *mut _ as isize));
    }
    let me = std::process::id();
    v.retain(|w| w.pid != me);
    v
}

pub fn foreground() -> Option<WinInfo> {
    unsafe {
        let h = GetForegroundWindow();
        if h.0.is_null() {
            return None;
        }
        let w = window_info(h)?;
        if w.pid == std::process::id() {
            return None;
        }
        Some(w)
    }
}

// ---------------------------------------------------------------- system stats

pub struct CpuSampler {
    last: Option<(u64, u64)>, // (idle, total)
}
fn ft(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}
impl CpuSampler {
    pub fn new() -> Self {
        CpuSampler { last: None }
    }
    /// Percent CPU busy since the previous sample.
    pub fn sample(&mut self) -> f32 {
        unsafe {
            let (mut i, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
            if GetSystemTimes(Some(&mut i), Some(&mut k), Some(&mut u)).is_err() {
                return 0.0;
            }
            let idle = ft(i);
            let total = ft(k) + ft(u); // kernel time includes idle
            let pct = match self.last {
                Some((li, lt)) if total > lt => {
                    let dt = (total - lt) as f64;
                    let di = (idle - li) as f64;
                    ((1.0 - di / dt) * 100.0).clamp(0.0, 100.0) as f32
                }
                _ => 0.0,
            };
            self.last = Some((idle, total));
            pct
        }
    }
}

pub fn mem_load() -> u32 {
    unsafe {
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        if GlobalMemoryStatusEx(&mut m).is_ok() {
            m.dwMemoryLoad
        } else {
            0
        }
    }
}

/// (has_battery, percent, charging)
pub fn battery() -> (bool, u8, bool) {
    unsafe {
        let mut s = SYSTEM_POWER_STATUS::default();
        if GetSystemPowerStatus(&mut s).is_err() {
            return (false, 100, false);
        }
        let has = s.BatteryFlag != 128 && s.BatteryFlag != 255;
        let pct = if s.BatteryLifePercent == 255 { 100 } else { s.BatteryLifePercent };
        (has, pct, s.ACLineStatus == 1)
    }
}

/// True when any app is currently using the microphone (= you're in a call).
pub fn mic_in_use() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let base = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(root) =
        base.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone")
    else {
        return false;
    };
    fn active(k: &RegKey) -> bool {
        let start: u64 = k.get_value("LastUsedTimeStart").unwrap_or(0);
        let stop: u64 = k.get_value("LastUsedTimeStop").unwrap_or(1);
        start != 0 && stop == 0
    }
    for name in root.enum_keys().flatten() {
        let Ok(k) = root.open_subkey(&name) else { continue };
        if name == "NonPackaged" {
            for sub in k.enum_keys().flatten() {
                if let Ok(sk) = k.open_subkey(&sub) {
                    if active(&sk) {
                        return true;
                    }
                }
            }
        } else if active(&k) {
            return true;
        }
    }
    false
}

// ---------------------------------------------------------------- clipboard

pub fn clipboard_seq() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

const CF_UNICODETEXT: u32 = 13;

pub fn clipboard_text() -> Option<String> {
    unsafe {
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if !opened {
            return None;
        }
        let out = (|| {
            let h = GetClipboardData(CF_UNICODETEXT).ok()?;
            let g = HGLOBAL(h.0);
            let p = GlobalLock(g) as *const u16;
            if p.is_null() {
                return None;
            }
            let mut len = 0usize;
            while *p.add(len) != 0 && len < 200_000 {
                len += 1;
            }
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
            let _ = GlobalUnlock(g);
            Some(s)
        })();
        let _ = CloseClipboard();
        out
    }
}

const CF_DIB: u32 = 8;

/// The clipboard image (e.g. a fresh snip) as a complete .bmp file, if there is one.
pub fn clipboard_bmp() -> Option<Vec<u8>> {
    unsafe {
        if (0..5).all(|_| {
            let ok = OpenClipboard(None).is_ok();
            if !ok {
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
            !ok
        }) {
            return None;
        }
        let out = (|| {
            let h = GetClipboardData(CF_DIB).ok()?;
            let g = HGLOBAL(h.0);
            let size = GlobalSize(g);
            let p = GlobalLock(g) as *const u8;
            if p.is_null() || size < 40 {
                return None;
            }
            let dib = std::slice::from_raw_parts(p, size).to_vec();
            let _ = GlobalUnlock(g);
            Some(dib_to_bmp(&dib))
        })();
        let _ = CloseClipboard();
        out.flatten()
    }
}

#[cfg(test)]
pub fn dib_to_bmp_for_test(dib: &[u8]) -> Option<Vec<u8>> {
    dib_to_bmp(dib)
}

/// CF_DIB is a .bmp file without its 14-byte file header; add one.
fn dib_to_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    let u32_at = |o: usize| dib.get(o..o + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()));
    let header = u32_at(0)? as usize;
    let bits = u16::from_le_bytes(dib.get(14..16)?.try_into().ok()?) as u32;
    let compression = u32_at(16)?;
    let used = u32_at(32)?;
    let masks = if header == 40 && compression == 3 { 12 } else if header == 40 && compression == 6 { 16 } else { 0 };
    let colors: u32 = if used > 0 { used } else if bits <= 8 { 1 << bits } else { 0 };
    let palette = colors as usize * 4;
    let offset = 14 + header + masks + palette;
    let total = 14 + dib.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&(offset as u32).to_le_bytes());
    out.extend_from_slice(dib);
    Some(out)
}

pub fn set_clipboard_text(text: &str) -> bool {
    unsafe {
        if OpenClipboard(None).is_err() {
            return false;
        }
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let ok = (|| {
            EmptyClipboard().ok()?;
            let g = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2).ok()?;
            let p = GlobalLock(g) as *mut u16;
            if p.is_null() {
                return None;
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), p, wide.len());
            let _ = GlobalUnlock(g);
            SetClipboardData(CF_UNICODETEXT, Some(HANDLE(g.0))).ok()?;
            Some(())
        })()
        .is_some();
        let _ = CloseClipboard();
        ok
    }
}

// ---------------------------------------------------------------- shell

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Open a file, folder, app, URL or URI (e.g. ms-screenclip:) with the shell.
pub fn shell_open(target: &str) -> bool {
    let t = wide(target);
    let op = wide("open");
    unsafe {
        // ShellExecute needs COM on the calling thread (URI handlers like ms-screenclip:)
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let r = ShellExecuteW(None, PCWSTR(op.as_ptr()), PCWSTR(t.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
        r.0 as isize > 32
    }
}

/// Make a window never steal keyboard focus when clicked (the buddy shouldn't
/// pull you out of what you're typing in).
pub fn make_noactivate(hwnd: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowLongPtrW, GetWindowLongPtrW, WS_EX_NOACTIVATE};
    unsafe {
        let h = HWND(hwnd as *mut c_void);
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE.0 as isize);
    }
}

// ---------------------------------------------------------------- what the user is doing

/// Executable file name (e.g. "ms-teams.exe") of a process, lower-cased.
pub fn process_name(pid: u32) -> String {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return String::new();
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        full.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase()
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub playing: bool,
    pub app: String,
}

/// Current media session (Spotify, browser video, Media Player…) via the Windows
/// System Media Transport Controls. Blocking; call from a worker thread.
pub fn now_playing() -> Option<NowPlaying> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Mgr,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    let mgr = Mgr::RequestAsync().ok()?.join().ok()?;
    let s = mgr.GetCurrentSession().ok()?;
    let props = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let playing = s.GetPlaybackInfo().ok()?.PlaybackStatus().ok()? == Status::Playing;
    Some(NowPlaying {
        title: props.Title().map(|h| h.to_string()).unwrap_or_default(),
        artist: props.Artist().map(|h| h.to_string()).unwrap_or_default(),
        playing,
        app: s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default(),
    })
}
