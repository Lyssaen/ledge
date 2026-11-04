//! Ledge Desktop on Windows without WSL (spec 2026-11-03 §4.2.4): which mode Desktop runs in, where the daemon's folder,
//! port and runtime are, and the token read straight from its file.

use std::path::{Path, PathBuf};

use crate::daemon_token::{valid_token, TokenRead};

/// How Desktop reaches its daemon: inside WSL (today's users), or natively on Windows with the daemon it runs itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode { Native, Wsl }

/// Native only when no WSL distribution is registered: a PC with WSL keeps today's mode (spec §4.2.4). `override_`
/// (`LEDGE_DESKTOP_MODE`, for tests on a PC that has WSL) wins when it is `native` or `wsl`; anything else is ignored.
pub fn choose_mode(override_: Option<&str>, wsl_has_distro: bool) -> Mode {
    match override_ {
        Some("native") => Mode::Native,
        Some("wsl") => Mode::Wsl,
        _ if wsl_has_distro => Mode::Wsl,
        _ => Mode::Native,
    }
}

/// Whether this user has a WSL distribution registered (`HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss` has a
/// subkey). Read from the registry: no `wsl.exe` started, which on a PC without WSL may offer to install it.
#[cfg(windows)]
pub fn wsl_has_distro() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegQueryInfoKeyW, HKEY, HKEY_CURRENT_USER, KEY_READ};
    let mut key = HKEY::default();
    if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Lxss"), 0, KEY_READ, &mut key) }.is_err() { return false; }
    let mut subkeys = 0u32;
    let ok = unsafe { RegQueryInfoKeyW(key, windows::core::PWSTR::null(), None, None, Some(&mut subkeys), None, None, None, None, None, None, None) }.is_ok();
    unsafe { let _ = RegCloseKey(key); }
    ok && subkeys > 0
}

#[cfg(not(windows))]
pub fn wsl_has_distro() -> bool { false }

fn non_empty(env: &dyn Fn(&str) -> Option<String>, k: &str) -> Option<String> { env(k).filter(|v| !v.is_empty()) }

/// The daemon's folder, as the CLI computes it: `LEDGE_HOME`, else `%USERPROFILE%\.ledge`.
pub fn ledge_home(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    non_empty(env, "LEDGE_HOME").map(PathBuf::from).or_else(|| non_empty(env, "USERPROFILE").map(|h| PathBuf::from(h).join(".ledge")))
}

/// The daemon's port: 47831, or a valid `LEDGE_PORT` (tests on a PC whose mirrored WSL reserves the usual one).
pub fn port(env: &dyn Fn(&str) -> Option<String>) -> u16 {
    env("LEDGE_PORT").and_then(|v| v.trim().parse::<u16>().ok()).filter(|p| *p != 0).unwrap_or(47831)
}

/// The Node runtime and the Ledge CLI Desktop runs the daemon with; the bundled one also brings Git Bash (Claude Code needs
/// it on Windows) and says its version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime { pub node: PathBuf, pub cli: PathBuf, pub git_bash: Option<PathBuf>, pub git_cmd: Option<PathBuf>, pub version: Option<String> }

impl Runtime {
    /// A runtime of a node and a CLI only (the `LEDGE_NODE`/`LEDGE_CLI` override).
    pub fn plain(node: PathBuf, cli: PathBuf) -> Runtime { Runtime { node, cli, git_bash: None, git_cmd: None, version: None } }
}

/// Where the runtime comes from: the test override, run as is, or the installer's bundle, run from a per-version copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeSource { Override(Runtime), Bundled(PathBuf) }

/// `LEDGE_NODE` + `LEDGE_CLI` when both are set and there, else the bundled `<resources>/runtime` (assemble.mjs) when it
/// holds a node and a CLI, else none.
pub fn runtime_source(env: &dyn Fn(&str) -> Option<String>, resource_dir: Option<&Path>, exists: &dyn Fn(&Path) -> bool) -> Option<RuntimeSource> {
    if let (Some(node), Some(cli)) = (non_empty(env, "LEDGE_NODE"), non_empty(env, "LEDGE_CLI")) {
        let rt = Runtime::plain(node.into(), cli.into());
        if exists(&rt.node) && exists(&rt.cli) { return Some(RuntimeSource::Override(rt)); }
    }
    let base = resource_dir?.join("runtime");
    runtime_from_dir(&base, exists)?;
    Some(RuntimeSource::Bundled(base))
}

/// The runtime laid out in `dir` as assemble.mjs makes it: `node.exe`, `ledge\dist\cli\index.js`, `git\bin\bash.exe`,
/// `git\cmd`, `VERSION`. None without a node and a CLI.
pub fn runtime_from_dir(dir: &Path, exists: &dyn Fn(&Path) -> bool) -> Option<Runtime> {
    let node = dir.join("node.exe");
    let cli = dir.join("ledge").join("dist").join("cli").join("index.js");
    if !exists(&node) || !exists(&cli) { return None; }
    let bash = dir.join("git").join("bin").join("bash.exe");
    let cmd = dir.join("git").join("cmd");
    let version = std::fs::read_to_string(dir.join("VERSION")).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    Some(Runtime { node, cli, git_bash: exists(&bash).then_some(bash), git_cmd: exists(&cmd).then_some(cmd), version })
}

const COMPLETE: &str = ".complete";

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() { copy_dir(&entry.path(), &target)?; } else { std::fs::copy(entry.path(), &target)?; }
    }
    Ok(())
}

/// The bundled runtime copied to `<base>\runtime\<version>` (Desktop's local app data), once per version, and run from there: an update may then
/// replace the install folder while the daemon and the pane host still run their copy. A copy is used only once marked
/// complete: it is made in a temporary folder, marked, then renamed (another Desktop winning the race keeps its own).
pub fn stage_runtime(bundled: &Path, home: &Path) -> std::io::Result<PathBuf> {
    let version = std::fs::read_to_string(bundled.join("VERSION"))?.trim().to_string();
    if version.is_empty() || version.contains(['/', '\\']) || version.starts_with('.') { return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "bad runtime VERSION")); }
    let root = home.join("runtime");
    let target = root.join(&version);
    if target.join(COMPLETE).exists() { return Ok(target); }
    let tmp = root.join(format!("{version}.tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy_dir(bundled, &tmp)?;
    std::fs::write(tmp.join(COMPLETE), b"")?;
    // A target without its mark is a copy cut short: it is replaced.
    if target.exists() && !target.join(COMPLETE).exists() { let _ = std::fs::remove_dir_all(&target); }
    match std::fs::rename(&tmp, &target) {
        Ok(()) => Ok(target),
        Err(_) if target.join(COMPLETE).exists() => { let _ = std::fs::remove_dir_all(&tmp); Ok(target) }
        Err(e) => { let _ = std::fs::remove_dir_all(&tmp); Err(e) }
    }
}

/// Whether a process runs from the copy in `dir`: everything that loads a copy runs its `node.exe` (the daemon, the pane
/// host, a hook), and Windows refuses to open a running program for writing. Its folder, though, can still be renamed.
fn in_use(dir: &Path) -> bool {
    let node = dir.join("node.exe");
    node.exists() && std::fs::OpenOptions::new().write(true).open(&node).is_err()
}

/// Removes every copy under `<home>\runtime` but `keep`, and leftovers of cut copies; returns the versions removed. A copy
/// whose `node.exe` runs is kept; any other is first renamed aside, which Windows refuses while one of its files is held:
/// a copy is never half deleted under a running pane host.
pub fn prune_runtimes(home: &Path, keep: &str) -> Vec<String> {
    let root = home.join("runtime");
    let Ok(entries) = std::fs::read_dir(&root) else { return Vec::new() };
    let mut gone = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == keep || !entry.path().is_dir() { continue; }
        if name.contains(".tmp-") || name.contains(".trash-") { let _ = std::fs::remove_dir_all(entry.path()); continue; }
        if in_use(&entry.path()) { continue; }
        let aside = root.join(format!("{name}.trash-{}", std::process::id()));
        if std::fs::rename(entry.path(), &aside).is_err() { continue; }
        let _ = std::fs::remove_dir_all(&aside);
        gone.push(name);
    }
    gone
}

/// The token in `path`: `Absent` when there is no file yet (the daemon writes it at its first start).
pub fn read_token_file(path: &Path) -> TokenRead {
    match std::fs::read(path) {
        Ok(bytes) => valid_token(&bytes).map_or(TokenRead::Unavailable, TokenRead::Token),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => TokenRead::Absent,
        Err(_) => TokenRead::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(m: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |k: &str| m.iter().find(|(a, _)| *a == k).map(|(_, v)| v.to_string())
    }
    const HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test] fn choose_mode_is_native_only_without_a_wsl_distro() {
        assert_eq!(choose_mode(None, true), Mode::Wsl);
        assert_eq!(choose_mode(None, false), Mode::Native);
        assert_eq!(choose_mode(Some("native"), true), Mode::Native);
        assert_eq!(choose_mode(Some("wsl"), false), Mode::Wsl);
        assert_eq!(choose_mode(Some("bogus"), true), Mode::Wsl);
        assert_eq!(choose_mode(Some("bogus"), false), Mode::Native);
    }
    #[test] fn ledge_home_is_ledge_home_else_userprofile_dot_ledge() {
        assert_eq!(ledge_home(&env(&[("USERPROFILE", r"C:\Users\po")])), Some(PathBuf::from(r"C:\Users\po").join(".ledge")));
        assert_eq!(ledge_home(&env(&[("LEDGE_HOME", r"D:\l"), ("USERPROFILE", r"C:\Users\po")])), Some(PathBuf::from(r"D:\l")));
        assert_eq!(ledge_home(&env(&[("LEDGE_HOME", ""), ("USERPROFILE", r"C:\Users\po")])), Some(PathBuf::from(r"C:\Users\po").join(".ledge")));
        assert_eq!(ledge_home(&env(&[])), None);
    }
    #[test] fn port_is_47831_unless_a_valid_override() {
        assert_eq!(port(&env(&[])), 47831);
        assert_eq!(port(&env(&[("LEDGE_PORT", "27832")])), 27832);
        assert_eq!(port(&env(&[("LEDGE_PORT", "0")])), 47831);
        assert_eq!(port(&env(&[("LEDGE_PORT", "x")])), 47831);
        assert_eq!(port(&env(&[("LEDGE_PORT", "70000")])), 47831);
    }
    #[test] fn runtime_prefers_both_overrides_else_the_bundled_folder() {
        let all = |_: &Path| true;
        let none = |_: &Path| false;
        let res = PathBuf::from(r"C:\Ledge");
        let both = env(&[("LEDGE_NODE", r"C:\n\node.exe"), ("LEDGE_CLI", r"C:\c\index.js")]);
        assert_eq!(runtime_source(&both, Some(&res), &all), Some(RuntimeSource::Override(Runtime::plain(r"C:\n\node.exe".into(), r"C:\c\index.js".into()))));
        let bundled = Some(RuntimeSource::Bundled(res.join("runtime")));
        assert_eq!(runtime_source(&env(&[("LEDGE_NODE", r"C:\n\node.exe")]), Some(&res), &all), bundled);   // one override alone is ignored
        assert_eq!(runtime_source(&env(&[]), Some(&res), &all), bundled);
        assert_eq!(runtime_source(&env(&[]), Some(&res), &none), None);
        assert_eq!(runtime_source(&both, Some(&res), &|p: &Path| !p.starts_with(r"C:\n")), bundled);       // an override that is not there falls back
        assert_eq!(runtime_source(&env(&[]), None, &all), None);
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ledge-native-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    /// A bundled runtime as assemble.mjs lays it out, at `version`.
    fn bundle(at: &Path, version: &str) {
        std::fs::create_dir_all(at.join("ledge").join("dist").join("cli")).unwrap();
        std::fs::create_dir_all(at.join("git").join("bin")).unwrap();
        std::fs::create_dir_all(at.join("git").join("cmd")).unwrap();
        std::fs::write(at.join("node.exe"), b"node").unwrap();
        std::fs::write(at.join("ledge").join("dist").join("cli").join("index.js"), b"cli").unwrap();
        std::fs::write(at.join("git").join("bin").join("bash.exe"), b"bash").unwrap();
        std::fs::write(at.join("VERSION"), format!("{version}\n")).unwrap();
    }

    #[test] fn runtime_from_dir_reads_version_bash_and_git_cmd() {
        let d = tmp("from-dir"); bundle(&d, "0.42.0");
        let rt = runtime_from_dir(&d, &|p: &Path| p.exists()).unwrap();
        assert_eq!(rt.node, d.join("node.exe"));
        assert_eq!(rt.cli, d.join("ledge").join("dist").join("cli").join("index.js"));
        assert_eq!(rt.git_bash, Some(d.join("git").join("bin").join("bash.exe")));
        assert_eq!(rt.git_cmd, Some(d.join("git").join("cmd")));
        assert_eq!(rt.version.as_deref(), Some("0.42.0"));
        assert_eq!(runtime_from_dir(&d.join("nope"), &|p: &Path| p.exists()), None);
    }
    #[test] fn stage_runtime_copies_once_and_reuses() {
        let root = tmp("stage"); let b = root.join("bundle"); bundle(&b, "0.42.0"); let home = root.join("home");
        let at = stage_runtime(&b, &home).unwrap();
        assert_eq!(at, home.join("runtime").join("0.42.0"));
        assert!(at.join(".complete").exists() && at.join("node.exe").exists() && at.join("git").join("bin").join("bash.exe").exists());
        std::fs::write(at.join("marker"), b"kept").unwrap();
        assert_eq!(stage_runtime(&b, &home).unwrap(), at);
        assert!(at.join("marker").exists(), "a complete copy is reused, not copied again");
    }
    #[test] fn a_partial_copy_is_never_used() {
        let root = tmp("partial"); let b = root.join("bundle"); bundle(&b, "0.42.0"); let home = root.join("home");
        let target = home.join("runtime").join("0.42.0");
        std::fs::create_dir_all(&target).unwrap(); std::fs::write(target.join("node.exe"), b"half").unwrap();
        std::fs::create_dir_all(home.join("runtime").join("0.42.0.tmp-1")).unwrap();
        let at = stage_runtime(&b, &home).unwrap();
        assert_eq!(std::fs::read(at.join("node.exe")).unwrap(), b"node");
        assert!(at.join(".complete").exists());
    }
    #[test] fn pruning_removes_old_copies_and_keeps_the_current() {
        let root = tmp("prune"); let home = root.join("home");
        for v in ["0.40.0", "0.41.0", "0.42.0"] { let d = home.join("runtime").join(v); bundle(&d, v); std::fs::write(d.join(".complete"), b"").unwrap(); }
        let mut gone = prune_runtimes(&home, "0.42.0"); gone.sort();
        assert_eq!(gone, ["0.40.0", "0.41.0"]);
        assert!(home.join("runtime").join("0.42.0").join("node.exe").exists());
        assert!(!home.join("runtime").join("0.40.0").exists());
    }
    #[cfg(windows)]
    #[test] fn pruning_keeps_a_copy_whose_files_are_locked() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = tmp("prune-locked"); let home = root.join("home");
        for v in ["0.41.0", "0.42.0"] { let d = home.join("runtime").join(v); bundle(&d, v); std::fs::write(d.join(".complete"), b"").unwrap(); }
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(home.join("runtime").join("0.41.0").join("node.exe")).unwrap();
        assert!(prune_runtimes(&home, "0.42.0").is_empty());
        // Nothing of the copy in use was removed, not even the files no one held.
        assert!(home.join("runtime").join("0.41.0").join("ledge").join("dist").join("cli").join("index.js").exists());
        drop(held);
        assert_eq!(prune_runtimes(&home, "0.42.0"), ["0.41.0"]);
    }

    #[test] fn token_file_absent_then_present() {
        let dir = std::env::temp_dir().join(format!("ledge-native-token-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("token");
        let _ = std::fs::remove_file(&f);
        assert_eq!(read_token_file(&f), TokenRead::Absent);
        std::fs::write(&f, format!("{HEX}\n")).unwrap();
        assert_eq!(read_token_file(&f), TokenRead::Token(HEX.into()));
        std::fs::write(&f, "nope").unwrap();
        assert_eq!(read_token_file(&f), TokenRead::Unavailable);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test] fn pruning_keeps_a_copy_whose_node_exe_is_running() {
        // A running program's folder can be renamed on Windows: the check must look at the program itself.
        let root = tmp("prune-running"); let home = root.join("home");
        for v in ["0.41.0", "0.42.0"] { let d = home.join("runtime").join(v); bundle(&d, v); std::fs::write(d.join(".complete"), b"").unwrap(); }
        let old = home.join("runtime").join("0.41.0");
        std::fs::copy(r"C:\Windows\System32\PING.EXE", old.join("node.exe")).unwrap();
        let mut running = std::process::Command::new(old.join("node.exe")).args(["-n", "30", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(prune_runtimes(&home, "0.42.0").is_empty());
        assert!(old.join("ledge").join("dist").join("cli").join("index.js").exists(), "nothing of a running copy is removed");
        running.kill().unwrap(); running.wait().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert_eq!(prune_runtimes(&home, "0.42.0"), ["0.41.0"]);
    }
}
