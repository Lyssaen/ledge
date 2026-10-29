# The agent's checklist on the phone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone shows each agent's work plan: progress on its row in « Agents », the full checklist on its session screen.

**Architecture:** Desktop's todo parser moves to `packages/protocol/src/todos.ts`. The phone gateway keeps, per session, the
main thread's latest checklist (computed from `deps.thread(id)` with `latestTodos`, capped by a projection), sends a
summary on each phone session and the full list in a new `session.checklist` message, and pushes them only when they
change. The PWA reads both behind the `daemon.checklist` flag.

**Tech Stack:** TypeScript, zod (`@ledge/protocol`), vitest, React + Tailwind tokens (`apps/mobile`).

**Spec:** `docs/superpowers/specs/2026-10-29-mobile-model-checklist-design.md` (§3.1, and §3.3 « Shared parser », « Which
checklist », « Push rate », « Compatibility »). Mockups: `.superpowers/design/model-checklist/AgentsProgress.dc.html`,
`SessionChecklist.dc.html` (main checkout, untracked).

## Global Constraints

- Desktop keeps its behaviour exactly: its todo tests pass with only their import line changed.
- Main thread only (items without `helperId`); the latest readable update wins; an empty update means no checklist; no history, no checklist.
- Several tasks in progress: the first one is « current ». OMP blocked tasks count as not done (the parser already says the blocker in the text).
- Caps on the phone side of the gateway: `CHECKLIST_TASKS_MAX = 50` tasks, `CHECKLIST_TEXT_MAX = 200` characters per text, with `clip` from `project.ts`; `cut: true` when anything was dropped or shortened.
- `done` and `total` count the whole list, before the cap.
- Push rate: `session.updated` for a checklist change only when `done`, `total` or `current` changes; never once per thread item.
- Compatibility: every new phone field is optional; the snapshot's `daemon.checklist: true` announces the feature; the PWA shows nothing without it. An older PWA drops the unknown `session.checklist` message (`channel.ts` keeps only messages that parse).
- Code, comments, test names, commits in English, in the surrounding style (short `/** */` docs, terse names). Phone copy in French.
- Shared files with Nils (`phone.ts`, `gateway.ts`, `project.ts`, `copy.ts`, `Agents.tsx`, `Thread.tsx`): additive, local edits only.

## Review Focus

1. A checklist whose task in progress is longer than 200 characters: the row shows it clipped, nothing overflows (Task 3 test « clips the current task »).
2. More than 50 tasks: the list stops at 50, the counts stay true (7/80), `cut` set (Task 3 test « caps a long checklist »).
3. A subagent writing its own TodoWrite: the main session's progress does not move (Task 3 gateway test « ignores a subagent's update »).
4. A device that connects after updates arrived while no device followed: it gets the latest list, not a stale cached one (Task 3 gateway test « recomputes after a time with no follower »).
5. Two tasks with the same text in the full list: both render (React keys stay unique) (Task 5 test « repeated texts both show »).

---

### Task 1: Shared todo parser in protocol

**Files:**
- Create: `packages/protocol/src/todos.ts` (moved verbatim from `apps/desktop/src/session/todos.ts`)
- Modify: `packages/protocol/src/index.ts` (add `export * from './todos.js';`)
- Delete: `apps/desktop/src/session/todos.ts`
- Modify imports to `@ledge/protocol`: `apps/desktop/src/session/{ActionGroup.tsx,exchanges.ts,TodoBar.tsx,SessionPage.tsx}`, `apps/desktop/src/i18n/fr.ts`, `apps/desktop/test/session-todos.test.ts` (import line only)
- Test: `packages/protocol/test/todos.test.ts`

**Interfaces:**
- Produces (from `@ledge/protocol`): `type TodoStatus = 'pending' | 'in_progress' | 'completed'`, `interface Todo { text: string; status: TodoStatus }`, `TODO_TOOLS: ReadonlySet<string>`, `todosOf(t: ToolItem): Todo[] | null`, `latestTodos(items: readonly ThreadItem[], helperId?: string): Todo[] | null`, `doneCount(todos: readonly Todo[]): number`.

- [ ] **Step 1:** Check no name clash: `grep -rn "Todo\b\|TodoStatus\|doneCount\|latestTodos\|TODO_TOOLS" packages/protocol/src` returns nothing.
- [ ] **Step 2: Write `packages/protocol/test/todos.test.ts`** — a small parity suite on the moved functions (the full behaviour stays covered by Desktop's tests): `latestTodos` reads a TodoWrite (in progress → `activeForm`), an `update_plan`, an OMP `todo` with two phases and a blocked task (`'Build · Ship (blocked: CI)'`, status `pending`); skips an item with `helperId: 'h1'` unless asked for `'h1'`; an empty later update gives `null`; an unreadable later update (`input: '{'`) keeps the earlier list; `doneCount` counts `completed`.
- [ ] **Step 3:** Run `pnpm --filter @ledge/protocol exec vitest run test/todos.test.ts` → FAIL (module missing).
- [ ] **Step 4:** `git mv apps/desktop/src/session/todos.ts packages/protocol/src/todos.ts`; fix its `@ledge/protocol` type import to the local `./thread.js`; export it from the index; repoint the six Desktop imports.
- [ ] **Step 5:** Run `pnpm --filter @ledge/protocol test`, `pnpm --filter @ledge/protocol typecheck`, then from `apps/desktop`: `pnpm exec vitest run test/session-todos.test.ts test/session-todos.test.tsx` and `pnpm typecheck` → all PASS.
- [ ] **Step 6: Commit** `refactor(protocol): move the todo parser to protocol, shared by Desktop and the daemon`

### Task 2: Phone schemas for the checklist

**Files:**
- Modify: `packages/protocol/src/phone.ts` (constants near `THREAD_*`; `PhoneSessionSchema` extend; snapshot `daemon`; server message union)
- Test: `packages/protocol/test/phone.test.ts`

**Interfaces:**
- Produces:
  - `CHECKLIST_TASKS_MAX = 50`, `CHECKLIST_TEXT_MAX = 200`
  - `PhoneChecklistSchema = z.object({ tasks: z.array(z.object({ text: z.string().max(CHECKLIST_TEXT_MAX), status: z.enum(['pending','in_progress','completed']) })).max(CHECKLIST_TASKS_MAX), done: nonneg int, total: nonneg int, cut: z.literal(true).optional() })`, `type PhoneChecklist`
  - `PhoneChecklistSummarySchema = z.object({ done, total, current: z.string().max(CHECKLIST_TEXT_MAX).optional(), cut: z.literal(true).optional() })`, `type PhoneChecklistSummary`
  - `PhoneSession.checklist?: PhoneChecklistSummary` (absent: no checklist)
  - snapshot `daemon.checklist?: true`
  - server message `{ type: 'session.checklist', id: string, checklist: PhoneChecklist | null }`

- [ ] **Step 1: Write tests** in `phone.test.ts`: a session with `checklist: { done: 2, total: 5, current: 'Write the test' }` parses and keeps it; one without parses; a summary `current` of 201 chars fails; `{ type: 'session.checklist', id: 'a', checklist: null }` parses; one with 51 tasks fails; a snapshot with `daemon.checklist: true` parses and one without still parses.
- [ ] **Step 2:** Run `pnpm --filter @ledge/protocol exec vitest run test/phone.test.ts` → FAIL.
- [ ] **Step 3:** Add the schemas (status enum built from the same values as `TodoStatus`; doc comments say summary = what « Agents » shows, list = what the session screen shows, `cut` = capped by the gateway).
- [ ] **Step 4:** Run `pnpm --filter @ledge/protocol test && pnpm --filter @ledge/protocol typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(protocol): phone checklist summary, list and capability flag`

### Task 3: The daemon computes and pushes the checklist

**Files:**
- Modify: `packages/ledge/src/mobile/project.ts` (`toPhoneChecklist`, `checklistSummary`, `toPhoneSession` third parameter)
- Modify: `packages/ledge/src/mobile/gateway.ts` (cache, `projected`, snapshot flag, `case 'session.thread'`, `forward`, `removed`)
- Test: `packages/ledge/test/mobile-project.test.ts`, new `packages/ledge/test/mobile-checklist.test.ts` (gateway; reuse `setup`/`flush` from `test/helpers/gateway.ts`, adding a way to put items in its `threads` map and to read it if the helper lacks one)

**Interfaces:**
- Consumes: Task 1 `latestTodos`, `TODO_TOOLS`, `Todo`; Task 2 schemas and constants.
- Produces:
  - `toPhoneChecklist(todos: readonly Todo[] | null): PhoneChecklist | null` — `null` for `null`; tasks sliced to `CHECKLIST_TASKS_MAX`, each text `clip`ped to `CHECKLIST_TEXT_MAX`; `done`/`total` from the whole list; `cut: true` if any slice or clip.
  - `checklistSummary(todos: readonly Todo[] | null): PhoneChecklistSummary | undefined` — from the whole list: `current` = first `in_progress` task's text clipped; `cut` as above. (Taking `Todo[]`, not the capped list, so a current task past the 50th still shows.)
  - `toPhoneSession(s, readAt, checklist?: PhoneChecklistSummary)` — adds `checklist` when given.

Gateway behaviour:
- `const checklists = new Map<string, { list: PhoneChecklist | null; summary: PhoneChecklistSummary | undefined }>()`, filled lazily by `checklistOf(id)` from `latestTodos(deps.thread(id) ?? [])`.
- `projected` passes `checklistOf(s.id).summary`. The snapshot's `daemon` gets `checklist: true` always.
- `case 'session.thread'`: after the thread, `push(deviceId, { type: 'session.checklist', id, checklist: checklistOf(id).list }, \`session.checklist:${id}\`)`.
- `forward`: with no follower, `checklists.clear()` before returning (nothing kept for nobody). On `session.thread.item` whose item is a `tool` without `helperId` and with `TODO_TOOLS.has(item.tool)`, and only if `checklists.has(id)`: recompute; if the list changed (compare with `JSON.stringify`), push `session.checklist` to watchers of `id`; if the summary's `done`/`total`/`current`/`cut` changed and `live(id)`, push `session.updated` (projected, key `session.updated:${id}`) to subscribed followers. Then the existing item forwarding.
- `removed(id)` deletes the entry.

- [ ] **Step 1: Write project tests** (`mobile-project.test.ts`): `toPhoneChecklist(null)` is `null`; 80 tasks (3 completed) → 50 tasks, `done: 3, total: 80, cut: true`; a 300-char text → 200 chars, `cut: true`; `checklistSummary` of `[completed, in_progress A, in_progress B, pending]` → `{ done: 1, total: 4, current: A }`; all completed → no `current`; « clips the current task »: 300-char in progress → `current.length === 200`, `cut: true`; `checklistSummary(null)` is `undefined`; `toPhoneSession(s, T0)` has no `checklist` key.
- [ ] **Step 2: Write gateway tests** (`mobile-checklist.test.ts`), TodoWrite items built as `{ kind: 'tool', id, at, turn: 1, tool: 'TodoWrite', input: JSON.stringify({ todos }) , ... }` (match `ToolItem`'s required fields):
  - the snapshot says `daemon.checklist: true`; a session whose thread has a TodoWrite carries `checklist: { done, total, current }`; one without has no `checklist`.
  - « the summary follows the latest update »: forward a new TodoWrite item (after adding it to the thread, as history does) → one `session.updated` with the new summary.
  - an update that changes only a pending task's text: no `session.updated`; a watcher gets `session.checklist` with the new text.
  - an empty update → `session.updated` without `checklist`, watcher gets `checklist: null`.
  - « ignores a subagent's update »: a TodoWrite with `helperId: 'h1'` → nothing pushed, summary unchanged.
  - `session.thread` answers the thread then `session.checklist` with the whole capped list.
  - « recomputes after a time with no follower »: snapshot, device leaves (or a gateway with no follower), thread gains an update and it is forwarded, device asks a snapshot → the new summary.
  - parity: the `session.checklist` tasks equal `latestTodos(thread)` from `@ledge/protocol` for the same thread (daemon and Desktop give the same list).
- [ ] **Step 3:** Run `pnpm --filter ledge exec vitest run test/mobile-project.test.ts test/mobile-checklist.test.ts` (check the package name in `packages/ledge/package.json`) → FAIL.
- [ ] **Step 4:** Implement in `project.ts`, then `gateway.ts` as described.
- [ ] **Step 5:** Run the two files, then the whole `packages/ledge` suite and its typecheck → PASS (existing snapshot assertions using `toMatchObject` keep passing; fix any `toEqual` on `daemon` by adding `checklist: true`).
- [ ] **Step 6: Commit** `feat(ledge): the gateway sends each session's checklist to the phone`

### Task 4: Progress on the « Agents » row

**Files:**
- Modify: `apps/mobile/src/state/store.ts` (`daemon` type gets `checklist?: true`; new `checklists: Map<string, PhoneChecklist | null>` filled by `session.checklist`, emptied of a removed session, not cached)
- Modify: `apps/mobile/src/model/agents.ts` (`AgentRow.progress?: { done: number; total: number; current?: string }`, from `s.checklist`)
- Modify: `apps/mobile/src/screens/Agents.tsx` (row rendering, gated on `daemon?.checklist`)
- Modify: `apps/mobile/src/copy.ts` (new `checklist` block, used by Tasks 4–5)
- Test: `apps/mobile/test/model/agents.test.ts`, `apps/mobile/test/screens/agents.test.tsx`, `apps/mobile/test/state/store.test.ts`

**Interfaces:**
- Consumes: Task 2 types.
- Produces: `MobileState.checklists`; `copy.checklist = { title: 'Plan de travail', allDone: 'Tout est fait', paused: 'En pause', progress: (done: number, total: number) => \`${done} sur ${total} tâches faites\`, box: { completed: 'Fait', in_progress: 'En cours', pending: 'À faire' }, cut: 'Liste raccourcie : la suite est sur le PC' }`; a shared `PlanIcon` (paths `M9 4h6v3H9z`, `M7 5H5v16h14V5h-2`, `m9 12 1.5 1.5L14 10`, `M9 17h6`) added where the app keeps its icons.

Look (AgentsProgress mockup): on the tag line, after `<Tag>`: plan icon, mono `done/total`, a 40×4 bar (track `bg-raised`, fill `bg-ok`, width `done/total`), `aria-label={copy.checklist.progress(done, total)}`. Under it, when `current`: 12px muted line, a 6px `bg-info` dot, text truncated with an ellipsis on one line.

- [ ] **Step 1: Write tests:** model — a session with `checklist: { done: 3, total: 7, current: 'Ajout du test' }` gives `progress` equal to it; without, no `progress` key. Screen — with `daemon.checklist`: row shows `3/7`, the label « 3 sur 7 tâches faites », the current task; all done (`7/7`, no current): shows `7/7` and no current line; no checklist: neither; same session from a daemon without the flag: nothing. Store — `session.checklist` sets `checklists.get('a')`, `null` keeps an entry `null`, `session.removed` drops it.
- [ ] **Step 2:** Run `pnpm --filter @ledge/mobile exec vitest run test/model/agents.test.ts test/screens/agents.test.tsx test/state/store.test.ts` (check the package name) → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the files, the mobile suite and its typecheck → PASS.
- [ ] **Step 5: Commit** `feat(mobile): the agent's progress on its row in Agents`

### Task 5: The checklist on the session screen

**Files:**
- Create: `apps/mobile/src/screens/Checklist.tsx`
- Modify: `apps/mobile/src/screens/Thread.tsx` (render it at the top of `main`, sticky, when `daemon?.checklist` and `checklists.get(sessionId)` is a list)
- Test: `apps/mobile/test/screens/checklist.test.tsx`

**Interfaces:**
- Consumes: Task 2 `PhoneChecklist`; Task 4 `copy.checklist`, `PlanIcon`, `MobileState.checklists`.
- Produces: `Checklist({ checklist }: { checklist: PhoneChecklist }): JSX.Element`, folded by default (local `useState`), as Desktop's TodoBar.

Look (SessionChecklist mockup, Desktop `TodoBar.tsx` for behaviour): a `button` head with `aria-expanded`, line 1: plan icon, « Plan de travail », mono `done/total`, 64px bar, chevron; line 2: the first `in_progress` task with a blue dot, else « Tout est fait » when `done === total`, else « En pause ». Unfolded: an `ol` of boxes (✓ green for completed, a blue spinner — static under `prefers-reduced-motion` — for in progress, empty for pending; `role="img"` + `aria-label` from `copy.checklist.box`), completed texts struck through and muted; when `cut`, a muted last line `copy.checklist.cut`. Keys as TodoBar does (text, then `#n` for repeats).

- [ ] **Step 1: Write tests:** folded by default: head shows « Plan de travail », `3/7`, the current task, no list items; click → `aria-expanded="true"` and 7 items with the right box labels; click again folds; all done → « Tout est fait »; none in progress and not all done → « En pause »; `cut` → the cut line when open; « repeated texts both show »: two pending « Lint » → two items. Thread screen (in `thread.test.tsx`): with the flag, delivering `{ type: 'session.checklist', id: 'a', checklist }` shows the head; `checklist: null` shows none; without the flag, none.
- [ ] **Step 2:** Run `pnpm --filter @ledge/mobile exec vitest run test/screens/checklist.test.tsx test/screens/thread.test.tsx` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the files, the mobile suite, typecheck, and the mobile build (`pnpm --filter @ledge/mobile build`) → PASS.
- [ ] **Step 5: Commit** `feat(mobile): the agent's checklist on its session screen`

### Task 6: Whole-branch verification

- [ ] `pnpm -r typecheck` → PASS.
- [ ] `pnpm -r --no-bail --workspace-concurrency=1 test` → only the known Desktop failures (thread-images « a turn with attachments… », session-conversation « a reconnect asks Nova's thread again… », timing-flaky) may fail; anything else is ours to fix.
- [ ] From `apps/desktop`: `pnpm exec playwright test` for the session todo bar specs (`grep -ln todo e2e`), since Desktop's parser moved.
- [ ] Lint if the repo defines it (`grep -n '"lint"' package.json apps/*/package.json packages/*/package.json`).
