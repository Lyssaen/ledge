# Model change from the phone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the phone, change a running session's model and effort (chip in the reply bar + sheet), and change a live team seat's model so it is saved on the seat and applied at once to the session holding it.

**Architecture:** The daemon's existing `session.model` gains coded refusals, a correlated `session.model.accepted {when}` reply and coded late failures; `team.compose` applies a kept seat's model change to its holder and reports per-seat outcomes in `team.changed.models`. The phone gateway relays `models.list` (read) and `session.model` (operation, no passkey) and projects the outcomes; the PWA adds a model chip/sheet in the session and a model sheet on the live team's seat card (existing `team.compose` + passkey).

**Tech Stack:** TypeScript, zod (`packages/protocol`), Node daemon (`packages/ledge`), React PWA (`apps/mobile`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-29-mobile-model-checklist-design.md` — §2 (model goals), §3.2, §3.3 (all bullets except « Shared parser », « Which checklist », « Push rate »). The checklist half belongs to Cleo-2 (`feat/mobile-checklist`), not to this plan.

## Global Constraints

- New phone fields are optional and the feature sits behind a daemon capability flag (`daemon.models?: true` in the phone snapshot), « as `modelSwitch` is; an older PWA ignores them, a newer PWA on an older daemon shows neither chip ».
- « Apply is the confirmation »: picking changes nothing; only « Appliquer » sends. « Appliquer » disabled while the pick equals what runs.
- « Annuler le changement » while « au prochain tour »: sends `session.model` with what runs.
- Default: a session started without a model shows « Par défaut » (+ the default's name when the daemon knows it); choosing it sends `null`. Effort picker hidden for a tool without a separate effort (Cursor).
- Seat card outcomes, verbatim: « Enregistré ; appliqué à <session> », « Enregistré ; appliqué à <session> à la fin de son tour », « Enregistré sur le siège ; pas appliqué à <session> : <reason> »; « au prochain démarrage du siège » for a free seat or a session Ledge did not launch. A tool change on a held seat only saves and offers « Redémarrer ce siège ».
- Session-screen change: no passkey. Seat-card change: keeps the live-team sheet's passkey; the confirm text says the agent restarts.
- The gateway always asks the local daemon (`models.list` without `machineId`). Model descriptions shown in French.
- Shared files with Cleo-2 (`phone.ts`, `gateway.ts`, `project.ts`, `copy.ts`): additive, local changes only — do not reorder or reformat existing code.
- Do not push, open a PR, merge, release or deploy. Commit locally on `feat/mobile-model-change` only.
- Tests: `pnpm -r --no-bail --workspace-concurrency=1 test`; known pre-existing desktop failures: thread-images « a turn with attachments… » (always), session-conversation « a reconnect asks Nova's thread again… » (flaky).

## Review Focus

1. **Change sent while the agent works, then the respawn fails** — the phone must hear the failure (`session.model.failed`), not keep « au prochain tour » forever: the daemon clears `modelNext` and the chip shows one line. Test in Task 2 (respawn failure broadcasts coded error) and Task 3 (gateway forwards it).
2. **Replay after reconnect** — a `session.model` op resent with the same op id must not restart the agent twice: the registry replays the stored outcome. Test in Task 3.
3. **Older daemon** (no `daemon.models`) — no chip, no « Changer » on the seat card, `models.list` never sent. Test in Task 5 and 6.
4. **Seat held by a session Ledge did not launch / exited** — compose saves, does not try `session.model`, the card says « au prochain démarrage du siège »; never an error that blocks the save. Test in Task 2 and 6.
5. **Model list fails or is empty** (`models.listing.error`) — the sheet still shows « Par défaut » and the running model, with a one-line « Liste des modèles indisponible », and never offers a model the daemon did not list (anti-goal). Test in Task 5.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/protocol/src/models.ts` | `ModelRefusalSchema`, `SessionModelAcceptedSchema` |
| `packages/protocol/src/messages.ts` | `session.model.accepted` in `ServerMessageSchema` |
| `packages/protocol/src/teams.ts` | `TeamChangedSchema.models?` (`SeatModelOutcomeSchema`) |
| `packages/protocol/src/phone.ts` | phone session fields, snapshot flag, `models.list` read, `session.model` op, `models.listing`, `session.model.failed`, `operation.result.models` |
| `packages/ledge/src/daemon/server.ts` | `changeModel()`, coded refusals, accepted reply, coded late failures, compose apply |
| `packages/ledge/src/mobile/{gateway,project,operations,teamsOps}.ts` | relay, projection, fingerprint, compose outcome |
| `apps/mobile/src/state/{store,operations}.ts` | `requestModels`, `changeModel`, `modelFailures`, seat outcomes |
| `apps/mobile/src/model/modelChoice.ts` (new) | pure helpers: labels, running pick, sheet state |
| `apps/mobile/src/ui/ModelSheet.tsx` (new) | sheet body shared by session and seat (model list + effort) |
| `apps/mobile/src/screens/SessionModel.tsx` (new) | chip + session sheet, mounted in `Reply.tsx`'s quick row |
| `apps/mobile/src/screens/SeatModel.tsx` (new) | seat sheet, opened from `LiveTeam.tsx` seat card |
| `apps/mobile/src/copy.ts` | French strings |

---

### Task 1: Protocol

**Files:**
- Modify: `packages/protocol/src/models.ts`, `packages/protocol/src/messages.ts` (ServerMessageSchema), `packages/protocol/src/teams.ts:121`, `packages/protocol/src/phone.ts`
- Test: `packages/protocol/test/messages.test.ts`, `packages/protocol/test/teams.test.ts`, `packages/protocol/test/phone.test.ts`

**Interfaces:**
- Produces (models.ts):
  - `ModelRefusalSchema = z.enum(['not_launched','ended','no_conversation','not_running','effort_in_model','restart_failed','refused'])`, `type ModelRefusal`
  - `SessionModelAcceptedSchema = z.object({ type: z.literal('session.model.accepted'), id: z.string(), when: z.enum(['now','turn','none']) })` — in `ServerMessageSchema`.
- Produces (teams.ts): `SeatModelOutcomeSchema = z.object({ role: z.string(), session: z.string(), when: z.enum(['now','turn']).optional(), code: ModelRefusalSchema.optional() })`; `TeamChangedSchema` gains `models: z.array(SeatModelOutcomeSchema).max(16).optional()`.
- Produces (phone.ts):
  - `PhoneSessionSchema` picks also `model`, `effort`, `modelNext` from `SessionSchema` and extends `canSwitch: z.literal(true).optional()`.
  - snapshot `daemon` gains `models: z.literal(true).optional()`.
  - `OperationReasonSchema` gains `'scheduled'` and every `ModelRefusalSchema` option not already in it.
  - client read `{ type: 'models.list', tool: ToolSchema }`.
  - client op `{ type: 'session.model', op, id, model: ModelIdSchema.nullable(), effort: EffortSchema.nullable() }`.
  - `PhoneModelChoiceSchema` = ModelChoice with strings clipped by schema bounds (`id` ≤ 120, `label` ≤ 80, `description` ≤ 200, `efforts` ≤ 8, `.strict()`); server `{ type: 'models.listing', tool, models: z.array(PhoneModelChoiceSchema).max(40), error: z.literal(true).optional() }`.
  - server `{ type: 'session.model.failed', id: z.string(), reason: ModelRefusalSchema }`.
  - `operation.result` gains `models: z.array(z.object({ role, session, status: z.enum(['applied','scheduled','refused']), reason: ModelRefusalSchema.optional() })).max(16).optional()`; export `type PhoneSeatModel`.
  - `teamsDigest` must NOT change for a compose (seat model/effort already part of the seat content) — verify only.

- [ ] **Step 1: Write failing tests** — `messages.test.ts`: parses `{type:'session.model.accepted', id:'a', when:'turn'}`, rejects `when:'later'`. `teams.test.ts`: `team.changed` with `models:[{role:'leader', session:'s1', when:'now'}]` and `[{role:'r', session:'s2', code:'not_launched'}]` parse; 17 entries fail. `phone.test.ts`: session with `model:'opus', effort:'high', modelNext:{model:'sonnet'}, canSwitch:true` parses; `canSwitch:false` fails; client `session.model` with `model:null, effort:null` parses, without `op` fails; `models.list {tool:'claude'}` parses; `models.listing` with an unknown key inside a model fails (strict); `session.model.failed {id, reason:'restart_failed'}` parses, `reason:'boom'` fails; `operation.result` with `reason:'scheduled'` and with `models:[{role:'leader', session:'s1', status:'scheduled'}]` parses; snapshot daemon `models:true` parses.
- [ ] **Step 2: Run** `pnpm --filter @ledge/protocol test` — Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the schemas above (additive; place new phone variants next to their kin, e.g. `session.model` after the other session ops; extend `scopeIssue` only if it lists op types).
- [ ] **Step 4: Run** `pnpm --filter @ledge/protocol test && pnpm --filter @ledge/protocol typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(protocol): model change messages for the phone`

### Task 2: Daemon — coded, correlated model change; compose applies it

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts` (session.model case ~1375, `applyModelNext` 734-756, `applyOmpModel` 719-731, `composeTeam` 1034-1058)
- Test: `packages/ledge/test/server.test.ts` (describe 'session.model: a live session changes model (#58, lot 2)' ~1428), `packages/ledge/test/teams-server.test.ts`, `packages/ledge/test/omp-server.test.ts`

**Interfaces:**
- Consumes: Task 1 `ModelRefusal`, `session.model.accepted`, `SeatModelOutcome`.
- Produces: `changeModel(id: string, model: ModelId | null, effort: Effort | null): Promise<{ refused: ModelRefusal; message: string } | { when: 'now' | 'turn' | 'none' }>` (inner function of the server). Wire messages:
  - `session.model` refusal: `error { id, request:'session.model', message, code: ModelRefusal }`; success: reply `session.model.accepted { id, when }`.
  - late failure (after acceptance): broadcast `error { id, request:'session.model', message, code }` with `code` `restart_failed` (respawn failed), `refused` (OMP `set_model` failed), `no_conversation` / `not_launched` (what used to be the silent clear in `applyModelNext`). `modelNext` cleared in every case.
  - `team.changed` on `team.compose` carries `models: SeatModelOutcome[]` when any kept seat's model/effort changed while held.

Rules (decide here, tests pin them):
- Refusal order in `changeModel`: unknown → (existing `unknown session`, no code change); `source==='hook_only'` or (`source!=='launcher'` and backend not `omp-rpc`) → `not_launched`; `state==='exited'` → `ended`; no `resumeKey` → `no_conversation`; OMP not live → `not_running`; effort for a tool without `EFFORT_ARGS` (non-OMP) → `effort_in_model`.
- No-op (same model and effort): clears `modelNext` if any → `when:'none'`.
- `when` is decided **before** `store.patch(modelNext)` with the same guard `applyModelNext` uses: free(s) && !typing && !closing && not in `cardThreads.queuedRelays()` → `'now'`, else `'turn'`. Extract that guard into one helper `canApplyNow(id)` used by both.
- `composeTeam`: after the save and `startSeats`, for each seat present before and after with the **same tool** and a different `model` or `effort`, held by a session (`seatTeam`/team member lookup already used for leavers): if the holder can't switch (`not_launched`/`ended`/...), outcome `{role, session, code}` without calling it; else `changeModel(holder, seat.model ?? null, seat.effort ?? null)` and record `{role, session, when}` or `{role, session, code}`. Free seat or tool change: no entry.

- [ ] **Step 1: Write failing tests** (server.test.ts, in the existing describe):
  - `refuses a hook_only session with code not_launched`; `refuses an exited session with code ended`; `refuses a session without conversation with code no_conversation`; `refuses an effort for cursor with code effort_in_model` — each asserts `{type:'error', request:'session.model', code}`.
  - `answers accepted now when the session is idle` → `{type:'session.model.accepted', id, when:'now'}` and the respawn happens.
  - `answers accepted turn while the agent works` (state working) → `when:'turn'`, `modelNext` set, no respawn until idle.
  - `answers accepted none for a no-op and clears modelNext`.
  - `broadcasts restart_failed when the respawn fails` → error with `code:'restart_failed'`, `modelNext` undefined.
  - omp-server.test.ts: `a refused set_model broadcasts code refused`.
  - teams-server.test.ts: `compose applies a held seat's new model to its session` → `team.changed.models` = `[{role, session, when:'now'}]` and the session respawns with the model; `compose on a free seat sends no model change` → no `models`; `compose on a seat held by a hook_only session reports not_launched` → `[{role, session, code:'not_launched'}]`, save still applied; `compose changing a held seat's tool reports nothing` → no `models`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/server.test.ts test/teams-server.test.ts test/omp-server.test.ts` — new cases FAIL.
- [ ] **Step 3: Implement** `canApplyNow`, `changeModel`, the coded failures and the compose apply. Keep Desktop's behaviour otherwise (Desktop ignores `session.model.accepted` and unknown `error.code`; check `apps/desktop` handles an unknown server message type without crashing — grep its message switch).
- [ ] **Step 4: Run** the same command — PASS; then the whole `packages/ledge` suite.
- [ ] **Step 5: Commit** `feat(ledge): coded, correlated model change; compose applies it to the seat's session`

### Task 3: Gateway — relay, projection, outcomes

**Files:**
- Modify: `packages/ledge/src/mobile/gateway.ts`, `packages/ledge/src/mobile/project.ts` (`toPhoneSession`), `packages/ledge/src/mobile/operations.ts` (`Outcome`, `fingerprint`, registry), `packages/ledge/src/mobile/teamsOps.ts` (`outcomeOf`), `packages/ledge/src/daemon/server.ts:1571` (pass `models: true`)
- Test: `packages/ledge/test/mobile-gateway.test.ts`, `mobile-project.test.ts`, `mobile-operations.test.ts`, `mobile-teams-ops.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2 wire messages.
- Produces: gateway deps `models?: true`; snapshot `daemon.models` when set; `toPhoneSession(s, readAt)` — signature unchanged (Cleo-2's branch adds a third `checklist?` parameter) — adds `model`, `effort`, `modelNext` (clipped like other strings) and `canSwitch: true` when `s.source === 'launcher' && s.state !== 'exited'` (the daemon this ships with always has the model switch; old PWAs ignore the field); `Outcome` gains `models?: PhoneSeatModel[]`, stored and replayed by the registry and pushed in `operation.result`.

Rules:
- `models.list` read: dispatch local `{type:'models.list', requestId, tool}` (no `machineId`), await `models.listing` with that `requestId`, push phone `models.listing { tool, models (clipped to PhoneModelChoice, max 40), error? }`. Daemon error/timeout → `{tool, models: [], error: true}`. Ignored when the flag is off.
- `session.model` op: precheck — unknown session → rejected `unknown_session`; `!canSwitch` → rejected `ended` if exited else `not_launched`. Dispatch; `session.model.accepted` → applied (`when:'turn'` → reason `scheduled`); `error` with `request:'session.model'` and a `ModelRefusal` code → rejected with it; other `RefusalCode` → rejected; anything else → failed.
- Late failures: `forward()` maps broadcast `error {request:'session.model', id, code ∈ ModelRefusal}` to `session.model.failed {id, reason: code}` for devices following that session (same audience as `session.updated`).
- `receive()`: add `'session.model'` to the op types answered with `operation.result` on parse failure. `fingerprint`: include `model` and `effort`.
- Compose: `teamsOps.outcomeOf` maps `team.changed.models` to `PhoneSeatModel[]` (`when:'now'`→`applied`, `'turn'`→`scheduled`, `code`→`refused`+`reason`).

- [ ] **Step 1: Write failing tests**:
  - project: `projects model, effort, modelNext`, `canSwitch only for a launcher session not exited`.
  - gateway: `snapshot says models when the daemon can`; `models.list relays to the local daemon and pushes the listing`; `models.list failure pushes error true`; `session.model on an exited session is rejected ended without reaching the daemon`; `session.model on a hook_only session is rejected not_launched`; `session.model accepted turn → applied scheduled`; `accepted now → applied`; `daemon refusal effort_in_model → rejected effort_in_model`; `a late restart_failed reaches the phone as session.model.failed`; `a replayed session.model op is not dispatched twice` (Review Focus 2); `an unparsable session.model gets operation.result rejected`.
  - operations: `fingerprint differs by model and by effort`; `the registry replays models`.
  - teams-ops: `compose outcome carries seat models`.
- [ ] **Step 2: Run** `pnpm --filter @paradow/ledge exec vitest run test/mobile-*.test.ts` — new cases FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — PASS; then `pnpm --filter @paradow/ledge typecheck`.
- [ ] **Step 5: Commit** `feat(ledge): phone gateway relays model lists and model changes`

### Task 4: Mobile store

**Files:**
- Modify: `apps/mobile/src/state/store.ts`, `apps/mobile/src/state/operations.ts` (`isVolatile`), `apps/mobile/src/state/chat.ts` (`ChatAction`)
- Test: `apps/mobile/test/state/store.test.ts`, `apps/mobile/test/state/teams-store.test.ts`, `apps/mobile/test/state/operations.test.ts`

**Interfaces:**
- Consumes: Task 1 phone types.
- Produces:
  - `MobileState.daemon` gains `models?: true`; `MobileState.models: Record<string, { models: PhoneModelChoice[]; error?: true }>` keyed by tool (cache for the link's life; reset on a new boot).
  - `MobileState.modelFailures: Record<string, ModelRefusal>` (session id → last late failure; cleared when a new `changeModel` for that id is sent or the session's `modelNext`/`model` changes).
  - `MobileStore.requestModels(tool: string): void` — sends the `models.list` read once per tool per link (again after an `error`).
  - `MobileStore.changeModel(id: string, model: string | null, effort: string | null): Promise<ChatAction>` — an op `session.model`, volatile (added to `isVolatile`: never replayed after a reload).
  - `ChatAction` applied gains `scheduled?: true` (from reason `scheduled`) and `models?: PhoneSeatModel[]` (from `operation.result.models`, kept on the `Op`).

- [ ] **Step 1: Write failing tests**: `requestModels sends once per tool and stores the listing`; `requestModels asks again after an error listing`; `changeModel resolves applied scheduled on reason scheduled`; `changeModel resolves rejected not_launched`; `session.model.failed is kept per session and cleared by the next changeModel`; `a session.model op is not replayed after reload` (operations.test); `teamOp compose resolves applied with models` (teams-store.test).
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile exec vitest run test/state` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `pnpm --filter @ledge/mobile typecheck`.
- [ ] **Step 5: Commit** `feat(mobile): store asks model lists and sends model changes`

### Task 5: Mobile — session chip and model sheet

**Files:**
- Create: `apps/mobile/src/model/modelChoice.ts`, `apps/mobile/src/ui/ModelSheet.tsx`, `apps/mobile/src/screens/SessionModel.tsx`
- Modify: `apps/mobile/src/screens/Reply.tsx:63-69` (chip at head of the quick row), its parent that renders `Reply` (pass the session/store), `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/model/model-choice.test.ts` (new), `apps/mobile/test/screens/session-model.test.tsx` (new), `apps/mobile/test/screens/reply.test.tsx`

**Interfaces:**
- Consumes: Task 4 store API.
- Produces (modelChoice.ts):
  - `modelLabel(tool: string, id: string | undefined, models: PhoneModelChoice[]): string` — the listing's label, else the id, `undefined` → `copy.model.byDefault` (+ ` · <default label>` when a model has `isDefault`).
  - `effortLabel(e: string): string` — `low 'Bas', medium 'Moyen', high 'Élevé', xhigh 'Très élevé', max 'Max', ultra 'Ultra'`, else the id.
  - `modelHint(tool, m: PhoneModelChoice): string | undefined` — French by `tool:id`: `claude:fable 'Le plus capable'`, `claude:opus 'Très capable, plus lent'`, `claude:sonnet 'Équilibré, au quotidien'`, `claude:haiku 'Rapide et économique'`; else `m.description`.
  - `type Pick = { model: string | null; effort: string | null }`; `samePick(a: Pick, b: Pick): boolean`; `running(s: PhoneSession): Pick`.
  - `efforts(tool, models, pick): string[] | null` — the picked model's `efforts` (default model: the `isDefault` one's), `null` for `cursor` or none.
- Produces (ModelSheet.tsx): `ModelSheet({ tool, models, error, current, pick, onPick, note, actions })` — list « Par défaut » first then the listing (never other ids, except the running one when missing from the listing, shown as its id), « actuel » badge on `current`, effort segmented control when `efforts()` is non-null, `note` paragraph, `actions` footer. Reused by Task 6.
- Produces (SessionModel.tsx): `SessionModelChip({ store, session })` — renders nothing unless `daemon.models && session.canSwitch`; chip text `modelLabel · effortLabel`; when `session.modelNext`: chip shows the next pick + « au prochain tour »; a `modelFailures[id]` shows one line (`copy.model.failed[reason]`) under the row. Tap opens the sheet (calls `requestModels(session.tool)`).

Copy (`copy.model`, verbatim from the mockup): title « Modèle et effort », subtitle « Les modèles de <tool label> connus du PC », `byDefault` « Par défaut », default hint « Celui que l'agent prend de lui-même », `current` « actuel », effort title « Effort », effort hint « Temps de réflexion par tour », note idle « <name> redémarre sur la même conversation et garde son contexte. », note working « <name> travaille : le changement attendra la fin de son tour. », `apply` « Appliquer », `cancel` « Annuler », `cancelPending` « Annuler le changement », `nextTurn` « au prochain tour », `listError` « Liste des modèles indisponible », outcomes `applied` « Appliqué », `scheduled` « Appliqué au prochain tour », `failed` per reason: `not_launched` « pas lancé par Ledge », `ended` « session terminée », `no_conversation` « aucune conversation à reprendre », `not_running` « l'agent ne tourne pas », `effort_in_model` « cet outil prend l'effort dans le modèle », `restart_failed` « le redémarrage a échoué », `refused` « refusé par l'outil » — the chip's failure line is « Changement de modèle non appliqué : <reason> ».

- [ ] **Step 1: Write failing tests**: model-choice: labels/hints/efforts (cursor → null; default model's efforts); session-model: `no chip without daemon.models`, `no chip when canSwitch is absent`, `chip shows Opus · Élevé`, `chip shows the next pick and au prochain tour`, `Appliquer is disabled while the pick equals what runs`, `Appliquer sends changeModel with the pick`, `choosing Par défaut sends null`, `effort control hidden for cursor`, `Annuler le changement sends what runs`, `a list error still shows Par défaut and the running model`, `a late failure shows its line`. reply.test: the chip sits before the first quick reply.
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile exec vitest run test/model/model-choice.test.ts test/screens/session-model.test.tsx test/screens/reply.test.tsx` — FAIL.
- [ ] **Step 3: Implement** with the existing `Sheet` (`ui/Dialog.tsx`) and chip classes (`chipClass()` in Reply). Follow the mockup board `SessionModel` (artifact link in the spec).
- [ ] **Step 4: Run** — PASS; mobile typecheck + lint.
- [ ] **Step 5: Commit** `feat(mobile): model chip and sheet in the session`

### Task 6: Mobile — seat card model sheet

**Files:**
- Create: `apps/mobile/src/screens/SeatModel.tsx`
- Modify: `apps/mobile/src/screens/LiveTeam.tsx` (seat cards 103-130: « Changer » + pending line), `apps/mobile/src/screens/TeamEditor.tsx` (279-299: use the compose result's `models` instead of `t.nextStart` for seats it names), `apps/mobile/src/model/teamsOutcome.ts` (seat model outcome note), `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/screens/seat-model.test.tsx` (new), `apps/mobile/test/screens/live-team.test.tsx`, `apps/mobile/test/screens/team-editor.test.tsx`

**Interfaces:**
- Consumes: Task 4 `teamOp`, `requestModels`; Task 5 `ModelSheet`, `modelChoice` helpers.
- Produces: `SeatModelSheet({ store, team, role, onClose })` — tool (read-only label + « changer redémarre le siège » only when held), « IA · connues du PC » list via `ModelSheet`, effort; on « Appliquer »: `teamOp({type:'team.compose', team: team.id, seats: <saved seats with this role's model/effort replaced>})` (build the seats with the same helper `TeamEditor` uses: `seatsOfTeam`/`seatOut`); outcome line from `seatModelNote(outcome, role, sessionName): string`.
  - Notes in the sheet (verbatim): « Enregistré sur le siège pour ses prochains démarrages. », held and can switch: « Appliqué aussi tout de suite à <session>, sur la même conversation. » (working: « Appliqué aussi tout de suite à <session>, sur la même conversation : il travaille, ce sera à la fin de ce tour. »), held but cannot switch / free: « au prochain démarrage du siège ». Passkey line: « Votre passkey confirme le changement. » The confirm text (passkey prompt) names the restart: « <session> redémarre sur la même conversation. »
  - Outcomes: `applied` → « Enregistré ; appliqué à <session> »; `scheduled` → « Enregistré ; appliqué à <session> à la fin de son tour »; `refused` → « Enregistré sur le siège ; pas appliqué à <session> : <copy.model.failed[reason]> »; no entry for a held seat whose holder cannot switch → « Enregistré · au prochain démarrage du siège ».
- « Changer » shows on a seat card only when `daemon.models`. Free seat card line: « au prochain démarrage du siège ».

- [ ] **Step 1: Write failing tests**: live-team: `Changer opens the seat model sheet`, `no Changer without daemon.models`; seat-model: `Appliquer composes the team with the seat's new model and effort, other seats unchanged`, `applied outcome reads Enregistré ; appliqué à Otto`, `scheduled reads … à la fin de son tour`, `refused restart_failed reads Enregistré sur le siège ; pas appliqué à Otto : le redémarrage a échoué`, `free seat says au prochain démarrage du siège`, `a seat held by a session that cannot switch says au prochain démarrage du siège`; team-editor: `a compose whose result names a seat shows its model note instead of nextStart`.
- [ ] **Step 2: Run** `pnpm --filter @ledge/mobile exec vitest run test/screens/seat-model.test.tsx test/screens/live-team.test.tsx test/screens/team-editor.test.tsx` — FAIL.
- [ ] **Step 3: Implement**, following mockup board `SeatModel`. A tool change on a held seat is not offered here (tool is read-only in this sheet); TeamEditor's existing tool change + « Redémarrer ce siège » stays as is.
- [ ] **Step 4: Run** — PASS; mobile typecheck + lint.
- [ ] **Step 5: Commit** `feat(mobile): change a live seat's model from its card`

### Task 7: Full verification

- [ ] **Step 1:** `pnpm -r typecheck` — no error.
- [ ] **Step 2:** `pnpm -r lint` (or each package's lint script) — no error.
- [ ] **Step 3:** `pnpm -r --no-bail --workspace-concurrency=1 test` — only the two known desktop failures may appear; anything else is fixed (desktop: run its e2e from `apps/desktop` if the suite touches `session.model`).
- [ ] **Step 4:** Final whole-branch review; fix findings; commit.
