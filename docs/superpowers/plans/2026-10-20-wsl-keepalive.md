# WSL Keep-Alive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Ledge Desktop starts (at Windows login, through its autostart), it starts WSL and keeps it running for as long as Ledge runs, so the daemon (`ledge-daemon.service`, started by systemd + linger) is reachable without the user opening a WSL shell first.

**Architecture:** `crates/ledge-native` gets a `wsl_keepalive` module. On Windows, `start()` spawns a supervisor thread that runs a hidden `wsl.exe --exec sleep infinity`, puts that child (and only it) in a Job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, waits for it and restarts it with a backoff when it exits. The job handle lives as long as the app process, so the child dies with Ledge, even on a crash. Elsewhere `start()` is a no-op. `apps/desktop/src-tauri/src/main.rs` calls it from `setup`.

**Tech Stack:** Rust, `windows` crate 0.58, Tauri 2, `cargo test`, cargo-xwin cross-compile.

**Spec:** no separate document. The design was agreed in the session of 2026-10-20 and is summarized here:
- Observed: at Windows login Ledge Desktop starts, its token read (`wsl.exe --exec sh -c …`, `crates/ledge-native/src/daemon_token.rs`) boots WSL and systemd starts the daemon, but once that `wsl.exe` exits nothing holds WSL and it stops (journal boot `-1` of 2026-10-20: 07:23:18 → 07:25:00, cut off with no shutdown sequence). The daemon stays unreachable until the user opens WSL.
- Decided: Ledge holds a `wsl.exe` client open for its whole lifetime. That boots WSL at login and keeps it up. No setting to switch it off (YAGNI: Ledge is useless without the daemon).

## Global Constraints

- Keep-alive command, verbatim: `wsl.exe --exec sleep infinity` (default distro, the same one the token read targets).
- Spawned with `CREATE_NO_WINDOW` (`0x0800_0000`), stdin/stdout/stderr null: no console window ever flashes.
- Only the keep-alive child goes into the Job object. The Ledge process itself is never assigned to it, or the updater's installer and the embedded terminals' `wsl.exe` would be killed with it.
- Restart backoff: `MIN_DELAY` = 2 s, `MAX_DELAY` = 60 s. A run of at least `STABLE_RUN` = 60 s resets the delay to `MIN_DELAY`; a shorter run doubles the previous delay, capped at `MAX_DELAY`.
- Nothing is logged and no error reaches the UI: a failure to spawn or to create the job only makes the loop back off (with no job, the child is still spawned).
- Non-Windows builds: `start()` compiles and does nothing.

## Review Focus

1. **WSL not installed or `wsl.exe` missing:** the spawn fails or exits at once. The loop must back off to 60 s, not spin, and show nothing. Covered by the backoff tests (Task 1) and manual check 5 (Task 2).
2. **User runs `wsl --shutdown` while Ledge runs:** `wsl.exe` exits, the supervisor restarts it within `MIN_DELAY`·2 = 4 s and WSL reboots; the desktop client reconnects on its own (its backoff is capped at 30 s, `packages/fleet/src/client.ts:17`). Manual check 3.
3. **Ledge quits or crashes:** the keep-alive `wsl.exe` must not survive it (Job object), and WSL then stops after its `vmIdleTimeout`. Manual check 4.
4. **Update through the updater:** the installer started by `tauri-plugin-updater` must run to completion after Ledge exits, which holds only if the Ledge process is not in the job. Pinned by the constraint above; checked in review of Task 1.
5. **Cold WSL boot (45 s on the user's machine):** the first token reads time out (`unavailable`) while WSL boots; the client keeps retrying and connects once the daemon listens, without user action. Manual check 2.

---

### Task 1: `wsl_keepalive` module in `ledge-native`

**Files:**
- Create: `crates/ledge-native/src/wsl_keepalive.rs`
- Modify: `crates/ledge-native/src/lib.rs` (add `pub mod wsl_keepalive;`)
- Modify: `crates/ledge-native/Cargo.toml` (`windows` features: add `"Win32_Security"`, `"Win32_System_JobObjects"`, `"Win32_System_Threading"`)

**Interfaces:**
- Produces:
  - `pub fn wsl_args() -> [&'static str; 3]` → `["--exec", "sleep", "infinity"]`
  - `pub const MIN_DELAY: Duration`, `MAX_DELAY: Duration`, `STABLE_RUN: Duration` (values in Global Constraints)
  - `pub fn next_delay(ran_for: Duration, prev: Duration) -> Duration`
  - `pub fn start()` — returns at once; on Windows it spawns the supervisor thread, elsewhere it does nothing. Called once per process.

- [ ] **Step 1: Write the failing tests** (in the module's `#[cfg(test)] mod tests`, one-line `#[test] fn` style as in `autostart.rs`)

```rust
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p ledge-native wsl_keepalive`
Expected: compile error, `wsl_keepalive` not found.

- [ ] **Step 3: Implement `wsl_args`, the constants and `next_delay`, plus a `#[cfg(not(windows))] pub fn start() {}`**

Module doc comment in the crate's style: one `//!` line saying it holds a `wsl.exe` open so WSL boots with Ledge and stays up while it runs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p ledge-native`
Expected: all tests PASS (the existing ones included).

- [ ] **Step 5: Implement `#[cfg(windows)] pub fn start()`**

- Create the job once: `CreateJobObjectW(None, None)`, then `SetInformationJobObject` with `JobObjectExtendedLimitInformation` and `LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Never close the handle (it closes when the process ends, which is what kills the child). On failure, carry on without a job.
- `std::thread::spawn` a loop: `Command::new("wsl.exe").args(wsl_args())` with null stdio and `.creation_flags(0x0800_0000)` (as in `daemon_token::read`); on spawn success, `AssignProcessToJobObject(job, HANDLE(child.as_raw_handle()))`, note the start `Instant`, `child.wait()`; then `delay = next_delay(started.elapsed(), delay)` (a failed spawn counts as `Duration::ZERO`) and `thread::sleep(delay)`. Start with `delay = MIN_DELAY`.
- `HANDLE` is not `Send`: move the job into the thread as its raw `isize`/pointer value and rebuild the `HANDLE` inside.

- [ ] **Step 6: Cross-compile for Windows**

Run: `cargo xwin check -p ledge-native --target x86_64-pc-windows-msvc`
Expected: `Finished`, no error and no new warning.

- [ ] **Step 7: Commit**

```bash
git add crates/ledge-native
git commit -m "feat(native): a wsl.exe keep-alive that boots WSL and holds it while Ledge runs"
```

### Task 2: Ledge Desktop starts the keep-alive; README; Windows check

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs` (`.setup(|app| { … })`, around line 215)
- Modify: `README.md:183` (the « Daemon lifetime » bullet)

**Interfaces:**
- Consumes: `ledge_native::wsl_keepalive::start()` (Task 1).

- [ ] **Step 1: Call `ledge_native::wsl_keepalive::start();` first in `setup`**, before `build_tray`, with a one-line comment: WSL stops once no `wsl.exe` holds it, so Ledge holds one from login until it quits and the daemon stays reachable. It runs after the single-instance plugin, so a second launch never starts a second keep-alive.

- [ ] **Step 2: Extend the README « Daemon lifetime » bullet** with one sentence: on Windows, Ledge Desktop keeps a hidden `wsl.exe --exec sleep infinity` running while it runs, because WSL stops once no `wsl.exe` holds it; so WSL, and the daemon with it, starts at login and stays up while Ledge is open.

- [ ] **Step 3: Build the Desktop crate and its tests**

Run: `cargo test -p ledge-native && cargo xwin check --manifest-path apps/desktop/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
Expected: tests PASS, check `Finished` with no new warning.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/main.rs README.md
git commit -m "feat(desktop): Ledge starts WSL at login and keeps it up while it runs"
```

- [ ] **Step 5: Build the installer and check on Windows (by hand, with the user)**

Build with the local cross-compile recipe (`pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --config '{"bundle":{"createUpdaterArtifacts":false}}'` in `apps/desktop`, pkg-config shim and NSIS include as usual), install with `setup.exe /P`. Then, from PowerShell (not from WSL, which would hold WSL itself):

1. Quit Ledge, `wsl --shutdown`, wait 10 s, `wsl -l -v` → `Stopped`. Start Ledge: no console window appears; `wsl -l -v` → `Running` within seconds.
2. Leave Ledge running, without opening a WSL shell: after 3 min `wsl -l -v` is still `Running` and Ledge shows the daemon connected (sessions visible, no « unreachable »).
3. `wsl --shutdown` with Ledge open → within ~5 s `wsl -l -v` is `Running` again; Ledge reconnects by itself within 30 s.
4. Quit Ledge from the tray → Task Manager shows no `wsl.exe` left from Ledge; after `vmIdleTimeout` (60 s by default) `wsl -l -v` → `Stopped`.
5. Sign out and back in (Ledge autostarts minimized) → the daemon is reachable without opening WSL.

Expected: all five hold. Report each result to the user.
