# OpenRig 0.6.14 : fiche de faits (lot 0)
Sonde du 2026-10-30, rapport `8obKZ2-mvvjfjw7` (`rig --version` = `0.6.14 (df1c1517)`). Conditions : home jetable `/tmp/openrig-qa-ledge-8obKZ2`, port 44777, `--no-kernel`, sièges terminal (`sh`), tmux isolé. Démontage vérifié : port fermé, home supprimé, `~/.openrig` inchangé (étape `guard` : `"changed": []`).

Lecture : chaque cellule « Observé » cite l'`id` d'étape du rapport et l'extrait exact. Un même `id` couvre plusieurs entrées (une par commande ou requête) ; « #n » désigne la n-ième entrée de cet `id`, à partir de 1. Les marqueurs de la sonde sont abrégés : `<A>` = `ledge-probe-annotation-8obKZ2-mvvjfjw7`, `<R>` = `ledge-probe-reason-8obKZ2-mvvjfjw7`, `<D>` = `ledge-probe-decision-8obKZ2-mvvjfjw7`, `<P>` = `ledge-probe-ping-8obKZ2-mvvjfjw7`. Les sièges du rig sont `probe-seat@ledge-probe` et `probe-peer@ledge-probe`.

## Décisions
| # | Question | Observé (étape : extrait) | Décision pour Ledge | Lot |
|---|---|---|---|---|
| D1 | D'où lire la version d'OpenRig | `start` #2 : `GET /healthz` → 200, `"semver":"0.6.14","commit":"df1c1517f0…","dirty":false`. `preflight` : `rig --version` → `0.6.14 (df1c1517)`. | `GET /healthz`, champ `semver` ; s'il manque, `rig --version` (premier mot). | 2 |
| D2 | L'inscription `ledge` avec leurre Slack passe-t-elle ? Faut-il le fichier ? | `esc.before-register` : avant inscription, `queue create --destination ledge@external` → exit 1, `"error":"human_registry_unavailable"`. `human.add` #1 : `rig gateway human add ledge --display-name Ledge --binding slack:ledge-decoy:file:<home>/decoy-slack.env:primary --delivery-class D --actor ledge-probe`, fichier **absent** → exit 0, `"ok":true`, `"subject":"ledge@external"`, `"effect":"applied"`. L'étape `human.add.file` n'a pas été jouée (elle ne sert qu'en cas d'échec de `human.add`). `human.add` #2 (`human show`) : `"address":"ledge@external"`, `"deliveryReadiness":{"state":"not-ready",…"reason":"connector configuration is incomplete (bot token or channel missing)"}`. `esc.create` : ensuite, même commande → exit 0. | Commande retenue : `rig gateway human add ledge --display-name Ledge --binding slack:ledge-decoy:file:<fichier absent>:primary --delivery-class D --actor ledge`. Aucun fichier à créer. L'état `not-ready` du connecteur est attendu et ne bloque rien. | 2 |
| D3 | Un second humain distinct est-il refusé ? | `human.second` : `rig gateway human add other …` → exit 1, stderr `refused: a human is already configured (ledge). OpenRig supports one configured human … remove the existing one first (`rig gateway human remove <entityId>`)`. | Si un autre humain est déjà inscrit : `human: 'failed'` + `detail` avec le texte d'OpenRig, ou remplacement explicite (voir plan maître, `--replace` non sondé). Le repli B n'est pas nécessaire pour ce cas. | 2 |
| D4 | Une ligne `ledge@external` sans Slack : état, lisible, par quelle route et quel filtre | `esc.read` #1 (t+0) et #7 (t+10s) : `GET /api/queue/list?destinationSession=ledge%40external` → 200, les 2 lignes, `"state":"pending"`, `"deliveryOutcome":null`, `"lastNudgeResult":"gateway-owned: 'ledge@external' is a virtual @external destination — delivery rides the gateway subsystem (Slack connector)…"`. Champs de `esc.create` : `"humanIntent":"decision"`, `"humanQuestions":[{"id":"branch","question":…,"options":[{"id":"main","label":"main","recommended":true},…]}]`, `"evidenceRef":"/tmp/…/PROOF.md"`, `"tier":null`, `"replyTo":null`, `"humanAnswers":null`, `"summary"`, `"body"`. `esc.read` #4 `/api/queue/human-updates` → `{"items":[]}` ; #5 `/api/queue/undelivered` → `[]` ; #6 `/api/attention` → items `"recipient":"ledge@external"`. | Route : `GET /api/queue/list?destinationSession=ledge%40external`, états ouverts filtrés côté Ledge. Champs : `humanQuestions` (ids de question et d'option), `humanIntent`, `evidenceRef`, `replyTo`, `body`, `summary`, `tier`, `sourceSession`. La ligne reste `pending` sans Slack (pas d'échec de livraison). | 2 |
| D5 | `approve` ferme-t-il la ligne, réveille-t-il le travail bloqué, et porte-t-il le texte jusqu'au siège ? Par quel champ (`annotation` ou `reason`) ? | `answer.approve` #1 : `POST /api/mission-control/action {verb:"approve",annotation:<A>,reason:<R>}` → 200, `"state":"done"`. #3 (transitions) : `"transitionNote":"mission-control:approve (<R>)","closureReason":"no-follow-on","closureTarget":"<R>"`. #2 : `"humanAnswers":null`. #7 (audit) : `"reason":"<R>","annotation":"<A>"` — `annotation` n'apparaît que là. #5 (travail bloqué) : `"transitionNote":"auto-unparked: blocker … reached terminal state 'done'"` puis `"wake attempted; delivery=verified"` ; #4 : `"state":"pending"`. #8 (pane du siège) : `Blocker qitem-…9965… resolved; parked qitem … is pending. Resume the recorded continuation and update the row.` — ni `<A>` ni `<R>` dans le pane (0 occurrence). `deny` #5 : `"closureReason":"denied"`, `"state":"done"` ; #8 : `auto-unparked: blocker … reached terminal state 'done'` puis `delivery=delivered-ack-pending`. | `approve` ferme et réveille, mais **ne porte pas le texte** au siège : `reason` → `closureTarget` (lisible sur la ligne), `annotation` → audit seul. Réponse = **ligne de réponse + approve**. | 4 |
| D6 | Une ligne de réponse `--source ledge@external` vers le siège est-elle acceptée et vue ? | `answer.reply-row` #1 : `rig queue create --source ledge@external --destination probe-seat@ledge-probe --summary "Réponse de Ledge : <D>" --body-file … --json` → exit 0, `"sourceSession":"ledge@external","state":"pending"`. #2 (pane) : `From: ledge@external … Queue handoff: qitem-…b2c8… - check your queue. Summary: Réponse de Ledge : <D>`. Dans la sonde, le `body` (`reply.md`) valait le `summary` (`Réponse de Ledge : <D>`) : le pane ne permet pas de dire si le `body` y apparaît. | Oui. Le pane montre le `summary` (le `body` n'y est pas distinguable) : la réponse lisible doit tenir dans le `summary` ; le `body` complet reste sur la ligne. | 4 |
| D7 | Une deuxième réponse : quel code d'erreur ? | `answer.twice` : même `approve` → **409**, `{"error":"qitem_already_terminal","message":"… already terminal (state=done) …","state":"done"}`. | HTTP 409 `qitem_already_terminal` → `already_answered`. | 4 |
| D8 | Identité de l'acteur : `actorSession` dans le corps ou en-tête, et provenance enregistrée | `answer.approve` #7 (audit, `actorSession` dans le corps) : `"actorSession":"ledge@external","identityProvenance":"claimed:v1"`. `answer.header` #3 (audit, en-tête `X-OpenRig-Session: ledge@external`, sans `actorSession` au corps) : `"actorSession":"ledge@external","identityProvenance":"transport:v1"`. Transitions des deux : `"actorSession":"ledge@external","identityProvenance":null`. | Le pont envoie l'en-tête `X-OpenRig-Session: ledge@external` (provenance `transport:v1`) ; pas besoin d'`actorSession` dans le corps. | 4 |
| D9 | Plan B : park sur `human-ledge@host`, ligne `human-gate`, `resolve` avec `decision` | `planb.park` #3 : `rig queue block … --on human-ledge@host` → `"state":"blocked","blocker":{"ref":"human-ledge@host","owner":null}`, `"mechanism":"UNVERIFIED: no timed backstop"`. #4 : `--destination human-ledge@host --tier human-gate` → exit 0, `"tier":"human-gate"`. #7 : `/api/attention` → `"recipient":"human-ledge@host"` pour les deux. `planb.resolve` #1 : `{verb:"resolve",decision:<D>,actorSession:"ledge@external"}` → 200 ; #3 : `"transitionNote":"<D>"`, `blocked → in-progress` ; #4 (pane) : `Decision resolved on qitem-…fb69…: <D> — unparked (blocked → in-progress); you still own it.` | Fonctionne et porte le texte, mais **non retenu** : D2, D4 et D5+D6 passent. Gardé comme repli documenté. | 2, 4 |
| D10 | Noms d'événements SSE utiles, forme du flux (`event:` absent ? type dans `data.type` ?) | `sse.open` : `content-type: text/event-stream`, `"eventLinePresent":false,"idLinePresent":true` ; lignes `data: {"type":…,"seq":n}` puis `id: n`. `events.catalog` : `bootstrap.started`, `node.launched`, `node.startup_pending`, `node.startup_proof_skipped`, `node.startup_ready`, `topology.roster_recorded`, `rig.imported`, `bootstrap.completed`, `bootstrap.planned`, `watchdog.evaluation_skipped`, `seat.activity_changed`, `queue.created`, `queue.claimed`, `queue.updated`, `mission_control.action_executed`, `view.changed` (111 sur 160). `queue.updated` porte `fromState`, `toState`, `closureReason`, `closureTarget`, `actorSession`, `summary` ; `queue.created` porte `sourceSession`, `destinationSession`, `tier`, `summary` mais pas `humanIntent`. | Type lu dans `data.type`, curseur = `id`. Miroir : queue `queue.created`, `queue.claimed`, `queue.updated`, `mission_control.action_executed` ; siège `node.launched`, `node.startup_ready`, `seat.activity_changed` ; rig `rig.imported`, `bootstrap.completed`. Ignorer `view.changed` et `watchdog.*`. Après `queue.created` vers l'humain, relire la ligne (`GET /api/queue/<id>`) pour les questions. | 2 |
| D11 | `rig send` : événement ou outbox (route, clé d'interrogation : par expéditeur ?) | `send.seat` #1 : `rig send probe-seat@ledge-probe <P>` (siège `probe-peer`) → `Sent to probe-seat@ledge-probe`. Aucun événement SSE entre `send.seat` (22:23:31.6) et la fermeture du flux (22:23:36.4) : aucun des 160 événements du rapport n'a `"step":"send.*"`. #2 : `GET /api/queue/outbox/list?senderSession=probe-peer%40ledge-probe` → `{"outboxId":"outbox-20261030222331-9cb5c31c","destinationSession":"probe-seat@ledge-probe","body":"From: probe-peer… ---\n<P>\n---…","deliveryState":"pending"}`, plus des lignes `wake-intent-qitem-…`. #3 (pane) : `<P>` présent. `send.ledge` #1 (sans identité) : `Delivered without sender identity: this request carried no X-OpenRig-Session header`. #2 : `senderSession=ledge%40external` ne rend que `wake-intent-blocker-17`, `wake-intent-qitem-…b2c8…`, `wake-intent-blocker-7` (aucune avec `<P>`). | Pas d'événement : interrogation toutes les 5 s de `GET /api/queue/outbox/list?senderSession=<ref>` pour chaque siège, en gardant les lignes `outbox-…` (les `wake-intent-…` sont des réveils de la queue). Un `rig send` de Ledge doit porter une identité (`OPENRIG_SESSION_NAME`), sinon il part non signé ; l'envoi signé `ledge@external` par `rig send` n'est **pas observé**. | 2 |
| D12 | Reprise SSE avec `Last-Event-ID` sans doublon | `sse.resume` : `GET /api/events` avec `Last-Event-ID: 159` → 200, `{"lastEventId":159,"received":[160],"repeated":[]}`. L'événement 160 (`seat.activity_changed`) est arrivé après la reconnexion. | Garder le dernier `id` dans `openrig.json` et rouvrir avec `Last-Event-ID`. Pas de doublon observé ; le rejeu d'événements émis pendant la coupure n'est **pas observé** (aucun ne l'a été). | 2 |
| D13 | Ce que `rig up --cwd` écrit dans le dossier (terminal réel, Claude/Codex en plan) | `rig.up` #4 : après `rig up <spec> --cwd ws --yes --json` (deux sièges terminal, `"status":"completed"`), `"diff":{"added":[],"removed":[],"changed":[]}`. `rig.plan` #3 : `rig up starter --plan --cwd ws2 --json` → `"status":"planned"`, `before` = `after`, `"diff":{"added":[],"removed":[],"changed":[]}`. | Sièges terminal : rien n'est écrit. `--plan` n'écrit rien. Les écritures des sièges Claude/Codex lancés pour de vrai ne sont **pas observées** : la liste montrée à l'étape « Le plan » reste celle de la spec §2 (bloc géré dans `CLAUDE.md`/`AGENTS.md`, `.openrig/`, `.claude/settings.local.json`), marquée « d'après OpenRig », à vérifier au parcours réel. | 5 |

## Retenu
- Le lot 2 s'inscrit par `rig gateway human add ledge --display-name Ledge --binding slack:ledge-decoy:file:<fichier absent>:primary --delivery-class D --actor ledge` (D2), lit les escalades par `GET /api/queue/list?destinationSession=ledge%40external` (D4), suit le SSE sur `data.type` (D10) et interroge l'outbox par expéditeur toutes les 5 s (D11).
- Le lot 4 répond par une ligne de réponse `rig queue create --source ledge@external --destination <siège> --summary "Réponse de Ledge : …"`, puis `approve` sur la ligne humaine avec l'en-tête `X-OpenRig-Session: ledge@external` (D5, D6, D8) ; un 409 `qitem_already_terminal` vaut `already_answered` (D7).
- Chemin de réponse : reply-and-approve
- Le repli B n'est pas nécessaire : l'inscription passe (D2), la ligne reste lisible (D4), et `approve` ferme et réveille (D5). Seul le texte manque à `approve`, et la ligne de réponse le porte (D6).

## Non sondé
- L'escalade de l'operator vers `operator.human` : le noyau est sauté (`read.mirror` #5 : `"kernel_state":"skipped","detail":"OPENRIG_NO_KERNEL=1"`). Il faudrait démarrer sans `--no-kernel`, ce qui lance des agents LLM : accord de l'utilisateur, et un coût de quelques minutes de modèle.
- Les sièges Claude/Codex réels, et donc ce qu'ils écrivent dans le cwd (D13). Même condition : accord et coût LLM ; à faire au parcours réel de fin de chantier.
- `rig send` signé par `OPENRIG_SESSION_NAME=ledge@external` (D11) et `rig gateway human add --replace` (D3).
- Le rejeu d'événements manqués pendant une coupure SSE (D12).
- La ligne `human-gate` du plan B après `resolve` (seule la ligne de travail a été relue).

## Demandes amont confirmées (spec §12)
- **Route publique qui porte la réponse d'un humain au siège** (`resolveDirectHumanReply`) : confirmée. `approve` ne transmet ni `annotation` ni `reason` au siège (D5) ; Ledge doit créer une seconde ligne (D6).
- **Connecteur humain `local` ou `webhook`** : utile, pas bloquant. Le leurre Slack suffit (D2), mais le connecteur reste `not-ready` et la livraison est notée `gateway-owned … (Slack connector)` (D4).
- **`--goal` pour `rig up`** : non sondé.

## Extraits
`answer.approve`, transition de fermeture (`GET /api/queue/<id>/transitions`) :
```json
{"transitionId":6,"state":"done","transitionNote":"mission-control:approve (ledge-probe-reason-8obKZ2-mvvjfjw7)","actorSession":"ledge@external","closureReason":"no-follow-on","closureTarget":"ledge-probe-reason-8obKZ2-mvvjfjw7","identityProvenance":null}
```
`answer.approve`, audit (`GET /api/mission-control/audit?qitem_id=…`) :
```json
{"actionVerb":"approve","actorSession":"ledge@external","reason":"ledge-probe-reason-8obKZ2-mvvjfjw7","annotation":"ledge-probe-annotation-8obKZ2-mvvjfjw7","notifyAttempted":false,"identityProvenance":"claimed:v1"}
```
`answer.approve`, travail bloqué réveillé :
```json
{"transitionId":7,"state":"pending","transitionNote":"auto-unparked: blocker qitem-20261030222307-9965ef18df2e33d6 reached terminal state 'done'","actorSession":"ledge@external"}
{"transitionId":8,"state":"pending","transitionNote":"blocker qitem-20261030222307-9965ef18df2e33d6 wake attempted; delivery=verified","actorSession":"queue@system"}
```
`answer.header`, audit avec l'en-tête :
```json
{"actionVerb":"approve","actorSession":"ledge@external","reason":"ledge-probe-reason-8obKZ2-mvvjfjw7-header","annotation":"ledge-probe-annotation-8obKZ2-mvvjfjw7-header","identityProvenance":"transport:v1"}
```
`answer.twice` :
```json
{"error":"qitem_already_terminal","message":"qitem qitem-20261030222307-9965ef18df2e33d6 is already terminal (state=done); Mission Control cannot mutate terminal items","state":"done"}
```
`esc.before-register` :
```json
{"error":"human_registry_unavailable","message":"destination_session ledge@external cannot be admitted because no human is registered yet: …"}
```
`sse.open`, début du flux brut :
```
data: {"type":"bootstrap.started","runId":"01M67EGPG175JDE8KEK8WR83Y8","sourceRef":"…/spec/rig.yaml","seq":1,"createdAt":"2026-10-30 22:22:34"}
id: 1
```
`queue.updated` (événement 48) :
```json
{"type":"queue.updated","qitemId":"qitem-20261030222307-9965ef18df2e33d6","fromState":"pending","toState":"done","closureReason":"no-follow-on","closureTarget":"ledge-probe-reason-8obKZ2-mvvjfjw7","actorSession":"ledge@external","summary":"Probe decision 8obKZ2-mvvjfjw7","seq":48}
```
`send.seat`, ligne d'outbox :
```json
{"outboxId":"outbox-20261030222331-9cb5c31c","senderSession":"probe-peer@ledge-probe","destinationSession":"probe-seat@ledge-probe","body":"From: probe-peer@ledge-probe\nTo: probe-seat@ledge-probe\nSent: 10-30 22:23Z\n---\nledge-probe-ping-8obKZ2-mvvjfjw7\n---\n↩ Reply: rig send probe-peer@ledge-probe \"...\"","deliveryState":"pending"}
```
`sse.resume` :
```json
{"lastEventId":159,"received":[160],"repeated":[]}
```
