# Ledge on Windows without WSL: the ConPTY spike (go/no-go)

Date: 2026-11-03. Phase 0 of [the design](2026-11-03-windows-native-design.md) (§4.1), run by Otto-2 on the user's PC.
Plan: [2026-11-03-windows-conpty-spike.md](../plans/2026-11-03-windows-conpty-spike.md). Code: branch `spike/windows-conpty`
(from `main` 0.41.0, at the user's request: the work targets the `snapshot` branch).

## Verdict: **GO**

The daemon drives Claude Code and Codex on native Windows through ConPTY. Every check the design requires passes,
after fixes in the pane layer and the adapters. Some fixes are in ConPTY's own behaviour, but none needed more than
local changes, and no check came out unreliable.

| # | Check | Claude 2.1.302 | Codex 0.166.0 |
|---|---|---|---|
| 1 | Launch, reach `idle`, preview | ✅ idle in 5.4–6.7 s (folder trust dialog answered from Ledge) | ✅ idle in 2.1–4.5 s (hooks review and sandbox setup answered from Ledge) |
| 2 | Short prompt, then a 2.6 KB one: whole, submitted once | ✅ 2580 / 2580 characters | ✅ 2676 / 2676 characters (after the fixes below) |
| 3 | States follow the agent | ✅ idle → working → idle | ✅ idle → working → idle |
| 4 | Permission: approve a file write, deny a delete with Escape | ✅ | — not required; in its non-admin sandbox Codex writes in the work folder without asking |
| 5 | Question (AskUserQuestion) answered by option number | ✅ option 2 « Bleu » → the agent said « Bleu » | — not required (Claude only) |
| 6 | Hooks reach the daemon | ✅ `lastHookAt` set, prompts in the thread | ✅ (after the PowerShell fix below) |
| 7 | Interrupt (Escape) back to idle; kill ends the agent and its children | ✅ no claude.exe left from the session | ✅ no codex.exe left from the session |
| 8 | Windows glyphs (`>` cursor and prompt, `√`) | ✅ | ✅ |

Driver: `scripts/windows-spike/drive.ts` (a WebSocket front playing the checks, answering only what the daemon parsed as
pending). Final runs: Claude `all` run 3, Codex `all` run 5. Linux suite unchanged apart from the new tests (2832 pass;
the 4 failures of the capture worker and the flaky TUI tests already failed before any spike change, in this WSL).

## What it took (carry it into the product)

### In the pane layer (`packages/ledge/src/panes/`)

1. **`conptyPanes()`**: the `Tmux` contract on `node-pty@1.1.0` (ConPTY) and `@xterm/headless@6.0.0`, in the daemon's
   process; chosen by `pickTmux()` on `win32` (or `LEDGE_PANES=conpty`). Key names → VT bytes (`keys.ts`),
   `capture-pane` on the xterm buffer (`capture.ts`), exit code straight from ConPTY (no `sh -c` wrapper: the poller
   ends the session with `SessionEnd` + the code), kill = `taskkill /PID <pid> /T /F` (the whole tree went, every time).
2. **node-pty does not resolve `claude` to `claude.exe`**: it looks the name up as typed in the *daemon's* `Path`
   (`File not found: `). `resolveCommand()` finds `<name>.exe` / `.com` along the child's `Path`, never a `.cmd`/`.bat` shim.
3. **One big write loses its start in claude.exe.** Burst probe (`scripts/windows-probe/burst.mjs`, fresh Claude each
   time): a single 2316-character write left Claude **only the last 267 characters, 3 times out of 3**; 256-character
   slices 20 ms apart arrived whole (2.3 KB × 8, 9 KB × 2). A Node program behind the same ConPTY receives 5000 of 5000:
   the loss is claude.exe reading the console. `sendText` now types in 256-character slices, 20 ms apart.
4. **ConPTY flags the row after a full-width row as wrapped**, newline or not. With tmux-like joining, Claude's 200-column
   rule and ` Create file` came back as one line and the file-creation dialog was not recognized. ConPTY panes capture
   rows apart (`captureLines(…, { join: false })`); Claude and Codex wrap their own text.

### In the adapters

5. **Claude**: the cursor and the input prompt are `>` on Windows, not `❯` (raw stream has no `❯` at all), followed by a
   no-break space. One `CURSOR = /^[❯>]\s*/` in `adapters/claude.ts`; fixtures `win-claude-trust`, `win-claude-idle`,
   `win-claude-typed`, `win-claude-create`.
6. **Codex sandbox setup** (Windows only): at its first start Codex asks « Set up the Codex agent sandbox »: 1. default
   sandbox (**requires Administrator**), 2. non-admin sandbox (« higher risk if prompt injected »), 3. quit, over the
   picker footer `enter select · esc back`. Ledge ignored it and the session stayed `working`. It is now a `question`;
   a digit only moves the cursor there, so the answer is the digit then Enter. The spike chose 2 (design §6). **On the
   PO's PC only option 2 is possible** (no admin): the product must say so, or set it up ahead.
7. **Codex reply**: behind ConPTY Codex takes a 2.3 KB text in for ~2 s *after* the last slice is written; an Enter
   before is a newline inside the paste (seen: the long prompt stayed in the draft, the next prompt was appended to it).
   On `win32` the reply plan waits for the draft on screen (« [Pasted Content N chars] » or the text in the input line,
   up to 10 s), then 300 ms, then Enter: 4/4 submitted (`scripts/windows-spike/codex-enter.ts`). Plan steps `until`
   can now carry their own timeout (`ms`). Linux keeps the tmux plan.

### Hooks

8. **Codex runs a hook as `powershell.exe -NoProfile -Command "<command>"`** (probe: the hook's parent process). A command
   starting with a quoted path is only a string there: every Ledge hook failed (« hook exited with code 1 »). The call
   operator works, spaces in paths included: `& '<node.exe>' '<cli>' hook codex <Event>`.
   Claude's hooks work with the quoted form `"<node.exe>" "<cli>" hook <Event>` (which shell Claude used was not
   checked; `CLAUDE_CODE_GIT_BASH_PATH` pointed at PortableGit's bash).
   `ledge setup` on Windows must write the two forms.

## Final review fixes (before any snapshot build)

A fresh reviewer read the branch. Its findings, fixed with a test that failed first:

- **node-pty and @xterm/headless are optional dependencies, imported only when a pane starts** (`panes/conpty.ts`,
  `external` in `tsup.config.ts`). As plain dependencies every `ledge` process loaded them, hooks included, and an
  install on Linux needed a compiler (node-pty has no Linux prebuild).
- **Claude's `>` cursor only on Windows.** Accepted everywhere, a `> 2. RWLock` line of a diff above a question with a
  preview passed for the cursor on option 2 and Enter could take option 1. On Linux the adapter is as on `main`.
- **The Windows Codex reply compares its draft on letters and digits**, so a reply starting with `→` or `·` (dropped by
  Codex) is still sent.

After them: Linux suite 2839 pass (only the failures that predate the spike); Windows unit tests 93 pass, 1 skipped (the
tmux reply plan); a full Claude pass 8/8 and the Codex checks 1, 2, 3, 6, 7, 8 on the rebuilt daemon.

Left for the product (reviewer's minor findings): a per-pane queue so an interrupt cannot land inside a sliced reply;
log a failed or slow kill and fall back to `pty.kill()`; kill gently first (SessionEnd hooks, Codex's resume lock);
don't dispose the terminal while a capture is pending; read only the last rows on capture; a wide-character capture
test; count leftover `node.exe` too after a kill.

## Other findings

- **A question named by the hook before Claude draws it**: the daemon rightly refuses to type (« no prompt visible in
  the terminal ») until the dialog is on screen; a front answering at once must retry (the driver does, once a second).
- **Start-up race**: text typed within ~2 s of Claude's input box appearing can be lost entirely (probe without a settle
  delay: 2 of 5 pastes, 1 of 1 big write). Ledge types only once the session is `idle`, later than that; keep it so.
- **Codex on Windows drops some non-ASCII input**: `·`, `→`, `✓` vanish, `é`, `à`, `É`, `€` pass. It is Codex's own
  console input: Node behind the same ConPTY receives them all (emoji included), and Codex under tmux on Linux keeps
  them. French text is fine; symbols in prompts may be lost. Not Ledge's to fix.
- **WSL's mirrored networking** (`networkingMode=Mirrored` in `.wslconfig`) reserves Linux's ephemeral range
  32768–60999 on Windows: a native daemon cannot listen on `47831` while such a WSL runs (EADDRINUSE). Irrelevant on the
  PO's PC (no WSL); the spike used `LEDGE_PORT=27832`. A PC with both needs another port (design risk 6).
- **Processes started from a WSL-launched PowerShell die with it**: the spike daemon had to be started through
  `Win32_Process.Create`. Irrelevant for Desktop, which will start the daemon itself.
- **Claude Code on Windows**: no `.claude` login shared with WSL (the user logged in once); first run asks for a theme
  and, in each new folder, to trust it (parsed by Ledge, `>` cursor). It found Git Bash through
  `CLAUDE_CODE_GIT_BASH_PATH` (PortableGit), the system Git hidden from the PATH.
- **Codex** asks to review new or changed hooks at start (parsed by Ledge as a permission), and refuses its PATH alias
  helpers when `CODEX_HOME` is under `%TEMP%` (a warning; the product uses the user's `~\.codex`).
- **Glyphs**: the `√` mark and the `>` prompt were the only Windows-specific glyph changes Claude needed; Unicode
  output (block elements, braille logo, `⏵⏵`, `◐`) renders intact through ConPTY and xterm.

## What the product phase should take from the spike

- `panes/` as is in spirit (key table, capture without joining, slices, `resolveCommand`, tree kill, exit code), moved
  to the separate pane host the design asks for (agents surviving a daemon restart).
- The adapter changes (Claude `>` cursor; Codex sandbox question and the Windows reply plan), with their fixtures.
- `ledge setup` on Windows: the two hook command forms (§8 above), Codex's hooks review to trust once.
- The Codex sandbox choice for the PO: non-admin only; decide whether Ledge asks it or sets it up beforehand.
- Not covered by the spike: resize, very long sessions, the plan and multi-tab question dialogs on Windows, Cursor/OMP
  (out of scope), the embedded terminal and attach (needs the pane host's pipe).

## Pane host (product phase, step 1)

Plan: [2026-11-03-windows-pane-host.md](../plans/2026-11-03-windows-pane-host.md), branch `feat/windows-pane-host`.

`ledge panehost` keeps the agents' ConPTY panes in a process of its own, served over a named pipe
(`\\.\pipe\ledge-panes-<hash of the Ledge folder>`, a Unix socket elsewhere), one JSON object per line; a connection
must present the daemon token before anything else. On Windows the daemon starts it detached when none answers and
adopts the panes it finds; it closes by itself after 10 min without pane or client. `ledge attach` streams a pane
through it (screen first, then output; input unless `--read-only`).

Verified on the PC (2026-11-03):

- Windows unit tests of the panes, host, client, attach and daemon adoption: 94 pass, 1 skipped (the tmux reply plan).
- Through the host, the driver's checks: Claude 8/8, Codex 1, 2, 3, 6, 7, 8. One host process, child of the daemon,
  one pipe.
- **Restart**: Claude working on a ~20 s task (daemon 7164, host 14660, claude.exe 4152); `taskkill /PID 7164 /F`
  (the daemon alone): host and Claude alive; a new daemon (29600) finds the session, which ends its turn `idle`;
  host 14660 and claude.exe 4152 unchanged.
- **Attach**: `node dist/cli/index.js attach <id>` in a ConPTY shows Claude's screen at once; `/status` typed there
  opens Claude's status, Escape closes it, the attach stays (Escape goes to Claude). There is no detach key: closing
  the terminal ends the attach (Desktop's embedded terminal does that).

## The daemon and `ledge setup` on Windows (product phase, steps 2 and 3)

Plan: [2026-11-03-windows-daemon-setup.md](../plans/2026-11-03-windows-daemon-setup.md), branch `feat/windows-daemon-setup`.

- The daemon tells its fronts its platform (`DaemonInfo.platform`); `.gitattributes` keeps LF on Windows checkouts.
- The agents get the user's environment from the registry (machine then user, `Path` joined, `%NAME%` expanded), then
  the daemon's own `Path` folders (found on the PC: without them a Codex the daemon was given was not found).
- `daemon.stop` stops the daemon over its WebSocket (no SIGTERM on Windows); atomic writes retry a file an antivirus
  holds (`EPERM`/`EBUSY`/`EACCES`); no `/proc`; an update asked of the daemon answers « On Windows, Ledge Desktop
  updates Ledge ».
- `ledge setup` on Windows writes absolute hook commands (Claude `"<node>" "<cli>" hook …`, Codex
  `& '<node>' '<cli>' hook codex …`), sets Codex to its non-admin sandbox (`[windows] sandbox = "unelevated"`) unless
  one is chosen, writes no script and no service; `ledge uninstall` removes exactly those hooks.

Verified on the PC (2026-11-03):

- `setup` twice: hooks added, then « already present »; a never-configured `CODEX_HOME` gets `sandbox = "unelevated"`,
  the spike's kept its choice.
- With the hooks `setup` wrote: Claude 8/8, Codex 1, 2, 3, 6, 7, 8.
- `daemon.stop`: port closed, pane host (and agents) alive.
- `uninstall`: 12 Claude and 10 Codex hooks removed, Claude's `settings.json` byte-identical to the backup.
- Token ACL (`icacls`): under `%TEMP%` it inherits a domain SID besides the user, SYSTEM and Administrators;
  `%USERPROFILE%` itself grants only the user, SYSTEM, Administrators (and an AppContainer capability, read/execute).
  The installer step should check `%USERPROFILE%\.ledge\token` there, or set its ACL explicitly.
- Windows unit tests failing before this branch still fail the same way (`update-self` clone path, login shell,
  symlinks without Developer Mode, 3 path-separator cases of `update-run`).


## Desktop native mode (product phase, step 4)

Plan: `docs/superpowers/plans/2026-11-04-windows-desktop-native.md`.

**Test setup.** The branch's debug build of Ledge Desktop ran on the measurement PC with these environment variables:

- `LEDGE_DESKTOP_MODE=native`: the PC has WSL.
- `LEDGE_PORT=27832`: mirrored WSL reserves the usual port.
- `LEDGE_NODE` and `LEDGE_CLI`: the clone's `node.exe` and `dist/cli/index.js`. The installer step bundles these.
- `LEDGE_HOME` and `CODEX_HOME`: the spike's folders.

The page was driven over WebView2's remote debugging (CDP), typing included. The installed Desktop was quit for the test, then restarted afterwards.

| Check | Result |
|---|---|
| 1. Launch | `desktop.log`: `setup` (hooks set, Codex sandbox kept), then `started the daemon`, then the pane host. The page connects (`platform: win32`, Windows launcher). |
| 2. A session in Desktop | Session launched through the protocol (see below). Its row shows in the sidebar. The agent's screen opens in the embedded terminal (`node cli attach` in a native ConPTY, target « windows »). A prompt typed there got its answer, and the state came back to idle with its context (hooks fire). |
| 3. Windows Terminal | « Ouvrir dans un terminal externe » opens a `wt` tab titled with the session, running `node cli attach <id>`. |
| 4. Crash | Daemon killed: `the daemon ended: starting it again in 2 s`, then a new pid. The pane host and the agent survive, and the session is still listed. |
| 5. Desktop ends | Desktop killed twice: the daemon and the agent keep running. The next launch logs `adopted the running daemon (pid …)`, with no second daemon. |
| 6. Hidden | No Ledge entry, Atelier, chat icon or notch. Settings has no Notch or Mobile access. The overview is « Sessions » with « Lancer une session ». |

Fixed during this run, each covered by a test or by this check:

- **The notch window still showed.** It is declared in `tauri.conf.json`, so Tauri creates it before `setup`. Native mode now destroys it.
- **The page could not reach a daemon on `LEDGE_PORT`.** The CSP's `connect-src` names `ws://127.0.0.1:47831` only. At start, the CSP is rewritten for the port in use (`csp_for_port`) and opens nothing else. On the PO's PC the port is 47831 and nothing changes.

Not covered in this run:

- **Quitting from the tray.** The main page has no permission to end the process (only the notch had it), and the tray menu cannot be driven from here. `RunEvent::Exit` does not touch the daemon. A hard kill of Desktop, the harsher case, left the daemon and the agent running.

**Finding for the next plan: Windows paths in projects.** Launching from the « New session » form needs a project, and projects do not take Windows paths yet:

- `PathSchema` (`packages/protocol/src/projects.ts`) requires a leading `/`, so the daemon refuses the project.
- `normalizePath` and the project matching (`startsWith(path + '/')`) are POSIX-only.
- The folder picker mangles a typed `C:\…\work` into `C:\Users\guill/AppData`.

Until this is fixed, the PO cannot start a session from Desktop. This needs its own plan, because the protocol is shared with Linux and the phone. Check 2 therefore launched through the protocol (`scripts/windows-spike/launch.ts`), as the spike did.

Cosmetic leftovers in native mode:

- The terminal footer says « tmux · ledge-<id> ».
- Settings still mention the chat (default agent), the handover (max context) and « Retour à l'atelier ».
- Cursor Agent and OMP are offered as default agent.
