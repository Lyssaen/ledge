# A task handed between agents, seen like a message

Date: 2026-10-26. Status: design. Issue: [#92](https://github.com/Lyssaen/ledge/issues/92).

Builds on [session tasks](2026-10-25-session-tasks-design.md) and the
[atelier rooms](2026-10-26-atelier-rooms-design.md) (§3.3, the line from Ledge's corner).

## 1. Intent

When an agent sends a **message** (`ledge send`, SendMessage), the user sees it travel: a bubble over the sender's
seat, a dotted line to the receiver's seat with an envelope flying along it, the receiver's seat ringing, and a
« sent » card in the sender's thread. When an agent **gives, passes or closes a task**, the user sees nothing. A task
is real work handed from one agent to another, and today it moves silently.

The user's words: « je veux comme pour les messages car ici une tâche est transmise et je vois rien ».

Tasks and messages stay two different things (a task has an owner, a giver, a lifecycle and a journal; a message has
none). Only the way they are **shown** converges: one visual language, with a shape that tells a task from a message.

## 2. Goals, non-goals, anti-goals

Goals:

- Every **transmission** of a task animates in the atelier, the way a message does: `give` (giver → owner), `pass`
  (old owner → new owner, with the note), `done` and `refuse` (owner → giver), cancel (giver → owner). A giver or owner
  that is Ledge is Ledge's corner (`.ledge-desk`).
- One wire component for messages and tasks; the `Bubble` / `LedgeWire` duplication is gone.
- The **sender's** session thread shows a card for each transmission it made (today only the receiver sees the raw
  pointer, as a notice). Both cards open the task.
- The TUI's « Échanges » lists task transmissions between any two seats, not only Ledge's gives.
- `paused` and `reduced` (and `prefers-reduced-motion`) behave as for messages.

Non-goals:

- Converting a message into a task. The hook's instruction (`cli/hook.ts`: « pour confier un travail… lance plutôt
  `ledge task give` ») is enough for now.
- Merging messages and tasks into one model or one transport.
- Tasks of a remote machine: the fleet keeps ignoring them (`fleet.ts`, « Teams and tasks are the local daemon's »).
- Animating `take` or `drop` (`take` moves nothing between two seats; `drop` means the owner is gone).

Anti-goals (would be a failure even if it works):

- An agent no longer receives its `<ledge-task>` pointer in its terminal, or receives it differently. Only what the
  fronts **show** changes; what is typed stays byte for byte.
- An older phone or an older Desktop breaks on the new data (a thread item it cannot parse, a field it rejects).
- The wire looks like a message's: the user cannot tell at a glance that a task, not a message, went across.

## 3. Design

### 3.1 Daemon: every task change reaches the fronts (`daemon/tasks.ts`, `daemon/server.ts`)

- `onLedgeTask` becomes `onTask`, called on **every** change of **every** task (create, `put`, `seen`). The server
  broadcasts `task.updated` for each, as it does today for Ledge's. `TaskUpdatedSchema`'s comment is updated.
- Each log entry gains optional structured fields, so a front never parses the French `what`:

  ```ts
  log: z.array(z.object({ at, by, what,
    /** The transmission this entry is, when it is one: who handed the task to whom (session ids, or `ledge`). */
    op: z.enum(['give', 'pass', 'done', 'refuse', 'cancel', 'take', 'drop']).optional(),
    from: z.string().optional(), to: z.string().optional(),
    /** Their names then: the TUI's « Échanges » names an old transmission whose session is gone or renamed. */
    fromName: z.string().optional(), toName: z.string().optional() }))
  ```

  Written by `give` (`from` giver, `to` owner), `pass` (`from` old owner, `to` new owner), `done` / `refuse` by the
  owner (`from` owner, `to` giver), `refuse` by the giver = `cancel` (`from` giver, `to` owner), `take` and `drop`
  without `from`/`to`. A context handover's passes (`daemon/handover.ts`, `op: 'pass'` by the relieved session) are
  ordinary passes: they animate and leave a card, since the user wants to see a task move to the relief. *(Our call.)*
  Entries already in the journal have none: they never animate, which is right (they are old).
- Ledge's `list` (`by: ledge`, no team) returns **every** task, not only Ledge's own: Ledge already reads any task
  (`show`), and the fronts must know a seat-to-seat task outside a team to show it after a reconnect. *(Our call.)*
  Consequence, accepted: Ledge home's « Tâches » tab (`LedgeHome.tsx` `TasksTab`) also lists seat-to-seat tasks outside
  teams; its « giver: seats » filter already covers them. « À toi » stays Ledge's tasks only (`closedLedgeTasks`
  filters by giver). Check every other `teams.tasks` reader (sidebar `Tree.tsx`, `SessionPage.tsx` held task,
  `Atelier.tsx` team tasks) keeps its own filter.

### 3.2 Sender's thread card (`daemon/history.ts`)

The receiver's side already exists: the typed pointer becomes a `notice` item with `task` (`history.ts`, `ledgeTask`),
rendered by `NoticeLine` as « TÂCHE · Tâche de X ».

The sender's side is new. On each transmission whose `from` is a session (not Ledge), the server asks history to put
a **`notice` item** in the sender's thread:

- `notice: 'other'`, `task: <id>`, `name` / `peer` = the other side, `summary` = the title (and the note / result /
  reason, quoted as the pointer quotes them), `text` = a plain French line.
- A new optional field `taskOp: 'give' | 'pass' | 'done' | 'refuse' | 'cancel'` and `outgoing: true` tell the front
  which wording to use: « Tâche confiée à Nova », « Tâche passée à Nova », « Tâche rendue à Nova (terminée) »,
  « Tâche refusée, rendue à Nova », « Tâche annulée pour Nova ».
- The same two optional fields on the receiver's notice are welcome but not required (the pointer text already says it).

Why a `notice` and not a new `kind`: `ThreadItemSchema` is a discriminated union; an older phone or Desktop would reject
an unknown kind. Optional fields on `notice` are already the pattern (`task`, `team`: « An older front, which knows
neither, shows it as any other notice »). *(Our call.)*

History needs a public method to put such an item from outside a session event (e.g. `recordTask(sessionId, …)`),
with a stable id per transmission (`task-<taskId>-<log index>`) so a replay never duplicates it, and the turn the
session is in (no new turn: it is not a prompt).

### 3.3 Fronts' thread rendering

- Desktop `NoticeLine`: a notice with `task` is clickable to the task (`dispatch({ type: 'ledge', tab: 'tasks', task })`)
  on both sides; `taskOp` + `outgoing` choose the title. Kicker stays « TÂCHE », in the task colour (§3.4).
- TUI thread (`tui/model/thread.ts`): same wording for the outgoing card.
- Mobile gateway (`mobile/project.ts`): `task` and the new fields pass through `pickSet`, nothing more. The phone's
  thread model (`apps/mobile/src/model/thread.ts`) keeps only `prompt`, `reply` and `permission` items: it shows no
  notice and no message card today, so showing task cards on the phone is out of scope, and nothing there can break.
  *(Our call.)*

### 3.4 Atelier: one wire (`apps/desktop/src/atelier/MessageLayer.tsx`)

- One component, `Wire`, owns the geometry (the two endpoints followed each frame, the quadratic path, the CSS-zoom
  division), the travelling object, the landing ring and the bubble. Parameters: `from` and `to` as a seat id or
  `'desk'`, `kind: 'message' | 'task'`, the bubble's label and text, its click action, `still`.
  `Bubble` and `LedgeWire` become two thin callers, or disappear.
- `kind: 'task'` draws a **ticket** (a small card with a notched edge or a fold, not an envelope), in the task colour:
  the colour the task kicker already uses (`--sidebar-primary`, `.notice-line.notice-task`), unless the builder finds
  that it clashes in the atelier, in which case a dedicated token. The wire's dashes take the same colour. The bubble's
  icon is a task icon, not `mail`.
- Bubble wording by op: « Tâche → Nova » for give, « Passée → Nova » (with the note as text if any, else the title) for
  pass, « Terminée → Max » / « Refusée → Max » for done/refuse, « Annulée → Nova » for cancel. i18n in `t.atelier`.
- Source: a hook like `useRecentLedgeTasks`, generalised. A task shows a wire while its **last log entry with `from`
  and `to`** is less than `BUBBLE_MS` old on the atelier's clock (first sight counts when its date is ahead, as for
  messages). **Every** such entry under 5 s old draws its own wire, keyed by `taskId + log index`: a give then a pass
  within 5 s show two wires at once (A → B and B → C), as two messages would. *(Our call.)* Endpoints: `from` / `to`
  qualified like the fleet's task sessions; `ledge` → the desk.
- An endpoint that is not drawn (a closed room, a session off-screen, an exited owner): no wire, as a message today.
- `paused` / `reduced`: the line and bubble show, the ticket does not fly, no ring; `prefers-reduced-motion` the same
  (extend the existing `.exchange-envelope` rules to the ticket).

### 3.5 TUI « Échanges » (`packages/ledge/src/tui/model/overview.ts`)

`exchanges()` takes every task transmission (each log entry with `op` in give/pass/done/refuse/cancel and `from`/`to`),
not only Ledge's gives: from and to names (the live session's name, else `fromName`/`toName`; Ledge for `ledge`), `summary` = the title, and a `kind: 'task'` field the
screen shows with a marker distinct from a message's. Newest first, mixed with the messages, `max` as today.
`Overview.tsx` renders the marker.

## 4. Tests

- `tasks.test.ts`: each op writes its `op`/`from`/`to`; `onTask` fires for a seat-to-seat give, a pass, a done, a
  refuse, a cancel; the typed pointers are unchanged (assert the exact strings the current tests assert).
- `server.test.ts` / `teams-server.test.ts`: `task.updated` reaches a front for a seat-to-seat task; Ledge's `list`
  returns it.
- History: the sender's notice for each op, with its id stable across a replay.
- Desktop: `MessageLayer` draws a ticket wire for a give, a pass (two wires in a row), a done back to the desk; none
  for a 6 s old entry, none for `take`; `still` hides the ticket. `NoticeLine` titles and click.
- TUI: `exchanges()` mixes messages and task transmissions in order.
- Mobile gateway: the notice keeps `task` and the new fields.
- Handover: a relief's passes write `op: 'pass'` like any pass.

## 5. Left to the builder

- The ticket's exact drawing and the bubble's layout, within §3.4.
- Whether `Bubble` and `LedgeWire` survive as thin wrappers or disappear.
- The wording's exact French, within the examples above.
- The order of the work (daemon first is natural: the fronts need `op`/`from`/`to`).
