//! Thin, safe-ish wrappers around the Win32 calls Deskbud needs.
#![allow(clippy::missing_safety_doc)]

use serde::Serialize;
use std::ffi::c_void;
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{FILETIME, HANDLE, HGLOBAL, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
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
    ShellExecuteW, SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetCursorPos, GetForegroundWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, SW_SHOWNORMAL, WS_EX_TOOLWINDOW,
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
pub fn is_fullscreen_busy() -> bool {
    unsafe {
        match SHQueryUserNotificationState() {
            Ok(s) => s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE,
            Err(_) => false,
        }
    }
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
