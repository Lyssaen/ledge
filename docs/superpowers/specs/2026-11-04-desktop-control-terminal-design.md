# Desktop agent screen: one emulator, tmux keeps the process

Date: 2026-11-04. Status: in progress. Voie 1 for the harness pane, the shells born beside the daemon, and the phone on the same control client.

## Intent

Cursor and VS Code feel fluid because one emulator draws the terminal. Ledge's agent tab drew the harness twice: a `tmux attach` inside ConPTY (`wsl.exe`), then xterm.js over that. This removes ConPTY and `wsl.exe` from the agent screen and from a shell whose machine can stream. The daemon on the session's machine holds a tmux control client, and Desktop's xterm.js is the only emulator.

Windows Terminal stays the fallback (`ledge attach`). An OpenRig seat (`@` in the tmux name) streams too, through a control client on the seat's own tmux server (OpenRig's, the user's default one: `routedTmux` routes the seat's `controlArgs` there, as it already did its keys and captures); the daemon says so with `terminalStreamSeats` (2026-11-05). An older daemon has neither `terminalStream` nor the messages, and Desktop keeps today's attach for both the pane and the shells; a daemon without `terminalStreamSeats` keeps a seat, and its shells, on the pseudo-terminal.

## Protocol

`daemon.terminalStream` on the snapshot, set when the daemon can spawn `tmux -C`; `daemon.terminalStreamSeats` beside it when a seat's `term.watch` is streamed too.

Client → daemon: `term.watch { id, cols, rows, readOnly? }`, `term.shell { id, shell, cols, rows }`, `term.input { id, shell?, data }`, `term.resize { id, cols, rows, shell? }`, `term.unwatch { id, shell? }`.

Daemon → client: `term.opened { id, shell?, cols, rows, screen, cursor }`, `term.output { id, shell?, data }` (base64 of the pane's raw bytes), `term.size`, `term.exit { why: ended | gone | failed }`.

`shell` matches `^[A-Za-z0-9_-]{1,40}$`. Absent, the message is the harness pane. The fleet qualifies `id` both ways and leaves `shell` as it is, including a session reached through the SSH bridge. `term.*` is not stripped the way `browser.*` is.

## Shells

A shell is a short-lived tmux session (`sh-` and 12 hex) on Ledge's socket: a login shell (`loginShellEnv()`, else `$SHELL`, else `/bin/bash -l`) in `workdir ?? cwd`. The same host watches it with `owned`. Closing the tab, or the socket, kills that session instead of restoring `window-size`. The shell does not take the agent's typing lock. One socket may watch the harness pane and several shells; a watch replaces only the same shell of the same session. `term.unwatch` without `shell` closes only the harness pane.

The desktop's wire tag is `s<n>`, never the tab id (`local:a#shell-1` is not safe on the command line). A shell that ends is not started again: a fresh one would hide that the command died. While the machine has not answered, the tab stays idle. When the socket drops, a streamed shell ends. The browser has no pseudo-terminal; once `terminalStream` is set, its shells take this path. A seat's shells follow its screen: born on Ledge's socket in the seat's folder when the daemon streams seats, the local pseudo-terminal otherwise, as with a daemon without the flag.

## Phone

The phone and the desktop share one control client: the parser, the reply queue, the process. The phone still refuses a seat (read-only, `rig`) before asking for a control client. The phone keeps its own policy — hold, passkey, sequence numbers, UTF-8 text, the 100 ms relay batch — and still attaches `ignore-size,read-only`. It never resizes. Both may attach.

## Size

The control client attaches with `ignore-size`, so merely watching changes nothing. A watch that may type sets the window to `window-size manual` and `resize-window` to the xterm's grid, so an external Windows Terminal does not fight the column while it is open. The last such watch to close sets `window-size latest` again. A read-only watch (a subagent's parent) never resizes and never types. Desktop does not resize back when something else changes the pane: the next fit of the column does.

## Input

Keys are `send-keys -H` on the pane, behind the same typing lock deliveries already use. Cursor reports that ConPTY used to need are not forwarded: nothing here is waiting for them. Logs record opens, closes and reasons, never a byte.

## Out of this slice

Embedding Ghostty or Windows Terminal. Rewriting tmux. A shell on a machine that cannot spawn `tmux -C` stays on the local pseudo-terminal.
