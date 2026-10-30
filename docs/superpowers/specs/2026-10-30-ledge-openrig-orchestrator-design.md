# Ledge, orchestrateur d'OpenRig : design

2026-10-30, session Plume. Ce document part du brainstorm `2026-10-30-ledge-openrig-orchestrator-brainstorm.md` (session Otto, versé à côté de ce document) et des maquettes https://claude.ai/artifact/FUfjAAe1tSUiK7FRMAt4JC (`docs/mockups/ledge-openrig/shots/`).

Conventions :
- **[U]** : décidé par l'utilisateur, pendant le brainstorm ou pendant la rédaction de ce design.
- **[P]** : choix de Plume. Un builder peut le changer sans revenir vers l'utilisateur, tant qu'il ne contredit pas un [U].
- Les faits OpenRig ont été vérifiés dans le paquet installé `@openrig/cli` **0.6.14**. Les chemins cités sont relatifs à `…/node_modules/@openrig/cli/`.

## 1. Intention

Aujourd'hui, Ledge sert à voir où en est chaque agent et lequel attend une action. Il devient **l'agent orchestrateur d'OpenRig** : l'agent clé, pas un tableau de bord.

- Il lance, crée et suit des rigs OpenRig.
- Il tranche les décisions des équipes en s'appuyant sur sa mémoire, et ne revient vers l'utilisateur que si c'est nécessaire.
- **Son mandat** : il ne tranche jamais seul une décision de design, d'architecture ou critique (données, sécurité, suppression, coûts). Celles-là remontent toujours à l'utilisateur. [U]

Le pourquoi : l'utilisateur ne veut plus être l'interlocuteur de chaque agent de chaque équipe. Il veut un seul interlocuteur, qui connaît ses règles et ne lui pose que les vraies questions.

### Objectifs

1. Les escalades des rigs et de l'operator arrivent à Ledge. **Ledge seul contacte l'utilisateur.** [U]
2. Ledge a un « cerveau » : une session qui tourne en permanence, quel que soit l'outil (Claude, Codex, OMP…). [U]
3. Les rigs, sièges et échanges entre agents sont visibles dans Ledge, sur Desktop, dans l'encoche, dans le TUI et sur mobile. On agit sur un siège de rig comme sur une session seule. [U]
4. On lance un rig depuis Ledge, dans un projet ou dans un espace créé à la volée hors projet. [U]
5. **Un rig peut tourner sur une machine distante, notamment une EC2**, comme sur la machine locale. C'est très important pour l'utilisateur. [U]
6. La gestion d'équipe propre à Ledge disparaît au profit d'OpenRig : `ledge team`, les rôles, `ledge task`. [U]

### Non-objectifs

- Réécrire la mécanique d'OpenRig : reboot, mises à jour, snapshots, santé et relèves restent à l'**operator**. Ledge lui donne des ordres, il ne refait pas sa logique. [P, d'après la recommandation du brainstorm]
- Modifier OpenRig en amont. On s'en tient à son CLI, son API HTTP et ses SSE. Si un manque bloque, il est noté comme demande amont (§12) et contourné.
- Lire ou écrire directement `~/.openrig/openrig.sqlite`. Le code d'OpenRig traite la base comme la sienne (journal en ajout seul, « direct SQL… contract violation »). [P]
- Le détail des écrans TUI et mobile : les maquettes des sessions Tuin et Mobi en décident (§10).
- Créer ou démarrer des instances EC2. Ledge utilise une machine qui figure déjà dans sa liste (alias SSH) ; l'EC2 est provisionnée et allumée en dehors de Ledge. [P]

### Anti-objectifs (échec même si « ça marche »)

- Ledge tranche une décision de design, d'architecture ou critique sans l'utilisateur.
- Ledge tue un siège de rig directement (`tmux kill`, `kill`). OpenRig le verrait comme un crash et le relancerait. [U]
- L'utilisateur reçoit les questions deux fois, par Ledge et par un autre canal (Slack, TUI d'OpenRig).
- Ledge déplace ou range des dépôts sans accord explicite (« Je ne déplace rien sans toi »).

## 2. Faits OpenRig qui façonnent le design

Vérifiés dans le paquet 0.6.14. Les points non vérifiés sont marqués ⚠.

1. **Humain** : `rig gateway human add <id> --display-name … --binding kind:connectorRef:secretsRef:primary`. Le record est stocké dans `~/.openrig/gateway/humans/<id>.yaml` et son adresse est `<id>@external`.
   - **Slack est le seul connecteur** : `HUMAN_CONNECTOR_KINDS = {"slack"}` (`daemon/dist/domain/gateway/human-registry.js:25`), et une liaison au moins est obligatoire.
   - Il n'existe ni connecteur local ni mode « lecture de la queue seulement ». Sans transport Slack, une ligne reste en `transport-failed`/`never-posted` (skill messaging-the-human, l. 125-129). ⚠ Reste à vérifier que la ligne reste lisible et fermable dans cet état.
2. **Escalade** : un siège crée `rig queue create --destination <id>@external --human-intent decision|update --summary … --evidence-ref … [--human-questions-file] [--reply-to <qitem>]`.
   - Une escalade porte de 1 à 4 questions. Chaque question a de 2 à 4 options, dont éventuellement une `recommended`.
   - Le siège se met en attente avec `rig queue block <work> --on <human-qitem>`. Fermer la ligne humaine réveille ce qui en dépend.
3. **Répondre sans Slack** : aucune route CLI ni HTTP n'expose `resolveDirectHumanReply`, le chemin de Slack. Ce qui existe :
   - `POST /api/mission-control/action`. `approve` passe la ligne à `done/no-follow-on`, `deny` à `done/denied`, et `annotate` ne fait qu'un audit.
   - `resolve`, mais seulement pour une ligne bloquée sur un siège `human(-x)?@(kernel|host)`.
   - ⚠ Reste à vérifier si `approve` porte le texte de la réponse jusqu'au siège, et comment l'acteur est identifié (`X-OpenRig-Session`).
4. **API** : `127.0.0.1:7433`, sans jeton en boucle locale.
   - `GET /api/rigs`, `/api/rigs/summary`, `/api/rigs/:id/graph`, `/api/ps`, `/api/queue/list`, `/api/attention`, `/api/kernel`.
   - Cycle de vie : `POST /api/up`, `/api/down`, `/api/rigs/:id/up`, `/api/rigs/:rigId/restore`, et `/api/seat/{launch,restart,stop,status,handover}/:seatRef`.
   - **Événements en SSE** : `GET /api/events?replay=n`, qui reprend avec `Last-Event-ID`.
5. **Lancement** : `rig up <spec|bundle|nom> --cwd … --env K=V --plan --yes --json`.
   - Il n'y a **pas de drapeau « but »**. Le but passe par un `startup.actions` (`send_text`) ou par un message au lead une fois le rig prêt.
   - Specs livrées : starter (2 sièges), factory (7). Workshop est un bundle du registre.
   - Fichiers écrits dans le cwd d'un siège : bloc géré dans `CLAUDE.md`/`AGENTS.md`, `.openrig/`, et `.claude/settings.local.json` fusionné.
6. **Identité d'un siège** :
   - Session tmux `{pod}-{member}@{rig}`.
   - Variables `OPENRIG_NODE_ID`, `OPENRIG_SESSION_NAME`, `OPENRIG_RUNTIME`, `OPENRIG_SEAT_PROJECT_DIR`… dans l'environnement du processus.
   - Les hooks Claude/Codex de Ledge, déjà installés, voient donc qu'une session est un siège de rig.
7. **Noyau** : `advisor.lead` (Claude), `operator.agent` (Codex), `queue.worker` (Codex) et `operator.human` (terminal `rig tui`).
   - L'operator escalade vers `operator.human`.
   - On saute le noyau avec `OPENRIG_NO_KERNEL=1`. Aucune variante sans advisor n'est livrée.
8. **Notification** : `OPENRIG_NOTIFICATIONS_MECHANISM=webhook` et `OPENRIG_NOTIFICATIONS_TARGET=<url>` déclenchent un POST à chaque `queue.created` de tier `human-gate`. Ce serait une sonnette possible, mais le SSE suffit.

## 3. Architecture d'ensemble

```
             Desktop · encoche · TUI · mobile (relais)
                          │  WebSocket 47831 (protocole Ledge)
                 ┌────────┴─────────┐
                 │   daemon Ledge   │
                 │  ┌────────────┐  │  SSE /api/events, HTTP 7433, CLI rig
                 │  │ rig bridge │──┼────────────────────► daemon OpenRig
                 │  └────────────┘  │                      (noyau, rigs, queue)
                 │  ┌────────────┐  │
                 │  │  cerveau   │◄─┼── session permanente (tmux « ledge-brain »)
                 │  │ (mandat,   │  │   outil au choix, parle via `ledge brain …`
                 │  │  mémoire)  │  │
                 │  └────────────┘  │
                 └──────────────────┘
```

Trois nouveaux modules dans le daemon Ledge (`packages/ledge/src/daemon/`) [P] :

- **`openrig/` (le pont)** : seul endroit qui parle à OpenRig. Il tient un miroir des rigs, des sièges, de la queue humaine et des échanges, le diffuse aux clients et exécute les ordres (cycle de vie, lancement, réponses).
- **`brain/` (le cerveau)** : la session permanente, son mandat, sa mémoire et le garde du mandat.
- **`ledgeThread` (le fil de Ledge)** : la conversation unique entre l'utilisateur et Ledge. Elle remplace le chat ponctuel d'aujourd'hui, `chat/service.ts` et `claude -p` par jour.

Le protocole (`packages/protocol`) gagne des schémas `rig.*`, `escalation.*`, `brain.*` et `ledge.thread.*`. Le snapshot porte `openrig: OpenRigInfo | null` et `capabilities.openrig`. [P]

## 4. Intégration OpenRig (le pont)

### 4.1 Présence d'OpenRig

- Le pont sonde `GET /healthz` toutes les 5 s. Il connaît trois états : `absent` (pas de `rig` dans le PATH), `arrêté` et `en marche` avec sa version.
- **Ledge démarre OpenRig lui-même quand il est arrêté** (`rig daemon start`), sur la machine concernée. [U] Il le fait dans trois cas :
  - au démarrage du daemon Ledge, si des rigs tournaient avant l'arrêt ;
  - au lancement d'un rig ;
  - à une action sur un rig.

  Il le dit dans le fil (« J'ai démarré OpenRig sur ec2-build »). Si le démarrage échoue, l'onglet Rigs montre l'erreur et « Réessayer ». [P pour les cas et l'affichage]
- Sans OpenRig, Ledge fonctionne comme aujourd'hui pour les sessions seules. Les sections Rigs restent vides, avec une invitation.
- Version : le pont refuse une version majeure ou mineure inconnue d'OpenRig et l'affiche (« OpenRig 0.7 non pris en charge »), plutôt que de mal lire. La version minimale est 0.6.14. [P]

### 4.2 Ledge inscrit comme humain

- **Ledge s'inscrit directement comme l'humain d'OpenRig**, sans geste de l'utilisateur, dès qu'il trouve un OpenRig sans humain `ledge`. Il le fait sur chaque machine où un rig tourne. [U] Réglages › OpenRig montre l'inscription et permet de la retirer.
- Commande : `rig gateway human add ledge --display-name "Ledge" --binding slack:<ref>:<ref>:primary --delivery-class …`. La liaison Slack obligatoire est un **leurre** : aucune connexion Slack n'existe, donc rien ne part. [P] Le lot 0 doit prouver que :
  - a) l'inscription passe avec ce leurre ;
  - b) une ligne `ledge@external` reste lisible et fermable malgré `transport-failed`.

  Si a) ou b) échoue (la sonde du lot 0 le dira), on bascule sur le **plan B**, un repli technique qui garde l'intention de l'utilisateur (Ledge est l'humain) : Ledge ne s'inscrit pas. Les sièges sont alors priés, par le contexte injecté au lancement (§4.6), de se bloquer sur `human-ledge@host` et de poser leur question en ligne `human-gate`. Ledge répond par `resolve`, la voie prévue pour les sièges humains locaux, qui porte le texte de la décision.
- **L'operator** escalade vers `operator.human`. Le pont lit aussi les lignes `human-gate` et celles adressées à `operator.human`, et les traite comme des escalades. Ledge les répond, donc l'utilisateur n'a pas à ouvrir `rig tui`. [P]
- Pas de double canal : comme aucun Slack réel n'est branché, l'utilisateur ne reçoit rien ailleurs. [P]

### 4.3 Lire

- **Miroir** : au démarrage et à chaque reconnexion, le pont lit `GET /api/ps`, `/api/rigs/summary`, `/api/rigs/:id/graph` (sièges et arêtes), `/api/kernel` et `/api/queue/list`. Ensuite il suit `GET /api/events` en SSE et reprend avec `Last-Event-ID`, qu'il conserve dans `~/.ledge/openrig.json`.
- Événements utilisés :
  - `queue.created/updated/handed_off` : escalades, tâches et passations, pour le fil des échanges ;
  - `session.status_changed`, `node.launched` et `seat.activity_changed` : état des sièges ;
  - les envois `rig send` (outbox) : échanges de type message. ⚠ Le nom exact de l'événement outbox est à confirmer au lot 0. À défaut, `GET` sur la route outbox par rig, en polling de 5 s.
- **Rattacher un siège à une session Ledge** : le hook Ledge lit `OPENRIG_SESSION_NAME` et `OPENRIG_NODE_ID` dans son environnement et les envoie avec `session.register`.
  - `SessionSchema` gagne `rig?: { rigId, rigName, seat, pod, member }`. La source de vérité de l'appartenance reste le graphe OpenRig ; le hook ne sert qu'à apparier.
  - Une session appariée **n'est plus une session seule** : elle sort de Projets et va sous son rig. [P]
- **Escalade (modèle Ledge)** :
  - `{ id: qitemId, rigId?, from: seat, intent: 'decision'|'update', summary, detail?, evidenceRef, questions[{id, question, options[{id, label, recommended}]}], replyTo?, createdAt, state }` ;
  - plus, côté Ledge, `category` (§5.3), `handledBy: 'ledge'|'user'|null` et `answer`.

### 4.4 Répondre

- Une réponse est un ensemble `{questionId → optionId | texte libre}`. Le pont :
  1. crée la ligne de réponse vers le siège source : `rig queue create --destination <source_session> --summary "Réponse de Ledge : …" --body-file …`, avec `--reply-to` quand c'est un `update` ;
  2. ferme la ligne humaine avec `POST /api/mission-control/action {verb: "approve", qitemId, annotation: <réponse>}`, ou `deny` si l'utilisateur refuse en bloc. Cette fermeture réveille le travail bloqué.

  C'est le comportement de `resolveDirectHumanReply` (Slack) refait avec les routes publiques. [P] Si le lot 0 montre que `approve` porte déjà la réponse jusqu'au siège, l'étape 1 saute. Dans le plan B, une seule étape suffit : `resolve` avec `decision`.
- **« En parler »** : il ouvre la conversation avec Ledge au sujet de l'escalade (§6). La réponse finale part toujours par le même chemin.
- Un `update` n'appelle pas de bouton. Il s'affiche dans le fil et se ferme quand il a été vu (`approve`), ou automatiquement après qu'il a été montré. [P]

### 4.5 Agir sur un rig ou un siège

Tout passe par OpenRig, jamais par tmux. [U]

| Geste Ledge | Appel OpenRig |
|---|---|
| Arrêter un rig | `POST /api/down` (rig) |
| Relancer / reprendre un rig | `POST /api/rigs/:id/up`, `/restore` |
| Relancer un siège | `POST /api/seat/restart/:seatRef` |
| Arrêter un siège | `POST /api/seat/stop/:seatRef` |
| Relève (contexte plein) | `POST /api/seat/handover/:seatRef` |
| Écrire à un siège (`@build …`) | `rig send <seat> "<texte>"`, signé « Ledge » |
| Répondre / interrompre / approuver une permission dans le terminal d'un siège | comme pour une session seule : le siège est une session Ledge appariée, et ces gestes ne changent pas son cycle de vie |

- Le serveur refuse `session.kill`, `session.close` et `session.delete` sur une session appariée à un rig, avec un code `rig_managed`. Les clients proposent à la place l'équivalent OpenRig. [P]
- « Arrêter… » demande une confirmation. Elle dit ce qui s'arrête et propose « Arrêter le rig » ou « Seulement ce siège ».

### 4.6 Lancer un rig

Lancement en trois temps, comme les maquettes `l-1` à `l-3`.

1. **Nouveau rig** : le but donné au lead, la spec (recommandée par Ledge, avec « Changer » : starter, workshop, factory, ou depuis le registre), les fournisseurs, puis **où** :
   - un projet Ledge, **une machine** (locale, ou distante comme une EC2) et un dépôt [U] ;
   - ou **un espace hors projet** (§4.7).
2. **Le plan** : sièges et modèles, ce qui change dans le dossier, « Travailler dans une copie : `.worktrees/rig-<nom>` », ce que Ledge fera après le lancement, et la commande `rig up` affichée.
   - **Le plan est facultatif**, derrière « Voir le plan ». [U]
   - **Il est imposé une fois** quand le rig écrirait dans un vrai dépôt de l'utilisateur, c'est-à-dire ni une copie `.worktrees/` ni un espace hors projet. Dans ce cas, « Lancer le rig » à l'étape 1 devient « Voir le plan », et « Lancer » n'existe qu'à l'étape 2. [U]
3. **Le démarrage** : le rig apparaît dans Rigs › En cours avec ses sièges qui démarrent, et « Annuler le lancement » (= `rig down`).
   - Les invites de confiance de dossier sont remontées : « design attend ta confiance dans le dossier · Ouvrir l'invite ».
   - Ledge ne répond jamais à ces invites à la place de l'utilisateur.

Comportement :
- Ledge lance `rig up <spec> --cwd <dossier> --yes --json`. Par défaut, le dossier est une copie `git worktree` créée par Ledge sous `<dépôt>/.worktrees/rig-<nom>`, sur une branche `feat/<nom>` choisie à l'étape 1. [P, d'après la maquette]
- **Le but** est remis par Ledge au lead dès que tous les sièges sont prêts (`rig send <lead> "<but + mandat>"`). Si les sièges ne sont pas tous prêts au bout de 10 min, le but part quand même vers le lead et l'utilisateur en est prévenu. [P]
- **Le contexte Ledge des sièges** : à leur premier `session.register`, les sièges d'un rig reçoivent par le hook un contexte court. Il dit qui est leur humain (`ledge@external`), comment escalader (le skill messaging-the-human d'OpenRig), et ce que Ledge tranche seul ou non, pour qu'ils sachent à quoi s'attendre. Ce contexte ne parle pas de `ledge task` (retiré, §7). [P]

### 4.7 Rig hors projet et dépôts trouvés

- **Espace hors projet** : un dossier `~/.ledge/rigs/<nom>` créé à la volée. Le nom vient du but, et l'utilisateur peut le modifier. [P] Il ne se trouve pas sous `~/.openrig/workspace`, pour ne pas mêler le catalogue d'OpenRig. Le rig est lancé avec `--cwd` sur ce dossier.
- **Dépôts trouvés** : le pont repère les dépôts du rig de deux façons [P] :
  - a) il parcourt l'espace toutes les 30 s, sur 3 niveaux, à la recherche de dossiers `.git`, et note la branche, le dépôt distant et le nombre de fichiers modifiés ;
  - b) il lit le `cwd` des sessions appariées et les chemins lus ou écrits que les hooks remontent déjà, puis rattache chaque dépôt au premier siège qui l'a ouvert (« cloné par build », « lu par advisor »).
- **« Ranger dans un projet »** : Ledge propose un projet (« c'est le seul dépôt modifié »), l'utilisateur choisit. Ranger, c'est :
  - rattacher le rig au projet dans `~/.ledge/projects.json` (`rigs: [rigId]`), ce qui affiche « dans <projet> » sur sa plaque ;
  - **sans rien déplacer sur le disque**. [U, option 1 : le rig garde sa pièce]

### 4.8 Rigs sur machines distantes (EC2) [U]

Ledge suit déjà des machines distantes : chacune figure dans `machines.json` avec son alias SSH et fait tourner son propre daemon Ledge. Les clients (`@ledge/fleet`) joignent chaque daemon par le pont `/ssh/<alias>`, avec le jeton de cette machine. Les rigs suivent le même chemin [P] :

- **Un pont OpenRig par machine.** Le daemon Ledge de chaque machine fait tourner son propre pont vers **son** OpenRig, en `127.0.0.1:7433` sur cette machine. Il l'inscrit (§4.2), le démarre (§4.1) et lance les rigs dessus. OpenRig n'est jamais exposé sur le réseau, et rien ne change côté sécurité.
- **Les clients** voient les rigs de chaque machine comme ils voient ses sessions : rigs, sièges et escalades portent la machine. La plaque d'un rig distant porte la machine (« sur ec2-build »).
- **Le cerveau est unique** et vit sur la machine locale. Le daemon local devient client des daemons distants, avec `@ledge/fleet` par le même pont SSH. Il reçoit leurs escalades et leurs états de rigs, et leur transmet les réponses et les ordres. Le garde du mandat s'exécute dans le daemon local, avant tout envoi. La mémoire et le mandat restent sur la machine locale.
- **Machine coupée** (EC2 éteinte, SSH perdu) : ses rigs passent « injoignables », sans être retirés. Ses escalades restent en attente là-bas, puisque les sièges sont bloqués sur la ligne humaine, et réapparaissent à la reconnexion.
- **OpenRig absent** sur la machine choisie : le lancement le dit (« OpenRig n'est pas installé sur ec2-build ») et donne la commande d'installation. Ledge n'installe rien à distance. [P]
- **Rig hors projet** sur une machine distante : l'espace est `~/.ledge/rigs/<nom>` sur cette machine.

## 5. Le cerveau

### 5.1 Une session permanente

- Le cerveau est une session Ledge ordinaire, nommée « Ledge » et marquée `brain: true`. Elle tourne dans tmux (`ledge-brain`), sur l'outil choisi dans Réglages › Ledge › Outil (Claude par défaut, ou Codex, Cursor, OMP). [U pour « quel que soit l'outil », P pour le défaut]
- Le daemon la démarre à son propre démarrage, si l'utilisateur l'a activée (Réglages › Ledge › « Ledge pense en continu », activé par défaut à la première ouverture de l'onglet Mandat). Il la relance si elle meurt, au plus 3 fois en 10 min, puis il l'affiche en panne.
- Elle reprend son historique (`--resume` pour Claude, l'équivalent sinon), et repart sur une conversation neuve chaque jour, avec un résumé de la veille. Si son contexte dépasse 70 %, Ledge la relève avec le mécanisme de relève actuel (`daemon/handover.ts`, conservé). [P]
- **Sans cerveau** (désactivé, en panne, ou pas encore activé) : le fil de Ledge répond avec le chat ponctuel d'aujourd'hui (`chat/service.ts`, `claude -p --restricted` par jour), qui garde ses cartes d'action (lancer, relayer, fermer, ranger, que l'utilisateur clique). Le cerveau, une fois actif, remplace ce coureur ponctuel et propose les mêmes cartes avec `ledge brain propose`. Il n'y a pas de régression pour qui n'active pas le cerveau. [P]
- Activation : proposée à la première ouverture de l'écran Ledge quand OpenRig est présent, puis mémorisée. [P]
- Elle n'est **pas** un siège OpenRig. Ledge reste l'humain du rig, pas un agent du rig. [P]

### 5.2 Ce que le cerveau reçoit et peut faire

- **Il reçoit**, sous forme de messages injectés dans sa session (comme les `<ledge-message>` d'aujourd'hui) :
  - chaque escalade nouvelle ;
  - chaque message de l'utilisateur dans le fil de Ledge ;
  - les changements d'état notables : rig prêt, siège en panne, relève ;
  - les réponses qu'on lui donne.
- **Il agit seulement par des commandes `ledge brain …`**, que le daemon exécute et vérifie. Il n'a pas la main sur `rig` directement [P] :
  - sa session démarre avec un `PATH` où `rig` et `tmux` sont des cales qui refusent (« passe par ledge brain ») ;
  - là où l'outil a un hook bloquant (Claude, Codex), le hook refuse aussi `rig`, `tmux` et `curl … 7433` ;
  - le risque résiduel, un outil qui contournerait la cale par un chemin absolu, est accepté. La parade est ailleurs : seul le pont de Ledge peut **répondre** à une escalade `ledge@external`, et toute décision passe donc par le garde du daemon.

| Commande | Effet |
|---|---|
| `ledge brain say "<texte>"` | une bulle de Ledge dans le fil |
| `ledge brain decide <escalade> --answer q1=opt … --category <cat> --rule <id?> --why "<…>"` | Ledge tranche seul (garde §5.3) |
| `ledge brain ask <escalade> --category <cat> --advice "<…>"` | remonte l'escalade à l'utilisateur avec son avis : c'est la décision dans le message |
| `ledge brain rig up/down/restart/handover …` | ordres de cycle de vie. Un `up` ou un `down` de rig n'est accepté que si l'utilisateur l'a demandé dans le fil (lien vers son message) |
| `ledge brain send <siège> "<texte>"` | écrire à un siège |
| `ledge brain propose <action> …` | une carte d'action dans le fil (lancer, relayer, fermer, ranger une session seule…), exécutée seulement si l'utilisateur clique, comme les cartes du chat d'aujourd'hui |
| `ledge brain remember "<règle>" --from <décision>` | propose une règle (à valider) |
| `ledge brain who` / `rigs` / `escalations` / `rules` | lire |

### 5.3 Le mandat et son garde

- Mandat : `~/.ledge/mandat.md`, lisible et éditable (« Ouvrir »). Il contient deux listes de catégories [U] :
  - **Ledge tranche seul** : git et branches, tests et relectures, contexte et relèves, petits choix de code ;
  - **Te revient toujours** : design (UI, copie), architecture (stockage, API), critique (données, sécurité, suppression, coûts).
- Le cerveau donne une catégorie à chaque escalade. **Le daemon refuse** `decide` sur une catégorie « te revient toujours », ou sur une catégorie inconnue, et la transforme en `ask`. Le garde est donc dans le daemon, pas seulement dans le prompt. [P]
- Ce que le garde ne voit pas, c'est une catégorie mal choisie. Pour y parer [P] :
  - toute décision tranchée seule apparaît dans « Tranché aujourd'hui » avec « Revenir dessus » ;
  - « Me le remonter désormais » sur une catégorie la fait passer dans « te revient toujours » ;
  - une escalade dont une option porte des mots-clés critiques (`rm`, `drop`, `delete`, `force`, `prod`, `secret`, `billing`…) est classée critique d'office.
- **Concurrence avec l'utilisateur** : une escalade nouvelle n'est tranchée par le cerveau qu'après **60 s** de délai de grâce. Pendant ce temps, À toi, le fil, l'encoche et le mobile la montrent avec « Ledge s'en occupe… », et l'utilisateur peut répondre. La première réponse enregistrée par le daemon gagne ; l'autre est refusée (`already_answered`). [P]
- **Revenir dessus** : si le siège n'a pas encore agi (la ligne de réponse n'a pas été réclamée), Ledge envoie une correction au siège. Sinon il ouvre une conversation avec le cerveau pour défaire, et l'utilisateur voit ce que ça implique avant d'envoyer. [P]

### 5.4 La mémoire

- `~/.ledge/memoire/` :
  - `rules.json` : règles retenues, avec `{id, text, since, from, appliedCount, status: 'active'|'proposed'}` ;
  - `decisions.jsonl` : toutes les décisions, de Ledge ou de l'utilisateur, avec escalade, catégorie, réponse, règle appliquée et horodatage.
- **Proposer une règle** : quand l'utilisateur tranche deux fois pareil sur des escalades de même catégorie, Ledge propose une règle (en bleu, « à valider »). Elle ne s'applique qu'une fois validée. [U, d'après la maquette Mandat]
- La mémoire est injectée dans le cerveau au démarrage et à chaque relève (règles actives, 20 dernières décisions), et lisible à tout moment via `ledge brain rules`.

## 6. Le fil de Ledge (conversation)

- Il y a **une seule conversation** utilisateur ↔ Ledge, persistée dans `~/.ledge/ledge-thread.jsonl`, qui remplace `chat.json`. Les fils par session de `chat/threads.ts` (« Demander à Ledge » sur une session) restent tels quels. [P]
- Éléments du fil :
  - message de l'utilisateur, à droite ;
  - bulle de Ledge, à gauche avec la mascotte ;
  - **décision dans le message** : l'escalade remontée, avec catégorie, provenance (`orch-lead@factory · il y a 4 min`), question, « Mon avis », options en boutons et « En parler » ;
  - **tranché** : « J'ai tranché pour build : … · Règle du 26/10 · Revenir dessus » ;
  - **groupe d'échanges** : les échanges entre agents d'un rig dans une fenêtre de temps, repliés (« factory · 3 échanges · 16:36 → 16:42 », « Replier/Voir »). [U, proposition A]
- Saisie : « Écrire à Ledge… (@build pour un agent d'un rig) ». `@siège` écrit directement au siège, par `rig send` signé Ledge, et l'échange s'affiche dans le fil. [U d'après la maquette, P pour le chemin]
- Suggestions sous la saisie : « Lance un rig… », « Où en est factory ? », « Qu'as-tu tranché ? », « Qui a besoin de moi ? ».
- Le cerveau répond dans le fil. Tant qu'il est arrêté, les messages attendent (« Ledge est arrêté · Démarrer ») et les escalades remontent directement à l'utilisateur, sans avis. [P]

## 7. Retrait du système d'équipes de Ledge

**Le retrait se fait d'abord, avant de construire l'intégration.** [U]

### Ce qui part
- `ledge team`, `ledge task`, le drapeau `--role`, et `ledge decide` sous sa forme liée aux tâches.
- Côté daemon : `daemon/{teams,teamsLive,tasks,roles,seat,definitions}.ts`, les cas `role.*`, `template.*`, `task.cmd`, `roles.list`, `team.*` et `definitions.list` de `server.ts`, et le journal `teamsJournal`/`tasksJournal`.
- Côté protocole : `teams.ts`, `tasks.ts`, `phoneTeams.ts`, `ChatTeamProposalSchema`, `ChatTasksSchema`, les actions d'équipe de `actions.ts`, et `role`/`roleLabel`/`team` de `SessionSchema`.
- Les surfaces :
  - Desktop : `teams/`, `TeamLaunch`, `RoleChooser`, `useTeamCards`, les onglets Équipes et Tâches de `LedgeHome`, la ligne d'équipe de la barre latérale et la table d'équipe de l'Atelier (`.heading-team-line`) ;
  - TUI : `Teams.tsx`, `catalog.ts` ;
  - mobile : `Teams`, `LiveTeam`, `TeamEditor`, `RoleEditor`, `SeatModel`, `model/teams*`, `ui/teams/*` ;
  - UI partagée : `TaskCard`, `TeamCard` ;
  - tests associés.
- Le texte injecté aux sessions par `cli/hook.ts`, qui parle de `ledge task …`.

### Avant le retrait

`ledge task list` ne montre aucune tâche ouverte au 2026-10-30. Le lot 1 vérifie qu'aucune équipe n'est en cours (`ledge team list`) avant de fusionner, et part seul, sans attendre les lots OpenRig. On accepte qu'il n'y ait plus d'équipes Ledge jusqu'au lot 5. [U pour l'ordre, P pour la vérification]

Les sessions Tuin et Mobi ne font que des maquettes : le lot 1 supprime lui-même les écrans d'équipes du TUI et du mobile, sur sa propre branche depuis `origin/main`. [P]

### Ce qui reste, ou le remplace pendant la transition
- `ledge who`, `ledge send` et `ledge read` (mailbox entre sessions) restent tels quels.
- **`ledge ask "<question>" "<options, ta recommandation>"`** remplace `ledge task give ledge …` pour les sessions seules : une décision adressée à Ledge, que l'utilisateur voit dans À toi et à laquelle il répond depuis Ledge. Sa réponse réveille la session, comme aujourd'hui. [P]
  - Ces décisions vivent dans `~/.ledge/asks.json`, sans file de tâches.
  - Plus tard, le cerveau les reçoit comme les escalades des rigs, mais elles restent soumises au mandat.
  - `ledge decide` reste la commande de réponse de l'utilisateur (liste et réponse), branchée sur `asks`.
- `daemon/handover.ts` (relève de contexte) reste : il sert au cerveau et aux sessions seules.
- Données existantes : `tasks.json`, `teams-live.json` et `~/.ledge/teams/` sont ignorés, pas effacés. Une ligne du journal du daemon signale qu'ils ne sont plus lus. [P]
- Les specs de 2026-10-25/26/28 sur les équipes restent dans `docs/` comme historique, avec une ligne « Remplacé par 2026-10-30-ledge-openrig-orchestrator-design » en tête. [P]

## 8. Desktop

### 8.1 Barre latérale

- **En tête, Ledge comme une ligne de messagerie** (variante 1a) : avatar, « Ledge. », heure, aperçu d'une ligne (« Une décision t'attend · factory ») et nombre de non-lus. Un clic ouvre l'écran Ledge. Le champ « Demander à Ledge… » quitte la barre latérale ; `/` ouvre l'écran Ledge, saisie active. [U]
- **Atelier** : inchangé.
- **À toi** : inchangé, en dessous. Il regroupe les escalades remontées par Ledge (« orch-lead · factory » avec ses options) et les attentes des sessions seules. [U]
- **Projets** : les sessions seules uniquement, par projet puis branche. [U]
- **Rigs** : section nouvelle, avec « + » qui lance un rig. Chaque rig (pastille de couleur, nom, « rig · n », « hors projet » le cas échéant) déplie ses sièges actifs, comme les sessions. [U]
- **Noyau OpenRig** : dernière ligne de la section Rigs, repliée, avec « operator · queue ». L'advisor est rangé dans « +2 » (« +1 » avec le terminal humain), parce qu'il fait doublon avec Ledge. On ne le retire pas du noyau. [P, d'après la recommandation]

### 8.2 Écran Ledge (proposition A)

- En-tête : « Ledge. », puis « Orchestrateur OpenRig · n rigs, n agents · n sessions seules · tranche dans son mandat ».
- **Onglets : Conversation · Rigs · Mandat.** L'onglet « Décisions » est fondu dans Mandat › Dernières décisions. [U]
- **Conversation** : le fil (§6) prend la place, avec un **rail à droite** :
  - À toi : escalades et décisions, avec leurs boutons ;
  - Rigs : avancement « 4/6 au travail » et bouton « Table » ;
  - Tranché aujourd'hui : avec « Revenir » ;
  - puis « Résumer la journée », qui demande au cerveau un résumé dans le fil. [U]
- **Rigs**, en sous-onglets :
  - **En cours** : chaque rig avec ses sièges (adresse `@lead`, nom, état, outil, modèle, contexte), la barre « n/m au travail », et les boutons « Table », « Terminaux », « Arrêter… ». Le noyau apparaît en dernier (« au repos », « Santé »). Les dépôts trouvés et « Ranger dans un projet » s'y affichent pour un rig hors projet.
  - **Specs** : les specs disponibles (livrées, installées, registre), avec leurs sièges, et « Lancer avec cette spec ».
  - **Agents** : tous les sièges de tous les rigs, à plat, triés par état. C'est l'ancien « Rôles ». [U, d'après la recommandation]
- **Mandat**, en sous-onglets :
  - **Ce que Ledge tranche** : les catégories, à gauche (Ledge tranche seul / Te revient toujours) ; à droite, le détail d'une catégorie (règles retenues, dernières décisions, « Me le remonter désormais »).
  - **Souvenirs** : les règles, et l'historique complet des décisions avec un filtre (Ledge / toi, catégorie, rig) et « Revenir dessus ».
  - En pied : chemins du mandat et de la mémoire.

### 8.3 Atelier : une pièce, une table [U]

- Un projet est une pièce avec une table : ses sessions seules. Il n'y a plus de table d'équipe dans un projet.
- Un rig est une pièce avec une table : ses sièges. La plaque du rig affiche « dans <projet> » ou « hors projet », et ses actions (Terminaux, Arrêter…) sont dans « … ».
- Les échanges entre sièges sont dessinés comme les transmissions d'aujourd'hui (`MessageLayer`), avec la source du pont au lieu des tâches.
- Le bureau de Ledge (`LedgeDesk`) montre sa bulle d'état (« J'orchestre 2 rigs · 1 décision pour toi »).
- Le noyau a sa pièce, comme un rig : operator et queue à sa table, l'advisor rangé dans « +2 ». C'est aligné sur le TUI, où l'utilisateur l'a validé. [U pour le TUI, P pour Desktop]
- Le défaut de 0.29 (`.heading-team-line` qui déborde) disparaît avec la table d'équipe.

### 8.4 Lancer un rig

Fenêtre en trois temps (§4.6), ouverte par « + » de la section Rigs, « Lance un rig… », ou la commande Ledge « Lance un rig pour … » (le cerveau pré-remplit la fenêtre). La fenêtre Nouvelle session reste pour les sessions seules.

### 8.5 Encoche

- **Fermée** : Ledge seul, sans rangée de bots. [U] Quatre états :
  - calme : la mascotte ;
  - échange : la dernière ligne d'un échange ;
  - tranché : « J'ai tranché … » ;
  - pour toi : catégorie, résumé et compteur.
- **Ouverte** :
  - la décision en attente, épinglée en haut, avec ses boutons ;
  - puis **un seul fil mêlé** : échanges entre agents, décisions de Ledge, messages de l'utilisateur et réponses de Ledge ;
  - un filtre **« Seulement Ledge »** qui masque les échanges entre agents [U] ;
  - le champ « Écrire à Ledge… (@build pour un agent) » toujours présent. [U]
- La liste des sessions et les autres modes actuels (`SessionView`, `LaunchView`…) restent accessibles comme aujourd'hui. Seul le mode `chat` devient ce fil, et le mode `handle` prend l'apparence de Ledge seul. [P]

## 9. Ce que les clients reçoivent (protocole)

Ajouts à `ServerMessageSchema` [P, noms indicatifs] :
- `openrig.status { state, version }` ;
- `rig.snapshot { rigs[], kernel }` et `rig.updated { rig }` / `rig.removed { rigId }`, où un rig vaut `{ id, name, spec, cwd, projectId?, offProject, lifecycle, seats[{ ref, address, name, runtime, model, state, contextPct, sessionId? }], repos[] }` ;
- `escalation.updated { escalation }` / `escalation.removed { id }` ;
- `ledge.thread.item { item }` (message, bulle, décision, tranché, groupe d'échanges), avec `ledge.thread.history` à la demande ;
- `brain.status { state: 'off'|'starting'|'on'|'down', tool, contextPct }`.

Côté client : `rig.act { rigId|seatRef, verb }`, `rig.launch { … }`, `rig.adopt { rigId, projectId }` (Ranger), `escalation.answer { id, answers, by: 'user' }`, `ledge.say { text }`, `mandate.update`, `rule.validate|reject`, `decision.revisit { id }`.

Le relais mobile transmet ces messages comme les autres, avec les actions OpenRig derrière la clé d'accès (maquette Mobi).

## 10. TUI et mobile

Ils sont conçus par d'autres sessions ; ce design ne fait que leur réserver une place.

- **TUI** (session Tuin, maquette https://claude.ai/artifact/39cmxt4BPuZRSArkHPcowt) :
  - l'accueil de `ledge tui` devient « Ledge en tête », l'écran Ledge A en trois colonnes [U] ;
  - « À toi » n'y apparaît qu'une fois, sous la ligne Ledge, pas dans le rail [U] ;
  - une session OMP y montre son fil RPC dessiné comme un terminal ; le Desktop garde ses cartes [U] ;
  - le volet Terminal d'un harnais tmux est un aperçu en direct, en lecture seule ; on tape dedans en l'attachant avec `a`, comme aujourd'hui, et il n'y a pas de terminal interactif dans le volet [U] ;
  - ce volet est en vraies couleurs, donc le daemon capture avec `capture-pane -e` (`packages/ledge/src/tmux.ts:86`) pour le TUI. Les aperçus sont 3 à 5 fois plus lourds, donc on ne capture en couleur que pour un client qui le demande [U pour la couleur, P pour la limite] ;
  - écrans 1 Ledge / 2 Rig / 3 Session, l'écran Équipes disparaît, et le noyau a sa pièce comme un rig [U] ;
  - il consomme les mêmes messages (§9). Le plan facultatif sauf écriture et l'écriture directe à un siège (`@siège`) valent aussi pour le TUI. Le découpage de ses écrans se règle avec Tuin.
- **Mobile** (session Mobi, maquette https://claude.ai/artifact/2FXtE18YzaXkkKD7ZXGC32) :
  - onglets Ledge · À toi · Rigs · Projets ; l'onglet Équipes disparaît [U] ;
  - l'écran Ledge reprend A en une colonne, variante **A1** (bandeau « Le point » et feuille) [U] ;
  - la clé d'accès n'est demandée que pour ce qui agit : lancer, arrêter ou relancer un rig, et les accords risqués. Répondre à une décision remontée se fait d'un geste, y compris depuis la notification [U] ;
  - le lancement d'un rig passe par Ledge (carte, plan en feuille, confirmation).
  - son design et son plan sont chez Mobi (`.worktrees/mobi-mockup`, `docs/superpowers/specs/2026-10-30-ledge-mobile-orchestrator-design.md` et `plans/2026-10-30-ledge-mobile-orchestrator.md`), à exécuter **après** les lots daemon ;
  - ce que le téléphone attend du daemon, via le seam `PhoneOrchestrator` du plan mobile :
    - lecture : rigs (sièges, état, place projet ou hors projet, branche), escalades (`kind` design, architecture ou critique, avis de Ledge, souvenirs datés, 1 à 4 options), tranché du jour (avec rouvrir), échanges par rig (200 derniers), queue par rig ;
    - actions : `answer(id, option)`, `propose(goal, spec?, projet|null)`, `launch(qid)`, `stop(rig)`, `restartSeat(rig, seat)`, `holdsSeat(sessionId)`.

    Les messages du §9 doivent couvrir ces besoins ; le plan nomme la correspondance.
- Chacun aura ses propres lots, après les lots daemon dont il dépend (§11). Les écrans d'équipes y disparaissent dès le lot de retrait.

## 11. Découpage en lots (aperçu pour le plan)

0. **Sonde OpenRig**, sur un **OpenRig jetable** (`OPENRIG_HOME` dans un dossier temporaire, autre port) [U]. Elle ne touche rien à `~/.openrig`, mais on demande quand même l'accord de l'utilisateur au moment de la lancer. Elle vérifie : inscription avec le leurre, ligne `@external` lisible et fermable, effet d'`approve`, nom de l'événement outbox, plan B si besoin. Il en sort une fiche de faits qui fixe les choix de §4.2 et §4.4.
1. **Retrait des équipes** et `ledge ask` : daemon, protocole, CLI, Desktop, TUI, mobile, et les tests mis à jour.
2. **Pont OpenRig en lecture** : présence, inscription automatique, démarrage, miroir, SSE, appariement des sièges et escalades, sans action, sur la machine locale.
3. **Barre latérale et Atelier** : Ledge 1a, Projets et Rigs, noyau, une pièce une table.
4. **Fil de Ledge et réponses** : thread, décisions dans le message, réponse par le pont, encoche (fermée et ouverte, filtre).
5. **Cycle de vie et lancement** : actions, refus `rig_managed`, fenêtre en trois temps, hors projet, dépôts trouvés, Ranger.
5 bis. **Rigs distants** : pont par machine, agrégation par le daemon du cerveau, lancement et actions sur une machine distante (EC2).
6. **Le cerveau** : session permanente, `ledge brain …`, garde du mandat, mémoire, onglet Mandat, Revenir dessus.
7. **TUI** et 8. **Mobile**, selon leurs maquettes.

Chaque lot doit pouvoir être livré seul : sans le cerveau, l'utilisateur répond lui-même aux escalades depuis le fil ; sans OpenRig, Ledge reste l'outil de sessions seules.

## 12. Laissé au builder

- Les noms exacts des messages du protocole et des modules.
- Le style des groupes d'échanges et des pastilles de rig, dans le design system existant (Lyssaën, maquettes 0.29).
- La fenêtre de temps des groupes d'échanges. Valeur suggérée : un groupe se ferme après 10 min sans échange.
- Les détails de la relance du cerveau selon l'outil (option de reprise propre à chacun).
- Demandes amont à OpenRig, à proposer si le lot 0 les confirme :
  - un connecteur humain `local` ou `webhook` ;
  - une route publique pour `resolveDirectHumanReply` ;
  - un drapeau `--goal` pour `rig up`.

## 13. Mes choix [P], à relire en priorité

1. Inscription automatique avec un leurre Slack, sinon le repli `human-ledge@host` (§4.2).
2. Réponse = ligne de réponse au siège + `approve` (§4.4).
3. Les cas où Ledge démarre OpenRig, et ce qu'il en dit (§4.1).
3 bis. Rigs distants : un pont par machine dans le daemon Ledge de la machine, et le daemon du cerveau qui agrège (§4.8).
4. Le cerveau n'agit que par `ledge brain …`, et le garde du mandat est dans le daemon (§5.2-5.3).
5. Le cerveau n'est pas un siège OpenRig, et on garde l'advisor du noyau (masqué) (§5.1, §8.1).
6. `ledge ask` remplace `ledge task give ledge` (§7).
7. Espace hors projet sous `~/.ledge/rigs/`, et Ranger ne déplace rien (§4.7).
8. Copie `.worktrees/rig-<nom>` par défaut au lancement dans un projet (§4.6).
9. Sans cerveau, le chat ponctuel d'aujourd'hui sert le fil ; le cerveau propose les mêmes cartes (§5.1).
10. Cales `rig`/`tmux` dans le `PATH` du cerveau, et risque résiduel accepté (§5.2).
11. 60 s de grâce avant que le cerveau tranche ; la première réponse gagne (§5.3).
12. Le lot 1 supprime aussi les écrans d'équipes du TUI et du mobile (§7).
