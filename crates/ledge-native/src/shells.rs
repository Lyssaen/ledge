//! The Windows shells a desktop terminal tab can run besides WSL: where each is installed, how it starts.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeShell { PowerShell, Cmd, GitBash }

impl NativeShell {
    /// The name the page sends; anything else is not a shell Ledge runs.
    pub fn parse(s: &str) -> Option<NativeShell> {
        match s { "powershell" => Some(NativeShell::PowerShell), "cmd" => Some(NativeShell::Cmd), "gitbash" => Some(NativeShell::GitBash), _ => None }
    }
}

fn join(dir: &str, rest: &str) -> PathBuf { PathBuf::from(format!("{}\\{}", dir.trim_end_matches('\\'), rest)) }

/// The program, its arguments and its folder (the user's profile). `env` reads a variable, `exists` says whether a file is there.
pub fn locate(shell: NativeShell, env: &dyn Fn(&str) -> Option<String>, exists: &dyn Fn(&Path) -> bool) -> Option<(PathBuf, Vec<String>, Option<PathBuf>)> {
    let home = env("USERPROFILE").filter(|h| !h.is_empty()).map(PathBuf::from);
    match shell {
        NativeShell::PowerShell => {
            let pwsh = env("PATH").unwrap_or_default().split(';').map(|d| d.trim().trim_matches('"')).filter(|d| !d.is_empty()).map(|d| join(d, "pwsh.exe")).find(|p| exists(p));
            let program = pwsh.or_else(|| env("SystemRoot").map(|r| join(&r, "System32\\WindowsPowerShell\\v1.0\\powershell.exe")).filter(|p| exists(p)))?;
            Some((program, vec!["-NoLogo".into()], home))
        }
        NativeShell::Cmd => {
            let comspec = env("ComSpec").filter(|c| !c.is_empty()).map(PathBuf::from).filter(|p| exists(p));
            let program = comspec.or_else(|| env("SystemRoot").map(|r| join(&r, "System32\\cmd.exe")).filter(|p| exists(p)))?;
            Some((program, vec![], home))
        }
        NativeShell::GitBash => {
            let roots = ["ProgramFiles", "ProgramFiles(x86)"].iter().filter_map(|k| env(k)).map(|d| join(&d, "Git\\bin\\bash.exe"))
                .chain(env("LocalAppData").map(|d| join(&d, "Programs\\Git\\bin\\bash.exe")));
            let program = roots.into_iter().find(|p| exists(p))?;
            Some((program, vec!["--login".into(), "-i".into()], home))
        }
    }
}

/// The WSL distribution's name; `Some("")` (the page shows plain « WSL ») when it answers without one or does not answer
/// (slow, failed, non-zero exit), since `None` means "no WSL" to the page. Hidden window, 3 s at most.
#[cfg(windows)]
pub fn wsl_distro() -> Option<String> {
    Some(wsl_distro_name().unwrap_or_default())
}

#[cfg(windows)]
fn wsl_distro_name() -> Option<String> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut child = Command::new("wsl.exe").args(["--exec", "printenv", "WSL_DISTRO_NAME"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .creation_flags(0x0800_0000).spawn().ok()?;
    let mut pipe = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let mut buf = Vec::new(); let _ = pipe.by_ref().take(4096).read_to_end(&mut buf); let _ = tx.send(buf); });
    let deadline = Instant::now() + Duration::from_secs(3);
    let ok = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(30)),
            _ => { let _ = child.kill(); let _ = child.wait(); return None; }
        }
    };
    if !ok { return None; }
    let buf = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
    Some(String::from_utf8_lossy(&buf).trim().to_string())
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
    const SYS: &str = r"C:\Windows";

    #[test] fn pwsh_is_found_in_the_second_path_folder() {
        let env = env_of(&[("PATH", r"C:\bin;C:\Tools\PS\;C:\other"), ("USERPROFILE", r"C:\Users\me"), ("SystemRoot", SYS)]);
        let got = locate(NativeShell::PowerShell, &env, &files(&[r"C:\Tools\PS\pwsh.exe", r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"]));
        assert_eq!(got, Some((PathBuf::from(r"C:\Tools\PS\pwsh.exe"), vec!["-NoLogo".to_string()], Some(PathBuf::from(r"C:\Users\me")))));
    }
    #[test] fn without_pwsh_windows_powershell_runs() {
        let env = env_of(&[("PATH", r"C:\bin"), ("USERPROFILE", r"C:\Users\me"), ("SystemRoot", SYS)]);
        let got = locate(NativeShell::PowerShell, &env, &files(&[r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"])).unwrap();
        assert_eq!(got.0, PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"));
        assert_eq!(got.1, vec!["-NoLogo".to_string()]);
    }
    #[test] fn cmd_is_the_comspec() {
        let env = env_of(&[("ComSpec", r"C:\Windows\System32\cmd.exe"), ("USERPROFILE", r"C:\Users\me")]);
        let got = locate(NativeShell::Cmd, &env, &files(&[r"C:\Windows\System32\cmd.exe"]));
        assert_eq!(got, Some((PathBuf::from(r"C:\Windows\System32\cmd.exe"), vec![], Some(PathBuf::from(r"C:\Users\me")))));
    }
    #[test] fn git_bash_under_program_files_x86_only() {
        let env = env_of(&[("ProgramFiles", r"C:\Program Files"), ("ProgramFiles(x86)", r"C:\Program Files (x86)"), ("USERPROFILE", r"C:\Users\me")]);
        let got = locate(NativeShell::GitBash, &env, &files(&[r"C:\Program Files (x86)\Git\bin\bash.exe"])).unwrap();
        assert_eq!(got.0, PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"));
        assert_eq!(got.1, vec!["--login".to_string(), "-i".to_string()]);
    }
    #[test] fn nothing_installed_is_none() {
        let env = env_of(&[("PATH", r"C:\bin"), ("SystemRoot", SYS), ("ComSpec", r"C:\Windows\System32\cmd.exe"), ("ProgramFiles", r"C:\Program Files")]);
        for s in [NativeShell::PowerShell, NativeShell::Cmd, NativeShell::GitBash] { assert_eq!(locate(s, &env, &files(&[])), None); }
    }
    #[test] fn parse_knows_three_names() {
        assert_eq!(NativeShell::parse("powershell"), Some(NativeShell::PowerShell));
        assert_eq!(NativeShell::parse("cmd"), Some(NativeShell::Cmd));
        assert_eq!(NativeShell::parse("gitbash"), Some(NativeShell::GitBash));
        assert_eq!(NativeShell::parse("bash"), None);
    }

    #[test] fn quoted_and_empty_path_entries_are_cleaned() {
        let env = env_of(&[("PATH", r#";"C:\Program Files\PowerShell\7";"#)]);
        let got = locate(NativeShell::PowerShell, &env, &files(&[r"C:\Program Files\PowerShell\7\pwsh.exe"])).unwrap();
        assert_eq!(got.0, PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe"));
    }
    #[test] fn no_userprofile_means_no_folder() {
        let env = env_of(&[("ComSpec", r"C:\Windows\System32\cmd.exe")]);
        assert_eq!(locate(NativeShell::Cmd, &env, &files(&[r"C:\Windows\System32\cmd.exe"])).unwrap().2, None);
    }
    #[test] fn git_bash_under_local_app_data_only() {
        let env = env_of(&[("ProgramFiles", r"C:\Program Files"), ("LocalAppData", r"C:\Users\me\AppData\Local")]);
        let got = locate(NativeShell::GitBash, &env, &files(&[r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe"])).unwrap();
        assert_eq!(got.0, PathBuf::from(r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe"));
    }
    #[test] fn git_bash_prefers_program_files() {
        let env = env_of(&[("ProgramFiles", r"C:\Program Files"), ("ProgramFiles(x86)", r"C:\Program Files (x86)")]);
        let got = locate(NativeShell::GitBash, &env, &files(&[r"C:\Program Files (x86)\Git\bin\bash.exe", r"C:\Program Files\Git\bin\bash.exe"])).unwrap();
        assert_eq!(got.0, PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"));
    }
    #[test] fn an_empty_comspec_falls_back_to_system32_cmd() {
        let env = env_of(&[("ComSpec", ""), ("SystemRoot", SYS)]);
        let got = locate(NativeShell::Cmd, &env, &files(&[r"C:\Windows\System32\cmd.exe"])).unwrap();
        assert_eq!(got.0, PathBuf::from(r"C:\Windows\System32\cmd.exe"));
        assert_eq!(locate(NativeShell::Cmd, &env, &files(&[])), None);
    }
}
