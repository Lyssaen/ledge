# Ledge daemon on native Windows: measurements

Date: 2026-11-03. Measurements asked in §6 of [2026-11-03-windows-native-daemon-study.md](2026-11-03-windows-native-daemon-study.md),
run by Otto-2 on the user's PC.

Otto-2 runs **inside WSL2** on that PC; every measurement below ran on the Windows side through
`powershell.exe -NoProfile -Command …`, in `%TEMP%` (`C:\Users\guill\AppData\Local\Temp`), never in `\\wsl$`. The PATH
of each PowerShell call is re-read from the registry (Machine + User), since processes started from WSL keep the PATH
the WSL session was born with.

## 1. Environment

| | |
|---|---|
| Windows | `Microsoft Windows NT 10.0.26300.0`, `26H2` |
| Node | `v22.23.3`, user install `C:\Users\guill\AppData\Local\Programs\node-v22.23.3-win-x64\node.exe` |
| Git | absent → installed with the user's approval: `winget install Git.Git` → `git version 2.56.0.windows.4`, `C:\Program Files\Git\cmd\git.exe` (the installer asked for elevation) |
| pnpm | absent → `corepack enable pnpm` (corepack 0.36.0) → shims `pnpm` and `pnpm.CMD` next to `node.exe`; the repo's `packageManager` pins 10.12.1, which corepack used |
| `where claude` | absent → installed with the user's approval: `winget install Anthropic.ClaudeCode` → **`.exe`**: `C:\Users\guill\AppData\Local\Microsoft\WinGet\Packages\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\claude.exe`, `2.1.302 (Claude Code)`, plus a winget command-line alias `claude` |
| `where codex` | not found |
| `where cursor-agent` | not found |

Notes:

- The official `irm https://claude.ai/install.ps1 | iex` was not used (piping a remote script was refused by Otto-2's
  permission guard); winget's package is the same native `claude.exe`. Its location is **not** `~/.local/bin`: Ledge must
  resolve it through `where`/PATH, not a fixed path.
- PowerShell's execution policy on this PC blocks `npm.ps1` (`l'exécution de scripts est désactivée sur ce système`):
  `npm` typed in PowerShell fails, `npm.cmd` / `cmd /c npm` works. Another reason to never rely on shims (§3.2 of the
  study).

## 2. Current test suite on Windows

Clone: `%TEMP%\ledge-wintest`, branch `docs/windows-native-study` at `48a2c2c7`.

- `pnpm install --frozen-lockfile`: **OK**, 56 s (warning: build scripts of `esbuild` ignored, as on Linux).
- `pnpm --filter @paradow/ledge typecheck`: **OK** (exit 0, no error).
- `pnpm --filter @paradow/ledge test` (vitest 4.1.12): **2632 passed, 134 failed, 5 skipped** (2771 tests);
  **41 of 131 files** failed; 69 s. A second run with the JSON reporter gave 2633 / **133** / 5: one test is flaky.

Failures of the JSON run grouped by cause (each failing test counted once, in the first group that matches):

| Cause | Tests | Files | Sample message |
|---|---|---|---|
| **`/` paths**: `path.join`/`resolve` give `\` and `C:\` roots; POSIX-path fixtures; home/root detection | 58 | chat-context, chat-guide, chat-notes, chat-service, chat-cursor, commands, documents, folders, models, openrig, openrig-roles, rig-spec, scan, server, shell-path, tool-images, transcript, tui-images, mobile-gateway-terminal | `expected [ 'C:\mnt\c\dev', 'C:\srv' ] to deeply equal [ '/mnt/c/dev', '/srv' ]` (scan) |
| **tmux missing** | 34 | attach, daemon, e2e, launch, tmux, tmux-scope | `Error: tmux new-session failed: ` |
| **symlinks**: `fs.symlink` needs admin or Developer Mode | 13 | chat-notes, documents, folders, scan, setup, tool-images, uninstall | `EPERM: operation not permitted, symlink '…\a-b.md' -> '…\link.md'` |
| **`chmod`**: modes are not kept (`0o666` read back), `chmod 000` does not lock a file, no executable bit | 12 | auth, mobile-files, mobile-service, history, chat-guide | `expected 438 to be 384` |
| **systemd / service / self-update** | 7 | setup, update-run, update-self | `expected { type: 'update.failed', …(3) } to match object { reason: 'no-systemd', …(1) }`; `installKind` returns `unknown` for a clone path |
| **signals** (SIGTERM → SIGKILL, signal state at exit) | 5 | omp-owner, omp-rpc, omp-host, omp-server | `expected { code: 1, signal: null, stderr: '' } to match object { signal: 'SIGKILL' }` |
| **`.cmd` shim spawned without `shell`** | 3 | hook | `spawnSync('pnpm', …)` → `status` `null` (`expected null to be +0`) |
| **CRLF fixtures** | 1 | preview | `expected false to be true` |
| **`process.getuid`** missing (suite-level, at import) | — | e2e, tmux, tmux-scope | `TypeError: process.getuid is not a function` |

Reading the groups:

- **Paths** is the largest group but mostly test-side: fixtures written as `/w/ledge`, `/home/u/…`, `/cx/config.toml`
  go through `path` and come back as `\w\ledge` or `C:\w\ledge`. Real product bugs hide in it too, e.g. `chat/context.ts`
  `stepFor` (the `repo` step found where none is expected) and the home/root filter of `chat/service.ts`
  (`never hands the model the home folder, the root or a parent` gets `C:\`, `C:\Users`). The group is the catch-all:
  each test was not traced to its root cause.
- **Symlinks** are a test-environment issue: they pass once Windows Developer Mode is on (or tests skip symlinks on
  Windows). Not turned on here, to keep the PC as is.
- **CRLF**: Git for Windows defaults to `core.autocrlf=true` and the repo has **no `.gitattributes`**:
  `test/fixtures/panes/claude2-fullscreen-idle.txt` has 81 `\r` after checkout. Any Windows checkout, CI included, needs
  `* text=auto eol=lf` (at least for fixtures).
- **`.cmd`** confirms §3.2 of the study: Node 22 refuses to spawn `pnpm` (a `.cmd`) without `shell`.

## 3. ConPTY probe

Folder `%TEMP%\conpty-probe`: `npm install node-pty @xterm/headless` → `node-pty@1.1.0` (ships **prebuilt
`win32-x64` binaries**: no compiler, no Visual Studio needed), `@xterm/headless@6.0.0`. Script:
[`scripts/windows-probe/probe.mjs`](../../../scripts/windows-probe/probe.mjs).

### Run 1: blocked on first-run onboarding

`claude.exe` had never run on Windows: it opens on the theme picker, then would ask for a login. The probe waited 30 s
for an input box, captured the screen and killed it (exit code 1 after `kill`).

Capture (`row|text`, `~` marks a row xterm flags `isWrapped`; none here):

```
  0|Welcome to Claude Code v2.1.302
  1|..........................................................
  2|
  3|     *                                       █████▓▓░
  4|                                 *         ███▓░     ░░
  5|            ░░░░░░                        ███▓░
  6|    ░░░   ░░░░░░░░░░                      ███▓░
  7|   ░░░░░░░░░░░░░░░░░░░    *                ██▓░░      ▓
  8|                                             ░▓▓███▓▓░
  9| *                                 ░░░░
 10|                                 ░░░░░░░░
 11|                               ░░░░░░░░░░░░░░░░
 12|       █████████                                        *
 13|      ██▄█████▄██                        *
 14|       █████████      *
 15|.......█ █   █ █..........................................
 16|
 17| Let's get started.
 18|
 19| Choose the text style that looks best with your terminal
 20| To change this later, run /theme
 21|
 22|       Auto (match terminal)
 23| > √   Dark mode
 24|       Light mode
 25|       Dark mode (colorblind-friendly)
 26|       Light mode (colorblind-friendly)
 27|       Dark mode (ANSI colors only)
 28|       Light mode (ANSI colors only)
 29|
 30| ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 31|  1  function greet() {
 32|  2 -  console.log("Hello, World!");
 33|  2 +  console.log("Hello, Claude!");
 34|  3  }
 35| ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 36|  Syntax theme: Monokai Extended (ctrl+t to disable)
```

Already visible:

- ConPTY + node-pty + xterm headless render Claude's screen intact: block elements, shades, dashed rules, accents; no
  U+FFFD in the 2221 raw bytes.
- On Windows Claude marks the selected option with **`√`** and the cursor with `>`, ASCII-ish fallbacks of the
  `figures` kind for Windows consoles. The Claude adapter matches `✔` (`src/adapters/claude.ts`: `☒ … ✔ Submit`,
  `replace(/\s+✔$/, '')`) and `❯`: its dialog parsing must accept the Windows glyphs too.

Typing, Ctrl+U, `/exit` and the exit code: **pending**, once Claude is set up on Windows (theme + login, done by the
user in a Windows terminal). Results will be added here.

## 4. Hook latency

10 runs of `Measure-Command { & node -e "0" }` (Windows Defender active, Node 22.23.3):

```
runs (ms): 82 55 55 56 57 56 59 60 57 54
min 54 · median 56 · max 82
```

A bare Node start fits the 100 ms hook budget with room, on this PC. The real hook also loads Ledge's CLI and opens a
WebSocket: still to measure with a built `dist/cli/index.js`.
