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

### A. Desktop: the lines per notch Settings say (`apps/desktop/src/term/wheel.ts`, `wheelPrefs.ts`, `surface.ts`)

**Setting** (mockup `docs/mockups/terminal-wheel/`, approved by the owner on 2026-11-17): Settings › Workspace › Terminaux,
« Défilement à la molette », under the WebGL budget:

- **Comme Windows** (default): the lines Windows scrolls per notch (Settings › Mouse, 3 by default), read from the event's
  pixels: Chromium on Windows makes 100/3 px of each such line; « one screen at a time » comes as a page, the screen's rows;
- **N lignes par cran**, 1 to 20: the notches (`wheelDeltaY` / 120, or 100 px without it) times N. The stepper is greyed
  while Windows decides and keeps its number (3 until one is chosen). Each change is said saved
  (« Défilement à la molette : 8 lignes par cran »). Stored in `ledge.ide.wheel` as `{ mode, lines }`.

Fractions (a touchpad's small steps) are carried to the next event; at most one screen per event.

**Where it applies**, through `attachCustomWheelEventHandler`:

- in a terminal's history (normal buffer, the program not tracking the mouse): the view scrolls that many lines, read-only
  too;
- over a program that tracks the wheel (`?1000h`, `?1002h`, `?1003h`) in a live terminal: that many wheel reports (button 64
  up, 65 down, Alt/Ctrl in the button bits) at the cell under the pointer, in one `term.input`, in the encoding the
  program asked: SGR after `?1006h`, the default one otherwise, up to column and row 95 (the input travels as text and
  reaches tmux as UTF-8: a byte past 127 would become two); a full reset (`ESC c`) goes back to the default, as in xterm;
- xterm's own way otherwise: Shift held, X10 (presses only), the alternate screen without the mouse (its arrows), a
  read-only terminal over a program holding the mouse, SGR pixels (`?1016h`), a default report past column or row 95.

### B. Daemon: the keys waiting are typed together (`packages/ledge/src/term/pane.ts`)

`drain` no longer queues one `send-keys` per `term.input`: each turn of the typing chain takes everything waiting at
that moment and types it as one piece (still cut every 512 bytes by `keyCommands`). Order and bytes are unchanged; a
burst of mouse reports is one round trip to tmux instead of one each. The phone's terminal path is untouched.

## Not in scope

- Pure motion reports (`?1003h` without a button) are still sent: Claude Code may use them; B makes them cheap.
- The xterm option `fastScrollModifier` (Alt × 5) no longer applies where Desktop takes the wheel.

## Checks

- `wheel.ts`: line counting (pixels with remainder, lines, pages, the cap) and report encoding (SGR, default, modifiers,
  out-of-range).
- `surface.ts`: the handler writes N reports in one input while the mouse is tracked, follows `?1006h/l`, leaves xterm
  alone otherwise.
- `pane.ts`: several inputs arriving while one is typed are typed as one `send-keys`, in order.
- Settings: the radios and the stepper, its bounds, the toast, the value kept (vitest), and the card in light and dark
  (`e2e/settings-wheel.spec.ts`, zoomed shots with `SHOTS=`).
- Desktop in Tauri on Windows (WebView2's real wheel deltas, Chromium's 100/3 px per Windows line) cannot be run from WSL:
  for the owner to try.
