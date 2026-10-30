# Task transmission shown like a message — Implementation Plan

> Remplacé par 2026-10-30-ledge-openrig-orchestrator-design (lot 1 : équipes, rôles et tâches retirés).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every hand-over of a task between agents (give, pass, done, refuse, cancel) is seen like a message: a wire with a travelling ticket in the atelier, a card in the sender's thread, a line in the TUI's « Échanges ».

**Architecture:** the daemon writes a structured transmission (`op`, `from`, `to`, names) on each task log entry and broadcasts every task change; history puts an outgoing `notice` in the sender's thread; the fronts derive what to animate from the log, through one shared helper (`transmissions()`).

**Tech Stack:** TypeScript, zod (`@ledge/protocol`), Node daemon (`packages/ledge`), React (`apps/desktop`), Ink (TUI), vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-task-transmission-design.md`

## Global Constraints

- The `<ledge-task>` text typed into an agent's terminal stays byte for byte what it is today (existing `tasks.test.ts` assertions on `notify` stay untouched and green).
- No new `ThreadItem` kind: the sender's card is a `notice` (`notice: 'other'`, `task`), with new **optional** fields only.
- All new schema fields are optional; a journal written before this change loads and never animates.
- `paused`, `reduced` and `prefers-reduced-motion`: line and bubble show, the ticket does not fly, no landing ring.
- A wire shows while its transmission is less than `BUBBLE_MS` (5000 ms) old on the atelier's clock.
- Code, comments, commits in English (`feat(ledge): …`); user-facing strings in `fr.ts` and `en.ts` both.
- Test commands: `pnpm --filter <pkg> test -- <file>` from the worktree root (`@ledge/protocol`, `@paradow/ledge`, `@ledge/fleet`, `desktop`); `pnpm typecheck` before each commit.

## Review Focus

1. **A context handover passes N tasks at once** (`daemon/handover.ts`): N wires, N outgoing cards in the relieved session, no crash, no duplicate card on a history replay. → test in Task 3.
2. **An endpoint not drawn** (owner exited, a room collapsed, a session of another machine): no wire, no error, the other wires still show. → test in Task 6.
3. **A `seen` change** (Ledge puts a closed task away) re-broadcasts the task: it must not re-animate nor re-record a card. → tests in Tasks 2 and 3.
4. **A journal from before this change** (log entries without `op`): loads, lists, never animates, never appears in « Échanges ». → test in Task 1 (`transmissions()` returns `[]`).
5. **Give then pass within 5 s**: two wires at once, keyed apart. → test in Task 6.

---

### Task 1: Protocol — structured transmissions on the task log

**Files:**
- Modify: `packages/protocol/src/tasks.ts`
- Modify: `packages/protocol/src/thread.ts` (notice fields)
- Test: `packages/protocol/test/tasks.test.ts` (new)

**Interfaces:**
- Produces:
  - `TaskLogEntrySchema = z.object({ at, by, what, op?: TaskOp, from?: string, to?: string, fromName?: string, toName?: string, note?: string })`, used by `TaskSchema.log`; `type TaskLogEntry`.
  - `export const TASK_OPS = ['give', 'take', 'pass', 'done', 'refuse', 'cancel', 'drop'] as const; type TaskOp`.
  - `export const TRANSMISSION_OPS = ['give', 'pass', 'done', 'refuse', 'cancel'] as const; type TransmissionOp`.
  - `export interface TaskTransmission { index: number; at: string; op: TransmissionOp; from: string; to: string; fromName: string; toName: string; note?: string }`.
  - `export function transmissions(t: Task): TaskTransmission[]` — the log entries whose `op` is in `TRANSMISSION_OPS` and that have `from` and `to`, in log order; `index` is the entry's index in `t.log`; missing names fall back to `''`.
  - Notice item: optional `taskOp: z.enum(TRANSMISSION_OPS)` and `outgoing: z.literal(true)` on the `notice` variant of `ThreadItemSchema`.
- `TaskUpdatedSchema` comment: « Every change of every task, to every local front ».

- [ ] **Step 1: Write the failing tests**

```ts
it('lists the transmissions of a task, in log order, with their log index', () => {
  const t = task({ log: [
    { at: A, by: 'Max', what: 'confiée à Nova', op: 'give', from: 'max', to: 'nova', fromName: 'Max', toName: 'Nova' },
    { at: B, by: 'Nova', what: 'prise', op: 'take' },
    { at: C, by: 'Nova', what: 'passée à Pim : relis', op: 'pass', from: 'nova', to: 'pim', fromName: 'Nova', toName: 'Pim', note: 'relis' }
  ] });
  expect(transmissions(t)).toEqual([
    { index: 0, at: A, op: 'give', from: 'max', to: 'nova', fromName: 'Max', toName: 'Nova' },
    { index: 2, at: C, op: 'pass', from: 'nova', to: 'pim', fromName: 'Nova', toName: 'Pim', note: 'relis' }
  ]);
});
it('finds none in a log written before transmissions existed', () => {
  expect(transmissions(task({ log: [{ at: A, by: 'Max', what: 'confiée à Nova' }] }))).toEqual([]);
  expect(TaskSchema.parse(task({ log: [{ at: A, by: 'Max', what: 'confiée à Nova' }] })).log[0]).toEqual({ at: A, by: 'Max', what: 'confiée à Nova' });
});
it('parses a notice carrying taskOp and outgoing', () => {
  const n = { kind: 'notice', id: 'task-t1-0', at: A, turn: 3, notice: 'other', task: 't1', taskOp: 'give', outgoing: true, name: 'Nova', text: 'x' };
  expect(ThreadItemSchema.parse(n)).toMatchObject({ taskOp: 'give', outgoing: true });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @ledge/protocol test -- tasks` → `transmissions` not exported.
- [ ] **Step 3: Implement** the schema fields, constants, `transmissions()` in `packages/protocol/src/tasks.ts`; the notice fields in `thread.ts`. Export from the package index like the other task exports.
- [ ] **Step 4: Run, verify PASS**; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(protocol): structured task transmissions on the task log (#92)`

---

### Task 2: Daemon — write transmissions, broadcast every task, Ledge lists every task

**Files:**
- Modify: `packages/ledge/src/daemon/tasks.ts`
- Modify: `packages/ledge/src/daemon/server.ts:280-284`
- Test: `packages/ledge/test/tasks.test.ts`, `packages/ledge/test/teams-server.test.ts` (or `server.test.ts`, wherever `task.updated` is asserted today)

**Interfaces:**
- Consumes: `TaskLogEntry`, `TaskOp` (Task 1).
- Produces: `TasksDeps.onTask?: (t: Task, entry?: TaskLogEntry) => void` — replaces `onLedgeTask`; called on every create and every `put` with the entry just appended, and on `seen` with `entry` undefined. `put(t, by, what, tr?: Pick<TaskLogEntry, 'op' | 'from' | 'to' | 'fromName' | 'toName' | 'note'>)`.

Entries written (ids are session ids, or `ledge`):

| op | written by | `from` / `fromName` | `to` / `toName` | `note` |
|---|---|---|---|---|
| give | `give` | giver | new owner | — |
| take | `take` | — | — | — |
| pass | `pass` | old owner | new owner | the note, if any |
| done | `done` | owner | giver | — |
| refuse | `refuse` by the owner | owner | giver | — |
| cancel | `refuse` by the giver (not owner) | giver | owner | — |
| drop | `dropFor` | — | — | — |

- [ ] **Step 1: Write the failing tests** in `tasks.test.ts`, with the existing harness (`createTasks({ store, mailbox: { notify }, teams, onTask: (t, e) => updates.push([t, e]), now })`):
  - `it('writes give, pass, done as transmissions')`: Max gives to Nova, Nova passes to Pim with note `relis`, Pim does it → `transmissions(task)` equals the three rows of the table with the right ids and names, `note: 'relis'` on the pass.
  - `it('writes a refusal by the owner as refuse and by the giver as cancel')`.
  - `it('tells onTask of a task between two seats, with the entry')`: a seat-to-seat give → `updates` has one `[task, entry]` with `entry.op === 'give'`.
  - `it('tells onTask of seen without an entry')`: Ledge gives, Pim does, Ledge `seen` → last update has `entry` undefined.
  - `it('lists every task to Ledge')`: Max gives Nova (no team) → `run({ op: 'list', by: 'ledge' })` contains it.
  - Rename the existing `onLedgeTask` use at line 148 to `onTask`; every existing `notify` assertion stays as it is.
  - Server test: a seat-to-seat give reaches a connected front as `task.updated`.
- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @paradow/ledge test -- tasks teams-server`.
- [ ] **Step 3: Implement.** In `run('list')`: for Ledge without `team`, every task (`cmd.all` still filters closed ones). In `server.ts`: `onTask: (task, entry) => { broadcast({ type: 'task.updated', task }); if (givenByLedge(task)) for (…) c.followTask?.(…); recordOutgoing(task, entry) }` — `recordOutgoing` is Task 3's; leave the call out until then.
- [ ] **Step 4: Run, verify PASS** (the whole `ledge` suite: `handover.test.ts` and `mobile-gateway.test.ts` must stay green); `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(ledge): every task change reaches the fronts, with its transmission (#92)`

---

### Task 3: History — the sender's outgoing task card

**Files:**
- Modify: `packages/ledge/src/daemon/history.ts` (new public method)
- Modify: `packages/ledge/src/daemon/server.ts` (call it from `onTask`)
- Modify: `packages/ledge/src/mobile/project.ts:114-117` (pass `task`, `team`, `taskOp`, `outgoing` through `pickSet`)
- Test: `packages/ledge/test/history.test.ts`, `packages/ledge/test/handover.test.ts`, `packages/ledge/test/mobile-gateway.test.ts` (or the `project.ts` test)

**Interfaces:**
- Consumes: `TaskTransmission`, `transmissions()`, `onTask(t, entry)` (Tasks 1–2).
- Produces: `History.recordTask(senderId: string, n: { task: Task; tr: TaskTransmission; peer?: string }): ThreadItem` — puts `{ kind: 'notice', id: \`task-${task.id}-${tr.index}\`, at: tr.at, turn: <current turn, no increment>, notice: 'other', task: task.id, taskOp: tr.op, outgoing: true, name: tr.toName, peer?, summary, text }`.
  - `summary`: the title, then on a new line the note (pass), the result (done) or the reason (refuse/cancel), quoted to 200 characters like the pointer.
  - `text`: `Tâche « <title> » confiée à <to>` / `passée à <to>` / `rendue à <to> (terminée)` / `refusée, rendue à <to>` / `annulée pour <to>`.
- Server: on `onTask(task, entry)`, when `entry?.from` is set and is not `ledge`, call `history?.recordTask(entry.from, { task, tr: <the transmission of that entry>, peer: entry.to === 'ledge' ? undefined : entry.to })`.

- [ ] **Step 1: Write the failing tests**
  - `history.test.ts` `it('puts the outgoing card of a task in the sender's thread, without a new turn')`: assert the item above for a give, and `turn` equal to the thread's current turn.
  - `it('replaces, never duplicates, the card of the same transmission')`: two `recordTask` calls with the same `tr.index` → one item.
  - `handover.test.ts`: a relieved session holding two open tasks → its thread holds two `outgoing` notices with `taskOp: 'pass'`, toward the relief.
  - Server: a `seen` change records nothing (thread length unchanged).
  - Mobile projection keeps `task`, `taskOp`, `outgoing` on a notice.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `recordTask`, the server call, the `pickSet` fields.
- [ ] **Step 4: Run, verify PASS** (`pnpm --filter @paradow/ledge test`); `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(ledge): the sender's thread shows the task it handed over (#92)`

---

### Task 4: Fleet — qualify the transmission ids

**Files:**
- Modify: `packages/fleet/src/fleet.ts:85` (`taskOut`)
- Test: `packages/fleet/test/teams-source.test.ts`

**Interfaces:**
- Produces: tasks from `useTasks()` / `fleet.tasks()` whose `log[].from` and `log[].to` are qualified like `giver` / `owner` (`local(id)`: `ledge` unchanged, a session → `qualify('local', id)`).

- [ ] **Step 1: Failing test** `it('qualifies the ids of a task's transmissions')`: a `task.updated` with a give from `max` to `nova` → `fleet.tasks()[0].log[0]` has `from: qualify('local','max')`, `to: qualify('local','nova')`; an entry without them stays without them.
- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @ledge/fleet test -- teams-source`.
- [ ] **Step 3: Implement** in `taskOut`.
- [ ] **Step 4: Run, verify PASS**; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(fleet): qualify task transmissions (#92)`

---

### Task 5: Desktop thread — outgoing card wording and a link to the task

**Files:**
- Modify: `apps/desktop/src/session/NoticeLine.tsx`, `apps/desktop/src/session/Thread.tsx:293`
- Modify: `apps/desktop/src/i18n/fr.ts`, `apps/desktop/src/i18n/en.ts` (`session.notice`)
- Test: `apps/desktop/test/session-thread.test.ts` or a `notice-line.test.tsx` beside it

**Interfaces:**
- Consumes: notice fields `taskOp`, `outgoing` (Task 1).
- Produces: `NoticeLineProps.onOpenTask?(id: string): void`; `Thread.tsx` passes `id => dispatch({ type: 'ledge', tab: 'tasks', task: id })`.
- i18n `session.notice.taskOut: Record<TransmissionOp, (name: string) => string>` — fr: give `Tâche confiée à ${n}`, pass `Tâche passée à ${n}`, done `Tâche rendue à ${n} (terminée)`, refuse `Tâche refusée, rendue à ${n}`, cancel `Tâche annulée pour ${n}`; en: `Task given to`, `Task passed to`, `Task handed back to ${n} (done)`, `Task refused, handed back to`, `Task cancelled for`. `session.notice.seeTask`: `Voir la tâche` / `See the task`.

- [ ] **Step 1: Failing tests**: an outgoing give notice renders the title `Tâche confiée à Nova` and the kicker `TÂCHE`; any notice with `task` shows a « Voir la tâche » button that calls `onOpenTask('t1')`; an incoming one keeps `Tâche de Max`.
- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter desktop test -- notice`.
- [ ] **Step 3: Implement.** Name: `peer?.name ?? item.name`.
- [ ] **Step 4: Run, verify PASS**; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(desktop): the thread's task cards, both sides, open the task (#92)`

---

### Task 6: Desktop atelier — one wire for messages and tasks, a ticket for tasks

**Files:**
- Modify: `apps/desktop/src/atelier/MessageLayer.tsx` (replace `Bubble` + `LedgeWire` + `useRecentLedgeTasks`)
- Modify: `apps/desktop/src/styles/atelier.css` (ticket, task wire colour, reduced/paused rules)
- Modify: `apps/desktop/src/i18n/fr.ts`, `en.ts` (`atelier`); `apps/desktop/src/shell/icons.ts` if a task icon is missing
- Test: `apps/desktop/test/atelier.test.tsx`

**Interfaces:**
- Consumes: `transmissions()`, `TaskTransmission` (Task 1); qualified ids (Task 4).
- Produces (internal to the file):
  - `type End = string | 'desk'` (`'desk'` ⇐ `ledge`), endpoint element: `.ledge-desk` for `'desk'`, else `seatOf(shell, id)`.
  - `function Wire(p: { from: End; to: End | undefined; kind: 'message' | 'task'; label: string; head: ReactNode; text: string; onOpen(): void; still: boolean; layer: RefObject<HTMLDivElement | null> }): JSX.Element | null` — today's `Bubble` geometry, lighting and landing ring, generalised to two `End`s; draws the envelope for `message`, the ticket (`.exchange-ticket`) for `task`; wire class `exchange-wire` plus `task-wire` for a task; bubble class `exchange-bubble` plus `task-bubble`.
  - `function useRecentTransmissions(tasks: readonly Task[]): Array<{ task: Task; tr: TaskTransmission }>` — every transmission under `BUBBLE_MS`, its time the earlier of `tr.at` and its first sight (seen-map keyed `${task.id}#${tr.index}`), re-rendering when the next one ends.
- i18n `atelier.taskTo: Record<TransmissionOp, (n: string) => string>` — fr `Tâche → ${n}`, `Passée → ${n}`, `Terminée → ${n}`, `Refusée → ${n}`, `Annulée → ${n}`; `atelier.taskLabel(op, from, to, title)` — fr e.g. `Max confie « titre » à Nova. Voir la tâche`. `ledgeTaskLabel` goes.
- Bubble text: the note for a pass that has one, else the title. Ticket colour: `var(--sidebar-primary)` (stroke and dashes), body `var(--popover)`.

- [ ] **Step 1: Failing tests** in `atelier.test.tsx`, with the file's existing seat fixtures:
  - `it('draws a ticket from the giver's seat to the owner's for a give between seats')`: `.task-wire` present, `.exchange-ticket` present, no `.exchange-envelope`; bubble text = title, label names both.
  - `it('draws two wires for a give then a pass within 5 s')`: two `.task-wire`.
  - `it('draws a done back to Ledge's desk')`.
  - `it('draws nothing for a transmission 6 s old, nor for a take')`.
  - `it('draws nothing when an endpoint is not on screen, and still draws the others')`.
  - `it('keeps the line but not the ticket when paused or reduced')` + CSS: `.office-reduced .exchange-ticket`, `.office-paused .exchange-ticket` have `display:none`, and the `prefers-reduced-motion` rule covers `.exchange-ticket`.
  - The bubble's click dispatches `{ type: 'ledge', tab: 'tasks', task: id }`.
  - Existing message tests (envelope, ring, lighting) stay green unchanged.
- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter desktop test -- atelier`.
- [ ] **Step 3: Implement**; `MessageLayer` renders messages through `Wire` (`kind: 'message'`) and `useRecentTransmissions(tasks)` through `Wire` (`kind: 'task'`). `Atelier.tsx` keeps passing `teams?.tasks`.
- [ ] **Step 4: Run, verify PASS** (whole desktop suite); `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(desktop): task hand-overs travel the atelier as tickets (#92)`

---

### Task 7: TUI — « Échanges » and the thread

**Files:**
- Modify: `packages/ledge/src/tui/model/overview.ts:88-99` (`exchanges`)
- Modify: `packages/ledge/src/tui/screens/Overview.tsx:196-200`
- Modify: `packages/ledge/src/tui/model/thread.ts:82`
- Test: `packages/ledge/test/tui-model.test.ts` (existing `exchanges` cases at lines 60 and 216)

**Interfaces:**
- Consumes: `transmissions()` (Task 1).
- Produces: `exchanges(...)` rows `{ at, from, to, summary, kind: 'message' | 'task' }`; task rows from every transmission: names = the live session's name (by id, qualified or raw), else `fromName` / `toName`, `ledge` → the `ledge` argument; summary = the title. Messages unchanged plus `kind: 'message'`.
- Overview: a task row's arrow takes another colour (e.g. `C.green`) and a `▣` (or the glyph set's task mark if one exists in `g`) before the summary.
- Thread: an `outgoing` notice prints `it.text`; others as today.

- [ ] **Step 1: Failing tests**: a seat-to-seat give and a pass appear in `exchanges()` mixed with a message, newest first, `kind: 'task'`; a task from an old journal (no `op`) appears not at all; the line-216 case becomes the Ledge give through `transmissions` (`from: 'Ledge'`, `kind: 'task'`); thread model prints the outgoing notice's text.
- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @paradow/ledge test -- tui-model`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, verify PASS** (`pnpm --filter @paradow/ledge test`); `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(ledge): the TUI's exchanges show task hand-overs (#92)`

---

### Task 8: Whole check

- [ ] `pnpm typecheck && pnpm test` from the worktree root → all green.
- [ ] Desktop by eye (the `run` skill): two seats, `ledge task give`, `pass`, `done` from their terminals → three tickets, cards in both threads, « Échanges » in the TUI.
