# Contrat : « Nouvelle session » sur le téléphone (refonte mobile B5, partie 2)

Pour `dev-front`, qui code M2 §9 (l'écran « Nouvelle session ») sans avoir à demander. Les schémas zod font foi :
`packages/protocol/src/phone.ts` (`PhoneLaunchSchema`, `session.launch`, `confirm.prepare`, `project.folders`). Le
comportement est fixé par `packages/ledge/test/mobile-launch.test.ts`.

Maquette validée : `docs/mockups/ledge-mobile-refonte/m2-sessions.html` §9 (branche `design/mobile-refonte-m0-m1`,
commit `267e78bd`), Q20 et Q21 de `QUESTIONS.md`. Ce document répond aux deux questions posées à dev-back (§ 9 et § 10).

Le téléphone lance une session **sur le PC auquel il est appairé**, avec les champs de la modale Desktop du lot 4.

## 1. Drapeau

`snapshot.daemon.launch: true` : le PC accepte `session.launch`, et `project.folders` donne la branche des dossiers de ce
PC. Il n'est présent qu'avec `daemon.atelier` (les projets). Absent (PC plus ancien) : « Nouvelle » ne peut pas lancer. Un
`session.launch` envoyé quand même à un PC plus ancien est répondu par `{ type: 'error', code: 'invalid', request:
'session.launch' }`, sans `operation.result`.

## 2. Ce que le téléphone envoie

```
→ { type: 'session.launch', op, launch: PhoneLaunch, assertion }
PhoneLaunch = { project, tool, folders: [chemin, …], prompt, model?, effort?, approval? }      // strict : rien d'autre
← operation.result { op, status: received → applied | rejected | failed, reason?, id? }
```

| Champ de la maquette | Champ | Règle |
|---|---|---|
| Projet (avec sa machine) | `project` | l'id d'un projet du snapshot (`projects`) |
| Où travailler | `folders` | 1 à 20 chemins absolus, **tous des dossiers de ce PC (`machine: 'local'`) que le projet déclare** ; le premier est celui où l'agent démarre. Plus d'un seulement pour Claude Code et OMP (`PHONE_LAUNCH_MULTI`), sans doublon |
| Agent | `tool` | `claude`, `codex`, `cursor`, `omp` |
| Modèle et effort | `model?`, `effort?` | un choix de `models.listing` pour cet agent ; absents, l'agent prend son défaut |
| — (OMP seul) | `approval?` | `always-ask`, `write`, `yolo` ; refusé pour un autre agent |
| Premier message | `prompt` | obligatoire, non vide après `trim`, au plus `MESSAGE_MAX` |

- **Pas de nom** : le PC choisit le nom de l'agent (« Nova »), comme pour un lancement sans nom sur Desktop. Le premier
  événement du fil le dit (« Nova démarre à la table ledge. »).
- **Le dernier choix par projet** (agent, modèle, effort) est gardé **sur le téléphone**, comme Desktop le garde dans son
  navigateur (`apps/desktop/src/launch/modelPrefs.ts`). Le PC ne stocke rien.
- Les suggestions du premier message sont celles de Desktop (`launch.ideas`) : texte du téléphone, rien du PC.

## 3. La machine, et « Où travailler »

Le téléphone ne parle qu'à un PC : il ne peut lancer **que dans les dossiers de ce PC**. Un projet peut aussi déclarer des
dossiers d'autres machines (`machine` ≠ `local`, avec leur `label`) : ils s'affichent, mais un lancement qui en contient un
est refusé (`stale`). Le téléphone ne choisit jamais un chemin libre : seulement un dossier que le projet déclare.

`project.folders { id }` (déjà là avec `daemon.projectFolders`) donne maintenant, pour chaque dossier de ce PC :
- `exists` : le dossier est là ;
- `branch` : sa branche git, le commit court (7 caractères) quand HEAD est détachée, ou `null` (pas un dépôt, ou git n'a
  pas répondu à temps).

Ces deux champs manquent pour les dossiers des autres machines, et pour tous si git n'a pas pu répondre : la liste arrive
quand même. C'est ce qui permet d'écrire « Sur main, dans le dossier du projet ». Un dossier `exists: false` ne devrait pas
être proposé : le lancer donnerait `not_found`.

## 4. La passkey : oui

`session.launch` **exige** la vérification de l'appareil, but `launch`, liée **à ce lancement précis** :

```
→ { type: 'confirm.prepare', purpose: 'launch', launch: PhoneLaunch }            // sans qid
← { type: 'confirm.challenge', purpose: 'launch', challenge, rpId, credentialId, expiresInMs }
```

puis `session.launch` avec la même `launch` et l'`assertion` obtenue. Le défi couvre l'empreinte de `launch` entière
(`launchSubject`) : une assertion faite pour un autre projet, un autre dossier ou un autre premier message est refusée
(`assertion_invalid`).

Pourquoi : le premier message met un agent au travail sur le PC, dans un dossier de code, avec les droits de l'utilisateur.
C'est déjà la règle de `chat.launch` (lancer depuis une proposition du chat). Le niveau « réversible » du registre des
actions vaut pour les cartes du chat de Ledge ; il ne décide pas de la vérification du téléphone.

`confirm.prepare` répond `{ type: 'error', code: 'invalid', request: 'confirm.prepare' }` si le PC ne lance pas pour le
téléphone, si l'appareil n'a pas de passkey (ou une passkey d'un autre relais), ou si le projet est inconnu. Sans passkey
enregistrée, `session.launch` répond `rejected` / `confirm_required` : il faut d'abord l'enregistrer.

## 5. États et codes

| État de la maquette | Ce que le téléphone reçoit |
|---|---|
| « Lancement… » | `operation.result` `received` |
| Démarrée | `applied` avec `id` : la nouvelle session. Le téléphone ouvre son fil (`session.thread { id }`) ; elle arrive aussi dans le snapshot qui suit |
| Refusé | `rejected` avec `reason`, voir ci-dessous. **Rien n'a été lancé** |
| Échec | `failed` : le PC n'a pas pu démarrer l'agent (tmux, binaire de l'agent…). Rien n'a été lancé |
| Sans réponse | aucun résultat final après le délai du téléphone, voir § 6 |

Codes de refus (`reason`) :

| Code | Cas |
|---|---|
| `not_found` | un dossier n'est plus là sur le PC |
| `invalid` | ce que l'agent ne prend pas : plusieurs dossiers pour Codex ou Cursor, un dossier en double, `approval` hors OMP, un modèle ou un effort refusé par le PC ; ou un dossier trop large (le dossier personnel ou au-dessus, ou un lien symbolique qui y mène) |
| `stale` | le projet n'existe plus, ou un dossier n'est plus déclaré par le projet, ou appartient à une autre machine : recharger les projets |
| `confirm_required` | pas de passkey enregistrée, ou pas d'assertion |
| `assertion_invalid`, `assertion_expired`, `assertion_replayed` | comme pour les autres actions vérifiées : refaire la vérification |
| `unavailable` | ce PC ne lance pas pour le téléphone |

**Textes :** la maquette ne donne que celui de `not_found` (« Démarrage refusé : le dossier est introuvable », « Rien n'a
été lancé. Ton message est conservé. ») et celui du délai (« Le démarrage n'a pas répondu. »). Les textes des autres codes
et de `failed` sont à demander à `design-ux`.

## 6. Sans réponse, et « Réessayer »

Le PC ne fixe pas de délai : c'est le téléphone qui décide que le démarrage « n'a pas répondu ». Desktop attend 20 s
(`LAUNCH_TIMEOUT_MS`, `packages/fleet/src/launch.ts`) ; le téléphone peut prendre la même valeur.

« Réessayer » renvoie **le même `op`** avec la même `launch` et la même assertion :
- si le premier envoi est arrivé, le PC **rejoue son résultat** (avec le même `id`) et ne lance pas une seconde session ;
- s'il n'est jamais arrivé, il est traité normalement, une seule fois.
- Le même `op` avec une autre `launch` est refusé (`rejected` / `conflict`) : une autre `launch` demande un nouvel `op`.
- Si l'assertion a expiré entre-temps et que le PC n'a jamais reçu le premier envoi, la réponse est `assertion_expired` :
  refaire la vérification, puis envoyer avec **un nouvel `op`**.

Le PC garde le résultat 24 h (au plus 500 opérations, les plus anciennes finies partent d'abord).

## 7. Ce qui n'est pas dans ce lot

- Pas d'« Ouvrir dans le groupe » (propre à Desktop).
- Pas de lancement sur une autre machine que ce PC.
- Pas de nom choisi sur le téléphone.

## 8. Vérifié, et non vérifié

- Vérifié par les tests (`mobile-launch.test.ts`, Node 24) : un lancement appliqué avec son `id` et les champs reçus par le
  PC ; le rejeu du même `op` ; les refus `confirm_required`, `assertion_invalid`, `stale`, `invalid`, `not_found`,
  `unavailable`, et `failed` ; le schéma strict ; `project.folders` avec branche et existence, et sans git ; le drapeau ;
  le côté PC (`phoneLaunch`) : dossier absent, dossier personnel, option refusée par l'agent.
- Non vérifié : un vrai lancement depuis un téléphone, sur un vrai PC, de bout en bout (pas d'appareil ; l'écran est à
  `dev-front`).

## 9. Q20 : ce que le téléphone pouvait lancer, et la vérification

Avant ce lot, le téléphone ne lançait que depuis une proposition du chat (`chat.launch`), avec la passkey. `session.launch`
est le message qui manquait ; il demande la passkey (§ 4).

## 10. Q21 : ce que le daemon sait des sous-agents

Chaque session du snapshot porte déjà ses sous-agents : `PhoneSession.helpers`, une liste de
`{ id, kind, task, state, finishedAt? }` (`HelperSchema`, `packages/protocol/src/session.ts`).
- `task` : ce que le parent lui a demandé (première ligne) ; `kind` : le type d'agent quand l'outil le dit, sinon
  `subagent` ;
- `state` : `working` pendant qu'il travaille, `exited` quand il a fini (`finishedAt`) ;
- un sous-agent fini **disparaît après 5 minutes** (`HELPER_RETENTION_MS`). Le « +2 » de la maquette compte donc ceux qui
  travaillent et ceux finis depuis moins de 5 minutes ; pour ne compter que les actifs, filtrer sur `state`.

D'où le daemon le sait, par agent :

| Agent | Source | Limite |
|---|---|---|
| Claude Code | hooks SubagentStart / SubagentStop | ses agents internes (sans SubagentStart) ne sont pas suivis |
| Cursor Agent | l'outil Task du parent | la fin est déduite de l'étape suivante du parent |
| OMP | les événements RPC | — |
| Codex | **rien** | aucun sous-agent n'est connu |

Dans le fil du parent :
- l'élément `helper` (`{ task, agentType?, state: working | exited }`) marque le début et la fin d'un sous-agent ;
- les éléments du fil propre d'un sous-agent portent `helperId`.

Une demande (permission, question) venue d'un sous-agent porte `pending.helperId`. Le terminal d'un sous-agent est celui
de son parent, en lecture seule (`readOnly`).
