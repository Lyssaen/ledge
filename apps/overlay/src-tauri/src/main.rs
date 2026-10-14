#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Emitted when a mouse button goes down outside the overlay window while the outside watch is armed; no payload.
pub const OUTSIDE_CLICK_EVENT: &str = "ledge://outside-click";
/// Cursor positions near the notch, including while outside the webview. `null` ends the proximity gesture.
pub const CURSOR_NEAR_EVENT: &str = "ledge://cursor-near";
/// Emitted when a maximised (or monitor-covering) window takes or leaves the foreground: `{ covered }`.
pub const FOREGROUND_EVENT: &str = "ledge://foreground";
/// How far from the island (logical px) the poller still reports the cursor: the hot band's 40 px overhang plus
/// the mascot's 140 px gaze reach, with margin.
const NEAR_REACH: f64 = 170.0;
/// The poller checks the foreground window every this many ticks (500 ms at the idle cadence, less near the drawing).
const FOREGROUND_TICKS: u32 = 10;
const CURSOR_POLL: Duration = Duration::from_millis(50);
/// The cadence while the cursor is within `NEAR_RECT_REACH` of the drawn rectangle: the window must take the mouse
/// before a press lands on the island, so the hand-over is decided within a frame interval there.
const NEAR_POLL: Duration = Duration::from_millis(16);
/// How far from the drawn rectangle (logical px) the fast cadence starts.
const NEAR_RECT_REACH: f64 = 40.0;
/// Re-read the chosen monitor every 40 polls (2 s): resolution, scale or taskbar changes are picked up.
const MONITOR_REFRESH_TICKS: u32 = 40;
/// Whether a press outside the window folds the open panel: armed by the webview while a panel shows. The window never
/// takes focus on a mouse open, so a click elsewhere gives the webview no blur to react to.
#[derive(Default)]
struct OutsideWatch(AtomicBool);

/// The window that was in the foreground when a keyboard open took focus (a raw HWND), handed back by `release_focus`.
#[derive(Default)]
struct PrevForeground(Mutex<Option<isize>>);

/// The Screen setting: the id of the monitor the overlay lives on (`None`: the primary), a generation bumped on every
/// change so the poller re-reads its monitor at once, the last frame the webview asked for (re-applied on a change)
/// and the window rectangle last placed.
#[derive(Default)]
struct Screen(Mutex<ScreenState>);
#[derive(Default)]
struct ScreenState {
    chosen: Option<String>,
    gen: u64,
    last_frame: Option<(i32, i32, u32, u32)>,
    /// The window rectangle last placed (physical px): the whole work area of the chosen monitor. The window is
    /// placed once and again only when that area changes; the frame only sets its region.
    placed: Option<(i32, i32, u32, u32)>,
    /// The island's x range in logical px (`set_hot_zone`): the poller watches the top band around it.
    hot: Option<(i32, u32)>,
    /// Set by `set_hot_zone` (the webview just mounted or reloaded): the next foreground check emits its state even
    /// when it did not change, so a window already covering the screen at launch is reported.
    foreground_dirty: bool,
}

/// One monitor as the Settings view lists it: logical sizes, the work area's height, whether it is the primary.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MonitorInfo {
    pub id: String,
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "workH")]
    pub work_h: u32,
    #[serde(rename = "workW")]
    pub work_w: u32,
    pub primary: bool,
}

/// The tray menu items, kept so the webview can give them the overlay's language.
struct Tray { open: MenuItem<Wry>, new_session: MenuItem<Wry>, dnd: MenuItem<Wry>, quit: MenuItem<Wry> }
const TRAY_EVENT: &str = "ledge://tray";
const TRAY_OPEN: &str = "open";
const TRAY_NEW: &str = "new";
const TRAY_DND: &str = "dnd";
const TRAY_QUIT: &str = "quit";

#[derive(Clone, Serialize)]
struct TrayPayload { action: &'static str }

/// The tray's tooltip and the title of its menu: the product, its version, and `(dev)` for a debug build, so an
/// installed Ledge and a `tauri dev` one running side by side can be told apart.
pub fn tray_title(version: &str, debug: bool) -> String {
    if debug { format!("Ledge {version} (dev)") } else { format!("Ledge {version}") }
}

#[derive(Clone, Serialize)]
struct CursorPayload { x: f64, y: f64 }

#[derive(Clone, Serialize)]
struct ForegroundPayload { covered: bool }

/// The chosen monitor in physical px: its work area and its scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}

fn area_of(m: &tauri::window::Monitor) -> Area {
    let wa = m.work_area();
    Area { x: wa.position.x, y: wa.position.y, w: wa.size.width, h: wa.size.height, scale: m.scale_factor() }
}

/// A monitor's stable id: its name (`\\.\DISPLAY1` on Windows), or its index when the OS gives none.
fn monitor_id(m: &tauri::window::Monitor, index: usize) -> String {
    m.name().cloned().unwrap_or_else(|| format!("#{index}"))
}

/// The index of the monitor to use: `chosen` while it is plugged in, otherwise the primary.
pub fn choose(chosen: Option<&str>, ids: &[String], primary: usize) -> usize {
    chosen.and_then(|c| ids.iter().position(|id| id == c)).unwrap_or(primary)
}

/// Every monitor, with the index of the primary one (0 when the OS reports none).
fn monitors(app: &AppHandle) -> (Vec<tauri::window::Monitor>, usize) {
    let all = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let index = primary.and_then(|p| all.iter().position(|m| m.position() == p.position())).unwrap_or(0);
    (all, index)
}

/// The monitor the overlay lives on: the chosen one when present, else the primary.
fn target_monitor(app: &AppHandle, chosen: Option<&str>) -> Option<tauri::window::Monitor> {
    let (all, primary) = monitors(app);
    if all.is_empty() { return None; }
    let ids: Vec<String> = all.iter().enumerate().map(|(i, m)| monitor_id(m, i)).collect();
    all.into_iter().nth(choose(chosen, &ids, primary))
}

fn chosen_of(screen: &Screen) -> Option<String> {
    screen.0.lock().ok().and_then(|s| s.chosen.clone())
}

fn target_area(app: &AppHandle, screen: &Screen) -> Area {
    target_monitor(app, chosen_of(screen).as_deref()).map(|m| area_of(&m)).unwrap_or(Area { x: 0, y: 0, w: 1920, h: 1080, scale: 1.0 })
}

/// Physical position and size of a frame given in logical px relative to the work area's top-left corner.
pub fn frame_rect(area: Area, left: i32, top: i32, width: u32, height: u32) -> (i32, i32, u32, u32) {
    let s = area.scale;
    (
        area.x + (left as f64 * s).round() as i32,
        area.y + (top as f64 * s).round() as i32,
        (width as f64 * s).round() as u32,
        (height as f64 * s).round() as u32,
    )
}

/// The window rectangle in physical px: the whole work area of the chosen monitor.
pub fn window_rect_of(area: Area) -> (i32, i32, u32, u32) { (area.x, area.y, area.w, area.h) }

/// True when the logical cursor `(x, y)` is in the band along the top edge around the island `hot = (left, width)`,
/// within `NEAR_REACH` of it: the hot band that opens the list and the region the mascot's gaze follows.
pub fn cursor_near(hot: Option<(i32, u32)>, x: f64, y: f64) -> bool {
    let Some((left, width)) = hot else { return false };
    y >= 0.0 && y <= NEAR_REACH && x >= left as f64 - NEAR_REACH && x <= (left + width as i32) as f64 + NEAR_REACH
}

/// True when the window rectangle holds the whole monitor rectangle (a full-screen or maximised window).
pub fn covers(win: (i32, i32, i32, i32), mon: (i32, i32, i32, i32)) -> bool {
    win.0 <= mon.0 && win.1 <= mon.1 && win.2 >= mon.2 && win.3 >= mon.3
}

/// True when the physical `cursor` is in the rectangle `(x, y, width, height)`; the right and bottom edges are exclusive.
pub fn inside_rect(cursor: (i32, i32), rect: (i32, i32, u32, u32)) -> bool {
    let (x, y, w, h) = rect;
    cursor.0 >= x && cursor.0 < x + w as i32 && cursor.1 >= y && cursor.1 < y + h as i32
}

/// The poller's sleep: `NEAR_POLL` while the physical `cursor` is within `NEAR_RECT_REACH` (logical px, so `scale`d)
/// of the drawn rectangle `rect`, `CURSOR_POLL` otherwise or while nothing is drawn.
pub fn poll_interval(rect: Option<(i32, i32, u32, u32)>, cursor: (i32, i32), scale: f64) -> Duration {
    let Some((x, y, w, h)) = rect else { return CURSOR_POLL };
    let reach = (NEAR_RECT_REACH * scale).round() as i32;
    let grown = (x - reach, y - reach, w + 2 * reach as u32, h + 2 * reach as u32);
    if inside_rect(cursor, grown) { NEAR_POLL } else { CURSOR_POLL }
}

/// True when a mouse button has just gone down (`now_down` after `!prev_down`) with the physical cursor outside the
/// drawn rectangle `(x, y, width, height)`. A press inside, or a button held since before, never counts.
pub fn press_outside(prev_down: bool, now_down: bool, cursor: (i32, i32), rect: (i32, i32, u32, u32)) -> bool {
    now_down && !prev_down && !inside_rect(cursor, rect)
}

/// Sets the frame: the bounding rectangle of everything the webview draws (surface, fillets, status, say, coachmark),
/// `(left, top)` `width` x `height` in logical px from the work area's top-left corner. The window itself covers the
/// whole work area of the chosen monitor and is placed once (and again only when that area changes), so nothing moves
/// or resizes the webview while the surface animates and the shell and the page can never disagree for a frame (the
/// blink between two shapes when the window moved and the page was presented at its new offset in different compositor
/// frames). The frame only tells the cursor poller where the drawing is: the window takes the mouse inside it and lets
/// it through everywhere else (`set_ignore_cursor_events`), so clicks beside the island reach the windows beneath. It is
/// not a window region: a region makes DWM drop the window's alpha, and everything in it the page leaves clear shows white.
#[tauri::command]
async fn set_frame(window: WebviewWindow, left: i32, top: i32, width: u32, height: u32, screen: tauri::State<'_, Screen>) -> Result<(), String> {
    if let Ok(mut s) = screen.0.lock() { s.last_frame = Some((left, top, width, height)); }
    let area = target_area(window.app_handle(), &screen);
    place_on(&window, area, &screen)
}

/// Places the window on the whole of `area` unless it is already there.
fn place_on(window: &WebviewWindow, area: Area, screen: &Screen) -> Result<(), String> {
    let win = window_rect_of(area);
    let placed = screen.0.lock().ok().and_then(|s| s.placed);
    if placed != Some(win) {
        place_window(window, win.0, win.1, win.2, win.3)?;
        if let Ok(mut s) = screen.0.lock() { s.placed = Some(win); }
    }
    Ok(())
}

/// The island's x range in logical px: the cursor poller reports the cursor in the top band around it.
#[tauri::command]
fn set_hot_zone(left: i32, width: u32, screen: tauri::State<'_, Screen>) {
    if let Ok(mut s) = screen.0.lock() { s.hot = Some((left, width)); s.foreground_dirty = true; }
}

/// The monitors the Settings view offers, in the OS order.
#[tauri::command]
fn list_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let (all, primary) = monitors(&app);
    all.iter().enumerate().map(|(i, m)| {
        let s = m.scale_factor();
        let logical = |v: u32| (v as f64 / s).round() as u32;
        MonitorInfo { id: monitor_id(m, i), name: m.name().cloned(), width: logical(m.size().width), height: logical(m.size().height), work_h: logical(m.work_area().size.height), work_w: logical(m.work_area().size.width), primary: i == primary }
    }).collect()
}

/// Applies the Screen setting (`None`: the primary monitor) and moves the window there at once; the page keeps drawing
/// at the frame it last asked for. A monitor that is not plugged in falls back to the primary until it comes back.
#[tauri::command]
fn set_monitor(window: WebviewWindow, id: Option<String>, screen: tauri::State<'_, Screen>) -> Result<(), String> {
    let placed = match screen.0.lock() {
        Ok(mut s) => { s.chosen = id; s.gen = s.gen.wrapping_add(1); s.last_frame.is_some() }
        Err(_) => return Err("screen state poisoned".into()),
    };
    if placed {
        place_on(&window, target_area(window.app_handle(), &screen), &screen)?;
    }
    Ok(())
}

/// The window's HWND for this crate's `windows` version: Tauri's may come from another one, so go through the raw handle.
#[cfg(windows)]
fn hwnd_of(window: &WebviewWindow) -> Result<windows::Win32::Foundation::HWND, String> {
    let raw = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    Ok(windows::Win32::Foundation::HWND(raw as *mut core::ffi::c_void))
}

#[cfg(windows)]
fn place_window(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let hwnd = hwnd_of(window)?;
    unsafe { SetWindowPos(hwnd, HWND::default(), x, y, w as i32, h as i32, SWP_NOACTIVATE | SWP_NOZORDER) }.map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn place_window(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.set_size(tauri::PhysicalSize::new(w, h)).map_err(|e| e.to_string())
}

/// Arms (or disarms) the watch for a mouse press outside the window.
#[tauri::command]
fn set_outside_watch(on: bool, state: tauri::State<'_, OutsideWatch>) {
    state.0.store(on, Ordering::Relaxed);
}

/// Shows and focuses the overlay so single-letter keys reach the webview (keyboard opens only). The window that had the
/// foreground is remembered first (unless it is the overlay itself), so `release_focus` can give it back.
#[tauri::command]
async fn focus_overlay(window: WebviewWindow, prev: tauri::State<'_, PrevForeground>) -> Result<(), String> {
    if let Some(fg) = foreground_other_than(&window) {
        if let Ok(mut p) = prev.0.lock() { *p = Some(fg); }
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Gives the foreground back to the window remembered by `focus_overlay` (a keyboard-opened surface folded away), so
/// typing reaches the terminal again. True when it was restored; false when nothing was remembered or it is gone.
#[tauri::command]
fn release_focus(prev: tauri::State<'_, PrevForeground>) -> bool {
    let taken = match prev.0.lock() { Ok(mut p) => p.take(), Err(_) => None };
    match taken { Some(raw) => restore_foreground(raw), None => false }
}

#[cfg(windows)]
fn foreground_other_than(window: &WebviewWindow) -> Option<isize> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let fg = unsafe { GetForegroundWindow() }.0 as isize;
    if fg == 0 { return None; }
    // Tauri's HWND may come from another `windows` crate version: compare raw values.
    let own = window.hwnd().ok().map(|h| h.0 as isize);
    if own == Some(fg) { None } else { Some(fg) }
}

#[cfg(not(windows))]
fn foreground_other_than(_window: &WebviewWindow) -> Option<isize> { None }

#[cfg(windows)]
fn restore_foreground(raw: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
    let hwnd = HWND(raw as *mut core::ffi::c_void);
    // The overlay holds the foreground at this point, so Windows lets it hand the foreground on.
    unsafe { IsWindow(hwnd).as_bool() && SetForegroundWindow(hwnd).as_bool() }
}

#[cfg(not(windows))]
fn restore_foreground(_raw: isize) -> bool { false }

#[tauri::command]
fn focus_terminal(title: String) -> Result<bool, String> { Ok(ledge_native::terminal::focus(&title)) }

#[tauri::command]
fn foreground_is_terminal() -> bool { ledge_native::terminal::foreground_is_terminal() }

/// The shell's desktop windows: a click on the wallpaper or Win+D brings one of them to the foreground, and its
/// rectangle spans the monitor (every monitor for `Progman`) without covering anything.
pub fn desktop_class(class: &str) -> bool { matches!(class, "Progman" | "WorkerW") }

/// Ledge's own window handle, to leave it out of the foreground check.
#[cfg(windows)]
fn own_hwnd(app: &AppHandle) -> Option<isize> { app.get_webview_window("main")?.hwnd().ok().map(|h| h.0 as isize) }

#[cfg(not(windows))]
fn own_hwnd(_app: &AppHandle) -> Option<isize> { None }

/// True when the foreground window is maximised or covers the whole monitor whose work area starts at `area`.
/// The desktop itself and Ledge's own window (`own`) never count as covering.
#[cfg(windows)]
fn foreground_covers(area: Area, own: Option<isize>) -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, IsZoomed};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return false; }
        if own == Some(hwnd.0 as isize) { return false; }
        let mut buf = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut buf) as usize;
        if desktop_class(&String::from_utf16_lossy(&buf[..n])) { return false; }
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(mon, &mut info).as_bool() { return false; }
        if info.rcWork.left != area.x || info.rcWork.top != area.y { return false; }
        if IsZoomed(hwnd).as_bool() { return true; }
        let mut r = RECT::default();
        if GetWindowRect(hwnd, &mut r).is_err() { return false; }
        covers((r.left, r.top, r.right, r.bottom), (info.rcMonitor.left, info.rcMonitor.top, info.rcMonitor.right, info.rcMonitor.bottom))
    }
}

#[cfg(not(windows))]
fn foreground_covers(_area: Area, _own: Option<isize>) -> bool { false }

/// Opens a Windows Terminal tab attached to a session the overlay launched itself (`focus_terminal` finds nothing for
/// it: no tab exists yet). True once `wt.exe` was spawned; the tab's own life is not tracked.
#[tauri::command]
fn open_terminal(title: String, command: Vec<String>) -> Result<bool, String> { ledge_native::terminal::open(&title, &command) }

#[tauri::command]
fn open_url(url: String) -> Result<(), String> { ledge_native::browser::open_url(&url) }

/// Launch at login is only offered by an installed (release) build: a `tauri dev` one would register a debug binary
/// under `target\` that a `cargo clean` removes. `None` there, so the Settings view hides the switch.
#[tauri::command]
fn get_autostart(app: AppHandle) -> Option<bool> {
    if cfg!(debug_assertions) { return None; }
    app.autolaunch().is_enabled().ok()
}

/// Turns launch at login on or off (the HKCU Run key), then returns the state Windows now reports.
#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> Result<Option<bool>, String> {
    if cfg!(debug_assertions) { return Ok(None); }
    let launcher = app.autolaunch();
    if on { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())?;
    Ok(launcher.is_enabled().ok())
}

/// The first start of an installed Ledge switches launch at login on, once; after that only the user's choice counts.
fn default_autostart(app: &tauri::App) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let marker = dir.join(ledge_native::autostart::MARKER);
    if !ledge_native::autostart::by_default(cfg!(debug_assertions), marker.exists()) { return; }
    if app.autolaunch().enable().is_ok() {
        let _ = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&marker, b""));
    }
}

/// Relabels the tray menu in the overlay's language (the shell starts in French, the default).
#[tauri::command]
fn set_tray_labels(open: String, new_session: String, dnd: String, quit: String, tray: tauri::State<'_, Tray>) -> Result<(), String> {
    tray.open.set_text(open).map_err(|e| e.to_string())?;
    tray.new_session.set_text(new_session).map_err(|e| e.to_string())?;
    tray.dnd.set_text(dnd).map_err(|e| e.to_string())?;
    tray.quit.set_text(quit).map_err(|e| e.to_string())
}

/// The notification-area icon: the overlay has no taskbar button, so this is where you see that Ledge runs and which
/// version it is (tooltip and the menu's disabled first line), and where you quit it.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let title = tray_title(&app.package_info().version.to_string(), cfg!(debug_assertions));
    let version = MenuItem::with_id(app, "version", &title, false, None::<&str>)?;
    let open = MenuItem::with_id(app, TRAY_OPEN, "Ouvrir Ledge", true, None::<&str>)?;
    let new_session = MenuItem::with_id(app, TRAY_NEW, "Nouvelle session", true, None::<&str>)?;
    let dnd = MenuItem::with_id(app, TRAY_DND, "Ne pas déranger", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, "Quitter Ledge", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&version, &PredefinedMenuItem::separator(app)?, &open, &new_session, &dnd, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("ledge").tooltip(&title).menu(&menu).on_menu_event(|app, event| {
        let action = if event.id() == TRAY_OPEN { Some(TRAY_OPEN) } else if event.id() == TRAY_NEW { Some(TRAY_NEW) } else if event.id() == TRAY_DND { Some(TRAY_DND) } else { None };
        if let Some(action) = action { let _ = app.emit(TRAY_EVENT, TrayPayload { action }); }
        if event.id() == TRAY_QUIT { app.exit(0); }
    });
    tray = tray.icon(tauri::include_image!("icons/ledge-tray.png"));
    tray.build(app)?;
    app.manage(Tray { open, new_session, dnd, quit });
    Ok(())
}

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some((p.x, p.y))
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> { None }

/// Whether the left or the right mouse button is down right now, wherever the cursor is.
#[cfg(windows)]
fn mouse_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    let down = |vk: i32| (unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000) != 0;
    down(VK_LBUTTON.0 as i32) || down(VK_RBUTTON.0 as i32)
}

#[cfg(not(windows))]
fn mouse_down() -> bool { false }

/// The rectangle the overlay draws in physical px: the last frame, on `area`. The window itself covers the whole work
/// area, so it takes the mouse inside this rectangle only, and a press is "outside" when it misses the drawing.
fn drawn_rect(app: &AppHandle, area: Area) -> Option<(i32, i32, u32, u32)> {
    let (left, top, width, height) = app.state::<Screen>().0.lock().ok()?.last_frame?;
    Some(frame_rect(area, left, top, width, height))
}

/// Polls the cursor every 50 ms (16 ms within reach of the drawn rectangle): hands the window the mouse while the
/// cursor is on the drawn rectangle and lets it through to the windows beneath elsewhere, reports it in the top band
/// around the island (the hot zone and the mascot's gaze), reports a maximised window taking or leaving the
/// foreground, and, while the outside watch is armed, emits `OUTSIDE_CLICK_EVENT` on a mouse press outside the drawing.
fn spawn_cursor_poller(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut was_near = false;
        let mut was_covered = false;
        let mut foreground_due = false;
        let mut was_down = false;
        let mut seen_screen: u64 = 0;
        let mut area: Option<Area> = None;
        let mut tick: u32 = 0;
        // Whether the window takes the mouse; `None` until the first tick decides it.
        let mut takes_mouse: Option<bool> = None;
        let mut sleep = CURSOR_POLL;
        loop {
            std::thread::sleep(sleep);
            let (chosen, screen_gen, hot, dirty) = match app.state::<Screen>().0.lock() { Ok(mut s) => (s.chosen.clone(), s.gen, s.hot, std::mem::take(&mut s.foreground_dirty)), Err(_) => continue };
            foreground_due |= dirty;
            if tick % MONITOR_REFRESH_TICKS == 0 || screen_gen != seen_screen {
                seen_screen = screen_gen;
                if let Some(m) = target_monitor(&app, chosen.as_deref()) { area = Some(area_of(&m)); }
            }
            tick = tick.wrapping_add(1);
            let (Some(a), Some(c)) = (area, cursor_position()) else { continue };
            let x = (c.0 - a.x) as f64 / a.scale;
            let y = (c.1 - a.y) as f64 / a.scale;
            let near = cursor_near(hot, x, y);
            if near {
                let _ = app.emit(CURSOR_NEAR_EVENT, Some(CursorPayload { x, y }));
            } else if was_near {
                let _ = app.emit::<Option<CursorPayload>>(CURSOR_NEAR_EVENT, None);
            }
            was_near = near;
            if tick % FOREGROUND_TICKS == 0 {
                let covered = foreground_covers(a, own_hwnd(&app));
                if covered != was_covered || foreground_due { let _ = app.emit(FOREGROUND_EVENT, ForegroundPayload { covered }); }
                was_covered = covered;
                foreground_due = false;
            }
            let rect = drawn_rect(&app, a);
            let on_drawing = rect.is_some_and(|r| inside_rect(c, r));
            if takes_mouse != Some(on_drawing) {
                if let Some(w) = app.get_webview_window("main") {
                    if w.set_ignore_cursor_events(!on_drawing).is_ok() { takes_mouse = Some(on_drawing); }
                }
            }
            sleep = poll_interval(rect, c, a.scale);
            let down = mouse_down();
            if app.state::<OutsideWatch>().0.load(Ordering::Relaxed) {
                if let Some(rect) = rect {
                    if press_outside(was_down, down, c, rect) { let _ = app.emit(OUTSIDE_CLICK_EVENT, ()); }
                }
            }
            was_down = down;
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(OutsideWatch::default())
        .manage(PrevForeground::default())
        .manage(Screen::default())
        .invoke_handler(tauri::generate_handler![set_frame, set_hot_zone, set_outside_watch, focus_overlay, release_focus, focus_terminal, foreground_is_terminal, open_terminal, open_url, list_monitors, set_monitor, set_tray_labels, get_autostart, set_autostart])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_always_on_top(true);
                // The window lets the mouse through until the poller finds the cursor on the drawing.
                let _ = w.set_ignore_cursor_events(true);
            }
            build_tray(app)?;
            default_autostart(app);
            spawn_cursor_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Ledge");
}

#[cfg(test)]
mod tests {
    use super::{choose, covers, cursor_near, desktop_class, frame_rect, inside_rect, poll_interval, press_outside, tray_title, window_rect_of, Area, CURSOR_POLL, NEAR_POLL};

    #[test] fn the_window_takes_the_mouse_inside_the_drawn_rectangle_only() {
        let rect = (100, 0, 200, 60);
        assert!(inside_rect((100, 0), rect));
        assert!(inside_rect((299, 59), rect));
        assert!(!inside_rect((300, 0), rect)); // the right edge is exclusive
        assert!(!inside_rect((150, 60), rect)); // so is the bottom one
        assert!(!inside_rect((99, 30), rect));
    }

    #[test] fn the_poll_quickens_within_reach_of_the_drawn_rectangle() {
        let rect = Some((100, 0, 200, 60));
        assert_eq!(poll_interval(rect, (150, 30), 1.0), NEAR_POLL); // inside
        assert_eq!(poll_interval(rect, (60, 30), 1.0), NEAR_POLL); // 40 px to the left
        assert_eq!(poll_interval(rect, (59, 30), 1.0), CURSOR_POLL);
        assert_eq!(poll_interval(rect, (150, 99), 1.0), NEAR_POLL); // 40 px below: the rectangle grown by the reach keeps exclusive edges
        assert_eq!(poll_interval(rect, (150, 100), 1.0), CURSOR_POLL);
        assert_eq!(poll_interval(rect, (150, 139), 2.0), NEAR_POLL); // the reach is in logical px: 80 physical at 200%
        assert_eq!(poll_interval(rect, (150, 140), 2.0), CURSOR_POLL);
        assert_eq!(poll_interval(None, (0, 0), 1.0), CURSOR_POLL); // nothing drawn yet
    }

    #[test] fn the_desktop_and_its_workers_never_cover_the_screen() {
        assert!(desktop_class("Progman"));
        assert!(desktop_class("WorkerW"));
        assert!(!desktop_class("CASCADIA_HOSTING_WINDOW_CLASS"));
        assert!(!desktop_class("Chrome_WidgetWin_1"));
        assert!(!desktop_class(""));
    }


    #[test] fn the_tray_tells_a_dev_build_from_an_installed_one() {
        assert_eq!(tray_title("0.1.0", false), "Ledge 0.1.0");
        assert_eq!(tray_title("0.1.0", true), "Ledge 0.1.0 (dev)");
    }


    #[test] fn the_chosen_monitor_is_used_while_plugged_in_else_the_primary() {
        let ids: Vec<String> = ["\\\\.\\DISPLAY1", "\\\\.\\DISPLAY2"].iter().map(|s| s.to_string()).collect();
        assert_eq!(choose(None, &ids, 0), 0);
        assert_eq!(choose(Some("\\\\.\\DISPLAY2"), &ids, 0), 1);
        assert_eq!(choose(Some("\\\\.\\DISPLAY3"), &ids, 0), 0); // unplugged: back to the primary
        assert_eq!(choose(Some("#1"), &["#0".to_string(), "#1".to_string()], 0), 1); // unnamed monitors go by index
    }


    const AREA: Area = Area { x: 0, y: 0, w: 2880, h: 1548, scale: 1.5 };
    const LEFT_TASKBAR: Area = Area { x: 72, y: 0, w: 1848, h: 1080, scale: 1.0 };
    const TOP_TASKBAR: Area = Area { x: 0, y: 48, w: 1920, h: 1032, scale: 1.0 };

    #[test] fn frame_is_placed_on_the_work_area_in_physical_px() {
        assert_eq!(frame_rect(AREA, 770, 0, 380, 400), (1155, 0, 570, 600));
        assert_eq!(frame_rect(LEFT_TASKBAR, 100, 0, 117, 38), (172, 0, 117, 38));
        assert_eq!(frame_rect(TOP_TASKBAR, 900, 0, 117, 38), (900, 48, 117, 38));
    }

    #[test] fn the_window_is_the_whole_work_area() {
        assert_eq!(window_rect_of(AREA), (0, 0, 2880, 1548));
        assert_eq!(window_rect_of(LEFT_TASKBAR), (72, 0, 1848, 1080));
        assert_eq!(window_rect_of(TOP_TASKBAR), (0, 48, 1920, 1032));
    }

    #[test] fn the_cursor_is_near_in_the_top_band_around_the_island_only() {
        let hot = Some((454, 117));
        assert!(cursor_near(hot, 300.0, 5.0));    // 170 px left of the island, on the edge
        assert!(cursor_near(hot, 740.0, 160.0));  // under its right end, within reach of the gaze
        assert!(!cursor_near(hot, 300.0, 200.0)); // too low
        assert!(!cursor_near(hot, 100.0, 5.0));   // too far left
        assert!(!cursor_near(None, 500.0, 5.0));  // nothing known yet
    }

    #[test] fn a_window_covers_the_monitor_when_its_rect_holds_the_whole_of_it() {
        let mon = (0, 0, 2560, 1440);
        assert!(covers((0, 0, 2560, 1440), mon));
        assert!(covers((-8, -8, 2568, 1448), mon)); // a maximised window's invisible border
        assert!(!covers((0, 0, 2560, 1400), mon));
        assert!(!covers((100, 0, 2660, 1440), mon));
    }

    #[test] fn only_a_fresh_press_outside_the_window_counts() {
        let rect = (0, 500, 380, 400); // x 0..380, y 500..900
        assert!(press_outside(false, true, (600, 700), rect)); // to the right
        assert!(press_outside(false, true, (100, 300), rect)); // above
        assert!(press_outside(false, true, (100, 900), rect)); // just below (the bottom edge is exclusive)
        assert!(!press_outside(false, true, (100, 700), rect)); // inside
        assert!(!press_outside(false, true, (0, 500), rect)); // the top-left corner is inside
        assert!(!press_outside(true, true, (600, 700), rect)); // held since before: not a new press
        assert!(!press_outside(false, false, (600, 700), rect)); // no button down
        assert!(!press_outside(true, false, (600, 700), rect)); // a release
    }
}
