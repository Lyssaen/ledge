# Ledge's actions: one registry for what the chat may propose

Date: 2026-10-26. Status: design; the product points of §9 decided on 2026-10-26. Issue #94; base of #93 (`ledge team`, `ledge close`).

## 1. Intent

Ledge's chat does not know what it may do. It learns it from `PERSONA` (`chat/claude.ts`), one hand-written string that
describes six of the daemon's actions and says things that are false for some harnesses (« cat, ls, rg » while Claude
only has `Read,Grep,Glob`). Each capability added today costs a sentence in that string, a fence in `proposal.ts`, an
`xxxFrom` validator in `chat/service.ts`, a field of `ChatTurn`, a card in three fronts and a frozen text in
`chat-claude.test.ts`. So most of what the daemon can do (`ClientMessageSchema`) is out of the chat's reach: « passe
Nova sur Opus » or « dissous l'équipe » get « je ne peux pas ».

The principle stays: **Ledge proposes, the human confirms.** Ledge gets no shell and no `ledge` CLI; it gets a wider,
declared set of things it may *propose*. One registry is the source of:

- the persona's « what you can propose » section, per harness;
- the daemon's validation of what the chat wrote (it wraps the six validators, then replaces them);
- the card every front draws (desktop, overlay, mobile, TUI), and the confirmation it asks for;
- the CLI of #93, which becomes a thin layer: parse argv with the same schema, send the same message.

## 2. The registry (`packages/protocol/src/actions.ts`)

Pure data and Zod, no Node: the fronts and the CLI import it.

```ts
export const ActionRiskSchema = z.enum(['read', 'reversible', 'destructive']);
export type ActionRisk = z.infer<typeof ActionRiskSchema>;

export interface ActionDef<A extends z.ZodTypeAny = z.ZodTypeAny> {
  id: ActionId;                 // 'session.model', 'team.dissolve'… : the ClientMessage type it ends in, when there is one
  args: A;                      // what Ledge writes in the block (names allowed: the daemon resolves them)
  summary: string;              // one line, French, for the persona and `ledge help`
  when: string;                 // the rule: when Ledge may propose it (« seulement si… »), French, for the persona
  example: z.infer<A>;          // the block's JSON in the persona, checked against `args` by a test
  risk: ActionRisk | ((args: z.infer<A>) => ActionRisk);  // session.decide: accept is destructive, deny is not
  max: number;                  // rows of this action in one answer (8 at most, MAX_PROPOSALS)
  card: 'generic' | 'launch' | 'relay' | 'close' | 'project' | 'team' | 'task';  // which card draws it (§5)
  phone: ConfirmPurpose | null; // the device check a phone needs before applying it, null when none
  cli?: string;                 // the equivalent command, for #93 and for Ledge to tell an agent (« ledge team dissolve <id> »)
}
export const ACTIONS: readonly ActionDef[];
export const actionById: (id: string) => ActionDef | undefined;
```

**Risk** says what the user loses if the click was a mistake:

- `read`: nothing changes (open a session, show a task). No confirmation; applied on click.
- `reversible`: something changes and Ledge can undo it (archive ↔ restore, join ↔ leave, a clean close the user can
  resume, a model change). One click on the card.
- `destructive`: Ledge cannot undo it (dissolve a team, cancel a task, accept a permission). The card asks again
  (§5.3); the daemon refuses the apply without `confirmed: true`; a phone needs its device check.

**Confirmation is not a field of its own**: every action but `read` goes through a card, and the risk decides how much
the card asks. One axis is easier to keep honest than two that can disagree.

### 2.1 Resolution and execution (daemon, `packages/ledge/src/daemon/actions.ts`)

The registry says *what* an action is; the daemon says whether it is possible *now*. Next to each `ActionDef`, the
daemon holds:

```ts
interface ActionImpl<A> {
  /** The block's args against the live state: names → ids, `@role` → a seat, the pending request snapshotted. Either a
   *  row the card can show, or why not (logged, no row: what the six validators do today). */
  resolve(args: A, ctx: ResolveCtx): ChatAction | { refused: string };
  /** The resolved row as the ClientMessage the daemon already handles. */
  toClient(row: ChatAction): ClientMessage;
}
```

`toClient` reuses the existing handlers of `server.ts` (`session.model`, `team.dissolve`…): the rules (read-only
session, state, effort per harness, stale request) stay in one place. Apply = re-run `resolve` on the row's args (a
session may have exited since the answer), then `handle(toClient(row), capture)`; the first `error` the handler
replies is the row's failure.

The same pair serves #93: `ledge team dissolve team-3fa2` parses argv with `ACTIONS['team.dissolve'].args`, sends
`action.run { rid, by, action, args }`, and the daemon runs `resolve` then `toClient` then `handle`. The CLI never
duplicates a rule. Whether an agent session (`by` ≠ the user) may run a destructive action from the CLI is #93's call;
the registry gives it the risk to decide on.

## 3. The block: `ledge-action`

One fence, one shape:

````
```ledge-action
{"action": "session.model", "args": {"session": "Nova", "model": "claude-opus-5-5", "effort": "high"}}
```
````

- `ActionBlockSchema = z.object({ action: z.string(), args: z.record(z.unknown()) })`, then
  `actionById(action)?.args.safeParse(args)`. An unknown action or bad args: no row, a log line (as today).
- Several blocks per answer, in order, each action at most its `max`, 8 rows in all per answer.
- `extractProposal` learns the fence; `hideProposal` hides it while it streams (`FENCES` gets `` ```ledge-action ``).

### 3.1 Migration from the six blocks

| Old fence        | Registry id       | Card (unchanged in phase 1) | Validator wrapped as `resolve` |
|------------------|-------------------|-----------------------------|--------------------------------|
| `ledge-session`  | `session.launch`  | launch                      | `proposalFrom`                 |
| `ledge-relay`    | `session.relay`   | relay                       | `relayFrom`                    |
| `ledge-close`    | `session.close`   | close                       | `closesFrom`                   |
| `ledge-project`  | `project.propose` | project                     | `projectFrom`                  |
| `ledge-team`     | `team.launch`     | team                        | `teamFrom`                     |
| `ledge-task`     | `task.give`       | task                        | `tasksFrom`                    |

- **Phase 1 (this task).** The parser normalises every block to `{action, args}`: an old fence `ledge-close X` is read as
  `ledge-action {"action": "session.close", "args": X}`. The six validators move, unchanged, behind their registry
  entry; their turn fields (`proposals`, `relay`, `closes`, `projectProposal`, `team`, `tasks`) and cards stay, so no
  front changes for them. The generated persona only writes `ledge-action`. The old fences stay readable for one
  release: a day session resumed with the old persona still writes them.
- **Phase 2 (with Bix, after the generic card ships).** `session.close` and `session.relay` move to the generic card
  (they are one line each and need nothing the generic card lacks; the relay keeps its queue state as a row `state`).
  Launch, team, project and task keep their own cards: they carry forms (model pickers, the project editor, the
  seats) that a one-line row cannot.
- **Phase 3.** The old fences are dropped from the parser.

The rule « the last block's kind decides the card » survives for the legacy cards only. Generic rows are additive: an
answer may carry a team card, its task card and generic rows.

## 4. The persona (`packages/ledge/src/chat/persona.ts`)

`buildPersona(tool: Tool, actions = ACTIONS): string`, in three parts:

1. **Fixed, short (≈ 10 lines).** Who Ledge is, the tone and format (language of the question, 3 to 10 lines, plain
   Markdown, bot names in bold the first time, cite the source and its time), the context files (`sessions.md`,
   `folders.md`, `projects.md`, `roles.md`, `teams.md`, `tasks.md`, `forge*.md`, pane/reply/git), « commence par
   sessions.md », and the safety rules common to every action: propose only on an explicit request; only ids, names and
   absolute paths read in the context files or given verbatim by the user; when several targets fit or none, no block,
   cite the candidates and ask.
2. **Generated from the harness: what you can read.** One line from a table in `persona.ts`, next to the flags it
   describes, so a flag change and its sentence sit side by side:

   | Tool   | Flags (unchanged)                                   | What the persona says                                        |
   |--------|-----------------------------------------------------|--------------------------------------------------------------|
   | claude | `--tools Read,Grep,Glob --permission-mode dontAsk`  | `Read`, `Grep`, `Glob` ; pas de shell                        |
   | codex  | `--sandbox read-only`                               | des commandes shell en lecture seule (`cat`, `ls`, `rg`…)     |
   | cursor | `--mode ask --sandbox enabled`                      | lecture et recherche (mode ask), aucune écriture             |
   | omp    | `--tools read,grep,glob`                            | `read`, `grep`, `glob` ; pas de shell                        |

3. **Generated from the registry: what you can propose.** The block's shape once, then one entry per action:
   `` `id` `` — summary — risk — when — the example's JSON. Then « Tu ne proposes jamais : … » (§6.2), so a refusal
   names the screen instead of inventing an action.

Tests check the structure (every registry id and example appears, the harness line matches the tool, the persona never
mentions a shell for claude/omp), not a frozen text. `PERSONA` stays exported as `buildPersona('claude')` for the
callers that use it (routing).

No `capabilities.md` file: the persona is the one place, sent as the system prompt (§9.3), so the model always has it
and the CLI's prompt cache keeps it.

## 5. The card contract (for Bix)

### 5.1 Protocol

```ts
/** A generic row: what the daemon resolved, ready to apply. */
export const ChatActionSchema = z.object({
  action: z.string(),                         // a registry id
  args: z.record(z.unknown()),                // resolved: ids, never names; what toClient takes
  summary: z.string().max(300),               // one line, French, the daemon's, bot names in **bold**
  detail: z.string().max(4000).optional(),    // what to read before confirming: the pending request verbatim (decide)
  risk: ActionRiskSchema,
  session: z.string().optional(),             // the target session's id: link, and « offline » when its machine is
  team: z.string().optional(),                // the target team's id: link to its table
  state: z.enum(['running', 'done', 'failed']).optional(),  // absent: proposed
  doneAt: z.string().datetime().optional(), error: z.string().optional()
});
ChatTurn.actions?: ChatAction[]   // 1..8, and chat.done carries it like `closes`

// Client → daemon: apply rows of the turn's generic card, in order; all rows when `rows` is left out.
{ type: 'chat.act', rid, qid, rows?: number[], confirmed?: true }
// Daemon → requester: what was applied; every client also gets the new rows through chat.history.
{ type: 'chat.acted', rid, qid, done: number[], failed: Array<{ row: number; message: string }> }
// Phone: the same, with its device check (ConfirmPurpose gains 'act', subject the qid).
{ type: 'chat.act', op, qid, rows?, assertion? }
```

- Rows apply **one after the other, in order**, and stop at the first failure: the rest stay proposed (« ferme ces
  sessions puis dissous l'équipe » must not dissolve when a close failed). A row done or running is passed over.
- `confirmed: true` is required when any targeted row is `destructive`: the daemon refuses the apply otherwise
  (`confirm_required`). A front that forgets its dialog fails closed.
- The fleet copies `actions` from `chat.done` (as `closes`); the phone's strict turn schema gets
  `PhoneChatActionSchema` = `ChatActionSchema` without `args` (the phone sends rows, never args).

### 5.2 What a front must convey (the look is Ida's)

This section fixes the data and the behaviour, not the look: no screen (Desktop, overlay, TUI, phone) changes before
Ida's mockup of the cards, made from this contract, is validated; Bix codes it then.

- The front needs no knowledge per action: `summary`, `detail`, `risk` and `state` are enough to draw a row. It may
  hold copy per `action` id, with `summary` as the fallback, so an older front still draws a newer action.
- Each row can be applied on its own; a card with two rows or more can also be applied as a whole, in order.
- The risk must be visible before the click, and a row's state (proposed, running, done, failed with its reason) after.

### 5.3 Confirmation (behaviour, enforced by the daemon)

- `read` / `reversible`: the click applies.
- `destructive`, or applying the whole card when it holds one: the front asks again, showing **every** row about to
  be applied, the destructive ones told apart, with `detail` in full; only then does it send `confirmed: true`. The
  daemon refuses a destructive apply without it, and a phone also needs its device check. How each front asks
  (dialog, prompt, sheet) is the mockup's.

## 6. Coverage

### 6.1 In the registry (phase 1)

| id                  | Ledge writes (`args`)                                   | Ends in                                  | Risk                  | Phone check |
|---------------------|---------------------------------------------------------|------------------------------------------|-----------------------|-------------|
| `session.launch`    | `{cwd, prompt?, model?, effort?}`                       | launch card → `session.launch`           | reversible            | `launch`    |
| `session.relay`     | `{session, text}`                                       | relay card → `session.relay`             | reversible            | —           |
| `session.close`     | `{session}`                                             | close card → `session.close`             | reversible            | `close`     |
| `project.propose`   | as `ledge-project`                                      | project card (editor)                    | reversible            | —           |
| `team.launch`       | as `ledge-team` (seats may carry `model`, `effort`)     | team card → `team.launch`                | reversible            | `launch`    |
| `task.give`         | as `ledge-task`                                         | task card → `task.cmd give`              | reversible            | —           |
| `session.model`     | `{session, model: string\|null, effort: string\|null}`  | `session.model`                          | reversible            | —           |
| `session.interrupt` | `{session}`                                             | `session.interrupt`                      | reversible            | —           |
| `session.archive`   | `{session}`                                             | `session.archive`                        | reversible            | —           |
| `session.restore`   | `{session}`                                             | `session.restore`                        | reversible            | —           |
| `session.resume`    | `{session}`                                             | `session.resume`                         | reversible            | `launch`    |
| `session.decide`    | `{session, decision: 'accept'\|'deny', note?}`          | `session.decide` with `expect` (§9.1)    | accept: destructive   | `decide`    |
| `team.join`         | `{team, session, role}`                                 | `team.join`                              | reversible            | —           |
| `team.leave`        | `{team, session}`                                       | `team.leave`                             | reversible            | —           |
| `team.resume`       | `{team}`                                                | `team.resume`                            | reversible            | `launch`    |
| `team.dissolve`     | `{team}`                                                | `team.dissolve`                          | destructive           | `act`       |
| `team.save`         | `{team, name}`                                          | `team.save` with the live team's seats   | reversible            | —           |
| `task.cancel`       | `{task, reason?}`                                       | `task.cmd cancel` (new, §6.3)            | destructive           | `act`       |
| `task.pass`         | `{task, to, note?}`                                     | `task.cmd pass` by Ledge (§6.3)          | reversible            | —           |

`session` takes an id or a live bot name, `team` an id or a live team's name, `task` an id; `resolve` turns them into
ids and refuses an ambiguous name. `session.model` checks the model against `models.list(tool)` when the catalogue is
known, and the effort against what the harness takes (`EFFORT_ARGS`), as `server.ts` does.

### 6.2 Never proposed

`session.kill` (the clean close covers it), `session.delete`, `session.dismiss`, `update.daemon`, `machines.set`,
`projects.set` (only through the project card's editor), `mobile.*`, `context.set`, `island.set`, `folder.create`.
The persona lists them so Ledge names the screen instead. `session.handover` and `handover.*` are a candidate for a
later lot (« passe le relais à Nova »), not phase 1.

### 6.3 Daemon changes the coverage needs

- `task.cmd` gains `op: 'cancel'`: by the task's giver, or by Ledge for any task; an open or taken task becomes
  `dropped` with `annulée par <qui>[ : raison]` in its log, and its owner is told (`tellOwner`). No new state: the
  fronts already draw `dropped`.
- `task.cmd pass` by Ledge: allowed for any task not closed (the user is the operator), the giver stays as today.
- `team.save` from a live team: `resolve` builds the seats from the team's seats and the sessions that hold them
  (role, tool, model, effort).

## 7. Errors and safety

- An invalid or impossible block: no row, a log line `chat <qid>: <action> ignored: <why>`, as today. Ledge's text
  stays; the user sees no card.
- Apply re-resolves: a row whose target changed since the answer fails with the reason, nothing is sent.
- Prompt injection (a pane or a repository steering the chat): a card can only propose what the registry has, its
  args are resolved against the live state, and a destructive row needs a second, explicit confirmation showing what
  it does. The relay keeps its `!` refusal; `session.decide` never offers `always` (§9.1).
- The registry never grows a free-form action (« run this command »).

## 8. Tests

- `protocol/actions.test.ts`: every `example` parses against its `args`; ids unique; `max` ≤ 8; every non-generic card
  id maps to an existing turn field.
- `proposal.test.ts`: `ledge-action` extracted and hidden while streaming; every old fence normalised to its id.
- `chat-persona.test.ts`: structure per tool (§4).
- `chat-service.test.ts`: the six existing cards still come out of old fences and of `ledge-action`; generic rows
  resolved, refused (unknown session, read-only, exited, ambiguous name), capped.
- `chat-act.test.ts`: in-order apply, stop at first failure, `confirm_required`, re-resolve, double click.
- `daemon-tasks.test.ts`: `cancel`, `pass` by Ledge.

## 9. Decided on 2026-10-26 (the user kept the three recommendations as they are)

### 9.1 Answering a pending permission from the chat — **yes, narrowly**

Ledge already reads `pending` in `sessions.md`; « accepte la demande de Nova » is the single most useful thing to do
from a phone or the overlay without opening the session. Risk is the injection that makes Ledge propose « accept ».
What keeps it at the level of today's « Accepter » button:

- the row's `detail` is the request **verbatim** (`pending.text`, `body` for a plan), and the card shows it;
- `resolve` snapshots `expect = {kind, text, key: pendingKey(pending)}`: a request changed since is refused (`stale`)
  by the existing check of `session.decide`;
- `accept` and `deny` only, never `always`; `note` only where `offers(tool, kind, 'note')`; no OMP `ask` dialog
  (`session.answer`) in phase 1;
- `accept` is `destructive` (dialog, then the phone's `decide` check, as the phone's own accept); `deny` is
  `reversible`.

### 9.2 One card per action, or a plan — **a plan: one card, ordered rows, one confirmation**

« Ferme ces 5 sessions et dissous l'équipe » is one intent. Five cards plus one would be six clicks and no order. The
generic card is already a list (as the close card is): rows in the order Ledge wrote, each with its own button, and
« Tout appliquer » that applies them in order and stops at the first failure. One confirmation covers the plan, and it
lists every row, the destructive ones marked. Limit in phase 1: the legacy cards are not part of the plan (the closes
stay on their own card until phase 2 moves them to the generic one).

### 9.3 The persona as a system instruction for Codex and Cursor — **yes, with a stdin fallback**

Today the persona is prepended to every question on stdin: a user message, repeated in the day's transcript at each
turn, weaker than a system prompt against a pane that says « ignore your instructions ».

- Codex: `-c developer_instructions=<persona as a TOML string>` on `codex exec` (and `exec resume`); `--ignore-user-config`
  does not block `-c`.
- Cursor: write the persona to `AGENTS.md` in the context folder, which is already the agent's `--workspace` and is
  rewritten each turn; `cursor-agent` loads it as a rule.
- Both to be proven by a probe test against the installed CLI (a persona that asks for a marker word in the answer).
  If the probe fails for a version, that harness keeps stdin, logged once. Claude and OMP already use
  `--append-system-prompt`.

## 10. Out of scope

The cards themselves (Ida's mockup from §5, then Bix), `ledge team` / `ledge close` (#93, on top of §2.1), machine routing changes, a
read-only « ask Ledge to show » action set beyond what the files give.
