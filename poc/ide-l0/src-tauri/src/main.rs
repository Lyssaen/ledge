//! Lot 0 of the IDE rework, a throwaway proof. It answers three questions before anything is built for real:
//! 1. Does `window.open` give a real Tauri window, in the same WebView2 environment, that the main page can script
//!    (dockview renders the popout group into it from the main document)?
//! 2. Does a pseudo-terminal opened by the main page show in that popout (its `Channel` stays the main page's)?
//! 3. Does it stay fluid: 3 windows, 16 terminals, 6 of them printing, threads scrolling?
//! The page measures and writes its results to `%USERPROFILE%\ledge-poc-l0-results.json`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use ledge_native::pty::Pty;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
struct PtyState { ptys: Mutex<HashMap<u32, Pty>>, next: AtomicU32 }

/// Starts `program args` in a pseudo-terminal; output to `on_data`, exit code to `on_exit`. The channels belong to
/// the page that called: the main page, even when the xterm it feeds sits in a popout window.
#[tauri::command]
async fn pty_open(app: AppHandle, program: String, args: Vec<String>, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>, on_exit: Channel<Option<u32>>) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PtyState>();
        let id = state.next.fetch_add(1, Ordering::Relaxed);
        let mut ptys = state.ptys.lock().unwrap();
        let exit_app = app.clone();
        let pty = Pty::spawn(&program, &args, cols, rows, move |b| { let _ = on_data.send(InvokeResponseBody::Raw(b.to_vec())); }, move |code| {
            let gone = exit_app.state::<PtyState>().ptys.lock().unwrap().remove(&id);
            drop(gone);
            let _ = on_exit.send(code);
        }).map_err(|e| format!("{program}: {e}"))?;
        ptys.insert(id, pty);
        Ok(id)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn pty_write(state: State<PtyState>, id: u32, data: String) -> Result<(), String> {
    match state.ptys.lock().unwrap().get(&id) { Some(p) => p.write(data.as_bytes()).map_err(|e| e.to_string()), None => Ok(()) }
}

#[tauri::command]
fn pty_resize(state: State<PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    match state.ptys.lock().unwrap().get(&id) { Some(p) => p.resize(cols, rows).map_err(|e| e.to_string()), None => Ok(()) }
}

#[tauri::command]
fn pty_close(state: State<PtyState>, id: u32) {
    let gone = state.ptys.lock().unwrap().remove(&id);
    if let Some(p) = gone { p.kill(); }
}

/// Writes the measurements next to the user's profile, where they can be read back from WSL.
#[tauri::command]
fn save_results(json: String) -> Result<String, String> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map_err(|e| e.to_string())?;
    let path = std::path::Path::new(&home).join("ledge-poc-l0-results.json");
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Closes a popout window by its label: in a desktop webview the page's own `close()` may do nothing.
#[tauri::command]
fn close_window(app: AppHandle, label: String) {
    if label != "main" { if let Some(w) = app.get_webview_window(&label) { let _ = w.close(); } }
}

/// The labels of the open windows, for the results.
#[tauri::command]
fn window_labels(app: AppHandle) -> Vec<String> { app.webview_windows().keys().cloned().collect() }

fn main() {
    tauri::Builder::default()
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![pty_open, pty_write, pty_resize, pty_close, save_results, close_window, window_labels])
        .setup(|app| {
            let handle = app.handle().clone();
            let count = Arc::new(AtomicU32::new(0));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Ledge · POC lot 0 · fenêtre 1")
                .inner_size(1600.0, 1000.0)
                .disable_drag_drop_handler()
                // window.open → a real window in the opener's WebView2 environment, so the opener can script it.
                .on_new_window(move |_url, features| {
                    let n = count.fetch_add(1, Ordering::Relaxed);
                    let built = WebviewWindowBuilder::new(&handle, format!("pop-{n}"), WebviewUrl::External("about:blank".parse().unwrap()))
                        .window_features(features)
                        // Tauri's file-drop handler takes the drags: tabs could not move between windows.
                        .disable_drag_drop_handler()
                        .title(format!("Ledge · POC lot 0 · fenêtre {}", n + 2))
                        .build();
                    match built {
                        Ok(window) => NewWindowResponse::Create { window },
                        Err(e) => { eprintln!("popout window: {e}"); NewWindowResponse::Deny }
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("POC lot 0");
}
