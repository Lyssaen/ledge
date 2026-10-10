#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Emitted on every enter/leave transition of the cursor over the edge hot zones; payload `{ "inside": bool }`.
pub const EDGE_EVENT: &str = "ledge://edge";
const EDGE_POLL: Duration = Duration::from_millis(50);
/// Re-read the primary monitor every 40 polls (2 s): resolution, scale or taskbar changes are picked up.
const MONITOR_REFRESH_TICKS: u32 = 40;
/// How close (logical px) to the monitor's left edge the cursor must be to count as "on the edge".
const EDGE_PX: f64 = 2.0;

/// A band of the left screen edge, in logical px from the top of the primary monitor's work area
/// (the same coordinate space as `set_frame`'s `top`).
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
pub struct Band {
    pub top: f64,
    pub h: f64,
}

/// The bands the webview last reported; empty while the surface is not the bare handle.
#[derive(Default)]
struct HotZones(Mutex<Vec<Band>>);

#[derive(Clone, Serialize)]
struct EdgePayload {
    inside: bool,
}

/// The primary monitor in physical px: its left edge, its work area and its scale factor.
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

/// Moves and resizes the window to `(0, top)` on the primary monitor's work area, `width` x `height` (logical px).
/// The webview reports the bounding frame of everything it draws (surface, tooltip, status, coachmark).
#[tauri::command]
async fn set_frame(window: WebviewWindow, top: i32, width: u32, height: u32) -> Result<(), String> {
    let area = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .map(|m| area_of(&m))
        .unwrap_or(Area { edge_x: 0, x: 0, y: 0, scale: 1.0 });
    let (x, y, w, h) = frame_rect(area, top, width, height);
    window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.set_size(PhysicalSize::new(w, h)).map_err(|e| e.to_string())
}

/// Replaces the edge bands the cursor poller watches.
#[tauri::command]
fn set_hot_zones(zones: Vec<Band>, state: tauri::State<'_, HotZones>) {
    if let Ok(mut z) = state.0.lock() {
        *z = zones;
    }
}

/// Shows and focuses the overlay so single-letter keys reach the webview (keyboard opens only).
#[tauri::command]
async fn focus_overlay(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

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
        let mut area: Option<Area> = None;
        let mut tick: u32 = 0;
        loop {
            std::thread::sleep(EDGE_POLL);
            if tick % MONITOR_REFRESH_TICKS == 0 {
                if let Ok(Some(m)) = app.primary_monitor() { area = Some(area_of(&m)); }
            }
            tick = tick.wrapping_add(1);
            let (Some(a), Some(c)) = (area, cursor_position()) else { continue };
            let zones = match app.state::<HotZones>().0.lock() { Ok(z) => z.clone(), Err(_) => continue };
            let now = edge_inside(c, a, &zones);
            if now != inside {
                inside = now;
                let _ = app.emit(EDGE_EVENT, EdgePayload { inside });
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(HotZones::default())
        .invoke_handler(tauri::generate_handler![set_frame, set_hot_zones, focus_overlay, focus_terminal])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.set_always_on_top(true); }
            spawn_edge_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Ledge");
}

#[cfg(test)]
mod tests {
    use super::{edge_inside, frame_rect, title_matches, Area, Band};

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
}
