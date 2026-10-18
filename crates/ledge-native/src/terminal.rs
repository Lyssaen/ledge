/// True when a window title should be brought forward for `wanted`.
pub fn title_matches(title: &str, wanted: &str) -> bool {
    let t = title.to_lowercase();
    t.contains(&wanted.to_lowercase()) || t.contains("windows terminal")
}

/// `s` as one `wt.exe` argument: Windows Terminal splits its whole command line into subcommands at every `;` not
/// preceded by a backslash, inside an argument too, and turns `\;` back into `;`. A session title `demo;calc.exe`
/// left as is would run `calc.exe` as a second `wt` command.
fn wt_arg(s: &str) -> String { s.replace(';', "\\;") }

/// The `wt.exe` arguments that open a tab titled `title` in the current Windows Terminal window (a new one when none
/// is open) running `command` inside the default WSL distribution. `command` is the daemon's launcher command plus
/// `attach <id>`; Windows Terminal hands everything after `wsl.exe --` to WSL, once its `;` escapes are undone.
pub fn terminal_args(title: &str, command: &[String]) -> Vec<String> {
    let mut args: Vec<String> = ["-w", "0", "new-tab", "--title"].iter().map(|s| s.to_string()).collect();
    args.push(wt_arg(title));
    args.extend(["wsl.exe", "--"].iter().map(|s| s.to_string()));
    args.extend(command.iter().map(|a| wt_arg(a)));
    args
}

/// Brings the Windows Terminal window whose title contains `wanted` forward, else any Windows Terminal window.
#[cfg(windows)]
pub fn focus(title: &str) -> bool {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible, SetForegroundWindow};
    struct Search { wanted: String, exact: Option<HWND>, any: Option<HWND> }
    unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
        let s = &mut *(lp.0 as *mut Search);
        if !IsWindowVisible(hwnd).as_bool() { return BOOL(1); }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf) as usize;
        let t = String::from_utf16_lossy(&buf[..n]);
        if t.to_lowercase().contains(&s.wanted.to_lowercase()) { s.exact = Some(hwnd); return BOOL(0); }
        if s.any.is_none() && t.to_lowercase().contains("windows terminal") { s.any = Some(hwnd); }
        BOOL(1)
    }
    let mut search = Search { wanted: title.to_string(), exact: None, any: None };
    unsafe { let _ = EnumWindows(Some(cb), LPARAM(&mut search as *mut Search as isize)); }
    match search.exact.or(search.any) { Some(h) => unsafe { SetForegroundWindow(h).as_bool() }, None => false }
}

#[cfg(not(windows))]
pub fn focus(_title: &str) -> bool { false }

/// Windows Terminal's top-level window class (Cascadia). Its tab titles vary; the class does not.
#[cfg(windows)]
pub fn foreground_is_terminal() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() { return false; }
        let mut buf = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut buf) as usize;
        String::from_utf16_lossy(&buf[..n]) == "CASCADIA_HOSTING_WINDOW_CLASS"
    }
}

#[cfg(not(windows))]
pub fn foreground_is_terminal() -> bool { false }

/// Opens a Windows Terminal tab running `command` in WSL; true once `wt.exe` was spawned.
pub fn open(title: &str, command: &[String]) -> Result<bool, String> {
    if command.is_empty() { return Err("empty command".into()); }
    #[cfg(windows)]
    { return std::process::Command::new("wt.exe").args(terminal_args(title, command)).spawn().map(|_| true).map_err(|e| format!("wt.exe: {e}")); }
    #[cfg(not(windows))]
    { let _ = title; Ok(false) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn a_terminal_tab_runs_the_launcher_command_in_wsl() {
        let cmd: Vec<String> = ["/usr/bin/node", "/opt/ledge/cli.js", "attach", "n1"].iter().map(|s| s.to_string()).collect();
        assert_eq!(terminal_args("Juno · api-gateway", &cmd), ["-w", "0", "new-tab", "--title", "Juno · api-gateway", "wsl.exe", "--", "/usr/bin/node", "/opt/ledge/cli.js", "attach", "n1"]);
    }
    #[test] fn a_semicolon_in_the_title_or_the_command_never_starts_another_wt_command() {
        let cmd: Vec<String> = ["ssh", "-t", "--", "box", "'node' 'cli.js' 'attach' 'a;b'"].iter().map(|s| s.to_string()).collect();
        assert_eq!(terminal_args("demo;calc.exe;", &cmd), ["-w", "0", "new-tab", "--title", "demo\\;calc.exe\\;", "wsl.exe", "--", "ssh", "-t", "--", "box", "'node' 'cli.js' 'attach' 'a\\;b'"]);
        // A backslash already before a `;` is kept: wt reads `\\;` back as `\;`.
        assert_eq!(wt_arg("a\\;b"), "a\\\\;b");
    }
    #[test] fn matches_bot_title_or_terminal() {
        assert!(title_matches("Otto · harness-assistant - Windows Terminal", "Otto · harness-assistant"));
        assert!(title_matches("PowerShell - Windows Terminal", "Pim · speos-api"));
        assert!(!title_matches("Visual Studio Code", "Pim · speos-api"));
    }
    #[test] fn open_refuses_an_empty_command() { assert_eq!(open("x", &[]), Err("empty command".into())); }
}
