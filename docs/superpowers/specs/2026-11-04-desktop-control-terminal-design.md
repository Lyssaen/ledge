# Desktop agent screen: one emulator, tmux keeps the process

Date: 2026-11-04. Status: in progress. First slice of voie 1 (the harness pane on Desktop).

## Intent

Cursor and VS Code feel fluid because one emulator draws the terminal. Ledge's agent tab drew the harness twice: a `tmux attach` inside ConPTY (`wsl.exe`), then xterm.js over that. This slice removes ConPTY and `wsl.exe` from the agent screen. The daemon on the session's machine holds a tmux control client, the same way the phone already does, and Desktop's xterm.js is the only emulator.

Shells stay on the local pseudo-terminal. Windows Terminal stays the fallback (`ledge attach`). OpenRig seats (`@` in the tmux name) stay on the pseudo-terminal: their server has no control client.

## Protocol

`daemon.terminalStream` on the snapshot, set when the daemon can spawn `tmux -C`. An older daemon has neither the flag nor the messages, and Desktop keeps today's attach.

Client → daemon: `term.watch { id, cols, rows, readOnly? }`, `term.input { id, data }`, `term.resize { id, cols, rows }`, `term.unwatch { id }`.

Daemon → client: `term.opened { id, cols, rows, screen, cursor }`, `term.output { id, data }` (base64 of the pane's raw bytes), `term.size`, `term.exit { why: ended | gone | failed }`.

The fleet qualifies `id` both ways, including a session reached through the SSH bridge. `term.*` is not stripped the way `browser.*` is.

## Size

The control client attaches with `ignore-size`, so merely watching changes nothing. A watch that may type sets the window to `window-size manual` and `resize-window` to the xterm's grid, so an external Windows Terminal does not fight the column while it is open. The last such watch to close sets `window-size latest` again. A read-only watch (a subagent's parent) never resizes and never types. Desktop does not resize back when something else changes the pane: the next fit of the column does.

## Input

Keys are `send-keys -H` on the pane, behind the same typing lock deliveries already use. Cursor reports that ConPTY used to need are not forwarded: nothing here is waiting for them. Logs record opens, closes and reasons, never a byte.

## Out of this slice

A shell born next to the daemon. The browser build's shells. Replacing the phone's own control clients with this host (they keep theirs; both may attach, the phone with `ignore-size`).
