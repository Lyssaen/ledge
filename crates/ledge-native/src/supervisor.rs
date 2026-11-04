//! Desktop runs the daemon itself on Windows without WSL (spec 2026-11-03 §4.2.4): at launch it adopts the daemon that
//! already answers, or starts one; it starts it again after a crash, waiting longer each time; it stops it over the
//! protocol (`daemon.stop`, no signals on Windows) and waits for the process to end. Quitting Desktop leaves it running.

use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use crate::wsl_keepalive::{next_delay, MIN_DELAY};

/// A daemon process Desktop waits on.
pub trait Proc: Send {
    /// Returns once the process has ended.
    fn wait(&mut self);
    fn pid(&self) -> u32;
}

/// What the supervisor does to the system: the Windows implementation is `windows_ops`, tests use a fake.
pub trait Ops: Send + Sync {
    /// Whether the daemon's port accepts a connection.
    fn port_open(&self) -> bool;
    /// The PID in `daemon.pid`, if any.
    fn read_pid(&self) -> Option<u32>;
    /// The process `pid`, only when it is a `node` process (a stale PID file may name another one).
    fn open(&self, pid: u32) -> Option<Box<dyn Proc>>;
    /// Starts `node <cli> daemon`, outside Desktop's lifetime.
    fn spawn(&self) -> std::io::Result<Box<dyn Proc>>;
    /// Sends `daemon.stop` over the daemon's WebSocket; true once sent.
    fn send_stop(&self) -> bool;
    fn sleep(&self, d: Duration);
    /// A monotonic clock (tests drive it through `sleep`).
    fn now(&self) -> Duration;
    fn log(&self, line: &str);
}

/// How often an adopted daemon whose process could not be opened is checked through its port.
pub const PORT_POLL: Duration = Duration::from_secs(2);

#[derive(Default)]
struct State { stopping: bool, up: bool, exits: u64 }

/// The daemon's keeper: one thread, for the life of Desktop.
pub struct Supervisor { ops: Arc<dyn Ops>, state: Arc<(Mutex<State>, Condvar)> }

impl Supervisor {
    /// Starts the keeper's thread and returns at once.
    pub fn start(ops: Arc<dyn Ops>) -> Supervisor {
        let state = Arc::new((Mutex::new(State::default()), Condvar::new()));
        let (o, st) = (ops.clone(), state.clone());
        std::thread::spawn(move || run(o, st));
        Supervisor { ops, state }
    }

    /// Stops the daemon over the protocol and waits up to `timeout` for its process to end. No restart follows until
    /// `resume()`. True when it ended (or none was running).
    pub fn stop_and_wait(&self, timeout: Duration) -> bool {
        let (lock, cv) = &*self.state;
        let mut st = lock.lock().unwrap();
        st.stopping = true;
        if !st.up { return true; }
        let before = st.exits;
        drop(st);
        self.ops.log("stopping the daemon (daemon.stop)");
        if !self.ops.send_stop() { self.ops.log("daemon.stop could not be sent"); return false; }
        let (st, _) = cv.wait_timeout_while(lock.lock().unwrap(), timeout, |s| s.exits == before).unwrap();
        st.exits != before
    }

    /// Lets the keeper start the daemon again after `stop_and_wait`.
    pub fn resume(&self) {
        let (lock, cv) = &*self.state;
        lock.lock().unwrap().stopping = false;
        cv.notify_all();
    }
}

fn run(ops: Arc<dyn Ops>, state: Arc<(Mutex<State>, Condvar)>) {
    let (lock, cv) = &*state;
    // Half the first wait: the first crash waits MIN_DELAY.
    let mut delay = MIN_DELAY / 2;
    loop {
        drop(cv.wait_while(lock.lock().unwrap(), |s| s.stopping).unwrap());
        let started = ops.now();
        let set_up = |up: bool| { let mut s = lock.lock().unwrap(); s.up = up; if !up { s.exits += 1; } cv.notify_all(); };
        if ops.port_open() {
            match ops.read_pid().and_then(|pid| ops.open(pid)) {
                Some(mut p) => { ops.log(&format!("adopted the running daemon (pid {})", p.pid())); set_up(true); p.wait(); }
                None => {
                    ops.log("adopted the running daemon (its process could not be opened: watching its port)");
                    set_up(true);
                    while ops.port_open() { ops.sleep(PORT_POLL); }
                }
            }
        } else {
            match ops.spawn() {
                Ok(mut p) => { ops.log(&format!("started the daemon (pid {})", p.pid())); set_up(true); p.wait(); }
                Err(e) => { ops.log(&format!("could not start the daemon: {e}")); set_up(true); }
            }
        }
        set_up(false);
        if lock.lock().unwrap().stopping { ops.log("the daemon stopped"); continue; }
        delay = next_delay(ops.now().saturating_sub(started), delay);
        ops.log(&format!("the daemon ended: starting it again in {} s", delay.as_secs()));
        ops.sleep(delay);
    }
}

/// `daemon.stop`, sent once the daemon's first snapshot came (as every client of the daemon does).
pub const STOP_MESSAGE: &str = r#"{"type":"daemon.stop"}"#;

/// Whether a text frame from the daemon is its snapshot.
pub fn is_snapshot(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).ok().and_then(|v| v.get("type").and_then(|t| t.as_str()).map(|t| t == "snapshot")).unwrap_or(false)
}

/// Whether `image` (a full process image path) is a Node runtime.
pub fn is_node_image(image: &str) -> bool {
    let lower = image.to_lowercase();
    lower.ends_with("\\node.exe") || lower == "node.exe"
}

/// The supervisor's journal line: the seconds since 1970, then the line.
pub fn log_line(now_secs: u64, line: &str) -> String { format!("{now_secs} {line}\n") }

/// The journal is emptied before it grows past this.
pub const LOG_MAX: u64 = 1024 * 1024;

#[cfg(windows)]
pub use win::windows_ops;

#[cfg(windows)]
mod win {
    use super::*;
    use crate::daemon_token::TokenRead;
    use crate::native::{read_token_file, Runtime};
    use std::io::Write;
    use std::net::{SocketAddr, TcpStream};
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::time::Instant;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, INFINITE, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SYNCHRONIZE,
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

    struct Spawned(Child);
    impl Proc for Spawned {
        fn wait(&mut self) { let _ = self.0.wait(); }
        fn pid(&self) -> u32 { self.0.id() }
    }

    /// An adopted daemon: a handle that can only wait on it. A raw value, since `HANDLE` cannot cross threads.
    struct Opened { handle: isize, pid: u32 }
    impl Proc for Opened {
        fn wait(&mut self) { unsafe { WaitForSingleObject(HANDLE(self.handle as *mut _), INFINITE); } }
        fn pid(&self) -> u32 { self.pid }
    }
    impl Drop for Opened { fn drop(&mut self) { unsafe { let _ = CloseHandle(HANDLE(self.handle as *mut _)); } } }

    struct WinOps { rt: Runtime, home: PathBuf, port: u16, port_override: bool, started: Instant }

    impl WinOps {
        fn addr(&self) -> SocketAddr { SocketAddr::from(([127, 0, 0, 1], self.port)) }
        fn command(&self, breakaway: bool) -> Command {
            let mut c = Command::new(&self.rt.node);
            c.arg(&self.rt.cli).arg("daemon").current_dir(&self.home).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            // Desktop's own LEDGE_HOME is already in the environment the child inherits; the port only when overridden.
            if self.port_override { c.env("LEDGE_PORT", self.port.to_string()); }
            // Its own process group, no console, and out of any job Desktop is in: it outlives Desktop.
            c.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | if breakaway { CREATE_BREAKAWAY_FROM_JOB } else { 0 });
            c
        }
        fn try_stop(&self) -> Option<()> {
            use tungstenite::client::IntoClientRequest;
            use tungstenite::Message;
            let TokenRead::Token(token) = read_token_file(&self.home.join("token")) else { return None };
            let mut req = format!("ws://127.0.0.1:{}", self.port).into_client_request().ok()?;
            req.headers_mut().insert("Authorization", format!("Bearer {token}").parse().ok()?);
            let stream = TcpStream::connect_timeout(&self.addr(), Duration::from_secs(2)).ok()?;
            stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
            let (mut ws, _) = tungstenite::client(req, stream).ok()?;
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                if Instant::now() > deadline { return None; }
                match ws.read().ok()? { Message::Text(t) if is_snapshot(t.as_ref()) => break, _ => {} }
            }
            ws.send(Message::Text(STOP_MESSAGE.into())).ok()?;
            let _ = ws.close(None);
            Some(())
        }
    }

    impl Ops for WinOps {
        fn port_open(&self) -> bool { TcpStream::connect_timeout(&self.addr(), Duration::from_millis(500)).is_ok() }
        fn read_pid(&self) -> Option<u32> { std::fs::read_to_string(self.home.join("daemon.pid")).ok()?.trim().parse().ok() }
        fn open(&self, pid: u32) -> Option<Box<dyn Proc>> {
            let h = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let named = unsafe { QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len) }.is_ok();
            let opened = Opened { handle: h.0 as isize, pid };
            (named && is_node_image(&String::from_utf16_lossy(&buf[..len as usize]))).then(|| Box::new(opened) as Box<dyn Proc>)
        }
        fn spawn(&self) -> std::io::Result<Box<dyn Proc>> {
            std::fs::create_dir_all(&self.home)?;
            // A job that forbids breaking away refuses the flag: then the daemon starts inside it.
            let child = match self.command(true).spawn() { Ok(c) => c, Err(_) => self.command(false).spawn()? };
            Ok(Box::new(Spawned(child)))
        }
        fn send_stop(&self) -> bool { self.try_stop().is_some() }
        fn sleep(&self, d: Duration) { std::thread::sleep(d) }
        fn now(&self) -> Duration { self.started.elapsed() }
        fn log(&self, line: &str) {
            let path = self.home.join("desktop.log");
            if std::fs::metadata(&path).map(|m| m.len() > LOG_MAX).unwrap_or(false) { let _ = std::fs::write(&path, b""); }
            let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) { let _ = f.write_all(log_line(secs, line).as_bytes()); }
        }
    }

    /// The real supervisor's operations: `rt` run in `home`, on `port` (passed to the daemon when `port_override`).
    pub fn windows_ops(rt: Runtime, home: PathBuf, port: u16, port_override: bool) -> Arc<dyn Ops> {
        Arc::new(WinOps { rt, home, port, port_override, started: Instant::now() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// A process that ends at once (`rx: None`) or when its sender sends or is dropped.
    struct FakeProc { pid: u32, rx: Option<mpsc::Receiver<()>> }
    impl Proc for FakeProc {
        fn wait(&mut self) { if let Some(rx) = &self.rx { let _ = rx.recv(); } }
        fn pid(&self) -> u32 { self.pid }
    }

    #[derive(Default)]
    struct Fake {
        /// Answers of `port_open`, then `port_default`.
        port: Mutex<VecDeque<bool>>, port_default: bool,
        pid_file: Option<u32>, node_pids: Vec<u32>,
        /// Per spawn: true = the daemon ends at once (a crash); when none are left, it runs until stopped.
        crashes: Mutex<VecDeque<bool>>,
        running: Mutex<Option<mpsc::Sender<()>>>,
        /// Whether `daemon.stop` ends the running daemon.
        stop_works: bool,
        calls: Mutex<Vec<String>>,
        clock: Mutex<Duration>,
    }
    impl Fake {
        fn call(&self, c: String) { self.calls.lock().unwrap().push(c); }
        fn calls(&self) -> Vec<String> { self.calls.lock().unwrap().clone() }
        fn blocking(&self, pid: u32) -> Box<dyn Proc> {
            let (tx, rx) = mpsc::channel();
            *self.running.lock().unwrap() = Some(tx);
            Box::new(FakeProc { pid, rx: Some(rx) })
        }
    }
    impl Ops for Fake {
        fn port_open(&self) -> bool { self.port.lock().unwrap().pop_front().unwrap_or(self.port_default) }
        fn read_pid(&self) -> Option<u32> { self.pid_file }
        fn open(&self, pid: u32) -> Option<Box<dyn Proc>> {
            self.call(format!("open {pid}"));
            self.node_pids.contains(&pid).then(|| self.blocking(pid))
        }
        fn spawn(&self) -> std::io::Result<Box<dyn Proc>> {
            self.call("spawn".into());
            match self.crashes.lock().unwrap().pop_front() {
                Some(true) => Ok(Box::new(FakeProc { pid: 7, rx: None })),
                _ => Ok(self.blocking(7)),
            }
        }
        fn send_stop(&self) -> bool {
            self.call("stop".into());
            if self.stop_works { self.running.lock().unwrap().take(); }
            true
        }
        fn sleep(&self, d: Duration) {
            self.call(format!("sleep {}s", d.as_secs()));
            *self.clock.lock().unwrap() += d;
            std::thread::sleep(Duration::from_millis(2));
        }
        fn now(&self) -> Duration { *self.clock.lock().unwrap() }
        fn log(&self, _line: &str) {}
    }

    fn until(f: &Fake, pred: impl Fn(&[String]) -> bool) -> Vec<String> {
        for _ in 0..500 { let c = f.calls(); if pred(&c) { return c; } std::thread::sleep(Duration::from_millis(5)); }
        panic!("timeout: {:?}", f.calls());
    }
    fn count(c: &[String], s: &str) -> usize { c.iter().filter(|x| *x == s).count() }

    #[test] fn starts_a_daemon_when_none_answers() {
        let f = Arc::new(Fake::default());
        let _s = Supervisor::start(f.clone());
        let c = until(&f, |c| count(c, "spawn") == 1);
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(c, f.calls(), "nothing more once the daemon runs");
    }
    #[test] fn adopts_a_running_daemon_instead_of_starting_one() {
        let f = Arc::new(Fake { port_default: true, pid_file: Some(42), node_pids: vec![42], ..Default::default() });
        let _s = Supervisor::start(f.clone());
        until(&f, |c| c.contains(&"open 42".to_string()));
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(count(&f.calls(), "spawn"), 0);
    }
    #[test] fn adopt_ignores_a_pid_that_is_not_node() {
        // The PID file names a process that is not node (a reused PID): no wait on it, the port tells when the daemon ends.
        let f = Arc::new(Fake { port: Mutex::new(VecDeque::from([true, true, true])), port_default: false, pid_file: Some(42), ..Default::default() });
        let _s = Supervisor::start(f.clone());
        let c = until(&f, |c| count(c, "spawn") == 1);
        assert_eq!(c[0], "open 42");
        assert!(c.iter().any(|x| x == "sleep 2s"), "{c:?}");
    }
    #[test] fn restarts_after_a_crash() {
        let f = Arc::new(Fake { crashes: Mutex::new(VecDeque::from([true])), ..Default::default() });
        let _s = Supervisor::start(f.clone());
        let c = until(&f, |c| count(c, "spawn") == 2);
        assert_eq!(c, ["spawn", "sleep 2s", "spawn"]);
    }
    #[test] fn a_crash_loop_backs_off_to_a_minute() {
        let f = Arc::new(Fake { crashes: Mutex::new(VecDeque::from([true; 7])), ..Default::default() });
        let _s = Supervisor::start(f.clone());
        let c = until(&f, |c| count(c, "spawn") == 8);
        let sleeps: Vec<&str> = c.iter().filter(|x| x.starts_with("sleep")).map(|s| s.as_str()).collect();
        assert_eq!(sleeps, ["sleep 2s", "sleep 4s", "sleep 8s", "sleep 16s", "sleep 32s", "sleep 60s", "sleep 60s"]);
    }
    #[test] fn stop_and_wait_sends_stop_waits_and_does_not_restart() {
        let f = Arc::new(Fake { stop_works: true, ..Default::default() });
        let s = Supervisor::start(f.clone());
        until(&f, |c| count(c, "spawn") == 1);
        assert!(s.stop_and_wait(Duration::from_secs(2)));
        std::thread::sleep(Duration::from_millis(30));
        assert_eq!(f.calls(), ["spawn", "stop"]);
        s.resume();
        until(&f, |c| count(c, "spawn") == 2);
    }
    #[test] fn stop_and_wait_times_out_false_when_the_daemon_does_not_exit() {
        let f = Arc::new(Fake::default());
        let s = Supervisor::start(f.clone());
        until(&f, |c| count(c, "spawn") == 1);
        assert!(!s.stop_and_wait(Duration::from_millis(100)));
    }

    #[test] fn the_stop_waits_for_the_snapshot_and_names_node_only() {
        assert!(is_snapshot(r#"{"type":"snapshot","sessions":[]}"#));
        assert!(!is_snapshot(r#"{"type":"session.updated"}"#));
        assert!(!is_snapshot("not json"));
        assert_eq!(STOP_MESSAGE, r#"{"type":"daemon.stop"}"#);
        assert!(is_node_image(r"C:\Program Files\Ledge\runtime\node.exe"));
        assert!(is_node_image(r"C:\X\NODE.EXE"));
        assert!(!is_node_image(r"C:\Windows\System32\svchost.exe"));
        assert!(!is_node_image(r"C:\evil\notnode.exe"));
        assert_eq!(log_line(5, "started"), "5 started\n");
    }
}
