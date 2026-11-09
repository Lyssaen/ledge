//! « Ouvrir dans… » (IDE lot 11): opens a session's worktree in Cursor, VS Code or Zed, installed on Windows, while the
//! worktree lives in WSL or on a machine reached over SSH. Ledge edits no code: it only starts the editor.
//!
//! - Cursor and VS Code open a remote folder with `--folder-uri vscode-remote://wsl+<distro>/<path>` or
//!   `vscode-remote://ssh-remote+<alias>/<path>`. A folder already open in a window brings that window forward.
//! - Zed opens `ssh://<alias>/<path>`; it has no reliable way into a WSL folder, which is refused (`ZedWsl`).
//!
//! The editor is started directly (its `.exe`, never a `.cmd` through `cmd.exe`), its arguments passed one by one.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Editor { Cursor, VsCode, Zed }

impl Editor {
    /// The name the page sends: `cursor`, `vscode` or `zed`.
    pub fn parse(s: &str) -> Option<Editor> {
        match s { "cursor" => Some(Editor::Cursor), "vscode" => Some(Editor::VsCode), "zed" => Some(Editor::Zed), _ => None }
    }
}

/// Where the worktree is: in the WSL distribution `distro`, or on the machine Windows reaches as `alias` (its SSH config).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Place { Wsl { distro: String }, Ssh { alias: String } }

/// Why the editor did not open. `Missing`: not installed on this PC; `ZedWsl`: Zed and a WSL folder; `Exe`: the program
/// would not start; `Distro`: the WSL distribution's name is unknown; `Path`: a folder the editor cannot receive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal { Missing, ZedWsl, Exe, Distro, Path }

fn join(dir: &str, rest: &str) -> PathBuf { PathBuf::from(format!("{}\\{}", dir.trim_end_matches('\\'), rest)) }

/// Up `n` folders from a Windows path held as text (`C:\a\b\c`, 1 → `C:\a\b`).
fn up(dir: &str, n: usize) -> Option<String> {
    let mut d = dir.trim_end_matches('\\').to_string();
    for _ in 0..n { let i = d.rfind('\\')?; d.truncate(i); }
    (!d.is_empty()).then_some(d)
}

/// The editor's program: its usual install folders (per user, then for the machine), then a `bin` folder on PATH that
/// its installer added (`code.cmd`, `cursor.cmd`, `zed.exe`), traced back to the program. `env` reads a variable,
/// `exists` says whether a file is there.
pub fn locate(editor: Editor, env: &dyn Fn(&str) -> Option<String>, exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    let (folder, exe, shim, depth) = match editor {
        // Cursor: <root>\Cursor.exe, its CLI in <root>\resources\app\bin\cursor.cmd.
        Editor::Cursor => ("cursor", "Cursor.exe", "cursor.cmd", 3),
        // VS Code: <root>\Code.exe, its CLI in <root>\bin\code.cmd.
        Editor::VsCode => ("Microsoft VS Code", "Code.exe", "code.cmd", 1),
        // Zed: <root>\Zed.exe, its CLI in <root>\bin\zed.exe.
        Editor::Zed => ("Zed", "Zed.exe", "zed.exe", 1),
    };
    let installed = [("LocalAppData", true), ("ProgramFiles", false)].into_iter()
        .filter_map(|(var, programs)| env(var).filter(|d| !d.is_empty()).map(|d| if programs { join(&d, &format!("Programs\\{folder}\\{exe}")) } else { join(&d, &format!("{folder}\\{exe}")) }));
    let on_path: Vec<PathBuf> = env("PATH").unwrap_or_default().split(';').map(|d| d.trim().trim_matches('"')).filter(|d| !d.is_empty())
        .filter(|d| exists(&join(d, shim)))
        .filter_map(|d| up(d, depth)).map(|root| join(&root, exe)).collect();
    installed.chain(on_path).find(|p| exists(p))
}

/// A path or name as one URI segment run: letters, digits and `-._~/` as they are, every other byte (spaces, `#`, `?`,
/// `%`, accents in UTF-8) percent-encoded.
fn encode(s: &str, keep_slash: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        let plain = b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') || (keep_slash && b == b'/');
        if plain { out.push(b as char) } else { out.push_str(&format!("%{b:02X}")) }
    }
    out
}

/// A folder the editor can receive: absolute, and without a control character.
fn path_ok(path: &str) -> bool { path.starts_with('/') && !path.chars().any(|c| c.is_control()) }

/// An SSH alias as the machines list holds it: never a flag, user part or port.
fn alias_ok(a: &str) -> bool {
    let mut c = a.chars();
    matches!(c.next(), Some(f) if f.is_ascii_alphanumeric()) && a.len() <= 128 && c.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
}

/// The editor's arguments to open `path` at `place`.
pub fn args(editor: Editor, place: &Place, path: &str) -> Result<Vec<String>, Refusal> {
    if !path_ok(path) { return Err(Refusal::Path); }
    let remote = match place {
        Place::Wsl { distro } => {
            if editor == Editor::Zed { return Err(Refusal::ZedWsl); }
            if distro.is_empty() || distro.chars().any(|c| c.is_control()) { return Err(Refusal::Distro); }
            format!("wsl+{}", encode(distro, false))
        }
        Place::Ssh { alias } => {
            if !alias_ok(alias) { return Err(Refusal::Path); }
            if editor == Editor::Zed { return Ok(vec![format!("ssh://{alias}{}", encode(path, true))]); }
            format!("ssh-remote+{alias}")
        }
    };
    Ok(vec!["--folder-uri".into(), format!("vscode-remote://{remote}{}", encode(path, true))])
}

/// Which editors are installed on this PC.
pub fn available() -> [bool; 3] {
    let env = |k: &str| std::env::var(k).ok();
    let exists = |p: &Path| p.is_file();
    [Editor::Cursor, Editor::VsCode, Editor::Zed].map(|e| cfg!(windows) && locate(e, &env, &exists).is_some())
}

/// Opens `path` at `place` in `editor`.
pub fn open(editor: Editor, place: &Place, path: &str) -> Result<(), Refusal> {
    let argv = args(editor, place, path)?;
    #[cfg(windows)]
    {
        let env = |k: &str| std::env::var(k).ok();
        let program = locate(editor, &env, &|p: &Path| p.is_file()).ok_or(Refusal::Missing)?;
        return std::process::Command::new(program).args(argv).spawn().map(|_| ()).map_err(|_| Refusal::Exe);
    }
    #[cfg(not(windows))]
    { let _ = argv; Err(Refusal::Missing) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k| m.get(k).cloned()
    }
    fn files(list: &[&str]) -> impl Fn(&Path) -> bool {
        let l: Vec<PathBuf> = list.iter().map(PathBuf::from).collect();
        move |p| l.iter().any(|f| f == p)
    }
    const LOCAL: &str = r"C:\Users\me\AppData\Local";
    fn wsl() -> Place { Place::Wsl { distro: "Ubuntu-24.04".into() } }

    #[test] fn parse_knows_three_editors() {
        assert_eq!(Editor::parse("cursor"), Some(Editor::Cursor));
        assert_eq!(Editor::parse("vscode"), Some(Editor::VsCode));
        assert_eq!(Editor::parse("zed"), Some(Editor::Zed));
        assert_eq!(Editor::parse("Cursor"), None);
    }
    #[test] fn each_editor_is_found_in_its_per_user_folder() {
        let env = env_of(&[("LocalAppData", LOCAL), ("ProgramFiles", r"C:\Program Files")]);
        let all = files(&[r"C:\Users\me\AppData\Local\Programs\cursor\Cursor.exe", r"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe", r"C:\Users\me\AppData\Local\Programs\Zed\Zed.exe"]);
        assert_eq!(locate(Editor::Cursor, &env, &all), Some(PathBuf::from(r"C:\Users\me\AppData\Local\Programs\cursor\Cursor.exe")));
        assert_eq!(locate(Editor::VsCode, &env, &all), Some(PathBuf::from(r"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe")));
        assert_eq!(locate(Editor::Zed, &env, &all), Some(PathBuf::from(r"C:\Users\me\AppData\Local\Programs\Zed\Zed.exe")));
    }
    #[test] fn a_machine_wide_install_is_found_in_program_files() {
        let env = env_of(&[("LocalAppData", LOCAL), ("ProgramFiles", r"C:\Program Files")]);
        let got = locate(Editor::VsCode, &env, &files(&[r"C:\Program Files\Microsoft VS Code\Code.exe"]));
        assert_eq!(got, Some(PathBuf::from(r"C:\Program Files\Microsoft VS Code\Code.exe")));
    }
    #[test] fn an_install_elsewhere_is_traced_back_from_its_cli_on_path() {
        let env = env_of(&[("PATH", r#"C:\bin;"D:\Tools\VSCode\bin";D:\Apps\Cursor\resources\app\bin\"#)]);
        let fs = files(&[r"D:\Tools\VSCode\bin\code.cmd", r"D:\Tools\VSCode\Code.exe", r"D:\Apps\Cursor\resources\app\bin\cursor.cmd", r"D:\Apps\Cursor\Cursor.exe"]);
        assert_eq!(locate(Editor::VsCode, &env, &fs), Some(PathBuf::from(r"D:\Tools\VSCode\Code.exe")));
        assert_eq!(locate(Editor::Cursor, &env, &fs), Some(PathBuf::from(r"D:\Apps\Cursor\Cursor.exe")));
    }
    #[test] fn nothing_installed_is_none() {
        let env = env_of(&[("LocalAppData", LOCAL), ("ProgramFiles", r"C:\Program Files"), ("PATH", r"C:\bin")]);
        for e in [Editor::Cursor, Editor::VsCode, Editor::Zed] { assert_eq!(locate(e, &env, &files(&[])), None); }
        // A CLI on PATH whose program is gone is not an install.
        let env = env_of(&[("PATH", r"D:\VSCode\bin")]);
        assert_eq!(locate(Editor::VsCode, &env, &files(&[r"D:\VSCode\bin\code.cmd"])), None);
    }
    #[test] fn cursor_and_vs_code_open_a_wsl_folder_by_its_remote_uri() {
        let want = vec!["--folder-uri".to_string(), "vscode-remote://wsl+Ubuntu-24.04/home/jde/Workspace/ledge-worktrees/a-b".to_string()];
        assert_eq!(args(Editor::Cursor, &wsl(), "/home/jde/Workspace/ledge-worktrees/a-b"), Ok(want.clone()));
        assert_eq!(args(Editor::VsCode, &wsl(), "/home/jde/Workspace/ledge-worktrees/a-b"), Ok(want));
    }
    #[test] fn and_a_folder_on_a_machine_over_ssh() {
        let ssh = Place::Ssh { alias: "srv-build".into() };
        assert_eq!(args(Editor::VsCode, &ssh, "/srv/app"), Ok(vec!["--folder-uri".into(), "vscode-remote://ssh-remote+srv-build/srv/app".into()]));
        assert_eq!(args(Editor::Zed, &ssh, "/srv/app"), Ok(vec!["ssh://srv-build/srv/app".into()]));
    }
    #[test] fn spaces_accents_hash_and_percent_are_encoded() {
        let got = args(Editor::Cursor, &wsl(), "/home/élise/my repo#1/50%?").unwrap();
        assert_eq!(got[1], "vscode-remote://wsl+Ubuntu-24.04/home/%C3%A9lise/my%20repo%231/50%25%3F");
    }
    #[test] fn zed_never_opens_a_wsl_folder() {
        assert_eq!(args(Editor::Zed, &wsl(), "/home/jde/x"), Err(Refusal::ZedWsl));
    }
    #[test] fn an_unknown_distribution_or_a_path_the_editor_cannot_take_is_refused() {
        assert_eq!(args(Editor::Cursor, &Place::Wsl { distro: String::new() }, "/home/x"), Err(Refusal::Distro));
        for bad in ["", "relative/x", "/a\nb", "/a\tb"] { assert_eq!(args(Editor::Cursor, &wsl(), bad), Err(Refusal::Path), "{bad:?}"); }
        for alias in ["-oProxyCommand=x", "me@host", "host:22", "", "a b"] {
            assert_eq!(args(Editor::VsCode, &Place::Ssh { alias: alias.into() }, "/x"), Err(Refusal::Path), "{alias:?}");
        }
    }
    #[cfg(not(windows))]
    #[test] fn off_windows_no_editor_is_found() {
        assert_eq!(available(), [false, false, false]);
        assert_eq!(open(Editor::Cursor, &wsl(), "/home/x"), Err(Refusal::Missing));
    }
}
