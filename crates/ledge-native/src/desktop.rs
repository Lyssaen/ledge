/// Where the per-user NSIS installer puts Ledge Desktop (`%LOCALAPPDATA%\Ledge Desktop\ledge-desktop.exe`).
pub fn exe_path(local_app_data: &std::path::Path) -> std::path::PathBuf {
    local_app_data.join("Ledge Desktop").join("ledge-desktop.exe")
}

/// The argument Ledge Desktop reads, at its start or through its single instance, to show what the island asks for.
pub const OPEN_ARG: &str = "--open";

/// A target is the island's JSON (`{"kind":"session","id":"local:abc"}`): one line, bounded, so it stays one argument.
pub fn valid_target(target: &str) -> bool {
    !target.is_empty() && target.len() <= 4096 && target.starts_with('{') && !target.chars().any(|c| c.is_control())
}

/// The target after `--open` in a command line, if it is valid.
pub fn open_target<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if a == OPEN_ARG { return it.next().filter(|t| valid_target(t)); }
    }
    None
}

/// Starts Ledge Desktop on `target`, or hands it to the running one (its single instance forwards the arguments).
pub fn open(target: &str) -> Result<(), String> {
    if !valid_target(target) { return Err("invalid target".into()); }
    let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?;
    let exe = exe_path(std::path::Path::new(&base));
    if !exe.is_file() { return Err("not installed".into()); }
    std::process::Command::new(exe).args([OPEN_ARG, target]).spawn().map(|_| ()).map_err(|e| format!("open Ledge Desktop: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(a: &[&str]) -> Vec<String> { a.iter().map(|s| s.to_string()).collect() }
    #[test] fn reads_the_target_after_open() {
        assert_eq!(open_target(args(&["ledge-desktop.exe", "--open", r#"{"kind":"settings"}"#])), Some(r#"{"kind":"settings"}"#.into()));
        assert_eq!(open_target(args(&["ledge-desktop.exe", "--minimized"])), None);
        assert_eq!(open_target(args(&["ledge-desktop.exe", "--open"])), None);
    }
    #[test] fn refuses_what_is_not_one_json_line() {
        assert!(!valid_target(""));
        assert!(!valid_target("settings"));
        assert!(!valid_target("{\"kind\":\"settings\"}\n--other"));
        assert!(!valid_target(&format!("{{{}", "a".repeat(4096))));
        assert_eq!(open("nope"), Err("invalid target".into()));
    }
    #[test] fn finds_the_per_user_install() {
        assert_eq!(exe_path(std::path::Path::new("C:/Users/x/AppData/Local")), std::path::Path::new("C:/Users/x/AppData/Local/Ledge Desktop/ledge-desktop.exe"));
    }
}
