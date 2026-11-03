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
