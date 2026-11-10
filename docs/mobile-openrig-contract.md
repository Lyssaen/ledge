# Contrat : rigs, kernel et queue OpenRig sur le téléphone (refonte mobile B4)

Pour `dev-front`, qui code M4 (onglets Rigs et Kernel du téléphone et de la tablette) sans avoir à demander. Les schémas zod font
foi : `packages/protocol/src/phone.ts` (messages `rigs.*`) et `packages/protocol/src/phoneRigs.ts` (types, bornes, règle de
passkey). Le comportement est fixé par `packages/ledge/test/mobile-rigs.test.ts`.

Le téléphone voit et pilote l'OpenRig **du PC auquel il est appairé**, par la passerelle chiffrée, exactement comme les vues
Rigs, Rig et Kernel de Desktop (lots 7a à 7d). Aucun chemin du PC n'arrive au téléphone (sauf `folder` d'un objectif, voir § 7).

## 1. Drapeau

`snapshot.daemon.rigs: true` : le PC répond aux lectures `rigs.*` et accepte `rigs.act`, `rigs.seats`, `rigs.goal.send`,
`rigs.goal.reply`. Absent (PC plus ancien) : l'onglet Rigs n'a rien à afficher, et une lecture `rigs.*` est répondue par
`{ type: 'error', code: 'invalid', request: 'rigs.state' }` (une opération par `operation.result` `rejected` / `invalid`).

## 2. Lectures

Chaque lecture est un message sans `op`, répondu au seul appareil qui l'a faite. Une lecture sans réponse d'OpenRig dans les
30 s est répondue avec `error: 'unavailable'`.

Codes d'erreur des lectures (`PhoneRigErrorSchema`) : `unknown_rig`, `not_installed` (pas de `rig` sur le PC),
`daemon_stopped` (le daemon OpenRig ne tourne pas), `unavailable` (tout le reste). Jamais le texte du PC.

| Demande | Réponse | Contenu |
|---|---|---|
| `rigs.state` | `rigs.state { state?, error? }` | l'état d'OpenRig, voir § 3. **Abonne** l'appareil : il reçoit ensuite chaque changement, entier |
| `rigs.graph { rig }` | `rigs.graph { rig, graph?, error? }` | topologie (`RigGraphSchema`) : `pods`, `seats` (`logicalId`, `pod`, `role?`, `runtime`, `model?`, `status`, `session?`, `attention`, `context?` en %), `links` (`from`, `to`, `kind`) |
| `rigs.queue { rig }` | `rigs.queue { rig, rows, closed, truncated, error? }` | `rows` : lignes ouvertes (pending, in-progress, blocked) qui nomment un siège du rig, plus récentes d'abord ; `closed` : 20 dernières closes (done, handed-off, canceled, failed, denied) ; `truncated` : des lignes ouvertes plus anciennes peuvent manquer |
| `rigs.routing` | `rigs.routing { entries, error? }` | 20 derniers mouvements de la queue sur le PC, tous rigs, **plus ancien d'abord** : `qitem`, `at`, `seat` (qui l'a fait), `change` (mots d'OpenRig : `claimed`, `handed off to …`, `blocked on …`, `completed`…), `rig` (`''` si inconnu), `summary?` |
| `rigs.permissions { rig }` | `rigs.permissions { rig, policy?, seats, error? }` | politique du spec et, par siège, `mode`, `source`, `posture`, `selection`, `summary`, `policy`, `policySource` ; un siège illisible a `error: 'unavailable'` (les autres restent) |
| `rigs.snapshots { rig }` | `rigs.snapshots { rig, snapshots, error? }` | 20 derniers : `id`, `kind` (`manual`, `auto-pre-down`…), `status`, `createdAt` (`2026-11-08 14:54:01`, UTC) |
| `rigs.goals` | `rigs.goals { goals, partial?, error? }` | objectifs donnés à l'operator (`GoalSchema`), voir § 6. **Abonne** l'appareil |

Lignes de queue (`PhoneRigQueueRowSchema`) : `id`, `state`, `from`, `to`, `createdAt`, `updatedAt`, `at`, `summary?`
(≤ 200 caractères), `blockedOn?`, `claimedAt?`, `needsInput? { count, reason }` (une invite attend sur le siège).

Les deux abonnements (`rigs.state`, `rigs.goals`) durent tant que l'appareil est suivi par la passerelle. Les poussées se
produisent après toute action, d'où qu'elle vienne (Desktop, téléphone, chat).

## 3. État d'OpenRig (`PhoneOpenRigStateSchema`)

```
{ installed, version?, at,
  daemon: { state: running|stopped|stale|unknown, port?, startedAt? },     // ni pid ni message
  kernel: { state: ready|starting|stopped|skipped|absent|unknown },
  rigs: [{ id, name, status, lifecycleState, seats, running, attention, uptime, snapshot, nodes: [siège…] }] }   // pas de specPath
```

Siège (`RigSeatSchema`) : `logicalId` (`pod.member`), `session`, `runtime`, `model`, `sessionStatus`, `lifecycleState`,
`activity`, `stopped`, `work`, `attention?`. Au plus 50 rigs et 200 sièges par rig.

Le % de contexte d'un siège est dans `rigs.graph` (`seats[].context`), pas dans l'état.

## 4. Actions (`rigs.act`)

```
→ { type: 'rigs.act', op, action: OpenRigAction, assertion? }
← operation.result { op, status: received → applied | rejected | failed, reason? }
← rigs.done { op, ok, commands, error?, message?, completed?, rejected? }
```

`action` prend **tous** les genres de l'`openrig.act` de Desktop (`OpenRigActionSchema`) :
`daemon.start { restore?: last|none, noKernel? }`, `daemon.stop`, `daemon.restart { restore? }`, `kernel.start|stop|restart`,
`rig.start { rig, snapshot?, fresh? }`, `rig.stop { rig, snapshot?, force?, delete? }`, `rig.restart { rig }`,
`rig.snapshot { rig }`, `seat.set { seat, runtime?, model?, effort?, permissions?, dryRun? }`,
`rig.permissions { rig, mode, seats }`, `rig.policy { rig, policy, seats }`.

Les réglages du daemon « relancer les rigs qui tournaient » et « sans le kernel » passent par `daemon.start`
(`restore: 'last'`, `noKernel: true`) et `daemon.restart`. Ils ne sont **pas** stockés sur le PC : Desktop les garde dans son
navigateur (`apps/desktop/src/ide/openrig/prefs.ts`) ; le téléphone garde les siens de la même façon.

`rigs.done` :
- `commands` : les commandes `rig` lancées, comme Desktop les montre, mais **sans les chemins du PC**. La passerelle demande au
  daemon (`noPaths`) de masquer chaque argument qui contient `/` ou `\` ou commence par `~`, **avant** de joindre la commande :
  un dossier avec des espaces ou des tirets reste un seul argument, remplacé par `…` ; `--drapeau=/chemin` devient
  `--drapeau=…`. Exemple : `rig add R1 dev … --rig-root …` (`showRigCommandWithoutPaths`) ;
- `message` (ligne libre d'OpenRig) : coupée au premier mot qui désigne un chemin, remplacé par `…` ; rien de ce qui suit n'est
  gardé ;
- `error` : `busy` (une autre action tourne ; `operation.result` dit `rejected` / `busy`, on peut réessayer), `not_installed`,
  `spec_unknown`, `spec_no_policy`, `spec_policy_unsupported`, ou `failed` avec `message` (dernière ligne d'OpenRig, ≤ 500
  caractères) ;
- `completed` : sur un `rig.permissions` / `rig.policy` qui échoue, combien de sièges sont passés ;
- `rejected` : refus avant exécution, voir § 5.

Une action dure autant que `rig` : pas de délai côté passerelle, le téléphone garde `received` jusque-là. Rejouer le même `op`
renvoie le même `rigs.done` sans relancer l'action.

## 5. Passkey (but `rigs`)

Il faut la passkey de l'appareil pour ce qui **arrête** quelque chose ou **retire les demandes de permission** :
`rigActNeedsCheck(action)` (exporté par le protocole) répond.
- Oui : `daemon.stop`, `daemon.restart`, `kernel.stop`, `kernel.restart`, `rig.stop` (avec ou sans `delete`), `rig.restart`,
  `seat.set` avec `permissions: 'full_bypass'` ou un changement de `runtime` hors `dryRun`, `rig.permissions` en
  `full_bypass`, `rig.policy` en `yolo` ou en `spec` (remettre la politique du spec, qui peut être `yolo` : le téléphone ne
  peut pas le savoir, il demande donc toujours).
- Non : les démarrages, `rig.snapshot`, les autres permissions, `seat.set` sans changement de harnais.

Déroulé :
1. `confirm.prepare { purpose: 'rigs', rigAct: <l'action exacte> }` → `confirm.challenge`. Pour des sièges :
   `confirm.prepare { purpose: 'rigs', rigSeats: { rig, seats } }`. Exactement un des deux, sinon `error: invalid` (aussi sans
   passkey enregistrée ou sans `daemon.rigs`).
2. L'assertion signée part avec l'opération (`assertion`).

Le défi est lié à **cette** action (empreinte de son JSON, l'ordre des clés ne compte pas) : une passkey pour arrêter un rig
n'en arrête pas un autre. Refus : `operation.result` `rejected` avec `confirm_required`, `assertion_invalid` ou
`assertion_expired`, et le détail le répète dans `rejected`. `rejected: 'unavailable'` : ce PC n'expose pas OpenRig.

## 6. Sièges (`rigs.seats`)

```
→ { type: 'rigs.seats', op, rig, seats: { 'pod.member': 0..9 }, delegation?: pairs|all, assertion? }
← rigs.reseated { op, ok, commands, added, removed, error?, message?, links?, linksUnsupported?, rejected? }
```

C'est l'`openrig.seats` de Desktop : un rôle nommé passe au nombre donné, les autres ne bougent pas. Les ajouts copient le premier
siège du rôle sous le numéro libre suivant ; les retraits enlèvent les dernières copies d'abord, le premier siège seulement à 0.
`added` / `removed` sont des `pod.member`. `error` : `rig_not_running`, `rig_root_unknown`, `busy`, ou `failed` + `message`.
`commands` et `message` sont sans chemins du PC, comme au § 4.

**Passkey** quand la modification retire un siège. Le contrôle porte sur le plan **effectivement exécuté**, pas sur une lecture
antérieure :
- **sans `assertion`**, la passerelle envoie la modification au daemon avec `noRemove` : le daemon relit le rig, calcule son
  plan et, si ce plan retire un siège (même un siège ajouté depuis le dernier `rigs.state` du téléphone), refuse avant de rien
  lancer (`remove_unconfirmed`). Le téléphone reçoit `operation.result` `rejected` / `confirm_required` et
  `rigs.reseated { ok: false, rejected: 'confirm_required' }` ;
- **avec `assertion`** (défi `rigSeats: { rig, seats }`, § 5), la modification part sans `noRemove` et peut retirer des sièges.

Le téléphone peut prévoir le cas avec `seatPlan(rig.nodes, seats).remove` (exporté par le protocole) sur son dernier
`rigs.state`, et demander la passkey d'emblée. Ce n'est qu'une prévision : sur `confirm_required`, il demande la passkey et
renvoie **avec un nouvel `op`**.

## 7. Objectifs à l'operator (`goals`)

```
→ { type: 'rigs.goal.send', op, goalId, text, folder? }          ← rigs.goal.sent { op, goalId, ok, qitemId?, error?, message?, rejected? }
→ { type: 'rigs.goal.reply', op, goalId, replyId, text }          ← rigs.goal.replied { op, goalId, replyId, ok, qitemId?, error?, message?, rejected? }
```

`goalId` / `replyId` sont choisis par le téléphone (`[A-Za-z0-9-]{8,64}`) et réutilisés tels quels pour un nouvel essai.
`error` (`GoalErrorSchema`) : `no_operator`, `openrig_stopped`, `unreachable`, `uncertain` (renvoyer le même id est sans
risque), `refused` (`message` dit pourquoi). Pas de passkey : on écrit seulement à l'operator.

`rigs.goals` donne les objectifs les plus récents d'abord, entiers (proposition d'équipe, question ouverte, `trail`,
`current`), autant que la trame scellée en tient ; `partial: true` : certains manquent. Un objectif porte `folder`, le dossier
du projet sur le PC : c'est le seul chemin transmis, comme dans « À toi ».

## 8. Bornes

| Quoi | Max |
|---|---|
| rigs dans l'état | 50 |
| sièges par rig, par liste de permissions, `added` / `removed` | 200 |
| lignes `rows` et `closed` | 100 et 20 |
| mouvements `rigs.routing`, snapshots | 20 |
| objectifs | 50 (moins si la trame déborde : `partial`) |
| `summary` d'une ligne ou d'un mouvement | 200 caractères |
| `message`, `policy`, `summary` de permission, chaque commande | 500 caractères |

## 9. Hors de ce contrat

- **Lancer un rig** (`openrig.launch`, la modale « Lancer une équipe » de Desktop) : pas exposé au téléphone.
- **Lancer une commande `rig` proposée par Ledge dans le chat** (actions `rig.act` / `rig.seats` du registre) : écrit, mais
  sur la branche séparée `feat/chat-rig-actions`, en attente de ses textes (`actionWords`, `chat.action.verbs` fr/en), qui
  passent par design-ux, la validation de l'utilisateur, puis dev-front.
- Les réglages du daemon partagés entre Desktop et téléphone (voir § 4).

## 10. Équivalences Desktop

| Desktop (`openrig.*`, fleet) | Téléphone |
|---|---|
| `openrig.status` / `openrig.state` | `rigs.state` |
| `openrig.graph` / `graphState` | `rigs.graph` |
| `openrig.queue` / `queueState` | `rigs.queue` (`rows`), plus `closed` (nouveau) |
| — | `rigs.routing` (nouveau) |
| `openrig.permissions` / `permissionList` | `rigs.permissions` |
| `openrig.snapshots` / `snapshotList` | `rigs.snapshots` |
| `openrig.act` / `done` | `rigs.act` / `rigs.done` |
| `openrig.seats` / `reseated` | `rigs.seats` / `rigs.reseated` |
| `openrig.goals` / `goalsChanged` | `rigs.goals` |
| `openrig.goal.send` / `goal.sent` | `rigs.goal.send` / `rigs.goal.sent` |
| `openrig.goal.reply` / `goal.replied` | `rigs.goal.reply` / `rigs.goal.replied` |
| `openrig.asks` / `answer` (« À toi », lot 3) | inchangés (`openrig.asks`, `openrig.answer`) |
