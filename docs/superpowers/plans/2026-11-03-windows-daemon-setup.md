# Windows Daemon and Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a Windows PC without WSL, `ledge setup` wires Claude Code and Codex to Ledge, and the daemon runs there with the user's environment, stops without signals and survives antivirus file locks.

**Architecture:** Small platform branches at the points the study lists (design §4.2.2–3), each behind `process.platform === 'win32'` or an injected platform, so Linux keeps its code paths. The daemon tells its fronts its platform, so Desktop can hide what native mode does not offer yet (Desktop itself is step 4).

**Tech Stack:** TypeScript (Node 22), vitest, `reg.exe` for the registry.

**Spec:** `docs/superpowers/specs/2026-11-03-windows-native-design.md` §4.2 items 2 and 3, §6 (Codex sandbox, decided with the user on 2026-11-03: Ledge sets it to the non-admin one); spike report `docs/superpowers/specs/2026-11-03-windows-native-spike.md` § « Hooks » (the two hook command forms).

## Global Constraints

- Branch `feat/windows-daemon-setup` from `origin/snapshot`, worktree `/home/gch/development/ledge-panehost`; PR into `snapshot`.
- Linux/WSL behaviour unchanged; the Linux suite shows only the known failures (capture worker, server-attachments, flaky TUI and mobile e2e).
- Hook commands on Windows (spike, measured): Claude `"<node.exe>" "<cli>" hook <Event>`; Codex `& '<node.exe>' '<cli>' hook codex <Event>` (Codex runs hooks through `powershell.exe -NoProfile -Command`). Paths with forward slashes.
- Codex sandbox on Windows: `[windows]` → `sandbox = "unelevated"` in `$CODEX_HOME/config.toml` (what Codex 0.166 writes when the non-admin sandbox is chosen); a value already there is kept.
- Not here: Desktop native mode, the installer, OpenRig/EC2, Cursor/OMP on Windows, Windows CI.

## Review Focus

- A user who already chose a Codex sandbox (admin one, set up by IT) keeps it → Task 6 « keeps a sandbox already chosen ».
- `ledge setup` run twice adds nothing the second time, and `ledge uninstall` removes exactly the Windows hook commands → Task 6 « idempotent » and Task 7.
- A registry value that references another (`%USERPROFILE%\bin`, `%JAVA_HOME%`) is expanded, an unknown one kept as written → Task 2.
- A journal write while an antivirus holds the file: retried, then the original error, never a lost journal → Task 4.
- `daemon.stop` from a client without the token cannot stop the daemon → Task 3 (the WebSocket already refuses tokenless clients; the test proves it for this message).

---

### Task 1: Line endings, and the daemon's platform

**Files:**
- Create: `.gitattributes` (`* text=auto eol=lf`, plus `*.png *.ico *.icns *.jpg *.woff2 binary`)
- Modify: `packages/protocol/src/messages.ts:90` (`DaemonInfoSchema`: `platform: z.string().optional()`), `packages/ledge/src/update/self.ts` (`daemonInfo()` sets `platform: process.platform`)
- Test: `packages/ledge/test/update-self.test.ts` (new case)

**Interfaces:**
- Produces: `DaemonInfo.platform?: string` (Node's `process.platform`), read by Desktop in step 4.

- [ ] **Step 1: Write the failing test**: `daemonInfo()` resolves with `platform: process.platform`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/update-self.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; add `.gitattributes`.
- [ ] **Step 4: Run** it and `pnpm --filter @ledge/protocol test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(windows): LF checkouts everywhere; the daemon says its platform`.

### Task 2: The user's environment on Windows

**Files:**
- Modify: `packages/ledge/src/shell-path.ts` (add the Windows source), `packages/ledge/src/daemon/server.ts:203` and `packages/ledge/src/update/run-update.ts:88` (call `userEnv()` instead of `loginShellEnv()`)
- Test: `packages/ledge/test/shell-path.test.ts` (new cases)

**Interfaces:**
- Produces:
  - `parseRegQuery(out: string): Record<string, { type: string; value: string }>`: the values of one `reg query <key>` output (`    NAME    REG_SZ    value`, `REG_EXPAND_SZ` too; other types ignored).
  - `windowsRegistryEnv(run?: (key: string) => Promise<string>): Promise<Record<string, string>>`: `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment` then `HKCU\Environment` (user wins), `Path` = machine `;` user, `REG_EXPAND_SZ` values expanded with `%NAME%` against `process.env` then the registry; an unknown `%X%` kept as written. Default `run` = `execFile('reg', ['query', key], { windowsHide: true })`.
  - `userEnv(platform = process.platform): Promise<Record<string, string>>`: `windowsRegistryEnv()` on win32, else `loginShellEnv()`.

- [ ] **Step 1: Write the failing tests**: `parseRegQuery` on a captured sample (two REG_SZ, one REG_EXPAND_SZ, a REG_DWORD ignored); `windowsRegistryEnv` with a fake `run`: user `TEMP=%USERPROFILE%\AppData\Local\Temp` expands with `process.env.USERPROFILE`, `Path` is machine then user, `%NOPE%\x` stays `%NOPE%\x`, user overrides machine for the same name; `userEnv('linux')` calls the login shell path (inject via the existing `loginShellEnv` options or a spy).
- [ ] **Step 2: Run** `vitest run test/shell-path.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and switch the two callers to `userEnv()`.
- [ ] **Step 4: Run** the file and `test/server*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(windows): the agents get the user's environment from the registry`.

### Task 3: Stopping the daemon without signals

**Files:**
- Modify: `packages/protocol/src/messages.ts` (client message `{ type: 'daemon.stop' }`), `packages/ledge/src/daemon/server.ts` (on `daemon.stop`: answer nothing, call `opts.onStop?.()`), `packages/ledge/src/daemon/index.ts` (pass `onStop: () => void stop().then(() => process.exit(0))` when started by the CLI; `startDaemon` gets `exitOnStop?: boolean`, true from `cli/index.ts`)
- Test: `packages/ledge/test/daemon-stop.test.ts`

**Interfaces:**
- Produces: the `daemon.stop` message, for Desktop (step 4) and updates on Windows.

- [ ] **Step 1: Write the failing tests**: `startDaemon({ port: 0, exitOnStop: false })` with a temp `LEDGE_HOME`; a client with the token sends `daemon.stop` → the port refuses connections within 3 s and the journal was saved (`sessions.json` exists); a WebSocket without the token cannot connect at all (401), so cannot send it.
- [ ] **Step 2: Run** `vitest run test/daemon-stop.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `test/daemon.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): daemon.stop, a stop that needs no signal (Windows)`.

### Task 4: Writes that survive an antivirus

**Files:**
- Create: `packages/ledge/src/fs-retry.ts`
- Modify: the atomic `rename` of `daemon/journal.ts`, `daemon/store.ts`, `daemon/history.ts`, `daemon/attachments.ts`
- Test: `packages/ledge/test/fs-retry.test.ts`

**Interfaces:**
- Produces: `renameRetry(from: string, to: string, opts?: { tries?: number; delayMs?: number; rename?: (a: string, b: string) => Promise<void> }): Promise<void>`: retries on `EPERM`, `EBUSY`, `EACCES` (default 6 tries, 50 ms apart, doubling); any other error, or the last one, is thrown as is.

- [ ] **Step 1: Write the failing tests**: a fake `rename` failing `EPERM` twice then succeeding → resolves, 3 calls; failing `EBUSY` 6 times → rejects with that error after 6 calls; failing `ENOENT` → rejects at once.
- [ ] **Step 2: Run** `vitest run test/fs-retry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and use it in the four files (same arguments as their `rename` today).
- [ ] **Step 4: Run** the file and `test/store*.test.ts test/history*.test.ts test/journal*.test.ts test/attachments*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(windows): atomic writes retry a file an antivirus holds`.

### Task 5: Linux-only paths out of the way on Windows

**Files:**
- Modify: `packages/ledge/src/cli/hook.ts` (`underCodexDaemon`: `false` on win32, where hooks get `LEDGE_CODEX_HOOK_SESSION`), `packages/ledge/src/update/run-update.ts` (on win32: `update.failed` with `reason: 'no-systemd'` and the text « On Windows, Ledge Desktop updates Ledge », no npm run)
- Test: `packages/ledge/test/hook.test.ts`, `packages/ledge/test/update-run.test.ts` (new cases, platform injected)

**Interfaces:**
- Produces: `underCodexDaemon(read?, platform?: NodeJS.Platform)`; the updater's deps get `platform?: NodeJS.Platform`.

- [ ] **Step 1: Write the failing tests**: `underCodexDaemon(read, 'win32')` is false without calling `read`; the updater with `platform: 'win32'` sends `update.failed` `no-systemd` and runs nothing.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/hook.test.ts test/update-run.test.ts`. Expected: PASS (Linux cases unchanged).
- [ ] **Step 5: Commit** `fix(windows): no /proc, no systemd update on Windows`.

### Task 6: `ledge setup` on Windows

**Files:**
- Modify: `packages/ledge/src/cli/setup.ts`
- Test: `packages/ledge/test/setup-windows.test.ts`

**Interfaces:**
- Produces:
  - `windowsHookCommands(node: string, cli: string): { claude: string; codex: string }`: `"C:/…/node.exe" "C:/…/index.js" hook` and `& 'C:/…/node.exe' 'C:/…/index.js' hook codex` (backslashes → `/`; a `'` in a path doubled for PowerShell, a `"` refused with an error).
  - `ensureCodexWindowsSandbox(toml: string): { toml: string; changed: boolean }`: adds `sandbox = "unelevated"` under `[windows]` (the section created at the end if absent); a `sandbox` key already under `[windows]` is kept, whatever its value.
  - `runSetup(opts)` gets `platform?: NodeJS.Platform` (default `process.platform`). On win32: Claude and Codex hooks with `windowsHookCommands(process.execPath, realpath(cli))`; Codex's sandbox set when `CODEX_HOME` (or `~\.codex`) exists; Cursor skipped (« not on Windows »); no `~/.local/bin` script and no service, the line « On Windows, Ledge Desktop starts the daemon ».

- [ ] **Step 1: Write the failing tests** (temp dirs, `platform: 'win32'`, `service: true`, `cli` a real temp `.js` file):
  - `writes the Windows hook commands`: settings.json `hooks.Stop[0].hooks[0].command` is `"<node>" "<cli>" hook Stop` with `/`; Codex `hooks.json` `Stop` is `& '<node>' '<cli>' hook codex Stop`.
  - `sets the non-admin Codex sandbox`, `keeps a sandbox already chosen` (`[windows]\nsandbox = "elevated"` unchanged), `adds the key to an existing [windows] section without one`.
  - `is idempotent`: a second run changes no byte of the three files.
  - `writes no script and no service` (no `.local/bin/ledge`, no systemd call through `run`).
  - `windowsHookCommands` quoting: a path with a space and one with `'`.
- [ ] **Step 2: Run** `vitest run test/setup-windows.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `test/setup.test.ts`. Expected: PASS (Linux setup unchanged).
- [ ] **Step 5: Commit** `feat(setup): ledge setup on Windows (hooks for Claude and Codex, Codex's non-admin sandbox)`.

### Task 7: `ledge uninstall` knows the Windows hooks

**Files:**
- Modify: `packages/ledge/src/cli/uninstall.ts:8` (`LEDGE_HOOK` also matches `"…node.exe" "…index.js" hook [codex|cursor ]<Event>` and `& '…node.exe' '…index.js' hook codex <Event>`)
- Test: `packages/ledge/test/uninstall.test.ts` (new case)

- [ ] **Step 1: Write the failing test**: settings and hooks.json written by Task 6's `runSetup({ platform: 'win32' })`, plus another tool's hook; `removeClaudeHooks` on both removes Ledge's entries only, leaves the other tool's.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the pattern (anchored; the `index.js` path must end in `/dist/cli/index.js` or `/cli/index.js`, so another tool's node script is not taken for Ledge's).
- [ ] **Step 4: Run** `test/uninstall.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(uninstall): remove the Windows hook commands`.

### Task 8: Verify on the Windows PC

- [ ] **Step 1:** `%TEMP%\ledge-wintest` on this branch; install, build; Windows unit tests of the touched files. Expected: pass.
- [ ] **Step 2:** With `LEDGE_HOME` and `CODEX_HOME` of the spike (no `env.ps1` PATH tweaks: the daemon now reads the registry), run `node dist/cli/index.js setup`: the output lines; `settings.json` and the spike's `codex-home\hooks.json` hold the Windows forms; `config.toml` keeps `sandbox = "unelevated"`. Run it again: « already present ».
- [ ] **Step 3:** Start the daemon (Win32_Process.Create, port 27832); driver `all` for Claude and Codex with the hooks `setup` wrote (not `hooks.ts`). Expected: Claude 8/8, Codex 1, 2, 3, 6, 7, 8.
- [ ] **Step 4:** `icacls %LEDGE_HOME%\token`: record who may read it (expected: the user, SYSTEM, Administrators only; anything wider is a finding for the installer step).
- [ ] **Step 5:** Stop the daemon with `daemon.stop` (a one-line client in `scripts/windows-spike/`); the port closes, the pane host stays (agents alive), then closes by itself when idle (not waited for: 10 min).
- [ ] **Step 6:** `node dist/cli/index.js uninstall`: settings.json back to the backup byte for byte, Codex hooks gone. Results appended to the spike report; commit; push; PR into `snapshot`.
