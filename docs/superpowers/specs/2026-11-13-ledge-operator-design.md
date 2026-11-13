# Ledge operator: the chat follows projects and rigs, speaks first, and is the notch's only voice

Date: 2026-11-13. Status: in review. Mockup: `docs/mockups/ledge-operator.html`, validated by the user on 2026-11-13
(artifact https://claude.ai/artifact/URB96fWDGBGQwpa1PNuyeu, boards 1-7 and 9; board 8 is out of scope).

## Why

Today Ledge's chat is a read-only assistant that answers when asked. The user wants it to be **the operator** of their
projects and rigs: the one place that tells them what happened, what waits on them, and what to do next, with everything
integrated (pending questions of sessions and rigs, finished sessions, tasks in progress, rig health, Max's answers).
It also becomes **the only voice of the notch** and of the phone's notifications: no more one balloon per session.

Max (`operator-agent@kernel`) stays OpenRig's team dispatcher. Ledge hands goals to Max and shows Max's proposals; it never
composes a team itself (`docs/vision/ledge-human-operator.md`, direction A+B).

## Goals

1. **The point** (« Le point »): the chat posts, unasked, what changed since the user last looked, grouped as À toi /
   Terminé / En cours / Rigs, each line actionable in place (mockup board 1).
2. **Wakes**: notable events wake the chat; events close in time make one message (board 2). Urgent things never wait on
   the agent.
3. **Full integration** in what the chat reads and proposes: session requests and questions, OpenRig asks (full text and
   options), decisions sessions ask the user (`ledge task give ledge`), brain proposals, finished/errored sessions with their
   last reply, tasks with time since last sign of life, rigs with queue, unreachable seats and goals (boards 3-5).
4. **Notch and phone**: only Ledge speaks; a permission is still immediate; a point is grouped (boards 6-7).

## Non-goals

- **Ledge deciding alone** (board 8, « niveau 3 »): not in this work. It comes after the point and wakes have run for a few
  days. The `decisions` table is not created now.
- MR/PR discovery beyond what exists (the user will refine it later).
- Migrating tasks, projects or chat conversations out of their JSON files.
- Replacing Max, the kernel TUI, or « À toi » (which stays the exhaustive list).

## Anti-goals (a failure even if it works)

- The agent of the chat gains write access, a shell, or reads the database directly.
- Any action applied without the user's click on a card (unchanged rule; destructive rows still confirm).
- A permission request delayed by an LLM run before it reaches the notch or the phone.
- Noise: the notch or phone speaking for tool calls, sub-agents, thinking, or once per session when several finish together.

## Constraints

- Daemon: Node `>=22` today (`packages/ledge/package.json`); `node:sqlite` needs 22.13 unflagged: raise `engines` to
  `>=22.13`. No native dependency (global npm install on WSL and SSH servers must stay simple).
- The chat runs per question through its harness (`packages/ledge/src/chat/run.ts`, `claude.ts`, `codex.ts`, `cursor.ts`,
  `omp.ts`) with read-only tools, reading a context folder written by `chat/context.ts`. Actions come from the registry
  `packages/protocol/src/actions.ts`, applied by `chat/act.ts`; the persona is generated from it (`chat/persona.ts`).
- One daemon per machine; remote daemons hold no projects (context.ts). The point is per machine; the multi-machine router
  (`chat/routing.ts`) is unchanged.
- OpenRig stays the source of truth for its queue and asks: read through its API (`daemon/openrigHuman.ts`,
  `daemon/openrigGoals.ts`), never copied into Ledge's database beyond event records.

## Approaches considered

1. **Enrich the reactive chat only** (more context files, more actions). Cheap, but the chat never speaks first: it does
   not meet goals 1, 2 and 4.
2. **Event-driven wakes of the existing per-question chat** (chosen). The daemon records events in a SQLite journal and,
   on notable ones, runs the same read-only chat with an operator prompt; the result is an ordinary chat turn with cards.
   Keeps every safety property of today's chat; adds a journal, a wake scheduler and a notification router.
3. **A permanently running operator session** (a Ledge session with a shell and the `ledge` CLI). Most capable, but breaks
   the « reads, never touches » rule that is the chat's protection, and is harness-specific. Rejected.

## Design

### 1. The journal (SQLite)

File `~/.ledge/ledge.sqlite`, opened by the daemon with `node:sqlite`, WAL mode, schema versioned by `PRAGMA user_version`.

- `events(id INTEGER PRIMARY KEY, at TEXT, machine TEXT, kind TEXT, subject_kind TEXT, subject_id TEXT, subject_name TEXT,
  urgency TEXT, payload TEXT /* JSON */, settled_at TEXT NULL)`. Kept 30 days, pruned at start and daily.
- `reads(device TEXT PRIMARY KEY, last_event_id INTEGER, at TEXT)`: how far each front (the PC's Desktop, each phone) has
  read. « Since you last looked » = events after the cursor of the device that is looking.
- `wakes(id INTEGER PRIMARY KEY, started_at TEXT, ended_at TEXT NULL, first_event INTEGER, last_event INTEGER,
  outcome TEXT /* posted|empty|failed|cancelled */, qid TEXT NULL)`: each operator run, the events it covered. On start, a
  wake left without `ended_at` is marked `failed` and its events are covered again by the next wake.

Event kinds (each with its source, already observable in the daemon):

| kind | source | urgency |
|---|---|---|
| `session.request` (permission, diff, plan) / `session.question` | session `pending` appears (same detection as `mobile/push/triggers.ts` `pushFor`) | immediate |
| `session.finished` | `working` → `idle` without pending | grouped |
| `session.error` / `session.exited` | state `error`, session ended | grouped |
| `session.context_full` | context past the user's threshold, or ended on a full context | grouped |
| `request.settled` | a pending request disappears (answered anywhere) | none (marks the request's event `settled_at`) |
| `task.opened` / `task.closed` / `task.stale` | tasks store; `stale` = taken and no activity of its holder for 30 min | grouped |
| `decision.asked` | a task given to `ledge` (a session's decision for the user) | immediate |
| `brain.proposed` | `ledge brain propose` / `flag` | grouped |
| `rig.ask` | new row in OpenRig `/api/attention`; `priority` urgent/critical → immediate, else grouped | immediate/grouped |
| `rig.seat_unreachable` / `rig.state` | OpenRig state read (seat or rig unreachable, rig stopped unexpectedly) | grouped |
| `rig.goal_update` | Max proposes a team or asks, via `openrigGoals` | grouped |
| `forge.pipeline_failed` / `forge.merged` | the existing forge service state change | grouped |

Never events: tool lines, thinking, sub-agents, model changes (they stay in the notch's activity line).

### 2. Wakes

- **Immediate** events: the daemon itself notifies at once (section 4) with a deterministic sentence, and schedules a wake
  so the agent folds the line into the point.
- **Grouped** events: a wake fires 60 s after the first unhandled grouped event (debounce window), covering everything
  unhandled at that moment.
- One wake at a time per machine. A wake that starts while the user is asking a question waits for the question to end.
- A wake runs the chat with the user's chat harness and model (« Agent par défaut »), the same read-only flags, the same
  context folder plus `journal.md` and `attentes.md`, and an operator instruction: « write the point of these events,
  waiting items first, at most N lines, propose cards only from the registry ». Its answer becomes a chat turn tagged
  `by: 'ledge'` (no user question), with its cards, persisted like any turn (`chat/conversations.ts`).
- A wake whose events are all settled by the time it runs posts nothing (`outcome: empty`).
- Turn persistence: the operator's turns count in `HISTORY_MAX` like others.

Cost guard: at most one wake per 60 s per machine, and at most 30 wakes per hour; beyond, events wait for the next allowed
wake (one message then covers them).

### 3. What the chat reads and proposes

New context files (written by `chat/context.ts` for questions and wakes alike):

- `attentes.md`: everything waiting on the user, full text: session requests/questions (with options), OpenRig asks
  (from `openrigHuman.list()`: who, rig, text, options, priority, qitem id), decisions asked to Ledge (tasks.md owner
  Ledge), brain proposals. Each item has the id its card needs.
- `journal.md`: events after the reading device's cursor (for a wake: the events it covers, plus the still-open ones),
  newest last, each with time, subject name, and for a finished session its last reply file.
- `rigs.md`, richer: per rig, its queue rows not closed (from OpenRig), unreachable seats, what each seat does (its
  session's state and topic when Ledge tracks it), and Max's open goals (`openrigGoals`).

New registry actions (`packages/protocol/src/actions.ts`), each wired to an existing daemon handler:

| id | handler | risk | max |
|---|---|---|---|
| `rig.answer` | `openrigHuman.answer(qitemId, answer)` (option, words, or seen) | reversible (an option the ask marks as an accept of a launch: destructive) | 4 |
| `rig.goal` | `openrigGoals` send (goal text + folder) | reversible | 1 |
| `rig.goal.reply` | `openrigGoals` reply (confirm / words) | destructive when it confirms a rig launch | 1 |
| `rig.send` | `rig send` to a seat, as the Desktop seat tab does | reversible | 4 |
| `brain.answer` | the brain proposal answer used by « À toi » (add / refuse) | reversible | 4 |

Each also gets a phone mapping where « À toi » already has the operation (`openrig.answer`, `rigs.goal.send`,
`rigs.goal.reply`, `brain.answer`), with the same Face ID rules as today. The persona's `when` rules follow the existing
pattern: only on the user's explicit request, **except in a wake**, where the operator may propose cards for the items it
reports (a card is still only a proposal). `session.decide` keeps max 1 per answer in a question; in a wake each reported
request may carry its own decide buttons (they are the request's own accept/deny, not a free proposal).

### 4. Notifications: notch and phone

A daemon-side **notification router** replaces per-session sources:

- Notch (`apps/overlay/src/surface/say.ts`, `Bubble.tsx`, used by Desktop's notch): the balloon shows **Ledge's sentence**.
  - Immediate (permission, question, urgent rig ask, decision asked): sentence built by the daemon from the event
    (« **Nova** veut lancer `pnpm -r test -u` »), with the request's own buttons (Refuser / Autoriser; options of a rig ask).
    Same priority order as `SAY_PRIORITY` today.
  - Point: the first line of the operator's turn (« Deux choses pour toi : … »), with « Voir le point » (opens the chat
    panel at that turn) and « Plus tard ».
  - « Plus tard » hides it until the next grouped point or until the user opens the chat (user decision 2026-11-13).
  - The activity line and the music cover are unchanged.
- Phone: `mobile/push/triggers.ts` keeps immediate pushes but titles them from Ledge (title « Ledge », body the sentence);
  `finished` pushes are removed, replaced by one push per point (body = the point's first line, url = the Ledge tab at
  that turn). The one-minute spacing and the « app in front: no push » rule stay.
- A request settled elsewhere before the user sees the point: its line leaves the point and leaves a one-line receipt
  « réglé dans le terminal » (or « réglé sur le téléphone ») (user decision 2026-11-13).

### 5. Read cursors

- Desktop: the cursor advances when the chat panel shows the operator's latest turn, or when the user opens « À toi ».
- Phone: when the Ledge tab or « À toi » is shown. Each device has its own cursor; the PC's chat and the phone's chat
  keep their separate conversations (today's rule), each getting its own point when woken.
- The point folds to one line (« Tout est réglé depuis 14:32 ») once all its items are settled.

### 6. Fronts

- Desktop chat panel: an operator turn style (mascot, « de lui-même », time), groups with their items and buttons as in
  board 1; receipts for settled items.
- Phone Ledge tab: the same turn, compact (board 7).
- TUI: the operator turn shown as a chat turn with its cards (no new screen).
- Guide (`ledge brain @ledge` / guide.ts source): describe the operator, the point, wakes, the notch's single voice.

## Decided by the user

- Operator on notch and phone; Ledge is the notch's only notifier (2026-11-13).
- SQLite where useful (2026-11-13); the database holds the journal, cursors and wakes only (my proposal, accepted).
- Mockup boards 1-7, 9 validated; « Plus tard » and settled-elsewhere behaviours as above; level 3 deferred (2026-11-13).

## Left to the builder

- Exact sentences and their FR/EN catalogue; the operator prompt wording; N lines of a point (suggest ≤ 12).
- Event detection plumbing (where in store/poller each kind is emitted), pruning schedule, indices.
- How the overlay receives the router's notices (new server message vs. extension of the existing snapshot).
- Debounce and caps are starting values (60 s, 30/h): tune if needed, keep them as named constants.
- Test fakes for SQLite (an in-memory `:memory:` database) and for wakes (a fake harness run).
