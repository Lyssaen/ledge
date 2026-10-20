#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod notch;
mod pty;

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
/// The Ledge Desktop window; the notch is the other one.
const MAIN: &str = "main";
/// The detached Atelier (#21), declared in tauri.conf.json but made only when asked.
const ATELIER: &str = "atelier";

#[derive(Clone, Serialize)]
struct TrayPayload { action: String }

/// What the island asked to open (`--open <target>`), kept until the page takes it: a first launch delivers it
/// before the page listens.
#[derive(Default)]
struct PendingOpen(std::sync::Mutex<Option<String>>);

/// Keeps the island's target and tells the page (`ledge://open`), which then takes it.
fn deliver_open(app: &AppHandle, target: String) {
    if let Some(p) = app.try_state::<PendingOpen>() { *p.0.lock().unwrap() = Some(target); }
    let _ = app.emit_to(MAIN, "ledge://open", ());
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

/// The daemon's token, read from WSL: `{ kind: "token", token }`, `{ kind: "absent" }` or `{ kind: "unavailable" }`.
#[tauri::command]
async fn daemon_token() -> serde_json::Value {
    use ledge_native::daemon_token::{read, TokenRead};
    match tauri::async_runtime::spawn_blocking(|| read(std::time::Duration::from_secs(5))).await {
        Ok(TokenRead::Token(token)) => serde_json::json!({ "kind": "token", "token": token }),
        Ok(TokenRead::Absent) => serde_json::json!({ "kind": "absent" }),
        _ => serde_json::json!({ "kind": "unavailable" }),
    }
}

/// The island's target if it is one JSON line, as `--open` would carry it.
fn checked_target(target: &str) -> Result<&str, String> {
    if ledge_native::desktop::valid_target(target) { Ok(target) } else { Err("invalid target".into()) }
}

/// « Open in Ledge »: the notch is a window of this app, so this window shows the target itself.
#[tauri::command]
fn open_in_ledge(app: AppHandle, target: String) -> Result<(), String> {
    checked_target(&target)?;
    show_main(&app);
    deliver_open(&app, target);
    Ok(())
}
/// « Détacher l'Atelier »: makes its window from its declaration (the same WebView2 flags as the others, or it fails to open),
/// or brings it forward when it is already there. An ordinary window: neither the notch's placement nor its focus.
/// Async: making a window in a sync command deadlocks on Windows.
#[tauri::command]
async fn open_atelier(app: AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(ATELIER) {
        Some(w) => w,
        None => {
            let config = app.config().app.windows.iter().find(|w| w.label == ATELIER).cloned().ok_or("no atelier window")?;
            let w = tauri::WebviewWindowBuilder::from_config(&app, &config).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
            // A new Atelier opens out of full screen (#41): the window-state plugin keeps one left by Alt+F4, and the page
            // starts with its window bar.
            let _ = w.set_fullscreen(false);
            w
        }
    };
    // Created hidden: the window-state plugin has put it back where it was, show it now.
    let _ = window.unminimize();
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
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
    if let Some(w) = app.get_webview_window(MAIN) {
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
            id => { if tray_shows_window(id) { show_main(app); } let _ = app.emit_to(MAIN, "ledge://tray", TrayPayload { action: id.to_string() }); }
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

/// What a close request (the title bar's ×, Alt+F4) does to a window.
#[derive(Debug, PartialEq, Eq)]
enum CloseAction { Hide, Ignore, Close }

/// The Desktop window hides to the tray (spec 4.4); the notch is never closed by hand, so its close requests are
/// ignored (Quit, from the tray or the notch's menu, ends both windows).
fn on_close(label: &str) -> CloseAction {
    match label { MAIN => CloseAction::Hide, notch::NOTCH => CloseAction::Ignore, _ => CloseAction::Close }
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
        // Visibility is the launch's choice (setup below); decorations come from tauri.conf.json.
        // Restoring old native decorations would bring back Windows' title bar over our own.
        // The notch places itself on the chosen monitor's work area: no saved state for it.
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(StateFlags::all() & !(StateFlags::VISIBLE | StateFlags::DECORATIONS)).with_denylist(&[notch::NOTCH]).build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(notch::OutsideWatch::default())
        .manage(notch::PrevForeground::default())
        .manage(notch::Screen::default())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            focus_terminal, foreground_is_terminal, open_terminal, open_url, daemon_token, get_autostart, set_autostart, set_tray_labels, take_open_target,
            open_in_ledge, notch::set_frame, notch::set_hot_zone, notch::set_outside_watch, notch::focus_overlay, notch::release_focus,
            notch::list_monitors, notch::set_monitor, open_atelier, pty::pty_open, pty::pty_write, pty::pty_resize, pty::pty_close,
        ])
        .setup(|app| {
            build_tray(app)?;
            // Before the tray-only check: the notch shows even when the login item starts us minimized.
            notch::setup(app)?;
            default_autostart(app);
            // The window is created hidden and the window-state plugin has already put it back in place: show it now,
            // without a flash at the default size, unless the login item launched us into the tray.
            if !launched_minimized(std::env::args()) { show_main(app.handle()); }
            else if let Some(w) = app.get_webview_window(MAIN) {
                // Restoring a maximized window can show it even without StateFlags::VISIBLE.
                // The login item's tray-only launch wins over that restored visibility.
                let _ = w.hide();
            }
            if let Some(target) = ledge_native::desktop::open_target(std::env::args()) { deliver_open(app.handle(), target); }
            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                match on_close(w.label()) {
                    CloseAction::Hide => { api.prevent_close(); let _ = w.hide(); }
                    CloseAction::Ignore => api.prevent_close(),
                    CloseAction::Close => {}
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Ledge Desktop")
        .run(|app, event| {
            // Managed state is never dropped on exit: the terminals' processes would be left to the OS to reap.
            if let tauri::RunEvent::Exit = event { app.state::<pty::PtyState>().close_all(); }
        });
}

#[cfg(test)]
mod tests {
    use super::{checked_target, launched_minimized, on_close, tray_shows_window, tray_title, CloseAction};
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

    #[test]
    fn closing_hides_the_main_window_and_never_closes_the_notch() {
        assert_eq!(on_close("main"), CloseAction::Hide);
        assert_eq!(on_close("notch"), CloseAction::Ignore);
        assert_eq!(on_close("other"), CloseAction::Close);
        // the detached Atelier really closes: the main window takes the Atelier back
        assert_eq!(on_close("atelier"), CloseAction::Close);
    }

    #[test]
    fn open_in_ledge_refuses_an_invalid_target() {
        assert_eq!(checked_target("not json"), Err("invalid target".into()));
        assert_eq!(checked_target(r#"{"kind":"settings"}"#), Ok(r#"{"kind":"settings"}"#));
    }
}
