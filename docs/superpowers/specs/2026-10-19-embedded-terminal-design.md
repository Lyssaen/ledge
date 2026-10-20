# Embedded terminal: the agent's screen and your own shell, inside the session view

Date: 2026-10-19. Status: design. Track chosen by the user: A (column on the right).
Mockup: https://claude.ai/artifact/Q196g4ggDopZDfRYqvPHgu. Boards A · Colonne (chosen), B · Tiroir and C · Onglet (rejected,
kept for the record). Situations on track A: T1 (typing into the agent's screen), T2 (your shell in the agent's folder),
T3 (SSH session, then the connection lost and coming back), T4 (read-only: a subagent, a machine offline, a session
launched outside Ledge). Each comes in light and dark. The components
are `Session` and `TermPane`.

## 1. Intent

Today the session view's terminal pane (`apps/desktop/src/session/TerminalPane.tsx`, toggled with O) is a read-only
preview of the agent's last output lines. Its « Ouvrir dans un terminal » button opens a Windows Terminal tab on the
session's tmux pane (`openSessionTerminal` → `open_terminal` → `wsl.exe --exec <launcher> attach <id>`, through
`ssh -t` for a remote machine).

The user wants everything in one place: « J'aimerais avoir tout en 1 plutot qu'avoir une autre application qui tourne en
plus. et aussi si je dois taper une commande je peux le faire directement depuis ledge ». The pane becomes a real,
interactive terminal with two uses:

- **The agent's screen**: the live tmux pane the agent runs in (Claude Code's TUI), where the user can type, for example
  to answer a question, interrupt, or switch modes, exactly as in the external tab.
- **Your shell**: a fresh login shell opened in the agent's current folder or worktree, for `git status`, tests, or a
  one-off command, while the agent works.

Both work for local sessions (WSL) and for sessions on a remote machine reached over SSH.

## 2. Goals, non-goals

Goals
- The pane of board A: a column on the right of the thread, resizable, toggled with O. Its heading holds the tabs
  « <agent> · agent » and « Shell · <dir> », a « + » for another shell, the machine chip (`wsl` / `ssh · build-01`), « Ouvrir dans
  un terminal externe », « Agrandir le terminal » and close (O).
- The agent tab: an interactive terminal attached to the session's tmux pane. Keystrokes go to the agent.
- The shell tab: an interactive login shell started in the session's `workdir` (or `cwd` when there is no `workdir`), on the
  session's machine.
- SSH sessions: the same two tabs, run through SSH to the machine. When the connection drops, a banner says so and the pane
  reconnects by itself (T3). « Reconnecter » retries at once. The agent keeps running on the server meanwhile.
- Read-only cases (T4):
  - A subagent has no terminal of its own. Its pane shows its parent's screen read-only, with a banner and « Aller à
    <parent> ».
  - On a machine that is offline, the pane keeps the last output frozen. A banner gives the time, input is off, and
    « Réessayer » is offered.
  - A session with no tmux pane to attach shows today's read-only preview (`session.preview`) in the agent tab. This covers
    agents started outside Ledge (`tmuxSession: null`), ended sessions and archived ones. The banner reads « <agent> a été
    lancée hors de Ledge : pas d'écran à rattacher » (an ended session gets its own wording), and the shell tab stays
    available. This was agreed with the user. Board « T4 · Lancée hors de Ledge ».
- **Every « terminal » entry point opens the embedded pane** (user's choice: « ouvrir dans ledge »). This covers:
  - the session menu's « Terminal » (`manage/useSessionMenu.ts`);
  - the chat launch card's « Terminal » (`card.terminal`);
  - the island's « Voir l'onglet du terminal » (`apps/overlay`).

  Each brings the main window forward on that session, with the pane shown and the agent tab selected. The overlay is a
  separate app, so it needs a path to ask the main window for this. The pane's own « Ouvrir dans un terminal externe »
  button is then the only way left to reach Windows Terminal.
- Focus: `Ctrl` + `` ` `` moves the keyboard between the thread and the terminal. The pane's footer shows the state
  (« Attaché », « Attaché par SSH », « Reconnexion… », « Lecture seule », « Hors ligne ») and the tmux or SSH target.
- Both themes, tokens only. All copy lives in `fr.ts` and `en.ts`, starting from the mockup's French strings.

Non-goals
- **No shell persistence across Ledge restarts.** The user said « un shell neuf ». A shell lives while Ledge runs. It
  survives switching to another session and hiding the pane with O. It ends when its tab is closed or Ledge quits.
- No split panes and no terminal themes or settings beyond following Ledge's light and dark theme.
- No change to how agents are launched or to tmux ownership. The daemon's poller still sees a pane end as today.
- The browser build (not Tauri) keeps today's read-only preview.
- Tracks B (drawer) and C (side-pane tab) are not built.

Anti-goals (my call, not stated by the user, who had nothing to add)
- A terminal that renders Claude Code's TUI worse than Windows Terminal would make the user go back to the external tab.
  Colours, box drawing, the cursor, resizing and fast redraws must be faithful.
- Keys swallowed by Ledge while the terminal has focus, such as Ctrl+K, Ctrl+R, Esc or the arrows, would break the shell
  and the agent's TUI.

## 3. Decided

- **Placement**: track A, a column on the right (user's choice). It replaces today's `TerminalPane` in
  `Workspace.tsx`'s `with-terminal` layout.
- **Both uses** (user's choice): the agent's screen and your own shell.
- **Local and SSH** (user's choice).
- **A fresh shell each time** (user's choice). There is no tmux and no persistence for the user's shell.
- **The mockup first** (user's rule): the mockup above is the reference for structure, copy and states.
- **The external terminal button stays**, as a fallback (my call).
- **Keyboard** (my call): while the terminal has focus, every key goes to it, except for the following.
  - **The focus key.** `Ctrl` + the physical key left of 1 (`e.code === 'Backquote'`) gives focus back to the thread. That
    key is `` ` `` on QWERTY and `²` on AZERTY, and the help label shows the user's layout (`navigator.keyboard`
    layout map when available, `` ` `` otherwise).
  - **Copy and paste, as in Windows Terminal.**
    - `Ctrl` + `C` copies when text is selected, and sends an interrupt otherwise.
    - `Ctrl` + `V` pastes text when the clipboard holds text, and sends the raw byte otherwise, so that Claude Code can
      paste an image.
    - `Ctrl` + `Shift` + `C` / `V` always copy and paste.

  Today Ctrl+K, Ctrl+, and Esc fire even while typing (`nav/useKeys.ts`). Inside the terminal they stop, and this is a
  deliberate change. The shortcuts help gains the focus key's row.
- **Several shells** (my call): « + » adds « Shell 2 », « Shell 3 »… Each tab can be closed. Closing one kills its process
  without asking.
- **When a shell's connection or session ends** (my call): an SSH shell dies with its connection, since it has no tmux.
  Its tab then says « Shell terminé : connexion perdue » and offers « Rouvrir ». A fresh shell is never started silently,
  because that would hide that the running command died. Reconnecting by itself applies to the agent tab only. When the
  session ends or is archived, its shells stay open until their tab is closed or Ledge quits.
- **What is remembered** (my call):
  - The pane's width and its open or closed state persist across restarts, next to `prefs.terminal` in `SessionPrefs`
    (localStorage).
  - The last tab chosen per session is kept in memory only.
- **The « terminal in front » setting** (my call): « Seulement quand le terminal est derrière » also counts Ledge itself.
  No sound plays while the Ledge window has focus and its pane shows that session's agent tab. Windows Terminal
  detection stays as it is.

## 4. Left to the builder

The how is the builder's. These notes say what the code shows today and what I would do.

- **Terminal emulator in the webview**: xterm.js (with the fit, web-links and WebGL or canvas addons) is the obvious
  choice. It needs a theme mapped from Ledge's tokens for light and dark.
- **The process side**: the desktop app runs on Windows. Local sessions live in WSL and remote ones are reached by `ssh`
  from WSL (`terminalCommand` in `packages/fleet/src/machines.ts`). A pseudo-terminal in the Tauri process is the natural
  place, for example the `portable-pty` crate (ConPTY on Windows) in `crates/ledge-native` or `apps/desktop/src-tauri`. It
  would spawn the same argv the external tab runs today (`wsl.exe --exec …`), with bytes streamed to the webview over a
  Tauri channel, and input and resizes sent back. Keep the existing argv validation (`wslArg` / `wsl_arg_ok`).
- **The shell's command**:
  - locally: `wsl.exe --cd <workdir> --exec <login shell>`;
  - remotely: `ssh -t -- <host> 'cd <workdir> && exec "$SHELL" -l'`, with the folder quoted as `terminalCommand` does.
- **Read-only attach** for subagents: `ledge attach` has no read-only mode. Add one (`tmux attach -r`) or let the pane drop
  input. The subagent-to-parent link is already in the session data the sidebar uses for helpers.
- **Reconnect policy** for SSH: backoff, number of tries, and how « perdu » is told apart from « hors ligne ». The fleet's
  machine states (`probeMachine`, the `unreachable` classification) are the place to look.
- **Offline**: the frozen output can come from the daemon's `session.preview` lines that the current pane already shows.
- **tmux sizing**: the Ledge client and an external Windows Terminal client can be attached at once. tmux's
  `window-size` behaviour decides who sets the size, so check that attaching from Ledge does not shrink the user's other
  view, or document what happens.
- **Lifecycle**: pseudo-terminals for hidden sessions keep running, as the non-goals say. Decide whether the agent tab
  detaches when its session is not shown. Detaching is cheap, since tmux keeps the screen.
- **Tests**: the repo's usual mix. Unit tests for argv building (as `terminal.rs` and `machines.ts` already have), component
  tests for the pane's states, and the existing e2e approach for the toggle and the focus key.
