# Ledge — spécification de design

Date : 2026-10-09 · Projet personnel, hors story Jira · Auteur : Joffrey Desantoine avec Claude Code

**Révision 2 — direction visuelle et maquette interactive validées par l’utilisateur.** Signal est retenu en thème sombre, Galet en thème clair. Cette validation autorise la mise à jour du design et des plans ; elle ne signifie pas que l’overlay ou les intégrations réelles sont implémentés.

**Révision 3 — 2026-10-10, vie de la poignée et notifications.** Trois ajouts validés sur les planches 20 à 22 du canevas (« Alive ») : le saut de travail des bots, la bulle de fin de tâche et les sons. Décisions de l’utilisateur : saut à rythme régulier (toutes les 3,6 à 4,4 s), fin de tâche notifiée par bulle **et** son, palette de sons synthétisés sans fichier audio. Sections 5 (bulle de fin de tâche, réglages Sons), 6 (saut), 7 (mouvement), 7 ter (sons) et 9 (tests).

Références visuelles, par ordre de priorité :

- [Maquette interactive validée](../../mockups/ledge-prototype.html), avec ses fichiers dans `../../mockups/prototype/`.
- [Version HTML autonome](../../mockups/ledge-prototype-standalone.html), ouvrable sans serveur, et aperçus [sombre](../../mockups/ledge-prototype-dark.png) / [clair](../../mockups/ledge-prototype-light.png).
- Sources des mascottes : [géométrie SVG](../../mockups/prototype/mascot-svg.js), [expressions et gestes](../../mockups/prototype/mascot.css), [rythmes individuels](../../mockups/prototype/mascots.js), [matières liées au thème](../../mockups/prototype/prototype.css).
- [Étude initiale](../../mockups/mascots.html) : exploration historique. La variante Souple et le choix d’une matière indépendant du thème ne sont pas retenus.

Références historiques (les planches distantes n’ont pas pu être consultées pendant cette révision ; la spécification locale et la maquette validée font foi pour les décisions ci-dessous) :
- Canvas de design (21 planches, dont le prototype jouable, planche 9) : https://claude.ai/artifact/57oDjsKdabQBmPgAXn15mc
- Design system « Shadcn Red » (tokens oklch, README avec le vocabulaire de mouvement) : https://claude.ai/artifact/QBv4bfYYVqV2aAfDjPW3JV

## 1. Objectif

Ledge est une « poignée » ancrée au milieu du bord gauche de l'écran Windows qui suit toutes les sessions agentiques en cours (Claude Code, Codex, Cursor Agent) tournant dans WSL2, signale celles qui attendent l'utilisateur, et permet d'y répondre ou d'accepter une action sans retrouver le bon onglet de terminal.

Le besoin de fond : ne plus rater une session qui attend une réponse ou une permission quand on en fait tourner plusieurs en parallèle.

### Succès

- Une demande d'un agent est visible dans la seconde, où que soit le focus.
- Approuver, refuser ou répondre se fait en un clic ou une touche, et le terminal reçoit exactement ce que l'utilisateur aurait tapé.
- Ledge ne ment jamais sur l'état d'une session ; en cas de doute, il affiche le doute.
- Tout changement visuel est animé ; rien n'apparaît ni ne disparaît d'un coup.

### Hors périmètre V1

Historique des demandes, mise en sommeil d'un bot inactif, masquage automatique en plein écran, actions rapides sur une ligne (VS Code, copie d'identifiant, renommage, sourdine), alertes de contexte et de quota, affichage d'un terminal complet dans l'overlay, usage distant ou multi-utilisateur, autre OS que Windows + WSL2.

## 2. Contraintes et décisions de cadrage

| Sujet | Décision |
|---|---|
| Plateforme | Overlay sur Windows (hôte), agents dans WSL2 |
| Terminal de l'utilisateur | Onglets Windows Terminal ouvrant un shell WSL |
| Nom | **Ledge** ; commande `ledge` |
| Lanceur | `ledge claude`, `ledge codex`, `ledge cursor` ; une session lancée sans lanceur apparaît en lecture seule |
| Notification | La bulle, seul mode. Pas de « coup d'œil » seul ni d'ouverture automatique du panneau |
| Ouverture | Survol du bord (180 ms d'approche), clic sur un bot, raccourci global `Ctrl+Alt+L` |
| Thème | Sombre par défaut avec mascottes **Signal** ; clair complet avec mascottes **Galet** |
| UI | shadcn/ui, design system Shadcn Red |

## 3. Architecture

Approche A validée : overlay Tauri sur Windows + daemon Node dans WSL, un seul transport WebSocket.

### Composants

- **`ledge` (WSL, TypeScript, un seul paquet)** avec trois modes :
  - `ledge <agent> [args…]` : le lanceur.
  - `ledge daemon` : le service, lancé automatiquement par le premier lanceur.
  - `ledge hook <event>` : le récepteur appelé par les hooks des trois outils.
  - `ledge setup` : écrit les configurations de hooks en fusionnant avec l'existant, jamais en écrasant.
- **Ledge Overlay (Windows, Tauri v2 + React + shadcn/ui)** : fenêtre sans bordure, transparente, toujours au premier plan, ancrée au bord gauche. Aucune logique métier : elle affiche l'état poussé par le daemon et renvoie des commandes.

### Le daemon est la seule source de vérité

- Liste des sessions et leur état en mémoire.
- WebSocket sur `127.0.0.1:47831` (WSL2 expose localhost à Windows).
- Journal JSON dans `~/.ledge/sessions.json` pour retrouver les sessions tmux encore vivantes après un redémarrage ; `~/.ledge/daemon.log` pour les événements malformés et les erreurs.
- Serveur tmux dédié : `tmux -L ledge -f ~/.ledge/tmux.conf` (barre de statut masquée, souris activée). Il n'interfère pas avec un tmux personnel.

### Protocole WebSocket, messages JSON typés et validés par schéma

Daemon → overlay : `snapshot` (toutes les sessions, à la connexion), `session.updated`, `session.removed`, `session.preview` (dernières lignes du pane).

Overlay → daemon : `session.reply { id, text }`, `session.decide { id, decision: accept | deny }`, `session.focus { id }`, `session.kill { id }`, `session.interrupt { id }`.

Lanceur et hooks → daemon, même socket : `session.register`, `session.event`, `session.unregister`.

Pourquoi un seul socket : les hooks envoient un message et se terminent en quelques millisecondes, et l'overlay a besoin de push.

### Modèle de session

```
id, name (prénom du bot), tool (claude | codex | cursor), cwd, project, title, tmuxSession,
state: starting | working | waiting_input | waiting_permission | idle | exited | error,
pending?: { kind: question | permission | plan | diff, text, tool?, options?, source: hook | pane },
helpers?: [{ id, kind, task, state }],
startedAt, lastActivityAt, exitCode?, source: launcher | hook_only
```

## 4. Cycle de vie d'une session

### Lanceur `ledge claude [args…]`

1. Génère un identifiant court et un prénom pris dans une liste de 64 (Otto, Pim, Nova, Bix, Lu…), jamais réutilisé tant que le bot vit.
2. Crée la session tmux `ledge-<id>` sur le serveur dédié, avec `LEDGE_SESSION=<id>` dans l'environnement, hérité par les hooks de l'outil.
3. Tente la connexion au daemon ; s'il est absent, le lance détaché et réessaie trois fois sur 1,5 s. En cas d'échec persistant, lance quand même l'agent et affiche « ledge: daemon not running, session not tracked ».
4. Envoie `session.register`, renomme l'onglet du terminal « <Prénom> · <projet> », puis s'attache au pane.
5. À la sortie de l'agent, envoie `session.unregister` et retourne le code de sortie.

### Adaptateur par outil

Interface commune : événements de hooks reconnus, motifs à chercher dans le pane, séquences de touches pour `accept`, `deny`, `reply`, `interrupt`, et une vérification après injection.

- **Claude Code** : hooks `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Notification` (permission, inactivité), `Stop`, `SessionEnd` câblés sur `ledge hook` dans `~/.claude/settings.json`. Accepter envoie le numéro de l'option puis Entrée, refuser envoie Échap. `PreToolUse` sur `AskUserQuestion` donne un `pending` de type `question` avec ses options ; `ExitPlanMode` donne un `pending` de type `plan` ; `Edit`/`Write` en attente de permission donne un `pending` de type `diff`.
- **Codex** : `notify` dans `~/.codex/config.toml` signale la fin d'un tour ; les demandes d'approbation sont détectées par motifs dans le pane. Accepter envoie `y`, refuser `n`. Une réponse texte est envoyée puis Entrée 50 ms après.
- **Cursor Agent** : hooks `beforeShellExecution`, `afterFileEdit`, `stop` dans `~/.cursor/hooks.json`. Motifs ancrés en début de ligne.

### Machine à états

- Les hooks ont priorité pour les transitions ; le pane est relu toutes les secondes en complément et pour l'aperçu.
- Un `pending` issu d'un hook n'est jamais remplacé par un `pending` issu d'une correspondance de motif ; les deux sources peuvent arriver à 250 ms d'écart.
- `exited` est terminal : `SessionEnd` et `PaneGone` effacent `pending`. Le rejeu au démarrage ignore les sessions dont la session tmux n'existe plus.
- `lastActivityAt` n'avance que si le contenu du pane a changé (comparaison de hash), sinon le détecteur d'inactivité ne sert à rien.
- Après chaque injection, l'adaptateur relit les cinq dernières lignes jusqu'à trois fois sur 600 ms ; si l'invite est encore là, la décision échoue et la session passe en `error` sans renvoi automatique.

### Session sans lanceur

Le hook `SessionStart` l'enregistre avec `source: hook_only`. Elle apparaît en lecture seule, avec un rappel « started without ledge », sans aperçu ni réponse.

## 5. Interface

### La surface vivante

Il n'y a qu'une seule surface, ancrée au bord gauche de l'écran principal, ou de l'écran choisi dans les réglages (« Écran » : l'écran principal ou un autre écran branché ; un écran choisi puis débranché rend la surface à l'écran principal sans perdre le réglage), verticalement centrée dans sa zone de travail. Au repos c'est la **poignée** ; c'est elle qui grandit en **bulle**, en **liste** ou en **session**, puis rétrécit. Rien n'apparaît jamais à côté d'elle. Sa hauteur suit toujours son contenu : nombre de bots pour la poignée et la liste, contenu de la vue pour la session.

La colonne des scénarios, le faux bureau, les boutons de simulation et le compteur d’actions appartiennent à l’atelier de test, pas à l’overlay livré. Réglages et aide clavier se présentent dans la même surface. Les couches masquées sont inertes et retirées de la navigation au clavier. Le focus est transféré vers un contrôle visible après une transition.

### La poignée (planche 1, prototype planche 9)

- 28 px de large, coins droits arrondis à 14 px, fond `sidebar`, bordure `sidebar-border`, ombre `shadow-overlay`.
- Tous les bots y sont, dans l'ordre de la liste, un bot ne saute jamais de place.
- Bot au repos : 12 px, opacité 0,8 (0,55 pour terminé et lecture seule). Bot qui attend : 20 px, opacité pleine, et un trait de 2 px au bord de l'écran dans la couleur de son état, le même marqueur que la ligne sélectionnée.
- De 6 à 10 bots : 11 et 18 px, écart 3 px. Au-delà de 10, les bots au repos se replient en un point « +N ».
- Survol d'un bot : il grossit de 25 % avec un léger dépassement, fond rond plus clair, infobulle « <Prénom> · <demande> · click to open » à droite. Clic : la surface grandit en session sur ce bot.
- Survol du bord au-dessus ou en dessous de la poignée (zone chaude de 14 px) : après 180 ms, la surface grandit en liste. Elle rétrécit 500 ms après que la souris est partie, jamais quand une session est ouverte.
- Sans aucun bot : un filet de 6 px, 60 px de haut.

### La bulle (planche 2)

- Déclenchée par un `pending` nouveau, uniquement quand la surface est en poignée et hors « ne pas déranger ».
- Séquence : le bot grossit dans la poignée (280 ms), puis 260 ms plus tard la surface se déploie en bulle depuis la place de ce bot, 336 px de large.
- Contenu : le bot à 48 px, « <Prénom> needs your approval » ou « has a question », la demande en mono, un chevron, puis Deny et Approve (ou Later et la réponse recommandée pour une question).
- Une barre de 2 px en bas s'écoule sur 4 s ; le survol, le focus dans la bulle et une fenêtre masquée suspendent le décompte. La reprise utilise le temps restant exact, sans repartir de zéro. À zéro, la bulle rétrécit en poignée ; la demande reste en attente.
- Décider sur place : le bot acquiesce une fois et la bulle reste au moins 900 ms avant son repli. En production, le repli attend aussi la confirmation du daemon ; le délai seul ne confirme jamais l’exécution. Une erreur maintient une action de récupération lisible. Cliquer le texte transforme la bulle en session. Un diff ou un plan ouvre sa revue avant toute décision.
- Largeur de 336 px ; hauteur mesurée selon le texte, les actions et la file. Aucune hauteur fixe de 128 px ne doit tronquer la version validée.
- Plusieurs demandes : la bulle ne montre que la plus ancienne, avec « +N more » dessous.

#### La bulle de fin de tâche (planche 21)

- Déclenchée par le passage d'une session de `working` à `idle` ; un tour commence par un prompt (`UserPromptSubmit`), jamais par `SessionStart`, donc un lancement, un `/clear` ou une reprise ne « terminent » rien. Le passage vient du hook `Stop` de Claude Code, `notify` de Codex, `stop` de Cursor Agent, ou `PaneIdle` quand aucun hook ne l'a précédé. Uniquement quand la surface est en poignée, hors « ne pas déranger », et si le réglage « Quand un bot a terminé » le demande (défaut : bulle et son).
- Même chorégraphie qu'une demande : le bot grossit dans la poignée (280 ms), la bulle se déploie 260 ms plus tard depuis sa place. Le bot y est en expression `idle` (yeux souriants, halo vert).
- Contenu : « <Prénom> a terminé », sous-ligne mono avec le résumé que le daemon connaît (durée du tour, projet ; fichiers modifiés et tests quand l'adaptateur les fournit, sinon seulement la durée et le projet), badge « Disponible », puis OK (replie) et Ouvrir (vers la session, qui montre l'aperçu du terminal).
- Barre de 2 px sur 6 s (une fin de tâche ne demande rien : elle peut rester un peu plus que les 4 s d'une demande), suspendue au survol, au focus et fenêtre masquée, avec le temps restant exact.
- Une demande qui arrive pendant la bulle de fin la remplace : une demande passe toujours avant une information. Plusieurs fins de tâche se suivent comme une file, la plus ancienne d'abord, sans « +N » (un simple remplacement suffit).
- Une fin de session (`exited`) n'ouvre jamais de bulle : le bot ferme les yeux et passe à 0,55 dans la poignée ; un son bref de départ si la catégorie « Équipe » est active. Un code de sortie non nul est une erreur : poignée et liste, jamais de bulle (section 8).
- `PaneIdle` répété ou un `Stop` qui suit un `Stop` sans passage par `working` ne redéclenche rien : la bulle ne s'ouvre que sur une transition réelle vers `idle`.

### La liste (planche 3, clair planche 5)

- 380 px. En-tête « Ledge », compteur « N bots · M waiting for you », boutons ne pas déranger, réglages, replier.
- Une ligne de 58 px par bot : bot à 32 px, projet, sous-ligne « Prénom · Outil · durée · contexte », badge d'état. La ligne sélectionnée porte le fond `secondary` et la barre rouge de 2 px ; à l’ouverture, sélectionner la demande la plus ancienne. L’ordre des sessions ne change pas avec leur état.
- Les lignes entrent en cascade, 24 ms d'écart, avec un glissement de 10 px.
- Pied : interrupteur « Do not disturb » et le raccourci.
- Un bot qui arrive se déplie en hauteur et en opacité ; un bot qui part se replie de la même façon. La hauteur de la surface suit.

### La session (planche 4)

- 420 px, hauteur selon le contenu jusqu'à la hauteur de l'écran, puis défilement interne.
- En-tête : retour, bot à 32 px, « Prénom · projet », outil et durée, icône qui met le focus sur l'onglet terminal, fermeture.
- Carte de demande selon le type de `pending` :
  - **permission** : « <Prénom> wants to run », la commande en mono, « Always for this session », Deny, Approve.
  - **diff** (planche 12) : fichiers repliables avec chevron, compteurs +/−, lignes ajoutées et retirées colorées, « Always for these files », Deny, Approve.
  - **question** (planche 13) : contexte, options en cartes radio avec descriptions, l'option recommandée pré-cochée, un champ « Other », envoyé comme numéro ou texte ; les touches 1 à 9 choisissent.
  - **plan** (planche 14) : étapes numérotées avec fichiers et sous-points, « Out of scope », « Change it », « Approve plan ».
- Sans demande : **rapport reçu** (planche 11) quand l'agent a fini un tour : badge « Your turn », le dernier message rendu avec titres, paragraphes, listes et blocs de code qui reviennent à la ligne, puces de réponse rapide, lien vers le terminal ; **commande longue** (planche 16) : la commande, un chrono, une barre d'activité sans pourcentage, la sortie en direct avec « Follow », « Interrupt » qui envoie Échap ; **terminée** (planche 15) : durée, fichiers, tests, dernier message, liste des fichiers, barre des minutes avant la retraite du bot (10 min), « Open terminal », « Continue with <Prénom> ».
- Aperçu terminal en lecture seule, 30 dernières lignes, et champ de réponse envoyé tel quel.
- **Mode lecture** (planches 11b et 12b) : une icône élargit la surface à 560 px, texte 14/21 sur environ 70 caractères par ligne, pour les rapports et diffs longs.
- La transition liste ↔ session est un glissement de 12 px avec fondu, 260 ms. L’entrée du contenu suit le début de croissance de la surface de 140 ms. Après une décision : acquiescement de 650 ms, disparition de la carte sur 300 ms avec 180 ms de retard, puis passage à la suite après au moins 900 ms et confirmation du daemon. Une réponse tardive ne doit pas voler le focus ni rouvrir une session quittée entre-temps.
- Les brouillons sont indexés par identifiant de session et survivent au retour à la liste, au changement de thème, au mode lecture et à une reconnexion. Un refus ou une interruption n’affiche jamais un rapport de réussite ; « Modifier le plan » conserve la session ouverte avec le champ de réponse accessible.

### Sous-agents (planche 17)

Les helpers lancés par un bot apparaissent sous lui en bots de 20 px avec leur tâche et leur état, dans une arborescence dont la dernière branche se termine en └. Un helper qui attend une permission porte sa propre carte. Dans la liste, la ligne empile les mini-bots sous l'avatar.

### File d'attente (planche 19)

Quand plusieurs bots attendent : bandeau « Waiting for you · 1 of N » avec les bots en attente, « Next » ou `Alt+→`, case « Go to the next one after deciding » cochée par défaut. Ordre du plus ancien au plus récent. Après le dernier, retour à la liste avec « all caught up », puis repli après 2 s uniquement si la souris et le focus ont quitté la surface et qu’aucun brouillon n’est en cours d’édition. Une demande disparue n’est jamais sélectionnée par une transition différée.

### Clavier (planche 18)

- `Ctrl+Alt+L` ouvre la liste. Ouverte au clavier, elle montre des badges numérotés sur les lignes ; ouverte à la souris, non.
- La ligne sélectionnée s'agrandit pour montrer ses actions avec leurs touches : Approve Y, Deny N, Open Entrée. Y et N n'agissent que si la demande est un oui/non ; une question ouvre la session.
- J et K se déplacent, `Alt+→` passe au prochain bot en attente, 1 à 9 sautent sur un bot, R met le focus sur le champ de réponse, O ouvre l'onglet terminal, D bascule ne pas déranger, Échap revient à la liste depuis une session puis replie la liste, ? ouvre la feuille des touches.
- Tab et Maj+Tab conservent leur navigation native entre les contrôles. Les raccourcis à une lettre ne s’appliquent pas à un champ éditable ou à une liste de sélection.
- Un coachmark ancré sous la ligne sélectionnée enseigne J, K, `Alt+→` et 1 à 9 les trois premières ouvertures au clavier.

### Réglages : notifications et sons (planche 22)

Dans la même surface, sous Langue, Écran, Tailles, Thème, Ne pas déranger et Mouvements réduits :

- **Quand un bot a terminé** : segmenté « Bulle et son » (défaut), « Bulle », « Son », « Poignée seule ».
- **Sons** : interrupteur général (défaut activé). Désactivé, les sections suivantes passent à 50 % d'opacité et ne jouent rien. « Ne pas déranger » coupe tous les sons, quel que soit ce réglage.
- **Volume** : Quiet / Normal / Loud (facteurs 0,5 / 1 / 1,8 sur le pic de −18 dBFS) et un bouton Test qui joue le signal de question.
- **Jouer un son quand** : cases Demandes (accord, question ; défaut activée), Fin de tâche (activée), Échec (activée), Décisions (vos accepter/refuser ; activée), Équipe (arrivée, départ ; désactivée).
- **Seulement quand le terminal est derrière** (défaut activé) : si la fenêtre au premier plan de Windows est le Windows Terminal, aucun son ; la bulle s'affiche quand même. Le shell Tauri expose `foregroundIsTerminal()` ; sans cette information (navigateur, tests), le son joue.
- Toutes ces préférences sont locales à l'overlay (`localStorage`, clés `ledge.sounds.*` et `ledge.finished`), comme Thème, Ne pas déranger et Mouvements réduits.

## 6. Les bots

Chaque session est un compagnon SVG, sans image raster, logo produit ou dépendance à un service d’images. Les trois silhouettes de la maquette validée remplacent les anciens dessins des planches 6, 8 et 10 : carré arrondi pour Claude Code, orbe pour Codex, pointe arrondie pour Cursor Agent. Une visière sombre unifie la famille ; pieds, antenne et main sont des détails secondaires.

### Matière et thème

| Thème | Matière | Haut / bas de coque | Contour | Visière |
|---|---|---|---|---|
| Sombre | Signal | `#34434b` / `#273238` | `#859397`, épaisseur SVG 1,5 | `#172124` |
| Clair | Galet | `#f0eee6` / `#b7b7b0` | `#ffffff99`, épaisseur SVG 0,8 | `#22292b` |

Signal a des contours lisibles et aucun trait de reflet blanc. Galet reçoit un reflet léger et un dégradé mat. Ces couleurs deviennent des tokens `--bot-shell-top`, `--bot-shell-bottom`, `--bot-shell-line`, `--bot-visor` dans le design system. La matière se déduit du thème ; aucun sélecteur de matière indépendant n’est prévu dans le produit. Un changement de thème interpole les couleurs sur 240 ms sans remplacer le SVG, rejouer l’arrivée du bot ni modifier son état ou la phase de son animation.

### Expressions

| État réel | Expression et comportement | Couleur des yeux |
|---|---|---|
| `starting` | Regard qui se pose ; libellé Démarrage | `#90c7f2` |
| `working` | Yeux ouverts, déplacements du regard de ±1,4 unité SVG, respiration discrète | `#90c7f2` |
| `waiting_permission` | Regard centré, légère inclinaison, main levée une fois puis attente calme | `#f2b09c` |
| `waiting_input` | Yeux légèrement agrandis, inclinaison interrogative | `#f6d487` |
| `idle` | Yeux souriants ; session disponible, distincte du travail et d’une session terminée | `#a9dfc7` |
| `error` | Expression préoccupée et inclinaison ; aucun tremblement, flash ou fumée | `#ffab9f` |
| `exited` | Yeux fermés, opacité 0,55, aucun mouvement ; code de sortie non nul signalé par le badge et le texte | `#a3aaa9` |

Lecture seule et connexion perdue sont des modificateurs, pas des états de travail inventés : garder l’expression connue, réduire l’opacité, figer les mouvements et afficher la cause textuellement. La lecture seule utilise un contour pointillé. Une couleur seule ne suffit jamais à distinguer les états : expression, libellé et badge restent présents.

### Halo

Chaque session vivante porte un halo lumineux dans la couleur de son état, la même que le badge et le trait de la poignée : `--danger-text` pour l'accord attendu et l'erreur, `--warning` pour la question, `--info` pour le démarrage et le travail, `--success` pour une session disponible. Le rendu validé est le « contour » de [la maquette](../../mockups/mascots-halo.html) : deux `drop-shadow` qui épousent la silhouette, l'ombre au sol masquée pour ne pas luire. Intensité pleine (`--bot-halo-alpha` 0,55) pour un bot qui attend ou en erreur, douce (`--bot-halo-alpha-soft` 0,3) pour un bot qui travaille ou est disponible ; rayon de 0,32 fois la taille du bot (`--bot-halo-spread`), donc le halo suit l'avatar et le zoom de la poignée. Une session terminée, en lecture seule ou l'état `readonly` n'en portent jamais : leur opacité réduite reste leur seul signal.

Le halo d'un bot qui attend respire : 5 s, `ease-in-out`, intensité seule (de 100 % à 70 %), décalée par bot comme sa respiration. Ce n'est pas une pulsation de badge ; les badges restent immobiles. Les mouvements réduits, la couche inactive, la vue en pause et la connexion perdue figent ou suppriment cette respiration comme les autres boucles.

### Identité, échelle et rythme

#### Le saut de travail (planche 20)

Un bot en état `working` fait un petit saut toutes les 3,6 à 4,4 s (période `3600 + (hash % 9) × 100` ms, déphasée par bot comme sa respiration), pour montrer qu'un travail est en cours même quand le pane est silencieux. Décision du 2026-10-10 : le rythme est régulier, pas lié à la sortie du pane.

- Le saut dure 480 ms, sur le groupe `.hop` qui enveloppe `.body` (origine 48 × 83) : anticipation écrasée à 14 % (`scale(1.06,.92)`), apogée à 44 % (`translateY(−H)` et `scale(.96,1.06)`), atterrissage à 70 % (`scale(1.05,.95)`), retour à 100 %. L'ombre au sol se contracte à l'apogée (`scale(.72)`, opacité 0,07). Les segments utilisent `ease-in`, `cubic-bezier(.2,.7,.3,1)`, `cubic-bezier(.6,0,.9,.4)` puis `ease-out`.
- Hauteur H en px écran : `clamp(2, taille × 0,12, 7)`, donc 2 px dans la poignée à 12 px, 3,8 px sur une ligne à 32 px, 5,8 px dans la bulle à 48 px ; convertie en unités SVG par `H / taille × 96`.
- Le saut est le seul mouvement ambiant conservé à 20 px et moins : c'est le signal de la poignée. Clignement et regard restent coupés sous 20 px.
- Il ne s'applique qu'à `working` ; `starting`, `approval`, `question`, `idle`, `error`, `done`, `readonly` ne sautent jamais. Lecture seule, connexion perdue, couche inerte, fenêtre masquée et vue en pause le gèlent comme les autres boucles.
- Mouvements réduits (système ou réglage) : pas de saut ; la lumière d'antenne pulse de 1 à 0,35 sur 1,2 s, le même rythme que le point « running » des badges.
- Jamais sur la surface, le badge ou la ligne : seul le bot saute (règle « pas de rebond sur les surfaces » de la section 7).


- Identité stable : clé React, graine de mouvement et décalage dérivent de `session.id` ; pour un helper, de `parent.id + ':' + helper.id`. Un renommage ou un changement de thème ne synchronise pas les bots.
- Trois variantes sobres d’inclinaison et de phase par état ; pas trois animations d’accessoires complexes. Respiration entre 4,8 et 6,4 s, amplitude verticale maximale de 0,7 unité dans le repère SVG 96×96, rotation de ±0,3° et étirement vertical maximal de 1,4 %.
- Clignement de 180 ms, intervalle déterministe de 3,4 à 6,7 s propre à chaque bot. Le regard de travail change toutes les 2,4 à 4,5 s, avec une transition de 450 ms. La main intervient une seule fois lors d’une nouvelle demande, après le regard ; geste de 850 ms.
- Tailles : 12/20 px dans la poignée (11/18 px au-delà de cinq sessions), 16 px dans les onglets, 20 px pour les helpers, 32 px dans les lignes et en-têtes, 48 px dans la bulle. À 20 px ou moins, recadrer le SVG sur la tête, supprimer main, pieds, ombre et antenne, et arrêter les mouvements ambiants. Les grandes tailles de l’atelier ne sont que des agrandissements d’inspection.
- Un composant `Bot` reçoit `tool`, `state`, `pose`, `size`, `theme`, `seed`, `readOnly`, `frozen` et `reducedMotion`. Les groupes coque, posture, regard, yeux et accessoires restent montés pendant une transition d’état. Les identifiants des gradients sont uniques par instance.

## 7. Vocabulaire de mouvement

Trois courbes pour les transitions de l’interface (section Motion du design system) :

- **grow** : 320 ms `cubic-bezier(.22,1,.36,1)`, part vite et décélère longuement.
- **shrink** : 260 ms `cubic-bezier(.65,0,.35,1)`, avec 60 ms de retard pour que le contenu s'efface d'abord.
- **pop** : 260 ms `cubic-bezier(.34,1.3,.64,1)`, réservé à l'échelle d'un bot, jamais à une surface.
- **hop** : 480 ms, séquence de segments (section 6, « Le saut de travail »), réservé au groupe `.hop` d'un bot en état `working`, jamais à une surface.

Règles : survol et couleurs en 150 ms ; entrées en fondu de 180 ms après que la forme s'est presque posée (140 à 200 ms de retard), sorties en 100 ms avant que la forme bouge ; séquence plutôt que simultanéité ; toute apparition, disparition, redimension ou changement d'état est animé ; pas de rebond sur les surfaces, badges ou panneaux ; une variable d'environnement ramène toutes les durées à zéro pour les tests.

Les microgestes organiques utilisent `ease-in-out` pour la respiration et le clignement ; la matière change en 240 ms. Les yeux se fondent en 260 ms et la posture revient en place en 300 ms avec `grow`. Un acquiescement dure 650 ms et confirme la réception d’une décision, jamais la réussite de la tâche. Le délai de 900 ms de la séquence de décision reste une durée de présentation, pas une source de vérité métier.

`prefers-reduced-motion: reduce`, le réglage « Mouvements réduits » ou `VITE_LEDGE_MOTION=0` suppriment mouvements ambiants, interpolations et gestes. Les demandes, leurs libellés et les règles de temporisation restent fonctionnels ; un réglage local ne force pas le mouvement contre la préférence du système. Suspendre les boucles quand la fenêtre est masquée, la couche inactive ou la connexion perdue ; libérer les timers et observateurs au démontage. Les décomptes fonctionnels (bulle, reconnexion, retraite) ne sont pas mis à zéro par la suppression des animations.

## 7 bis. Portée de la validation et raccordement

Les sons (7 ter) ne sont pas du mouvement : un réglage de mouvements réduits ne les coupe pas, et un son ne remplace jamais une animation supprimée.

## 7 ter. Sons

Une seule famille de signaux, synthétisée dans l'overlay par Web Audio (oscillateurs sinus et triangle, attaque 8 ms, relâchement exponentiel, pic à −18 dBFS multiplié par le volume), aucun fichier audio, rien de plus long que 350 ms. Les signaux qui demandent montent ou frappent, les résultats descendent, les actions de l'utilisateur sont des tics.

| Signal | Quand | Forme |
|---|---|---|
| Accord attendu | `pending` de type permission, diff ou plan | deux coups bas, triangle A3 (220 Hz), 70 ms puis 80 ms à 110 ms d'écart |
| Question | `pending` de type question | deux notes montantes, sinus E5 (659 Hz) 90 ms puis A5 (880 Hz) 160 ms |
| Tâche terminée | transition vers `idle` | deux notes descendantes, sinus A5 (880 Hz) 140 ms puis D5 (587 Hz) 190 ms |
| Échec | passage en `error`, code de sortie non nul, daemon perdu | une note basse qui glisse, triangle 180 → 120 Hz, 220 ms |
| Accepter | une décision `accept` ou une réponse envoyée | un tic, sinus E6 (1319 Hz), 35 ms |
| Refuser | une décision `deny` | un tic plus bas, sinus E5 (659 Hz), 45 ms |
| Arrivée | une session apparaît | un pop montant, sinus 330 → 660 Hz, 70 ms |
| Départ | une session passe à `exited` avec code 0 | une note descendante, triangle 330 → 240 Hz, 180 ms |

Règles :

- Un seul signal par 1,5 s : une rafale de demandes joue une fois, la poignée montre le reste. Le dernier signal joué fait foi, pas le dernier événement.
- Un signal joue après la décision du machine d'état, jamais sur un simple rendu : le même événement qui fait grossir le bot ou déplier la bulle déclenche le son, ainsi un son ne peut pas jouer sans son signal visuel (sauf réglage « Son » seul pour la fin de tâche).
- Silencieux : survol, ouverture, fermeture, défilement, clavier, progression des sous-agents, battement d'une commande longue, reconnexion réussie, clignement et saut.
- « Ne pas déranger » coupe tout ; l'interrupteur Sons coupe tout ; la catégorie coupe son signal ; « seulement quand le terminal est derrière » coupe quand Windows Terminal est au premier plan. Les décomptes et les bulles ne dépendent jamais d'un son.
- Le `AudioContext` est créé au premier signal et réutilisé ; le shell Tauri passe `--autoplay-policy=no-user-gesture-required` au WebView2 (l'overlay n'a jamais de geste utilisateur avant un son). Si la création échoue, le son est ignoré sans erreur visible et le reste fonctionne.
- Tests : le synthétiseur est derrière une interface `SoundPlayer` (`play(cue)`) injectable ; les tests vérifient les décisions (quel signal, à quel moment, coupé par quoi) sur un faux lecteur, jamais le rendu audio.

La maquette valide les matières, les silhouettes, les expressions, la composition des vues et les interactions visibles. Elle contient douze scénarios : vue d’ensemble, autorisation, question, revue de fichiers, plan, sous-agents, commande longue, rapport, erreur, session terminée, lecture seule, équipe et connexion. Les préférences de l’atelier restent locales et la copie française illustre les libellés ; elle ne change pas les conventions de copie des adaptateurs et de la CLI.

Les comportements suivants nécessitent encore leur raccordement produit ; ne pas copier les raccourcis de simulation dans le daemon :

- Les délais de fin de tâche et les compteurs de tests/fichiers sont fictifs. Seuls les événements confirmés du daemon déterminent les états et les résultats réels.
- Les options « Toujours » mémorisent une portée uniquement dans la simulation. En production, les proposer seulement si l’adaptateur sait appliquer et confirmer cette portée ; autrement les désactiver avec explication. Elles ne doivent jamais être un simple alias trompeur d’« Autoriser une fois ».
- « Continuer » crée un nouvel identifiant dans la simulation. En production, `exited` reste terminal ; tant qu’un lancement/reprise confirmé n’est pas pris en charge, proposer l’ouverture du terminal pour relancer, sans prétendre avoir créé une session.
- Les helpers ont des cartes et des expressions propres. Le protocole actuel route une permission de helper via le parent et `pending.helperId` : l’UI ne doit pas autoriser un autre helper, effacer une demande du parent ou prétendre à des décisions indépendantes non prises en charge. Les permissions concurrentes de plusieurs helpers requièrent un contrat de demandes distinctes avant activation.
- L’ouverture du terminal, l’interruption réelle, les raccourcis globaux Windows, les reconnexions et la retraite à 10 min restent à vérifier avec Tauri, WSL et les adaptateurs. La vérification du prototype dans Chromium ne vaut pas validation de ces intégrations.

## 8. Gestion des erreurs

- **Daemon injoignable depuis l'overlay** : reconnexion toutes les 2 s, plafond 30 s. La poignée passe en gris avec un point rouge, infobulle « daemon unreachable, retrying ». Les bots connus restent figés en lecture seule. Au retour, `snapshot` remplace l'état local ; les bots disparus se replient avec l'animation de départ.
- **Daemon absent au lancement** : voir le lanceur, étape 3. L'utilisateur ne perd jamais sa session à cause de Ledge.
- **Injection non confirmée** : état `error`, pose croix, carte ouverte avec « the terminal did not take it, try again or open the tab », aucun renvoi automatique.
- **Session tmux morte** : vérification toutes les 5 s, événement `PaneGone`, bot `exited` sans code, demandes effacées, retraite après 10 min.
- **Hooks** : un hook pour une session inconnue crée une session `hook_only` ; `ledge hook` répond en moins de 200 ms et sort toujours en code 0, même sans daemon ; un événement malformé est journalisé et ignoré.
- **Incertitude affichée** : un état déduit du pane et non d'un hook porte une pastille grise « guessed » au survol. Une erreur n'a jamais de bulle : elle se voit dans la poignée et la liste.

## 9. Tests

- **Unitaires (Vitest, WSL)** : table de transitions du réducteur, chaque couple état × événement ; motifs des adaptateurs sur des captures de pane réelles dans `test/fixtures/panes/` avec cas positifs et pièges ; schémas du protocole avec exemples sérialisés.
- **Intégration sans IA** : un faux agent Node qui imite chaque outil dans un vrai tmux (invite de permission, question, sortie avec code) pour tester lanceur, daemon, injection et vérification de bout en bout, en CI ; test de reconnexion, daemon tué puis relancé pendant qu'un faux agent tourne.
- **Overlay (Windows)** : composants React avec Testing Library sur un daemon simulé en mémoire, durées d'animation à zéro ; captures visuelles par état (poignée à 0, 5, 10 et 12 bots, bulle, liste, session, deux thèmes) ; chacun des douze scénarios de la maquette locale devient un test nommé. Vérifier les matières Signal/Galet à 12, 16, 20, 32 et 48 px, la distinction `idle`/`exited`, la stabilité des SVG au changement de thème et les mouvements réduits.
- **Saut, fin de tâche et sons** : le saut n'est présent que pour `working`, à 12 px comme à 48 px, absent en mouvements réduits (pulsation d'antenne à la place), figé en lecture seule ou connexion perdue ; la bulle de fin de tâche s'ouvre sur `working → idle` seulement, jamais sur `PaneIdle` répété ni en « ne pas déranger », dure 6 s, cède à une demande ; les signaux sonores sont décidés par un module pur testé sur un faux lecteur : un par 1,5 s, coupés par DND, par l'interrupteur, par la catégorie et par le terminal au premier plan ; les réglages persistent et se lisent dans la vue Réglages.
- **Interactions** : timer de bulle conservant le temps restant après survol/focus, aucune fermeture pendant la saisie, conservation des brouillons, aucune action en lecture seule ou hors connexion, refus sans faux succès, changement de scénario/session annulant les callbacks devenus obsolètes, Tab natif et `Alt+→` pour la file.
- **Manuel** : checklist de dix minutes avec les trois vrais outils avant chaque version : lancer, demander une permission, approuver depuis la bulle, répondre à une question, tuer la session, relancer le daemon.

## 10. Stack et dépôt

- WSL : Node 22, TypeScript, paquet `ledge` avec `src/cli`, `src/daemon`, `src/adapters`, `test/`.
- Windows : Tauri v2, React 19, shadcn/ui, Tailwind v4, tokens du design system Shadcn Red (oklch, Geist et Geist Mono).
- Monorepo `harness-assistant` : `packages/ledge` (WSL) et `apps/overlay` (Windows), types du protocole partagés dans `packages/protocol`.

## 11. Points ouverts

- Prénoms : liste de 64 fournie, ou `ledge claude --name otto` pour nommer à la main. Les deux coexistent ; la liste est le défaut.
- Focus de l'onglet Windows Terminal depuis WSL : via `wt.exe` et le titre de l'onglet ; à vérifier sur la version installée.
- Hooks Codex : si Codex expose des hooks bloquants au moment de l'implémentation, les préférer aux motifs de pane.
