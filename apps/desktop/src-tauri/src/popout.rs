//! The IDE's popout windows (lot 9, plan 3.1): `window.open` from the main page becomes a real Tauri window in the
//! main window's WebView2 environment, so the main document still scripts it and renders into it (one React tree,
//! one daemon connection, the same PTY channels). The page names the window in the URL's fragment
//! (`#ide-win=<id>`, its id in the workspace model): the label `ide-<id>` stays the same from one opening to the next,
//! so the window-state plugin gives each model window back its screen, position and size.

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

/// Every popout's label starts with this; nothing else does.
pub const PREFIX: &str = "ide-";
/// What the main page hears when a popout is gone (closed by Ledge, by the OS, Alt+F4): the label as payload.
pub const CLOSED_EVENT: &str = "ledge://popout-closed";
const MIN_WIDTH: f64 = 480.0;
const MIN_HEIGHT: f64 = 360.0;

/// The model window's id the page put in the fragment (`ide-win=w5`, among other `&`-separated pairs): letters,
/// digits, `_` and `-`, 1 to 32 of them. Anything else is not a popout Ledge asked for.
pub fn window_id(url: &Url) -> Option<String> {
    let id = url.fragment()?.split('&').find_map(|pair| pair.strip_prefix("ide-win="))?;
    let ok = !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    ok.then(|| id.to_string())
}

pub fn label(id: &str) -> String { format!("{PREFIX}{id}") }

pub fn is_popout(label: &str) -> bool { label.starts_with(PREFIX) }

/// The main window's `window.open` handler. A URL without `#ide-win=` keeps WebView2's own behaviour, as before lot 9.
/// A popout already open is brought forward and the new one refused (the page never opens the same window twice).
pub fn on_new_window(app: &AppHandle, url: Url, features: NewWindowFeatures) -> NewWindowResponse<Wry> {
    let Some(id) = window_id(&url) else { return NewWindowResponse::Allow };
    let label = label(&id);
    if let Some(open) = app.get_webview_window(&label) {
        let _ = open.set_focus();
        return NewWindowResponse::Deny;
    }
    // about:blank: the opener writes the document (dockview's popout group), as in the lot 0 proof.
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::External("about:blank".parse().expect("about:blank")))
        // The opener's WebView2 environment (Windows): without it the opener cannot script the window.
        .window_features(features)
        .title("Ledge Desktop")
        // Ledge's own window bar, as on the main window.
        .decorations(false)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        // Tauri's file-drop handler takes the drags: tabs could not move between windows.
        .disable_drag_drop_handler()
        .build();
    match built {
        Ok(window) => { keep_on_screen(&window); NewWindowResponse::Create { window } }
        Err(_) => NewWindowResponse::Deny,
    }
}

/// A rectangle in physical pixels: x, y, width, height.
pub type Rect = (i32, i32, u32, u32);

fn overlaps(a: Rect, b: Rect) -> bool {
    let (ax2, ay2) = (a.0 as i64 + a.2 as i64, a.1 as i64 + a.3 as i64);
    let (bx2, by2) = (b.0 as i64 + b.2 as i64, b.1 as i64 + b.3 as i64);
    (a.0 as i64) < bx2 && (b.0 as i64) < ax2 && (a.1 as i64) < by2 && (b.1 as i64) < ay2
}

/// Where the window goes: where it is when it overlaps a monitor, else centred on the primary monitor (a screen
/// unplugged since it was saved). The window-state plugin, finding no monitor for a saved position, leaves the window
/// where the OS put it, which is not always the primary screen.
pub fn placed(window: Rect, monitors: &[Rect], primary: Option<Rect>) -> Option<(i32, i32)> {
    if monitors.iter().any(|m| overlaps(window, *m)) { return None; }
    let p = primary.or_else(|| monitors.first().copied())?;
    let x = p.0 as i64 + (p.2 as i64 - window.2 as i64).max(0) / 2;
    let y = p.1 as i64 + (p.3 as i64 - window.3 as i64).max(0) / 2;
    Some((x as i32, y as i32))
}

fn keep_on_screen(w: &WebviewWindow<Wry>) {
    let (Ok(pos), Ok(size), Ok(monitors)) = (w.outer_position(), w.outer_size(), w.available_monitors()) else { return };
    let rect = |m: &tauri::Monitor| (m.position().x, m.position().y, m.size().width, m.size().height);
    let all: Vec<Rect> = monitors.iter().map(rect).collect();
    let primary = w.primary_monitor().ok().flatten().map(|m| rect(&m));
    if let Some((x, y)) = placed((pos.x, pos.y, size.width, size.height), &all, primary) {
        let _ = w.set_position(tauri::PhysicalPosition { x, y });
    }
}

/// Closes a popout: in a desktop webview the page's own `close()` does nothing. Only a popout: never the main window,
/// the notch or anything else.
#[tauri::command]
pub fn close_window(app: AppHandle, label: String) -> Result<(), String> {
    if !is_popout(&label) { return Err(format!("not a popout window: {label}")); }
    match app.get_webview_window(&label) { Some(w) => w.close().map_err(|e| e.to_string()), None => Ok(()) }
}

/// The popouts hidden with the main window (its ✕ hides it to the tray), to show again with it, where they were.
#[derive(Default)]
pub struct HiddenWithMain(std::sync::Mutex<Vec<String>>);

/// `had` plus `more`, each label once, in order.
pub fn with_hidden(mut had: Vec<String>, more: Vec<String>) -> Vec<String> {
    for l in more { if !had.contains(&l) { had.push(l); } }
    had
}

/// The main window hides (docs/ide-workspace.md, « Fenêtres détachées », v27): the visible popouts hide with it. Minimising the
/// main window does not come here; quitting closes every window anyway.
pub fn hide_with_main(app: &AppHandle) {
    let mut hidden = Vec::new();
    for (label, w) in app.webview_windows() {
        if is_popout(&label) && w.is_visible().unwrap_or(false) && w.hide().is_ok() { hidden.push(label); }
    }
    if let Some(state) = app.try_state::<HiddenWithMain>() {
        let mut list = state.0.lock().unwrap();
        *list = with_hidden(std::mem::take(&mut *list), hidden);
    }
}

/// The main window shows again (tray, second launch, the island): the popouts hidden with it come back, at their place.
pub fn show_with_main(app: &AppHandle) {
    let labels = app.try_state::<HiddenWithMain>().map(|s| std::mem::take(&mut *s.0.lock().unwrap())).unwrap_or_default();
    for label in labels { if let Some(w) = app.get_webview_window(&label) { let _ = w.show(); } }
}

/// Tells the main page a popout is gone, however it was closed.
pub fn on_destroyed(app: &AppHandle, label: &str) {
    if is_popout(label) { let _ = app.emit_to(crate::MAIN, CLOSED_EVENT, label.to_string()); }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn url(s: &str) -> Url { s.parse().unwrap() }

    #[test] fn the_model_window_id_comes_from_the_fragment() {
        assert_eq!(window_id(&url("http://tauri.localhost/index.html#ide-win=w5")), Some("w5".into()));
        assert_eq!(window_id(&url("http://localhost:1421/#popout=1&ide-win=w_12-b")), Some("w_12-b".into()));
        assert_eq!(label("w5"), "ide-w5");
    }
    #[test] fn a_url_without_a_valid_id_is_not_a_popout() {
        for s in ["http://tauri.localhost/index.html", "http://tauri.localhost/#ide-win=", "http://tauri.localhost/#ide-win=a/b",
                  "http://tauri.localhost/#ide-win=..", "http://tauri.localhost/?ide-win=w5", "https://example.com/#x=1"] {
            assert_eq!(window_id(&url(s)), None, "{s}");
        }
        let long = format!("http://tauri.localhost/#ide-win={}", "a".repeat(33));
        assert_eq!(window_id(&url(&long)), None);
    }
    #[test] fn only_popouts_can_be_closed_by_the_command() {
        assert!(is_popout("ide-w5"));
        for l in ["main", "notch", "atelier", "", "ide"] { assert!(!is_popout(l), "{l}"); }
    }
    #[test] fn the_popouts_hidden_with_the_main_window_are_kept_once_each() {
        let l = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(with_hidden(l(&["ide-w2"]), l(&["ide-w5", "ide-w2"])), l(&["ide-w2", "ide-w5"]));
        assert_eq!(with_hidden(vec![], vec![]), Vec::<String>::new());
    }
    #[test] fn a_window_on_a_screen_stays_where_it_is() {
        let screens = [(0, 0, 1920, 1080), (1920, 0, 2560, 1440)];
        assert_eq!(placed((2000, 100, 800, 600), &screens, Some(screens[0])), None);
        // Half off the edge still overlaps: left alone.
        assert_eq!(placed((-400, 100, 800, 600), &screens, Some(screens[0])), None);
    }
    #[test] fn a_window_on_an_unplugged_screen_is_centred_on_the_primary_one() {
        let screens = [(0, 0, 1920, 1080)];
        assert_eq!(placed((2000, 100, 800, 600), &screens, Some(screens[0])), Some((560, 240)));
        // Primary to the right of another screen; a window bigger than it goes to its corner.
        let two = [(-1280, 0, 1280, 1024), (0, 0, 1920, 1080)];
        assert_eq!(placed((5000, 5000, 2400, 1200), &two, Some(two[1])), Some((0, 0)));
        // No primary known: the first monitor.
        assert_eq!(placed((5000, 0, 800, 600), &screens, None), Some((560, 240)));
        assert_eq!(placed((5000, 0, 800, 600), &[], None), None);
    }
}
