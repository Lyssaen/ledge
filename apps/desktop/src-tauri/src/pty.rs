//! The embedded terminal's commands: each `pty_open` runs `wsl.exe` in a pseudo-terminal the page reads and types into.

use std::collections::HashMap;
use std::sync::atomic::AtomicU32;
use std::sync::Mutex;

use ledge_native::pty::Pty;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

/// The open terminals, by the id the page holds.
#[derive(Default)]
pub struct PtyState { ptys: Mutex<HashMap<u32, Pty>>, next: AtomicU32 }

impl PtyState {
    /// Ends every terminal's process (a `Pty` kills its child when dropped): what quitting Ledge owes its shells.
    pub fn close_all(&self) {
        // Dropped outside the lock: an exit callback takes it to remove its own entry.
        let all = std::mem::take(&mut *self.ptys.lock().unwrap());
        drop(all);
    }
}

/// Which terminals the page can offer: the WSL distribution's name (`""` when unnamed), and whether each Windows shell is installed.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellsAvailable { pub wsl: Option<String>, pub powershell: bool, pub cmd: bool, pub git_bash: bool }

/// Asks WSL for its distribution (up to 3 s) and looks for the Windows shells.
#[tauri::command]
pub async fn shells_available() -> ShellsAvailable {
    #[cfg(not(windows))]
    { ShellsAvailable { wsl: None, powershell: false, cmd: false, git_bash: false } }
    #[cfg(windows)]
    {
        use ledge_native::shells::{locate, NativeShell};
        tauri::async_runtime::spawn_blocking(|| {
            let env = |k: &str| std::env::var(k).ok();
            let exists = |p: &std::path::Path| p.is_file();
            let found = |s| locate(s, &env, &exists).is_some();
            ShellsAvailable { wsl: ledge_native::shells::wsl_distro(), powershell: found(NativeShell::PowerShell), cmd: found(NativeShell::Cmd), git_bash: found(NativeShell::GitBash) }
        // A panicked probe: the page still offers WSL (as unnamed) and no Windows shell, the safe minimum.
        }).await.unwrap_or(ShellsAvailable { wsl: Some(String::new()), powershell: false, cmd: false, git_bash: false })
    }
}

/// Starts `argv` in WSL, or the Windows shell `native` names (then `argv` is ignored), sized `cols`×`rows`: the output goes to `on_data` as raw bytes, the exit code to `on_exit`
/// (`null` once closed). Blocking: spawning `wsl.exe` waits on the system.
#[tauri::command]
pub async fn pty_open(app: AppHandle, argv: Vec<String>, native: Option<String>, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>, on_exit: Channel<Option<u32>>) -> Result<u32, String> {
    #[cfg(not(windows))]
    { let _ = (app, argv, native, cols, rows, on_data, on_exit); Err("windows only".into()) }
    #[cfg(windows)]
    {
        use std::sync::atomic::Ordering;
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || {
            // The page names a shell, never a path: the program comes from `locate`.
            let (program, args, cwd) = match native {
                Some(name) => {
                    use ledge_native::shells::{locate, NativeShell};
                    let shell = NativeShell::parse(&name).ok_or("unknown shell")?;
                    let (p, a, c) = locate(shell, &|k| std::env::var(k).ok(), &|p| p.is_file()).ok_or("shell not installed")?;
                    (p.to_string_lossy().into_owned(), a, c)
                }
                None => ("wsl.exe".to_string(), ledge_native::pty::wsl_command(&argv).ok_or("an argument WSL cannot receive as is")?, None),
            };
            let state = app.state::<PtyState>();
            let id = state.next.fetch_add(1, Ordering::Relaxed);
            // Held until the entry is in: an exit that comes first waits for it, then removes it.
            let mut ptys = state.ptys.lock().unwrap();
            let exit_app = app.clone();
            let pty = Pty::spawn(&program, &args, cwd.as_deref(), cols, rows, move |b| { let _ = on_data.send(InvokeResponseBody::Raw(b.to_vec())); }, move |code| {
                let gone = exit_app.state::<PtyState>().ptys.lock().unwrap().remove(&id);
                drop(gone);
                let _ = on_exit.send(code);
            }).map_err(|e| format!("{program}: {e}"))?;
            ptys.insert(id, pty);
            Ok(id)
        }).await.map_err(|e| e.to_string())?
    }
}

/// Types `data` into terminal `id`; one already gone is no error.
#[tauri::command]
pub fn pty_write(state: State<PtyState>, id: u32, data: String) -> Result<(), String> {
    match state.ptys.lock().unwrap().get(&id) { Some(p) => p.write(data.as_bytes()).map_err(|e| e.to_string()), None => Ok(()) }
}

#[tauri::command]
pub fn pty_resize(state: State<PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    match state.ptys.lock().unwrap().get(&id) { Some(p) => p.resize(cols, rows).map_err(|e| e.to_string()), None => Ok(()) }
}

/// Kills terminal `id`; its `on_exit` then says `null`.
#[tauri::command]
pub fn pty_close(state: State<PtyState>, id: u32) -> Result<(), String> {
    let gone = state.ptys.lock().unwrap().remove(&id);
    if let Some(p) = gone { p.kill(); }
    Ok(())
}
