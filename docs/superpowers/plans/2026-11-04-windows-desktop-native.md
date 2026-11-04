# Ledge Desktop native mode on Windows: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a Windows PC without WSL, Ledge Desktop runs the Ledge daemon itself (start or adopt at launch, restart on crash, stop over the protocol), talks to it natively (token file, terminals without `wsl.exe`), and hides every feature outside the acceptance bar.

**Architecture:** Most of the work is in the `ledge-native` crate:
- `native.rs` holds the mode, paths, port and token-file read.
- `supervisor.rs` is a supervisor loop behind an `Ops` trait. Linux tests use a fake `Ops`; the Windows implementation backs the real one.
- Native variants of the terminal and pty helpers.

`main.rs` picks the mode once at startup and branches on it. The page asks the shell for the mode at boot (`native_info`), then:
- connects to the port the shell gives;
- gates features through one pure function, `features(native)`, read by the entry points.

**Tech Stack:**
- Rust: Tauri 2, `windows` 0.58, `portable-pty` 0.9, plus `tungstenite` 0.24 and `serde_json` 1 (new in `ledge-native`).
- Front: React, vitest, testing-library.

**Spec:** `docs/superpowers/specs/2026-11-03-windows-native-design.md`. This plan covers §4.2 item 4 and the acceptance bar in §1. The daemon side is already merged (#196): `DaemonInfo.platform`, `daemon.stop` (win32 only), `ledge setup` on Windows, and the pane host (#194).

## Global Constraints

- Mode choice: **native when WSL is absent**, WSL mode otherwise, with no change for current users (spec §4.2.4). There is no user setting. The env override `LEDGE_DESKTOP_MODE=native|wsl` exists for tests on a PC that has WSL.
- **Quitting Desktop stops neither the daemon nor the agents.** The next launch finds the running daemon and adopts it.
- There is no scheduled task, no service, and no WSL keep-alive in native mode.
- Token: `%USERPROFILE%\.ledge\token`, or `%LEDGE_HOME%\token`, read directly. A token is exactly 64 lowercase hex characters.
- Port `47831`. Desktop's `LEDGE_PORT` overrides it, is passed to the daemon, and is given to the page. It exists for tests on a PC whose mirrored WSL reserves 32768–60999.
- Hidden in native mode (spec §1):
  - chat (Ledge home and the docked panel);
  - the Atelier and its detached window;
  - documents;
  - browser captures;
  - tasks, handover and mail between sessions;
  - broadcast;
  - the island (notch and its settings);
  - the phone (Mobile settings, pairing);
  - the login-shell terminal tabs;
  - the daemon's npm update UI.
- Visible in native mode:
  - the sidebar session list;
  - launch;
  - the session page (state, pending dialogs, reply, the agent's terminal and "open in Windows Terminal");
  - Settings: general, appearance, machines, notifications, sounds, shortcuts, about, projects;
  - SSH machines and their OpenRig page.
- The WSL mode is byte-for-byte the same behaviour: every existing test stays green.
- The runtime (node + CLI) is found at `LEDGE_NODE`/`LEDGE_CLI` when both are set. Otherwise it is at `<resource_dir>/runtime/node.exe` and `<resource_dir>/runtime/ledge/dist/cli/index.js`. The installer (step 5) fills or moves that folder. Its layout is decided there, behind `runtime()`.

## Review Focus

1. **A stale `daemon.pid` whose PID now belongs to another process.** Adoption must never wait on, or treat as the daemon, a process that is not `node`. The port must answer first; the PID is checked for its image name. Test: `adopt_ignores_a_pid_that_is_not_node` (Task 2).
2. **The daemon crashing in a loop** (a bad build, a port taken by something else). Restarts must back off to 60 s, never spin. Test: `a_crash_loop_backs_off_to_a_minute` (Task 2).
3. **A Windows path or a session title with a space, an accent, `;` or `"`.** Native terminals must either run the exact argv or refuse it. `wt.exe` must never split it into a second command. Test: `native_terminal_args_escape_semicolons_and_refuse_quotes` (Task 3).
4. **The local daemon not up yet at boot** (first launch: no token file yet). The page must wait and connect once the token appears, and must not show the WSL instructions. Test: `token_file_absent_then_present` (Task 1) and `native copy never says WSL` (Task 6).
5. **A WSL user's Desktop must not change.** Mode detection must return WSL whenever a distro is registered, and the WSL code paths must stay as they are. Tests: `choose_mode` cases (Task 1) and `features(false)` returns everything on (Task 5).

---

### Task 1: `native.rs`: mode, paths, port, runtime, token file

**Files:**
- Create: `crates/ledge-native/src/native.rs`
- Modify: `crates/ledge-native/src/lib.rs` (add `pub mod native;`), `crates/ledge-native/src/daemon_token.rs` (extract `valid_token(&str) -> Option<String>` from `outcome`, reused)

**Interfaces:**
- Produces:
  - `pub enum Mode { Native, Wsl }` (derive Debug, Clone, Copy, PartialEq, Eq, serde-free)
  - `pub fn choose_mode(override_: Option<&str>, wsl_has_distro: bool) -> Mode`
  - `pub fn wsl_has_distro() -> bool` (Windows: `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss` has at least one subkey; elsewhere `false`)
  - `pub fn ledge_home(env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf>`
  - `pub fn port(env: &dyn Fn(&str) -> Option<String>) -> u16`
  - `pub struct Runtime { pub node: PathBuf, pub cli: PathBuf }`
  - `pub fn runtime(env: &dyn Fn(&str) -> Option<String>, resource_dir: Option<&Path>, exists: &dyn Fn(&Path) -> bool) -> Option<Runtime>`
  - `pub fn read_token_file(path: &Path) -> TokenRead` (reuses `daemon_token::TokenRead`)

- [ ] **Step 1: Write the failing tests** (in `native.rs`, `#[cfg(test)]`)

```rust
#[test] fn choose_mode_is_native_only_without_a_wsl_distro() {
    assert_eq!(choose_mode(None, true), Mode::Wsl);
    assert_eq!(choose_mode(None, false), Mode::Native);
    assert_eq!(choose_mode(Some("native"), true), Mode::Native);
    assert_eq!(choose_mode(Some("wsl"), false), Mode::Wsl);
    assert_eq!(choose_mode(Some("bogus"), true), Mode::Wsl);   // an unknown override is ignored
}
#[test] fn ledge_home_is_ledge_home_else_userprofile_dot_ledge() {
    let env = |m: &'static [(&'static str, &'static str)]| move |k: &str| m.iter().find(|(a, _)| *a == k).map(|(_, v)| v.to_string());
    assert_eq!(ledge_home(&env(&[("USERPROFILE", r"C:\Users\po")])), Some(PathBuf::from(r"C:\Users\po").join(".ledge")));
    assert_eq!(ledge_home(&env(&[("LEDGE_HOME", r"D:\l"), ("USERPROFILE", r"C:\Users\po")])), Some(PathBuf::from(r"D:\l")));
    assert_eq!(ledge_home(&env(&[])), None);
}
#[test] fn port_is_47831_unless_a_valid_override() {
    // same env helper
    assert_eq!(port(&env(&[])), 47831);
    assert_eq!(port(&env(&[("LEDGE_PORT", "27832")])), 27832);
    assert_eq!(port(&env(&[("LEDGE_PORT", "0")])), 47831);
    assert_eq!(port(&env(&[("LEDGE_PORT", "x")])), 47831);
}
#[test] fn runtime_prefers_both_overrides_else_the_bundled_folder() {
    // overrides used only when both are set and both exist; else <res>/runtime/node.exe + <res>/runtime/ledge/dist/cli/index.js
    // when those exist; else None
}
#[test] fn token_file_absent_then_present() {
    // tempdir: missing file → Absent; "<64 hex>\n" → Token; "nope" → Unavailable
}
```

- [ ] **Step 2: Run on the Windows PC:** `cargo test -p ledge-native native::` in the Windows checkout.
  Expected: FAIL (module missing). There is no cargo on Linux. All `ledge-native` and `ledge-desktop` Rust runs happen on the PC, in a checkout of this branch.
- [ ] **Step 3: Implement.** `wsl_has_distro` uses `RegOpenKeyExW` and `RegQueryInfoKeyW` (subkey count > 0). Add `Win32_System_Registry` to the crate's `windows` features. `read_token_file` maps NotFound → `Absent`, any other read error → `Unavailable`, and the content through `valid_token`.
- [ ] **Step 4: Run** `cargo test -p ledge-native`. Expected: all pass, including the existing `daemon_token` tests.
- [ ] **Step 5: Commit** `feat(desktop-native): mode, paths, port and token file for native Windows`

### Task 2: `supervisor.rs`: start or adopt, restart on crash, stop over the protocol

**Files:**
- Create: `crates/ledge-native/src/supervisor.rs`
- Modify: `crates/ledge-native/Cargo.toml` (add `tungstenite = "0.24"` and `serde_json = "1"`; add `Win32_System_ProcessStatus` to the `windows` features if needed)

**Interfaces:**
- Consumes: `native::{Runtime, read_token_file}`, `wsl_keepalive::next_delay` (the same backoff: 2 s → ×2 → 60 s, reset after a 60 s run).
- Produces:
  - `pub trait Proc: Send { fn wait(&mut self); fn pid(&self) -> u32; }`
  - `pub trait Ops: Send + Sync`:
    - `fn port_open(&self) -> bool`
    - `fn read_pid(&self) -> Option<u32>`
    - `fn open(&self, pid: u32) -> Option<Box<dyn Proc>>` (only when that PID's image is `node.exe`)
    - `fn spawn(&self) -> std::io::Result<Box<dyn Proc>>`
    - `fn send_stop(&self) -> bool`
    - `fn sleep(&self, d: Duration)`
    - `fn log(&self, line: &str)`
  - `pub struct Supervisor`, with:
    - `pub fn start(ops: Arc<dyn Ops>) -> Supervisor`: runs the loop on its own thread.
    - `pub fn stop_and_wait(&self, timeout: Duration) -> bool`: sends `daemon.stop`, waits for the process to exit, and holds restarts until `resume()`.
    - `pub fn resume(&self)`.
  - `pub fn windows_ops(rt: Runtime, home: PathBuf, port: u16, port_override: bool) -> Arc<dyn Ops>` (`#[cfg(windows)]`).

Loop, one turn:
- If `port_open()`: adopt.
  - Take `read_pid()` → `open(pid)`. With a handle, `wait()`.
  - Without one (no PID file, or the PID is not node), poll `port_open()` every 2 s until it closes. That counts as the exit.
- Else `spawn()` and `wait()`.
- After the exit:
  - If stopping, park until `resume()`.
  - Else `log`, sleep `next_delay(ran_for, prev)`, and turn again.

Each start and each exit is logged as one line.

- [ ] **Step 1: Write the failing tests** with a fake `Ops`. It scripts its answers, records calls, and has a `sleep` that records instead of sleeping.

```rust
#[test] fn starts_a_daemon_when_none_answers() { /* port closed → spawn called once */ }
#[test] fn adopts_a_running_daemon_instead_of_starting_one() { /* port open, pid 42 is node → open(42), no spawn */ }
#[test] fn adopt_ignores_a_pid_that_is_not_node() { /* port open, open(pid) → None → polls port, no spawn while it stays open */ }
#[test] fn restarts_after_a_crash() { /* spawned proc exits → sleep(2s) → spawn again */ }
#[test] fn a_crash_loop_backs_off_to_a_minute() { /* 7 immediate exits → sleeps 2,4,8,16,32,60,60 s */ }
#[test] fn stop_and_wait_sends_stop_waits_and_does_not_restart() {
    /* send_stop called; returns true once the proc exits; no spawn afterwards until resume(); after resume → spawn */
}
#[test] fn stop_and_wait_times_out_false_when_the_daemon_does_not_exit() {}
```

- [ ] **Step 2: Run** `cargo test -p ledge-native supervisor::` (PC). Expected: FAIL (module missing).
- [ ] **Step 3: Implement the loop**, then `windows_ops`:
  - `spawn` runs `node.exe <cli> daemon`.
    - cwd: `home`, created if missing.
    - stdio: null.
    - env: Desktop's own, plus `LEDGE_HOME` when Desktop had one, plus `LEDGE_PORT` when `port_override`.
    - Creation flags: `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB`. If that fails with access denied, retry without breakaway. The child is never put in a kill-on-close job, so it outlives Desktop.
  - `open` uses `OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION)`. It checks that `QueryFullProcessImageNameW` ends in `\node.exe` (case-insensitive).
  - `port_open`: TCP connect to `127.0.0.1:port` within 500 ms.
  - `send_stop`:
    1. Read the token file.
    2. Connect with tungstenite to `ws://127.0.0.1:<port>` with `Authorization: Bearer <token>`.
    3. Read frames until one parses with `"type":"snapshot"` (2 s cap).
    4. Send `{"type":"daemon.stop"}`.
  - `log`: append to `<home>/desktop.log`, truncated to empty first when it is over 1 MB.
- [ ] **Step 4: Run** `cargo test -p ledge-native` (PC). Expected: all pass.
- [ ] **Step 5: Commit** `feat(desktop-native): Desktop supervises the daemon (start or adopt, restart, stop over the protocol)`

### Task 3: native terminals: embedded pty and Windows Terminal without `wsl.exe`

**Files:**
- Modify: `crates/ledge-native/src/terminal.rs`, `crates/ledge-native/src/pty.rs`

**Interfaces:**
- Produces:
  - `pub fn native_arg_ok(s: &str) -> bool`: not empty, no `"`, no control character.
  - `pub fn native_terminal_args(title: &str, argv: &[String]) -> Vec<String>`: `["-w","0","new-tab","--title",wt_arg(title), wt_arg(argv…)]`, with no `wsl.exe --exec`.
  - `pub fn open_native(title: &str, argv: &[String]) -> Result<bool, String>`.
  - `pub fn native_command(argv: &[String]) -> Option<(String, Vec<String>)>`: program and args, `None` when an argument fails `native_arg_ok`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn native_terminal_args_escape_semicolons_and_refuse_quotes() {
    let argv: Vec<String> = [r"C:\Program Files\Ledge\runtime\node.exe", r"C:\Users\élise\cli.js", "attach", "a;b"].iter().map(|s| s.to_string()).collect();
    assert_eq!(native_terminal_args("demo;x", &argv), ["-w","0","new-tab","--title","demo\\;x", r"C:\Program Files\Ledge\runtime\node.exe", r"C:\Users\élise\cli.js", "attach", "a\\;b"]);
    assert!(!native_arg_ok("a\"b")); assert!(!native_arg_ok("")); assert!(!native_arg_ok("a\nb"));
    assert!(native_arg_ok(r"C:\dir\")); // a final backslash is fine without WSL
}
#[test] fn native_command_runs_argv_as_is() {
    assert_eq!(native_command(&["ssh".into(), "-t".into(), "--".into(), "ec2".into(), "'node' 'cli' 'attach' 'x'".into()]),
               Some(("ssh".into(), vec!["-t".into(), "--".into(), "ec2".into(), "'node' 'cli' 'attach' 'x'".into()])));
    assert_eq!(native_command(&[]), None);
}
```

- [ ] **Step 2: Run** `cargo test -p ledge-native terminal:: pty::` (PC). Expected: FAIL.
- [ ] **Step 3: Implement.** The existing WSL functions stay untouched.
- [ ] **Step 4: Run** `cargo test -p ledge-native` (PC). Expected: pass.
- [ ] **Step 5: Commit** `feat(desktop-native): terminals run the command itself, without wsl.exe`

### Task 4: `main.rs` and `pty.rs`: branch on the mode

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/src/pty.rs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (to the page):
  - command `native_info` → `{ "mode": "native" | "wsl", "port": <u16> }`;
  - `daemon_token` (same answer shape) reads the file in native mode;
  - `pty_open` and `open_terminal` run the argv natively in native mode;
  - command `daemon_stop` → `bool`, which is `Supervisor::stop_and_wait(15 s)` then `resume()`. It is not called by the page in this plan; the installer step uses it before an update.

Setup in native mode:
- No `wsl_keepalive`, no `notch::setup`, no `media::start`.
- On a background thread:
  1. Run `node <cli> setup` once (stdout and stderr appended to `desktop.log`; a failure is logged and the daemon still starts).
  2. Start `Supervisor::start(windows_ops(…))`.
- The `Supervisor` is managed state.
- If `runtime()` is `None`, log it and start nothing. The page then shows the daemon as unreachable.
- `RunEvent::Exit` does not touch the daemon.

- [ ] **Step 1: Write the failing test** in `main.rs` tests: a pure `fn subsystems(mode: Mode) -> Subsystems { keepalive, notch, media, supervisor: bool }`.

```rust
#[test] fn native_mode_supervises_the_daemon_and_starts_no_wsl_keepalive_nor_island() {
    assert_eq!(subsystems(Mode::Native), Subsystems { keepalive: false, notch: false, media: false, supervisor: true });
    assert_eq!(subsystems(Mode::Wsl), Subsystems { keepalive: true, notch: true, media: true, supervisor: false });
}
```

- [ ] **Step 2: Run** `cargo test -p ledge-desktop` (PC). Expected: FAIL.
- [ ] **Step 3: Implement.** The mode is computed once in `main()` as `choose_mode(env LEDGE_DESKTOP_MODE, wsl_has_distro())` and managed as state. Off Windows it is always `Wsl`.
- [ ] **Step 4: Run** `cargo test -p ledge-desktop` and `cargo build -p ledge-desktop` (PC). Expected: pass, and it builds.
- [ ] **Step 5: Commit** `feat(desktop-native): Desktop runs natively when WSL is absent`

### Task 5: the page knows the mode: boot, port, feature gates, native overview

**Files:**
- Create: `apps/desktop/src/native/mode.ts`, `apps/desktop/src/native/NativeOverview.tsx`
- Modify:
  - `apps/desktop/src/main.tsx` (await `loadNativeInfo()` with the languages, before render);
  - `apps/desktop/src/tauri/bridge.ts` (`nativeInfo()`);
  - `apps/desktop/src/fleet/useFleet.ts` (`createDesktopFleet` default url `ws://127.0.0.1:<port>`);
  - `apps/desktop/src/App.tsx` (overview renders `NativeOverview` when native; the start place is the overview when native);
  - `apps/desktop/src/i18n/fr.ts` and `en.ts`.
- Test: `apps/desktop/test/native-mode.test.tsx`

**Interfaces:**
- Produces:
  - `export interface NativeInfo { mode: 'native' | 'wsl'; port: number }`
  - `export async function loadNativeInfo(): Promise<NativeInfo>` (outside Tauri, or on error: `{ mode: 'wsl', port: 47831 }`)
  - `export function nativeInfo(): NativeInfo` (sync, after boot)
  - `export function isNative(): boolean`
  - `export interface Features { chat; atelier; documents; captures; tasks; broadcast; island; mobile; shells; daemonUpdates: boolean }`
  - `export function features(native: boolean): Features` (all `true` when not native, all `false` when native)
  - `export function useFeatures(): Features` (from `isNative()`)

  The test hook `setNativeInfoForTests(info)` lives in `test/helpers.ts`, not in production code. It is done through `vi.mock` of `../src/tauri/bridge`.

`NativeOverview` shows:
- the title `t.native.title` ("Sessions");
- a line `t.native.hint` ("Vos sessions sont dans la barre de gauche. Lancez-en une nouvelle ici.");
- a primary button `t.native.launch` ("Nouvelle session") that dispatches `{ type: 'launch' }`.

The `n` key keeps working, since the place is still `overview`.

- [ ] **Step 1: Write the failing tests**

```ts
it('features: everything in WSL mode, nothing outside the acceptance bar in native mode', () => {
  expect(Object.values(features(false)).every(Boolean)).toBe(true);
  expect(Object.values(features(true)).some(Boolean)).toBe(false);
});
it('outside Tauri the mode is WSL on 47831', async () => { expect(await loadNativeInfo()).toEqual({ mode: 'wsl', port: 47831 }); });
it('native mode starts on the overview and shows the native overview, not the Atelier', async () => {
  // bridge mocked: native_info → { mode: 'native', port: 27832 }; render <App>; expect text 'Nouvelle session' button, no Atelier region
});
it('the local client connects to the port the shell gives', () => { /* createDesktopFleet with WebSocketImpl spy → url ws://127.0.0.1:27832 */ });
```

- [ ] **Step 2: Run** `pnpm --filter @ledge/desktop exec vitest run test/native-mode.test.tsx`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** that file, then the whole desktop suite: `pnpm --filter @ledge/desktop test`. Expected: pass, with the same failures as `origin/snapshot` if any (record them before starting).
- [ ] **Step 5: Commit** `feat(desktop-native): the page learns the mode at boot and shows a native overview`

### Task 6: hide what native mode does not offer yet

**Files:**
- Modify (one gate per entry point, from `useFeatures()`, or from `isNative()` outside React):
  - `shell/sidebar/Sidebar.tsx`:
    - the "Ledge" entry (`chat`);
    - the "Atelier" view button (`atelier`);
    - Attention decisions, closed tasks and near-limit cards (`tasks`);
    - the broadcast picked bar (`broadcast`).
  - `shell/sidebar/Tree.tsx` and `SidebarMenus.tsx`: ✉ and Ctrl+click picking. They follow the `broadcast` prop, which `App.tsx` sets to `canBroadcast(machines) && f.broadcast`.
  - `shell/TitleBar.tsx`: the chat icon (`chat`).
  - `shell/TopBar.tsx`: the overview tools (helpers, pause, Detach) (`atelier`).
  - `nav/useKeys.ts`: `Ctrl+/` and `/` are inert when `!chat`.
  - `App.tsx`:
    - `HomePlace` and `ChatPlace` are not rendered when `!chat`, and place `home` falls back to the overview;
    - `onDetach` is set only when `atelier`;
    - `useAlerts` gets `tasks: []` when `!tasks`;
    - `usePairingAlerts`, `usePairingDialogState` and `<PairingDialog>` get `mobile: undefined` when `!mobile`;
    - `SessionMenuHost onHandover` is set only when `tasks`;
    - `shellArgv` returns `null` when `!shells`.
  - `shell/Footer.tsx`: the island button (`island`).
  - `settings/SettingsPage.tsx`: the `island` and `mobile` sections are hidden from the nav and not renderable when off.
  - `session/SessionPage.tsx`:
    - `openDoc`, `onDocument` and `onCapture` are undefined, and the captures pill is hidden (`documents`, `captures`);
    - the held task, the handover and relieves pills, and `onConversation` are hidden (`tasks`).
  - `session/RightPanel.tsx`: the shell tabs and `+` are hidden when `!shells`. The "± Modifications" tab stays.
  - `update/daemon.ts` (`useDaemonUpdates`): no daemon update offer when `!daemonUpdates`.
  - `openrig/OpenRigPage.tsx`: with no `machine` given in native mode, it opens the first SSH machine, not `local`.
  - i18n (`fr.ts`, `en.ts`): native variants of the WSL copy:
    - `daemonOutdated.body` → "Ce Ledge Desktop a besoin d'un démon plus récent : mettez Ledge Desktop à jour."
    - machines `noteLead` → "Ledge rejoint vos serveurs par SSH, depuis ce PC. "
    - `localKind` → "Local · Windows"
    - `aliasHint`, `checklist[0]` and the `alias`/`key`/`hostKey` errors: "~/.ssh/config de WSL" → "%USERPROFILE%\.ssh\config", "depuis WSL" → "depuis ce PC"
    - the terminal target `local` → "windows"

    Each is chosen by `isNative()` at the call site, through a small `wslOrNative(t.x, t.native.x)` helper in `native/mode.ts`.
- Test: `apps/desktop/test/native-hide.test.tsx`

- [ ] **Step 1: Write the failing tests**: one render per surface in native mode, plus the same render in WSL mode for the positive check.

```ts
it('native: no chat entry, no chat icon, Ctrl+/ does nothing', ...);
it('native: no Atelier button, no Detach, the overview tools are absent', ...);
it('native: no broadcast pick bar nor project ✉ even when the daemon offers broadcast', ...);
it('native: Settings lists neither Île nor Téléphone', ...);
it('native: the session page has no captures pill, no handover pill, document links are plain text', ...);
it('native: no shell tab nor + in the right panel; ± Modifications stays', ...);
it('native: the session menu has no « Passer le relais »', ...);
it('native: OpenRig opens the SSH machine by default', ...);
it('native copy never says WSL', () => { /* render Machines settings + DaemonOutdated in native mode: no /WSL/ in text */ });
it('WSL mode is unchanged: every entry above is present', ...);
```

- [ ] **Step 2: Run** `pnpm --filter @ledge/desktop exec vitest run test/native-hide.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement the gates.**
- [ ] **Step 4: Run** the desktop suite and `pnpm --filter @ledge/desktop exec tsc --noEmit`. Expected: pass, with the baseline failures only.
- [ ] **Step 5: Commit** `feat(desktop-native): native mode hides what is outside the acceptance bar`

### Task 7: verify on the Windows PC

There are no code changes unless a check fails; each failure goes back to the owning task with a test.

Setup on the PC:
1. Build the branch with `pnpm --filter @ledge/desktop tauri build --debug --no-bundle` in the Windows checkout.
2. Back up `%USERPROFILE%\.claude\settings.json`.
3. **Ask the user to quit their installed Ledge Desktop** (single-instance: same identifier).
4. Run the debug exe with:
   - `LEDGE_DESKTOP_MODE=native`
   - `LEDGE_PORT=27832`
   - `LEDGE_HOME=%TEMP%\ledge-spike\home`
   - `LEDGE_NODE`/`LEDGE_CLI` = the spike clone's node and `packages/ledge/dist/cli/index.js`
   - `CODEX_HOME=%TEMP%\ledge-spike\codex-home`

Checks, each recorded in the spike report under a new section "Desktop native mode":
1. At launch, `desktop.log` shows `setup` then a daemon start, and the window connects without WSL.
2. Launch Claude in a scratch folder from Desktop. It reaches idle, a harmless prompt runs and returns to idle, and the embedded terminal shows the agent and takes typing.
3. "Open in Windows Terminal" opens a `wt` tab attached to the same session.
4. Kill the daemon (`taskkill /PID <daemon>`). Desktop restarts it, and the session is still there (pane host).
5. Quit Desktop: the daemon and the agent keep running. Relaunch: `desktop.log` says "adopted", with no second daemon.
6. The hidden features are absent (screenshot of the sidebar, title bar and settings).
7. Cleanup:
   - restore `settings.json`;
   - stop the daemon and the pane host;
   - tell the user their Desktop can be restarted.

- [ ] **Commit** `docs(spec): Desktop native mode verified on the PC`

The updater wiring (`daemon_stop` before installing a Desktop update) and the bundled runtime folder belong to step 5 (installer).
