# Close sessions from the Ledge chat — Lot 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ledge (« Demandez à Ledge ») proposes a close card for the sessions the user names, and a click closes each one cleanly (`/exit`, kill only as a last resort), on Desktop, the overlay and through the fleet.

**Architecture:** The chat model ends its answer with one ```` ```ledge-close ```` block per session. The chat service resolves them against the store into `turn.closes`. A front sends `session.close { qid, rows? }`. The daemon's `closeFromChat` runs `closeSession` on every row in parallel. `closeSession` frees the prompt (interrupt, deny a pending request), types the adapter's exit command, waits for `exited` and kills the tmux session if the agent does not leave. The fronts render a `CloseGroupCard` (packages/ui) and free it from the turn's marks, as for launch cards.

**Tech Stack:** TypeScript, zod (packages/protocol), Node daemon (packages/ledge), React (packages/ui, apps/desktop, apps/overlay), vitest, Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-21-close-from-chat-design.md` (§1–4, §6, §7). Lot 2 (mobile) is `docs/superpowers/plans/2026-10-21-close-from-chat-lot2-mobile.md`.

## Global Constraints

- Only Ledge closes sessions. There is no `ledge close` CLI command and no agent-side path (spec §2).
- A close never archives or deletes a session. It ends `exited` and stays resumable (`session.resume`).
- The chat proposes and the user's click closes. There is no extra confirmation dialog.
- Rows are capped at `MAX_PROPOSALS` (8). `rows` is validated exactly like `session.launch`'s (ints 0..7, unique, 1 to 8).
- Default delays: wait for a free prompt **10 s**, then wait for `exited` **15 s**. Both are server options: `opts.close?: { freeMs?: number; exitMs?: number }`.
- Never type text into a permission or question dialog. A pending request is only ever refused (interrupt keys). The refusal is recorded in the thread as a `deny` marked as coming from the close.
- The exit command goes through a dedicated path, never through `replyTo` / `injectAndVerify` / the mailbox / `ledge send`.
- `id`, `name` and `tool` of a close row come from the store, never from the block.
- User-facing copy is in French and English. Code comments and commits are in English, in the repo's style (`feat(chat): …`).
- Work on branch `feat/chat-close`, in the worktree `.claude/worktrees/chat-close`. Never mutate git in the shared main checkout.

## Review Focus

- The agent exits on its own while the close runs (between the interrupt and `/exit`, or before the wait starts). Expected: the row reports `how: 'exit'`, nothing is typed into the dead pane, and nothing is killed or marked failed. The test is in Task 4.
- A draft left in the input box. Expected: the line is cleared before `/exit`, so the draft is never sent as an instruction. The test is in Task 2 (the plan's first step clears) and Task 4.
- A chat relay card or a mailbox message is queued for the session while it closes. Expected: nothing is typed into it, even when it turns `idle` between the interrupt and the exit, and the queued item fails once the session is `exited`. The test is in Task 4.
- The same session is named on two cards (two turns), or two fronts click « Fermer tout » at once. Expected: one close runs. The second click on the same row is passed over (`inFlight`). The other card's row fails with the `busy` refusal, then shows « Terminée » once the session is exited. The tests are in Task 5 and Task 7.
- The machine that owns the turn drops while a close is in flight. Expected: the Desktop card and the fleet operation are freed, and no row stays « Fermeture… » forever. The tests are in Task 6 and Task 8.

---

### Task 1: Protocol: the close block, the close rows, the messages

**Files:**
- Modify: `packages/protocol/src/proposal.ts`
- Modify: `packages/protocol/src/chat.ts`
- Modify: `packages/protocol/src/messages.ts` (`chat.done` at :116, `ClientMessageSchema` near `session.launch` / `session.relay` :160-175, the server union near `session.launched`)
- Modify: `packages/protocol/src/index.ts` (only if it re-exports by name)
- Test: `packages/protocol/test/proposal.test.ts`, `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces:
  - `BlockKind = 'session' | 'relay' | 'project' | 'close'`
  - `CloseBlockSchema = z.object({ session: z.string().trim().min(1) })`, `type CloseBlock`, `parseCloseBlock(raw: string): CloseBlock | null`
  - `ChatCloseSchema = z.object({ id: z.string().min(1), name: z.string(), tool: ToolSchema, closedAt: z.string().datetime().optional(), how: z.enum(['exit', 'killed']).optional(), error: z.string().optional() })`, `type ChatClose`, `type CloseHow = 'exit' | 'killed'`
  - `ChatClosesSchema = z.array(ChatCloseSchema).min(1).max(MAX_PROPOSALS)`
  - `ChatTurnSchema.closes?: ChatClose[]`, and `chat.done.closes?: ChatClose[]`
  - client `{ type: 'session.close', qid: string, rows?: number[] }`, server `{ type: 'session.closed', qid: string, row: number, id: string, how: CloseHow }`

- [ ] **Step 1: Write the failing tests**

In `proposal.test.ts`:
- `extractProposal('Je ferme Arlo et Bram.\n```ledge-close\n{"session":"a1"}\n```\n```ledge-close\n{"session":"b2"}\n```')` gives `kind: 'close'`, `text: 'Je ferme Arlo et Bram.'` and two blocks of kind `'close'`.
- A `ledge-session` block followed by a `ledge-close` block gives `kind: 'close'`. A `ledge-close` block followed by a `ledge-relay` block gives `kind: 'relay'`. Both blocks are removed from `text`.
- `parseCloseBlock('{"session":"  a1 "}')` gives `{ session: 'a1' }`. `parseCloseBlock('{"session":""}')`, `parseCloseBlock('nope')` and `parseCloseBlock('{}')` give `null`.
- `hideProposal('Je ferme Arlo.\n```ledge-cl')` gives `'Je ferme Arlo.'`. `hideProposal('Je ferme.\n```ledge-close\n{"session":"a')` gives `'Je ferme.'`.

In `messages.test.ts`:
- `ClientMessageSchema` accepts `{ type: 'session.close', qid: 'q1' }` and `{ type: 'session.close', qid: 'q1', rows: [0, 7] }`. It rejects `rows: []`, `rows: [8]`, `rows: [1, 1]` and nine rows.
- `ServerMessageSchema` accepts `{ type: 'session.closed', qid: 'q1', row: 0, id: 's1', how: 'killed' }` and rejects `how: 'quit'`.
- `chat.done` and `ChatTurnSchema` accept `closes: [{ id: 's1', name: 'Arlo', tool: 'claude' }]` and reject `closes: []` and nine rows.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ledge/protocol exec vitest run test/proposal.test.ts test/messages.test.ts`
Expected: FAIL (`parseCloseBlock` is not exported; `session.close` is rejected).

- [ ] **Step 3: Implement**

- `proposal.ts`: add `'```ledge-close'` to `FENCES`, `close` to the `BLOCK` alternation, and the schema and parser next to `parseRelayBlock`. Update the `hideProposal` doc comment with ```` ```ledge-cl ````.
- `chat.ts`: add the schemas after `ChatRelaySchema`.
- `messages.ts`: add the `rows` refinement as a shared `const launchRows = …`, used by both `session.launch` and `session.close`, rather than copying it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ledge/protocol exec vitest run`
Expected: PASS. Then run `pnpm -r exec tsc --noEmit -p .`. Some packages may break on an exhaustive `switch (msg.type)` over `ClientMessage`. In `server.ts`, add a temporary `case 'session.close': return refuse('not supported yet');`. Task 5 replaces it.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol packages/ledge/src/daemon/server.ts
git commit -m "feat(protocol): ledge-close block, close rows, session.close and session.closed"
```

### Task 2: Adapters: the exit command

**Files:**
- Modify: `packages/ledge/src/adapters/types.ts`, `claude.ts`, `codex.ts`, `cursor.ts` (next to `interruptKeys`: claude.ts:424, codex.ts:253, cursor.ts:355). Also any other `Adapter` implementation `tsc` reports.
- Test: `packages/ledge/test/adapters-exit.test.ts` (new)

**Interfaces:**
- Produces, on `Adapter`:
  - `exitText(): string`
  - `exitPlan(): KeyPlan`: clear the input line, type `exitText()`, submit. The plan has no `until` step, because nothing is verified (spec §3 step 4).

- [ ] **Step 1: Find the real exit commands**

Codex and Cursor Agent are installed. Start each in a scratch tmux on the dedicated socket, with no tmux name that Ledge watches: `tmux -L ledge-scratch new -d -s x codex`. Type `/exit` and then `/quit`, and check with `tmux -L ledge-scratch capture-pane -p -t x` which one ends the process. Kill the scratch server (`tmux -L ledge-scratch kill-server`). Write the result in the adapter's comment. If neither works reliably, keep `/exit` and note that the `killSession` fallback covers it (spec §7).

- [ ] **Step 2: Write the failing test**

`adapters-exit.test.ts`, for each of `claude`, `codex` and `cursor` through `adapterFor(tool)`:
- `exitText()` equals the verified command. It is `'/exit'` for claude.
- `exitPlan()` contains `{ text: exitText() }`. Its first step is the adapter's line-clearing keys, the same keys its `replyPlan` uses to clear a draft; read `replyPlan` for them. The plan ends with a `keys` step that submits. No step has `until`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @paradow/ledge exec vitest run test/adapters-exit.test.ts`
Expected: FAIL (`exitText is not a function`).

- [ ] **Step 4: Implement `exitText` and `exitPlan` in each adapter**

Reuse each adapter's own clear and submit keys and its pause before Enter, if its `replyPlan` has one. Do not route through `replyPlan`: it may add `until` checks.

- [ ] **Step 5: Run the test to verify it passes, then commit**

Run: `pnpm --filter @paradow/ledge exec vitest run test/adapters-exit.test.ts`
Expected: PASS

```bash
git add packages/ledge/src/adapters packages/ledge/test/adapters-exit.test.ts
git commit -m "feat(adapters): the command that quits each agent CLI"
```

### Task 3: Chat service and persona: the close card

**Files:**
- Modify: `packages/ledge/src/chat/service.ts` (`Chat` :20-35, `relayFrom` :128-138, `run` :208-225, the returned object :230+)
- Modify: `packages/ledge/src/chat/claude.ts` (`PERSONA`, :8)
- Modify: every `Chat` stub that `tsc` reports, at least `packages/ledge/test/server.test.ts` `stubChat`.
- Test: `packages/ledge/test/chat-service.test.ts` (next to the relay cases :246-340), `packages/ledge/test/chat-claude.test.ts`, `packages/ledge/test/mobile-chat.test.ts`

**Interfaces:**
- Consumes: `parseCloseBlock`, `ChatClose`, `CloseHow`, `MAX_PROPOSALS` (Task 1).
- Produces, on `Chat`:
  - `close(qid: string, row: number): ChatClose | undefined` (it rolls the day first, as `relay` does)
  - `markClosed(qid: string, row: number, how: CloseHow, emit: (m: ChatMessage) => void): void`: sets `closedAt: now()` and `how`, removes `error`, and emits `chat.history`
  - `markCloseFailed(qid: string, row: number, message: string, emit: (m: ChatMessage) => void): void`: sets `error`, and emits `chat.history`

- [ ] **Step 1: Write the failing tests**

`chat-service.test.ts`, with the store fixture the relay tests use:
- `keeps a close row per known session, in order, with the store's name and tool`. The answer has blocks for `a1` then `b2`. Then `turn.closes` equals `[{ id: 'a1', name: 'Arlo', tool: 'claude' }, { id: 'b2', name: 'Bram', tool: 'codex' }]`, `chat.done` carries the same `closes`, and the text has no fence.
- `drops unknown, read-only, exited and repeated sessions`. Blocks name `zz`, a `hook_only` session, an `exited` session, `a1` and `a1` again. Then `closes` is `[a1]` only, and the log has one line per dropped block.
- `ignores close rows beyond 8`. With ten valid sessions, `closes` has 8 rows.
- `gives no card when no close row is valid`. Then `turn.closes` is undefined and `chat.done` has no `closes`.
- `gives no close card when the last block is not a close`. A `ledge-close` block is followed by a `ledge-relay` block. Then there is no `closes`, and the relay card is kept.
- `marks a close row closed or failed for every client`. `markCloseFailed(qid, 1, 'busy', emit)`, then `markClosed(qid, 1, 'killed', emit)`, leaves row 1 as `{ …, closedAt: <now>, how: 'killed' }` with no `error`. Each call emits `chat.history`. `close(qid, 5)` is undefined.

`chat-claude.test.ts`: `PERSONA` contains ```` '```ledge-close' ````, `'la conversation reste reprenable'` and `'Tu n\'agis jamais toi-même'`.

`mobile-chat.test.ts`: `toPhoneTurn` of a turn that carries `closes` parses with `PhoneChatTurnSchema`, and the result has no `closes` key. Until lot 2 the phone does not see the card (spec §2).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @paradow/ledge exec vitest run test/chat-service.test.ts test/chat-claude.test.ts test/mobile-chat.test.ts`
Expected: FAIL (no `closes` on the turn; persona has no `ledge-close`).

- [ ] **Step 3: Implement**

- `service.ts`: add `closesFrom(blocks, qid): ChatClose[]` next to `relayFrom`. It uses the same refusal reasons and log wording (`chat ${qid}: close ignored: …`), plus `duplicate session`. Call it in `run` when `kind === 'close'`, with the `MAX_PROPOSALS` cap and log line the session blocks use. Add `closes` to `turn` and to `chat.done` the way `relay` is added. A row update replaces the row in a new array (`t.closes = rows`), as `setRow` does.
- `claude.ts`: append the spec §4.4 rule to `PERSONA`, word for word, after the relay rule. Escape its backticks as the existing rules do:

> Quand l'utilisateur demande explicitement de fermer, clore, arrêter ou quitter une ou plusieurs sessions, réponds en une ou deux lignes puis termine par un bloc ```ledge-close contenant {"session": "<id>"} par session, 8 au plus, et seulement pour les sessions de sessions.md qui correspondent sans ambiguïté, qui ne sont pas en lecture seule et pas déjà terminées. Pour chacune des autres, cite les candidats et demande laquelle, ou dis pourquoi elle ne peut pas être fermée. La fermeture est propre et la conversation reste reprenable. Si l'utilisateur veut d'abord un point de reprise, propose seulement le relais de cette demande et dis-lui de demander la fermeture une fois les réponses arrivées.

- Add the three methods to each `Chat` stub that `tsc` reports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @paradow/ledge exec vitest run test/chat-service.test.ts test/chat-claude.test.ts test/mobile-chat.test.ts && pnpm --filter @paradow/ledge exec tsc --noEmit`
Expected: PASS, no type error.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/chat packages/ledge/test
git commit -m "feat(chat): Ledge proposes a close card for the sessions it is asked to close"
```

### Task 4: Daemon: `closeSession`

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts` (`startServer` options :161; `endSession` :410-430; the `typing` / relay / mailbox wiring :242-255; the model switch guard :542)
- Modify: `packages/ledge/src/daemon/relay.ts` (`RelayDeps`, `kick`, `request`, `settle`)
- Modify: `packages/ledge/src/daemon/mailbox.ts` (`MailboxDeps`, `ready`)
- Modify: `packages/protocol/src/messages.ts` (`SessionEventSchema` :60, by `decision`), `packages/protocol/src/thread.ts:20` (permission item)
- Modify: `packages/ledge/src/daemon/history.ts:177` (`Decided`)
- Modify: `apps/desktop/src/session/Thread.tsx:322` and the `decided` copy (`apps/desktop/src/i18n/fr.ts:630`, `en.ts`)
- Test: `packages/ledge/test/server.test.ts` (a new `describe('close a session')`), `packages/ledge/test/relay.test.ts`, `packages/ledge/test/mailbox.test.ts`, `packages/ledge/test/history.test.ts`, `apps/desktop/test/session-thread.test.ts` (or whichever Desktop test renders `Thread.tsx`'s decision chips)

**Interfaces:**
- Consumes: `Adapter.interruptKeys()`, `Adapter.exitPlan()` (Task 2), and `runPlan(s, plan)` (server.ts:294). It is safe for `exitPlan`, which has no `until` step.
- Produces:
  - inside `startServer`: `closeSession(s: Session): Promise<{ how: CloseHow }>`. It rejects with a `Refusal`.
  - `const closing = new Set<string>()`, passed to the relay and the mailbox
  - `RelayDeps.closing?: ReadonlySet<string>` and `MailboxDeps.closing?: ReadonlySet<string>`: a session in the set is never delivered to
  - option `opts.close?: { freeMs?: number; exitMs?: number }`, defaults `10_000` and `15_000`
  - `SessionEvent.byClose?: true` (only on `Decided`) and permission thread item `byClose?: true`
  - Desktop copy `decided.denyByClose`: `'Refusé par la fermeture'` / `'Denied by the close'`

`closeSession`, in the spec's order:

1. Refuse with `unknownSession()` (`unknown_session`), `readOnly()` (`read_only`), `new Refusal('the session has already exited', 'busy')`, or `new Refusal('a close is already in progress', 'busy')` when `closing.has(s.id)`. Add the id to `closing`, and remove it in a `finally`.
2. OMP (`backendOf(s) === 'omp-rpc'`): do what `endSession` does for it, then return `{ how: 'exit' }`.
3. If the session is `working` or `starting`, or has a `pending`: send `interruptKeys()`. If `pending` had no `helperId`, apply `{ name: 'Decided', decision: 'deny', byClose: true, source: 'daemon' }`. Then wait up to `freeMs` for `free(store.get(id)) && !typing.has(id)`.
4. If the prompt is free: `runPlan(s, adapter.exitPlan())`. A `runPlan` error is logged and leads to step 6.
5. Wait up to `exitMs` for `store.get(id)?.state === 'exited'`.
6. Otherwise: `tmux.killSession`, then apply `PaneGone`, log `close of <id>: killed (<why>)`, and return `{ how: 'killed' }`.

At every wait, a session that is `exited` (or gone from the store) ends the close at once with `{ how: 'exit' }`, and nothing more is typed.

- [ ] **Step 1: Write the failing tests**

In `server.test.ts`, in a new `describe('close a session')`:
- Use `fakeTmux` and `opts.close = { freeMs: 200, exitMs: 200 }`.
- Call `closeSession` through a test-only hook. Prefer exposing it on `ServerHandle` as `close(id: string)`; the existing handle's style decides.
- Simulate the exit by deleting `panes[name]` and applying `PaneGone` when the fake's `sendKeys` gets the submit key after `/exit`.

The cases:
- `closes an idle session with its exit command`. `tmux.sent` is the clear keys, then `['text', 'ledge-a', '/exit']`, then submit. The state is `exited`, `how` is `'exit'`, no `kill` is recorded, and the session is not archived.
- `interrupts a working session before it types the exit command`. The `interruptKeys` come first, then `/exit` once the store shows `idle`.
- `refuses a pending permission, records the refusal and never types into the dialog`. Use the `PROMPT` fixture and a pending permission. The first keys are `Escape`. `history.items(id)` has the permission with `decision: 'deny', byClose: true`. No `text` is sent before the session is free.
- `kills the session when the agent does not leave`. The pane never goes. Expect `['kill', 'ledge-a']`, `exited`, `how: 'killed'`, and a log line.
- `kills without typing when the prompt is never freed`. The state stays `working`, there is no `text` in `sent`, and `how` is `'killed'`.
- `a session that exits by itself during the close is closed, not killed`. `PaneGone` comes during the free wait. Expect `how: 'exit'`, no `/exit` typed, and no kill.
- `closes an OMP session through omp.close`
- `refuses a read-only, an exited and an already closing session`. Run two `close` calls at once: the second one rejects with the `busy` code.
- `delivers nothing to a closing session`. Queue a relay card and a mailbox message for the session. Start the close, and let the session turn `idle` after the interrupt. `replyTo` is never called for it. After `exited`, the relay card has `error`, and the message is marked `failed`.

In `relay.test.ts` / `mailbox.test.ts`: a session id in `closing` is not delivered to when free, and it is delivered once it leaves the set and a store change comes.

In `history.test.ts`: `Decided { decision: 'deny', byClose: true }` sets `byClose: true` on the open permission.

In the Desktop thread test: a permission with `decision: 'deny', byClose: true` shows « Refusé par la fermeture ».

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @paradow/ledge exec vitest run test/server.test.ts -t "close a session" && pnpm --filter @paradow/ledge exec vitest run test/relay.test.ts test/mailbox.test.ts test/history.test.ts`
Expected: FAIL (no `close` on the handle; `closing` is ignored).

- [ ] **Step 3: Implement**

- Write `closeSession` as specified above. Polling every `UNTIL_POLL_MS` or using `store.onChange` is the builder's choice (spec §7). Either way, clean up the subscription or the timer on every path.
- `relay.ts`: check `!d.closing?.has(id)` everywhere `free(...) && !typing.has(...)` is checked (`kick`, `request`, `settle`, and the change handler).
- `mailbox.ts`: check it in `ready`.
- `server.ts:542`: the model switch also skips closing sessions.
- `history.ts`: copy `byClose` onto the permission item.
- `Thread.tsx`: show `th.decided.denyByClose` when `item.byClose`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @paradow/ledge exec vitest run && pnpm --filter desktop exec vitest run`
Expected: PASS (all daemon tests: the relay and mailbox ones show the change breaks nothing).

- [ ] **Step 5: Commit**

```bash
git add packages/ledge packages/protocol apps/desktop
git commit -m "feat(daemon): close a session cleanly: free its prompt, type its exit command, kill as a last resort"
```

### Task 4b: Thread: a question dismissed by the close

Added after the Task 4 review (ruling R2). History never makes a permission row for a question: a question is a `tool` row (`PreToolUse`, `running`). A `Decided` with `deny` would therefore mark an older permission row by mistake. Task 4 sends a `Decided` with no decision for a pending question. This task records in the thread that the close dismissed that question, as spec §3 step 3 asks.

**Files:**
- Modify: `packages/ledge/src/server.ts` (closeSession: for a pending question, send `{ name: 'Decided', byClose: true }`, with no decision)
- Modify: `packages/ledge/src/daemon/history.ts` (`Decided` case)
- Modify: `packages/protocol/src/thread.ts` (tool item: `byClose: z.literal(true).optional()`)
- Modify: `apps/desktop/src/session/ActionGroup.tsx`, `apps/desktop/src/i18n/{fr,en}.ts`
- Modify: `apps/overlay/src/surface/Thread.tsx` (both cases: a permission with `byClose`, and a question tool row with `byClose`)
- Test: the history test, packages/protocol, ActionGroup/Thread tests, the overlay Thread test

**Interfaces:**
- Consumes: Task 4 `closeSession`; `QUESTION_TOOLS` from `daemon/state.ts`.
- Produces: `ToolItem.byClose?: true`.

- [ ] **Step 1: Failing tests.**
  - History: a `Decided` with `byClose` and no `decision` marks the last open question tool row. That row has `QUESTION_TOOLS.has(tool)`, `status === 'running'` and no `helperId`. It gets `byClose: true` and is settled. No permission row changes.
  - A `Decided` with `byClose` and no open question row changes nothing.
  - The protocol schema accepts `byClose` on a tool item.
  - Desktop: a question tool row with `byClose` shows « Refusée par la fermeture » (en "Dismissed by the close").
  - Overlay: a permission with `byClose` shows the close label, not the plain "denied".
  - Overlay: a question tool row with `byClose` shows the close label too.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - Copy: fr `questionByClose: 'Refusée par la fermeture'`, en `'Dismissed by the close'`. The overlay reuses its existing copy file and follows its own pattern.
- [ ] **Step 4: Run the tests and tsc. They pass.**
- [ ] **Step 5: Commit** `feat(thread): a question dismissed by closing the session says so`.

### Task 5: Daemon: `closeFromChat` and `session.close`

**Files:**
- Create: `packages/ledge/src/chat/close.ts`
- Modify: `packages/ledge/src/daemon/server.ts`: replace Task 1's temporary case, next to `case 'session.relay'` (:840), with the `chatLaunches` set (:563) as the model
- Test: `packages/ledge/test/chat-close.test.ts` (new, modelled on `chat-launch.test.ts`), `packages/ledge/test/server.test.ts` (`describe('close from a chat card')`, next to `describe('launch from a chat card')` :1377)

**Interfaces:**
- Consumes: `Chat.close`, `markClosed`, `markCloseFailed` (Task 3), `closeSession` (Task 4), `threads.owner(qid)` and `threads.emitterOf(thread)`.
- Produces (`chat/close.ts`):
  - `interface CloseDeps { chat: Pick<Chat, 'close' | 'markClosed' | 'markCloseFailed'>; close: (id: string) => Promise<{ how: CloseHow }>; emit: (m: ChatMessage) => void; inFlight: Set<string>; onClosed?: (row: number, id: string, how: CloseHow) => void }`
  - `class CloseRefused extends Error {}`, with the messages `'unknown close'` (no such row) and `'already closed'` (every named row is closed or in flight)
  - `closeFromChat(deps: CloseDeps, qid: string, rows?: number[]): Promise<{ closed: Array<{ row: number; id: string; how: CloseHow }>; failed: Array<{ row: number; message: string }> }>`. When `rows` is omitted, it takes every row. Rows run in parallel (`Promise.all`); the `inFlight` keys are `` `${qid}#${row}` ``.
  - Lot 2 reuses this function as is.

- [ ] **Step 1: Write the failing tests**

`chat-close.test.ts`:
- `closes the rows in parallel and marks each`. Two rows, and `close` resolves only after both have started (check with two deferreds). Expect `closed` to have both, and `markClosed` and `onClosed` to be called per row.
- `marks a failed row with its reason and goes on`
- `passes over a closed row and a row in flight, refuses when none is left`. Expect `CloseRefused('already closed')`.
- `refuses an unknown row`. Expect `CloseRefused('unknown close')`.
- `closes a row once even when it is named twice or clicked twice at once`. Expect `close` to be called once for `[0, 0]`. Two concurrent `closeFromChat(…, [0])` calls give one close; the second one rejects with `'already closed'`.

`server.test.ts`, in `describe('close from a chat card')`, with a stub chat holding `closes` for `q1`, the fake tmux and short `opts.close`:
- `session.close { qid: 'q1' }` from client A closes both sessions. A gets `session.closed { qid: 'q1', row, id, how: 'exit' }` for each row. A and B both get `chat.history`.
- An unknown qid gets `error { request: 'session.close', message: 'unknown close' }` with no id.
- When a row fails, the requester gets one `error { request: 'session.close' }` once all rows are settled, as launch does when `done.failed > 0`.
- A device thread's qid resolves through `threads.owner` (use the threads fixture the relay tests use).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @paradow/ledge exec vitest run test/chat-close.test.ts && pnpm --filter @paradow/ledge exec vitest run test/server.test.ts -t "close from a chat card"`
Expected: FAIL (module `chat/close.js` not found).

- [ ] **Step 3: Implement**

- `close.ts`: write `closeFromChat` as described in the Interfaces block.
- `server.ts`: add `const chatCloses = new Set<string>()`. In the `session.close` case:
  - resolve the thread with `threads.owner(msg.qid)`, and its chat from `threads.all()`;
  - call `closeFromChat` with `close: id => { const s = store.get(id); if (!s) throw unknownSession(); return closeSession(s); }`, `emit: threads.emitterOf(thread)`, and `onClosed: (row, id, how) => reply({ type: 'session.closed', qid: msg.qid, row, id, how })`;
  - turn a `CloseRefused` into `refuse(e.message)`;
  - if `failed.length > 0`, throw the first failure's message so that the requester gets `error { request: 'session.close' }`.
  - An unknown thread is refused with `'unknown close'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @paradow/ledge exec vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ledge
git commit -m "feat(chat): a close card's click closes its sessions in parallel"
```

### Task 6: Fleet: carry the close card across machines

**Files:**
- Modify: `packages/fleet/src/fleet.ts` (`OPERATIONS` :11, `mappedTurn` :127-133, `session.launched` :194, `chat.history` :213-216, `chat.done` :228-231, `error` :252, the operations set at :362, the outgoing qid translation used for `session.relay`)
- Modify: `packages/fleet/src/store.ts:56` (`chat.done` copy)
- Test: `packages/fleet/test/fleet.test.ts` (next to :276, :375-382 and :425), `packages/fleet/test/store.test.ts`

**Interfaces:**
- Consumes: the Task 1 schemas.
- Produces:
  - a `session.close` sent through the fleet reaches the turn's machine with the raw qid;
  - `session.closed` comes back with `id` qualified;
  - `turn.closes[].id` is qualified;
  - the machine's operation ends when every requested row is settled, on a `session.close` error, or when the machine drops.

- [ ] **Step 1: Write the failing tests**

`fleet.test.ts`:
- `qualifies the close rows of a remote turn`. A `chat.history` with `closes: [{ id: 'a1', … }]` from machine `pc2` gives `closes[0].id === qualify('pc2', 'a1')`, and the same holds through `chat.done`.
- `relays session.closed qualified`
- `holds a close operation until every requested row is settled`.
  - Send `session.close { qid, rows: [0, 1] }`.
  - A history with only row 0 `closedAt` keeps the operation, so a second `session.launch` to that machine is held or refused as operations are today (follow the existing test at :375-382).
  - Row 1 getting `error` ends the operation.
  - A row whose `error` did not change since the send is not settled.
- `ends a close operation on its error and on the machine's drop`

`store.test.ts`: `apply(chat.done with closes)` keeps `closes` on the turn.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ledge/fleet exec vitest run`
Expected: FAIL (the ids are not qualified; `closes` is dropped in the store).

- [ ] **Step 3: Implement**

- Add `'session.close'` to `OPERATIONS` and to the `operations.set` condition (:362).
- Keep `closeRows = new Map<string, { qid: string; rows: number[]; errors: Array<string | undefined> }>()` per machine. Fill it from the mapped turn at send time: `rows` defaults to all of `closes`. In the `chat.history` handler, delete the operation and the entry once every row has `closedAt`, or an `error` that differs from the one recorded at the send. Clear the entry wherever `operations.delete(machine)` runs.
- In `mappedTurn`, add `...(raw.closes ? { closes: raw.closes.map(c => ({ ...c, id: qualify(p.config.id, c.id) })) } : {})`.
- Pass `closes: m.closes` in the `chat.done` raw (:230) and in `store.ts:56`.
- Qualify `session.closed`'s `id` like `session.launched` does, without `operations.delete`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ledge/fleet exec vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fleet
git commit -m "feat(fleet): carry close cards and their operation across machines"
```

### Task 7: Shared UI: `CloseGroupCard` in `ChatView`

**Files:**
- Create: `packages/ui/src/chat/CloseGroupCard.tsx`
- Modify: `packages/ui/src/chat/copy.tsx` (`ChatCopy.chat.close`), `packages/ui/src/chat/ChatView.tsx` (props :21-40, the card chain :172-187), `packages/ui/src/index.ts` (export)
- Modify: the copy that fills `ChatCopy`: `apps/desktop/src/i18n/fr.ts` and `en.ts` (next to `group:` :875), `apps/overlay/src/i18n/messages.ts` (:209 fr, :444 en)
- Modify: `packages/ui/test/chat-copy-fixture.ts` (the test copy gains `close`)
- Test: `packages/ui/test/close-group.test.tsx` (new, modelled on `launch-group.test.tsx`)

**Interfaces:**
- Consumes: `ChatClose` (Task 1).
- Produces:
  - `CloseGroupCardProps { closes: ChatClose[]; sessions: readonly Session[]; busy: boolean; busyRows: readonly number[]; disabled: boolean; onClose: (rows: number[]) => void; onOpenSession: (id: string) => void }`
  - `ChatViewProps` gains `closingQid?: string | null; closingRows?: readonly number[] | null; onCloseSessions?: (qid: string, rows?: number[]) => void`. It is not named `onClose`, which `ChatView` already uses to close the panel.
  - `ChatCopy.chat.close: { label: (n: number) => string; row: string; all: (n: number) => string; closing: string; closed: string; killed: string; ended: string; retry: string; failed: Say }`
    - fr: `label: n => n === 1 ? 'Session à fermer' : \`${n} sessions à fermer\``, `row: 'Fermer'`, `all: n => \`Fermer tout (${n})\``, `closing: 'Fermeture…'`, `closed: 'Fermée'`, `killed: 'Fermée de force'`, `ended: 'Terminée'`, `retry: 'Réessayer'`, `failed: m => \`Échec : ${m}\``
    - en: `'Session to close'` / `` `${n} sessions to close` ``, `'Close'`, `` `Close all (${n})` ``, `'Closing…'`, `'Closed'`, `'Force closed'`, `'Ended'`, `'Retry'`, `` m => `Failed: ${m}` ``

A row's state, in this order:
1. `closedAt` set: `closed`, or `killed` when `how === 'killed'`.
2. Its session is listed as `exited`: `ended`, with no button.
3. `busy && busyRows.includes(i)`: `closing`.
4. `error` set: `failed`, with the reason and `retry`.
5. Otherwise: proposed, with the `row` button.

« Fermer tout » shows when two or more rows are still open (proposed or failed). It sends every one of those rows.

- [ ] **Step 1: Write the failing tests**

`close-group.test.tsx`:
- `shows one row per session with its name, tool and live state`. The name links to `onOpenSession`.
- `closes one row, or all open rows`. « Fermer tout (2) » calls `onClose([0, 2])` when row 1 is closed.
- `shows closing, closed, force closed, ended and failed rows`. A failed row's « Réessayer » calls `onClose([i])`. An `exited` session's row has no button and says « Terminée ».
- `holds every button while busy or disabled`

Also a `ChatView` test, in the existing ChatView test file: a turn with `closes` renders `CloseGroupCard` and no launch or relay card, and `onCloseSessions(qid, rows)` is called.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ledge/ui exec vitest run test/close-group.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

- Write `CloseGroupCard` with the markup and styles of `LaunchGroupCard`: `data-close-group` on the section and `data-close-row={state}` on each row. Markup and CSS are the builder's choice (spec §7).
- In `ChatView`, check `turn.closes` first in the card chain. Every card's `disabled` also counts `!!p.closingQid`, and the close card counts `launchingQid` and `relayingQid`.
- Fill the copy in Desktop and the overlay.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ledge/ui exec vitest run && pnpm -r exec tsc --noEmit -p .`
Expected: PASS, no type error.

- [ ] **Step 5: Commit**

```bash
git add packages/ui apps/desktop/src/i18n apps/overlay/src/i18n
git commit -m "feat(ui): the close card of the Ledge chat"
```

### Task 8: Desktop: send `session.close` and free the card

**Files:**
- Modify: `apps/desktop/src/chat/useChatCards.ts`, `apps/desktop/src/chat/ChatPanel.tsx:50,81-83`
- Test: `apps/desktop/test/chat.test.tsx` (next to the launch cases :230-317 and :500-583)

**Interfaces:**
- Consumes: `ChatViewProps.closingQid`, `closingRows` and `onCloseSessions` (Task 7), and `session.close` (Task 1).
- Produces, on `ChatCards`: `closingQid: string | null; closingRows: readonly number[] | null; close(qid: string, rows?: number[]): void`

The card is held one action at a time, like launch and relay. `close` does nothing while a launch, relay or close is in flight, or while the turn's machine is not ready. It sends `{ type: 'session.close', qid, ...(rows ? { rows } : {}) }`, with only the rows that have no `closedAt`.

The card is freed when:
- every sent row has `closedAt`, or an `error` that differs from the one it had at the send;
- or an id-less error with `request === 'session.close'` comes;
- or the machine is no longer ready.

- [ ] **Step 1: Write the failing tests**

In `chat.test.tsx`:
- `closes the rows of a close card and frees it once the turn marks them`. After « Fermer tout », `send` got `session.close { qid, rows: [0, 1] }`, and every button shows `Fermeture…` or is disabled. A history with only row 0 closed keeps it busy; a history with both rows closed frees it.
- `frees the close card on its refusal`
- `frees the close card when its machine goes away`
- `sends nothing for a machine that is not ready, or while a launch is in flight`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter desktop exec vitest run test/chat.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

- Add a `Closing { qid; rows; from: Array<string | undefined>; errorSeq }` ref and its state, next to `Launching`.
- Add the effect's branch, then pass `closingQid`, `closingRows` and `onCloseSessions={cards.close}` from `ChatPanel`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter desktop exec vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): close sessions from the Ledge chat card"
```

### Task 9: Overlay: send `session.close`, free the card, e2e

**Files:**
- Modify: `apps/overlay/src/surface/Surface.tsx` (next to `launchProposal` :518-546 and the `ChatView` props :767-768)
- Test: `apps/overlay/test/close-from-chat.test.tsx` (new, modelled on `relay-from-chat.test.tsx` and `launch-from-chat.test.tsx`), `apps/overlay/e2e/close-from-chat.spec.ts` (new, modelled on `relay-from-chat.spec.ts`)

**Interfaces:**
- Consumes: Task 7's props and Task 1's messages.
- Produces: the overlay state `chatClosing: string | null` and the ref `closedFrom: Array<{ row: number; error: string | undefined }>`.

`chatClosing` is set by `closeSessions(qid, rows?)` and freed on the same three conditions as Task 8. The overlay has no fleet `turnMachine` check when `client.fleet` is absent, as in `launchProposal`. `session.closed` opens no tab.

- [ ] **Step 1: Write the failing tests**

`close-from-chat.test.tsx`:
- `sends session.close with the open rows and holds the card`
- `frees it when every sent row is marked`
- `frees it on a session.close error and when the daemon is unreachable`
- `does nothing while a launch or a relay is in flight`

`close-from-chat.spec.ts`: on the mocked daemon of `relay-from-chat.spec.ts`, an answer with two `closes` rows shows the card. « Fermer tout » sends `session.close`. The mocked `chat.history` with `closedAt` and `how: 'killed'` on row 1 shows « Fermée » and « Fermée de force ».

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter overlay exec vitest run test/close-from-chat.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

In `Surface.tsx`, add `closeSessions` and the effects that free the card, next to `launchProposal`. Then pass `closingQid`, `closingRows` and `onCloseSessions` to `ChatView`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay exec vitest run && pnpm --filter overlay exec playwright test e2e/close-from-chat.spec.ts`
Expected: PASS. If Playwright is not set up in the overlay package, use the e2e command its `relay-from-chat.spec.ts` runs with (see its package.json).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): close sessions from the Ledge chat card"
```

### Task 10: Documentation and the whole check

**Files:**
- Modify: `README.md` (the chat cards description, and the protocol table: add `session.close` and `session.closed`)
- Modify: `packages/ledge/README.md` (section « Ask Ledge (chat) »)

- [ ] **Step 1: Write the docs**

Describe the close card in the existing tone:
- what Ledge proposes;
- that the click closes cleanly with `/exit`, and kills the session after 15 s if the agent does not leave;
- that a pending request is refused;
- that the session stays resumable;
- that there is no agent-side `ledge close`.

- [ ] **Step 2: Run the whole suite**

Run: `pnpm -r test && pnpm -r exec tsc --noEmit -p .`
Expected: every package PASS, no type error.

- [ ] **Step 3: Check the real thing once**

In a live daemon on this machine, start a scratch Claude session in a temporary folder (not a shared worktree). Ask Ledge « ferme <nom> », click « Fermer », and check that `ledge who` lists it `exited` and that `session.resume` brings it back. Kill any test tmux session you started (`tmux -L ledge kill-session -t ledge-<id>`).

- [ ] **Step 4: Commit**

```bash
git add README.md packages/ledge/README.md
git commit -m "docs: close sessions from the Ledge chat"
```
