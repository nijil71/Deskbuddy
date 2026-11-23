// Two bits of input plumbing for the interactive buddy:
//
//  • Typing rhythm: a Raw Input sink counts *how many* keys go down so the buddy can type along.
//    It never looks at which key it is beyond dropping auto-repeat, never stores anything, and only
//    emits a number every 250 ms. Injected input (our own F15 keep-alive, automation tools) is
//    ignored. Off → the raw-input registration is removed, so Windows stops sending us anything.
//
//  • Dropped files: WebView2's HTML drag-and-drop gives the page File objects without paths.
//    The page hands them back through `postMessageWithAdditionalObjects`, and WebView2 reveals the
//    real path to the host (here). We send those paths back to the page.

use std::ffi::c_void;
use std::sync::atomic::{AtomicU16, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, SetTimer,
    HWND_MESSAGE, MSG, RI_KEY_BREAK, WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT, WM_TIMER, WNDCLASSW,
};

static KEYS: AtomicU32 = AtomicU32::new(0);
static HELD: AtomicU16 = AtomicU16::new(0); // last key down (only to drop auto-repeat)

unsafe extern "system" fn wndproc(h: HWND, m: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if m == WM_INPUT {
        let mut ri = RAWINPUT::default();
        let mut sz = std::mem::size_of::<RAWINPUT>() as u32;
        let n = unsafe {
            GetRawInputData(
                HRAWINPUT(lp.0 as *mut c_void),
                RID_INPUT,
                Some(&mut ri as *mut RAWINPUT as *mut c_void),
                &mut sz,
                std::mem::size_of::<RAWINPUTHEADER>() as u32,
            )
        };
        // hDevice is null for injected input (SendInput) → not you typing
        if n != u32::MAX && ri.header.dwType == RIM_TYPEKEYBOARD.0 && !ri.header.hDevice.0.is_null() {
            let kb = unsafe { ri.data.keyboard };
            let up = (kb.Flags as u32) & RI_KEY_BREAK != 0;
            if up {
                let _ = HELD.compare_exchange(kb.VKey, 0, Ordering::Relaxed, Ordering::Relaxed);
            } else if HELD.swap(kb.VKey, Ordering::Relaxed) != kb.VKey {
                KEYS.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
    unsafe { DefWindowProcW(h, m, wp, lp) }
}

fn register(hwnd: HWND, on: bool) -> bool {
    let dev = RAWINPUTDEVICE {
        usUsagePage: 0x01,
        usUsage: 0x06, // keyboard
        dwFlags: if on { RIDEV_INPUTSINK } else { RIDEV_REMOVE },
        hwndTarget: if on { hwnd } else { HWND::default() },
    };
    unsafe { RegisterRawInputDevices(&[dev], std::mem::size_of::<RAWINPUTDEVICE>() as u32).is_ok() }
}

/// Counts keystrokes while `on` and the buddy is `visible`; emits "keys" (count per 250 ms).
pub fn typing_worker(app: AppHandle, st: Arc<crate::Shared>) {
    std::thread::spawn(move || unsafe {
        let class = w!("DeskbudKeys");
        let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), lpszClassName: class, ..Default::default() };
        RegisterClassW(&wc);
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE::default(), class, w!(""), WINDOW_STYLE::default(),
            0, 0, 0, 0, Some(HWND_MESSAGE), None, None, None,
        ) else {
            return;
        };
        SetTimer(Some(hwnd), 1, 250, None);
        let mut registered = false;
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.message == WM_TIMER {
                let want = st.typing.load(Ordering::Relaxed) && st.visible.load(Ordering::Relaxed);
                if want != registered && register(hwnd, want) {
                    registered = want;
                }
                let n = KEYS.swap(0, Ordering::Relaxed);
                if n > 0 && registered {
                    let _ = app.emit_to("main", "keys", n);
                }
                continue;
            }
            DispatchMessageW(&msg);
        }
    });
}

/// Listen for `chrome.webview.postMessageWithAdditionalObjects(…, files)` and emit their paths.
pub fn hook_drop_paths(app: &AppHandle) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
    };
    use windows::core::{Interface, PWSTR};
    let Some(w) = app.get_webview_window("main") else { return };
    let h = app.clone();
    let _ = w.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        let handler = webview2_com::WebMessageReceivedEventHandler::create(Box::new(move |_wv, args| {
            let Some(args) = args else { return Ok(()) };
            let Ok(a2) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else { return Ok(()) };
            let Ok(col) = a2.AdditionalObjects() else { return Ok(()) };
            let mut n = 0u32;
            if col.Count(&mut n).is_err() || n == 0 {
                return Ok(());
            }
            let mut paths = Vec::new();
            for i in 0..n.min(32) {
                let Ok(obj) = col.GetValueAtIndex(i) else { continue };
                let Ok(f) = obj.cast::<ICoreWebView2File>() else { continue };
                let mut p = PWSTR::null();
                if f.Path(&mut p).is_ok() && !p.is_null() {
                    paths.push(webview2_com::take_pwstr(p));
                }
            }
            if !paths.is_empty() {
                let _ = h.emit_to("main", "drop-paths", paths);
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}
