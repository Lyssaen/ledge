//! Holds a `wsl.exe` open while Ledge runs: WSL boots with Ledge at login and stays up, so the daemon stays reachable.

use std::time::Duration;

/// The first wait before `wsl.exe` is started again, and the wait after a run that held.
pub const MIN_DELAY: Duration = Duration::from_secs(2);
/// The longest wait: WSL missing or failing is retried once a minute, never in a loop.
pub const MAX_DELAY: Duration = Duration::from_secs(60);
/// A run this long held WSL up: the next restart waits `MIN_DELAY` again.
pub const STABLE_RUN: Duration = Duration::from_secs(60);

/// The arguments after `wsl.exe`: a process that never ends, run without the user's shell.
pub fn wsl_args() -> [&'static str; 3] { ["--exec", "sleep", "infinity"] }

/// The wait before the next start, after a run of `ran_for` that followed a wait of `prev`: back to `MIN_DELAY` after a
/// run that held, else twice `prev`, capped at `MAX_DELAY`.
pub fn next_delay(ran_for: Duration, prev: Duration) -> Duration {
    if ran_for >= STABLE_RUN { MIN_DELAY } else { (prev * 2).min(MAX_DELAY) }
}

#[cfg(not(windows))]
pub fn start() {}

/// Starts the keep-alive thread and returns at once. The `wsl.exe` it runs, hidden, sits in a job that kills it when the
/// job's last handle closes, that is when Ledge exits, even on a crash; Ledge itself stays out of the job, so the
/// updater's installer and the embedded terminals outlive it. Called once per process.
#[cfg(windows)]
pub fn start() {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::Instant;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;
    // Never closed: the handle goes with the process. A raw value, since `HANDLE` cannot cross threads.
    let job = kill_on_close_job().map(|h| h.0 as isize);
    std::thread::spawn(move || {
        let mut delay = MIN_DELAY;
        loop {
            let started = Instant::now();
            let ran_for = match Command::new("wsl.exe").args(wsl_args()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                .creation_flags(0x0800_0000).spawn() {
                Ok(mut child) => {
                    // Without a job the child still holds WSL; it may then outlive a crash of Ledge.
                    if let Some(job) = job { let _ = unsafe { AssignProcessToJobObject(HANDLE(job as *mut _), HANDLE(child.as_raw_handle())) }; }
                    let _ = child.wait();
                    started.elapsed()
                }
                Err(_) => Duration::ZERO,
            };
            delay = next_delay(ran_for, delay);
            std::thread::sleep(delay);
        }
    });
}

/// A job that kills its processes when its last handle closes; `None` when Windows refuses one.
#[cfg(windows)]
fn kill_on_close_job() -> Option<windows::Win32::Foundation::HANDLE> {
    use windows::core::PCWSTR;
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.ok()?;
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
    unsafe { SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as *const _, size) }.ok()?;
    Some(job)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn the_keep_alive_runs_sleep_infinity_without_a_shell() {
        assert_eq!(wsl_args(), ["--exec", "sleep", "infinity"]);
    }
    #[test] fn a_stable_run_resets_the_delay() {
        assert_eq!(next_delay(STABLE_RUN, MAX_DELAY), MIN_DELAY);
        assert_eq!(next_delay(Duration::from_secs(3600), Duration::from_secs(16)), MIN_DELAY);
    }
    #[test] fn a_short_run_doubles_the_delay() {
        assert_eq!(next_delay(Duration::from_millis(100), MIN_DELAY), Duration::from_secs(4));
        assert_eq!(next_delay(Duration::from_secs(59), Duration::from_secs(8)), Duration::from_secs(16));
    }
    #[test] fn the_delay_never_exceeds_a_minute() {
        assert_eq!(next_delay(Duration::ZERO, Duration::from_secs(40)), MAX_DELAY);
        assert_eq!(next_delay(Duration::ZERO, MAX_DELAY), MAX_DELAY);
    }
}
