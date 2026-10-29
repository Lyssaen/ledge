# The agent's checklist and its AI model, from the phone

Date: 2026-10-29. Status: design.

Builds on [teams and roles from the phone](2026-10-28-mobile-teams-design.md) (the live team sheet, `team.compose`) and on
Desktop's work plan bar (`apps/desktop/src/session/TodoBar.tsx`, `todos.ts`) and model chip
(`apps/desktop/src/session/SessionModel.tsx`, daemon message `session.model`, #58 lot 2).

Mockups (390×844, the app's dark tokens): <https://claude.ai/artifact/EYCXhJBqfzkqjrzjMkKwK5>, third row « Checklist et
changement d'IA » (private to the author). Boards: `AgentsProgress`, `SessionChecklist`, `SessionModel`, `SeatModel`.

## 1. Intent

Asked what Desktop does that the phone does not, the user picked two: the agent's checklist and changing a session's model.
Both are things one looks at or decides without a keyboard, from the armchair: « where is each agent », and « this one
should run on another model ».

## 2. Goals, non-goals, anti-goals

Goals:

- **Checklist in the Agents list.** Every session that has a checklist shows its progress on its row (« 3/7 ») with the
  beginning of the task in progress under it. All done: « 7/7 », no current task. No checklist: nothing more.
- **Checklist in a session.** Desktop's bar on top of the thread: count, progress bar, task in progress. A tap unfolds the
  full list with each task's box (done, in progress, pending).
- **Model change in a session.** A chip in the reply bar shows the current model and effort; a tap opens the tool's models
  and the effort; applying restarts the agent on the same conversation. While the agent works the change waits and the
  chip says « au prochain tour ».
- **Model change from a live team's seat card.** The change is saved on the seat for future starts **and** applied now to
  the session holding the seat, as from the session. « au prochain démarrage du siège » stays only for a free seat, or for
  a session Ledge did not launch.

Non-goals:

- Changing a running session's tool. It stays « Redémarrer ce siège », conversation not carried over.
- Editing the checklist from the phone. It is the agent's own plan; the phone only reads it.
- Other machines than the one the phone is linked to.

Anti-goals:

- A checklist on the phone that differs from Desktop's for the same session. One parser, shared.
- A model offered that the daemon does not know for that tool.
- The model change on the seat card losing its passkey: it is a live-team change and keeps the sheet's confirmation.

## 3. Design

### 3.1 Checklist

- **One parser.** Desktop's `todos.ts` (TodoWrite for Claude Code, `update_plan` for Codex, OMP's `todo` with phases and
  blockers) moves to shared code that both Desktop and the daemon import. Desktop keeps its behaviour exactly.
- **The daemon computes it.** For each session, the daemon keeps the latest checklist from the thread it already holds
  and sends a compact summary with the phone's session: done count, total, the task in progress (clipped). The Agents list
  uses only this summary; it never fetches threads.
- **The session screen** shows the full list. It comes from the daemon's latest checklist (a new phone field or message,
  the builder's call), not from the phone parsing its paged, clipped thread: a long checklist must arrive whole.
- Bounds: a checklist is capped (number of tasks, text length) on the phone's side of the gateway, like other phone
  projections (`clip`); the summary says when it was cut.

### 3.2 Model change

- The phone's session gains what the chip needs: the session's model, effort, the pending change (`modelNext`), and
  whether it can switch (launched by Ledge, not exited, daemon has `modelSwitch`).
- The phone asks the tool's models through the gateway (the daemon's `models.list`, already answered for Desktop) and
  sends a model change that the gateway relays as `session.model`. No passkey from the session screen: it touches neither
  files nor the agent's rights.
- From the seat card: the existing live-team composition change (`team.compose`, passkey) carries the seat's new model
  and effort. After saving, when the seat is held by a session that can switch, the daemon also sends that session the
  change as `session.model`. The sheet says it applies now (at the end of the turn if the agent works).
- The chip in the mockup sits at the head of the quick-instructions row above the reply field. Model descriptions are
  shown in French.

### 3.3 Settled after the builder check (author's calls, to confirm)

- **Apply is the confirmation.** Picking a model or an effort in the sheet changes nothing; only « Appliquer » sends it
  (as on the mockup). « Appliquer » is disabled while the pick equals what runs (same model, same effort: a no-op that
  would also clear a pending change).
- **A pending change can be cancelled.** While the chip says « au prochain tour », the sheet offers « Annuler le
  changement », sent as the daemon already expects it (`session.model` with what runs).
- **The phone hears the outcome.** The model change gets a correlated answer (applied, scheduled, or refused with a
  reason from a closed set), as the teams operations do. The gateway checks eligibility before relaying; a failure after
  acceptance (respawn failed, effort refused) reaches the phone too, and the chip shows it in one line. Silent clears of
  `modelNext` become an outcome the phone sees.
- **Default.** A session started without a model shows « Par défaut » and, when the daemon knows it, the default's name.
  Choosing the default sends `null`, as `session.model` allows. The effort picker is hidden for a tool without a separate
  effort (Cursor).
- **Seat card outcomes.** Saved and applied: « Enregistré ; appliqué à <session> » (or « … à la fin de son tour »). Saved
  but not applied (refused, failed, cannot switch): « Enregistré sur le siège ; pas appliqué à <session> : <reason> ». A
  tool change on a held seat only saves, and the card offers « Redémarrer ce siège ». The seat sheet's one passkey covers
  the save and the apply; the confirm text says the agent restarts.
- **Shared parser** lives in `packages/protocol` (it already holds the thread types the parser reads), as plain functions
  beside the schemas.
- **Which checklist.** The main thread's, never a subagent's. The latest update wins; an empty one means no checklist.
  Without history, no checklist; after a daemon restart, the checklist comes back from the session's logged history.
  Several tasks in progress: the row
  shows the first. OMP's blocked tasks count as not done, their blocker in the full list.
- **Push rate.** The summary is pushed with the session only when it changes (done, total, or current task), not per
  thread item.
- **Compatibility.** New phone fields are optional and the features are behind a daemon capability flag, as
  `modelSwitch` is; an older PWA ignores them, a newer PWA on an older daemon shows neither chip nor checklist.
- **Machine.** The gateway always asks the local daemon (`models.list` without another `machineId`).

## 4. Tests

- Shared parser: Desktop's existing todos tests pass unchanged from the new location; daemon and Desktop give the same
  list for the same thread.
- Daemon: the summary follows the latest checklist update; a session without one has none; the cap and its « cut » flag.
- Gateway: model change relayed only for a session that can switch; refused otherwise with a reason the phone shows.
- Compose: a held seat's model change sends `session.model` to its session; a free seat's does not; a seat whose session
  cannot switch keeps « au prochain démarrage ».
- Mobile: row progress (with, without, all done), the bar folded and unfolded, the chip and its « au prochain tour »
  state, the seat sheet's two wordings.

## 5. Left to the builder

- Field and message names, and whether the full checklist rides on the session or in its own message.
- The cap's values.
- Whether the phone caches the model list per tool.
- Order of work: the two features are independent and can ship in either order, or together.
