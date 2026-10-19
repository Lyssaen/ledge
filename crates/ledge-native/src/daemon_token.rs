//! Reads the daemon's token (`${LEDGE_HOME:-$HOME/.ledge}/token`) from inside WSL. The token is never logged.

/// What reading the token gave.
#[derive(Debug, PartialEq, Eq)]
pub enum TokenRead { Token(String), Absent, Unavailable }

/// Exit code of the read command when the token file does not exist.
pub const ABSENT_EXIT: i32 = 3;

/// The arguments after `wsl.exe`: a fixed command, nothing interpolated.
pub fn wsl_args() -> [&'static str; 4] {
    ["--exec", "sh", "-c", "f=\"${LEDGE_HOME:-$HOME/.ledge}/token\"; [ -f \"$f\" ] || exit 3; cat \"$f\""]
}

/// Maps the read command's exit code and stdout: a token is exactly 64 lowercase hex chars (surrounding whitespace
/// trimmed), exit 3 means no file, anything else is unavailable.
pub fn outcome(code: Option<i32>, stdout: &[u8]) -> TokenRead {
    match code {
        Some(0) => match std::str::from_utf8(stdout).map(str::trim) {
            Ok(t) if t.len() == 64 && t.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) => TokenRead::Token(t.to_string()),
            _ => TokenRead::Unavailable,
        },
        Some(ABSENT_EXIT) => TokenRead::Absent,
        _ => TokenRead::Unavailable,
    }
}

/// Runs the read command through `wsl.exe`, killing it after `timeout`.
#[cfg(windows)]
pub fn read(timeout: std::time::Duration) -> TokenRead {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::Instant;
    let Ok(mut child) = Command::new("wsl.exe").args(wsl_args()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .creation_flags(0x0800_0000).spawn() else { return TokenRead::Unavailable };
    let Some(mut pipe) = child.stdout.take() else { let _ = child.kill(); return TokenRead::Unavailable };
    // Drained on its own thread so a full pipe never stalls the child; the thread ends when the child's end closes.
    // It hands its buffer over a channel, so a process that inherited stdout and holds it open cannot stall us past the deadline.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let mut buf = Vec::new(); let _ = pipe.by_ref().take(4096).read_to_end(&mut buf); let _ = tx.send(buf); });
    let deadline = Instant::now() + timeout;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(50)),
            _ => { let _ = child.kill(); let _ = child.wait(); return TokenRead::Unavailable; }
        }
    };
    match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) { Ok(buf) => outcome(code, &buf), Err(_) => TokenRead::Unavailable }
}

#[cfg(not(windows))]
pub fn read(_timeout: std::time::Duration) -> TokenRead { TokenRead::Unavailable }

#[cfg(test)]
mod tests {
    use super::*;
    const HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    #[test] fn a_token_is_64_hex_chars() {
        assert_eq!(outcome(Some(0), format!("{HEX}\n").as_bytes()), TokenRead::Token(HEX.into()));
    }
    #[test] fn exit_3_is_absent() { assert_eq!(outcome(Some(3), b""), TokenRead::Absent); }
    #[test] fn anything_but_exit_3_or_a_token_is_unavailable() {
        let short = &HEX[..63];
        let upper = HEX.to_uppercase();
        let cases: [(Option<i32>, &[u8]); 6] = [
            (Some(0), b""), (Some(0), b"nope"), (Some(0), short.as_bytes()), (Some(0), upper.as_bytes()), (Some(1), b""), (None, b""),
        ];
        for (code, out) in cases { assert_eq!(outcome(code, out), TokenRead::Unavailable, "{code:?} {out:?}"); }
    }
    #[test] fn the_command_is_fixed() {
        assert_eq!(wsl_args(), ["--exec", "sh", "-c", "f=\"${LEDGE_HOME:-$HOME/.ledge}/token\"; [ -f \"$f\" ] || exit 3; cat \"$f\""]);
    }
}
