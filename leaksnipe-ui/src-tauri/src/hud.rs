use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Serialize;
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl};

const FALLBACK_X: f64 = 120.0;
const FALLBACK_Y: f64 = 80.0;
const FALLBACK_W: f64 = 900.0;
const FALLBACK_H: f64 = 650.0;

#[derive(Clone, Serialize)]
pub struct TableBounds {
    pub hwnd: isize,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub title: String,
}

#[derive(Serialize)]
pub struct HudDiagnostics {
    pub hud_running: bool,
    pub overlay_exists: bool,
    pub is_dev: bool,
    pub table_count: u32,
    pub table_titles: Vec<String>,
    pub webview_url: String,
}

pub struct HudController {
    running: AtomicBool,
    stop_flag: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl HudController {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            stop_flag: Arc::new(AtomicBool::new(false)),
            thread: Mutex::new(None),
        }
    }
}

fn hud_webview_url() -> WebviewUrl {
    // App URL resolves via Vite dev server in debug and dist/hud.html in release.
    WebviewUrl::App("hud.html".into())
}

fn hud_webview_url_label() -> String {
    #[cfg(debug_assertions)]
    {
        "http://localhost:1420/hud.html (dev)".to_string()
    }
    #[cfg(not(debug_assertions))]
    {
        "hud.html (production)".to_string()
    }
}

fn ensure_overlay_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("live-hud").is_some() {
        return Ok(());
    }

    // On Windows, WebviewWindowBuilder::build must not run on the IPC thread (WebView2 deadlock).
    WebviewWindowBuilder::new(app, "live-hud", hud_webview_url())
        .title("LeakSnipe Live HUD")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .inner_size(FALLBACK_W, FALLBACK_H)
        .position(FALLBACK_X, FALLBACK_Y)
        .build()
        .map_err(|e| format!("Failed to create HUD overlay: {e}"))?;

    Ok(())
}

fn show_fallback_overlay(app: &AppHandle) {
    let Some(win) = app.get_webview_window("live-hud") else {
        return;
    };
    let _ = win.set_position(tauri::PhysicalPosition::new(FALLBACK_X as i32, FALLBACK_Y as i32));
    let _ = win.set_size(tauri::PhysicalSize::new(FALLBACK_W as u32, FALLBACK_H as u32));
    let _ = win.show();
    let _ = app.emit(
        "hud-status",
        "Manual overlay — snap to ACR table when detected",
    );
}

fn position_overlay(app: &AppHandle, bounds: &TableBounds) {
    let Some(win) = app.get_webview_window("live-hud") else {
        return;
    };
    // `bounds` comes straight from a raw Win32 GetWindowRect call (physical
    // pixels), so it must be applied as Physical, not Logical. Converting to
    // Logical using the *target* monitor's scale factor and then calling
    // set_position/set_size is wrong on a mixed-DPI multi-monitor setup:
    // Tauri resolves that Logical value back to physical using the window's
    // *current* monitor (wherever it was before this move), not the target
    // one, producing a cross-monitor scale mismatch and a badly offset overlay.
    let _ = win.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y));
    let _ = win.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height));
    let _ = win.show();
}

#[cfg(windows)]
fn window_looks_like_poker_table(hwnd: windows::Win32::Foundation::HWND, title: &str) -> bool {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;

    let tl = title.to_lowercase();

    const LOBBY_PATTERNS: &[&str] = &["acr poker lobby", "winning poker lobby", "coinpoker lobby"];
    if LOBBY_PATTERNS.iter().any(|lp| tl.contains(lp)) {
        return false;
    }

    // Check window class name
    let mut class_buf = vec![0u16; 256];
    let class_len = unsafe { GetClassNameW(hwnd, &mut class_buf) };
    let class_name = if class_len > 0 {
        class_buf.truncate(class_len as usize);
        OsString::from_wide(&class_buf).to_string_lossy().to_string().to_lowercase()
    } else {
        "".to_string()
    };

    if class_name == "unitywndclass" {
        // CoinPoker's Unity client never puts a per-table name in the OS window
        // title — it's the static string "CoinPoker" whether you're at the lobby
        // or seated at a table (confirmed by live capture), so title text alone
        // can't tell them apart. Reject only the rarer explicit-lobby titles,
        // accept obvious table-ish titles, and otherwise fall back to asking the
        // sidecar whether a CoinPoker hand is currently active.
        if tl == "coinpoker lobby" || tl == "lobby" {
            return false;
        }
        if tl.contains("table") || tl.contains("₮") || tl.contains("chp") || tl.contains("gtd") || tl.contains("nl") || tl.contains("pl") || tl.contains("limit") || tl.contains("#") {
            return true;
        }
        return coinpoker_table_active();
    }

    // Standard ACR matching
    const KEYWORDS: &[&str] = &[
        "hold'em",
        "holdem",
        "omaha",
        "stud",
        "acr poker",
        "americas cardroom",
        "winning poker",
        "betacr",
        "no limit",
        "pot limit",
        "fixed limit",
    ];
    if KEYWORDS.iter().any(|p| tl.contains(p)) {
        return true;
    }

    tl.contains("table") && (tl.contains("ante") || tl.contains("limit") || tl.contains("tournament"))
}

/// Asks the local Python sidecar whether a CoinPoker hand is currently active.
/// Used as the last-resort signal for CoinPoker's Unity window, whose OS title
/// never carries per-table text. Short timeouts so a slow/down sidecar can't
/// stall the window-detection poll loop; fails closed (false) on any error.
#[cfg(windows)]
fn coinpoker_table_active() -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Instant;

    let port: u16 = std::env::var("LEAKSNIPE_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8765);
    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], port)));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let req = "GET /api/live/current-hand?site=CoinPoker HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }

    let deadline = Instant::now() + Duration::from_millis(800);
    let mut body = Vec::with_capacity(512);
    let mut buf = [0u8; 512];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        let _ = stream.set_read_timeout(Some(remaining));
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                body.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&body);
                if text.contains("\"hand_id\":\"") {
                    return true;
                }
                if text.contains("\"hand_id\":null") {
                    return false;
                }
                if body.len() >= 4096 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    false
}

#[cfg(windows)]
fn collect_table_windows() -> Vec<TableBounds> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
    };

    struct Search {
        tables: Vec<TableBounds>,
        lobbies: Vec<TableBounds>,
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam.0 as *mut Search);
        if IsWindowVisible(hwnd).as_bool() == false {
            return BOOL(1);
        }

        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return BOOL(1);
        }

        let mut buf = vec![0u16; (len + 1) as usize];
        let read = GetWindowTextW(hwnd, &mut buf);
        if read == 0 {
            return BOOL(1);
        }
        buf.truncate(read as usize);
        let title = OsString::from_wide(&buf).to_string_lossy().to_string();

        if !window_looks_like_poker_table(hwnd, &title) {
            return BOOL(1);
        }

        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return BOOL(1);
        }

        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        if w < 150 || h < 100 {
            return BOOL(1);
        }

        let entry = TableBounds {
            hwnd: hwnd.0 as isize,
            x: rect.left,
            y: rect.top,
            width: w as u32,
            height: h as u32,
            title,
        };

        let tl = entry.title.to_lowercase();
        if tl.contains("lobby") {
            search.lobbies.push(entry);
        } else {
            search.tables.push(entry);
        }

        BOOL(1)
    }

    let mut search = Search {
        tables: Vec::new(),
        lobbies: Vec::new(),
    };

    unsafe {
        let _ = EnumWindows(
            Some(enum_cb),
            LPARAM(&mut search as *mut Search as isize),
        );
    }

    if !search.tables.is_empty() {
        return search.tables;
    }
    search.lobbies
}

#[cfg(not(windows))]
fn collect_table_windows() -> Vec<TableBounds> {
    Vec::new()
}

#[cfg(windows)]
fn find_primary_table() -> Option<TableBounds> {
    collect_table_windows().into_iter().next()
}

#[cfg(not(windows))]
fn find_primary_table() -> Option<TableBounds> {
    None
}

/// True when the table (or the HUD overlay itself, e.g. while the user is
/// dragging badges in layout mode) currently owns the foreground. Anything
/// else — alt-tabbing to Grok, a browser, another app — should not have the
/// always-on-top overlay drawn over it.
#[cfg(windows)]
fn target_has_foreground(table_hwnd: isize, overlay_hwnd: Option<isize>) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let fg = unsafe { GetForegroundWindow() };
    if fg == HWND(0 as _) {
        return false;
    }
    let fg_isize = fg.0 as isize;
    fg_isize == table_hwnd || overlay_hwnd.map(|h| h == fg_isize).unwrap_or(false)
}

#[cfg(not(windows))]
fn target_has_foreground(_table_hwnd: isize, _overlay_hwnd: Option<isize>) -> bool {
    true
}

#[cfg(windows)]
fn overlay_hwnd(app: &AppHandle) -> Option<isize> {
    app.get_webview_window("live-hud")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize)
}

#[cfg(not(windows))]
fn overlay_hwnd(_app: &AppHandle) -> Option<isize> {
    None
}

// Foreground/focus is checked every tick (cheap: one Win32 call) so the
// overlay disappears the moment you alt-tab away; the full window-enumeration
// table search only needs to happen every FULL_SCAN_EVERY_TICKS ticks.
const FOCUS_TICK_MS: u64 = 350;
const FULL_SCAN_EVERY_TICKS: u32 = 4; // ~1.4s, matches the old fixed interval

fn detection_loop(app: AppHandle, stop_flag: Arc<AtomicBool>) {
    let mut last: Option<TableBounds> = None;
    let mut misses: u32 = 0;
    let mut tick: u32 = 0;
    let mut overlay_shown = false;

    while !stop_flag.load(Ordering::SeqCst) {
        if tick % FULL_SCAN_EVERY_TICKS == 0 {
            if let Some(bounds) = find_primary_table() {
                misses = 0;
                let changed = last
                    .as_ref()
                    .map(|p| {
                        p.x != bounds.x
                            || p.y != bounds.y
                            || p.width != bounds.width
                            || p.height != bounds.height
                            || p.hwnd != bounds.hwnd
                    })
                    .unwrap_or(true);

                if changed {
                    let _ = app.emit("hud-table-bounds", &bounds);
                }
                last = Some(bounds);
            } else {
                last = None;
                misses += 1;
                if misses == 1 || misses % 10 == 0 {
                    let _ = app.emit(
                        "hud-status",
                        "No ACR table detected — showing manual overlay",
                    );
                }
            }
        }
        tick = tick.wrapping_add(1);

        match &last {
            Some(bounds) => {
                let ohwnd = overlay_hwnd(&app);
                if target_has_foreground(bounds.hwnd, ohwnd) {
                    if !overlay_shown {
                        position_overlay(&app, bounds);
                        overlay_shown = true;
                    }
                } else if overlay_shown {
                    if let Some(win) = app.get_webview_window("live-hud") {
                        let _ = win.hide();
                    }
                    overlay_shown = false;
                }
            }
            None => {
                if overlay_shown {
                    if let Some(win) = app.get_webview_window("live-hud") {
                        let _ = win.hide();
                    }
                    overlay_shown = false;
                }
            }
        }

        thread::sleep(Duration::from_millis(FOCUS_TICK_MS));
    }
}

async fn create_overlay_off_ipc_thread(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_overlay_window(&app)?;
        show_fallback_overlay(&app);
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("HUD window thread failed: {e}"))?
}

#[tauri::command]
pub async fn hud_start(app: AppHandle, hud: State<'_, HudController>) -> Result<(), String> {
    if hud.running.load(Ordering::SeqCst) {
        if app.get_webview_window("live-hud").is_some() {
            show_fallback_overlay(&app);
        } else {
            create_overlay_off_ipc_thread(app.clone()).await?;
        }
        return Ok(());
    }

    create_overlay_off_ipc_thread(app.clone()).await?;

    hud.stop_flag.store(false, Ordering::SeqCst);
    hud.running.store(true, Ordering::SeqCst);

    let stop_flag = hud.stop_flag.clone();
    let app_handle = app.clone();
    let handle = thread::spawn(move || detection_loop(app_handle, stop_flag));

    if let Ok(mut guard) = hud.thread.lock() {
        *guard = Some(handle);
    }

    Ok(())
}

#[tauri::command]
pub fn hud_stop(app: AppHandle, hud: State<'_, HudController>) -> Result<(), String> {
    hud.stop_flag.store(true, Ordering::SeqCst);
    hud.running.store(false, Ordering::SeqCst);

    if let Ok(mut guard) = hud.thread.lock() {
        if let Some(handle) = guard.take() {
            let _ = handle.join();
        }
    }

    if let Some(win) = app.get_webview_window("live-hud") {
        let _ = win.hide();
    }

    Ok(())
}

#[tauri::command]
pub fn hud_is_running(hud: State<'_, HudController>) -> bool {
    hud.running.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn hud_diagnose(app: AppHandle, hud: State<'_, HudController>) -> HudDiagnostics {
    let tables = collect_table_windows();
    HudDiagnostics {
        hud_running: hud.running.load(Ordering::SeqCst),
        overlay_exists: app.get_webview_window("live-hud").is_some(),
        is_dev: cfg!(debug_assertions),
        table_count: tables.len() as u32,
        table_titles: tables.into_iter().map(|t| t.title).collect(),
        webview_url: hud_webview_url_label(),
    }
}
