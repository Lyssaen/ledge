#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Emitted on every enter/leave transition of the cursor over the edge hot zones; payload `{ "inside": bool }`.
pub const EDGE_EVENT: &str = "ledge://edge";
/// Cursor positions near the notch, including while outside the webview. `null` ends the proximity gesture.
pub const CURSOR_NEAR_EVENT: &str = "ledge://cursor-near";
const EDGE_POLL: Duration = Duration::from_millis(50);
/// Re-read the chosen monitor every 40 polls (2 s): resolution, scale or taskbar changes are picked up.
const MONITOR_REFRESH_TICKS: u32 = 40;
/// How close (logical px) to the monitor's left edge the cursor must be to count as "on the edge".
const EDGE_PX: f64 = 2.0;

/// A band of the left screen edge, in logical px from the top of the chosen monitor's work area
/// (the same coordinate space as `set_frame`'s `top`).
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
pub struct Band {
    pub top: f64,
    pub h: f64,
}

/// The bands the webview last reported (empty while the surface is not the bare handle) and a generation bumped on
/// every report, so the poller knows the zones were (re)armed.
#[derive(Default)]
struct HotZones(Mutex<(Vec<Band>, u64)>);

/// The window that was in the foreground when a keyboard open took focus (a raw HWND), handed back by `release_focus`.
#[derive(Default)]
struct PrevForeground(Mutex<Option<isize>>);

/// The Screen setting: the id of the monitor the overlay lives on (`None`: the primary), a generation bumped on every
/// change so the poller re-reads its monitor at once, and the last frame the webview asked for, re-placed on a change.
#[derive(Default)]
struct Screen(Mutex<ScreenState>);
#[derive(Default)]
struct ScreenState {
    chosen: Option<String>,
    gen: u64,
    last_frame: Option<(i32, u32, u32)>,
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
struct EdgePayload {
    inside: bool,
}

#[derive(Clone, Serialize)]
struct CursorPayload { x: f64, y: f64 }

/// The chosen monitor in physical px: its left edge, its work area and its scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub edge_x: i32,
    pub x: i32,
    pub y: i32,
    pub scale: f64,
}

fn area_of(m: &tauri::window::Monitor) -> Area {
    let wa = m.work_area();
    Area { edge_x: m.position().x, x: wa.position.x, y: wa.position.y, scale: m.scale_factor() }
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
    target_monitor(app, chosen_of(screen).as_deref()).map(|m| area_of(&m)).unwrap_or(Area { edge_x: 0, x: 0, y: 0, scale: 1.0 })
}

/// Physical position and size of a frame given in logical px relative to the work area's top-left corner.
pub fn frame_rect(area: Area, top: i32, width: u32, height: u32) -> (i32, i32, u32, u32) {
    let s = area.scale;
    (
        area.x,
        area.y + (top as f64 * s).round() as i32,
        (width as f64 * s).round() as u32,
        (height as f64 * s).round() as u32,
    )
}

/// True when the physical cursor `(x, y)` sits on the primary monitor's left edge inside one of `zones`.
pub fn edge_inside(cursor: (i32, i32), area: Area, zones: &[Band]) -> bool {
    let dx = (cursor.0 - area.edge_x) as f64;
    if dx < 0.0 || dx > EDGE_PX * area.scale {
        return false;
    }
    let y = (cursor.1 - area.y) as f64 / area.scale;
    zones.iter().any(|b| b.h > 0.0 && y >= b.top && y < b.top + b.h)
}

/// One edge-poll step. `prev` is the last state reported (or taken as baseline), `now` the cursor's state against the
/// current zones, `rearmed` whether the zones were reported again since the previous step. Returns the new state and
/// the event to emit, if any. A re-arm never produces an enter: a cursor resting on the edge when the list closes
/// becomes the baseline, and only a real leave then re-entry opens it again. Leaves always go out.
pub fn edge_step(prev: bool, now: bool, rearmed: bool) -> (bool, Option<bool>) {
    if now == prev { return (now, None); }
    if now && rearmed { return (true, None); }
    (now, Some(now))
}

/// Moves and resizes the window to `(0, top)` on the chosen monitor's work area, `width` x `height` (logical px),
/// in one native call so the webview never sees the new position with the old size.
/// The webview reports the bounding frame of everything it draws (surface, tooltip, status, coachmark).
#[tauri::command]
async fn set_frame(window: WebviewWindow, top: i32, width: u32, height: u32, screen: tauri::State<'_, Screen>) -> Result<(), String> {
    if let Ok(mut s) = screen.0.lock() { s.last_frame = Some((top, width, height)); }
    let area = target_area(window.app_handle(), &screen);
    let (x, y, w, h) = frame_rect(area, top, width, height);
    place_window(&window, x, y, w, h)
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

/// Applies the Screen setting (`None`: the primary monitor) and moves the window there at once, at the frame the
/// webview last asked for. A monitor that is not plugged in falls back to the primary until it comes back.
#[tauri::command]
fn set_monitor(window: WebviewWindow, id: Option<String>, screen: tauri::State<'_, Screen>) -> Result<(), String> {
    let last = match screen.0.lock() {
        Ok(mut s) => { s.chosen = id; s.gen = s.gen.wrapping_add(1); s.last_frame }
        Err(_) => return Err("screen state poisoned".into()),
    };
    if let Some((top, width, height)) = last {
        let (x, y, w, h) = frame_rect(target_area(window.app_handle(), &screen), top, width, height);
        place_window(&window, x, y, w, h)?;
    }
    Ok(())
}

#[cfg(windows)]
fn place_window(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    // Tauri's HWND may come from another `windows` crate version: go through the raw handle.
    let raw = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let hwnd = HWND(raw as *mut core::ffi::c_void);
    unsafe { SetWindowPos(hwnd, HWND::default(), x, y, w as i32, h as i32, SWP_NOACTIVATE | SWP_NOZORDER) }.map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn place_window(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.set_size(tauri::PhysicalSize::new(w, h)).map_err(|e| e.to_string())
}

/// Replaces the edge bands the cursor poller watches.
#[tauri::command]
fn set_hot_zones(zones: Vec<Band>, state: tauri::State<'_, HotZones>) {
    if let Ok(mut z) = state.0.lock() {
        z.0 = zones;
        z.1 = z.1.wrapping_add(1);
    }
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

/// True when a window title should be brought forward for `wanted`.
pub fn title_matches(title: &str, wanted: &str) -> bool {
    let t = title.to_lowercase();
    t.contains(&wanted.to_lowercase()) || t.contains("windows terminal")
}

#[cfg(windows)]
#[tauri::command]
fn focus_terminal(title: String) -> Result<bool, String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible, SetForegroundWindow};
    struct Search { wanted: String, exact: Option<HWND>, any: Option<HWND> }
    unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
        let s = &mut *(lp.0 as *mut Search);
        if !IsWindowVisible(hwnd).as_bool() { return BOOL(1); }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf) as usize;
        let t = String::from_utf16_lossy(&buf[..n]);
        if t.to_lowercase().contains(&s.wanted.to_lowercase()) { s.exact = Some(hwnd); return BOOL(0); }
        if s.any.is_none() && t.to_lowercase().contains("windows terminal") { s.any = Some(hwnd); }
        BOOL(1)
    }
    let mut search = Search { wanted: title, exact: None, any: None };
    unsafe { let _ = EnumWindows(Some(cb), LPARAM(&mut search as *mut Search as isize)); }
    match search.exact.or(search.any) { Some(h) => unsafe { Ok(SetForegroundWindow(h).as_bool()) }, None => Ok(false) }
}

#[cfg(not(windows))]
#[tauri::command]
fn focus_terminal(_title: String) -> Result<bool, String> { Ok(false) }

/// Windows Terminal's top-level window class (Cascadia). Its tab titles vary; the class does not.
#[cfg(windows)]
#[tauri::command]
fn foreground_is_terminal() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return false; }
        let mut buf = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut buf) as usize;
        String::from_utf16_lossy(&buf[..n]) == "CASCADIA_HOSTING_WINDOW_CLASS"
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn foreground_is_terminal() -> bool { false }

/// The `wt.exe` arguments that open a tab titled `title` in the current Windows Terminal window (a new one when none
/// is open) running `command` inside the default WSL distribution. `command` is the daemon's launcher command plus
/// `attach <id>`, passed verbatim: Windows Terminal hands everything after `wsl.exe --` to WSL untouched.
pub fn terminal_args(title: &str, command: &[String]) -> Vec<String> {
    let mut args: Vec<String> = ["-w", "0", "new-tab", "--title", title, "wsl.exe", "--"].iter().map(|s| s.to_string()).collect();
    args.extend(command.iter().cloned());
    args
}

/// Opens a Windows Terminal tab attached to a session the overlay launched itself (`focus_terminal` finds nothing for
/// it: no tab exists yet). True once `wt.exe` was spawned; the tab's own life is not tracked.
#[cfg(windows)]
#[tauri::command]
fn open_terminal(title: String, command: Vec<String>) -> Result<bool, String> {
    if command.is_empty() { return Err("empty command".into()); }
    match std::process::Command::new("wt.exe").args(terminal_args(&title, &command)).spawn() {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("wt.exe: {e}")),
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn open_terminal(_title: String, _command: Vec<String>) -> Result<bool, String> { Ok(false) }

/// Opens a web URL in the default browser through the shell (`rundll32 url.dll,FileProtocolHandler`, which takes `&`
/// and `?` as they are, unlike `cmd /C start`): the overlay's webview must never navigate away. Only http(s) is accepted.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("not a web url".into()); }
    #[cfg(windows)]
    let spawned = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(not(windows))]
    let spawned = std::process::Command::new("xdg-open").arg(&url).spawn();
    spawned.map(|_| ()).map_err(|e| format!("open url: {e}"))
}

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

/// The marker left once launch at login was switched on by default, so a later "off" in Settings sticks across restarts
/// and upgrades. It lives in the app's config dir (`%APPDATA%\be.paradow.ledge`).
const AUTOSTART_MARKER: &str = "autostart-default";

/// Whether this start should switch launch at login on: the first start of an installed build only.
pub fn autostart_by_default(debug: bool, marker_exists: bool) -> bool {
    !debug && !marker_exists
}

/// The first start of an installed Ledge switches launch at login on, once; after that only the user's choice counts.
fn default_autostart(app: &tauri::App) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let marker = dir.join(AUTOSTART_MARKER);
    if !autostart_by_default(cfg!(debug_assertions), marker.exists()) { return; }
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

/// Polls the cursor every 50 ms and emits `EDGE_EVENT` on enter/leave transitions only.
/// The window covers only what it draws, so the edge bands above and below the handle are outside it.
fn spawn_edge_poller(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut inside = false;
        let mut cursor_near = false;
        let mut seen_gen: u64 = 0;
        let mut seen_screen: u64 = 0;
        let mut area: Option<Area> = None;
        let mut tick: u32 = 0;
        loop {
            std::thread::sleep(EDGE_POLL);
            let (chosen, screen_gen) = match app.state::<Screen>().0.lock() { Ok(s) => (s.chosen.clone(), s.gen), Err(_) => continue };
            if tick % MONITOR_REFRESH_TICKS == 0 || screen_gen != seen_screen {
                seen_screen = screen_gen;
                if let Some(m) = target_monitor(&app, chosen.as_deref()) { area = Some(area_of(&m)); }
            }
            tick = tick.wrapping_add(1);
            let (Some(a), Some(c)) = (area, cursor_position()) else { continue };
            let x = (c.0 - a.x) as f64 / a.scale;
            let y = (c.1 - a.y) as f64 / a.scale;
            let near = (0.0..=170.0).contains(&x);
            if near {
                let _ = app.emit(CURSOR_NEAR_EVENT, Some(CursorPayload { x, y }));
            } else if cursor_near {
                let _ = app.emit::<Option<CursorPayload>>(CURSOR_NEAR_EVENT, None);
            }
            cursor_near = near;
            let (zones, gen) = match app.state::<HotZones>().0.lock() { Ok(z) => z.clone(), Err(_) => continue };
            let rearmed = gen != seen_gen;
            seen_gen = gen;
            let (next, emit) = edge_step(inside, edge_inside(c, a, &zones), rearmed);
            inside = next;
            if let Some(inside) = emit {
                let _ = app.emit(EDGE_EVENT, EdgePayload { inside });
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(HotZones::default())
        .manage(PrevForeground::default())
        .manage(Screen::default())
        .invoke_handler(tauri::generate_handler![set_frame, set_hot_zones, focus_overlay, release_focus, focus_terminal, foreground_is_terminal, open_terminal, open_url, list_monitors, set_monitor, set_tray_labels, get_autostart, set_autostart])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.set_always_on_top(true); }
            build_tray(app)?;
            default_autostart(app);
            spawn_edge_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Ledge");
}

#[cfg(test)]
mod tests {
    use super::{autostart_by_default, choose, edge_inside, edge_step, frame_rect, terminal_args, title_matches, tray_title, Area, Band};

    #[test] fn a_terminal_tab_runs_the_launcher_command_in_wsl() {
        let cmd: Vec<String> = ["/usr/bin/node", "/opt/ledge/cli.js", "attach", "n1"].iter().map(|s| s.to_string()).collect();
        assert_eq!(terminal_args("Juno · api-gateway", &cmd), ["-w", "0", "new-tab", "--title", "Juno · api-gateway", "wsl.exe", "--", "/usr/bin/node", "/opt/ledge/cli.js", "attach", "n1"]);
    }

    #[test] fn the_tray_tells_a_dev_build_from_an_installed_one() {
        assert_eq!(tray_title("0.1.0", false), "Ledge 0.1.0");
        assert_eq!(tray_title("0.1.0", true), "Ledge 0.1.0 (dev)");
    }

    #[test] fn launch_at_login_is_switched_on_once_by_an_installed_build() {
        assert!(autostart_by_default(false, false)); // first start once installed
        assert!(!autostart_by_default(false, true)); // later starts: the user's choice stands
        assert!(!autostart_by_default(true, false)); // never from `tauri dev`
    }

    #[test] fn the_chosen_monitor_is_used_while_plugged_in_else_the_primary() {
        let ids: Vec<String> = ["\\\\.\\DISPLAY1", "\\\\.\\DISPLAY2"].iter().map(|s| s.to_string()).collect();
        assert_eq!(choose(None, &ids, 0), 0);
        assert_eq!(choose(Some("\\\\.\\DISPLAY2"), &ids, 0), 1);
        assert_eq!(choose(Some("\\\\.\\DISPLAY3"), &ids, 0), 0); // unplugged: back to the primary
        assert_eq!(choose(Some("#1"), &["#0".to_string(), "#1".to_string()], 0), 1); // unnamed monitors go by index
    }

    #[test] fn matches_bot_title_or_terminal() {
        assert!(title_matches("Otto · harness-assistant - Windows Terminal", "Otto · harness-assistant"));
        assert!(title_matches("PowerShell - Windows Terminal", "Pim · speos-api"));
        assert!(!title_matches("Visual Studio Code", "Pim · speos-api"));
    }

    const AREA: Area = Area { edge_x: 0, x: 0, y: 0, scale: 1.5 };

    #[test] fn frame_is_placed_on_the_work_area_in_physical_px() {
        assert_eq!(frame_rect(AREA, 100, 380, 400), (0, 150, 570, 600));
        let left_taskbar = Area { edge_x: 0, x: 72, y: 0, scale: 1.0 };
        assert_eq!(frame_rect(left_taskbar, 40, 28, 60), (72, 40, 28, 60));
    }

    #[test] fn edge_needs_the_left_edge_and_a_band() {
        let zones = [Band { top: 40.0, h: 100.0 }, Band { top: 300.0, h: 0.0 }];
        assert!(edge_inside((0, 90), AREA, &zones)); // y = 60 logical
        assert!(edge_inside((3, 90), AREA, &zones)); // 3 physical px = 2 logical px at 1.5
        assert!(!edge_inside((4, 90), AREA, &zones));
        assert!(!edge_inside((0, 30), AREA, &zones)); // y = 20, above the band
        assert!(!edge_inside((0, 450), AREA, &zones)); // empty band
        assert!(!edge_inside((-1, 90), AREA, &zones)); // a monitor to the left
        assert!(!edge_inside((0, 90), AREA, &[]));
    }

    #[test] fn a_rearm_never_enters_but_a_real_reentry_does() {
        // Cursor resting on the edge while the list closes and the zones come back: baseline, no event.
        assert_eq!(edge_step(false, true, true), (true, None));
        // It stays there: nothing.
        assert_eq!(edge_step(true, true, false), (true, None));
        // It leaves, then comes back: leave, then enter.
        assert_eq!(edge_step(true, false, false), (false, Some(false)));
        assert_eq!(edge_step(false, true, false), (true, Some(true)));
        // Zones disarmed (list opened) while inside: the leave still goes out.
        assert_eq!(edge_step(true, false, true), (false, Some(false)));
    }
}
