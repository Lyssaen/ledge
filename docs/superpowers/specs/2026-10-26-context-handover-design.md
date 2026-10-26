# A session's context: what it is told again, and the relief when it is nearly full

Date: 2026-10-26. Status: design.

Builds on [roles, teams and Ledge as their operator](2026-10-25-roles-teams-operator-design.md) and the session tasks.

## 1. Intent

An agent's context fills up as it works. Today Ledge leaves that to the agent: Claude Code and Codex compact their own
conversation, and Ledge neither measures it nor steps in. Two gaps follow.

- **After a compaction the agent forgets what it was doing.** `SessionStart` tells it again who it is (its name, its
  project, its role and team), but not the tasks it holds. They are in the daemon (`ledge task list`), and nothing
  tells the agent to look.
- **A long session has no way out but its own compaction**, which loses detail each time. A seat of a team should be
  able to hand its work to a fresh session at the same seat, with a brief written by the one leaving.

Two parts, in this order: (A) the open tasks in what a session is told when it starts, resumes, is cleared or compacted;
(B) the measure of each session's context and the **relief** (« relève ») of a session that is nearly full.

## 2. Part A — the open tasks in the identity (`cli/hook.ts`)

- On `SessionStart` (every source: startup, resume, clear, compact), the hook already waits for the daemon's snapshot
  (within a second) to say who the session is. It now also asks the daemon for the session's own open tasks
  (`task.cmd { by: <session>, op: 'list' }`, within the same deadline) and adds one block to `identityContext`:

  > Tes tâches en cours (elles sont gardées par Ledge, pas dans ta conversation) :
  > - t91b0d4 · prise · « Tests de roles.ts » · confiée par Ledge
  > - t5c7e2a · ouverte · « Brancher @role dans le hook » · confiée par Bix
  >
  > Relis-en une avec `ledge task show <id>` avant de reprendre.

  Only the tasks it **owns** (not those it gave), at most 10, the oldest first. None: no block.
- A session that is a relief (part B) is also told its predecessor's brief again, so a compaction does not lose it:
  « Tu as pris la relève de Otto ; son bilan : `ledge handover show` ». The brief itself is not repeated (it may be
  long): a pointer to it is enough.

## 3. Part B — the context and the relief

### 3.1 Measuring (`daemon/context.ts`)

- After each turn (a session's state becomes `idle`), the daemon reads the end of its transcript (the last 512 KB of
  `transcriptPath`, which the hooks already give) and keeps on the session `context: { used, window, at }`:
  - **Claude Code**: the last assistant message outside a side chain; `used` = `input_tokens` +
    `cache_creation_input_tokens` + `cache_read_input_tokens` + `output_tokens` of its `usage`. `window` is 1 000 000
    when the session's model carries `[1m]`, or when `used` is already past 200 000; else 200 000.
  - **Codex**: the last `token_count` event of the rollout; `used` = `last_token_usage.total_tokens` (else input +
    output), `window` = `info.model_context_window`.
  - **Cursor and OMP**: not measured (no transcript Ledge reads). They get no `context`, and no relief proposed; the
    user can still ask for one.
- The measure is the agent's own figure, not an estimate. A transcript that cannot be read leaves the last measure.
- `Session.context` is optional (older fronts ignore it). The phone gets it too (`PhoneSession.context`).

### 3.2 When it is nearly full

- **Threshold: 80 %** (`CONTEXT_NEAR`). Claude Code compacts on its own near the end of its window; at 80 % there is
  room left to write a brief.
- A session past the threshold is « near its limit »:
  - Desktop: an item in « À toi » (« Otto @build approche de sa limite de contexte · 84 % ») with « Passer le relais »
    and « Plus tard » (put away until it grows by another 5 points); the session page's meta line shows the gauge
    (`contexte 84 %`), with « Passer le relais » in the session's actions.
  - TUI: the session's line in « À toi » with `H` to hand over; the session screen shows `contexte 84 %`.
  - Phone: the agent's row shows `contexte 84 %`; the relief is started from the PC (it launches a session, which the
    phone only does with its device check on a chat card).
  - Ledge's chat context (`sessions.md`) gives each session's context, so the operator can mention it.
- **Automatic relief** only for a seat of a team whose role works without asking (`autonomy: auto`): past the threshold,
  Ledge starts the relief by itself, and says so in « À toi » once done. Any other session waits for the user.

### 3.3 The relief (`daemon/handover.ts`)

`session.handover { rid, id }` from a front, or the automatic trigger. Refused for a session Ledge did not launch, one
that has ended, one already handing over, and for OMP (no pane to type the request into). Then:

1. **Brief.** Ledge types into the session, at its next free moment (the mailbox):

   > `<ledge-handover>` Ton contexte est presque plein (84 %) : une nouvelle session va prendre ta place. Écris ton bilan
   > de relève en une commande : `ledge handover "<bilan>"` — ce qui est fait, ce qui est en cours, la suite, les pièges,
   > les fichiers clés. Ne commence rien d'autre ensuite. `</ledge-handover>`

   The session's state shows `handover: { state: 'briefing', at }`.
2. **The brief comes** with `ledge handover "<bilan>"` (`handover.brief { by, text }`, up to 20 000 characters; a Codex
   runs it through its hook, as `ledge task`). Without a brief after **10 minutes**, or if the session ends first, Ledge
   writes one itself from what it has: the session's last reply and its open tasks (« bilan écrit par Ledge : … »).
   A session that ended has already dropped its tasks (their givers are told, as for any session that ends): the relief
   gets the brief, not the tasks. The brief is kept in `~/.ledge/handovers/<old id>.md`.
3. **The relief is launched** (`state: 'launching'`): same agent, folder, model and effort, same role (its autonomy) and
   team; a new name. Its first instruction:

   > Tu prends la relève de Otto (@build, équipe ledge-roles), dont le contexte était plein. Son bilan : … Tes tâches
   > t'arrivent de Ledge. Relis le bilan avec `ledge handover show` si besoin.

   At a team's table the relief takes the seat of the one it relieves (the same role).
4. **The open tasks are passed** from the old session to the new (`task.pass`, the giver stays: a task Ledge gave still
   comes back to Ledge). Their pointers reach the relief at its next free moments, one at a time.
5. **The old session is closed** (its agent stopped, `exited`), and kept: `handover: { state: 'done', to, toName, at }`.
   The relief carries `relieves: { id, name, at }`. Both pages say it (« relevée par Nova » / « relève de Otto »).

A failure at 3 (the launch refused) leaves the old session as it was, its tasks with it: `handover: { state: 'failed',
reason }`, said in « À toi ». `ledge handover show` prints the brief of the session's own relief, or the one it wrote.

### 3.4 Protocol

- `Session` gets optional `context?: { used, window, at }`, `handover?: { state: 'briefing' | 'launching' | 'done' |
  'failed', at, to?, toName?, reason?, auto? }` and `relieves?: { id, name, at }`.
- Client: `session.handover { rid, id }`; `handover.brief { by, text }`; `handover.show { rid, by }`.
- Server: `session.handover.result { rid, ok, reason? }`; `handover.result { rid, text?, reason? }`.
- Phone: `PhoneSession` picks `context`, `handover` (its state only) and `relieves`.

## 4. Tests

- Part A: the identity lists the session's own open tasks (not those it gave, not closed ones), and a relief is told of
  its brief.
- Measuring: a Claude transcript (side chains skipped, the `[1m]` window), a Codex rollout, a missing file.
- The relief end to end through the daemon: the brief asked at the next free moment, written by the session, the relief
  launched with the role, team and a first instruction holding the brief, the tasks passed to it, the old session closed;
  the fallback brief after the timeout; a launch refused leaves everything as it was; the automatic relief of an `auto`
  seat.
- Fronts: the « À toi » item and the session page's gauge and button (Desktop), `H` (TUI), the gauge (phone).
