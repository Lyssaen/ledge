# Messages between sessions: long bodies by pointer, a mailbox that survives restarts, failures told to the sender

Date: 2026-10-25. Status: design.

## 1. Intent

A comparison with OpenRig (mvschwarz/openrig, commit a528913) showed where Ledge's typed delivery (`daemon/mailbox.ts`,
every target that is not a Claude) is weaker than it needs to be:

- **Bodies are flattened.** `tmux.sendText` takes no newline, so a body is typed on one line, its breaks as ` ⏎ `, its
  `<` as `‹` (`crossSession.ts`, `ledgeBody`). A diff, a list or a plan of 40 lines arrives unreadable. OpenRig types a
  short pointer (« Queue handoff: <id> - check your queue ») and lets the receiver pull the item whole.
- **The queue lives in memory.** A daemon restart (an update restarts it) loses every message still waiting for a busy
  target, and the sender was told « il le recevra dès qu'il sera libre ». OpenRig stages a delivery intent in the same
  transaction as the item and drains it at startup.
- **A failure reaches nobody.** A message whose target exits before its free moment is marked `failed` on Desktop's card;
  the agent that sent it believes it went. OpenRig escalates an undelivered wake to the sender's orchestrator.
- **Two Cursor slips.** Every receiver that is not a Codex is told to answer with `SendMessage`, which a Cursor does not
  have (`messageNote`); a Claude's message over `MESSAGE_MAX` to a Cursor or an OMP silently falls back to Claude's own
  tool, which cannot reach them (`cli/hook.ts`, `relayMessage`).

What OpenRig does that Ledge keeps doing differently, on purpose: it pastes into a busy agent (Ledge waits for the free
moment), and it has a queue of owned work items (claim, hand off, close with a reason). Work items are a separate
design; this one keeps to messages.

## 2. Goals

- **A long body arrives whole.** Past `INLINE_MAX` characters or `INLINE_LINES` lines, the receiver's prompt gets the
  start of the message and a pointer; `ledge read <id>` prints the body as written, newlines and `<` kept. A short body
  is typed as today.
- **Waiting messages survive a restart.** The queue and the bodies are journaled in `~/.ledge/mail.json`, written after
  every change through a temporary file. At startup a waiting message goes on waiting; one whose target is gone fails.
- **A failed message is told to its sender.** When the mailbox gives up on a message (target exited or removed, a
  refusal that does not pass), the sender gets a one-line `<ledge-notice>` at its own next free moment, naming the target,
  the start of the message and the reason. A notice that fails is not told again (no loops). Delivered messages stay
  silent: the ack already told the sender.
- **Cursor is told the right way to answer** (`ledge send`), and a Claude's over-long message to a Cursor or an OMP is
  refused with its length, as to a Codex.

Non-goals: delivery across machines, a read receipt pushed to the sender, work items, paste-buffer typing (the pointer
makes multi-line typing unnecessary and leaves the verified one-line path of every adapter untouched).

## 3. Design

### 3.1 Pointer (`crossSession.ts`)

`mailId(rid)` is `m` + the first 6 hex characters of the rid's sha1: the mailbox and the history compute it on their
own, so the history pairs a pointer with its sent card without asking the mailbox. A collision within the mailbox's
bodies takes 8 then 10 characters.

`formatLedgeMessage` takes the id. A body within the limits is formatted as today, with ` id="…"` on the tag. A longer
one becomes:

```
<ledge-message from="Otto" tool="claude" id="m3fa21c">(note) <summary, else the first line, ≤ 200 chars> … [message de 2840 caractères, 41 lignes : lis-le en entier avec ledge read m3fa21c]</ledge-message>
```

`ledgeMessages` returns the id; the history then takes the received card's text from the sent card of that id
(`mailId(sent.id) === id`), else keeps the pointer text.

`formatLedgeNotice({ to, text, reason })` and `ledgeNotices(prompt)` frame and read
`<ledge-notice to="Otto">Ledge n'a pas pu remettre ton message à Otto (« début… ») : raison.</ledge-notice>`. The
history shows it as a `notice` item (`delivery`, status `refused`, recipient the target), never as the user's words.

### 3.2 Protocol

- `message.read { id, by }` (client): `by` is the reader's session id.
- `message.body { id, from?, to?, at?, text?, reason? }` (server): the body, or the refusal's `reason` (unknown id, a
  reader that is neither the receiver nor the sender).

### 3.3 Mailbox (`daemon/mailbox.ts`)

- Each queued entry carries its `id` and a `kind`: `message` or `notice`.
- The bodies typed as a pointer are kept by id (from, to, at, text) for `BODY_TTL_MS` (7 days), at most `BODY_MAX`
  (200): a pointer typed into a session read days later still answers. A short body is in the receiver's prompt whole
  and is not kept.
- `read(id, by)` answers `message.body`.
- A `journal` dependency (`load()` at creation, `save(state)` after every change) makes it durable; the daemon gives it
  `~/.ledge/mail.json`. Entries loaded for a target that is not live (exited, removed) fail at once, with their notice.
- `fail(m, reason)` marks the card `failed` and, for a `message` whose sender is a live session Ledge can type into,
  queues a `notice` to the sender.

### 3.4 CLI and hooks

- `ledge read <id>` prints `De <from> à <to>, <at> :` then the body. It takes the reader from `LEDGE_CODEX_HOOK_SESSION`
  or `LEDGE_SESSION`, like `ledge send`.
- Codex's hook runs a lone `ledge read <id>` itself, as it runs `ledge who` and `ledge send` (`parseLedgeCommand`).
- The identity context names `ledge read` for every tool.
- `messageNote` answers with `ledge send` for every receiver but a Claude.
- `relayMessage` refuses an over-long message to any non-Claude target with its length.

## 4. Tests

`mailbox.test.ts` (pointer, read, journal reload, failure notice, no notice for a notice), `crossSession.test.ts`
(format and parse of pointer and notice, Cursor note), `send.test.ts` (`parseLedgeCommand` read), `history.test.ts`
(received pointer takes the sent text; ledge-notice is a notice), `hook.test.ts` (over-long to Cursor refused).
