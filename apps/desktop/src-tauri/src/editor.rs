//! « Ouvrir dans… » (IDE lot 11): the page's two commands over ledge_native::editor.

use ledge_native::editor::{self, Editor, Place, Refusal};
use serde_json::{json, Value};
use std::sync::Mutex;

/// The WSL distribution's name, once WSL gave one: it does not change while Ledge runs. A failed read is retried next time.
static DISTRO: Mutex<Option<String>> = Mutex::new(None);

fn distro() -> String {
    if let Some(d) = DISTRO.lock().unwrap().clone() { return d; }
    #[cfg(windows)]
    let read = ledge_native::shells::wsl_distro().unwrap_or_default();
    #[cfg(not(windows))]
    let read = String::new();
    if !read.is_empty() { *DISTRO.lock().unwrap() = Some(read.clone()); }
    read
}

/// The editors installed on this PC: `{ cursor, vscode, zed }`.
#[tauri::command]
pub async fn editors_available() -> Value {
    let [cursor, vscode, zed] = tauri::async_runtime::spawn_blocking(editor::available).await.unwrap_or([false; 3]);
    json!({ "cursor": cursor, "vscode": vscode, "zed": zed })
}

/// Opens `path` in `editor` (`cursor`, `vscode`, `zed`): in WSL, or on the machine Windows reaches as `ssh` (its alias).
/// `{ kind: "opened" }`, `{ kind: "missing" }`, `{ kind: "zedWsl" }`, or `{ kind: "failed", reason: "exe" | "distro" | "path" }`.
#[tauri::command]
pub async fn open_in_editor(editor: String, path: String, ssh: Option<String>) -> Value {
    let Some(e) = Editor::parse(&editor) else { return json!({ "kind": "failed", "reason": "exe" }) };
    let done = tauri::async_runtime::spawn_blocking(move || {
        let place = match ssh { Some(alias) => Place::Ssh { alias }, None => Place::Wsl { distro: if e == Editor::Zed { String::new() } else { distro() } } };
        editor::open(e, &place, &path)
    }).await.unwrap_or(Err(Refusal::Exe));
    match done {
        Ok(()) => json!({ "kind": "opened" }),
        Err(Refusal::Missing) => json!({ "kind": "missing" }),
        Err(Refusal::ZedWsl) => json!({ "kind": "zedWsl" }),
        Err(Refusal::Exe) => json!({ "kind": "failed", "reason": "exe" }),
        Err(Refusal::Distro) => json!({ "kind": "failed", "reason": "distro" }),
        Err(Refusal::Path) => json!({ "kind": "failed", "reason": "path" }),
    }
}
