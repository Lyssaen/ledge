# Windows Pane Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents on Windows live in a separate, long-lived pane host process, so they survive a daemon restart or update, and a terminal (`ledge attach`, Desktop's embedded terminal) can attach to them.

**Architecture:** `ledge panehost` runs the spike's `conptyPanes()` and serves it over a local socket (a named pipe on Windows, a Unix socket elsewhere) with a small newline-delimited JSON protocol, authenticated by the daemon token. On Windows the daemon's `Tmux` becomes `paneHostClient()`, which starts the host detached when none answers and adopts the panes it finds. `ledge attach` on Windows streams the pane through the host instead of running `tmux attach`.

**Tech Stack:** TypeScript (Node 22), `node:net`, vitest; `node-pty@1.1.0`, `@xterm/headless@6.0.0`, `@xterm/addon-serialize` (optional dependencies).

**Spec:** `docs/superpowers/specs/2026-11-03-windows-native-design.md` §4.2.1 (and §2 anti-goals), with the spike report `docs/superpowers/specs/2026-11-03-windows-native-spike.md` (what `panes/` already does and the reviewer's leftovers).

## Global Constraints

- Branch `feat/windows-pane-host` from `origin/snapshot`, worktree `/home/gch/development/ledge-panehost`; PR into `snapshot`.
- Linux/WSL behaviour unchanged: tmux stays the default off Windows; `LEDGE_PANES=panehost` selects the host anywhere (tests on Linux).
- node-pty / xterm / addon-serialize stay optional dependencies, external in tsup, imported only inside the host process (`panes/lazy` rule of `test/panes-lazy.test.ts` extends to the new files).
- « Agents that die whenever Ledge restarts or updates » is an anti-goal (design §2): the host must outlive the daemon.
- « Anything reachable by other users of the PC (named pipes, token, keys): user-only » (design §2): every host connection must prove it holds the daemon token before any other request.
- Not in this plan: phone terminal (`controlArgs` stays null), resize, OpenRig seats on Windows, `ledge claude` typed in a terminal on Windows (the launcher), Job Objects (the tree kill of the spike stays).
- Linux suite: no new failure outside the known ones (capture worker, server-attachments, flaky TUI tests).

## Review Focus

- The daemon restarts while an agent works: after restart the session is still `working`/`idle`, not `exited` → Task 5 « adopts the panes of a previous daemon ».
- Two daemons start at once (Desktop and a terminal) and both find no host: exactly one host must end up serving → Task 3 « two clients starting at once share one host ».
- A request on a pane that exited while it was in flight gets an answer, never a hang → Task 2 « answers on a pane that exits mid-request ».
- A connection that never sends `hello`, or sends a wrong token, gets nothing and is closed → Task 2 « refuses a connection without the token ».
- `ledge attach` on a session whose agent exits: the attach ends with the agent's code → Task 4 « attach ends when the pane ends ».

---

### Task 1: The protocol

**Files:**
- Create: `packages/ledge/src/panes/protocol.ts`
- Test: `packages/ledge/test/panes-protocol.test.ts`

**Interfaces:**
- Produces:
  - `PANEHOST_PROTOCOL = 1`
  - `type PaneRequest = { id: number } & ({ op: 'hello'; token: string; protocol: number } | { op: 'newSession'; opts: NewSessionOpts } | { op: 'sendText'; name: string; text: string } | { op: 'sendKeys'; name: string; keys: string[] } | { op: 'capture'; name: string; lines: number } | { op: 'width' | 'hasSession' | 'killSession' | 'exitCode'; name: string } | { op: 'listSessions' } | { op: 'attach'; name: string; readOnly: boolean })` where `NewSessionOpts` is the `Tmux.newSession` argument.
  - `type PaneResponse = { id: number; ok: true; value?: unknown } | { id: number; ok: false; error: string }`
  - `type AttachFrame = { attach: 'screen' | 'data'; data: string } | { attach: 'end'; code: number | null }` (host → client after an accepted `attach`); the client then sends `{ input: string }` lines.
  - `frameLines(onLine: (line: string) => void): (chunk: Buffer | string) => void`: splits a stream into lines (a frame may span chunks; one chunk may hold several frames), max line 4 MiB, beyond it throws.
  - `panehostPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, ledgeDir: string): string`: `\\.\pipe\ledge-panes-<sha256(ledgeDir) first 16 hex>` on win32, `join(ledgeDir, 'panes.sock')` elsewhere.

- [ ] **Step 1: Write the failing tests**: `frameLines` joins a frame split across chunks, splits two frames in one chunk, throws past 4 MiB; `panehostPath('win32', {}, 'C:\\Users\\a\\.ledge')` matches `/^\\\\\.\\pipe\\ledge-panes-[0-9a-f]{16}$/` and differs for another dir; `panehostPath('linux', {}, '/h/.ledge') === '/h/.ledge/panes.sock'`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/panes-protocol.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** in `panes/protocol.ts` (types only plus the two functions; no I/O).
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(panes): the pane host protocol`.

### Task 2: The host server

**Files:**
- Create: `packages/ledge/src/panes/host.ts`
- Modify: `packages/ledge/src/panes/conpty.ts` (Minor fixes the spike review left, the ones the host makes reachable: no `term.dispose()` while a capture settles; on kill timeout log and fall back to `pty.kill()`; a per-pane queue so `sendText`/`sendKeys` never interleave)
- Test: `packages/ledge/test/panes-host.test.ts`

**Interfaces:**
- Consumes: Task 1; `conptyPanes()` (`panes/conpty.ts`), `readDaemonToken()` (`auth.ts`).
- Produces: `startPaneHost(opts: { path: string; token: string; panes?: PanesTmux; idleExitMs?: number }): Promise<{ close(): Promise<void>; path: string }>`.
  - Each connection must send `hello` first with the token and `PANEHOST_PROTOCOL`; otherwise the host answers `{ ok: false, error: 'unauthorized' }` (or `'protocol <n>'`) and closes it. Token compared in constant time.
  - Every other op calls the same-named `PanesTmux` method; a thrown error becomes `{ ok: false, error: message }`.
  - `attach`: answers `{ ok: true }`, sends one `screen` frame (the pane serialized by `@xterm/addon-serialize`), then a `data` frame per pane output chunk, then `end` with the exit code; `{ input }` lines from that connection are written to the pane unless `readOnly`.
  - `idleExitMs` (default 10 min): with no pane and no connection for that long the host exits by itself.
  - On Unix, unlinks the socket file only when connecting to it fails (stale); a live one makes `listen` fail with EADDRINUSE, as a second pipe instance does on Windows (libuv's first-instance flag).

- [ ] **Step 1: Write the failing tests** (Linux, Unix socket in a temp dir, real `conptyPanes()`, fake agent `process.execPath -e …`):
  - `refuses a connection without the token`: a client sending `{"id":1,"op":"listSessions"}` first gets `{ ok: false, error: 'unauthorized' }` and the socket closes; a wrong token, same.
  - `serves the Tmux ops`: hello, newSession, capture shows the agent's output, sendText + sendKeys Enter reach it, hasSession/listSessions/width, killSession, exitCode after a self-exit is the code.
  - `answers on a pane that exits mid-request`: `capture` sent the moment the agent exits resolves (null or text), within 2 s.
  - `attach streams the screen then the output, and input unless read-only`.
  - `exits when idle`: with `idleExitMs: 300`, no pane and the only client gone, the server closes by itself.
- [ ] **Step 2: Run** `vitest run test/panes-host.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `startPaneHost`** with `net.createServer` on `path`, `frameLines` per connection; add `@xterm/addon-serialize` (the release whose peer is `@xterm/headless@6`) to `optionalDependencies` and `external` (tsup) and import it lazily like node-pty; the conpty.ts fixes above, each with its own test in `panes-conpty.test.ts` (`writes of two sendText calls do not interleave`, `a kill that times out falls back to pty.kill`).
- [ ] **Step 4: Run** the host and conpty files, then the full suite. Expected: PASS; suite with known failures only.
- [ ] **Step 5: Commit** `feat(panes): ledge's pane host serves ConPTY panes over a local socket`.

### Task 3: The client, and starting the host

**Files:**
- Create: `packages/ledge/src/panes/client.ts`
- Modify: `packages/ledge/src/cli/index.ts` (`case 'panehost'`: `startPaneHost({ path: panehostPath(...), token: readDaemonToken() })`, exits 1 with a message when there is no token)
- Test: `packages/ledge/test/panes-client.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `paneHostClient(opts: { path: string; token: () => string | undefined; start: () => void; connectMs?: number }): PanesTmux & { exitCode(name: string): Promise<number | null | undefined>; attach(name: string, io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream; readOnly?: boolean }): Promise<number | null>; close(): void }`.
  - One connection, opened on first use; on `ECONNREFUSED`/`ENOENT` it calls `start()` once and retries every 100 ms up to `connectMs` (default 5000), then throws `pane host not reachable`.
  - A request rejects with the host's `error`; a dropped connection rejects every request in flight and the next call reconnects.
  - `attachArgs` throws (`attach` replaces it on Windows); `controlArgs` returns null; `setOption` no-op; `paneCwd` null.
  - `usesPaneHost(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean` in `panes/pick.ts`: true on win32 or with `LEDGE_PANES=panehost`.
  - `startDetachedHost(): void` (same file): `spawn(process.execPath, [cliPath, 'panehost'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`, `cliPath` = `process.argv[1]`.
- Modify `Tmux.exitCode` (`tmux.ts`) to `exitCode?(name: string): number | null | undefined | Promise<number | null | undefined>`; the poller (`daemon/poller.ts:93`) awaits it.

- [ ] **Step 1: Write the failing tests**:
  - `starts the host when none answers`: `start` spy launches `startPaneHost` in-process on the path; first `listSessions()` resolves `[]`; `start` called once.
  - `two clients starting at once share one host`: two clients, both `start` → in-process `startPaneHost` that fails with EADDRINUSE on the second; both end up with the same `listSessions()` after one creates a pane.
  - `drives a pane end to end`: newSession with the fake agent, sendText + Enter, capture, exitCode resolves the code after self-exit.
  - `rejects in-flight requests when the host goes away, then reconnects`.
- [ ] **Step 2: Run** `vitest run test/panes-client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `client.ts`, the `panehost` CLI case, the `exitCode` type and the poller's `await`.
- [ ] **Step 4: Run** client + poller + panes-daemon tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(panes): the daemon's client of the pane host`.

### Task 4: `ledge attach` through the host

**Files:**
- Modify: `packages/ledge/src/cli/attach.ts`
- Test: `packages/ledge/test/attach-panehost.test.ts`

**Interfaces:**
- Consumes: `paneHostClient(...).attach`, `usesPaneHost` and `startDetachedHost` (Task 3).
- Produces: on the pane host, `attach(id, opts)` sets stdin raw when it is a TTY, pipes stdin/stdout through `client.attach`, restores the TTY, and returns the agent's exit code (`null` → 0 when the pane is gone without one, as tmux attach returns 0); no OpenRig seat lookup there.

- [ ] **Step 1: Write the failing tests** (`LEDGE_PANES=panehost`, host in-process, injected streams):
  - `attaches to a pane: the screen first, then typed input reaches the agent`.
  - `attach ends when the pane ends` with the agent's exit code.
  - `--read-only sends no input`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the branch in `attach()`; keep the tmux path byte-for-byte for Linux.
- [ ] **Step 4: Run** `test/attach*.test.ts`. Expected: PASS (the tmux attach tests still pass on Linux).
- [ ] **Step 5: Commit** `feat(attach): attach to a pane through the pane host`.

### Task 5: The daemon uses the host on Windows

**Files:**
- Modify: `packages/ledge/src/panes/pick.ts` (`pickTmux`: win32 or `LEDGE_PANES=panehost` → `paneHostClient({ path: panehostPath(...), token: readDaemonToken, start: startDetachedHost })`; `LEDGE_PANES=conpty` keeps the in-process panes for tests)
- Modify: `packages/ledge/src/daemon/index.ts` only if adoption needs it (startup prune already keeps panes `listSessions()` returns)
- Test: `packages/ledge/test/panes-daemon.test.ts` (new cases)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests** (`LEDGE_PANES=panehost`, host started in-process, two daemons one after the other on the same `LEDGE_HOME`):
  - `adopts the panes of a previous daemon`: daemon A launches the fake agent `work 60000`, A stops (`stop()`), daemon B starts: the session is not `exited`, its preview updates, `session.kill` ends it.
  - `an agent that exits while no daemon runs is exited with its code once one starts`.
  - The existing e2e scenarios of the file pass on `panehost` too (permission, deny, question, exit code).
- [ ] **Step 2: Run** them. Expected: FAIL (`pickTmux` returns the in-process panes).
- [ ] **Step 3: Implement** `pickTmux`'s branch.
- [ ] **Step 4: Run** the file, then the full suite on Linux. Expected: PASS; known failures only.
- [ ] **Step 5: Commit** `feat(daemon): on Windows the daemon drives agents through the pane host`.

### Task 6: Verify on the Windows PC

No product code unless a check fails (then: failing test, fix, as in the spike).

- [ ] **Step 1:** On the PC (`%TEMP%\ledge-wintest` on this branch, `env.ps1`, port 27832): `pnpm install`, build, Windows unit tests of `test/panes-*.test.ts` and `test/attach-panehost.test.ts`. Expected: pass.
- [ ] **Step 2:** Start the daemon (Win32_Process.Create, as in the spike); run `drive.ts all --tool claude` and `--tool codex`. Expected: same results as the spike (Claude 8/8, Codex 1, 2, 3, 6, 7, 8).
- [ ] **Step 3:** Restart test: launch a Claude session through the driver, ask a 20-second task, kill the daemon process alone (`taskkill /PID <daemon> /F`, no `/T`: the host is a child of the daemon that started it, and a crash takes no tree with it), start a new daemon: the session is still there and ends its turn `idle`; `claude.exe` kept its PID. Record the PIDs.
- [ ] **Step 4:** `node dist/cli/index.js attach <id>` in a ConPTY (the spike's `screen.mjs` pattern): the screen arrives, a typed `/status` shows Claude's status, Escape closes it.
- [ ] **Step 5:** Results appended to the spike report under « Pane host »; hooks removed, daemon and host stopped; commit, push, PR into `snapshot`.
