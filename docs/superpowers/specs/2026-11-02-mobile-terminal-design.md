# An agent's terminal on the phone, live and typable

Date: 2026-11-02. Status: design, mockup to approve.

Builds on [the relay](2026-10-16-ledge-relay-design.md) (end-to-end channel, whitelist in
`packages/protocol/src/phone.ts`, passkey checks) and on [the embedded terminal](2026-10-19-embedded-terminal-design.md)
(Desktop's agent tab: `tmux attach` on the session's pane, xterm.js 5.5).

Mockup (360 px, the app's dark and light tokens): <https://claude.ai/artifact/SHNZDTznqmfiocJCez7F2Q> (private to the
author), local copy [docs/mockups/mobile-terminal.html](../../mockups/mobile-terminal.html). States: lisible, ajusté,
saisie non permise, confirmation, appareil non protégé, vérification expirée, au clavier, mode Ligne, main rendue,
connexion perdue, session terminée, and on the PC « Téléphone au clavier » and the setting.

## 1. Intent

The phone's Terminal screen (`apps/mobile/src/screens/Terminal.tsx`) shows `session.preview`: about once a second, the
last lines of `capture-pane` as plain text, no colours, no cursor; the only thing it can do is interrupt the agent. The
user wants to « ouvrir un terminal depuis l'appli mobile »: see the agent's screen as it is, and type into it.

Decisions taken with the user (2026-11-02):

- **Scope: the agent's terminal only.** The session's tmux pane, live and typable. No new shell from the phone in v1.
- **Size: the PC's.** The phone never resizes the agent's window: it shows the pane at its real size (often ~200
  columns), fitted to the width, with zoom and pan. Nothing moves on the PC while the phone watches.

## 2. Goals, non-goals, anti-goals

Goals:

- The Terminal screen shows the pane as a terminal (xterm.js): colours, cursor, the agent's TUI drawn as on the PC,
  live (≤ 100 ms batches), from the moment it opens (a full first screen, not the next output only).
- « Prendre la main »: after the device's passkey, the phone types into the pane: native keyboard, a row of special
  keys (Échap, Tab, Ctrl, Alt, arrows, ↵, ^C), a « ligne » mode for autocorrect and IME, paste.
- Interrupt stays where it is, without the passkey, as today.
- The PC shows that a phone holds the terminal, and can take it back.

Non-goals:

- A new shell from the phone, a session of another machine (the phone reaches the PC's daemon; the PC's own sessions
  only, as `models.list`), resizing the PC's window, scrollback beyond what the first screen carries (the thread is
  there for history), copy-mode, mouse reporting.

Anti-goals (failure even if it works):

- The relay, or its admin, can read or type into a terminal (everything goes through the sealed channel).
- A phone can type into a pane without a passkey check made for that session and for typing.
- Typing is possible while the user thinks the terminal is read-only, or after the app went to the background.
- A phone watching makes Claude Code redraw at 45 columns on the PC.
- The terminal stream gets the PC's socket closed by the relay (4008) or starves decisions and the thread.
- Any terminal byte in a log, on disk, or in a push.

## 3. Design

### 3.1 The daemon side: tmux control mode, no pseudo-terminal

The daemon has no native module and should not get one (`npm i -g` everywhere). tmux's control mode gives what a PTY
would, over plain pipes, on Ledge's own server:

```
tmux -L ledge -C attach-session -t =<tmuxSession> -f ignore-size,read-only
```

- `-f ignore-size`: this client never counts for the window's size (tmux ≥ 3.2; the PC has 3.6). Checked at start:
  an older tmux makes the daemon not announce the feature.
- `read-only`, always: the client's own keys never reach the pane. Commands still run through it (tmux 3.6 runs a
  control client's `send-keys` even read-only): the daemon writes only its own commands there, and `send-keys` only for
  a held terminal (3.4), the bytes in hex, so nothing the phone sends is ever read as a command.
- Output: `%output %<pane> <octal-escaped bytes>` for the session's active pane, decoded into bytes, then through one
  streaming `TextDecoder` per terminal (a UTF-8 character split across two notifications stays whole).
- Size: `%layout-change` (and the first `display -p '#{pane_width}x#{pane_height}'`) gives the pane's size; the phone's
  xterm is set to it, never the reverse.
- First screen: `capture-pane -p -e -N -t <pane>` (escapes kept), plus the cursor (`#{cursor_x},#{cursor_y}`), sent as
  `term.opened.screen`; output that arrives while it is captured is held and sent after it.
- Input: `send-keys -t <pane> -H <hex…>`, 512 bytes a command, through the same control client (no process per key),
  so a phone types exactly the bytes xterm produced, control characters included.
- End: `%exit`, the process ending, or the tmux session gone → `term.exit`.

A new module `packages/ledge/src/mobile/terminal.ts` owns the control clients (one per open terminal), the parser of
the notifications, and the batching. Pure functions (parser, octal decoding, batcher) are tested apart; the tmux part
is tested against a real `tmux -L <test socket>` as `tmux.ts` already is.

### 3.2 Protocol (`phone.ts`)

Phone → PC, added to `PhoneClientMessageSchema`:

| Message | Meaning |
| --- | --- |
| `term.open { op, id }` | Starts streaming the session's pane, read-only. No passkey: the phone already sees the preview. Refused `read_only` for `hook_only` and `rig` sessions, `unknown_session`, `not_live` (exited, archived, no tmux). |
| `term.input { tid, n, data }` | Bytes to type, as a string (xterm's `onData`), ≤ 4 096 characters; `n` counts from 0, so the daemon drops a duplicate and sees a gap. Refused unless the terminal is held (3.4). |
| `term.hold { op, tid, assertion }` | « Prendre la main »: passkey, new purpose `terminal`, bound to the session id. |
| `term.release { tid }` | « Rendre la main »: back to read-only. |
| `term.resync { tid }` | The phone saw a gap in `seq`: a fresh first screen, please. |
| `term.close { tid }` | The screen closed. |

PC → phone, added to `PhoneServerMessageSchema`:

| Message | Meaning |
| --- | --- |
| `term.opened { op, tid, cols, rows, screen, cursor, seq }` | The first screen (≤ 64 KiB, cut from the top), the pane's size, the first `seq`. Also the answer to `term.resync`. |
| `term.output { tid, seq, data }` | The bytes since the last one, decoded as UTF-8. `seq` + 1 each time. |
| `term.size { tid, cols, rows }` | The pane changed size on the PC. |
| `term.held { tid, until }` / `term.released { tid, why }` | Who types; `until` is the 30-minute cap, the phone counts the 5 idle minutes itself. `why`: `asked`, `pc` (taken back on the PC), `idle`, `background`, `expired`, `link`. |
| `term.exit { tid, why }` | `ended` (the session), `gone` (tmux), `closed`, `superseded` (the same phone opened another), `failed`. |

`ConfirmPurposeSchema` gains `terminal`. The snapshot's `daemon` gains `terminal: true` (stream) and
`terminalInput: true` (the PC's setting allows typing, 3.4); an older daemon keeps today's preview screen.

### 3.3 Flow control: within the relay's limits

The relay closes a socket past 300 frames or 8 MiB per 10 s (code 4008), and a lost frame breaks the channel's
sequence: a new key exchange. The daemon's outbox keeps to 200 frames and 4 MiB per 10 s for all phones. So:

- Output is batched: a batch leaves at the first of 80 ms after its first byte, or 16 KiB. At most ~12 frames a
  second, one terminal per device, one device holding the input at a time.
- Terminal frames go through the outbox in their own lane: never replaced by key (a stream must stay whole), at most
  half of the outbox's frame budget, so decisions, the thread and acks always have room; they wait behind them.
- Behind by more than 256 KiB or 2 s: the daemon drops what waits for that terminal and, once the lane is free, sends a
  new `term.opened` (capture of the screen). A slow network sees a jump, never a broken channel.
- Input is batched on the phone (30 ms), and a paste is cut into 4 096-character messages; with ~1 KiB padding a
  frame, it stays far below the phone's own 300 frames per 10 s.
- The 1 KiB padding floor hides lengths, not rhythm: the relay can see when frames go. Accepted, and said in the spec
  of the relay's limits.

### 3.4 Security

- **A setting on the PC, off by default**: « Taper dans les terminaux depuis le téléphone » (Desktop, Accès mobile).
  Off, the phone streams read-only and « Prendre la main » is not offered (`terminalInput` absent).
- **The passkey for each hold**, purpose `terminal`, bound to the session: one made for a decision, a launch or another
  session is refused (`assertion_invalid`). No hold without a registered passkey: « Protégez d'abord vos accords
  depuis Connexion. », as for a close.
- **A hold ends** after 5 minutes without input, after 30 minutes in all, when the app goes to the background
  (`presence { visible: false }`), when the link drops, when the device is revoked or the setting turned off, and when
  the user takes it back on the PC. Taking it again needs a new passkey check.
- **One terminal per device**; one device holding a session's input at a time (a second one is refused `conflict`).
- **Typing and the daemon's own typing**: each `term.input` batch takes the session's typing lock that deliveries and
  chat relays already share, so a phone's keys and a queued message never interleave.
- **What a hold allows**: anything the user could type on the PC, including answering a permission prompt without the
  phone's risk check. That is what the passkey for the hold buys; the screen says it (« Ce que vous tapez part tel quel
  dans le terminal de Nova sur le PC »).
- **Subagents**: a session's helpers have no pane of their own; the phone shows the parent's, read-only, as Desktop does.
- **The PC sees it**: the session's row in Desktop and the island carries « Téléphone au clavier », with « Reprendre la
  main » (`term.released { why: 'pc' }`).
- **Logs**: open, hold, release, exit, sizes and counts. Never a byte. Nothing written to disk; no push carries output.

### 3.5 The phone

- **Rendering**: `@xterm/xterm` 5.5 (Desktop's version), DOM renderer (WebGL is fragile on iOS Safari), colours from the
  `term-bg` / `term-fg` tokens and Desktop's ANSI palette (`apps/desktop/src/term/theme.ts`, moved to `@ledge/ui`).
- **Size**: xterm has the pane's `cols × rows`. Two views, « Lisible » (default: 11 px, anchored left, following the
  cursor, a bar under the screen shows the visible part of the columns) and « Ajusté » (font computed so that `cols`
  columns fill the box, never below 6 px). Pinch zooms between the two and up to 16 px; one finger pans. « A− / A+ »
  go. `term.size` refits.
- **Keyboard** (held only): xterm's hidden textarea for the native keyboard; above it, a row: Échap, Tab, Ctrl and Alt
  (sticky for one key, double tap locks), ← ↑ ↓ →, ↵, ^C, « Coller » (bracketed paste when the pane asked for it), and
  « Ligne »: a text field with autocorrect, sent with ↵ (or without, a toggle) — for dictation and IME, where xterm's
  textarea is weak.
- **States**: connecting, live (read-only, with « Prendre la main »), held (keyboard up, a coloured border and
  « Vous tapez dans le terminal de Nova »), released (why, in one line), offline (last screen kept, dimmed), ended.
- **Interrupt** keeps its button in read-only; held, ^C is on the row.

## 4. Order of work

1. This spec and the mockup, approved by the user.
2. Protocol: schemas and their tests.
3. Daemon: control-mode client and parser, `sendBytes`, gateway handlers, outbox lane, the PC setting, tests.
4. Phone: the Terminal screen on xterm, the key row, passkey for the hold, Playwright tests (the existing `e2e` fakes).
5. Desktop: the setting and « Téléphone au clavier » with « Reprendre la main ».
6. README (protocol table, security section) and the user guide.

## 5. Open points

- Whether `-f ignore-size` with `-C` behaves on tmux's seat server (OpenRig): seats are refused anyway (`rig`).
- iOS Safari's soft keyboard and xterm's textarea: to try on a device early in step 4; « Ligne » is the fallback.
