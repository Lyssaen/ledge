# Thread « Rail » (track B): the session thread as one vertical rail

Date: 2026-10-19. Status: design; the user handed the open calls to the builder (« Je te laisse choisir »). Issue: Lyssaen/ledge#34.
Mockup: https://claude.ai/artifact/XKxXpf68zvDLp9x1VGXi43, boards B (Rail), B1 (failure then fix), B2 (your approval),
B3 (parallel subagents), B4 (back after an absence), B5 (task notifications and markers), each in light and dark.

## 1. Intent

The flat thread of lot 6a (bubbles, a turn author, action folds as boxes) becomes the mockup's rail: one column of rows, each row
a grid `node · content · time`, the nodes strung on a 1 px line. Every kind of item gets its node (your avatar, the agent's bot, a
pip for a quiet action, a coloured disc for what matters: running, failed, decided, a subagent, a message), so the eye reads the
left edge to find what happened and the right edge to know when.

Respect the mockup: structure, icons, mascots, badges, colours and texts. Only existing assets: `SHELL_ICONS` / `ICONS`, `Bot`
(through `SessionBot` / `HelperBot`), `Badge`, the tokens of `tokens.css`, the copy in `fr.ts` / `en.ts`.

## 2. Goals, non-goals

Goals
- The rail (`ol.rail > li.turn > ol > li.r`) for every item kind the thread knows.
- Past exchanges folded to one row (« Échange de 14:02 · prompt · N actions · M fichiers modifiés »), unfolded on click.
- B1: a failed action shows its output under it; the exchange's end row says « 1 échec rattrapé » when the run recovered.
- B3: consecutive subagents share one card, headed « Sous-agents lancés · 1 terminé, 1 en cours », one block each with its state.
- B4: the « Nouveau depuis votre dernière visite » separator as a rail row; « Session terminée à HH:MM ».
- B5: `<task-notification>` prompts become a « Tâche » card; `[synapse-obs] story=… objectif=…` becomes Story / Objectif tags
  (on the prompt row and in the page heading), and an objective that changes becomes a rail marker.
- Both themes, tokens only; the narrow container keeps working.

Non-goals
- No change to the daemon, the protocol or how exchanges are cut (`exchanges.ts` keeps its model).
- The pinned request (PendingCard) and the reply keep their behaviour and keys: Y / N stay (O is the terminal's key, so the
  mockup's « Autoriser (O) » is not taken). Only their look moves toward the mockup.

## 3. Builder's calls (to check)

1. **User avatar**: there is no user name in the app, so the `.av` node shows a `user` line icon (added to `SHELL_ICONS`)
   instead of the mockup's initials.
2. **Folding**: an exchange is open when it is the last one, holds or follows the unread item, holds the flashed action, the open
   plan, a running action or a proposed plan, or the reader unfolded it. The others show their fold row only. The reader's
   unfolds are kept per session, like the conversation folds.
3. **Runs of actions**: up to 6 actions show as rows; more fold into one row « N actions · 7 lectures, 3 commandes · 1 fichier
   modifié » with their total time. Folded, failed, interrupted and running actions stay visible under it.
4. **Count badges** (« 2 échecs », « 10 réussis ») are not derivable per command: the failed row shows « Échec » only.
5. **End-of-exchange row**: on a finished exchange that has actions: « Fin de l'échange · N échecs [rattrapés] · N actions ·
   N fichiers modifiés ». « rattrapé » when the exchange's last action succeeded.
6. **Finished subagents** stay in the parent thread with « Terminée » (the mockup shows them); this reverses lot 6a's filter.
7. **Messages**: bubble + « À Otto · ✓✓ lu » (title « Lu par Otto ») / « De Otto · voir son fil » under it, the direction's node on the rail (mail, reply).
   The folds and the conversation header are kept. The kicker (« Message envoyé / reçu ») stays for screen readers only.
8. **Waiting row**: in the last exchange, while a request is pinned, a danger row says who waits for what and that the thread
   resumes after your answer.
9. **Task output**: the daemon reads documents only (`document.read` refuses other types), so the task card shows the output
   file's path rather than a « Voir la sortie » button; « Notification brute » folds the raw XML.
10. **Synapse values**: known values get their label (analyse → Analyse, correction → Correction, implementation →
    Implémentation); others are capitalised with `-` read as a space, except ticket keys (`ST7-123`) kept as they are.
11. **Prompt marker lines** (`[synapse-obs] …`) are taken out of the prompt and of the agent's text once read as tags; an agent
    message left empty is not shown.

## 4. Shape

- `markers.ts` (new): `synapseOf(text)` → `{ text, tags: { story?, objectif? } | null }`; `taskOf(text)` → the parsed
  notification or null; `tagLabel(value)`.
- `Thread.tsx`: the rail and its rows; `ActionGroup.tsx`: the rows of a run (rail rows, `Spinner` kept for TodoBar).
- `MessageCard.tsx`, `NoticeLine.tsx`, `PlanCard.tsx`: rendered inside rail rows.
- `SessionPage.tsx`: the heading's tags (latest Story / Objectif of the shown thread), the pinned request handed to the thread.
- `session.css`: the thread section rewritten for the rail.

## 5. Settled while building

- **Past exchanges fold by default**, as on board B: the reader unfolds one from its row; the last exchange never has a fold row.
- **Runs of actions**: `FOLD_AT = 6` (`ActionGroup.tsx`); the fold row reads « N actions · kinds · files · failures · cuts ·
  plan updates » with the total time on the rail's right edge.
- **Live region**: an action row is `role="status"` only while it runs *and* the session is live; offline, its ring is still
  (`.spin.still`) and it announces nothing.
- **Subagents**: a run of `helper` items renders as one card (`.helpers-card`, `many` when two or more); a subagent absent from
  `session.helpers` reads as finished. Finished ones stay (call 6).
- **Task notifications**: a stopped agent reads « L’agent Explore a été arrêté. Il peut reprendre si vous lui écrivez. », with the
  « Arrêtée » badge.
- **Width**: `.rail` is capped at 820 px (`--col` 760 px + the node and time columns), as in the mockup.
- **i18n**: the keys of the flat thread that nothing reads any more are removed (`live`, `helperLaunched`, `openHelper`,
  `workPlanUpdated`); `seen` (« lu » / « read ») is added.
- **Tests**: `test/session-rail.test.tsx` (fold, waiting row, end row, subagent card, task card, tags) and `test/markers.test.ts`
  (the parsers); the existing thread tests unfold the past exchange through `unfoldPast` (`test/helpers.ts`).
