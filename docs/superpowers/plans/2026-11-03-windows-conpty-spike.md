# Windows ConPTY Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer go/no-go: can the Ledge daemon drive Claude Code and Codex on native Windows through ConPTY as reliably as through tmux (design §4.1, checks 1–8).

**Architecture:** A `conptyPanes()` implementation of the existing `Tmux` interface (`packages/ledge/src/tmux.ts`), in the daemon's process, built on `node-pty` + `@xterm/headless`. The daemon picks it on `win32`. A scripted WebSocket driver plays the front (no Desktop, no TUI) so every check runs non-interactively from WSL through `powershell.exe`, and logs what it saw. Throwaway: the code lives on its own branch and is not merged.

**Tech Stack:** TypeScript (Node 22), vitest, `node-pty@1.1.0`, `@xterm/headless@6.0.0`, PowerShell for the Windows side.

**Spec:** `docs/superpowers/specs/2026-11-03-windows-native-design.md` (§4.1), with `2026-11-03-windows-native-results.md` for what is already measured.

## Global Constraints

- Branch `spike/windows-conpty`, from `docs/windows-native-study`, worktree `/home/gch/development/ledge-spike`. Not merged; only its report goes back to `docs/windows-native-study`.
- Linux behaviour unchanged: `pnpm --filter @paradow/ledge test` stays green on Linux after every task.
- Windows side runs from WSL through `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -ExecutionPolicy Bypass`, PATH re-read from the registry in each call (helper `winps.sh` in the scratchpad does this).
- The Windows clone is `%TEMP%\ledge-wintest` (already there); spike state lives in `%TEMP%\ledge-spike` (`LEDGE_HOME=%TEMP%\ledge-spike\home`).
- Port: **47832** through `LEDGE_PORT` (47831 is the WSL daemon's).
- Harmless prompts only, in the scratch folder `%TEMP%\ledge-spike\work`. Nothing pressed on an unrecognized dialog.
- Agents see **PortableGit**, not the system's Git for Windows: PATH without `C:\Program Files\Git\*`, `CLAUDE_CODE_GIT_BASH_PATH` pointing at PortableGit's `bin\bash.exe`.
- Ask the user before any install not listed here (listed: PortableGit and Codex, per user, under `%TEMP%\ledge-spike`).

## Review Focus

- A dialog the adapter does not know (upsell, first-run notice, trust prompt) must stay unanswered: the driver never sends Enter outside a recognized `pending` → Task 6 driver refuses and logs.
- A 2 KB multi-line prompt sent through ConPTY must arrive whole and submit once (paste-burst detection was tuned under tmux) → Task 7 check 2 compares the transcript's user turn with what was sent.
- An agent that exits by itself (not killed) must reach `exited` with its code, with no `sh` wrapper → Task 3 test "reports exit".
- Killing a session must end the agent's child processes too (MCP servers, Codex's helpers) → Task 3 kills a tree; Task 7 check 7 lists leftover processes.
- Wide chars and a full-width last column must not glue rows in `capture` (the `isWrapped` observation of the measurements) → Task 2 test on a full-width rule.

---

### Task 1: Port override

**Files:**
- Create: `packages/ledge/src/port.ts`
- Modify: every `opts.port ?? PROTOCOL_PORT` in `packages/ledge/src` (`client.ts:26`, `cli/launch.ts:69,150`, `cli/attach.ts:62,67,73`, `tui/fleet.ts`), and the daemon's default listen port (`daemon/server.ts`, where it falls back to `PROTOCOL_PORT`)
- Test: `packages/ledge/test/port.test.ts`

**Interfaces:**
- Produces: `ledgePort(env?: NodeJS.ProcessEnv): number`: `LEDGE_PORT` when it is an integer 1–65535, else `PROTOCOL_PORT`.

- [ ] **Step 1: Write the failing test**

```ts
it('takes LEDGE_PORT when valid, else the protocol port', () => {
  expect(ledgePort({ LEDGE_PORT: '47832' })).toBe(47832);
  for (const bad of [undefined, '', 'x', '0', '70000', '1.5']) expect(ledgePort({ LEDGE_PORT: bad })).toBe(PROTOCOL_PORT);
});
```

- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/port.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `ledgePort` and replace each default above with `opts.port ?? ledgePort()`.**
- [ ] **Step 4: Run** the whole suite on Linux. Expected: same pass count as before plus 1.
- [ ] **Step 5: Commit** `spike: LEDGE_PORT overrides the protocol port`.

### Task 2: Keys and capture, the pure parts

**Files:**
- Create: `packages/ledge/src/panes/keys.ts`, `packages/ledge/src/panes/capture.ts`
- Test: `packages/ledge/test/panes-keys.test.ts`, `packages/ledge/test/panes-capture.test.ts`
- Modify: `packages/ledge/package.json`: add `node-pty@1.1.0` and `@xterm/headless@6.0.0` to `dependencies`.

**Interfaces:**
- Produces: `keyBytes(key: string): string`: a tmux key name to the bytes a terminal sends; throws `Error('unknown key: <key>')` for any other name.
- Produces: `captureLines(buffer: IBuffer, lines: number): string`: tmux `capture-pane -p -J -S -<lines>` semantics on an xterm buffer: rows flagged `isWrapped` joined to the row above, trailing blanks trimmed per row and at the end, last `lines` lines.

- [ ] **Step 1: Write the failing tests**

```ts
// panes-keys.test.ts
it.each([['Enter', '\r'], ['Escape', '\x1b'], ['C-c', '\x03'], ['C-u', '\x15'], ['Up', '\x1b[A'], ['Down', '\x1b[B'],
  ['Right', '\x1b[C'], ['Left', '\x1b[D'], ['Tab', '\t'], ['BTab', '\x1b[Z'], ['BSpace', '\x7f'], ['Space', ' '], ['1', '1'], ['y', 'y']])
  ('%s', (k, b) => expect(keyBytes(k)).toBe(b));
it('refuses an unknown name', () => expect(() => keyBytes('F13')).toThrow('unknown key: F13'));

// panes-capture.test.ts (a headless Terminal of 20 cols, written then flushed with term.write('', cb))
it('joins a soft-wrapped line, keeps hard breaks', /* write 'a'.repeat(25) + '\r\nnext' → 'aaaa…(25)\nnext' */);
it('keeps the last N lines, history included', /* 60 numbered lines in a 10-row terminal, capture 5 → lines 56..60 */);
it('a full-width rule then a CRLF prompt stays two lines', /* '─'.repeat(20) + '\r\n> hi' → ['────…', '> hi'] */);
```

- [ ] **Step 2: Run** both files. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement.** `keyBytes`: a table for the named keys above, `C-<a-z>` as the control byte, any single character as itself. `captureLines`: walk `buffer.getLine(i)` from 0 to `buffer.length`, `translateToString(true)`, append to the previous line when `isWrapped`.
- [ ] **Step 4: Run** both files. Expected: PASS. Full suite on Linux green.
- [ ] **Step 5: Commit** `spike: tmux key names and capture-pane on an xterm buffer`.

### Task 3: `conptyPanes()`, the `Tmux` on node-pty

**Files:**
- Create: `packages/ledge/src/panes/conpty.ts`
- Test: `packages/ledge/test/panes-conpty.test.ts` (runs on Linux too: node-pty uses a Unix pty there)

**Interfaces:**
- Consumes: `keyBytes`, `captureLines` (Task 2); the `Tmux` interface.
- Produces: `conptyPanes(opts?: { cols?: number; rows?: number; spawn?: typeof import('node-pty').spawn }): Tmux & { exitCode(name: string): number | null | undefined }`. Defaults 200×50 (as `realTmux`). `exitCode`: `undefined` while running or unknown, the code once exited.

Behaviour, per method:
- `newSession`: `pty.spawn(command[0], command.slice(1), { cwd, env: env minus unset, cols, rows, name: 'xterm-256color' })`; output piped into a headless `Terminal` with `scrollback: 5000`; on exit the pane is removed from the live list and its code kept for `exitCode`. Throws on a duplicate name.
- `sendText`: same newline refusal as `realTmux`; writes the text as is.
- `sendKeys`: writes `keyBytes(k)` for each key, in order.
- `capture`: `captureLines` after flushing the terminal's parser; `null` for an unknown pane.
- `width`: the pane's cols. `paneCwd`: `null`. `setOption`: no-op. `controlArgs`: `null`.
- `hasSession` / `listSessions`: live panes only. `killSession`: kills the process tree (`taskkill /PID <pid> /T /F` on `win32`, `pty.kill()` elsewhere), resolves once exited.
- `attachArgs`: throws `Error('attach is not available in the ConPTY spike')`.

- [ ] **Step 1: Write the failing tests** (the agent is `process.execPath` with a small `-e` script)

```ts
it('runs a command with env and cwd, and captures its output', /* script prints process.cwd() and process.env.X; capture contains both */);
it('drops the unset variables', /* env {A:'1',B:'2'}, unset ['B'] → script sees A, not B */);
it('types text and keys', /* script echoes stdin lines; sendText('hello'), sendKeys(['Enter']) → capture contains 'hello' */);
it('reports exit', /* script exits 3 → hasSession false, listSessions excludes it, exitCode(name) === 3 */);
it('kills a tree', /* script spawns a child that sleeps; killSession → both pids gone */);
it('refuses a second session with the same name');
```

- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/panes-conpty.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `conptyPanes` in `panes/conpty.ts`.**
- [ ] **Step 4: Run** the file on Linux, then on Windows in `%TEMP%\ledge-wintest` after `git pull` + `pnpm install`. Expected: PASS on both.
- [ ] **Step 5: Commit** `spike: a Tmux on node-pty and a headless terminal`.

### Task 4: The daemon on Windows uses the panes

**Files:**
- Modify: `packages/ledge/src/daemon/index.ts:24` (choose the panes), `packages/ledge/src/spawn.ts` (no `sh -c` wrapper on `win32`), `packages/ledge/src/daemon/server.ts` (an exit seen by the panes ends the session with its code, where `PaneGone` is applied today)
- Test: `packages/ledge/test/panes-daemon.test.ts`

**Interfaces:**
- Consumes: `conptyPanes()` (Task 3), `ledgePort()` (Task 1).
- Produces: `pickTmux(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Tmux`: `conptyPanes()` on `win32` or when `LEDGE_PANES=conpty`, else today's `routedTmux(...)`.

- [ ] **Step 1: Write the failing test**: the scenarios of `test/e2e.test.ts` (fake agent `test/fake-agent.mjs` via `createSession({ command: ['node', agent, …] })`: permission approved, permission denied with Escape, question by option number, a dead pane) run again with `tmux: pickTmux(process.platform, { LEDGE_PANES: 'conpty' })`, plus one: `['node', agent, 'exit', '3']` ends with `state: 'exited'`, `exitCode: 3`. `e2e.test.ts` needs `process.getuid` guarded (`process.getuid?.()`) to load on Windows.
- [ ] **Step 2: Run** it. Expected: FAIL (`pickTmux` not defined).
- [ ] **Step 3: Implement `pickTmux`**, use it in `startDaemon`; in `spawnSession`, `recordExit` is ignored on `win32`; when the poller finds a pane gone and the panes know its `exitCode`, apply `SessionEnd` with that code instead of `PaneGone`.
- [ ] **Step 4: Run** it, then the full suite on Linux. Expected: PASS, suite green.
- [ ] **Step 5: Commit** `spike: the daemon drives ConPTY panes on Windows`.

### Task 5: Windows setup for the checks

No product code; a script and the user's two logins.

**Files:**
- Create: `scripts/windows-spike/setup.ps1`, `scripts/windows-spike/hooks.mjs`, `scripts/windows-spike/env.ps1`

**Interfaces:**
- Produces: `env.ps1`, dot-sourced before any spike command: sets `LEDGE_HOME`, `LEDGE_PORT=47832`, `CLAUDE_CODE_GIT_BASH_PATH`, and a PATH with PortableGit's `cmd`, Codex's folder, the Node folder, and without `C:\Program Files\Git\*`.
- Produces: `hooks.mjs install|remove`: adds/removes Ledge's hook entries in `%USERPROFILE%\.claude\settings.json` and `%USERPROFILE%\.codex\hooks.json` with `mergeClaudeHooks`/`mergeCodexHooks` (`cli/setup.ts`), the command being `"<node.exe>" "<clone>/packages/ledge/dist/cli/index.js" hook` with forward slashes, quoted; `remove` deletes exactly the entries whose command is that one.

- [ ] **Step 1:** `setup.ps1` builds the clone (`pnpm --filter @paradow/ledge build`), extracts PortableGit (latest `PortableGit-*-64-bit.7z.exe` from git-for-windows releases, `-o%TEMP%\ledge-spike\git -y`), and unzips Codex's Windows release (`codex-x86_64-pc-windows-msvc.exe.zip` from openai/codex releases) into `%TEMP%\ledge-spike\codex`. Run it. Expected: `git --version`, `bash --version` (PortableGit), `codex --version` answer with `env.ps1` loaded, and `where git` lists no `Program Files` path.
- [ ] **Step 2:** Ask the user to run `codex login` once in a Windows terminal with `env.ps1` loaded. Expected: `codex login status` says logged in.
- [ ] **Step 3:** `node hooks.mjs install`. Expected: both files hold one Ledge entry per event; `node hooks.mjs remove` then `install` again leaves the files byte-identical to the first install.
- [ ] **Step 4: Commit** `spike: Windows setup (PortableGit, Codex, hooks)`.

### Task 6: The driver

**Files:**
- Create: `scripts/windows-spike/drive.ts` (run with `tsx`)

**Interfaces:**
- Consumes: `connect()` (`packages/ledge/src/client.ts`), the protocol messages `session.launch`, `session.reply`, `session.decide`, `session.answer`, `session.interrupt`, `session.kill`, `session.updated`, `session.preview`.
- Produces: `tsx drive.ts <check> --tool claude|codex [--id <session>]` → one JSON line per event to stdout and a final `{"check": n, "tool": "...", "pass": bool, "why": "...", "captures": [...]}`; captures saved under `%TEMP%\ledge-spike\out\<tool>-<check>-*.txt`.

Rules the driver enforces: it answers only a `session.pending` the daemon parsed (permission → `session.decide`, question → `session.answer` by option id); it never sends raw keys; any other dialog seen in the preview fails the check with its capture.

- [ ] **Step 1:** Implement checks as named functions `launch`, `prompt`, `states`, `permission`, `question`, `hooks`, `interrupt`, `glyphs` (design §4.1, 1–8). The prompts: check 2 sends `Réponds seulement OK.` then a 2 KB multi-line text ending with `Réponds seulement OK.`; check 4 asks to create `probe.txt` in the work folder with the agent in a mode that asks before writing; check 5 asks Claude to ask the user to pick between two colours with AskUserQuestion.
- [ ] **Step 2:** Run `launch` for Claude against the daemon started with `env.ps1` (`node dist/cli/index.js daemon`). Expected: a pass line, or a capture showing what blocks.
- [ ] **Step 3: Commit** `spike: a driver for the go/no-go checks`.

### Task 7: Run the checks, fix the adapters

**Files:**
- Modify (as the runs require): `packages/ledge/src/adapters/claude.ts` (prompt line `❯` *or* `>` at column 0 under a rule, option cursor `❯` or `>`, selection `✔` or `√`), `packages/ledge/src/adapters/codex.ts`
- Create: fixtures from the Windows runs in `packages/ledge/test/fixtures/panes/win-*.txt`, each with a test in `adapters-claude.test.ts` / `adapters-codex.test.ts` asserting the same parse as its Linux twin.

- [ ] **Step 1:** Run the eight checks for Claude, then for Codex. Record each result line.
- [ ] **Step 2:** For each failure that comes from parsing: save the capture as a `win-*` fixture, write the failing adapter test, fix the adapter, rerun the check. For a failure that comes from ConPTY itself (input lost, reordered, burst split): stop fixing, keep the captures and timings; it is the no-go evidence.
- [ ] **Step 3:** After the last check, `tasklist` shows no `claude.exe`, `codex.exe` or `node.exe` left from killed sessions (the Review Focus tree kill).
- [ ] **Step 4:** Full Linux suite green. Commit each adapter fix with its fixture: `spike(adapter): <what> on Windows`.

### Task 8: Report and clean up

**Files:**
- Create on `docs/windows-native-study`: `docs/superpowers/specs/2026-11-0x-windows-native-spike.md` (date of the run)

- [ ] **Step 1:** Write the report: verdict **go / no-go** against the design's rule (all 8 for Claude; 1–3, 6, 7 for Codex), a table check × tool with pass/fail and one line why, the adapter changes it took, timings, raw captures of every failure, and what the product phase must carry over from the spike (key table, capture join, tree kill, exit code path).
- [ ] **Step 2:** `node hooks.mjs remove`; stop the spike daemon. Leave `%TEMP%\ledge-spike` and `%TEMP%\ledge-wintest` in place.
- [ ] **Step 3:** Push `spike/windows-conpty`; commit and push the report on `docs/windows-native-study`.
