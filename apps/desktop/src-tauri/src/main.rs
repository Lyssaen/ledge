#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::StateFlags;

const TRAY_OPEN: &str = "open";
const TRAY_NEW: &str = "new";
const TRAY_DND: &str = "dnd";
const TRAY_QUIT: &str = "quit";
/// Passed by the login item: the app starts in the tray, its window hidden.
const MINIMIZED: &str = "--minimized";

#[derive(Clone, Serialize)]
struct TrayPayload { action: String }

/// What the island asked to open (`--open <target>`), kept until the page takes it: a first launch delivers it
/// before the page listens.
#[derive(Default)]
struct PendingOpen(std::sync::Mutex<Option<String>>);

/// Keeps the island's target and tells the page (`ledge://open`), which then takes it.
fn deliver_open(app: &AppHandle, target: String) {
    if let Some(p) = app.try_state::<PendingOpen>() { *p.0.lock().unwrap() = Some(target); }
    let _ = app.emit("ledge://open", ());
}

/// The island's target waiting for the page, once.
#[tauri::command]
fn take_open_target(pending: tauri::State<PendingOpen>) -> Option<String> { pending.0.lock().unwrap().take() }

/// What the tray tooltip says; a dev build says so.
pub fn tray_title(version: &str, debug: bool) -> String {
    if debug { format!("Ledge Desktop {version} (dev)") } else { format!("Ledge Desktop {version}") }
}

#[tauri::command]
fn focus_terminal(title: String) -> Result<bool, String> { Ok(ledge_native::terminal::focus(&title)) }
#[tauri::command]
fn foreground_is_terminal() -> bool { ledge_native::terminal::foreground_is_terminal() }
#[tauri::command]
fn open_terminal(title: String, command: Vec<String>) -> Result<bool, String> { ledge_native::terminal::open(&title, &command) }
#[tauri::command]
fn open_url(url: String) -> Result<(), String> { ledge_native::browser::open_url(&url) }
#[tauri::command]
fn get_autostart(app: AppHandle) -> Option<bool> {
    if cfg!(debug_assertions) { return None; }
    app.autolaunch().is_enabled().ok()
}
#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> Result<Option<bool>, String> {
    if cfg!(debug_assertions) { return Ok(None); }
    let l = app.autolaunch();
    (if on { l.enable() } else { l.disable() }).map_err(|e| e.to_string())?;
    Ok(l.is_enabled().ok())
}

struct Tray { open: MenuItem<Wry>, new_session: MenuItem<Wry>, dnd: MenuItem<Wry>, quit: MenuItem<Wry> }

#[tauri::command]
fn set_tray_labels(app: AppHandle, open: String, new_session: String, dnd: String, quit: String) -> Result<(), String> {
    let t = app.state::<Tray>();
    for (item, text) in [(&t.open, open), (&t.new_session, new_session), (&t.dnd, dnd), (&t.quit, quit)] {
        item.set_text(text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Every tray entry brings the window forward except Do not disturb, a switch the user flips without looking (spec §10).
fn tray_shows_window(id: &str) -> bool {
    id != TRAY_DND
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, TRAY_OPEN, "Ouvrir Ledge Desktop", true, None::<&str>)?;
    let new_session = MenuItem::with_id(app, TRAY_NEW, "Nouvelle session", true, None::<&str>)?;
    let dnd = MenuItem::with_id(app, TRAY_DND, "Ne pas déranger", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, "Quitter Ledge Desktop", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &new_session, &dnd, &PredefinedMenuItem::separator(app)?, &quit])?;
    TrayIconBuilder::with_id("ledge-desktop")
        .icon(tauri::include_image!("icons/ledge-tray.png"))
        .tooltip(tray_title(app.package_info().version.to_string().as_str(), cfg!(debug_assertions)))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            TRAY_QUIT => app.exit(0),
            TRAY_OPEN => show_main(app),
            id => { if tray_shows_window(id) { show_main(app); } let _ = app.emit("ledge://tray", TrayPayload { action: id.to_string() }); }
        })
        .on_tray_icon_event(|tray, e| {
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = e {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(Tray { open, new_session, dnd, quit });
    Ok(())
}

/// Whether this launch asked to stay in the tray (the login item's argument).
fn launched_minimized<I: IntoIterator<Item = String>>(args: I) -> bool { args.into_iter().any(|a| a == MINIMIZED) }

/// Switched on once by an installed build, as the island does; the marker (written only after a successful
/// enable, so a failure is retried next start) remembers the user's later choice.
fn default_autostart(app: &tauri::App) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let marker = dir.join(ledge_native::autostart::MARKER);
    if !ledge_native::autostart::by_default(cfg!(debug_assertions), marker.exists()) { return; }
    if app.autolaunch().enable().is_ok() {
        let _ = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&marker, b""));
    }
}

fn main() {
    tauri::Builder::default()
        // First, so a second launch exits before anything else starts; it brings this one forward instead.
        // A second launch from the island carries its target: this window shows it.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main(app);
            if let Some(target) = ledge_native::desktop::open_target(args) { deliver_open(app, target); }
        }))
        .manage(PendingOpen::default())
        // Visibility is the launch's choice (setup below), never the restored state's.
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(StateFlags::all() & !StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![focus_terminal, foreground_is_terminal, open_terminal, open_url, get_autostart, set_autostart, set_tray_labels, take_open_target])
        .setup(|app| {
            build_tray(app)?;
            default_autostart(app);
            // The window is created hidden and the window-state plugin has already put it back in place: show it now,
            // without a flash at the default size, unless the login item launched us into the tray.
            if !launched_minimized(std::env::args()) { show_main(app.handle()); }
            if let Some(target) = ledge_native::desktop::open_target(std::env::args()) { deliver_open(app.handle(), target); }
            Ok(())
        })
        // Close hides to the tray (spec 4.4).
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e { api.prevent_close(); let _ = w.hide(); }
        })
        .run(tauri::generate_context!())
        .expect("error while running Ledge Desktop");
}

#[cfg(test)]
mod tests {
    use super::{launched_minimized, tray_shows_window, tray_title};
    #[test]
    fn the_tray_tells_a_dev_build_from_an_installed_one() {
        assert_eq!(tray_title("0.5.2", false), "Ledge Desktop 0.5.2");
        assert_eq!(tray_title("0.5.2", true), "Ledge Desktop 0.5.2 (dev)");
    }
    #[test]
    fn only_the_login_item_starts_in_the_tray() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(launched_minimized(args(&["ledge-desktop.exe", "--minimized"])));
        assert!(!launched_minimized(args(&["ledge-desktop.exe"])));
    }

    #[test]
    fn do_not_disturb_from_the_tray_keeps_the_window_hidden() {
        assert!(!tray_shows_window("dnd"));
        assert!(tray_shows_window("new"));
    }
}
