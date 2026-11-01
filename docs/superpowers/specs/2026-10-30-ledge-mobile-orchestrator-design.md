# The phone when Ledge orchestrates OpenRig

Date: 2026-10-30. Status: design, mockup approved. **Built after** Desktop's « Ledge orchestrator of OpenRig » work, as its
lot 9 (after lots 2, 4, 5; lot 7 for Ledge's advice). Brainstorm
`docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-brainstorm.md` (session Otto), plan
`docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md` (session Plume). The phone only shows and acts on what
the daemon knows once that work is merged.

- Mockup (private): <https://claude.ai/artifact/2FXtE18YzaXkkKD7ZXGC32>. Local copy:
  [docs/mockups/ledge-mobile-orchestrator/](../../mockups/ledge-mobile-orchestrator/) (`index.html`, `source.html`,
  `shots/`, `capture/`; README below in §8).
- Desktop mockups: <https://claude.ai/artifact/FUfjAAe1tSUiK7FRMAt4JC>.
- Plan: [2026-10-30-ledge-mobile-orchestrator.md](../plans/2026-10-30-ledge-mobile-orchestrator.md).

## 1. Intent

Ledge becomes the agent that runs OpenRig rigs: it decides inside its mandate and comes back to the user only when it must.
On the phone, what matters is:

- the conversation with Ledge (Desktop's proposition A, on one column);
- the decisions Ledge passes up, with their buttons;
- « À toi »;
- an overview of rigs and projects, with the exchanges between agents;
- launching a rig from the phone.

## 2. Decisions

From the brainstorm, binding here:

1. Ledge is OpenRig's « human »: every escalation of a rig or of the operator reaches Ledge, and **only Ledge contacts the
   user**. On the phone, no request, notification or message ever comes straight from a rig agent.
2. Ledge decides inside its mandate; **design, architecture and critical decisions always come up** to the user.
3. **Projects (lone sessions) and Rigs are separate.** A rig has its own page, « dans ‹projet› » or « hors projet ».
4. The exchanges between agents are visible.
5. `ledge team`, roles and tasks disappear in favour of OpenRig.

Taken with the user on 2026-10-30, on the mockup:

6. **Tabs: Ledge · À toi · Rigs · Projets.** Équipes goes; Agents becomes Projets.
7. **Ledge screen = A1**: the rail (À toi, Rigs, Tranché) becomes a strip of chips « Le point » under the header; a chip
   opens a sheet with the three blocks and « Résumer la journée ». A2 (pinned decision + one chronological feed) is
   rejected.
8. **Passkey only for acts**: launching, stopping or restarting a rig, and today's risky accepts. Answering a decision
   Ledge passes up takes one tap, including from a notification.

## 3. Screens

Numbers are the mockup's.

| # | Screen | What it shows |
| --- | --- | --- |
| 1 | Ledge · conversation | Header (mascot, « Ledge. », « Orchestre N rigs · M agents · tranche dans son mandat »), strip « Le point », bubbles (Ledge left with its mascot, the user right), a **decision inside Ledge's message** (kind, `agent@rig`, question, Ledge's opinion, options, « En parler »), each rig's exchanges **folded under the message** (« factory · 3 échanges · 16:36 → 16:42 »), a decision Ledge took with « Revenir dessus », suggestions, the real composer, the mandate line. |
| 2 | Ledge · after the answer | The decision closes on « Tu as choisi … · hh:mm »; the fold opens on the rig's exchanges including Ledge's message carrying the answer; « Ouvrir le fil de ‹rig› ». Typing `@build` writes to Ledge, which relays. |
| 3 | Le point (sheet) | À toi (with their buttons), Rigs (progress, « Ouvrir »), Tranché aujourd'hui (« Revenir »/« Voir »), « Résumer la journée ». |
| 5 | À toi | Filters Tout / Via Ledge / Sessions. « Via Ledge · rigs »: a card that says Ledge passes up a question of `agent · rig`, Ledge's opinion and why it came up, buttons on the card. « Sessions seules »: today's cards, unchanged. |
| 6 | A decision in full | The agent's question, Ledge's opinion with the dates of past choices it relies on, kind and place; a sheet with the options, **Ledge's recommendation first**, « En parler avec Ledge ». No passkey (§2.8). |
| 7 | Notification | Always signed Ledge. A decision passed up rings, with its options as actions where the platform allows it; what Ledge decided arrives silent and grouped. |
| 8 | Rigs | One card per rig: colour, name, spec and seat count, « dans ‹projet› » or « hors projet » (+ « N dépôts trouvés »), branch, progress « k/n au travail », seats with their state, last exchange. Core OpenRig (operator, queue) at the bottom; the advisor is not shown. « + » opens a new rig. |
| 9 | A rig · Sièges | One row per seat: name, `@role`, task, tool · model, context gauge, state. A seat opens its thread and terminal as a session does today. « Relancer un siège… », « Arrêter le rig… » go through OpenRig, with passkey. |
| 10 | A rig · Échanges | Every `rig send` of the rig in order, the operator's messages, what Ledge decided (red background). « Queue · N » lists the rig's queue items, read-only. The composer writes **to Ledge about this rig**. |
| 11 | Projets | Lone sessions by project, as Agents today, without team tables. A rig placed in the project is only signalled: « N rigs travaillent aussi ici : … · Rigs › ». |
| 12 | Launch, asked to Ledge | The user asks; Ledge explains its choice of spec and proposes a **rig launch card**: name, spec · seats, goal, where (project + worktree, or « hors projet »), seats, tools; « Lancer le rig », « Voir le plan », « Changer ». |
| 13 | Plan + confirm | Seats with tool · model · autonomy, what changes in the folder (the rig works in a copy `.worktrees/rig-‹name›` by default), Ledge's mandate after launch, « Lancer · confirmer avec la clé d'accès », the `rig up` command. |
| 14 | Start | The card closes on « Lancé par toi »; Ledge's next message follows the seats coming up and when it hands the goal to the lead; the rig joins « Le point » and Rigs. |

Screen 4 (A2) stays in the mockup as the rejected variant.

## 4. What the phone needs from the PC

This is **lot 9** of the Desktop plan (`docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md`, session Plume).
Every name comes from its shared contract, `packages/protocol/src/openrig.ts`; the phone gets projections of it with no
path, `cwd`, machine or command, and names a rig by an opaque `key` the gateway maps to `(machine, rigId)`.

| Need | Contract | Passkey |
| --- | --- | --- |
| Rigs overview, Le point | `rig.snapshot` / `rig.updated` / `rig.removed` → `Rig` | — |
| A rig's exchanges (200 last) and queue | `rig.exchanges.request` → `rig.exchanges`; the queue = exchanges of kind `task` / `handoff` | — |
| A decision passed up | `escalation.updated` → `Escalation` (`category`, `advice`, `questions[].options[].recommended`); Ledge's « souvenirs » = active `LedgeRule`s of the same category | — |
| Answer it | `escalation.answer { id, answers: { [questionId]: optionId } }`, free text `{ text }` | **no** |
| Ledge's thread | `ledge.thread.item` / `ledge.thread.history` → `LedgeThreadItem` (user, ledge, escalation, decided, exchanges, card); `ledge.say { text, about? }` | — |
| Tranché aujourd'hui, Revenir dessus | `decisions` (`by: 'ledge'`, today) → `LedgeDecision`; `decision.revisit` | no |
| Launch | `rig.prepare` → `rig.plan` (shown as a card in the thread) → `rig.launch { planId }` | launch only |
| Stop, restart a seat | `rig.act { verb: 'down' }`, `rig.act { verb: 'restart', seatRef }` | yes |
| Is this session a rig seat | `session.rig` | — |

Rules:

- **Who speaks.** An escalation is always shown as Ledge passing a question up, whatever its `source` (`rig`, `operator`,
  `ask`); the phone has no way to answer a rig agent directly.
- **Lifecycle through OpenRig.** The daemon refuses `session.close`, `resume` and `model` on a session with `rig` set
  (`rig_managed`); the phone hides those actions there.
- **Lone sessions are unchanged**: `session.decide`, `session.close`, model change keep working on Projets and À toi.
- **Push.** An escalation that becomes `pending` rings (not while in Ledge's 60 s `grace`); Ledge's own decisions arrive
  silent and grouped; a rig seat's own `needs_input` never notifies the phone.

## 5. What goes away

Lot 1 of the Desktop plan already removes the Équipes tab, the team and role editors, the live team sheet, the chat's team
and task cards, `PhoneSessionSchema.role/team`, `daemon.teams` and the team phone operations. This lot only renames
Agents to Projets and À traiter to À toi when the PC runs OpenRig.

## 6. Compatibility

The snapshot's `daemon.openrig: true` says the PC is an orchestrator. Without it the phone shows the lot-1 app (Ledge,
À traiter, Agents). A phone older than the PC ignores unknown snapshot fields and keeps working on lone sessions; it
does not see rigs. `PHONE_PROTOCOL` stays 1: every addition is optional.

## 7. Open questions

- **Plan before launch**: Desktop's plan makes it mandatory only for a real repository (`RigPlan.required`); the phone
  follows it: such a card opens the plan sheet before « Lancer ».
- ~~Passkey on `rig.prepare`~~: settled with Plume on 2026-10-30, none; the contract asks it only for `rig.act` and `rig.launch`.
- **Notification actions** work only where the browser offers them (Android Chrome). Not checked on iOS Safari; « Ouvrir »
  is the fallback.
- **The Décisions tab** of Desktop's Ledge screen: if it merges into Mandat › Dernières décisions, the sheet's « Tranché
  aujourd'hui » follows the same source.
- **Rig outside a project** on the phone: « N dépôts trouvés » depends on Desktop's repo detection (brainstorm, open).

## 8. The mockup's sources

`docs/mockups/ledge-mobile-orchestrator/`:

- `index.html`: the published page, self-contained.
- `source.html`: the same with `{{IMG:name}}` placeholders; `python3 capture/build.py` rebuilds `index.html` from it and
  `shots/`.
- `shots/`: `m-*.png` are captures of the real app 0.29.0 (`m-chat`, `m-inbox`, `m-agents` are on the page), `a-*.png`
  the mascot and bots cut from it.
- `capture/`: the Playwright spec and fixtures that made them. Copy `zz-capture.spec.ts` and `zz-fixtures.ts` into
  `apps/mobile/e2e/` and `zz.config.ts` into `apps/mobile/` of a worktree on `origin/main`, then
  `pnpm --filter @ledge/mobile build` and `SHOTS=<dir> pnpm exec playwright test -c zz.config.ts` from `apps/mobile`.
  Fixture pitfalls: the state is `waiting_input` (not `waiting_answer`), a chat `qid` is a UUID, `context` is an object.
