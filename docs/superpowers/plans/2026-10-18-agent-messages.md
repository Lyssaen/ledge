# Messages between agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Claude Code's agent-to-agent messages (`SendMessage` / `<cross-session-message>`) as cards in Ledge Desktop's session thread, linked across the two threads, and as a bubble + line between seats in the atelier.

**Architecture:** The hook keeps the whole received message; the daemon's `History` turns a `SendMessage` call into a `sent` item and a cross-session prompt into `received` items, resolves each side to a Ledge session through `~/.claude/sessions/<pid>.json`, and pairs them (read status, cross ids). The server copies the latest sent message onto `Session.lastMessage`, which the atelier draws. Desktop's thread model gets the two kinds; a `MessageCard` renders them.

**Tech Stack:** TypeScript, zod (`@ledge/protocol`), Node daemon (`packages/ledge`), React 19 + vitest + Testing Library (`apps/desktop`), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-18-agent-messages-design.md` (mockup: `docs/mockups/session-management/exchange.tsx` / `exchange.css`, viewable in `docs/mockups/ledge-session-management.html`, threads of Otto, Rio, Nova).

## Global Constraints

- Work in a worktree on a branch `feat/agent-messages` from `main` (superpowers:using-git-worktrees). The main checkout has uncommitted work from other sessions (`apps/desktop/src/session/Thread.tsx`, `apps/desktop/test/session.test.tsx`, `README.md`): never revert or commit it.
- `feat/session-management` (Otto's session) also edits `packages/ledge/src/cli/hook.ts` and `packages/ledge/src/daemon/state.ts` (commit a02e5ca: agentSessionId from hooks). Keep edits there surgical; expect a small merge.
- Copy (fr): « Message envoyé », « Message reçu », « Lu par {n} », « Remis, pas encore lu », « Envoi… », « Non remis », « Échange avec {n} · {k} messages », « Replier », « Déplier », « Lire tout le message », « Réduire », « Voir dans le fil de {n} ». English in `en.ts`: "Message sent", "Message received", "Read by {n}", "Delivered, not read yet", "Sending…", "Not delivered", "Conversation with {n} · {k} messages", "Fold", "Unfold", "Read the whole message", "Show less", "See it in {n}'s thread".
- Received cap: the hook keeps a cross-session prompt up to `INPUT_MAX` (8 000), like a hand-back.
- Bubble 5 000 ms; seat tag while `lastMessage.at` is less than 10 min old; no new colour token (foreground / muted / border only).
- Peer resolution is local: `~/.claude/sessions` of the daemon's machine (`CLAUDE_CONFIG_DIR` overrides `~/.claude`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A cross-session prompt holding **two** `<cross-session-message>` blocks (messages queued while busy): two received cards, one turn. → Task 4 test.
- A received message whose sender is not a Ledge session (plain `claude` in a terminal): card with the raw `from-name`, no link, no crash. → Task 4 test.
- The receiver's hook lands **before** the sender's `PostToolUse` (fast peer): status stays `read`, never back to `delivered`. → Task 4 test.
- `to` with a ref suffix (`harness-assistant-bf [7e2ea7]`) or an `uds:` address: both resolve. → Task 2 test.
- A first prompt that is a cross-session message must not become the session's topic. → Task 5 test.

---

### Task 1: Protocol — `sent` / `received` items, `Session.lastMessage`

**Files:**
- Modify: `packages/protocol/src/thread.ts` (ThreadItemSchema)
- Modify: `packages/protocol/src/session.ts` (SessionSchema)
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces:
  - `{ kind: 'sent', ...base, to: string, peer?: string, summary?: string, text: string, status: 'sending' | 'delivered' | 'read' | 'failed', received?: string }` — `id` is the tool_use_id; `peer` the Ledge session id; `received` the paired item's id in the peer's thread.
  - `{ kind: 'received', ...base, from: string, peer?: string, text: string, sent?: string }` — `from` is `from-name` (else the address); `sent` the paired item's id in the peer's thread.
  - `export type SentItem`, `export type ReceivedItem` (Extract of ThreadItem).
  - `Session.lastMessage?: { id: string; to: string; peer?: string; summary: string; at: string /* datetime */ }`.

- [ ] **Step 1: Write the failing test** `it('parses a sent and a received message, and a session's last message')`: `ThreadItemSchema.parse` accepts `{ kind: 'sent', id: 'toolu_1', at: T, turn: 2, to: 'harness-assistant-bf', peer: 'bc8e', summary: 'OK', text: 'Vas-y', status: 'read', received: 'recv-5-0' }` and `{ kind: 'received', id: 'recv-5-0', at: T, turn: 5, from: 'harness-assistant-2d', peer: 'fce8', text: 'Vas-y', sent: 'toolu_1' }`; rejects `status: 'lu'`; `SessionSchema.parse(fakeSession + lastMessage)` keeps `lastMessage`.
- [ ] **Step 2:** `pnpm --filter @ledge/protocol test` → FAIL (unknown kind).
- [ ] **Step 3:** add the two members to the discriminated union and the optional `lastMessage` object (one doc line each, like the neighbours).
- [ ] **Step 4:** `pnpm --filter @ledge/protocol test` → PASS; `pnpm -r typecheck` → the overlay and desktop still compile (an exhaustive `switch` on `kind` elsewhere would fail here: give it a `default` that renders nothing).
- [ ] **Step 5:** commit `feat(protocol): a message sent to another agent, one received from it, and a session's last message`.

### Task 2: Daemon — Claude peers directory

**Files:**
- Create: `packages/ledge/src/daemon/peers.ts`
- Test: `packages/ledge/test/peers.test.ts`

**Interfaces:**
- Produces:
  - `export type ClaudePeer = { pid: number; sessionId: string; name: string; address: string }` (`address` = `'uds:' + messagingSocketPath`).
  - `export function readPeers(dir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'sessions')): ClaudePeer[]` — every `<pid>.json`, unreadable or partial files skipped, never throws (missing dir → `[]`).
  - `export function peerFor(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[]): Session | undefined` — strips a trailing ` [ref]`; matches `peer.name === target || peer.address === target`; then the session whose `agentSessionId === peer.sessionId` or whose `transcriptPath` ends with `/${peer.sessionId}.jsonl`. When `target` is `uds:…/<pid>.sock` and no file matches, try the file `<pid>.json` directly.

- [ ] **Step 1: Write the failing tests** (tmp dir with two files shaped like the real one: `{"pid":304399,"sessionId":"de4e…","name":"harness-assistant-bf","messagingSocketPath":"/run/user/1000/cc-socks/304399.sock",…}`):
  - `resolves a name, a name with its ref, and an address to the Ledge session` → all three give the session with `agentSessionId: 'de4e…'`.
  - `falls back to the transcript path` → session without agentSessionId but `transcriptPath: '/x/de4e….jsonl'` matches.
  - `an unknown name, a broken file, a missing directory: no peer, no throw`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test peers` → FAIL (module missing).
- [ ] **Step 3:** implement with `readdirSync` / `readFileSync` + `JSON.parse` in try/catch.
- [ ] **Step 4:** `pnpm --filter @paradow/ledge test peers` → PASS.
- [ ] **Step 5:** commit `feat(daemon): find which Ledge session a Claude peer name or address is`.

### Task 3: Hook — keep the whole message, a readable label

**Files:**
- Modify: `packages/ledge/src/cli/hook.ts:15-29` (`handBack` → a `fromAgent` test, `describeTool`)
- Test: `packages/ledge/test/hook.test.ts`

**Interfaces:**
- Produces: a cross-session prompt reaches the daemon up to `INPUT_MAX`; `SendMessage`'s event `text` is its `summary` (else `→ ${to}`), its `toolInput` unchanged.

- [ ] **Step 1: Write the failing tests**: `keeps a cross-session message whole (up to INPUT_MAX)` — a `UserPromptSubmit` with `'<cross-session-message from="uds:/run/user/1000/cc-socks/1.sock" from-name="a-2d" from-mode="prompting">\n' + 'x'.repeat(3000)` maps to `text.length === prompt.length`; a plain 3 000-char prompt is still cut at 500. `labels SendMessage with its summary` — `PreToolUse` `tool_input: { to: 'a-bf', summary: 'OK pour la sidebar', message: '…' }` → `event.text === 'OK pour la sidebar'`; without summary → `'→ a-bf'`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test hook` → FAIL.
- [ ] **Step 3:** `const fromAgent = (t: string) => t.startsWith('<agent-message from="') || t.startsWith('<cross-session-message ')`; `describeTool`: `if (tool === 'SendMessage') return str(i.summary) ?? \`→ ${str(i.to) ?? ''}\``.
- [ ] **Step 4:** `pnpm --filter @paradow/ledge test hook` → PASS.
- [ ] **Step 5:** commit `feat(hook): a message from another agent arrives whole, SendMessage reads as its summary`.

### Task 4: History — `sent` and `received` items, paired

**Files:**
- Modify: `packages/ledge/src/daemon/history.ts`
- Test: `packages/ledge/test/history.test.ts`

**Interfaces:**
- Consumes: `SentItem`, `ReceivedItem` (Task 1).
- Produces:
  - `export function crossSession(text: string): { from: string; name?: string; text: string }[] | undefined` — every `<cross-session-message from="…" from-name="…" …>` block (attribute order free, `from-name` optional, closing tag optional, an optional first line « Another Claude session sent a message: »); body trimmed; undefined when the text does not start with one (after that optional line).
  - `new History({ dir?, peerOf?: (target: string) => string | undefined })` — `peerOf` returns a Ledge session id; default `() => undefined`.

Rules in `record`:
- `UserPromptSubmit` whose `crossSession(text)` is defined: a new turn (`turn + 1`, as a prompt), one `received` per block, id `recv-${turn}-${i}`, `from` = `name ?? from`, `peer = peerOf(from)`; no `prompt` item. For each, pair: in `peer`'s items, the **last** `sent` with `peer === id` (this session), `status !== 'read'`, whose text's first 200 trimmed chars equal the received body's, else the last such `sent` regardless of text; if found, `put(peer, { ...sent, status: 'read', received: recv.id })` and the received gets `sent: sent.id`.
- `PreToolUse` with `tool === 'SendMessage'`: `put` a `sent` (id `toolUseId ?? \`sent-${at}\``), `to` = `toolInput.to`, `summary` = `toolInput.summary`, `text` = `toolInput.message ?? ''`, `peer = peerOf(to)`, `status: 'sending'` — instead of a `tool` row. An existing item with that id (result first) is kept.
- `PostToolUse` / `PostToolUseFailure` of `SendMessage`: the `sent` of that id becomes `delivered` / `failed`, **except** when already `read`; no `tool` row is made.

- [ ] **Step 1: Write the failing tests**:
  - `parses one and two cross-session messages, with or without the transcript's first line` (`crossSession`), and `undefined` for `'Lance les tests'` and for `<agent-message from="a">`.
  - `a SendMessage is a sent message: sending, delivered, never a tool row` → items kinds `['prompt', 'sent']`, status `delivered` after `PostToolUse`, `peer: 'bc8e'` with `peerOf: t => t === 'a-bf' ? 'bc8e' : undefined`.
  - `a cross-session prompt opens a turn of received messages, paired with the sender's sent one` — one `History` holding both `fce8` (sends to `a-bf`) and `bc8e` (receives from `a-2d`, `peerOf` maps `a-2d` → `fce8`): `bc8e` items `[{ kind: 'received', turn: 1, from: 'a-2d', peer: 'fce8', sent: 'toolu_1' }]`; `fce8`'s sent → `status: 'read', received: 'recv-1-0'`.
  - `two queued messages make two received cards in one turn`.
  - `a sender outside Ledge: a received card with its name, no peer, no pairing`.
  - `read stays read when the sender's result comes after the receiver's prompt`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test history` → FAIL.
- [ ] **Step 3:** implement `crossSession` (regex over blocks, `matchAll`) and the three branches; keep `handBack` first in `UserPromptSubmit`.
- [ ] **Step 4:** `pnpm --filter @paradow/ledge test history` → PASS.
- [ ] **Step 5:** commit `feat(daemon): messages between agents are thread items, the received one paired with the sent one`.

### Task 5: Daemon wiring — resolver, last message, no topic

**Files:**
- Modify: `packages/ledge/src/daemon/index.ts:25` (History with `peerOf`)
- Modify: `packages/ledge/src/daemon/store.ts:64` (`patch` accepts `lastMessage`)
- Modify: `packages/ledge/src/daemon/server.ts:128-131` (history.onItem → lastMessage)
- Modify: `packages/ledge/src/daemon/state.ts:269` (no topic from a cross-session prompt)
- Test: `packages/ledge/test/server.test.ts`, `packages/ledge/test/state.test.ts`

**Interfaces:**
- Consumes: `readPeers`, `peerFor` (Task 2); `crossSession` (Task 4); `Session.lastMessage` (Task 1).
- Produces: every session's `lastMessage` is its latest `sent` (`{ id, to, peer, summary: summary ?? text's first line (≤ 120 chars), at }`), set when the `sent` first lands (`status: 'sending'`), broadcast by the store's normal `updated` change.

- [ ] **Step 1: Write the failing tests**: state — `a message from another agent is not the session's topic` (first `UserPromptSubmit` text `<cross-session-message from="x" from-name="a-2d">\nHello` → `topic` undefined, state `working`). server — `a sent message becomes the session's last message` (send a `session.event` PreToolUse SendMessage through the test server with a History; the broadcast `session.updated` carries `lastMessage.summary`).
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test state server` → FAIL.
- [ ] **Step 3:** index.ts: `new History({ peerOf: t => peerFor(t, readPeers(), store.all())?.id })`; store.patch: widen its `Pick` with `'lastMessage'`; server.ts: in the `history.onItem` listener, `if (item.kind === 'sent' && item.status === 'sending') store.patch(id, { lastMessage: … })`; state.ts: `&& !crossSession(ev.text)` on the topic line.
- [ ] **Step 4:** `pnpm --filter @paradow/ledge test` → PASS (whole package).
- [ ] **Step 5:** commit `feat(daemon): a session remembers the last message it sent; a peer's message is not its topic`.

### Task 6: Desktop thread model

**Files:**
- Modify: `apps/desktop/src/session/exchanges.ts` (`Segment`, `Exchange`, `segmentsOf`, `exchangesOf`, `displayIds`)
- Test: `apps/desktop/test/session-thread.test.ts`

**Interfaces:**
- Consumes: `SentItem`, `ReceivedItem`.
- Produces: `Segment` gains `{ kind: 'sent'; item: SentItem }`; `Exchange` gains `received: ReceivedItem[]` (the turn's received items, in order; `[]` otherwise; a helper exchange always `[]`); `received` items are not segments; `displayIds` lists received ids right after the prompt slot. `export function peerKey(item: SentItem | ReceivedItem): string` → `item.peer ?? ('to' in item ? item.to : item.from)`.

- [ ] **Step 1: Write the failing test** `a received message opens its exchange, a sent one is a segment`: items `[received recv-3-0 (turn 3), tool t9, sent toolu_7 (turn 3)]` → `exchanges(...)` last element `{ prompt: null, received: [recv-3-0], segments: tools:t9, sent:toolu_7 }`; `displayIds` → `['recv-3-0', 't9', 'toolu_7']`; existing shapes unchanged (update `shape` to print `sent:<id>`).
- [ ] **Step 2:** `pnpm --filter desktop test session-thread` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5:** commit `feat(desktop): the thread model knows messages between agents`.

### Task 7: Desktop — the message card, the conversation fold

**Files:**
- Create: `apps/desktop/src/session/MessageCard.tsx`
- Modify: `apps/desktop/src/session/Thread.tsx` (render received before `.turn-author`, `sent` segments; fold state)
- Modify: `apps/desktop/src/i18n/messages.ts`, `fr.ts`, `en.ts` (`session.message.*`)
- Modify: `apps/desktop/src/styles/session.css` (port `.exchange-*` thread rules from the mockup's `exchange.css`, renamed `.message-*`)
- Test: `apps/desktop/test/session-messages.test.tsx`

**Interfaces:**
- Consumes: Task 6's `Exchange.received`, `Segment 'sent'`, `peerKey`; `SessionBot` (`../shell/SessionBot`); sessions from `useDaemon()`.
- Produces: `MessageCard({ item, self, peer, header, folded, onFold, onOpenPeer }: { item: SentItem | ReceivedItem; self: Session; peer: Session | null; header: { count: number } | null; folded: boolean; onFold(): void; onOpenPeer(): void })`; every card/line has `data-message={item.id}`. Thread holds `folded: Set<string>` of `peerKey`s (state inside `Thread`, reset per session).

Behaviour (mockup): card head = kicker + `from → to` with both bots (peer null → its raw name, no bot); sent: summary as title, status mark (`✓` delivered / `✓✓` read / `…` sending / `✕` failed with the copy above); body = `ThreadMarkdown`, clamped to 3 lines when longer than 200 chars or 3 lines, « Lire tout le message » toggles; foot « Voir dans le fil de X » only when `peer` and the paired id (`received` / `sent`) exist. The first card of a peer in the thread carries the header when the thread has ≥ 2 with that peer; folded → one line per message (`from → to · summary or first line`), still in its exchange.

- [ ] **Step 1: Write the failing tests** (render `SessionPage` / `Thread` with the mock daemon as `session.test.tsx` does):
  - `a received message is a card signed by its sender, not « Vous »` → no `.prompt-block`, text « Message reçu », « Nova », the body.
  - `a sent message shows its summary and « Lu par Nova »`.
  - `three messages with Nova: one header, folding makes three lines and back`.
  - `a long message is clamped until « Lire tout le message »`.
  - `a peer outside Ledge: its name, no « Voir dans le fil »`.
- [ ] **Step 2:** `pnpm --filter desktop test session-messages` → FAIL.
- [ ] **Step 3:** implement; i18n keys typed in `messages.ts` first (`messages.test.ts` checks fr/en parity).
- [ ] **Step 4:** `pnpm --filter desktop test` → PASS (all, incl. `messages.test.ts`).
- [ ] **Step 5:** commit `feat(desktop): messages between agents are cards in the thread, foldable per conversation`.

### Task 8: Desktop — open the other thread on the same message

**Files:**
- Modify: `apps/desktop/src/nav/state.ts:28,58-61` (`open` carries `item?: string`; the session place keeps it)
- Modify: `apps/desktop/src/session/SessionPage.tsx:90-97,290-297` (flash and scroll to `[data-message]` as for `[data-tool]`; a folded conversation unfolds first)
- Modify: `apps/desktop/src/session/MessageCard.tsx` (`onOpenPeer` → `dispatch({ type: 'open', id: peer.id, item: pairedId })`)
- Test: `apps/desktop/test/nav-state.test.ts`, `apps/desktop/test/session-messages.test.tsx`

**Interfaces:**
- Produces: `NavAction` `{ type: 'open'; id: string; helper?: string; focus?: 'reply'; item?: string }`; `place.item`.

- [ ] **Step 1: Write the failing tests**: nav — `open with an item keeps it on the place`. session — `« Voir dans le fil de Rio » opens Rio on the received message, lit` (`.message-card.lit[data-message="recv-1-0"]` within the flash time; `scrollIntoView` mocked and called).
- [ ] **Step 2:** run both → FAIL.
- [ ] **Step 3:** implement; reuse the existing flash duration constant (`SessionPage.tsx:48`).
- [ ] **Step 4:** `pnpm --filter desktop test` → PASS.
- [ ] **Step 5:** commit `feat(desktop): from a message, its counterpart in the other agent's thread`.

### Task 9: Atelier — bubble, line, seat tag

**Files:**
- Create: `apps/desktop/src/atelier/MessageLayer.tsx`
- Modify: `apps/desktop/src/atelier/Atelier.tsx:98` (`<MessageLayer …/>` first child of `.office-shell`)
- Modify: `apps/desktop/src/atelier/ProjectTable.tsx:144-150` (`<PeerTag …/>` inside `.agent-seat`, top-left)
- Modify: `apps/desktop/src/styles/atelier.css` (port the mockup's atelier rules: `.exchange-layer/-wire/-bubble`, `.peer-tag`, `.exchange-lit`, `.exchange-arrived`; `office-reduced` / `office-paused` disable the motion)
- Modify: i18n (`atelier.messageTo(n)`, `atelier.peerTag(names)`)
- Test: `apps/desktop/test/atelier.test.tsx`

**Interfaces:**
- Consumes: `Session.lastMessage`; `dispatch` open with `item` (Task 8) — the bubble opens the **sender** on its sent id.
- Produces: `MessageLayer({ sessions, now, paused, reduced, dispatch })` — one bubble per session whose `lastMessage.at` is less than 5 000 ms before `now`, anchored over its seat (`.agent-seat[data-agent=id]`, coordinates divided by the shell's zoom as in the mockup's `measure`), line to `lastMessage.peer`'s seat when it is seated; `PeerTag({ session, sessions, now })` — names of the sessions it sent to or received from (`lastMessage` either way) less than 10 min ago, `✉ Name` or `✉ Name +N`.

- [ ] **Step 1: Write the failing tests**: `a message sent 2 s ago shows a bubble over Otto naming Rio; at 6 s it is gone` (fake timers, `now` advanced); `clicking the bubble opens Otto on the sent message` (dispatched action); `both seats carry the tag for 10 min`; `reduced motion: the bubble shows without the travelling dot`.
- [ ] **Step 2:** `pnpm --filter desktop test atelier` → FAIL.
- [ ] **Step 3:** implement (the atelier already has a clock for « il y a… »: reuse it, else a 1 s interval only while a bubble is due).
- [ ] **Step 4:** `pnpm --filter desktop test` → PASS; `pnpm -r typecheck` clean.
- [ ] **Step 5:** commit `feat(desktop): in the atelier, a message flies from one seat to the other`.

### Task 10: Live check

- [ ] **Step 1:** `pnpm -r test` and `pnpm -r typecheck` → all green; note the counts.
- [ ] **Step 2:** ask the user before restarting the daemon — **a daemon restart ends every Ledge tmux session** (Otto, Nova… would stop). With their go: `pnpm --filter @paradow/ledge build && systemctl --user restart ledge-daemon.service`.
- [ ] **Step 3:** from two Ledge Claude sessions, have one `SendMessage` the other; in Desktop (dev build or the Windows build per the Windows build recipe), check: sender card « Remis » then « Lu par … », receiver card signed by the sender, « Voir dans le fil de … » both ways, bubble + line in the atelier, tags on both seats.
- [ ] **Step 4:** report what was seen (screenshots), including anything not verified (e.g. the Windows build).
