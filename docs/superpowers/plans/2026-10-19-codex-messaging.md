# Codex Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Codex session launched by Ledge writes to and receives messages from any Ledge session, Claude's `SendMessage` reaches a Codex by its Ledge name, and Desktop shows these exchanges with the existing message cards.

**Architecture:** A daemon mailbox (`daemon/mailbox.ts`) takes `session.message` requests, answers at once with a `message.ack` (fire-and-ack), and types each message into the target's tmux pane at its next free moment through the existing `replyTo` path, sharing the chat relay's typing lock. Codex sends with a new `ledge send` CLI; Claude's `PreToolUse` hook intercepts `SendMessage` to a non-Claude Ledge session and answers `deny` with a receipt. History records the cards and parses the typed `<ledge-message>` prompt as a received message.

**Tech Stack:** TypeScript (Node, ESM), zod (`@ledge/protocol`), ws, tmux, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-codex-messaging-design.md`

## Global Constraints

- Claude ↔ Claude is untouched: the hook steps in only when `to` names a live Ledge session whose `tool` is not `claude`.
- Never impersonate a Claude peer: no writes under `~/.claude/sessions`, no use of Claude Code's peer sockets or keys.
- Never type into a dialog: deliver only when the target is free (`idle` or `error`, no `pending`), the relay's `free()`.
- At a free moment, a queued chat relay instruction goes first; agent messages follow, oldest first, one per free moment.
- Fire-and-ack: the daemon answers `session.message` before typing; a repeated `rid` it already accepted is not delivered twice.
- A hook never blocks the agent: on any daemon failure or timeout the `SendMessage` hook prints nothing (native path).
- Sender id for `ledge send`: `codexLedgeId()` (reads `LEDGE_CODEX_HOOK_SESSION`), else `LEDGE_SESSION`; the sender's name comes from the daemon, never `LEDGE_NAME`.
- Agent-facing copy is French, like `identityContext`. Thread statuses reuse `SentItem['status']`: queued = `sending`, dropped/refused = `failed`.
- Codex's hook runs only a lone `ledge send …` or `ledge who` (Task 9); any other shell command, compound or with substitution, is left to Codex's sandbox.
- Out of scope: remote machines, `hook_only` targets (refused), Cursor, `notify_when_idle`, a persistent queue.

## Review Focus

1. A message to a busy Codex is typed only once the Codex is free and no chat relay is queued for it, never mid-turn and never into a permission dialog → covered in Task 4.
2. The target exits or is deleted while a message waits → the sender's card becomes `failed`, nothing is typed → covered in Task 4.
3. Claude retries the same `SendMessage` (same `tool_use_id`) or the hook is re-run → delivered once → covered in Task 4 (rid dedupe).
4. A multi-line body or one quoting `</ledge-message>` → typed on one line, parsed back as one received card → covered in Task 2.
5. The daemon is down when Claude sends to a Codex → the hook prints nothing and returns within its budget → covered in Task 7.

---

### Task 1: Gate: can a Codex shell reach the daemon? — DONE, outcome (c)

Checked 2026-10-19 on Codex CLI 0.162.1 (`codex exec --sandbox workspace-write`): `ledge who` prints `daemon not running`; the sandbox's seccomp forbids INET sockets. AF_UNIX sockets are forbidden too. A permissions profile (`[permissions.<name>.network]`, `domains = {"127.0.0.1"="allow"}`) reaches the daemon through Codex's proxy but cannot pin the port: every loopback service opens. The user chose the hook route: Codex's `PreToolUse` hook runs `ledge send` / `ledge who` outside the sandbox (Task 9). No launch-time change in `src/spawn.ts`.

### Task 2: The typed message and its parser

**Files:**
- Modify: `src/daemon/crossSession.ts`
- Test: `test/crossSession.test.ts`

**Interfaces:**
- Produces: `formatLedgeMessage(m: { from: string; tool: Tool; text: string; to: Tool }): string` and `ledgeMessages(text: string): { from: string; tool?: string; text: string }[] | undefined`, both exported from `crossSession.ts` (`Tool` from `@ledge/protocol`).

- [ ] **Step 1: Write the failing tests**

```ts
describe('ledge messages (spec 2026-10-19 codex messaging §3.2)', () => {
  it('formats one line naming the sender, with the reply hint of the receiver', () => {
    expect(formatLedgeMessage({ from: 'Pim', tool: 'codex', text: 'Tests verts\nje pousse', to: 'claude' }))
      .toBe('<ledge-message from="Pim" tool="codex">Tests verts ⏎ je pousse</ledge-message> (message de la session Pim, pas de l\'utilisateur ; pour répondre : SendMessage vers Pim)');
    expect(formatLedgeMessage({ from: 'Otto', tool: 'claude', text: 'ok', to: 'codex' }))
      .toContain('pour répondre : ledge send Otto "…")');
  });
  it('a body quoting the closing tag stays one message', () => {
    const line = formatLedgeMessage({ from: 'Pim', tool: 'codex', text: 'voir </ledge-message> ici', to: 'claude' });
    expect(ledgeMessages(line)).toEqual([{ from: 'Pim', tool: 'codex', text: 'voir </ledge-message> ici' }]);
  });
  it('round-trips, and tolerates a prompt cut before the closing tag', () => {
    expect(ledgeMessages('<ledge-message from="Pim" tool="codex">début du mes')).toEqual([{ from: 'Pim', tool: 'codex', text: 'début du mes' }]);
  });
  it('is undefined for any other prompt', () => {
    expect(ledgeMessages('Lance les tests')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter ./packages/ledge exec vitest run test/crossSession.test.ts` — Expected: FAIL (`formatLedgeMessage` not exported).
- [ ] **Step 3: Implement** both functions. Newlines become ` ⏎ ` (the line must pass `tmux.sendText`); the closing tag inside the body is escaped as `<\/ledge-message>` when formatting and unescaped when parsing; the parser reads the body up to the last `</ledge-message>` or the end of the text, and ignores the trailing hint.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): the Ledge message a session receives, and its parser`

### Task 3: Protocol: `session.message` and `message.ack`

**Files:**
- Modify: `packages/protocol/src/messages.ts`
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces:
  - client `{ type: 'session.message', rid: string (min 1), from: string (min 1, Ledge session id), to: string (min 1, Ledge name, may end in ` [ref]`), text: string (min 1), summary?: string, intercept?: boolean }`. `intercept: true` (the Claude hook) means: answer `native` unless `to` is a live non-Claude Ledge session.
  - server `{ type: 'message.ack', rid: string, outcome: 'accepted' | 'queued' | 'native' | 'refused', reason?: string }`.
  - `export type MessageAck = Extract<ServerMessage, { type: 'message.ack' }>`.

- [ ] **Step 1: Write the failing test:** `parseClientMessage` accepts a full `session.message` and rejects one with `text: ''`; `parseServerMessage` accepts `{ type: 'message.ack', rid: 'r1', outcome: 'refused', reason: 'x' }` and rejects `outcome: 'sent'`.
- [ ] **Step 2: Run** `pnpm --filter ./packages/protocol exec vitest run` — Expected: FAIL.
- [ ] **Step 3: Implement** the two schema entries in `ClientMessageSchema` / `ServerMessageSchema`, with a one-line doc comment each like their neighbours, and export `MessageAck`.
- [ ] **Step 4: Run** the same command — Expected: PASS; then `pnpm typecheck` — Expected: no errors (the server's exhaustive switches may need the new case stubbed until Task 5).
- [ ] **Step 5: Commit** `feat(protocol): session.message and its ack`

### Task 4: The mailbox

**Files:**
- Create: `src/daemon/mailbox.ts`
- Modify: `src/daemon/relay.ts` (export `free`; `RelayDeps` gains `typing?: Set<string>` and `next?: (id: string) => void`)
- Test: `test/mailbox.test.ts`, `test/relay.test.ts`

**Interfaces:**
- Consumes: `formatLedgeMessage` (Task 2), `session.message` / `MessageAck` (Task 3).
- Produces:

```ts
export interface MailboxDeps {
  store: Pick<Store, 'get' | 'all' | 'onChange'>;
  /** session.reply's path (server `replyTo`): null once typed and taken, the refusal otherwise; rejects when the injection fails. */
  replyTo: (id: string, text: string) => Promise<string | null>;
  /** Shared with the relay: a session being typed into. */
  typing: Set<string>;
  /** A chat relay instruction is queued for the session: it goes first. */
  relayQueued: (id: string) => boolean;
  sent: { record(senderId: string, item: { rid: string; at: string; to: string; peer?: string; text: string; summary?: string }): void; mark(senderId: string, rid: string, status: 'delivered' | 'failed'): void };
  now?: () => string;
}
export interface Mailbox { submit(m: Extract<ClientMessage, { type: 'session.message' }>): MessageAck; kick(id: string): void; close(): void }
export function createMailbox(d: MailboxDeps): Mailbox;
```

Behaviour of `submit`, in order:
1. `rid` already accepted → the same ack as the first time, nothing new queued.
2. Resolve `to` (strip a trailing ` [ref]`) to a session of `store.all()` with that `name`, not `exited`, not archived (`isArchived`).
3. `intercept` and (no such session or its `tool === 'claude'`) → `native`.
4. No such session → `refused`, reason `aucune session Ledge nommée ${to}`. Sender `from` unknown → `refused`, `session émettrice inconnue`. `source === 'hook_only'` or no `tmuxSession` → `refused`, `${name} n'a pas été lancée par Ledge : impossible de lui écrire`.
5. Otherwise `sent.record(from, …)` with `peer` = target id, enqueue `{ rid, from, target, text }` and return `accepted` if the target is free, not typing and has no relay queued (delivery starts now, asynchronously), else `queued`.

Delivery: for a target, take the oldest queued message when `free(s) && !typing.has(id) && !relayQueued(id)`; add to `typing`, `replyTo(id, formatLedgeMessage({ from: senderName, tool: senderTool, text, to: s.tool }))`; null → `mark(from, rid, 'delivered')`; a refusal or rejection → `mark(from, rid, 'failed')` and `kick(id)` again (the session is still free). Always remove from `typing` in `finally`. On a store change: target `removed` or `exited` → every message queued for it gets `mark(…, 'failed')` and is dropped; target free → kick. `kick(id)` is public for the relay's `next`.

Relay change: `typing` defaults to a new set as today; after a refused delivery leaves the session free with no relay queued for it, call `d.next?.(id)`.

- [ ] **Step 1: Write the failing tests** in `test/mailbox.test.ts`, with the `mk`/`Store` helpers and the `replyTo` recorder of `test/relay.test.ts`:
  - `a free Codex gets the message now, formatted, and the card is delivered` — sender `s1` Otto (claude), target `s2` Pim (codex, idle): ack `{ outcome: 'accepted' }`, after `flush()` `typed` is `[['s2', formatLedgeMessage({ from: 'Otto', tool: 'claude', text: 'Salut', to: 'codex' })]]`, `sent` calls are `record('s1', { rid: 'r1', to: 'Pim', peer: 's2', … })` then `mark('s1', 'r1', 'delivered')`.
  - `a busy target waits for its free moment` — target `working`: ack `queued`, nothing typed; `store.patch('s2', { state: 'idle' })`, flush → typed once.
  - `never into a dialog` — target `idle` with `pending: { kind: 'permission', … }`: `queued`, nothing typed.
  - `a queued chat relay goes first` — `relayQueued: id => id === 's2'` while the target is idle: `queued`, nothing typed; after `relayQueued` turns false and `mailbox.kick('s2')`: typed.
  - `one per free moment, oldest first` — two messages to a working target, then idle: only the first is typed (the fake `replyTo` patches the target to `working`); idle again → the second.
  - `the same rid twice is delivered once` — two `submit` with `rid: 'r1'`: same ack, one typed.
  - `the target exits before delivery` — queued, then `store.patch('s2', { state: 'exited' })`: `mark('s1', 'r1', 'failed')`, nothing typed.
  - `intercept: a Claude target or an unknown name is native` — both `{ outcome: 'native' }`, no `record`.
  - `refusals` — unknown name without intercept, `hook_only` target, unknown sender: the three exact reasons above.
  - In `test/relay.test.ts`: `a refused delivery with nothing else queued hands the free session to next`.
- [ ] **Step 2: Run** `pnpm --filter ./packages/ledge exec vitest run test/mailbox.test.ts test/relay.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `createMailbox` and the relay change.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): the mailbox types agent messages at the target's free moment`

### Task 5: History: the cards, the received message, the peer by name

**Files:**
- Modify: `src/daemon/history.ts`, `src/daemon/peers.ts`, `src/daemon/index.ts`
- Test: `test/history.test.ts`, `test/peers.test.ts`

**Interfaces:**
- Consumes: `ledgeMessages` (Task 2).
- Produces: `History.recordSent(senderId, item)` and `History.markSent(senderId, rid, status)` (the `sent` dep of Task 4, same shapes); `ledgePeer(target: string, peers: readonly ClaudePeer[], sessions: readonly Session[]): Session | undefined` in `peers.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `peers.test.ts`: `ledgePeer` returns `peerFor`'s answer when there is one, else the live session whose `name` is the target (` [ref]` stripped), else undefined; an `exited` session of that name is not returned.
  - `history.test.ts`:
    - `recordSent` puts a `sent` card `{ id: rid, to, peer, text, status: 'sending' }`; when a card with that id exists (the Claude `PreToolUse` came first) it keeps it and only sets `peer`.
    - `markSent(…, 'delivered')` sets `delivered`; it never downgrades a `read` card.
    - a `PostToolUseFailure` for `SendMessage` whose card went through `recordSent` does not turn it `failed` (the hook's `deny`).
    - a `UserPromptSubmit` whose text is `formatLedgeMessage(…)` from Pim gives a `received` card `{ from: 'Pim', text }`, paired with Pim's open `sent` card, which becomes `read` (with `peerOf` resolving names, as `ledgePeer` does).
- [ ] **Step 2: Run** `pnpm --filter ./packages/ledge exec vitest run test/history.test.ts test/peers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `record`'s `UserPromptSubmit`, try `ledgeMessages` right after `crossSession`, with the same turn/`receive` handling (`from` = the name, no address). Track the rids that went through `recordSent` in a private `Set` (not persisted) and skip `PostToolUse`/`PostToolUseFailure` for them. In `index.ts`, `peerOf` becomes `t => ledgePeer(t, readPeers(), store.all())?.id`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): Ledge messages in the thread, with their delivery`

### Task 6: Server wiring

**Files:**
- Modify: `src/daemon/server.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `createMailbox` (Task 4), `History.recordSent/markSent` (Task 5), the relay's `typing`/`next` (Task 4).

- [ ] **Step 1: Write the failing tests** (the file's `fakeTmux`, `mk`, `connect` helpers):
  - `session.message to a free Codex is acked accepted and typed` — `a` Otto (claude), `b` Pim (codex, idle, `tmuxSession: 'ledge-b'`, pane showing its prompt): `c.send({ type: 'session.message', rid: 'r1', from: 'a', to: 'Pim', text: 'Salut' })`; `await c.next('message.ack')` equals `{ type: 'message.ack', rid: 'r1', outcome: 'accepted' }`; `tmux.sent` contains the formatted line for `ledge-b` followed by Enter.
  - `intercept to a Claude is native, nothing typed`.
  - `the card in the sender's thread goes sending → delivered` — with a `History` passed in, as the deny-with-note test does.
- [ ] **Step 2: Run** `pnpm --filter ./packages/ledge exec vitest run test/server.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** One `typing` set passed to `createRelay` and `createMailbox`; `relayQueued: id => chat.queuedRelays().some(q => q.relay.id === id)`; the relay's `next: id => mailbox.kick(id)`; `sent: { record: (…) => history.recordSent(…), mark: (…) => history.markSent(…) }`. `case 'session.message': return send(ws, mailbox.submit(msg));`. Close the mailbox where the relay is closed.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(daemon): session.message`

### Task 7: Claude's `SendMessage` to a Codex

**Files:**
- Modify: `src/cli/hook.ts`
- Test: `test/hook.test.ts`

**Interfaces:**
- Consumes: `session.message` with `intercept: true`, `message.ack` (Task 3).
- Produces: `runHook('PreToolUse', …)` for Claude resolves to a JSON string `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason } }` when the ack is `accepted` / `queued` / `refused`, `undefined` for `native` or any failure. `hookMain` already prints what `runHook` returns.

Reasons (exact copy): `accepted` → `Message transmis par Ledge à ${to} (${tool}) : il le reçoit maintenant.`; `queued` → `Message transmis par Ledge à ${to} (${tool}) : il le recevra dès qu'il sera libre.`; `refused` → `Ledge n'a pas pu transmettre le message à ${to} : ${reason}`. `tool` is read from the daemon's snapshot (it is sent on connect); when absent, omit ` (${tool})`.

- [ ] **Step 1: Write the failing tests** (the file's daemon fixture):
  - a Claude `PreToolUse` `SendMessage` `{ to: 'Pim', message: 'Salut' }` with `tool_use_id: 'tu1'` from a launched session (`LEDGE_SESSION=a`) and Pim a free Codex → the deny JSON with the `accepted` reason; the daemon got `session.message` `{ rid: 'tu1', from: 'a', to: 'Pim', text: 'Salut', intercept: true }` after the `session.event`.
  - to a Claude target → `undefined`.
  - no daemon listening → `undefined`, within 2 s.
  - a Codex `PreToolUse` `SendMessage` is never intercepted (only `agent === 'claude'`).
- [ ] **Step 2: Run** `pnpm --filter ./packages/ledge exec vitest run test/hook.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** in `runHook`: for `agent === 'claude'`, `eventName === 'PreToolUse'`, `tool_name === 'SendMessage'`, a string `to` and `message`, and `mapped.id`: timeout 1500 ms instead of 100; after the `session.event`, read the `snapshot`, send `session.message`, await `message.ack` within the shared deadline; map it as above. Any throw → `undefined`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hook): Claude's SendMessage reaches a Codex through Ledge`

### Task 8: `ledge send` and the identity lines

**Files:**
- Create: `src/cli/send.ts`
- Modify: `src/cli/index.ts` (usage line and `case 'send'`), `src/cli/hook.ts` (`identityContext`)
- Test: `test/send.test.ts`, `test/hook.test.ts`

**Interfaces:**
- Consumes: `session.message`, `message.ack` (Task 3), `codexLedgeId` (`src/cli/hook.ts`).
- Produces: `sendMessage(args: string[], opts?: { port?: number; env?: NodeJS.ProcessEnv; from?: string }): Promise<{ line: string; code: number }>` (`from`, when given, is the sender id and skips the env lookup; Task 9 passes the hook's session id); usage line `ledge send <nom> "<message>" [--summary <texte>]   write to another Ledge session`.

Lines printed (exact copy): `accepted` → `remis à ${to}`; `queued` → `${to} est occupé : il le recevra dès qu'il sera libre`; `refused` → `refusé : ${reason}` (exit 1); no sender id → `ledge send ne marche que dans une session lancée par Ledge` (exit 1); daemon down → `daemon not running` as `printWho` says it (exit 1); bad usage → the usage line (exit 1). Never sends `intercept`; `rid` is `randomUUID()`.

Identity lines in `identityContext`: Codex gets `Pour écrire à une autre session Ledge, lance \`ledge send <nom> "<message>"\`.`; Claude's line becomes `Pour écrire à une autre session Ledge, Claude ou Codex, utilise son nom Ledge comme adresse SendMessage.`

- [ ] **Step 1: Write the failing tests:** in `send.test.ts` (start a server as `who.test.ts` does): the four outcomes and their lines/codes, the sender read from `LEDGE_CODEX_HOOK_SESSION` before `LEDGE_SESSION`, `--summary` passed through; in `hook.test.ts`: the two identity lines.
- [ ] **Step 2: Run** `pnpm --filter ./packages/ledge exec vitest run test/send.test.ts test/hook.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then the whole suite `pnpm --filter ./packages/ledge exec vitest run` and `pnpm typecheck` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(cli): ledge send, and every session is told how to write`

### Task 9: Codex runs `ledge send` and `ledge who` through its hook

Codex's sandbox forbids the shell to reach the daemon (Task 1), so Codex's `PreToolUse` hook, which runs outside it, executes these two commands and returns their output as a `deny` reason; Codex shows the model « Command blocked by PreToolUse hook: <output> ».

**Files:**
- Modify: `src/cli/send.ts` (the parser), `src/cli/hook.ts` (`runHook`, Codex identity line)
- Test: `test/send.test.ts`, `test/hook.test.ts`

**Interfaces:**
- Consumes: `sendMessage(args, { port, from })` (Task 8), `printWho({ port, self })` (`src/cli/who.ts`).
- Produces: `parseLedgeCommand(command: string): { cmd: 'who' } | { cmd: 'send'; args: string[] } | undefined`, exported from `src/cli/send.ts`.

Parser rules: words split on unquoted spaces, tabs and newlines; `'…'` is literal; inside `"…"` only `\"`, `\\`, `\$` and `` \` `` are escapes, and an unescaped `$` or `` ` `` makes the command unparsable; an unquoted `;`, `&`, `|`, `<`, `>`, `(`, `)`, `$`, `` ` `` or a word starting with `#` makes it unparsable; an unclosed quote too. The first word must be `ledge`; `who` with nothing after → `{ cmd: 'who' }`; `send` → `{ cmd: 'send', args: <the remaining words> }`; anything else → `undefined`.

- [ ] **Step 1: Write the failing tests.** In `send.test.ts`, `parseLedgeCommand`:
  - `ledge who` → `{ cmd: 'who' }`; `ledge who --all` → `undefined`
  - `ledge send Otto "Tests verts` + newline + `je pousse"` → `{ cmd: 'send', args: ['Otto', 'Tests verts\nje pousse'] }`
  - `ledge send Otto 'coût: $5'` → args `['Otto', 'coût: $5']`; `ledge send Otto "dit \"oui\""` → args `['Otto', 'dit "oui"']`
  - `ledge send Otto "a" && rm -rf x`, `ledge send Otto "$(cat f)"`, `ledge send Otto "x" > f`, `ledge send Otto "x`, `ls`, `FOO=1 ledge who` → `undefined`

  In `hook.test.ts` (the file's daemon fixture), a Codex `PreToolUse` with `tool_name: 'Bash'` from session `b`:
  - `tool_input.command` `ledge send Otto 'Salut'`, Otto a live session → the daemon got `session.message` `{ from: 'b', to: 'Otto', text: 'Salut' }` (no `intercept`) after the `session.event`; `runHook` returns `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'remis à Otto' } }` as JSON (or the `queued` line when Otto is busy).
  - `ledge who` → the deny JSON whose reason is `formatWho(<the snapshot's sessions>, 'b')`.
  - `ls -la` → `undefined`.
  - no daemon listening → `undefined`, within 2 s.
  - the Codex identity line (exact copy): `Pour écrire à une autre session Ledge, lance \`ledge send <nom> "<message>"\` (seul, sans && ni |). Ledge exécute lui-même \`ledge send\` et \`ledge who\` : leur résultat t'arrive comme « Command blocked by PreToolUse hook: … », c'est la réponse, pas une erreur.` — it replaces Task 8's Codex line.
- [ ] **Step 2: Run** `pnpm --filter ./packages/ledge exec vitest run test/send.test.ts test/hook.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `parseLedgeCommand` in `send.ts`, then in `runHook`: for `agent === 'codex'`, `eventName === 'PreToolUse'`, `tool_name === 'Bash'`, a string `tool_input.command` that parses, and `mapped.id`: timeout 1500 ms as in Task 7; after the `session.event`, run `printWho({ port, self: mapped.id })` or `sendMessage(args, { port, from: mapped.id })` within the shared deadline; return the deny JSON with the printed line(s) as the reason, whatever the exit code. `daemon not running`, a timeout or any throw → `undefined`.
- [ ] **Step 4: Run** the same command, then the whole suite `pnpm --filter ./packages/ledge exec vitest run` and `pnpm typecheck` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(hook): a Codex writes and lists sessions through its hook, outside the sandbox`

### Task 10: End to end, by hand

- [ ] **Step 1:** Rebuild/link Ledge as the project does (`ledge setup` if the hook settings changed), launch `ledge claude --name Otto` and `ledge codex --name Pim` in one repo.
- [ ] **Step 2:** Ask Otto to write to Pim with `SendMessage`: Otto shows the Ledge receipt, Pim gets the `<ledge-message>` prompt and works on it.
- [ ] **Step 3:** Ask Pim to answer Otto: it runs `ledge send Otto "…"`, its hook answers `remis à Otto` (shown as « Command blocked by PreToolUse hook »), Otto receives it at its next free moment. Ask Pim to run `ledge who`: the table comes back the same way.
- [ ] **Step 4:** In Desktop, both threads show the cards: Otto's `sent` → `read`, Pim's `received`, and the reverse.
- [ ] **Step 5:** Message Pim while it is mid-turn: delivered after its turn, not before. Note any wording or timing issue for the user.
