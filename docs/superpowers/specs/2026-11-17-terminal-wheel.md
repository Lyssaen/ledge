# The terminal's mouse wheel over a program that holds the mouse

## The problem

Scrolling up with the mouse wheel in Desktop's terminal is far slower than in Claude Code run directly in a terminal.

Claude Code (2.1.x) runs on the alternate screen and tracks the mouse (`?1049h`, `?1003h`, `?1006h`): its history is not
in xterm's scrollback, Claude Code scrolls and redraws it. A wheel notch is therefore a round trip: xterm writes a mouse
report, the stream sends it as `term.input`, the daemon types it with `send-keys`, Claude Code redraws, the screen comes
back. Two things make that round trip slow:

1. **xterm.js 5.5 sends one report per wheel event**, whatever the distance (`Terminal.ts`, `sendEvent`): a notch worth
   about five lines in WebView2 (100 px of `deltaY`) moves Claude Code by one step.
2. **The daemon types each `term.input` on its own** (`pane.ts`, `drain`): one `send-keys` per message, each waiting for
   tmux's reply before the next. With `?1003h`, moving the mouse over the terminal also sends reports, and the wheel's
   wait behind them.

## What changes

### A. Desktop: a notch sends one report per line (`apps/desktop/src/term/wheel.ts`, `surface.ts`)

While the program tracks the mouse and the terminal is live (not read-only), Desktop answers the wheel itself through
`attachCustomWheelEventHandler`:

- the lines a wheel event is worth are counted as xterm counts them for its own scrollback: pixels divided by a row's
  height with the remainder kept for the next event, lines as they are, a page as the screen's rows; at most one screen
  per event;
- that many wheel reports (button 64 up, 65 down, Shift/Alt/Ctrl in the button bits) are written at the cell under the
  pointer, in one `term.input`;
- the encoding follows what the program asked: SGR after `?1006h`, the default (X10) encoding otherwise; xterm keeps the
  wheel for an encoding Desktop does not write (`?1016h`, SGR pixels) and for a default report past column or row 95
  (the input travels as text and reaches tmux as UTF-8: a byte past 127 would become two); a full reset (`ESC c`)
  goes back to the default encoding, as in xterm;
- a vertical wheel with Shift held, a program that does not track the mouse, or a read-only terminal: xterm's own
  behaviour, unchanged (its scrollback, or the arrows on the alternate screen).

### B. Daemon: the keys waiting are typed together (`packages/ledge/src/term/pane.ts`)

`drain` no longer queues one `send-keys` per `term.input`: each turn of the typing chain takes everything waiting at
that moment and types it as one piece (still cut every 512 bytes by `keyCommands`). Order and bytes are unchanged; a
burst of mouse reports is one round trip to tmux instead of one each. The phone's terminal path is untouched.

## Not in scope

- No setting and no visible change: no mockup needed. The speed per notch follows xterm's own line count; if it is too
  fast or too slow in practice, a multiplier can follow with its mockup.
- Pure motion reports (`?1003h` without a button) are still sent: Claude Code may use them; B makes them cheap.

## Checks

- `wheel.ts`: line counting (pixels with remainder, lines, pages, the cap) and report encoding (SGR, default, modifiers,
  out-of-range).
- `surface.ts`: the handler writes N reports in one input while the mouse is tracked, follows `?1006h/l`, leaves xterm
  alone otherwise.
- `pane.ts`: several inputs arriving while one is typed are typed as one `send-keys`, in order.
- Desktop in Tauri on Windows (WebView2's real wheel deltas) cannot be run from WSL: the feel per notch is for the owner
  to try.
