mod win;

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

// ------------------------------------------------------------------ shared state

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeepCfg {
    pub enabled: bool,
    pub threshold_s: u64,
    pub work_hours_only: bool,
    pub days: [bool; 7], // Sun..Sat
    pub start_min: u16,
    pub end_min: u16,
    pub pause_in_call: bool,
}
impl Default for KeepCfg {
    fn default() -> Self {
        KeepCfg {
            enabled: true,
            threshold_s: 210,
            work_hours_only: true,
            days: [false, true, true, true, true, true, false],
            start_min: 9 * 60,
            end_min: 18 * 60,
            pause_in_call: true,
        }
    }
}
impl KeepCfg {
    fn in_hours(&self) -> bool {
        if !self.work_hours_only {
            return true;
        }
        let (dow, h, m) = win::local_time();
        let now = h * 60 + m;
        self.days[dow as usize % 7]
            && if self.start_min <= self.end_min { now >= self.start_min && now < self.end_min } else { now >= self.start_min || now < self.end_min }
    }
}

#[derive(Default)]
struct HitBox {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    lock: bool, // force interactive (dragging, menu open)
}

pub struct Shared {
    keep: Mutex<KeepCfg>,
    hit: Mutex<HitBox>,
    nudge_pending: Mutex<Option<Instant>>,
    clip: Mutex<VecDeque<String>>,
    clip_skip_seq: AtomicU32,
    visible: AtomicBool,
    tray_keep: Mutex<Option<CheckMenuItem<Wry>>>,
    tray_dnd: Mutex<Option<CheckMenuItem<Wry>>>,
    tray_hide: Mutex<Option<MenuItem<Wry>>>,
}

type St<'a> = tauri::State<'a, Arc<Shared>>;

// ------------------------------------------------------------------ commands

#[tauri::command]
fn set_hitbox(st: St, x: f64, y: f64, w: f64, h: f64, lock: bool) {
    *st.hit.lock().unwrap() = HitBox { x, y, w, h, lock };
}

#[tauri::command]
fn set_keepalive(app: AppHandle, st: St, cfg: KeepCfg) {
    if let Some(item) = st.tray_keep.lock().unwrap().as_ref() {
        let _ = item.set_checked(cfg.enabled);
    }
    *st.keep.lock().unwrap() = cfg;
    let _ = app.emit("keepalive-config", st.keep.lock().unwrap().clone());
}

#[tauri::command]
fn get_keepalive(st: St) -> KeepCfg {
    st.keep.lock().unwrap().clone()
}

/// Called by the buddy at the moment its hands "push" the cursor.
#[tauri::command]
fn do_nudge(st: St) {
    win::nudge_input();
    *st.nudge_pending.lock().unwrap() = None;
}

#[tauri::command]
fn get_monitors() -> Vec<win::Monitor> {
    win::monitors()
}

/// Save an image the panel rendered (the daily comic) into Pictures\Deskbud. Returns the full path.
#[tauri::command]
fn save_png(name: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir = win::pictures_dir().join("Deskbud");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(60).collect();
    let path = dir.join(format!("{}.png", if safe.is_empty() { "deskbud-comic".to_string() } else { safe }));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_taskbars() -> Vec<win::Rect> {
    win::taskbars()
}

#[tauri::command]
fn get_windows() -> Vec<win::WinInfo> {
    win::windows()
}

#[tauri::command]
fn get_foreground() -> Option<win::WinInfo> {
    win::foreground()
}

#[tauri::command]
fn get_cursor() -> (i32, i32) {
    win::cursor_pos()
}

#[tauri::command]
fn clip_history(st: St) -> Vec<String> {
    st.clip.lock().unwrap().iter().cloned().collect()
}

#[tauri::command]
fn clip_set(st: St, text: String) -> bool {
    let ok = win::set_clipboard_text(&text);
    // Don't re-record our own write as a new copy.
    st.clip_skip_seq.store(win::clipboard_seq(), Ordering::Relaxed);
    if ok {
        let mut c = st.clip.lock().unwrap();
        c.retain(|s| s != &text);
        c.push_front(text);
    }
    ok
}

#[tauri::command]
fn clip_remove(st: St, text: Option<String>) {
    let mut c = st.clip.lock().unwrap();
    match text {
        Some(t) => c.retain(|s| s != &t),
        None => c.clear(),
    }
}

// async = runs off the main thread (ShellExecute can block briefly)
#[tauri::command]
async fn shell_open(target: String) -> bool {
    win::shell_open(&target)
}

// Must be async: creating a window from a sync command deadlocks WebView2 on Windows.
#[tauri::command]
async fn open_panel(app: AppHandle, tab: String) {
    open_panel_inner(&app, &tab);
}

#[tauri::command]
fn set_buddy_visible(app: AppHandle, st: St, visible: bool) {
    apply_visibility(&app, &st, visible);
}

#[tauri::command]
fn set_dnd(st: St, on: bool) {
    if let Some(i) = st.tray_dnd.lock().unwrap().as_ref() {
        let _ = i.set_checked(on);
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// ------------------------------------------------------------------ helpers

fn apply_visibility(app: &AppHandle, st: &Shared, visible: bool) {
    st.visible.store(visible, Ordering::Relaxed);
    if let Some(w) = app.get_webview_window("main") {
        if visible {
            let _ = w.show();
        } else {
            let _ = w.hide();
        }
    }
    if let Some(i) = st.tray_hide.lock().unwrap().as_ref() {
        let _ = i.set_text(if visible { "Hide buddy" } else { "Show buddy" });
    }
    let _ = app.emit("visibility", visible);
}

fn open_panel_inner(app: &AppHandle, tab: &str) {
    if let Some(w) = app.get_webview_window("panel") {
        let _ = app.emit_to("panel", "tab", tab.to_string());
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // Build on a worker thread: from the tray/hotkey handlers (main thread) or a
    // command, building the WebView2 window synchronously can deadlock on Windows.
    static OPENING: AtomicBool = AtomicBool::new(false);
    if OPENING.swap(true, Ordering::SeqCst) {
        return; // a panel is already being created (double click)
    }
    let app = app.clone();
    let url = format!("panel.html#{tab}");
    std::thread::spawn(move || {
        let res = WebviewWindowBuilder::new(&app, "panel", WebviewUrl::App(url.into()))
            .title("Deskbud")
            .inner_size(440.0, 600.0)
            .min_inner_size(360.0, 420.0)
            .decorations(false)
            .shadow(true)
            .center()
            .always_on_top(false)
            .visible(false)
            .build();
        if let Err(e) = res {
            eprintln!("panel: {e}");
        }
        OPENING.store(false, Ordering::SeqCst);
    });
}

// ------------------------------------------------------------------ background workers

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Presence {
    idle_ms: u64,
    locked: bool,
    fullscreen: bool,
    in_call: bool,
    keepalive: bool,
    in_hours: bool,
}

/// Idle / lock / fullscreen / call detection + keep-alive scheduling.
fn presence_worker(app: AppHandle, st: Arc<Shared>) {
    std::thread::spawn(move || {
        let mut tick: u64 = 0;
        let mut last_call = false;
        loop {
            // 1s cadence while a nudge is pending, otherwise 5s.
            let pending = *st.nudge_pending.lock().unwrap();
            std::thread::sleep(Duration::from_secs(if pending.is_some() { 1 } else { 5 }));
            tick += 1;

            let idle_ms = win::idle_ms();
            let locked = win::is_locked();
            let fullscreen = !locked && win::is_fullscreen_busy();
            // Registry scan is cheap but no need every second.
            let in_call = if pending.is_none() || tick % 5 == 0 { win::mic_in_use() } else { last_call };
            last_call = in_call;
            let cfg = st.keep.lock().unwrap().clone();
            let in_hours = cfg.in_hours();

            let _ = app.emit(
                "presence",
                Presence { idle_ms, locked, fullscreen, in_call, keepalive: cfg.enabled, in_hours },
            );

            let should = cfg.enabled
                && in_hours
                && !locked
                && !(cfg.pause_in_call && in_call)
                && idle_ms >= cfg.threshold_s * 1000;

            let mut p = st.nudge_pending.lock().unwrap();
            if !should {
                *p = None;
                continue;
            }
            match *p {
                None => {
                    *p = Some(Instant::now());
                    // Ask the buddy to do it with an animation. If it's hidden,
                    // busy, or doesn't answer in time, we do it silently below.
                    if st.visible.load(Ordering::Relaxed) && !fullscreen {
                        let _ = app.emit_to("main", "nudge-request", ());
                    }
                }
                Some(t) if t.elapsed() > Duration::from_secs(12) || !st.visible.load(Ordering::Relaxed) || fullscreen => {
                    win::nudge_input();
                    *p = None;
                    let _ = app.emit("nudge-done", true);
                }
                _ => {}
            }
        }
    });
}

/// Cursor position for eye tracking + click-through toggling.
fn cursor_worker(app: AppHandle, st: Arc<Shared>) {
    std::thread::spawn(move || {
        let mut last = (i32::MIN, i32::MIN);
        let mut ignoring: Option<bool> = None;
        let mut n: u32 = 0;
        let mut bars = String::new();
        loop {
            let visible = st.visible.load(Ordering::Relaxed);
            std::thread::sleep(Duration::from_millis(if visible { 40 } else { 500 }));
            if !visible {
                continue;
            }
            let (x, y) = win::cursor_pos();
            let inside = {
                let h = st.hit.lock().unwrap();
                h.lock
                    || (x as f64 >= h.x && x as f64 <= h.x + h.w && y as f64 >= h.y && y as f64 <= h.y + h.h)
            };
            if ignoring != Some(!inside) {
                if let Some(w) = app.get_webview_window("main") {
                    if w.set_ignore_cursor_events(!inside).is_ok() {
                        ignoring = Some(!inside);
                    }
                }
            }
            if (x, y) != last {
                last = (x, y);
                let _ = app.emit_to("main", "cursor", (x, y));
            }
            // auto-hide taskbars slide in and out: tell the buddy so it can hop on / drop down
            n = n.wrapping_add(1);
            if n % 3 == 0 {
                let tb = win::taskbars();
                let key = format!("{:?}", tb);
                if key != bars {
                    bars = key;
                    let _ = app.emit_to("main", "taskbars", tb);
                }
            }
        }
    });
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SysStats {
    cpu: f32,
    mem: u32,
    has_battery: bool,
    battery: u8,
    charging: bool,
}

fn sysmon_worker(app: AppHandle) {
    std::thread::spawn(move || {
        let mut cpu = win::CpuSampler::new();
        cpu.sample();
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let (has_battery, battery, charging) = win::battery();
            let _ = app.emit(
                "sysmon",
                SysStats { cpu: cpu.sample(), mem: win::mem_load(), has_battery, battery, charging },
            );
        }
    });
}

#[derive(Serialize, Clone)]
struct Foreground {
    id: isize,
    title: String,
    exe: String,
    rect: win::Rect,
}

/// What you're doing: foreground app (+ its rect, so the buddy can glance at it or notice
/// when a window lands on top of it) every 0.7s, and the media session every 5s.
/// Events are only emitted on change.
fn awareness_worker(app: AppHandle, st: Arc<Shared>) {
    std::thread::spawn(move || {
        let mut last_fg: Option<Foreground> = None;
        let mut exe_cache: (isize, String) = (0, String::new());
        let mut last_media: Option<win::NowPlaying> = None;
        let mut tick: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(700));
            tick = tick.wrapping_add(1);
            if !st.visible.load(Ordering::Relaxed) {
                continue;
            }
            let fg = win::foreground().map(|w| {
                if exe_cache.0 != w.id {
                    exe_cache = (w.id, win::process_name(w.pid));
                }
                Foreground { id: w.id, title: w.title, exe: exe_cache.1.clone(), rect: w.rect }
            });
            let changed = match (&fg, &last_fg) {
                (Some(a), Some(b)) => {
                    a.id != b.id || a.title != b.title || (a.rect.x, a.rect.y, a.rect.w, a.rect.h) != (b.rect.x, b.rect.y, b.rect.w, b.rect.h)
                }
                (None, None) => false,
                _ => true,
            };
            if changed {
                if let Some(f) = &fg {
                    let _ = app.emit_to("main", "fg", f.clone());
                }
                last_fg = fg;
            }
            if tick % 7 == 0 {
                let m = win::now_playing();
                if m != last_media {
                    let _ = app.emit_to("main", "media", m.clone());
                    last_media = m;
                }
            }
        }
    });
}

fn clipboard_worker(app: AppHandle, st: Arc<Shared>) {
    std::thread::spawn(move || {
        let mut last = win::clipboard_seq();
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let seq = win::clipboard_seq();
            if seq == last {
                continue;
            }
            last = seq;
            if st.clip_skip_seq.load(Ordering::Relaxed) == seq {
                continue;
            }
            let Some(text) = win::clipboard_text() else { continue };
            if text.trim().is_empty() {
                continue;
            }
            {
                let mut c = st.clip.lock().unwrap();
                c.retain(|s| s != &text);
                c.push_front(text.clone());
                c.truncate(30);
            }
            let preview: String = text.chars().take(80).collect();
            let _ = app.emit("clipboard", preview);
        }
    });
}

// ------------------------------------------------------------------ tray

fn build_tray(app: &AppHandle, st: &Arc<Shared>) -> tauri::Result<()> {
    let keep = CheckMenuItem::with_id(app, "keep", "Keep Teams green", true, true, None::<&str>)?;
    let dnd = CheckMenuItem::with_id(app, "dnd", "Do not disturb", true, false, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide buddy", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &keep,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "focus", "Focus timer", true, None::<&str>)?,
            &MenuItem::with_id(app, "reminders", "Reminders", true, None::<&str>)?,
            &MenuItem::with_id(app, "notes", "Notes", true, None::<&str>)?,
            &MenuItem::with_id(app, "clipboard", "Clipboard history", true, None::<&str>)?,
            &MenuItem::with_id(app, "launcher", "Launcher (Ctrl+Alt+Space)", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &hide,
            &MenuItem::with_id(app, "shh", "Shh for 1 hour", true, None::<&str>)?,
            &dnd,
            &MenuItem::with_id(app, "settings", "Settings && looks", true, None::<&str>)?,
            &MenuItem::with_id(app, "lab", "Animation lab", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit Deskbud", true, None::<&str>)?,
        ],
    )?;
    *st.tray_keep.lock().unwrap() = Some(keep);
    *st.tray_dnd.lock().unwrap() = Some(dnd);
    *st.tray_hide.lock().unwrap() = Some(hide);

    let st2 = st.clone();
    TrayIconBuilder::with_id("deskbud")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Deskbud")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, ev| {
            let id = ev.id().as_ref();
            match id {
                "quit" => app.exit(0),
                "hide" => {
                    let v = !st2.visible.load(Ordering::Relaxed);
                    apply_visibility(app, &st2, v);
                }
                "keep" => {
                    let enabled = {
                        let mut k = st2.keep.lock().unwrap();
                        k.enabled = !k.enabled;
                        k.enabled
                    };
                    let _ = app.emit("keepalive-toggled", enabled);
                }
                "dnd" | "shh" => {
                    let _ = app.emit("tray", id);
                }
                "focus" | "reminders" | "notes" | "clipboard" | "launcher" | "settings" | "lab" => {
                    open_panel_inner(app, id)
                }
                _ => {}
            }
        })
        .on_tray_icon_event(move |tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                let app = tray.app_handle();
                let st = app.state::<Arc<Shared>>();
                if !st.visible.load(Ordering::Relaxed) {
                    apply_visibility(app, &st, true);
                }
                let _ = app.emit_to("main", "tray", "summon");
            }
        })
        .build(app)?;
    Ok(())
}

// ------------------------------------------------------------------ entry

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared = Arc::new(Shared {
        keep: Mutex::new(KeepCfg::default()),
        hit: Mutex::new(HitBox::default()),
        nudge_pending: Mutex::new(None),
        clip: Mutex::new(VecDeque::new()),
        clip_skip_seq: AtomicU32::new(0),
        visible: AtomicBool::new(true),
        tray_keep: Mutex::new(None),
        tray_dnd: Mutex::new(None),
        tray_hide: Mutex::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.emit_to("main", "tray", "summon");
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(shared.clone())
        .invoke_handler(tauri::generate_handler![
            set_hitbox,
            set_keepalive,
            get_keepalive,
            do_nudge,
            get_monitors,
            get_taskbars,
            save_png,
            get_windows,
            get_foreground,
            get_cursor,
            clip_history,
            clip_set,
            clip_remove,
            shell_open,
            open_panel,
            set_buddy_visible,
            set_dnd,
            quit
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            if let Some(w) = app.get_webview_window("main") {
                if let Ok(h) = w.hwnd() {
                    win::make_noactivate(h.0 as isize);
                }
            }

            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
                handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, _sc, ev| {
                            if ev.state() == ShortcutState::Pressed {
                                open_panel_inner(app, "launcher");
                            }
                        })
                        .build(),
                )?;
                let sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
                if let Err(e) = handle.global_shortcut().register(sc) {
                    eprintln!("hotkey: {e}");
                }
            }

            build_tray(&handle, &shared)?;
            presence_worker(handle.clone(), shared.clone());
            cursor_worker(handle.clone(), shared.clone());
            sysmon_worker(handle.clone());
            clipboard_worker(handle.clone(), shared.clone());
            awareness_worker(handle.clone(), shared.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running deskbud");
}
