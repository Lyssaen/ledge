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

/// The Node runtime and the Ledge CLI Desktop runs the daemon with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime { pub node: PathBuf, pub cli: PathBuf }

/// `LEDGE_NODE` + `LEDGE_CLI` when both are set and there, else the bundled `<resources>/runtime` (filled by the
/// installer), else none.
pub fn runtime(env: &dyn Fn(&str) -> Option<String>, resource_dir: Option<&Path>, exists: &dyn Fn(&Path) -> bool) -> Option<Runtime> {
    if let (Some(node), Some(cli)) = (non_empty(env, "LEDGE_NODE"), non_empty(env, "LEDGE_CLI")) {
        let rt = Runtime { node: node.into(), cli: cli.into() };
        if exists(&rt.node) && exists(&rt.cli) { return Some(rt); }
    }
    let base = resource_dir?.join("runtime");
    let rt = Runtime { node: base.join("node.exe"), cli: base.join("ledge").join("dist").join("cli").join("index.js") };
    (exists(&rt.node) && exists(&rt.cli)).then_some(rt)
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
        assert_eq!(runtime(&both, Some(&res), &all), Some(Runtime { node: r"C:\n\node.exe".into(), cli: r"C:\c\index.js".into() }));
        let bundled = Some(Runtime { node: res.join("runtime").join("node.exe"), cli: res.join("runtime").join("ledge").join("dist").join("cli").join("index.js") });
        assert_eq!(runtime(&env(&[("LEDGE_NODE", r"C:\n\node.exe")]), Some(&res), &all), bundled);   // one override alone is ignored
        assert_eq!(runtime(&env(&[]), Some(&res), &all), bundled);
        assert_eq!(runtime(&env(&[]), Some(&res), &none), None);
        assert_eq!(runtime(&both, Some(&res), &|p: &Path| !p.starts_with(r"C:\n")), bundled);       // an override that is not there falls back
        assert_eq!(runtime(&env(&[]), None, &all), None);
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
}
