# The phone when Ledge orchestrates OpenRig — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone app shows Ledge as OpenRig's orchestrator: Ledge's thread with escalations and folded rig exchanges, « Le point », À toi via Ledge, Rigs and their pages, Projets for lone sessions, launching and acting on a rig.

**Architecture:** The shared contract `packages/protocol/src/openrig.ts` (Desktop plan, lot 2) is the source of every name. The phone gets **projections** of it in `packages/protocol/src/phone.ts`, with no path, no machine and no `cwd`; a rig is named by an opaque `key` the gateway maps to `(machine, rigId)`. The daemon's mobile gateway translates between the two through one module, `packages/ledge/src/mobile/orchestrator.ts`. The PWA switches to the new tabs when the snapshot says `daemon.openrig: true`.

**Tech Stack:** TypeScript, zod, React 19, Tailwind 4, vitest + Testing Library, Playwright (e2e on the relay harness).

**Spec:** [docs/superpowers/specs/2026-10-30-ledge-mobile-orchestrator-design.md](../specs/2026-10-30-ledge-mobile-orchestrator-design.md). Mockup: <https://claude.ai/artifact/2FXtE18YzaXkkKD7ZXGC32>, local copy `docs/mockups/ledge-mobile-orchestrator/`. Contract: `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md` (session Plume, branch `docs/ledge-openrig-orchestrator`), sections « Le contrat de protocole » and « Correspondance mobile ».

**When:** this is **lot 9** of the Desktop plan. It starts once lots 2 (pont), 4 (fil et réponses) and 5 (cycle et lancement) are merged into `main`; Ledge's advice (`Escalation.advice`) and rules come with lot 7. Lot 1 has already removed the team screens, `PhoneSessionSchema.role/team` and `daemon.teams` from the phone. Task 0 is the gate.

## Global Constraints

- Names come from the contract: `Rig`, `RigSeat`, `Escalation`, `LedgeDecision`, `LedgeRule`, `Exchange`, `LedgeThreadItem`, `RigPlan`, `MandateCategory`, `ALWAYS_USER`, `EXCHANGES_MAX` (200). Phone projections are `Phone<Name>`. Never `Decision` or `Rule` alone (they exist in `decisions.ts` and `projects.ts`).
- Only Ledge contacts the user: no phone card, message or notification shows a rig agent as its sender. An escalation is shown as « Ledge te passe une question de … ».
- Passkey for acts only (user, 2026-10-30): `rig.launch` and `rig.act` need an assertion. `escalation.answer`, `decision.revisit`, `ledge.say` and `rig.prepare` never do. (contract corrected by Plume on 2026-10-30 to match.)
- The phone never receives a path, a `cwd`, a machine, a tmux name or a `command`. A rig's working copy is shown as `.worktrees/rig-<name>`, built by the phone.
- Lifecycle goes through OpenRig: `session.close`, `resume`, `model` on a session with `rig` set are refused by the daemon with `rig_managed` (lot 5); the phone hides those actions for such a session.
- Tabs when `daemon.openrig`: `Ledge`, `À toi`, `Rigs`, `Projets` (copy keys `nav.chat`, `nav.toYou`, `nav.rigs`, `nav.projects`). Without it the phone keeps the lot-1 tabs (`Ledge`, `À traiter`, `Agents`).
- `PHONE_PROTOCOL` stays `1`; every addition is optional.
- UI copy is French, verbatim from the mockup where quoted; the contract's labels win where they overlap (« À toi », « Rigs », « Noyau OpenRig », « Tranché aujourd'hui », « Revenir dessus », « Écrire à Ledge… (@build pour un agent d'un rig) »).

## Review Focus

- **An escalation answered twice** (notification action, then the card; or the brain after its 60 s grace): the daemon answers `already_answered`; the card shows the recorded answer (`answer.by`, its option), not an error. → Task 2 test `second answer is already_answered`, Task 6 test `already answered shows the recorded choice`.
- **An escalation with several questions** (`questions` up to 4) or none (`ledge ask` with free text): one-tap buttons only when there is exactly one question; otherwise the detail screen collects every answer and sends one `escalation.answer`; no question → a text field (`answers: { text }`). → Task 6 tests `two questions need the detail`, `free text ask`.
- **A rig removed while its page is open** (`rig.removed`): the page says « Ce rig est arrêté » with a link back to Rigs. → Task 7 test `rig page when the rig is removed`.
- **Two machines with a rig of the same id** (lot 6): the phone's `key` keeps them apart and an action reaches the right machine. → Task 2 test `same rigId on two machines`.
- **A plan card confirmed after the daemon restarted** (`planId` unknown): `rig.launch` is refused (`invalid` in `RIG_RESULT_CODES`); the card offers « Redemander à Ledge » and is not left spinning. → Task 2 test `launch of an unknown plan`, Task 9 test `unknown plan after restart`.

---

### Task 0: Gate

No product code.

**Files:**
- Modify: this plan, « Task 0 result » at the bottom.

- [ ] **Step 1: Check lots 2, 4, 5 are merged**

Run: `git fetch origin && git grep -n "export const EscalationSchema\|rig.prepare\|ledge.thread.item" origin/main -- packages/protocol/src`
Expected: all three found. Otherwise stop.

- [ ] **Step 2: Diff the contract against this plan**

Run: `git show origin/main:packages/protocol/src/openrig.ts` and compare with Task 1's « Consumes ». Write every renamed or added field in « Task 0 result »; later tasks use the merged names.

- [ ] **Step 3: Find the fleet hooks and the gateway entry points**

Note the file:line of: where the daemon emits `rig.snapshot`, `escalation.updated`, `ledge.thread.item`, `decisions`, `rig.plan` to clients; the handlers of `escalation.answer`, `rig.prepare`, `rig.launch`, `rig.act`, `rig.exchanges.request`, `ledge.say`, `decision.revisit`; and how `packages/ledge/src/mobile/gateway.ts` is told about daemon events today.

- [ ] **Step 4: Check `PhoneSessionSchema` picks `rig` and `brain`**

If lots 2 and 7 did not add them, Task 1 adds them (agreed with Plume, 2026-10-30).

- [ ] **Step 5: Commit** — `git commit -m "docs(plan): mobile lot 9 gate results"`

---

### Task 1: Protocol — phone projections of the contract

**Files:**
- Modify: `packages/protocol/src/phone.ts`
- Test: `packages/protocol/test/phoneOpenrig.test.ts`

**Interfaces:**
- Consumes: from `./openrig.js`: `RigSeatSchema`, `RigLifecycleSchema`, `EscalationSchema`, `ExchangeSchema`, `LedgeDecisionSchema`, `LedgeThreadItemSchema` (shape only), `RigPlanSchema`, `RigVerbSchema`, `MandateCategorySchema`, `RIG_RESULT_CODES`, `EXCHANGES_MAX`.
- Produces (exported from `@ledge/protocol`), all strict:
  - `PhoneRigSchema` = `{ key: string≤64, name, spec?, project: string≤80 | null, offProject: boolean, branch?, lifecycle: RigLifecycle, kernel: boolean, seats: RigSeat[] ≤16, repos: int≥0 }` — no `id`, `machine`, `cwd`, repo paths.
  - `PhoneExchangeSchema` = `ExchangeSchema.omit({ machine: true, rigId: true }).extend({ rigKey: string≤64, text: string≤TOOL_TEXT_MAX, cut?: true })`.
  - `PhoneEscalationSchema` = `EscalationSchema.omit({ machine: true, rigId: true, evidenceRef: true, replyTo: true }).extend({ rigKey?: string≤64, rigName?: string≤60, rules?: { text: string≤200, since: string≤10 }[] ≤5 })` — `rules` are the active `LedgeRule`s of the same category, Ledge's « souvenirs ».
  - `PhoneLedgeDecisionSchema` = `LedgeDecisionSchema` (no paths in it), plus `rigName?`.
  - `PhoneThreadItemSchema`: the contract's union with the `exchanges` member replaced by `{ kind: 'exchanges', id, at, rigKey, rigName, from, to, count: int≥1, items: PhoneExchange[] ≤20 }`, and `escalation` / `decided` items carrying their object inline (`escalation: PhoneEscalation`, `decision: PhoneLedgeDecision`) so the relay payload stands alone; the `card` member uses the existing `PhoneChatActionSchema`; plus `{ kind: 'plan', id, at, plan: PhoneRigPlan }`.
  - `PhoneRigPlanSchema` = `RigPlanSchema.omit({ machine: true, cwd: true, command: true }).extend({ where: { kind: 'project', project: string≤80, branch, copy: boolean } | { kind: 'off-project', name }, launchedRigKey?: string≤64, launchedAt?: datetime })`.
  - Snapshot: `daemon.openrig?: true`; `rigs?: PhoneRig[] ≤40`; `escalations?: PhoneEscalation[] ≤40`; `decisionsToday?: PhoneLedgeDecision[] ≤50`.
  - Server messages: `rig.updated { rig }`, `rig.removed { key }`, `rig.exchanges { key, items: PhoneExchange[] ≤EXCHANGES_MAX, cut?: true }`, `escalation.updated { escalation }`, `escalation.removed { id }`, `ledge.thread.item { item }`, `ledge.thread.history { items ≤THREAD_PAGE, before? }`, `decisions { items }`, `rig.plan { plan }`.
  - Client messages: `ledge.say { op, text: 1..MESSAGE_MAX, about?: string≤64 }`, `ledge.thread.request { before? }`, `escalation.answer { op, id, answers: Record<string≤64, string≤MESSAGE_MAX> }`, `decision.revisit { op, id, text? }`, `rig.exchanges.request { key }`, `rig.prepare { op, goal: 1..600, spec?: string≤64, project: string≤80 | null }`, `rig.launch { op, planId, assertion? }`, `rig.act { op, key, verb: 'down' | 'restart', seatRef?: string≤120, assertion? }`.
  - `rigSubject(m)`: `launch@<planId>` | `<verb>@<key>` | `<verb>@<key>/<seatRef>`; `confirm.prepare` accepts purpose `'rig'`.
  - `operation.result` reasons gain `rig_managed`, `already_answered` and every `RIG_RESULT_CODES` member.

- [ ] **Step 1: Failing tests** in `phoneOpenrig.test.ts`:
  - `snapshot without openrig parses` (a lot-1 snapshot).
  - `a rig carries no path`: `cwd` or `machine` on `PhoneRigSchema` → fails.
  - `escalation projection`: a contract `Escalation` with `machine`, `evidenceRef` → the projection built by `omit` rejects them; one with `category: 'architecture'`, two options, `recommended` on the first, `advice`, two `rules` → parses.
  - `escalation.answer has no assertion field` (strict).
  - `rig.act verbs`: `'down'`, `'restart'` parse; `'up'` fails.
  - `rigSubject`: `rig.launch planId=P` → `'launch@P'`; `rig.act down key=K` → `'down@K'`; restart with `seatRef=dev-build@starter` → `'restart@K/dev-build@starter'`.
  - `thread item with inline exchanges`: 21 items → fails; 3 → parses.
- [ ] **Step 2: Run** — `pnpm --filter @ledge/protocol exec vitest run test/phoneOpenrig.test.ts`, FAIL.
- [ ] **Step 3: Implement** with `.omit()/.extend()` on the contract schemas, `.strict()`, `.max()` on every string and array.
- [ ] **Step 4: Run** — `pnpm --filter @ledge/protocol test`, PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(protocol): phone projections of the openrig contract"`

---

### Task 2: Gateway — `orchestrator.ts`

**Files:**
- Create: `packages/ledge/src/mobile/orchestrator.ts`
- Modify: `packages/ledge/src/mobile/gateway.ts`, `packages/ledge/src/mobile/challenges.ts`, the daemon wiring noted in Task 0 step 3
- Test: `packages/ledge/test/mobile-orchestrator.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function rigKey(machine: string, rigId: string): string;            // stable, opaque (sha256 truncated to 16 hex)
  export function toPhoneRig(r: Rig, projectName: (id: string) => string | undefined): PhoneRig;
  export function toPhoneEscalation(e: Escalation, rules: LedgeRule[], rigs: Rig[]): PhoneEscalation;
  export function toPhoneThreadItem(i: LedgeThreadItem, ctx: ThreadCtx): PhoneThreadItem | null; // null: nothing to show
  export function toPhonePlan(p: RigPlan, projectName: (id: string) => string | undefined): PhoneRigPlan;
  export function fromPhone(m: PhoneRigMessage, keys: Map<string, { machine: string; rigId: string }>): ClientMessage | { refused: RigResultCode };
  ```
  `fromPhone` turns `rig.act { key, verb, seatRef }` into the contract's `rig.act { rid: op, machine, rigId, verb, seatRef }`, `rig.exchanges.request { key }` into `{ machine, rigId }`, `escalation.answer` into `{ rid: op, id, answers, by: 'user' }`, and so on; an unknown key → `{ refused: 'invalid' }`.
- The gateway relays the contract's server messages through the `toPhone*` functions and sends the snapshot fields of Task 1 when the daemon says `openrig`.

- [ ] **Step 1: Failing tests** (fake daemon events, as `mobile-gateway.test.ts` builds its gateway):
  - `snapshot says openrig` with two rigs, one escalation pending, today's decisions only (`by: 'ledge'`, `at` today).
  - `no path reaches the phone`: serialize every phone message of the test → no `cwd`, `/home`, `machine` substring.
  - `same rigId on two machines`: two keys; `rig.act down` on the second reaches machine 2.
  - `exchanges capped`: 350 contract exchanges → phone `rig.exchanges` has 200, `cut: true`, the most recent.
  - `answer without passkey`: device registered, `escalation.answer` without assertion → forwarded with `by: 'user'`.
  - `second answer is already_answered`: the daemon's `already_answered` → `operation.result rejected already_answered`.
  - `act needs the passkey`: `rig.act` without assertion → `rejected confirm_required`; with a valid one over `down@K` → forwarded.
  - `launch of an unknown plan`: daemon result `invalid` → `rejected invalid`.
  - `prepare is forwarded and its plan comes back as a thread item`.
  - `the brain session is not a lone session`: a session with `brain: true` is not in the phone's session list.
- [ ] **Step 2: Run** — `pnpm --filter @ledge/ledge exec vitest run test/mobile-orchestrator.test.ts`, FAIL.
- [ ] **Step 3: Implement**; `rig` purpose in `challenges.ts` with `rigSubject`; idempotence is the daemon's (`rid` = phone `op`).
- [ ] **Step 4: Run** — `pnpm --filter @ledge/ledge test`, PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(ledge): the mobile gateway relays rigs, escalations and Ledge's thread"`

---

### Task 3: Phone state and model

**Files:**
- Create: `apps/mobile/src/model/rigs.ts`, `apps/mobile/src/model/point.ts`
- Modify: `apps/mobile/src/state/store.ts`, `apps/mobile/src/state/chat.ts` (the thread when `openrig`)
- Test: `apps/mobile/test/model/rigs.test.ts`, `apps/mobile/test/model/point.test.ts`, `apps/mobile/test/state/openrig-store.test.ts`

**Interfaces:**
- Produces:
  - `rigPlace(r: PhoneRig): string` → `dans <project>` | `hors projet`.
  - `rigProgress(r): { working: number; total: number }` — `working` = seats in `working` | `starting` | `trust`.
  - `rigColor(key: string): string` — one of six fixed tokens, stable per key.
  - `rigCopyName(name: string): string` → `.worktrees/rig-<name>`.
  - `sortRigs(rigs): PhoneRig[]` — rigs with an escalation pending first, then `running`/`partial`, `launching`, `stopped`, kernel last.
  - `foldLabel(i: PhoneThreadItem & { kind: 'exchanges' }): string` → `3 échanges · 16:36 → 16:42`; `1 échange · 16:31` when from and to share the minute.
  - `point(state): { toYou: number; rigs: { key; name; working; total }[]; ruled: number }` — `toYou` = escalations in `pending` + lone-session pendings; `grace` ones are not counted (Ledge may still decide).
  - Store: `openrig`, `rigs` (by key), `escalations` (by id), `decisionsToday`, `thread` (items by id; an item with a known id **replaces** the old one), `rigExchanges[key]`; actions `requestExchanges(key)`, `loadOlderThread()`.
- [ ] **Step 1: Failing tests** with the values above, plus: `rig.removed` drops the rig; a replaced thread item keeps its position; a lot-1 snapshot leaves `openrig` false.
- [ ] **Step 2: Run** — `pnpm --filter @ledge/mobile exec vitest run test/model/rigs.test.ts test/model/point.test.ts test/state/openrig-store.test.ts`, FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): rigs, escalations and Ledge's thread in the phone's state"`

---

### Task 4: Tabs and routes

**Files:**
- Modify: `apps/mobile/src/ui/TabBar.tsx`, `apps/mobile/src/router.ts`, `apps/mobile/src/App.tsx`, `apps/mobile/src/copy.ts`, `apps/mobile/src/ui/icons.tsx` (`folder`)
- Test: `apps/mobile/test/router.test.ts`, `apps/mobile/test/screens/app.test.tsx`

**Interfaces:**
- Routes: `{ name: 'rigs' }`, `{ name: 'rig'; key: string; view: 'seats' | 'exchanges' | 'queue' }` (`#/rig/<key>/<view>`, `#/rig/<key>` = seats), `{ name: 'projects' }`, `{ name: 'escalation'; id: string }` (`#/escalation/<id>`), `{ name: 'new-rig' }`. `TabBar` takes `openrig: boolean`.
- Copy: `nav.toYou: 'À toi'`, `nav.rigs: 'Rigs'`, `nav.projects: 'Projets'`, `nav.backTo.rigs: 'Retour aux rigs'`, `nav.backTo.toYou: 'Retour à À toi'`.
- [ ] **Step 1: Failing tests**: route parsing and `href` round-trip for each new route; `openrig PC shows Ledge, À toi, Rigs, Projets`; `lot-1 PC keeps Ledge, À traiter, Agents`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; until Tasks 6–9 land, `projects` renders `Agents`, the other new routes render `Agents` too. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): Ledge, À toi, Rigs, Projets tabs for an OpenRig PC"`

---

### Task 5: Ledge screen

**Files:**
- Create: `apps/mobile/src/screens/LedgeThread.tsx`, `apps/mobile/src/ui/ledge/{Bubble,EscalationCard,ExchangeFold,DecidedLine,PointStrip,PointSheet}.tsx`
- Modify: `apps/mobile/src/screens/Chat.tsx` (renders `LedgeThread` when `openrig`), `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/screens/ledge-thread.test.tsx`

**Interfaces:**
- Consumes: Task 3 `point`, `foldLabel`, `thread`; sends `ledge.say`, `ledge.thread.request`, `escalation.answer`, `decision.revisit`.
- Produces: `EscalationCard({ escalation, onAnswer(answers: Record<string,string>), onTalk() })`, `ExchangeFold({ item, onOpenRig(key) })`, `PointStrip({ point, onOpen(section, key?) })`, `PointSheet({ section })`.
- Copy: subtitle `Orchestre ${n} rigs · ${m} agents · tranche dans son mandat`; mandate line `tranche dans son mandat · design, architecture et critique te reviennent`; category labels from `MANDATE_CATEGORY_LABEL`; `En parler`; `Tu as choisi ${label} · ${hh:mm}`; `Ledge a tranché · ${hh:mm}`; `Revenir dessus`; fold `Voir ▸`, `Replier ▴`, `Ouvrir le fil de ${rig} ›`; sheet `Le point · ${hh:mm}`, `À toi`, `Rigs`, `Tranché aujourd'hui`, `Résumer la journée`; suggestions `Lance un rig…`, `Où en est ${rig} ?`, `Qu'as-tu tranché ?`, `Qui a besoin de moi ?`; placeholder `Écrire à Ledge… (@build pour un agent d'un rig)`.
- [ ] **Step 1: Failing tests**: user items right, Ledge items left with the mascot; a `pending` Ledge item shows the typing state; an `escalation` item renders the card inside Ledge's bubble with the category, `orch-lead@factory`, question, `advice`, buttons in option order with the recommended one primary; tapping sends `escalation.answer { answers: { [qId]: optId } }` with no passkey prompt; `En parler` sends nothing and focuses the composer with `about` set (sent with the next `ledge.say`); an `exchanges` item is folded with `foldLabel` and opens on its items; a `decided` item shows `Revenir dessus`, which sends `decision.revisit`; `Le point` reads `À toi 3`, `factory 4/6`, `Tranché 3` and opens the sheet on the tapped section; `Résumer la journée` sends `ledge.say { text: 'Résume ma journée.' }`; scrolling to the top sends `ledge.thread.request { before }`; a lot-1 PC still gets today's chat.
- [ ] **Step 2: Run** — `pnpm --filter @ledge/mobile exec vitest run test/screens/ledge-thread.test.tsx`, FAIL.
- [ ] **Step 3: Implement** (Ledge bubble `rounded-[4px_18px_18px_18px]`, escalation border `--color-attention`, Ledge rows in folds on `--color-danger-bg`).
- [ ] **Step 4: Run** — PASS; `chat.test.tsx`, `chat-cards.test.tsx` still PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): Ledge's thread with escalations, rig folds and le point"`

---

### Task 6: À toi and an escalation in full

**Files:**
- Create: `apps/mobile/src/ui/ViaLedgeCard.tsx`, `apps/mobile/src/screens/EscalationDetail.tsx`
- Modify: `apps/mobile/src/screens/Inbox.tsx`, `apps/mobile/src/model/requests.ts`, `apps/mobile/src/App.tsx`, `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/screens/to-you.test.tsx`, `apps/mobile/test/model/requests.test.ts`

**Interfaces:**
- Produces: `toYouItems(state, filter: 'all' | 'ledge' | 'sessions'): ({ kind: 'escalation'; escalation } | { kind: 'session'; session })[]`, oldest first.
- Copy: `À toi`; `${n} décisions. Ledge en a tranché ${m} autres.`; `Tout`, `Via Ledge`, `Sessions`; `Via Ledge · rigs`, `Sessions seules`; `Ledge te passe une question d'${from} · ${rig}` (source `rig`), `Ledge te passe une question de l'operator` (`operator`), `Ledge te passe une question de ${from}` (`ask`); detail `Ce que dit ${from}`, `L'avis de Ledge`, `Ce dont Ledge se souvient`; sheet `Répondre à ${from}`, `· recommandé par Ledge`, `En parler avec Ledge`; note `Ta réponse part d'un geste. Seuls les actes (lancer, arrêter, relancer un rig, accords risqués) demandent la clé d'accès.`
- [ ] **Step 1: Failing tests**: `toYouItems` mixes one escalation and two lone pendings oldest first; filters; the card shows Ledge's mascot, never the agent's bot; one question → buttons on the card; `two questions need the detail`: the card shows « Répondre » only, the detail sends one `escalation.answer` with both answers; `free text ask` (`questions: []`) sends `{ text }`; the detail lists the recommended option first and sends its own `id`; `already answered shows the recorded choice`; a `grace` escalation shows `Ledge s'en occupe…` and stays answerable; a lone session's permission keeps `session.decide` and today's passkey rule.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `inbox.test.tsx`, `request-detail.test.tsx` still PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): À toi with escalations passed up by Ledge"`

---

### Task 7: Rigs tab and a rig's page

**Files:**
- Create: `apps/mobile/src/screens/Rigs.tsx`, `apps/mobile/src/screens/Rig.tsx`, `apps/mobile/src/ui/RigCard.tsx`, `apps/mobile/src/ui/SeatRow.tsx`
- Modify: `apps/mobile/src/App.tsx`, `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/screens/rigs.test.tsx`, `apps/mobile/test/screens/rig.test.tsx`

**Interfaces:**
- Consumes: Task 3 helpers; `rig.exchanges.request`; `rig.act` with the device check of `screens/device.ts` (as `SessionClose`).
- Copy: `Rigs`; `${n} rigs · ${m} agents · noyau OpenRig ${state}`; `rig · ${n} sièges`; `${k}/${n} au travail`; `au repos`; `${n} dépôts trouvés`; `Noyau OpenRig`; segments `Sièges · ${n}`, `Échanges · ${n}`, `Queue · ${n}`; `Relancer un siège…`, `Arrêter le rig…`; `Écrire à Ledge sur ${rig}…`; `${n} derniers échanges`; `Ce rig est arrêté`; OpenRig states from `openrig.status` (« OpenRig ‹v› non pris en charge », etc., as Desktop).
- [ ] **Step 1: Failing tests**: Rigs lists rigs by `sortRigs`, kernel last, `hors projet` with `repos`; a card shows place, branch, `4/6 au travail`, seat chips, last exchange; Sièges lists `address`, `name`, `runtime · model`, `contextPct` gauge, state pill; tapping a seat with `sessionId` opens `#/thread/<sessionId>`; Échanges sends `rig.exchanges.request` once, marks `kind: 'ledge'` rows, shows the cap notice when `cut`; Queue shows the exchanges of kind `task` | `handoff`; `Arrêter le rig…` → passkey → `rig.act { verb: 'down' }`; `Relancer un siège…` → seat picker → passkey → `rig.act { verb: 'restart', seatRef }`; `rig page when the rig is removed`; the composer sends `ledge.say { text: '@<rig> …' }` and switches to the Ledge tab.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): Rigs tab and a rig's page"`

---

### Task 8: Projets

**Files:**
- Modify: `apps/mobile/src/screens/Agents.tsx` (Projets when `openrig`), `apps/mobile/src/model/agents.ts`, `apps/mobile/src/screens/Thread.tsx` (hide close / resume / model for a `rig` session), `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/screens/projects.test.tsx`, `apps/mobile/test/model/agents.test.ts`

**Interfaces:**
- Produces: `loneSessions(sessions): PhoneSession[]` (no `rig`, no `brain`); `rigsIn(project: string, rigs): PhoneRig[]`. `PhoneSessionSchema` must pick `rig` and `brain` (add in Task 1 if lot 2/7 did not).
- Copy: `Projets`; `${n} sessions seules · ${m} projets sur ce PC`; `${n} rigs travaillent aussi ici : ${names}`; `Rigs ›`; on a rig session's thread: `Ce siège appartient au rig ${rig} : OpenRig s'occupe de son cycle de vie.`
- [ ] **Step 1: Failing tests**: a session with `rig` never appears in Projets; the rig line under `Ledge` names `factory, starter` and links to `#/rigs`; a rig session's thread has no close, resume or model action and shows the note.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `agents.test.tsx`, `session-close.test.tsx` still PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): Projets shows lone sessions, rig seats are OpenRig's"`

---

### Task 9: Launching a rig

**Files:**
- Create: `apps/mobile/src/ui/ledge/PlanCard.tsx`, `apps/mobile/src/ui/PlanSheet.tsx`, `apps/mobile/src/screens/NewRig.tsx`
- Modify: `apps/mobile/src/screens/LedgeThread.tsx`, `apps/mobile/src/App.tsx`, `apps/mobile/src/copy.ts`
- Test: `apps/mobile/test/screens/rig-launch.test.tsx`

**Interfaces:**
- Consumes: the `plan` thread item (`PhoneRigPlan`), `RigSchema.launch` progress (lot 5: `goalSentAt`, seats' states) through `rig.updated`; sends `rig.prepare`, `rig.launch { planId }` with passkey over `launch@<planId>`.
- Copy: card `spec ${spec} · ${n} sièges`, rows `But`, `Où`, `Sièges`, `Outils`, buttons `Lancer le rig`, `Voir le plan`, `Changer`; sheet `Plan du rig ${name}`, `Ce qui démarre · ${n} sièges`, `Ce qui change dans ${project}`, `Après le lancement`, `Lancer · confirmer avec la clé d'accès`; `Lancé par toi · ${hh:mm}`; progress `Copie ${copyName} créée`, `${addresses} prêts`, `${address} démarre…`, `But donné à ${lead}`; `Ouvrir ${name}`; `Redemander à Ledge`; NewRig `But donné au lead`, `Projet` chips + `Hors projet`, `Spec` chips (`rig.specs` when lot 3 offers it, else free text), `Demander le plan à Ledge`; `required` plans show the sheet before the button (Desktop spec §4.6).
- [ ] **Step 1: Failing tests**: a `plan` item shows the card with `dans Website` and `.worktrees/rig-web-63` when `where.copy`; `Lancer le rig` prompts the passkey and sends `rig.launch { planId }`; a `required` plan opens the sheet first; after `launchedRigKey`, the card reads `Lancé par toi` and follows `rig.updated` seat states; `unknown plan after restart` shows `Redemander à Ledge`, which sends `ledge.say` with the goal; NewRig sends `rig.prepare { project: null }` for `Hors projet` with no passkey and returns to the Ledge tab.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): launch a rig from Ledge's plan card or the new rig form"`

---

### Task 10: Notifications from Ledge only

**Files:**
- Modify: `packages/ledge/src/mobile/push/triggers.ts`, `packages/ledge/src/mobile/push/notifier.ts`, `apps/mobile/src/sw/sw.ts`, `apps/mobile/src/sw/types.ts`
- Test: `packages/ledge/test/mobile-push-openrig.test.ts`, `apps/mobile/test/sw/escalation-actions.test.ts`

**Interfaces:**
- Push kinds: `'escalation'` `{ id, title: 'Ledge · une décision pour toi', body, actions: { qId, optId, label }[] ≤2 }` (sound; actions only for one question with ≤2 options) and `'decided'` `{ count, body }` (silent, `tag: 'ledge-decided'`). Action ids `answer:<qId>:<optId>`.
- [ ] **Step 1: Failing tests**: an escalation reaching `pending` with `category ∈ ALWAYS_USER` pushes once; one in `grace` does not push until it becomes `pending`; a seat session's own pending (`session.rig`) never pushes; three Ledge decisions in a minute give one silent grouped push; a lone session's pending pushes as today; in the service worker, `answer:q1:o1` with an open client posts `escalation.answer`, with none opens `#/escalation/<id>`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — `pnpm --filter @ledge/ledge test && pnpm --filter @ledge/mobile test`, PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): notifications come from Ledge, answerable from the notification"`

---

### Task 11: End-to-end story

**Files:**
- Create: `apps/mobile/e2e/openrig.spec.ts`
- Modify: `apps/mobile/e2e/harness.ts` (`FakeDaemon` gains `openrig`, `rigs`, `escalations`, `thread`, `decisionsToday` and handles the Task 1 client messages)

- [ ] **Step 1: Write the story** (Pixel 7, Chromium, virtual authenticator as `chat.spec.ts`; fixtures start from `docs/mockups/ledge-mobile-orchestrator/capture/zz-fixtures.ts`): pair → Ledge tab, strip `À toi 3` → answer `SQLite` in the thread without a passkey → the fold shows Ledge's message carrying the answer → Rigs → factory → Échanges → back → `Lance un rig…` → plan card → `Lancer le rig` with the authenticator → `Lancé par toi`.
- [ ] **Step 2: Run** — `pnpm --filter @ledge/mobile build && pnpm --filter @ledge/mobile exec playwright test e2e/openrig.spec.ts`, FAIL until the harness serves the new messages.
- [ ] **Step 3: Extend the harness.**
- [ ] **Step 4: Run everything** — `pnpm test && pnpm typecheck && pnpm --filter @ledge/mobile exec playwright test`, PASS.
- [ ] **Step 5: Commit** — `git commit -m "test(mobile): end-to-end story of the phone with OpenRig"`

---

## Task 0 result

_To fill at execution time._
