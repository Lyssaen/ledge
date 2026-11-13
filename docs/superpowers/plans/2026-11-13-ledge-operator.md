# Ledge Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ledge's chat becomes the operator. It records what happens in a SQLite journal, wakes on notable events, and
posts a « point » (a daemon-built turn with actionable items and an agent-written lead sentence). It is also the only
voice of the notch and of the phone's notifications.

**Architecture:**
- The daemon records events in `~/.ledge/ledge.sqlite` (`node:sqlite`).
- A wake scheduler debounces grouped events and runs one fresh, read-only agent run per wake, which writes the lead
  sentence and optional cards.
- The daemon builds the point from the journal and each device's read cursor, and posts it into every chat thread.
- A notification router turns immediate events and points into `operator.state` (notch) and phone pushes.
- The existing chat (`chat/service.ts`), registry (`protocol/actions.ts`) and « À toi » handlers are reused, never bypassed.

**Tech Stack:** TypeScript, Node 24 (`node:sqlite`), zod (`@ledge/protocol`), vitest, React (Desktop, overlay, phone PWA),
Ink (TUI), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-ledge-operator-design.md`. Mockup: `docs/mockups/ledge-operator.html`
(boards 1-7, 9, 10 validated by the owner; board 8 is out of scope).

## Global Constraints

- `packages/ledge/package.json` `engines.node` becomes `>=22.13`; no native dependency added.
- The chat's agent stays read-only with no shell, and never reads the database. Nothing is applied without a click.
  Destructive rows still confirm.
- An immediate event (permission, question, `decision.asked`, urgent/critical rig ask) reaches the notch and phone
  without waiting for any agent run.
- Out of scope: Ledge deciding alone, a `decisions` table, MR/PR discovery, and moving tasks, projects or conversations
  out of JSON.
- Messages between parts are zod schemas in `@ledge/protocol` first. Relative imports end in `.js`. Processes use
  `execFile`/`spawn` with argument lists.
- Every visible text goes through i18n catalogues, in French and English:
  - `apps/overlay` and Desktop: their `t` catalogues;
  - `apps/mobile/src/copy.ts` and `copy.en.ts`;
  - the TUI's strings.
- Code, comments and commits are in English; comments are prose sentences.
- Starting values, as named constants in `packages/ledge/src/operator/constants.ts`:
  - `DEBOUNCE_MS = 60_000`
  - `MIN_WAKE_GAP_MS = 60_000`
  - `MAX_WAKES_PER_HOUR = 30`
  - `STALE_TASK_MS = 30 * 60_000`
  - `RETENTION_DAYS = 30`
  - `LEAD_LINES_MAX = 12`
  - `POINT_ITEMS_MAX = 40`
- Screens follow the mockup exactly. A state the mockup does not show is asked of the owner, not invented. A Desktop
  screen is checked with zoomed Playwright screenshots before it is called done.

## Review Focus

1. **A request answered in the terminal while its wake is running.** The posted point must show it settled with « réglé
   dans le terminal », never with live buttons. Test in Task 6 and Task 8.
2. **The daemon restarts in the middle of a wake.** The interrupted wake is marked `failed` and its events are covered by
   the next wake, without duplicates. Test in Task 1 and Task 8.
3. **The agent run fails, times out, or the harness is not signed in** (common on SSH servers). The point still posts,
   with the daemon's lead sentence. Test in Task 7 and Task 8.
4. **A burst of events** (ten sessions end within 30 s, or a rig restart floods seat-state changes). The user gets
   exactly one point, and the caps hold. Test in Task 8.
5. **A button pressed on an item whose target has changed** (the request has already been answered, or the rig ask is
   closed). Nothing is sent, and the item shows why. Test in Task 10.

---

## File map

| File | Responsibility |
|---|---|
| `packages/protocol/src/operator.ts` (new) | Event kinds, `PointItem`, `ChatPoint`, `OperatorNotice`, `operator.*` / `point.*` messages |
| `packages/protocol/src/chat.ts`, `phone.ts`, `push.ts`, `messages.ts`, `actions.ts` | `ChatTurn.by/point`, phone turn, push kind `point`, message unions, 7 new registry actions |
| `packages/ledge/src/operator/constants.ts` (new) | The constants above |
| `packages/ledge/src/operator/journal.ts` (new) | SQLite: events, reads, wakes |
| `packages/ledge/src/operator/detect.ts` (new) | Pure detectors: state change → events |
| `packages/ledge/src/operator/point.ts` (new) | Pure: events + cursor + live state → `ChatPoint`; settle; fold |
| `packages/ledge/src/operator/lead.ts` (new) | One fresh read-only agent run → lead sentence + action blocks |
| `packages/ledge/src/operator/wakes.ts` (new) | Scheduler: debounce, caps, one at a time, recovery, posting |
| `packages/ledge/src/operator/notices.ts` (new) | Router: `operator.state` notices and phone payloads |
| `packages/ledge/src/operator/index.ts` (new) | `createOperator(deps)`, wired once in `daemon/server.ts` |
| `packages/ledge/src/chat/context.ts`, `chat/service.ts`, `chat/persona.ts`, `chat/threads.ts` | `attentes.md`, `journal.md`, richer `rigs.md`; `postPoint`/`updatePoint`; persona rules |
| `packages/ledge/src/daemon/actions.ts`, `daemon/server.ts` | Resolve/apply of new actions; `point.act`, `point.later`, `operator.read` handlers; wiring |
| `packages/ledge/src/mobile/push/triggers.ts`, `notifier.ts`, `gateway.ts` | `finished` removed, `point` push, phone operations |
| `packages/fleet/src/fleet.ts`, `machines.ts` | Per-machine `operator.state` |
| `packages/ui/src/chat/PointTurn.tsx` (new), `ChatView.tsx` | The point turn (Desktop) |
| `apps/overlay/src/surface/Surface.tsx`, `Bubble.tsx`, `say.ts` | Ledge's voice, point balloon, rig ask balloon |
| `apps/mobile/src/ui/chat/PointTurn.tsx` (new), `TurnView.tsx`, `sw/sw.ts`, settings screen, `copy*.ts` | Phone |
| `packages/ledge/src/tui/model/chat.ts`, `tui/screens/Ask.tsx` | TUI rendering |
| `docs/ledge-guide.md` and the guide source behind `ledge brain @ledge` | The guide |

---

### Task 1: The journal (SQLite)

**Files:**
- Modify: `packages/ledge/package.json` (`engines.node` → `>=22.13`)
- Create: `packages/ledge/src/operator/constants.ts`, `packages/ledge/src/operator/journal.ts`
- Test: `packages/ledge/test/operator/journal.test.ts`

**Interfaces:**
- Produces, in `journal.ts`:
  ```ts
  export type DeviceId = 'desktop' | `device:${string}`;          // same values as ChatThreadId
  export interface JournalEvent { id: number; at: string; machine: string; kind: OperatorEventKind; subjectKind: string;
    subjectId: string; subjectName: string; urgency: 'immediate' | 'grouped' | 'none'; payload: Record<string, unknown>; settledAt: string | null }
  export interface WakeRow { id: number; startedAt: string; endedAt: string | null; firstEvent: number; lastEvent: number;
    outcome: 'posted' | 'empty' | 'failed' | 'cancelled' | null; qids: string[] }
  export interface Journal {
    record(e: Omit<JournalEvent, 'id' | 'settledAt'>): JournalEvent;
    settle(subjectKind: string, subjectId: string, at: string, payload?: Record<string, unknown>): JournalEvent[]; // marks open events of that subject
    since(afterId: number, limit?: number): JournalEvent[];
    open(): JournalEvent[];                                   // unsettled events with urgency !== 'none'
    cursor(device: DeviceId): number; setCursor(device: DeviceId, id: number, at: string): void;  // never moves back
    lastWake(): WakeRow | undefined; startWake(first: number, last: number, at: string): WakeRow;
    endWake(id: number, outcome: NonNullable<WakeRow['outcome']>, qids: string[], at: string): void;
    recover(at: string): WakeRow[];                           // wakes without endedAt → 'failed', returned
    wakesSince(at: string): number;
    prune(now: string): number;                               // drops events older than RETENTION_DAYS
    close(): void;
  }
  export function openJournal(path: string | ':memory:'): Journal;
  ```
- Consumes: `OperatorEventKind` from Task 2. If Task 2 is not done yet, declare it locally and switch to the import in
  Task 2.

- [ ] **Step 1: Write the failing tests** in `journal.test.ts`, each against `openJournal(':memory:')`:
  - `record assigns increasing ids and since(id) returns only later events`;
  - `settle marks every open event of the subject and returns them`;
  - `open() excludes settled and urgency none`;
  - `setCursor never moves a cursor back`;
  - `recover marks unfinished wakes failed and returns them`: start a wake, do not end it, call `recover` → `outcome` is
    `'failed'`, then `lastWake().endedAt` is not null;
  - `prune drops events older than 30 days only`;
  - `schema is versioned`: `PRAGMA user_version` is 1, and opening the same file twice keeps the data. Use a temporary
    file under `os.tmpdir()`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- operator/journal`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `openJournal`** with `new DatabaseSync(path)` from `node:sqlite`:
  - `PRAGMA journal_mode=WAL`;
  - the three tables of spec §1, with `qids` as JSON text;
  - indices on `events(subject_kind, subject_id)` and `events(id)`;
  - prepared statements;
  - schema version 1 via `user_version`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(ledge): operator journal on node:sqlite"`.

### Task 2: Protocol

**Files:**
- Create: `packages/protocol/src/operator.ts` (and export it from the package index)
- Modify: `packages/protocol/src/chat.ts:108-117` (`ChatTurnSchema`), `phone.ts:274` (`PhoneChatTurnSchema`),
  `push.ts:49` (kind enum), `messages.ts` (server and client unions), `phone.ts` (phone operations)
- Test: `packages/protocol/test/operator.test.ts`

**Interfaces:**
- Produces, in `operator.ts`:
  ```ts
  export const OPERATOR_EVENT_KINDS = ['session.request','session.question','session.finished','session.error','session.exited',
    'session.context_full','request.settled','task.opened','task.closed','task.stale','decision.asked','brain.proposed',
    'rig.ask','rig.seat_unreachable','rig.state','rig.goal_update','forge.pipeline_failed','forge.merged'] as const;
  export type OperatorEventKind = typeof OPERATOR_EVENT_KINDS[number];
  export const PointGroupSchema = z.enum(['atoi','done','ongoing','rigs']);
  export const PointRefSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('session.request'), session: z.string(), key: z.string() }),   // key = pendingKey(pending)
    z.object({ kind: z.literal('rig.ask'), qitem: z.string() }),
    z.object({ kind: z.literal('task'), task: z.string() }) ]);                                // decisions and brain proposals are tasks
  export const PointItemSchema = z.object({
    id: z.string(), event: z.number().int(), group: PointGroupSchema,
    tone: z.enum(['perm','ask','work','idle','off']), who: z.string().max(100), rig: z.string().max(100).optional(),
    text: z.string().max(400), sub: z.string().max(200).optional(), at: z.string().datetime(),
    ref: PointRefSchema.optional(),
    answers: z.array(z.object({ id: z.string(), label: z.string().max(60), style: z.enum(['primary','danger','plain']) })).max(4).optional(),
    freeText: z.boolean().optional(),
    nav: z.array(z.object({ kind: z.enum(['session','pr','rig','task']), id: z.string() })).max(2).optional(),
    suggestion: ChatActionSchema.optional(),
    settled: z.object({ at: z.string().datetime(), where: z.enum(['terminal','phone','desktop','chat','elsewhere']), answer: z.string().max(60).optional() }).optional(),
    error: z.string().max(200).optional() });
  export const ChatPointSchema = z.object({ since: z.string().datetime(), lead: z.string().max(300), leadBy: z.enum(['agent','daemon']),
    items: z.array(PointItemSchema).max(40), foldedAt: z.string().datetime().optional(), laterAt: z.string().datetime().optional() });
  export const OperatorNoticeSchema = z.object({ id: z.string(), kind: z.enum(['point','rig.ask']), qid: z.string().optional(),
    text: z.string().max(300), who: z.string().max(100).optional(), rig: z.string().optional(), qitem: z.string().optional(),
    options: z.array(z.object({ id: z.string(), label: z.string().max(60) })).max(3).optional(),
    priority: z.enum(['routine','urgent','critical']), at: z.string().datetime() });
  // Server → front: { type: 'operator.state', notices: OperatorNotice[] }   (broadcast on change and in the snapshot)
  // Front → server: { type: 'point.act', qid, item, answer: { id: string } | { text: string } }
  //                 { type: 'point.later', qid }
  //                 { type: 'operator.read', eventId: number }   (the front's own device: 'desktop' on the PC socket, device:<id> through the gateway)
  ```
- `ChatTurnSchema` gains `by: z.literal('ledge').optional()` and `point: ChatPointSchema.optional()`.
  `PhoneChatTurnSchema` gains the same two fields.
- `PushPayloadSchema.kind` gains `'point'`.
- Phone operations gain `point.act`, `point.later` and `operator.read`, mirroring the client messages.

- [ ] **Step 1: Write the failing tests** in `operator.test.ts`:
  - `a point turn parses with by ledge, an empty question and a point`;
  - `a turn without point still parses`, using an existing fixture turn;
  - `PointItem rejects more than 4 answers`;
  - `OperatorNotice requires a priority`;
  - `PushPayload accepts kind point`;
  - `client message point.act parses with an option id or with text`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/protocol test -- operator`. Expected: FAIL.
- [ ] **Step 3: Implement** the schemas above. An older front ignores the unknown turn fields. Check that the phone
  schema's `max(50)` limits still hold.
- [ ] **Step 4: Run** `pnpm --filter @ledge/protocol test && pnpm typecheck`. Expected: PASS, with no type errors
  anywhere. A new union member may need `default:` branches in exhaustive switches: add them as pass-through.
- [ ] **Step 5: Commit** with `git commit -m "feat(protocol): operator events, point turn, notices"`.

### Task 3: Event detection and recording

**Files:**
- Create: `packages/ledge/src/operator/detect.ts`
- Test: `packages/ledge/test/operator/detect.test.ts`

**Interfaces:**
- Consumes: `Session`, `Task`, `HumanAsk`, `OpenRigState`, `ForgeStateMessage`, `pendingKey` from `@ledge/protocol`;
  `JournalEvent` (Task 1).
- Produces. Each detector is pure and returns zero or more event drafts, of type
  `Draft = Omit<JournalEvent,'id'|'settledAt'|'machine'|'at'>`.
  ```ts
  export function fromSession(before: Session | undefined, after: Session, contextNear: number): Draft[];
  export function settledSession(before: Session | undefined, after: Session): { subjectId: string; where: 'terminal'|'phone'|'desktop'|'chat'|'elsewhere' } | null;
  export function fromTasks(before: readonly Task[], after: readonly Task[], now: number, lastActivity: (sessionId: string) => number | undefined): Draft[];
  export function fromAsks(before: readonly HumanAsk[], after: readonly HumanAsk[]): Draft[];
  export function fromRigs(before: OpenRigState | undefined, after: OpenRigState): Draft[];
  export function fromForge(before: ForgeStateMessage | undefined, after: ForgeStateMessage): Draft[];
  ```
- Subject ids:
  - `session.request` / `session.question`: `subjectId = "<sessionId>#<pendingKey>"`;
  - task events: the task id;
  - `rig.ask`: the qitem id;
  - rig and seat events: `"<rig>/<seat>"`;
  - forge events: the PR id.
- Urgency, as in the spec's table:
  - `rig.ask` is `immediate` when `priority` is `urgent` or `critical`, `grouped` otherwise;
  - `decision.asked` (a task whose owner is Ledge, opened) is `immediate`;
  - `brain.proposed` is a task carrying `brain`.
- `where`: the `Decided.by` the daemon already tracks (`server.ts:1861`) maps to:
  - the hook or the pane → `terminal`;
  - a device → `phone`;
  - the island or Desktop → `desktop`;
  - a chat card → `chat`;
  - unknown → `elsewhere`.

- [ ] **Step 1: Write the failing tests** in `detect.test.ts`:
  - `a new permission makes one immediate session.request with the command in payload`: build it with the same
    session fixtures `mobile/push/triggers` tests use;
  - `working to idle without pending makes session.finished with lastReply text in payload`;
  - `a pending that disappears returns settledSession with the subject id`;
  - `the same pending re-read makes nothing` (dedupe by `pendingKey`);
  - `a task taken with no holder activity for 30 minutes makes one task.stale, once`;
  - `an opened task owned by Ledge makes immediate decision.asked`;
  - `a routine rig ask is grouped, an urgent one immediate`;
  - `a seat that becomes unreachable makes rig.seat_unreachable once`;
  - `tool use, sub-agent and model changes make nothing`;
  - `a failed pipeline on a followed PR makes forge.pipeline_failed`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- operator/detect`. Expected: FAIL.
- [ ] **Step 3: Implement** the detectors. Reuse `pendingKey`, and use the same « new request » test as `pushFor`
  (`triggers.ts`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(ledge): operator event detectors"`.

The wiring into `server.ts` is in Task 8, where the operator object exists.

### Task 4: What the chat reads (`attentes.md`, `journal.md`, a richer `rigs.md`)

**Files:**
- Modify: `packages/ledge/src/chat/context.ts` (`ContextInput`, `writeContext`, `rigsMd`)
- Modify: `packages/ledge/src/chat/persona.ts` (`FIXED`: name the two new files)
- Test: `packages/ledge/test/chat/context.test.ts` (extend it)

**Interfaces:**
- `ContextInput` gains:
  ```ts
  asks?: readonly HumanAsk[];            // attentes.md, OpenRig part
  journal?: readonly JournalEvent[];     // journal.md
  goals?: readonly Goal[];               // rigs.md, Max's open goals
  queue?: ReadonlyMap<string, Array<{ id: string; from: string; to: string; summary: string; state: string }>>;   // rigs.md, per rig, rows not closed
  ```
- `attentes.md` is always written. It lists:
  - every session `pending`, with its text, body and options;
  - every ask, with its id, seat, rig, priority, summary, body and the questions with their options;
  - every open task owned by Ledge, with its detail and options;
  - every brain proposal.

  Each line starts with the id its card needs. When nothing waits, it says so in one line.
- `journal.md`: one line per event, `HH:MM kind subjectName — text`. A finished session also gets
  `reply: reply-<id>.md` when that file exists.
- `rigsMd(st, extra?)`: after the seats, it adds the queue rows not closed, the unreachable seats (`r.nodes` state), what
  each seat's tracked session is doing (state and topic, looked up by seat name in `sessions`), and the open goals
  (id, text, state).

- [ ] **Step 1: Write the failing tests:**
  - `attentes.md lists a rig ask with its qitem id and options`;
  - `attentes.md says nothing waits when empty`;
  - `journal.md lists events in order with the reply file of a finished session`;
  - `rigs.md lists an unreachable seat and an open goal`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- chat/context`. Expected: FAIL.
- [ ] **Step 3: Implement.** `chat/service.ts`'s `run()` passes:
  - `asks: deps.asks?.()`;
  - `goals: deps.goals?.()`;
  - `queue: deps.queue?.()`;
  - `journal: deps.journal?.(thread)`, the events after this thread's cursor, or the open ones.

  These are new optional `ChatDeps` getters, wired in Task 8. The persona's `FIXED` text names `attentes.md` and
  `journal.md` beside `sessions.md`.
- [ ] **Step 4: Run** `pnpm --filter @paradow/ledge test -- chat`. Expected: PASS. The persona snapshot test, if there
  is one, is updated on purpose.
- [ ] **Step 5: Commit** with `git commit -m "feat(ledge): chat reads attentes.md, journal.md, richer rigs.md"`.

### Task 5: Seven new registry actions

**Files:**
- Modify: `packages/protocol/src/actions.ts` (`ACTIONS`, the args schemas, `ActionId`)
- Modify: `packages/ledge/src/daemon/actions.ts` (`resolveAction` cases and `ResolveCtx`)
- Modify: `packages/ledge/src/daemon/server.ts` (the apply handler used by `actFromChat`, near `server.ts:1783`)
- Modify: `packages/ledge/src/mobile/gateway.ts` (the phone `act` mapping for those with `phone: 'act'`)
- Test: `packages/protocol/test/actions.test.ts`, `packages/ledge/test/daemon/actions.test.ts`

**Interfaces.** Ids, args, risk and max are copied from the spec's table:

| id | args | risk | max | phone | apply through |
|---|---|---|---|---|---|
| `rig.answer` | `{ qitem: string, answer: { option: string } \| { text: string } \| { seen: true } }` | `reversible`; `destructive` when the chosen option confirms a launch (`ask.team` and option `confirm`/`launch-rig`) | 4 | `act` | `human.answer(qitem, …)` (`openrigHuman.ts`) |
| `rig.goal` | `{ text: string (1..2000), folder?: absolute path }` | reversible | 1 | null | the goals service send used for `rigs.goal.send` |
| `rig.goal.reply` | `{ goal: string, answer: 'confirm' \| { text: string } }` | `destructive` on `confirm` of a launch, else reversible | 1 | `act` | the goals reply used for `rigs.goal.reply` |
| `rig.send` | `{ rig: RigName, seat: string, text: string (1..4000) }` | reversible | 4 | null | the seat tab's `rig send` path |
| `brain.answer` | `{ task: TaskRef, choice: 'add' \| 'refuse' \| { edit: string } }` | reversible | 4 | `act` | the « À toi » brain answer (`brain.answer` operation) |
| `session.handover` | `{ session: SessionRef }` | reversible | 4 | null | `handovers` from `createHandovers` (`server.ts:574`) |
| `pr.fix` | `{ pr: string, session?: SessionRef }` | reversible | 4 | `act` | the forge's « Demander à X de corriger » handler |

- Each action gets a persona `when` sentence. Outside a wake: only on the user's explicit request (the existing
  pattern). The wake's own prompt (Task 7) allows proposing for reported items.
- `resolveAction` refuses each action with the existing `Refusal` codes:
  - an unknown or closed qitem;
  - a goal that does not exist;
  - a seat not in `rigs.md`;
  - a task that is not a brain proposal;
  - a session that is not live;
  - a PR that is not followed.

- [ ] **Step 1: Write the failing tests:**
  - `each new action parses its example and the persona lists it`;
  - `rig.answer on a closed qitem is refused`;
  - `rig.answer confirm on a team ask is destructive`;
  - `rig.send to an unknown seat is refused`;
  - `session.handover on an exited session is refused`;
  - `pr.fix on a PR not followed is refused`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/protocol test -- actions && pnpm --filter @paradow/ledge test -- daemon/actions`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the registry entries (summary, `when`, example), the resolve cases and the apply handlers.
  `ResolveCtx` gains `asks?: HumanAsk[]`, `goals?: Goal[]` and `prs?: PullRequest[]`.
- [ ] **Step 4: Run** the same commands plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: operator registry actions (rig.answer, rig.goal, rig.goal.reply, rig.send, brain.answer, session.handover, pr.fix)"`.

### Task 6: Building the point

**Files:**
- Create: `packages/ledge/src/operator/point.ts`
- Test: `packages/ledge/test/operator/point.test.ts`

**Interfaces:**
- Consumes: `JournalEvent` (Task 1); `ChatPoint`, `PointItem` (Task 2); live state, i.e. sessions, asks and tasks, to
  drop items already settled and to fill `answers`.
- Produces:
  ```ts
  export interface LiveState { sessions: readonly Session[]; asks: readonly HumanAsk[]; tasks: readonly Task[]; lang: 'fr' | 'en' }
  export function buildPoint(events: readonly JournalEvent[], live: LiveState, since: string, lead: { text: string; by: 'agent'|'daemon' }): ChatPoint;
  export function daemonLead(point: Pick<ChatPoint,'items'|'since'>, lang: 'fr'|'en'): string;   // « 6 choses depuis 13:50 · 2 t'attendent »
  export function settleItem(point: ChatPoint, ref: { subjectKind: string; subjectId: string }, settled: NonNullable<PointItem['settled']>): ChatPoint | null; // null when nothing matched
  export function foldIfDone(point: ChatPoint, at: string): ChatPoint;   // sets foldedAt once every atoi item is settled
  ```
- Grouping and order:
  - `atoi`: requests, questions, `decision.asked`, rig asks, brain proposals. Immediate items first, oldest first.
  - `done`: finished, error, exited, `context_full`, `task.closed`, merged, `pipeline_failed`.
  - `ongoing`: `task.stale`, plus the open tasks the live state holds.
  - `rigs`: seat unreachable, rig state, goal update.
  - Several events of the same subject collapse to its latest one. `request.settled` events never become items.
- Answers, per item kind:
  - a session request: `Refuser` (plain) and `Autoriser` (primary), ids `deny` and `accept`;
  - a question: its options, at most 4, with `freeText: true`;
  - a rig ask: its question's options, at most 4, with `freeText: true`;
  - a decision task: its options, with `freeText: true`;
  - a brain proposal: `Ajouter` and `Refuser`.

  Labels come from a small FR/EN table in `point.ts` (the daemon has no UI catalogue). They match the mockup's words.
- An item whose live target is already gone when the point is built is created already settled, with
  `where: 'elsewhere'`.
- The point holds at most `POINT_ITEMS_MAX` items. Beyond that, the oldest `done` items are dropped first.

- [ ] **Step 1: Write the failing tests:**
  - `groups and orders items as board 1`, with a fixture of 6 events (rig ask, permission, two finished, stale task,
    unreachable seat) → groups `atoi`(2), `done`(2), `ongoing`(1), `rigs`(1);
  - `a request answered before build is created settled elsewhere`;
  - `settleItem marks the matching item with where terminal and leaves others`;
  - `foldIfDone folds only when every atoi item is settled`;
  - `daemonLead counts items and waiting ones in fr and en`;
  - `caps items at 40 dropping oldest done first`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- operator/point`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(ledge): operator point builder"`.

### Task 7: The lead run

**Files:**
- Create: `packages/ledge/src/operator/lead.ts`
- Modify: `packages/ledge/src/chat/service.ts`. Export a helper with the context-writing part of `run()`:
  `export async function writeChatContext(deps: ChatDeps, dir: string, extra: { journal?: JournalEvent[] }): Promise<Context>`.
  `run()` then calls it, so questions and wakes write the same folder.
- Test: `packages/ledge/test/operator/lead.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LeadResult { lead: string | null; blocks: Array<{ id: string; args: unknown }>; error?: string }
  export function runLead(o: { deps: ChatDeps; tool: Tool; events: readonly JournalEvent[]; point: ChatPoint; timeoutMs?: number }): Promise<LeadResult>;
  ```
- The run is always fresh: never the day's resumed session, its own temporary context folder (removed afterwards), and
  the same read-only flags as `runTool` in `service.ts`.
- The prompt is the persona (`buildPersona(tool)`) plus an operator instruction:
  > Ledge wrote the point's items itself (listed below as JSON). Write one sentence of at most 25 words for the notch and
  > the phone, in the user's language, waiting items first. Then optionally `ledge-action` blocks for the items you report
  > (one per item at most, by item id in `args.item`), or one plan.

  At most `LEAD_LINES_MAX` lines in all.
- Blocks are read with the existing `extractProposal` and `parseActionBlock`. A block with an `item` arg becomes that
  item's `suggestion`; the others become the turn's plan card (`actions`). Both are resolved with `resolveAction`, and
  the existing caps apply.
- Any failure (exit code ≠ 0, timeout, empty answer, not signed in) returns `lead: null` with `error`. The caller then
  uses `daemonLead`.

- [ ] **Step 1: Write the failing tests**, with a fake `spawn` as the chat tests use:
  - `returns the first sentence and maps an item block to that item`;
  - `never resumes the day session` (asserts the spawn args have no resume flag);
  - `timeout returns lead null with error`;
  - `an invalid block is dropped with a log, the lead kept`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- operator/lead`. Expected: FAIL.
- [ ] **Step 3: Implement**, including the `writeChatContext` extraction.
- [ ] **Step 4: Run** `pnpm --filter @paradow/ledge test -- operator chat`. Expected: PASS, with the existing chat tests
  unchanged.
- [ ] **Step 5: Commit** with `git commit -m "feat(ledge): operator lead run"`.

### Task 8: The wake scheduler and the daemon wiring

**Files:**
- Create: `packages/ledge/src/operator/wakes.ts`, `packages/ledge/src/operator/index.ts`
- Modify: `packages/ledge/src/chat/service.ts` (`Chat` gains `postPoint`, `updatePoint`, `points`),
  `chat/threads.ts` (`allThreads()` already exists as `all`), `daemon/server.ts` (create and wire the operator)
- Test: `packages/ledge/test/operator/wakes.test.ts`, `packages/ledge/test/operator/operator.test.ts`

**Interfaces:**
- `Chat` gains:
  ```ts
  postPoint(point: ChatPoint, actions: ChatAction[], emit: (m: ChatMessage) => void): string;   // returns the new qid; turn { by:'ledge', question:'', point, actions }
  updatePoint(qid: string, f: (p: ChatPoint) => ChatPoint, emit: (m: ChatMessage) => void): boolean;
  points(): Array<{ qid: string; point: ChatPoint }>;   // today's point turns, newest last
  ```
- `wakes.ts`:
  ```ts
  export interface WakeDeps { journal: Journal; now: () => number; setTimer: (f: () => void, ms: number) => () => void;
    chatIdle: () => Promise<void>; run: (events: JournalEvent[]) => Promise<void> }
  export function createWakes(d: WakeDeps): { onEvent(e: JournalEvent): void; start(): void; stop(): void };
  ```
  - A grouped event arms the debounce `DEBOUNCE_MS` timer if it is not armed.
  - An immediate event arms a zero-delay wake, which still respects `MIN_WAKE_GAP_MS` and the hourly cap.
  - Only one run at a time. Events arriving during a run arm the next wake.
  - A run waits for `chatIdle()` first.
  - Past `MAX_WAKES_PER_HOUR` (`journal.wakesSince(now - 1 h)`), the next wake waits for the next allowed time.
  - `start()` calls `journal.recover()`. If open events exist, it arms a wake.
- `index.ts`:
  ```ts
  export function createOperator(deps: { journal: Journal; machine: string; threads: { all(): Array<[DeviceId, Chat]>; emitterOf(id: DeviceId): ((m: ChatMessage) => void) | undefined };
    live: () => LiveState; tool: () => Tool; chatDeps: ChatDeps; onNotices: (n: OperatorNotice[]) => void; onPointPush: (lead: string, qidByDevice: Map<DeviceId,string>) => void; now?: () => string }):
    { record(d: Draft): void; settle(subjectKind: string, subjectId: string, where: PointItem['settled']['where'], answer?: string): void;
      read(device: DeviceId, eventId: number): void; later(device: DeviceId, qid: string): void; notices(): OperatorNotice[]; start(): void; stop(): void };
  ```
  - A wake's `run(events)` does the following, in order:
    1. `startWake(first, last)`.
    2. `runLead` once, over all events it covers.
    3. For each thread, `buildPoint` over the events after that thread's cursor, plus the still-open ones, with the
       shared lead (or `daemonLead` when the run failed).
    4. `postPoint` into each thread whose point has at least one item.
    5. `endWake('posted' | 'empty' | 'failed', qids)`.
    6. `onPointPush`, then `onNotices`.
  - `settle` calls `journal.settle` and `updatePoint(settleItem…)` then `foldIfDone` on every thread's points, then
    recomputes the notices.
- Wiring in `server.ts`:
  - open the journal at `join(paths().dir, 'ledge.sqlite')`;
  - feed the detectors from `store.onApply` (next to the push wiring at `server.ts:1863`) and from the tasks changes
    (where `chat.followTask` / `notifyDecision` are called);
  - feed them from `human.start`'s listener (`server.ts:336`), the goals push, the OpenRig state read, and the forge
    service `onChange`;
  - `settledSession` → `operator.settle(…, where)`;
  - `chatDeps` getters for Task 4 (`asks`, `goals`, `queue`, `journal`);
  - `journal.prune` at start and daily;
  - `operator.start()` after the threads exist, and `stop()` on shutdown.

- [ ] **Step 1: Write the failing tests:**
  - `wakes.test.ts`, with fake timers:
    - `three grouped events within 60 s make one run covering all three`;
    - `an immediate event runs at once`;
    - `an event during a run arms exactly one more run`;
    - `the 31st wake within an hour waits`;
    - `start recovers an unfinished wake and re-covers its events`;
    - `a run waits for the chat to be idle`.
  - `operator.test.ts`, with an in-memory journal, two fake threads and a fake lead:
    - `posts one point per thread with items from each thread's own cursor`;
    - `lead failure posts with the daemon lead`;
    - `a request settled during the run is posted settled` (settle is called between `runLead` and `buildPoint`, through
      a deferred fake);
    - `ten finishes in 30 s give one point`;
    - `settle updates the posted item and folds the point`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- operator`. Expected: FAIL.
- [ ] **Step 3: Implement** `wakes.ts`, `index.ts`, the `Chat` methods and the `server.ts` wiring.
- [ ] **Step 4: Run** `pnpm --filter @paradow/ledge test && pnpm typecheck`. Expected: PASS. The `hook.test` failures
  under load are known (AGENTS.md).
- [ ] **Step 5: Commit** with `git commit -m "feat(ledge): operator wakes and daemon wiring"`.

### Task 9: Notices, phone pushes, fleet

**Files:**
- Create: `packages/ledge/src/operator/notices.ts`
- Modify:
  - `packages/ledge/src/mobile/push/triggers.ts` (`pushFor`: the `finished` branch removed; request and question titles
    from Ledge);
  - `mobile/push/notifier.ts` (`wanted`: `point` gated by `prefs.notify.finished`, held by a pause; `point` uses
    `urgency 'normal'` and is never `renotify`);
  - `daemon/server.ts` (broadcast `operator.state`; include it in the snapshot; `onPointPush` → `notifier.notify`);
  - `packages/fleet/src/fleet.ts` and `machines.ts` (`operator()` per machine, as `usage()`);
  - `packages/protocol/src/push.ts` (comment for `point`).
- Test: `packages/ledge/test/operator/notices.test.ts`, `packages/ledge/test/mobile/push-triggers.test.ts` (update),
  `packages/ledge/test/mobile/notifier.test.ts` (update), `packages/fleet/test/fleet.test.ts` (extend)

**Interfaces:**
- ```ts
  export function noticesOf(points: Array<{ qid: string; point: ChatPoint; laterAt?: string }>, asks: readonly HumanAsk[], at: string): OperatorNotice[];
  export function pointPush(lead: string, qid: string, badge: number): PushPayload;   // kind 'point', title 'Ledge', body cut to 120, url '/#/chat/<qid>'
  ```
- `noticesOf` returns:
  - the newest unfolded point that has an unsettled `atoi` item, unless the device set it aside with « Plus tard » and
    no newer point exists;
  - every urgent or critical rig ask not settled, with its first question's options (at most 3).

  Session requests are not notices: the notch's request `Bubble` stays fed by sessions (Task 12).
- `FleetClient.operator(): ReadonlyMap<string, OperatorNotice[]>` by machine id. A machine that goes away takes its
  notices with it, the same pattern as `usage` (`fleet.ts:406`).
- The phone URL `/#/chat/<qid>` must match a route of the phone router (`apps/mobile/src/router.ts`). If the route
  needs another shape, use the router's shape and say so in the commit.

- [ ] **Step 1: Write the failing tests:**
  - `noticesOf returns the newest open point and urgent rig asks only`;
  - `a point set aside with later is not a notice until a newer point`;
  - `pushFor no longer returns finished`;
  - `request push title says Ledge and body names the session`;
  - `point push is held by a pause and by notify.finished false`;
  - `fleet keeps operator notices per machine and drops a machine that goes`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- operator/notices mobile/push && pnpm --filter @ledge/fleet test`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat: operator notices for the notch, point push, fleet"`.

### Task 10: Acting on an item, « Plus tard », read cursors

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts` (handlers for `point.act`, `point.later`, `operator.read`),
  `packages/ledge/src/mobile/gateway.ts` (the same three phone operations, with the `rig` passkey rule for
  `rig.answer`-like answers as « À toi » has it)
- Test: `packages/ledge/test/daemon/point-act.test.ts`, `packages/ledge/test/mobile/gateway.test.ts` (extend)

**Interfaces.** `point.act { qid, item, answer }` finds the item in the thread's point. Then:
- An item already settled, or with no `ref`: the error `already settled` is shown on the item, and nothing is sent.
- `ref.kind`:
  - `session.request`: re-check that the session's current `pendingKey` equals `ref.key`, otherwise mark
    `error: 'changed'`. Then decide with the same path as `session.decide`. An accept follows the existing
    confirmation rule: the front shows the same confirm as the card.
  - `rig.ask`: `human.answer(qitem, option | text)`.
  - `task` (decision): the `task.answer` handler. `task` (brain): the brain answer.
- On success, `operator.settle(…, where: 'chat', answer: label)`.
- A suggestion is applied as a one-row card through `actFromChat` on the turn's `actions`: no new path.

`point.later { qid }` sets `laterAt` on that device's point and recomputes the notices. `operator.read { eventId }`
calls `operator.read(device, eventId)`.

- [ ] **Step 1: Write the failing tests:**
  - `answering a request item decides the session and settles the item with where chat`;
  - `answering an item whose request changed sends nothing and marks changed`;
  - `answering a rig ask item calls human.answer with the option id`;
  - `later hides the notice until a newer point`;
  - `operator.read moves only the sender device cursor`;
  - phone: `point.act on a rig ask needs the device passkey like openrig.answer`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- point-act gateway`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(ledge): act on point items, later, read cursors"`.

### Task 11: Desktop, the point turn in the chat panel

**Files:**
- Create: `packages/ui/src/chat/PointTurn.tsx` (+ styles beside the chat's)
- Modify: `packages/ui/src/chat/ChatView.tsx` (render `turn.point` with `PointTurn`, and `by: 'ledge'` turns without a
  user bubble), the UI i18n catalogue
- Modify: `apps/desktop/src/chat/RightTabs.tsx` / `useChatCards.ts` (send `point.act`, `point.later`, `operator.read`;
  the machine label when more than one machine is linked)
- Test: `packages/ui/test/chat/point-turn.test.tsx`, `apps/desktop/e2e/operator-point.spec.ts` (screenshots)

**Interfaces:**
```ts
export function PointTurn(p: { turn: ChatTurn & { point: ChatPoint }; machineName?: string; onAnswer: (item: string, a: { id: string } | { text: string }) => void;
  onNav: (n: NonNullable<PointItem['nav']>[number]) => void; onSuggestion: (item: string) => void; now: number }): JSX.Element;
```
- The layout follows board 1: header (mascot, « Ledge », « de lui-même », time); lead; groups with counts; items with
  their dot tone, who, rig, text, sub and buttons; a settled item shows its receipt line; a folded point shows one line,
  « Tout est réglé depuis HH:MM ». Words are copied from the mockup in both languages.
- `ChatView` sends `operator.read` with the last event id of the newest point when that turn is in view (an
  `IntersectionObserver` on the turn), and when the user opens « À toi » (spec §5). The phone does the same in Task 13
  for its Ledge tab and its « À toi ».

- [ ] **Step 1: Write the failing tests:**
  - `renders groups and counts as board 1`;
  - `a settled item shows réglé dans le terminal and no buttons`;
  - `a folded point is one line`;
  - `clicking Autoriser calls onAnswer with accept`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/ui test -- point-turn`. Expected: FAIL.
- [ ] **Step 3: Implement** `PointTurn` and the `ChatView` and Desktop wiring.
- [ ] **Step 4: Run** `pnpm --filter @ledge/ui test && pnpm --filter desktop test`. Expected: PASS. Then
  `pnpm --filter desktop test:e2e -- operator-point`, which takes zoomed screenshots of the point (light and dark) using
  the e2e fake daemon with a point turn fixture. Compare them with board 1, alignment included, and fix until they match.
- [ ] **Step 5: Commit** with `git commit -m "feat(desktop): the operator point in the chat panel"`.

### Task 12: The notch, Ledge's single voice

**Files:**
- Modify: `apps/overlay/src/surface/Surface.tsx:573-576` (say candidates), `Bubble.tsx` (heading),
  `apps/overlay/src/surface/say.ts` (`SayKind` gains `point` and `rigask`), the overlay i18n catalogue
- Test: `apps/overlay/test/say.test.ts` (extend), `apps/overlay/test/bubble.test.tsx` (extend), the overlay e2e or
  mockup shots used by `docs/mockups/notch-activity`

**Interfaces and behaviour (board 6):**
- The request `Bubble` keeps its data and buttons. Its heading becomes Ledge's sentence: the Ledge mark, then
  « **<name>** veut lancer `<command>` » for a permission and « **<name>** te demande : … » for a question. It no longer
  says « <name> attend votre accord ». The sentence helper sits in `say.ts`:
  `export function ledgeSentence(s: Session, t: Copy): { who: string; rest: string }`.
- Notices from `client.fleet.operator()`, merged across machines:
  - `point` → the balloon with the notice text, « Plus tard » (sends `point.later`) and « Voir le point » (opens the
    Desktop chat panel at that qid through the existing open-chat path);
  - `rig.ask` → the balloon with its options (at most 3, `point.act` with the option id; it needs the qid of the point
    holding that ask, carried in `notice.qid`).
- Priority, the most urgent first: request (existing `approval`/`question`) > urgent `rigask` > `point` > `ledge`
  (unread reply). Within a kind, the newest wins, whatever the machine.
- The activity line and the music cover are unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `say.test`: `rigask outranks point, point outranks ledge, approval outranks all`;
  - `bubble.test`: `a permission heading reads as Ledge's sentence with the session name in bold`;
  - `bubble.test`: `a point notice shows Plus tard and Voir le point`.
- [ ] **Step 2: Run** `pnpm --filter overlay test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter overlay test`. Expected: PASS. Then take screenshots of the four states of board 6
  (calm, permission, point, rig ask) in light and dark, compare them with the mockup, and fix until they match.
- [ ] **Step 5: Commit** with `git commit -m "feat(overlay): Ledge is the notch's only voice"`.

### Task 13: Phone, point turn, push, setting

**Files:**
- Create: `apps/mobile/src/ui/chat/PointTurn.tsx`
- Modify:
  - `apps/mobile/src/ui/chat/TurnView.tsx` (point turns);
  - `apps/mobile/src/state/chat.ts` (send `point.act`, `point.later`, `operator.read`);
  - `apps/mobile/src/sw/sw.ts:202-218` (accept `point`; title « Ledge »; `renotify` false for `point`);
  - the settings screen that renders `notify.finished`;
  - `apps/mobile/src/copy.ts:756` and `copy.en.ts` (`finished` label → « Le point de Ledge », hint « Quand Ledge fait le
    point : sessions finies, tâches, nouvelles des rigs. »; pause hint « Aucune notification sur cet appareil pendant ce
    temps, le point compris. »).
- Test: `apps/mobile/test/point-turn.test.tsx`, `apps/mobile/test/sw.test.ts` (extend if present), `apps/mobile/e2e/push.spec.ts` (extend)

**Interfaces:** the phone's `PointTurn` takes the same props as Desktop's, in the compact form of board 7. An answer to a
rig ask goes through the device verification, like « À toi ». The stored pref key stays `notify.finished`. Only its
label and hint change, so no migration is needed.

- [ ] **Step 1: Write the failing tests:**
  - `renders the compact point of board 7`;
  - `answering a rig ask item asks for verification`;
  - `sw shows a point push titled Ledge`;
  - `settings show Le point de Ledge with its hint`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @ledge/mobile test && pnpm --filter @ledge/mobile test:e2e -- push`. Expected: PASS.
  Compare screenshots of the Ledge tab and of Réglages with boards 7 and 10.
- [ ] **Step 5: Commit** with `git commit -m "feat(mobile): operator point, Ledge push, « Le point de Ledge » setting"`.

### Task 14: TUI and the guide

**Files:**
- Modify: `packages/ledge/src/tui/model/chat.ts`, `packages/ledge/src/tui/screens/Ask.tsx` (render a point turn as
  groups of lines, with answers as the existing action box choices)
- Modify: `docs/ledge-guide.md` and the guide source `ledge brain @ledge` reads (`chat/guide.ts` names it)
- Test: `packages/ledge/test/tui/chat-model.test.ts` (extend), the guide test that checks every screen is in the guide

**Interfaces:**
- `chatLines(turn)` (or the model's existing turn-to-lines function) handles `turn.point`: lead, then
  `GROUP (n)` headings and one line per item, `✓ réglé dans le terminal` for a settled one.
- Answering from the TUI sends `point.act`.
- The guide gains a section « Ledge, l'opérateur » that covers:
  - the point and when it comes;
  - what wakes Ledge;
  - that only Ledge speaks in the notch;
  - « Plus tard »;
  - the phone setting « Le point de Ledge ».

  The chat section loses « lit et ne touche à rien » only where it is no longer exact. Ledge still never acts without a
  click.

- [ ] **Step 1: Write the failing tests:**
  - `a point turn renders its groups and a settled receipt`;
  - the existing guide coverage test, which must still pass after the edit.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge test -- tui guide`. Expected: FAIL for the point rendering.
- [ ] **Step 3: Implement** the rendering and write the guide text.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS, apart from the known `hook.test` under load.
- [ ] **Step 5: Commit** with `git commit -m "feat(tui): point turns; docs: the operator in the guide"`.
