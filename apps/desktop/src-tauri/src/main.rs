#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod media;
mod notch;
mod pty;

use ledge_native::native::{self, Mode};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::StateFlags;
use tauri_plugin_updater::UpdaterExt;

const SNAPSHOT_FEED: &str = "https://github.com/Lyssaen/ledge/releases/download/snapshot/latest-desktop.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMetadata {
    rid: u32,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

fn snapshot_sequence(version: &str) -> Option<(u64, u64)> {
    let (_, suffix) = version.split_once("-snapshot.")?;
    let (run, attempt) = suffix.split_once('.')?;
    Some((run.parse().ok()?, attempt.parse().ok()?))
}

#[tauri::command]
async fn check_snapshot_update(webview: tauri::Webview<Wry>) -> Result<Option<SnapshotMetadata>, String> {
    let url = SNAPSHOT_FEED.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    let updater = webview.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?
        .version_comparator(|_, remote| {
            let next = snapshot_sequence(&remote.version.to_string());
            match (option_env!("LEDGE_SNAPSHOT_VERSION").and_then(snapshot_sequence), next) {
                (_, None) => false,
                (None, Some(_)) => true,
                (Some(current), Some(next)) => next > current,
            }
        }).build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else { return Ok(None); };
    let current_version = update.current_version.clone();
    let version = update.version.clone();
    let body = update.body.clone();
    let raw_json = update.raw_json.clone();
    let rid = webview.resources_table().add(update);
    Ok(Some(SnapshotMetadata { rid, current_version, version, date: None, body, raw_json }))
}

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
fn open_terminal(mode: tauri::State<AppMode>, title: String, command: Vec<String>) -> Result<bool, String> {
    if mode.mode == Mode::Native { ledge_native::terminal::open_native(&title, &command) } else { ledge_native::terminal::open(&title, &command) }
}
#[tauri::command]
fn open_url(url: String) -> Result<(), String> { ledge_native::browser::open_url(&url) }

/// How this Desktop reaches its daemon, chosen once at start (spec 2026-11-03 §4.2.4): native when no WSL distribution is
/// registered, WSL otherwise. `home` and `port` are the native daemon's.
pub struct AppMode { pub mode: Mode, pub port: u16, pub home: Option<std::path::PathBuf> }

impl AppMode {
    fn detect() -> AppMode {
        let env = |k: &str| std::env::var(k).ok();
        let mode = if cfg!(windows) { native::choose_mode(env("LEDGE_DESKTOP_MODE").as_deref(), native::wsl_has_distro()) } else { Mode::Wsl };
        // WSL mode keeps today's port whatever Desktop's environment says.
        let port = if mode == Mode::Native { native::port(&env) } else { ledge_protocol_port() };
        AppMode { mode, port, home: native::ledge_home(&env) }
    }
}

const fn ledge_protocol_port() -> u16 { 47831 }

/** The page's Content-Security-Policy lets it reach the daemon on the port in use: tauri.conf.json names the usual one, a
 *  native daemon on `LEDGE_PORT` (tests on a PC with WSL) takes its place. Nothing else is opened. */
pub fn csp_for_port(csp: &str, port: u16) -> String {
    csp.replace(&format!("ws://127.0.0.1:{}", ledge_protocol_port()), &format!("ws://127.0.0.1:{port}"))
}

/// What a mode starts at launch.
#[derive(Debug, PartialEq, Eq)]
pub struct Subsystems { pub keepalive: bool, pub notch: bool, pub media: bool, pub supervisor: bool }

/// Native mode runs the daemon itself and has no WSL to keep alive; the island is outside its first round (spec §1).
pub fn subsystems(mode: Mode) -> Subsystems {
    let wsl = mode == Mode::Wsl;
    Subsystems { keepalive: wsl, notch: wsl, media: wsl, supervisor: !wsl }
}

/// Where the runtime's per-version copies live: Desktop's local app data (`%LOCALAPPDATA%\\<identifier>`), which a roaming
/// profile does not carry (a copy is 0.5 GB); the Ledge home only when Windows gives no such folder.
pub fn runtime_base(local_app_data: Option<std::path::PathBuf>, home: &std::path::Path) -> std::path::PathBuf {
    local_app_data.unwrap_or_else(|| home.to_path_buf())
}

/// The daemon's keeper, once native mode has started it.
#[derive(Default)]
pub struct Keeper(std::sync::Mutex<Option<std::sync::Arc<ledge_native::supervisor::Supervisor>>>);

/// The mode and the port the page connects to: `{ mode: "native" | "wsl", port }`.
#[tauri::command]
fn native_info(mode: tauri::State<AppMode>) -> serde_json::Value {
    serde_json::json!({ "mode": if mode.mode == Mode::Native { "native" } else { "wsl" }, "port": mode.port })
}

/// Native mode: stops the daemon over the protocol and waits for it to end (15 s at most); it stays stopped until
/// `daemon_resume`. For the updater (installer step). False when it did not end, or in WSL mode.
#[tauri::command]
async fn daemon_stop(keeper: tauri::State<'_, Keeper>) -> Result<bool, String> {
    let Some(sup) = keeper.0.lock().unwrap().clone() else { return Ok(false) };
    tauri::async_runtime::spawn_blocking(move || sup.stop_and_wait(std::time::Duration::from_secs(15))).await.map_err(|e| e.to_string())
}

/// Native mode: lets the keeper start the daemon again after `daemon_stop`.
#[tauri::command]
fn daemon_resume(keeper: tauri::State<Keeper>) {
    if let Some(sup) = keeper.0.lock().unwrap().as_ref() { sup.resume(); }
}

/// Native mode, at launch, on its own thread: `ledge setup` once (the hooks follow the bundled node and CLI), then the
/// keeper. Without a runtime nothing starts: the page shows the daemon as unreachable, and the journal says why.
#[cfg(windows)]
fn start_native(app: &AppHandle) {
    use ledge_native::supervisor::{append_log, windows_ops, Supervisor};
    let mode = app.state::<AppMode>();
    let (port, home) = (mode.port, mode.home.clone());
    let port_override = std::env::var("LEDGE_PORT").is_ok();
    let env = |k: &str| std::env::var(k).ok();
    let source = native::runtime_source(&env, app.path().resource_dir().ok().as_deref(), &|p| p.exists());
    let local_data = app.path().app_local_data_dir().ok();
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(home) = home else { return };
        // The bundled runtime runs from its per-version copy (an update may replace the install folder meanwhile).
        let rt = match source {
            Some(native::RuntimeSource::Override(rt)) => Some(rt),
            Some(native::RuntimeSource::Bundled(dir)) => match native::stage_runtime(&dir, &runtime_base(local_data, &home)) {
                Ok(copy) => {
                    append_log(&home, &format!("runtime: {}", copy.display()));
                    let rt = native::runtime_from_dir(&copy, &|p| p.exists());
                    if let Some(v) = rt.as_ref().and_then(|r| r.version.clone()) {
                        for old in native::prune_runtimes(copy.parent().and_then(|p| p.parent()).unwrap_or(&home), &v) { append_log(&home, &format!("runtime {old} removed")); }
                    }
                    rt
                }
                Err(e) => { append_log(&home, &format!("the bundled runtime could not be copied: {e}")); None }
            },
            None => None,
        };
        let Some(rt) = rt else { append_log(&home, "no Ledge runtime found (LEDGE_NODE + LEDGE_CLI, or the bundled runtime folder): the daemon is not started"); return };
        run_setup(&rt, &home);
        let bundled = rt.version.clone();
        let sup = std::sync::Arc::new(Supervisor::start_with(windows_ops(rt, home, port, port_override), bundled));
        *app.state::<Keeper>().0.lock().unwrap() = Some(sup);
    });
}

/// `node <cli> setup`, its output in the journal; a failure is logged and the daemon starts anyway.
#[cfg(windows)]
fn run_setup(rt: &ledge_native::native::Runtime, home: &std::path::Path) {
    use ledge_native::supervisor::append_log;
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new(&rt.node).arg(&rt.cli).arg("setup").stdin(std::process::Stdio::null()).creation_flags(0x0800_0000).output();
    match out {
        Ok(o) => {
            for line in String::from_utf8_lossy(&o.stdout).lines().chain(String::from_utf8_lossy(&o.stderr).lines()) { append_log(home, &format!("setup: {line}")); }
            if !o.status.success() { append_log(home, &format!("setup failed ({})", o.status)); }
        }
        Err(e) => append_log(home, &format!("setup could not start: {e}")),
    }
}

/// The daemon's token: from WSL, or from its file in native mode. `{ kind: "token", token }`, `{ kind: "absent" }` or
/// `{ kind: "unavailable" }`.
#[tauri::command]
async fn daemon_token(mode: tauri::State<'_, AppMode>) -> Result<serde_json::Value, String> {
    use ledge_native::daemon_token::{read, TokenRead};
    let native_file = (mode.mode == Mode::Native).then(|| mode.home.clone().map(|h| h.join("token")));
    let read = tauri::async_runtime::spawn_blocking(move || match native_file {
        Some(Some(file)) => native::read_token_file(&file),
        Some(None) => TokenRead::Unavailable,
        None => read(std::time::Duration::from_secs(5)),
    }).await;
    Ok(match read {
        Ok(TokenRead::Token(token)) => serde_json::json!({ "kind": "token", "token": token }),
        Ok(TokenRead::Absent) => serde_json::json!({ "kind": "absent" }),
        _ => serde_json::json!({ "kind": "unavailable" }),
    })
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
    let mode = AppMode::detect();
    let mut context = tauri::generate_context!();
    if mode.port != ledge_protocol_port() {
        if let Some(tauri::utils::config::Csp::Policy(csp)) = context.config_mut().app.security.csp.as_mut() { *csp = csp_for_port(csp, mode.port); }
    }
    tauri::Builder::default()
        // First, so a second launch exits before anything else starts; it brings this one forward instead.
        // A second launch from the island carries its target: this window shows it.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main(app);
            if let Some(target) = ledge_native::desktop::open_target(args) { deliver_open(app, target); }
        }))
        .manage(PendingOpen::default())
        .manage(mode)
        .manage(Keeper::default())
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
        .manage(media::Media::default())
        .invoke_handler(tauri::generate_handler![
            focus_terminal, foreground_is_terminal, open_terminal, open_url, daemon_token, get_autostart, set_autostart, set_tray_labels, take_open_target, check_snapshot_update,
            open_in_ledge, notch::set_frame, notch::set_hot_zone, notch::set_outside_watch, notch::focus_overlay, notch::release_focus,
            notch::list_monitors, notch::set_monitor, open_atelier, pty::pty_open, pty::pty_write, pty::pty_resize, pty::pty_close,
            media::now_playing, media::media_command, native_info, daemon_stop, daemon_resume,
        ])
        .setup(|app| {
            // WSL stops once no `wsl.exe` holds it: Ledge holds one from login until it quits, so the daemon stays reachable.
            // After the single-instance plugin, so a second launch never starts a second one.
            let run = subsystems(app.state::<AppMode>().mode);
            if run.keepalive { ledge_native::wsl_keepalive::start(); }
            build_tray(app)?;
            // Before the tray-only check: the notch shows even when the login item starts us minimized.
            // The notch's window is declared in tauri.conf.json, so Tauri has made it already: native mode closes it.
            if run.notch { notch::setup(app)?; } else if let Some(w) = app.get_webview_window(notch::NOTCH) { let _ = w.destroy(); }
            // What plays on the PC, for the closed notch (Windows' media controls).
            if run.media { media::start(app.handle().clone()); }
            // Native mode: Desktop runs the daemon (quitting Desktop leaves it running; the next launch adopts it).
            #[cfg(windows)]
            if run.supervisor { start_native(app.handle()); }
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
        .build(context)
        .expect("error while building Ledge Desktop")
        .run(|app, event| {
            // Managed state is never dropped on exit: the terminals' processes would be left to the OS to reap.
            if let tauri::RunEvent::Exit = event { app.state::<pty::PtyState>().close_all(); }
        });
}

#[cfg(test)]
mod tests {
    use super::{checked_target, csp_for_port, runtime_base, launched_minimized, on_close, subsystems, tray_shows_window, tray_title, CloseAction, Subsystems};
    use ledge_native::native::Mode;
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

    #[test]
    fn native_mode_supervises_the_daemon_and_starts_no_wsl_keepalive_nor_island() {
        assert_eq!(subsystems(Mode::Native), Subsystems { keepalive: false, notch: false, media: false, supervisor: true });
        assert_eq!(subsystems(Mode::Wsl), Subsystems { keepalive: true, notch: true, media: true, supervisor: false });
    }

    #[test]
    fn the_page_may_reach_the_daemon_on_the_port_in_use_only() {
        let csp = "default-src 'self'; connect-src ipc: http://ipc.localhost ws://127.0.0.1:47831";
        assert_eq!(csp_for_port(csp, 47831), csp);
        assert_eq!(csp_for_port(csp, 27832), "default-src 'self'; connect-src ipc: http://ipc.localhost ws://127.0.0.1:27832");
    }

    #[test]
    fn the_runtime_copies_live_in_local_app_data_not_in_the_roaming_profile() {
        use std::path::PathBuf;
        let home = PathBuf::from(r"C:\Users\po\.ledge");
        assert_eq!(runtime_base(Some(PathBuf::from(r"C:\Users\po\AppData\Local\dev.ledge.desktop")), &home), PathBuf::from(r"C:\Users\po\AppData\Local\dev.ledge.desktop"));
        assert_eq!(runtime_base(None, &home), home);
    }
}
