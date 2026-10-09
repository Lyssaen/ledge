# Ledge — spécification de design

Date : 2026-10-09 · Projet personnel, hors story Jira · Auteur : Joffrey Desantoine avec Claude Code

Références visuelles :
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
| Thème | Sombre par défaut ; clair complet |
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

Il n'y a qu'une seule surface, ancrée au bord gauche, verticalement centrée. Au repos c'est la **poignée** ; c'est elle qui grandit en **bulle**, en **liste** ou en **session**, puis rétrécit. Rien n'apparaît jamais à côté d'elle. Sa hauteur suit toujours son contenu : nombre de bots pour la poignée et la liste, contenu de la vue pour la session.

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
- Une barre de 2 px en bas s'écoule sur 4 s ; le survol la met en pause, la sortie la reprend. À zéro, la bulle rétrécit en poignée.
- Décider sur place : la bulle reste 900 ms pour laisser voir le bot changer de pose, puis rétrécit. Cliquer le texte transforme la bulle en session.
- Plusieurs demandes : la bulle ne montre que la plus ancienne, avec « +N more » dessous.

### La liste (planche 3, clair planche 5)

- 380 px. En-tête « Ledge », compteur « N bots · M waiting for you », boutons ne pas déranger, réglages, replier.
- Une ligne de 56 px par bot : bot à 32 px, projet, sous-ligne « Prénom · Outil · durée · contexte », badge d'état. La ligne en attente la plus ancienne porte le fond `secondary` et la barre rouge de 2 px.
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
- La transition liste ↔ session est un glissement de 28 px avec fondu, 260 ms. Après Approve, la carte se replie (300 ms, courbe douce, 80 ms de retard), puis le bot reprend sa pose de travail 120 ms plus tard.

### Sous-agents (planche 17)

Les helpers lancés par un bot apparaissent sous lui en bots de 20 px avec leur tâche et leur état, dans une arborescence dont la dernière branche se termine en └. Un helper qui attend une permission porte sa propre carte. Dans la liste, la ligne empile les mini-bots sous l'avatar.

### File d'attente (planche 19)

Quand plusieurs bots attendent : bandeau « Waiting for you · 1 of N » avec les bots en attente, « Next » ou Tab, case « Go to the next one after deciding » cochée par défaut. Ordre du plus ancien au plus récent. Après le dernier, retour à la liste avec « all caught up », puis repli après 2 s.

### Clavier (planche 18)

- `Ctrl+Alt+L` ouvre la liste. Ouverte au clavier, elle montre des badges numérotés sur les lignes ; ouverte à la souris, non.
- La ligne sélectionnée s'agrandit pour montrer ses actions avec leurs touches : Approve Y, Deny N, Open Entrée. Y et N n'agissent que si la demande est un oui/non ; une question ouvre la session.
- J et K se déplacent, Tab passe au prochain bot en attente, 1 à 9 sautent sur un bot, R met le focus sur le champ de réponse, O ouvre l'onglet terminal, D bascule ne pas déranger, Échap ferme, ? ouvre la feuille des touches.
- Un coachmark ancré sous la ligne sélectionnée enseigne J, K, Tab et 1 à 9 les trois premières ouvertures au clavier.

## 6. Les bots

Chaque session est un bot (planches 6, 8, 10).

- **Forme de la tête = outil** : carré arrondi pour Claude Code, rond pour Codex, pointu comme un curseur pour Cursor Agent. Aucun logo produit.
- **Yeux = état**, dans les couleurs des badges : balayage et antenne clignotante quand il travaille, grands yeux pour une question, main sur le rebord / mot à signer / toc toc pour une permission, yeux fermés ou souriants quand c'est fini, yeux en croix ou fumée sur erreur, contour pointillé en lecture seule.
- **Trois poses par état**, attribuées par bot : pose = (hash(prénom) + index de l'état) mod 3, pour qu'une équipe ne bouge jamais à l'unisson. Lecture seule n'a qu'une pose.
- **Transitions d'état** : les yeux et accessoires se fondent en 260 ms, la tête revient en place en 300 ms, la couleur de l'antenne glisse.
- **Tailles** : 12 et 20 px dans la poignée, 16 px dans les onglets du terminal, 20 px pour les helpers, 32 px dans les lignes et en-têtes, 48 px dans la bulle.
- Composant unique `Bot` avec les propriétés `tool`, `state`, `pose`, `size`, `theme`.

## 7. Vocabulaire de mouvement

Trois courbes et rien d'autre (section Motion du design system) :

- **grow** : 320 ms `cubic-bezier(.22,1,.36,1)`, part vite et décélère longuement.
- **shrink** : 260 ms `cubic-bezier(.65,0,.35,1)`, avec 60 ms de retard pour que le contenu s'efface d'abord.
- **pop** : 260 ms `cubic-bezier(.34,1.3,.64,1)`, réservé à l'échelle d'un bot, jamais à une surface.

Règles : survol et couleurs en 150 ms ; entrées en fondu de 180 ms après que la forme s'est presque posée (140 à 200 ms de retard), sorties en 100 ms avant que la forme bouge ; séquence plutôt que simultanéité ; toute apparition, disparition, redimension ou changement d'état est animé ; pas de rebond sur les surfaces, badges ou panneaux ; une variable d'environnement ramène toutes les durées à zéro pour les tests.

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
- **Overlay (Windows)** : composants React avec Testing Library sur un daemon simulé en mémoire, durées d'animation à zéro ; captures visuelles par état (poignée à 0, 5, 10 bots, bulle, liste, session, deux thèmes) ; chaque scénario du prototype de la planche 9 devient un test du même nom.
- **Manuel** : checklist de dix minutes avec les trois vrais outils avant chaque version : lancer, demander une permission, approuver depuis la bulle, répondre à une question, tuer la session, relancer le daemon.

## 10. Stack et dépôt

- WSL : Node 22, TypeScript, paquet `ledge` avec `src/cli`, `src/daemon`, `src/adapters`, `test/`.
- Windows : Tauri v2, React 19, shadcn/ui, Tailwind v4, tokens du design system Shadcn Red (oklch, Geist et Geist Mono).
- Monorepo `harness-assistant` : `packages/ledge` (WSL) et `apps/overlay` (Windows), types du protocole partagés dans `packages/protocol`.

## 11. Points ouverts

- Prénoms : liste de 64 fournie, ou `ledge claude --name otto` pour nommer à la main. Les deux coexistent ; la liste est le défaut.
- Focus de l'onglet Windows Terminal depuis WSL : via `wt.exe` et le titre de l'onglet ; à vérifier sur la version installée.
- Hooks Codex : si Codex expose des hooks bloquants au moment de l'implémentation, les préférer aux motifs de pane.
