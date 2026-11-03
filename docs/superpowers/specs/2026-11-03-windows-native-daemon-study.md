# Ledge daemon on native Windows (no WSL): study

Date: 2026-11-03. Status: study, no code changed. Base: `main` at `fca617b5` (0.40.0).

Written by Otto (Claude Code, Linux machine `legion`). Measurements on the user's Windows PC are run by Otto-2 on this
branch (§6) and land in [2026-11-03-windows-native-results.md](2026-11-03-windows-native-results.md).

## 1. Question

Can the Ledge daemon (`packages/ledge`) be installed and run natively on Windows instead of inside WSL2? What depends
on Linux/Unix, what replaces it on Windows, what already works, how much work, which risks.

## 2. Summary

- There is **no Unix socket** anywhere: hooks, CLI, desktop and TUI all speak WebSocket on `127.0.0.1:47831`, which is
  portable as is.
- The one real blocker is **tmux**: the daemon spawns, types into, reads, attaches to and streams every agent through
  it. There is no native tmux on Windows (MSYS2/Cygwin tmux does not host native console programs like `claude.exe`
  well). The answer is a Ledge-owned **pane host** on ConPTY behind the existing `Tmux` interface (§3.1).
- The rest is a long list of small, mechanical adaptations (§3.2).
- Biggest risk: the adapters were tuned empirically under tmux; ConPTY re-renders output and may handle input bursts
  differently. A prototype must settle that first (§5).

## 3. Linux/Unix dependencies and their Windows replacement

### 3.1 tmux (`packages/ledge/src/tmux.ts`): the blocker

Used for: `new-session` (launch an agent), `send-keys` (answers, cross-session messages), `capture-pane -J` every second
(preview and prompt detection), `display-message` (pane width, `pane_current_path`), `attach` (Windows Terminal tab,
embedded terminal), `-C` control mode (the phone's terminal, `mobile/terminal.ts` + `ControlParser`), `kill-session`,
`set-option @ledge_title`.

Replacement: a **pane host**, a separate long-lived process playing the tmux server's role:

- each agent runs in a **ConPTY** (`node-pty`, or `portable-pty` in Rust, already used by `crates/ledge-native/src/pty.rs`
  on Windows);
- a headless emulator (**@xterm/headless** + `@xterm/addon-serialize`) keeps screen and scrollback; `capture-pane -J`
  becomes reading the buffer and joining lines flagged `isWrapped`;
- a table maps tmux key names used by the adapters (`Enter`, `Escape`, `C-u`, `C-c`, `BTab`, `Up`/`Down`, …) to VT
  sequences;
- **named pipes** `\\.\pipe\ledge-<id>` with a DACL restricted to the current user serve `attach`, read-only clients and
  the phone stream (replacing `-C` and `ControlParser`); the default pipe DACL grants read to Everyone and must not be
  kept;
- one **Job Object** per pane so `killSession` ends the whole tree (agent, its MCP servers…);
- the exit code is known directly, which removes the `sh -c '"$@"; echo $? > "$0"'` wrapper in `spawn.ts`;
- `unset` (today `env -u`) becomes building the child environment directly;
- resize policy: one ConPTY size; read-only clients (phone) never size it, as tmux's `ignore-size`.

The seam already exists: `Tmux` is an interface (`routedTmux`, fake tmux in tests). A `conptyPanes()` implementation of
the same contract keeps the daemon untouched above it. The pane host is started detached and **outside the daemon's Job
Object** (`CREATE_BREAKAWAY_FROM_JOB`) so agents outlive a daemon restart: the equivalent of today's
`systemd-run --scope` trick (`newSessionCommand`).

`paneCwd` (used for OpenRig seats only) has no cheap Windows equivalent (another process's cwd needs its PEB); OpenRig
is tmux-based anyway and is out of scope on Windows.

### 3.2 Everything else

| Area | Today | Windows |
|---|---|---|
| Service: `cli/setup.ts`, `cli/uninstall.ts`, `update/run-update.ts` | systemd `--user` unit, linger, `systemctl restart` | **Scheduled task at logon** with restart on failure, or supervision by Ledge Desktop (already autostarts). Not a Windows *service*: session 0, no user profile, credentials or tokens. Update: the task restarts the daemon; the pane host stays. |
| Update guard: `update/guard.ts`, `update/self.ts` | `/proc/<pid>/cgroup`, `INVOCATION_ID` | Check the pane host is outside the daemon's Job. `installKind` only tests `/` separators: accept `\`. `manualCommand` names `systemctl`. |
| Environment: `shell-path.ts` | `$SHELL -l -c 'env -0'` | Read `HKCU\Environment` + `HKLM\…\Session Manager\Environment` (expand `%VAR%`), merged over the process's. |
| Signals: `daemon/index.ts`, `daemon/omp/rpc.ts`, `daemon/omp/owner.ts`, `chat/run.ts`, `daemon/commands.ts`, `transport/ssh.ts`, `cli/setup.ts` | SIGTERM, grace, SIGKILL | `kill()` is `TerminateProcess`: no grace, no handler. Stop the daemon over the protocol (`daemon.stop` on WS, or a named event); trees via Job Object or `taskkill /T`. `process.kill(pid, 0)` works as is. |
| `/proc`: `cli/hook.ts` `underCodexDaemon`, `daemon/omp/owner.ts` | parent chain and `cmdline` | Codex: trust only `LEDGE_CODEX_HOOK_SESSION` (already injected with `-c`). OMP: record pid + token at launch, or `NtQueryInformationProcess`. |
| Agent and chat binaries: `spawn.ts`, `chat/*.ts`, `daemon/models.ts`, `daemon/commands.ts`, `chat/forge.ts`, `daemon/openrig.ts` | `execFile('claude' / 'codex' / 'cursor-agent' / 'omp')` | npm installs give `.cmd` shims, which Node 22 refuses to spawn without `shell` (CVE-2024-27980). Resolve the real binary (`claude.exe` from the native installer, or `node` + the package's script) rather than `shell: true`. |
| Hooks: `cli/setup.ts` `writeBin` | `#!/bin/sh` script in `~/.local/bin/ledge` | Write absolute, quoted, forward-slash commands into `settings.json` / `hooks.json` (`"C:/…/node.exe" "C:/…/cli/index.js" hook X`) so they work through cmd and Git Bash alike (which shell Claude Code uses for hooks on Windows: to verify). A `ledge.cmd` for the human. |
| Paths and home: `chat/service.ts` (`HOME` regex), `tmux.ts` `paneCwd` (`startsWith('/')`), `daemon/folders.ts`, `mobile/risk.ts`, `chat/context.ts` | POSIX paths, `/mnt/c` | `path.win32`, drive roots, `C:\Users\*`; `~/.ledge` → `%USERPROFILE%\.ledge`. `daemon/transcript.ts` already yields `C--Users-…`, as Claude Code does. |
| Permissions: `auth.ts`, `mobile/files.ts`, `tui/settings.ts` | `chmod 0o600` | No-op on Windows. The profile is user-only by default; verify, or set the ACL with `icacls`, for `token` and `mobile-key`. |
| Atomic writes: `daemon/journal.ts`, `store.ts`, `history.ts`, `attachments.ts` | `rename()` | `EPERM`/`EBUSY` when an antivirus or reader holds the file: retry. |
| TUI: `tui/clipboard.ts`, `tui/openImage.ts`, `tui/terminalProfile.ts` | `/mnt/c/…/powershell.exe`, `wslpath`, `cmd.exe`, `wsl.exe` profile | `powershell.exe`, `explorer.exe`, `wt.exe` directly, no `wslpath`. |
| SSH to remote machines: `transport/ssh.ts` | `ssh` | Windows' built-in OpenSSH client. The remote side stays Linux. |
| Git: `daemon/git.ts`, `daemon/repos.ts` | `git` | Git for Windows. `windowsHide` already set in `repos.ts`. |
| OpenRig: `daemon/openrig*.ts` | seats on the default tmux server, `rig` | **Out of scope** on Windows (OpenRig is tmux-based). |
| Desktop (Rust): `crates/ledge-native` `wsl_keepalive.rs`, `daemon_token.rs`, `pty.rs`, `terminal.rs`; `apps/desktop/src-tauri/src/pty.rs`, `main.rs` | `wsl.exe` everywhere | Read the token file directly; `pty_open` runs `node cli attach <id>` with no `wsl.exe`; `wt.exe new-tab` runs the native launcher; no WSL keep-alive. The desktop must pick WSL or native daemon. |
| Port | WSL2 forwards its loopback to Windows | A WSL daemon and a native one both want `127.0.0.1:47831`: one mode at a time, or another port with WSL seen as a "machine" (multi-machine already exists). |

## 4. What already works

Zod protocol, WebSocket transport on loopback, store and reducer, history, mail between sessions, tasks; the adapters'
parsing (pure text) and the hooks' client logic; the mobile layer (relay, crypto, passkeys); `git`, `ssh`, the Ink TUI.
The desktop and the island are already native Windows, and `portable-pty` already runs ConPTY there. CI already has a
`windows-latest` runner (`.github/workflows/release.yml`).

## 5. Plan, effort, risks

| # | Step | Human estimate | If Otto codes it |
|---|---|---|---|
| 0 | **Prototype**: pane host + Claude adapter on ConPTY (go/no-go on risk 1) | 3 d | ½ d + one test on the PC |
| 1 | Pane host on ConPTY + `Tmux` implementation (capture, keys, width, attach over pipe, Job Object) | 2–3 wk | ~1 d of sessions incl. Windows CI |
| 2 | Daemon port: paths, registry env, stop without signals, `/proc`, `.cmd`/`.exe` resolution, `rename` retries | 1 wk | a few hours |
| 3 | `ledge setup` / `uninstall` on Windows: absolute hook commands, scheduled task, ACL, self-update without systemd | 3–5 d | a few hours |
| 4 | Desktop native mode: token, pty, `wt.exe`, WSL/native choice | 3–4 d | a few hours |
| 5 | Phone terminal on the pane host instead of `tmux -C` | 3–5 d | a few hours |
| 6 | Re-validate Claude and Codex adapters under ConPTY with real agents | 1 wk+ | little code; **the user's / Otto-2's test loops** |
| 7 | Windows tests and CI (real path, not only fake tmux) | 2–3 d | 1–2 h |

Minimal version (Claude Code only, no phone terminal, no OpenRig): ~3–4 weeks for a human. Full parity: ~6–8 weeks.
Coded by Otto: ~2–4 days of agent work; the long, unpredictable part is step 6, bound by tests on the real PC.

Risks, worst first:

1. **ConPTY fidelity vs tmux.** The adapters were tuned under tmux ("seen in tmux" throughout): paste-burst detection
   (Codex, Claude), the pause before Enter, dialog rendering. ConPTY rewrites the output stream. Everything must be
   re-validated; success is not guaranteed.
2. **Agents on Windows.** Claude Code native works. Codex on Windows is more limited (sandbox). Cursor Agent CLI and OMP
   on Windows: unverified. OpenRig: excluded.
3. **Hook latency.** The budget is 100 ms; a cold Node start on Windows with Defender is close to or above it: lost
   events. Raise timeouts, or later a small native `ledge-hook.exe`.
4. **Security.** Named pipe DACL must be restricted explicitly; `chmod` is a no-op.
5. **Updates and lifetime.** Updating the pane host kills the agents, as the tmux server today: keep an equivalent
   guard and a versioned pane-host protocol.
6. **Coexistence with WSL** on port 47831 (§3.2).
7. **Two platforms** to test for every adapter change.

Recommendation: step 0 first. If the prototype holds, aim for the minimal version and keep WSL as the default mode.

## 6. Measurements on the Windows PC (for Otto-2)

Otto (Linux) cannot reach the PC; Otto-2 runs there and works on this branch, `docs/windows-native-study`.

Rules: do not modify the user's working repository nor the existing Ledge install; no agent on a real task. If
software is missing (Node 22+, pnpm, Git), **ask the user before installing it**. If you run inside WSL, run everything
on the Windows side through `powershell.exe -NoProfile -Command …` and work on the Windows disk (`%TEMP%`), not in
`\\wsl$`.

1. **Environment.** Windows version; `node -v`, `pnpm -v`, `git --version` on the Windows side; what `where claude`,
   `where codex`, `where cursor-agent` return (`.exe` or `.cmd`?). Say whether you run in WSL or native Windows.
2. **Current test suite on Windows.** Clone `https://github.com/Lyssaen/ledge.git`, branch `docs/windows-native-study`,
   into `%TEMP%\ledge-wintest`. Run `pnpm install --frozen-lockfile`, then `pnpm --filter @paradow/ledge typecheck` and
   `pnpm --filter @paradow/ledge test`. Report passed / failed counts, failures **grouped by cause** (`/` paths, tmux
   missing, `/proc`, `chmod`, signals, other), one sample message per group.
3. **ConPTY probe.** In a separate folder (`%TEMP%\conpty-probe`), install `node-pty` and `@xterm/headless`. Write a
   script that:
   - starts `claude` (the real binary found in step 1) in a 120×40 pseudo-terminal, cwd `%TEMP%\conpty-probe`;
   - feeds the output to a headless Terminal;
   - waits for the input box, then captures the screen as text (buffer lines, with the `isWrapped` flag);
   - types `bonjour` one character at a time, captures, sends Ctrl+U (`\x15`), captures;
   - types `/exit`, then **after a 150 ms pause** Enter (`\r`), and gets the exit code.

   Submit no prompt. Report: the three raw captures; whether box drawing and Unicode are intact; whether Ctrl+U cleared
   the input; whether `/exit` closed Claude; the exit code; timings (start → input box, exit). Commit the probe script
   under `scripts/windows-probe/` on this branch.
4. **Hook latency.** Measure 10 cold runs of `node -e "0"` on the Windows side (`Measure-Command`): min, median, max.

Write the report, 4 sections with the raw results, to
`docs/superpowers/specs/2026-11-03-windows-native-results.md` on this branch, commit and push. Leave
`%TEMP%\ledge-wintest` and `%TEMP%\conpty-probe` in place for what follows.
