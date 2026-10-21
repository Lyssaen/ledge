# Close sessions from the Ledge chat — Lot 2 (mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone's chat with Ledge shows the close card, and a tap closes its sessions after a passkey check, exactly as on Desktop.

**Architecture:** The phone gets `turn.closes` as strict `PhoneChatClose` rows, projected by `toPhoneTurn`. A tap prepares a `close` challenge bound to the turn's `qid`, signs it with the passkey, and sends `chat.close { op, qid, rows?, assertion }`. The gateway checks the operation like `chat.launch` does, then calls the daemon's `closeFromChat` (lot 1) on the device's chat thread.

**Tech Stack:** TypeScript, zod (packages/protocol), Node daemon (packages/ledge), React PWA (apps/mobile), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-close-from-chat-design.md` §5. This plan needs lot 1 (`docs/superpowers/plans/2026-10-21-close-from-chat-lot1.md`) merged or on the same branch: it reuses `ChatClose`, `CloseHow`, `closeFromChat` and `closeSession`.

## Global Constraints

- The phone never sees a free error text. A failed row is `failed: true`, as for the other phone cards.
- Every phone object is `.strict()`.
- A close from the phone needs a passkey assertion bound to the `qid` with purpose `'close'`. A `launch` or `decide` assertion is never accepted for it.
- Without a registered passkey, the gateway answers `confirm_required`, and the app shows the setup hint as it does for launch.
- `chat.close` is volatile: it is never replayed after a page reload.
- `rows` is validated like `chat.launch`'s: ints 0..7, unique, 1 to 8.
- The phone's copy is French only, in `apps/mobile/src/copy.ts`.
- Work on branch `feat/chat-close` (or a branch on top of it). Never mutate git in the shared main checkout.

## Review Focus

- An assertion made for a launch of the same `qid` is sent with a `chat.close`. Expected: it is refused (`rejected`), and nothing is closed. The test is in Task 2.
- Every row of the card is already closed when the operation arrives, for example closed from Desktop meanwhile. Expected: the gateway answers `failed` before it checks, and so spends, the assertion. The app shows the rows' real state from the next history. The test is in Task 2.
- The phone reloads while a close is in flight. Expected: `chat.close` is not replayed. The card shows what `chat.history` says, and the rows still in flight show « Fermeture… » only from the live operation, never forever. The test is in Task 3.
- A row's session is no longer in the phone's session list, or it is `exited` there. Expected: the row reads « Terminée » with no button, and « Fermer tout » leaves it out. The test is in Task 3.
- A `chat.close` for a turn of another device, or of Desktop. Expected: `rejected` (`unknown_session`), as `chat.launch` does. The test is in Task 2.

---

### Task 1: Protocol and projection: the close card reaches the phone

**Files:**
- Modify: `packages/protocol/src/phone.ts` (`ConfirmPurposeSchema` :118, next to `PhoneChatRelaySchema`, `PhoneChatTurnSchema` :141, the `chat.launch` op :199)
- Modify: `packages/ledge/src/mobile/chat.ts` (`toPhoneTurn`)
- Test: `packages/ledge/test/phone.test.ts` (phone schemas), `packages/ledge/test/mobile-chat.test.ts`

**Interfaces:**
- Consumes: `ChatClose` and `CloseHow` (lot 1, Task 1).
- Produces:
  - `ConfirmPurposeSchema = z.enum(['register', 'decide', 'launch', 'close'])`
  - `PhoneChatCloseSchema = z.object({ id: z.string().min(1), name: z.string(), tool: ToolSchema, how: z.enum(['exit', 'killed']).optional(), closedAt: z.string().datetime().optional(), failed: z.literal(true).optional() }).strict()`, `type PhoneChatClose`
  - `PhoneChatTurnSchema.closes?: z.array(PhoneChatCloseSchema).min(1).max(MAX_PROPOSALS)`
  - phone op `{ type: 'chat.close', op: OperationIdSchema, qid: OperationIdSchema, rows?: number[], assertion?: Assertion }`. Its `rows` check is shared with `chat.launch` as one const, not copied.

- [ ] **Step 1: Write the failing tests**

`phone.test.ts`:
- `PhoneChatTurnSchema` accepts `closes: [{ id: 's1', name: 'Arlo', tool: 'claude', how: 'killed', closedAt: <iso> }]`. It rejects a row with `error: 'busy'` (strict) and `closes: []`.
- `PhoneClientMessageSchema` accepts `{ type: 'chat.close', op, qid }` and `{ type: 'chat.close', op, qid, rows: [0, 2], assertion }`. It rejects `rows: [0, 0]` and `rows: [8]`.
- `ConfirmPurposeSchema` accepts `'close'`.

`mobile-chat.test.ts`: change lot 1's projection case. `toPhoneTurn` of a turn whose `closes` has a closed row (`how: 'exit'`), a failed row (`error: 'busy'`) and a proposed row gives:
- `closes: [{ id, name, tool, how: 'exit', closedAt }, { id, name, tool, failed: true }, { id, name, tool }]`;
- a result that parses with `PhoneChatTurnSchema`;
- no `error` key in any row.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @paradow/ledge exec vitest run test/phone.test.ts test/mobile-chat.test.ts`
Expected: FAIL (`closes` is unknown to the strict turn schema).

- [ ] **Step 3: Implement**

- Add the schemas in `phone.ts`.
- In `toPhoneTurn`, map each row explicitly as `relay` is mapped, and drop `error` for `failed: true`.
- Run `pnpm -r exec tsc --noEmit -p .`. Some code may switch over `ConfirmPurpose` or `PhoneOperation` exhaustively, such as the gateway's `SessionOperation` or the app's `ConfirmRequest`. Add `'chat.close'` to the `SessionOperation` exclusion (gateway.ts:169) now, and leave the rest to Tasks 2 and 3.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @paradow/ledge exec vitest run test/phone.test.ts test/mobile-chat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol packages/ledge
git commit -m "feat(mobile): the close card in the phone's chat protocol"
```

### Task 2: Gateway: `chat.close` closes the device's sessions

**Files:**
- Modify: `packages/ledge/src/mobile/gateway.ts`:
  - deps, next to `launchChat` (:75)
  - `checkAssertion` purpose type (:182)
  - a new `chatClose` next to `chatLaunch` (:296-313)
  - the `run` dispatch (:330)
  - `confirm.prepare` (:435-441)
  - the approved-device case (:470)
- Modify: `packages/ledge/src/daemon/server.ts` (the gateway deps, :889). `closeSession` and `chatCloses` must be defined before the gateway is built.
- Test: `packages/ledge/test/mobile-gateway.test.ts` (next to the `chat.launch` cases), `packages/ledge/test/server.test.ts` (or `mobile-phone-e2e.test.ts`, whichever already wires `launchChat` end to end)

**Interfaces:**
- Consumes: `closeFromChat(deps, qid, rows?)` and `CloseRefused` (lot 1, Task 5), `closeSession` (lot 1, Task 4), and Task 1's schemas.
- Produces:
  - gateway dep `closeChat?: (thread: ChatThreadId, qid: string, rows?: number[]) => Promise<{ closed: Array<{ row: number; id: string; how: CloseHow }>; failed: Array<{ row: number; message: string }> }>`
  - `confirm.prepare { purpose: 'close', qid }` issues a challenge `{ deviceId, purpose: 'close', subject: qid }`, with the same checks as `'launch'`: the turn is the device's own, and the credential exists with the right rpId.

`chatClose(deviceId, msg)` returns an `Outcome`, in this order:
1. `rejected` / `unknown_session`: not the device's own turn, or no `closeChat` dep.
2. `rejected` / `invalid`: the turn has no `closes`, `rows` is empty, or a targeted row does not exist.
3. `rejected` / `confirm_required`: no credential.
4. `failed`: every targeted row already has `closedAt`, checked before the assertion is spent.
5. The assertion check through `checkAssertion(deviceId, msg.assertion, 'close', msg.qid)`.
6. `closeChat('device:<id>', qid, targets)`. A `CloseRefused` gives `failed`. Otherwise the outcome is `applied` if at least one row closed, and `failed` if none did.

The server's `closeChat` mirrors its `launchChat`: it resolves the thread's chat and emitter, and calls `closeFromChat` with `inFlight: chatCloses`, and `close` and `onClosed` as in lot 1's `session.close` case. Here `onClosed` sends nothing: the phone learns from `chat.history`.

- [ ] **Step 1: Write the failing tests**

`mobile-gateway.test.ts`, with the fixtures of the `chat.launch` cases:
- `closes the rows of the device's own close card after its passkey check`. `closeChat` is called with `('device:<id>', qid, [0, 1])`, the result is `applied`, and the challenge is spent.
- `refuses a close without a passkey, then without an assertion`. Expect `confirm_required`, then `rejected`, with no `closeChat` call.
- `refuses a launch assertion for a close of the same turn`. The challenge is issued with purpose `'launch'` and `subject: qid`. The result is `rejected`, with no `closeChat` call.
- `refuses a close of another device's turn`. Expect `unknown_session`.
- `refuses an unknown row, and a turn with no close card`. Expect `invalid`.
- `answers failed when every row is already closed, before it spends the assertion`. The same assertion then still works for a later valid `chat.close`, or the challenge store shows it unspent, whichever the launch test checks.
- `answers failed when no row closed`
- `prepares a close challenge only for the device's own turn`
- `answers an invalid chat.close from an approved device with rejected`. Send `rows: [1, 1]`: the device gets `operation.result { status: 'rejected', reason: 'invalid' }`, as `chat.launch` does at :470.

End to end, in the test file that already exercises `launchChat` through the real server: a device's chat turn with `closes` for an idle fake session. A signed `chat.close` leaves the session `exited`, sends the device a `chat.history` whose row has `closedAt`, and leaves Desktop's turns unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @paradow/ledge exec vitest run test/mobile-gateway.test.ts`
Expected: FAIL (`chat.close` is not handled).

- [ ] **Step 3: Implement**

- `gateway.ts`: write `chatClose` in the order given above. Widen `checkAssertion`'s `purpose` to `'decide' | 'launch' | 'close'`. Add the `confirm.prepare` branch. Extend the :470 condition with `request === 'chat.close'`.
- `server.ts`: add the `closeChat` dep next to `launchChat`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @paradow/ledge exec vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ledge
git commit -m "feat(mobile): a signed chat.close closes the sessions of the phone's close card"
```

### Task 3: App: the close card on the phone

**Files:**
- Modify: `apps/mobile/src/state/store.ts`:
  - `ConfirmRequest` (:45);
  - a `close` action next to `launch` (:570-590);
  - the place that maps a `ConfirmRequest` to `confirm.prepare`, if it switches on purpose.
- Modify: `apps/mobile/src/state/operations.ts:40` (`isVolatile`)
- Create: `apps/mobile/src/ui/chat/CloseCard.tsx`
- Modify: `apps/mobile/src/ui/chat/TurnView.tsx` (next to `LaunchCards`, :71)
- Modify: `apps/mobile/src/copy.ts` (next to the launch strings, :44-51)
- Test: `apps/mobile/test/state/chat.test.ts`, `apps/mobile/test/screens/chat-cards.test.tsx`, `apps/mobile/e2e/chat.spec.ts`, and `apps/mobile/test/fakePc.ts` (it must answer `chat.close` and `confirm.prepare` with purpose `close`)

**Interfaces:**
- Consumes: Task 1's `PhoneChatClose`, `chat.close` and `ConfirmPurpose 'close'`.
- Produces:
  - `ConfirmRequest` gains `{ purpose: 'close'; qid: string }`
  - store action `close(qid: string, rows?: number[]): Promise<void>`. It has the shape of `launch`: chat action guard, `prepareConfirm({ purpose: 'close', qid })`, `getAssertion`, then it writes `chat.close { op, qid, rows?, assertion }`. With no passkey it shows the setup hint (`launchSetup`'s close twin).
  - `isVolatile` includes `'chat.close'`
  - copy, under the chat's copy object:
    - `closeLabel: 'Sessions à fermer'`, `closeRow: 'Fermer'`, `closeAll: (n: number) => \`Fermer tout (${n})\``
    - `closing: 'Fermeture…'`, `closed: 'Fermée'`, `killed: 'Fermée de force'`, `ended: 'Terminée'`
    - `closeFailed: 'Échec de la fermeture'`, `closeSetup: 'Protégez d\'abord vos accords depuis Connexion.'`

`CloseCards({ turn, sessions })` has one row per `turn.closes` row, with the name, the tool and a state. The state follows lot 1's order:
1. `closedAt`: `closed`, or `killed` when `how === 'killed'`.
2. The session is absent from the phone's list, or `exited` there: `ended`.
3. A live `chat.close` operation for this `qid` names the row (or names no rows): `closing`.
4. `failed`: `closeFailed`, with the `closeRow` button to retry.
5. Otherwise: the `closeRow` button.

`closeAll` shows when two or more rows are open, and it sends them. Every button is held while a `chat.relay`, `chat.launch` or `chat.close` of the turn is live.

- [ ] **Step 1: Write the failing tests**

`state/chat.test.ts`:
- `close prepares a close challenge for the turn, signs it and sends chat.close with the rows`
- `close without a passkey sends nothing and shows the setup hint`
- `chat.close is not replayed after a reload`. Persist the outbox with a `chat.close`, reload, and check that nothing is sent.

`screens/chat-cards.test.tsx`:
- `shows one close row per session with its live state`. The case covers closed, force closed, failed and proposed rows, and a row whose session is `exited` or missing from the list, which reads « Terminée » with no button.
- `Fermer tout sends only the open rows`
- `holds the close card while a close or a launch of the turn is live`

`e2e/chat.spec.ts`: the fake PC answers with a close card of two rows. « Fermer tout » goes through the passkey prompt of the harness and sends `chat.close`. The fake PC's next history marks both rows closed, and the card reads « Fermée » twice.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ledge/mobile exec vitest run test/state/chat.test.ts test/screens/chat-cards.test.tsx`
Expected: FAIL (no `close` action; no close card).

- [ ] **Step 3: Implement**

- Add the store action, the `isVolatile` entry, `CloseCard.tsx`, the `TurnView` branch and the copy.
- In `TurnView`, the close card replaces the launch and relay cards when `turn.closes` is set, as the last block decides on the daemon.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ledge/mobile exec vitest run && pnpm --filter @ledge/mobile exec playwright test e2e/chat.spec.ts && pnpm -r exec tsc --noEmit -p .`
Expected: PASS, no type error.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): close sessions from the phone's chat card"
```

### Task 4: Documentation and the whole check

**Files:**
- Modify: the README sections lot 1 wrote (`README.md`, `packages/ledge/README.md`). Remove « Desktop and overlay only » if lot 1 wrote it.

- [ ] **Step 1: Write the docs**

Say that the phone shows the close card too, and that a close from the phone asks for the passkey.

- [ ] **Step 2: Run the whole suite**

Run: `pnpm -r test && pnpm -r exec tsc --noEmit -p .`
Expected: every package PASS, no type error.

- [ ] **Step 3: Commit**

```bash
git add README.md packages/ledge/README.md
git commit -m "docs: close sessions from the phone's chat"
```
