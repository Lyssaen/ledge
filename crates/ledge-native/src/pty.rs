//! A pseudo-terminal the desktop app runs `wsl.exe` in, so a terminal tab lives inside its window instead of Windows Terminal.

use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::terminal::wsl_arg_ok;

/// The `wsl.exe` arguments that run `argv` as is, without the user's shell; `None` when WSL would mangle one of them.
pub fn wsl_command(argv: &[String]) -> Option<Vec<String>> {
    if argv.is_empty() || !argv.iter().all(|a| wsl_arg_ok(a)) { return None; }
    let mut args = vec!["--exec".to_string()];
    args.extend(argv.iter().cloned());
    Some(args)
}

/// How long the exit waits for the last output once the child is gone: ConPTY keeps its pipe open until the pty closes.
const LAST_OUTPUT: Duration = Duration::from_millis(200);

fn other(e: impl std::fmt::Display) -> io::Error { io::Error::new(io::ErrorKind::Other, e.to_string()) }

/// A child running in a pseudo-terminal; dropping it kills the child.
pub struct Pty {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    killed: Arc<AtomicBool>,
}

impl Pty {
    /// Starts `program` in a `cols`×`rows` terminal: its output goes to `on_data`, then its exit code to `on_exit`
    /// (`None` once killed through `kill`).
    pub fn spawn(program: &str, args: &[String], cols: u16, rows: u16, mut on_data: impl FnMut(&[u8]) + Send + 'static, on_exit: impl FnOnce(Option<u32>) + Send + 'static) -> io::Result<Pty> {
        let pair = native_pty_system().openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(other)?;
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        let mut child = pair.slave.spawn_command(cmd).map_err(other)?;
        // Our copy of the slave closed, the reader sees the end once the child's side closes.
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(other)?;
        let writer = pair.master.take_writer().map_err(other)?;
        let killer = child.clone_killer();
        let killed = Arc::new(AtomicBool::new(false));

        let (done, read_done) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_data(&buf[..n]),
                }
            }
            let _ = done.send(());
        });
        let was_killed = killed.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            // The output the child wrote before exiting comes first.
            let _ = read_done.recv_timeout(LAST_OUTPUT);
            on_exit(if was_killed.load(Ordering::SeqCst) { None } else { status.ok().map(|s| s.exit_code()) });
        });
        Ok(Pty { master: Mutex::new(pair.master), writer: Mutex::new(writer), killer: Mutex::new(killer), killed })
    }

    /// Types `data` into the terminal.
    pub fn write(&self, data: &[u8]) -> io::Result<()> {
        let mut w = self.writer.lock().map_err(other)?;
        w.write_all(data)?;
        w.flush()
    }

    pub fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        self.master.lock().map_err(other)?.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(other)
    }

    pub fn kill(&self) {
        self.killed.store(true, Ordering::SeqCst);
        if let Ok(mut k) = self.killer.lock() { let _ = k.kill(); }
    }
}

impl Drop for Pty {
    fn drop(&mut self) { self.kill(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    fn s(a: &[&str]) -> Vec<String> { a.iter().map(|x| x.to_string()).collect() }

    /// Spawns `program`, collecting its output and its exit code.
    fn run(program: &str, args: &[&str]) -> (Pty, Arc<Mutex<Vec<u8>>>, mpsc::Receiver<Option<u32>>) {
        let out = Arc::new(Mutex::new(Vec::new()));
        let sink = out.clone();
        let (tx, rx) = mpsc::channel();
        let pty = Pty::spawn(program, &s(args), 80, 24, move |b| sink.lock().unwrap().extend_from_slice(b), move |code| { let _ = tx.send(code); }).unwrap();
        (pty, out, rx)
    }

    /// Waits up to 5 s for `needle` in the output.
    fn wait_for(out: &Mutex<Vec<u8>>, needle: &[u8]) -> bool {
        let end = Instant::now() + Duration::from_secs(5);
        while Instant::now() < end {
            if out.lock().unwrap().windows(needle.len()).any(|w| w == needle) { return true; }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    #[test] fn wsl_command_refuses_what_wsl_would_mangle() {
        assert_eq!(wsl_command(&["sh".into(), "-c".into(), "cd '/w' || cd".into()]), Some(vec!["--exec".into(), "sh".into(), "-c".into(), "cd '/w' || cd".into()]));
        assert_eq!(wsl_command(&[]), None);
        assert_eq!(wsl_command(&["a\"b".into()]), None);
    }
    #[test] fn streams_output_then_exit_code() {
        let (_pty, out, rx) = run("sh", &["-c", "printf hi; exit 3"]);
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)), Ok(Some(3)));
        assert!(wait_for(&out, b"hi"));
    }
    #[test] fn input_reaches_the_child() {
        let (pty, out, _rx) = run("cat", &[]);
        pty.write(b"ping\n").unwrap();
        assert!(wait_for(&out, b"ping"));
    }
    #[test] fn kill_ends_it() {
        let (pty, _out, rx) = run("sleep", &["30"]);
        pty.kill();
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)), Ok(None));
    }
}
