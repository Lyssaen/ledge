# Identité des sessions et chat avec Ledge — design

Date : 2026-10-11. Complète la spec principale `2026-10-09-ledge-design.md` (sections 3, 5, 6) et celle du lancement `2026-10-10-launch-from-ledge-design.md`. Maquette : `docs/mockups/ledge-sessions-chat.html` (publiée : https://claude.ai/artifact/WmN6YaaiTv9qt1dLXbK2ea).

## 1. Objectif

Deux choses que le même dépôt partagé par quatre bots a rendues nécessaires :

1. **Reconnaître chaque session** sans lire le prénom : savoir *où* elle travaille (dépôt et branche) et *quoi* (un sujet d'une ligne). Aujourd'hui une ligne de la liste dit `harness-assistant · Otto · Claude Code · 18 min`, et quatre lignes se ressemblent.
2. **Parler à Ledge** : un champ « Demander à Ledge… » au pied de la liste ouvre une conversation où la mascotte résidente répond, en lecture seule, à partir des sessions, de leurs terminaux, de leurs dernières réponses et de git dans leurs dossiers.

### Succès

- Dans une liste de quatre sessions sur le même dépôt, chaque ligne porte son sujet et sa branche ; les sessions se regroupent sous leur dépôt.
- Le sujet d'une session apparaît sans action de l'utilisateur dès que l'agent en a un (titre de conversation de Claude Code) ou dès le premier prompt ; il se corrige d'un clic dans l'en-tête de la session ; l'onglet Windows Terminal le suit.
- « Où en sont les autres ? » obtient en moins de trente secondes une réponse qui cite ses sources, nomme les bots et dit ce qui attend l'utilisateur, sans que Ledge ait tapé quoi que ce soit dans une session.

### Décisions de cadrage (retours du 2026-10-11)

- **Pas de couleur par session.** L'écharpe colorée de la première maquette est abandonnée. L'identité tient au sujet, à la branche et au prénom.
- **Ledge à part dans le notch** : un fin séparateur entre la mascotte résidente et les bots. Ledge n'est pas une session : ni état, ni trait de couleur, ni sujet.
- **Regroupement par dépôt et branche, titre de session** : validés tels que maquettés.
- **Chat** : validé. Raccordé à Claude Code en mode headless (`claude -p`), pas à l'Agent SDK (section 5.2).

### Hors périmètre (V2)

- Relayer un message à un bot depuis le chat (« dis à Otto de… »).
- Résumé du matin, mémoire au-delà de la journée.
- Choix du modèle ou de l'outil derrière le chat (Codex, Cursor) : un seul chemin, Claude Code, modèle par défaut du CLI.
- Réponse libre aux questions à choix multiples (inchangé).

## 2. Modèle de session

`Session` gagne six champs facultatifs :

```
topic?: string            une ligne, 80 caractères au plus, sans retour à la ligne
topicSource?: 'user' | 'pane' | 'prompt'
repo?: string             nom du dossier du worktree principal (le dépôt)
repoPath?: string         son chemin absolu
branch?: string           branche extraite, ou le SHA court en HEAD détachée
worktree?: boolean        cwd est un worktree lié, pas le worktree principal
```

`title` garde son contrat (le titre de l'onglet du terminal) et devient `${name} · ${topic ?? project}` ; il est recalculé à chaque changement de sujet. `cleanTopic` et `sessionTitle` vivent dans `@ledge/protocol` (`topic.ts`) : overlay et daemon partagent la règle.

## 3. Le sujet

### Sources et priorité

| Source | Quand | Priorité |
|---|---|---|
| `user` | `session.rename` depuis l'en-tête de session | gagne toujours ; un sujet vide rend la main aux sources automatiques |
| `pane` | Claude Code écrit le titre de la conversation dans la règle haute de sa zone de saisie : `───── add-readme-file ─` ; l'adaptateur le lit (`paneTitle`) et le poller émet `PaneTitle` quand il change | remplace `prompt` |
| `prompt` | le premier `UserPromptSubmit` d'une session (les hooks Claude Code et Codex portent `prompt` ; Cursor Agent `beforeSubmitPrompt` aussi) | ne remplace rien : seul le premier prompt compte |

Deux nouveaux événements de session, `PaneTitle` et `Renamed`, portent le texte dans `text`. `UserPromptSubmit` peut porter le prompt dans `text` (coupé à 500 caractères par le hook ; le réducteur applique `cleanTopic`). Ces événements ne touchent ni `lastActivityAt` ni `lastHookAt` : un titre n'est pas une activité.

Une session lancée avec une première instruction depuis le formulaire reçoit son sujet par le hook `UserPromptSubmit` de l'agent, comme n'importe quel prompt : rien à faire au lancement.

### Où il se lit

- **Liste** : ligne 1 de la ligne de session. Sans sujet : « Sans sujet encore » en `muted-foreground`, graisse 500.
- **En-tête de session** : ligne 1 devient le sujet (ou `Prénom · projet` sans sujet) ; un clic ouvre un champ en place, Entrée envoie `session.rename`, Échap annule sans fermer la vue. Ligne 2 : `Prénom · ⎇ branche · Outil · durée`.
- **Infobulle de la poignée** : `Prénom · sujet · contexte` (le contexte est l'indice actuel, `rowHint`).
- **Onglet Windows Terminal** : `set-titles on` dans la configuration tmux de Ledge, `set-titles-string "#{@ledge_title}"`, et le daemon pose `@ledge_title` sur la session tmux à chaque changement de `title`. `ledge attach` continue d'écrire le titre à l'ouverture. Une configuration existante sans `set-titles` reçoit les deux lignes à l'initialisation du dossier `~/.ledge`.

## 4. Le dépôt et la branche

`daemon/git.ts` lit, en une commande, `git rev-parse --path-format=absolute --abbrev-ref HEAD --short HEAD --show-toplevel --git-common-dir` dans le `cwd` de la session :

- `branch` = le nom abrégé, ou le SHA court si la tête est détachée ;
- `worktree` = le dossier commun n'est pas `<toplevel>/.git` ;
- `repoPath` = le dossier parent du dossier commun pour un worktree lié, `toplevel` sinon ; `repo` = son nom.

Hors d'un dépôt, sans commit, ou sans `git` : `null`, et les champs restent absents. Le poller rafraîchit ces champs à la première vue d'une session et à chaque passage du contrôle de vie (toutes les 5 s), pour les sessions non terminées, y compris celles sans terminal (`hook_only`). `Store.patch` pose les champs sans passer par le réducteur et n'émet rien quand rien ne change.

### La liste

- Regroupement par `repoPath ?? cwd`, dans l'ordre de première apparition (les sessions restent triées par début). En-tête de groupe, 28 px : le nom du dépôt en 600, son chemin en mono avec `~` pour le dossier personnel, le nombre de bots à droite.
- Ligne de session, 58 px : bot 32 px ; ligne 1 le sujet ; ligne 2 `Prénom · ⎇ branche · durée` puis le badge d'état poussé à droite. Le nom de l'outil quitte la ligne (la forme de la tête le dit) : il reste dans le `title` de la ligne avec le chemin, dans l'étiquette accessible et dans l'en-tête de session.
- Puce de branche : mono 11 px, fond `secondary` ; un worktree lié perd son préfixe `worktree-` et prend une bordure pointillée `input` sur fond transparent ; le nom complet dans son `title`. La puce se tronque avant la durée.
- Les en-têtes comptent dans la hauteur de la liste (`groups × 28`) et dans la position du coachmark.

### La poignée

Sous la mascotte résidente, un séparateur de 12 × 1 px en `sidebar-border`, puis les bots ; il disparaît sans bot. La géométrie des slots en tient compte (`2 × gap + 1`).

## 5. Le chat

### 5.1 Protocole

Côté client : `chat.ask { qid, text }`, `chat.cancel { qid }`. Côté serveur : `chat.step { qid, step }`, `chat.delta { qid, text }`, `chat.done { qid, text, at }`, `chat.error { qid, message }`, et `chat.history { turns }` envoyé après chaque `snapshot`.

```
ChatStep = { kind: 'sessions' | 'pane' | 'reply' | 'git' | 'repo', id?, name?, path? }
ChatTurn = { qid, question, askedAt, steps: ChatStep[], answer?, answeredAt?, error? }
```

Le daemon garde les tours de la journée en mémoire (50 au plus), pas dans le journal. Les événements du chat sont diffusés à tous les clients. Une seule question à la fois : la seconde reçoit `chat.error`.

### 5.2 Le moteur : `claude -p --restricted`

Vérifié le 2026-10-11 sur la doc officielle et sur l'aide du CLI installé (Claude Code 2.1.296) :

- `claude -p` utilise la connexion `/login` de l'utilisateur (abonnement) sauf si `ANTHROPIC_API_KEY` est dans l'environnement. L'Agent SDK demande une clé API et Anthropic n'autorise pas le login claude.ai pour des produits bâtis dessus sans accord : écarté.
- `--bare` isole des hooks mais ne lit jamais l'OAuth : écarté.
- `--restricted` : retire Bash et les outils qui exécutent du code, **ignore les fichiers de réglages utilisateur, projet et local** (donc aucun hook de l'utilisateur, ceux de Ledge compris, ne tourne), confine les outils de fichiers aux dossiers de travail (`--add-dir` inclus), refuse `bypassPermissions`. L'authentification reste celle du CLI.

Commande, la question sur l'entrée standard :

```
claude -p --restricted --tools Read,Grep,Glob --permission-mode dontAsk
       --output-format stream-json --verbose --include-partial-messages --max-turns 16
       --append-system-prompt <persona>
       --add-dir <repoPath de chaque session…>
       --session-id <uuid du jour>      (ou --resume <uuid du jour> dès la 2e question)
```

- `cwd` = `~/.ledge/chat/context`, le dossier de contexte (5.3). Les dépôts des sessions sont ajoutés par `--add-dir` pour que `Read`, `Grep` et `Glob` y lisent sans invite (en `-p` une invite serait refusée).
- Une conversation par jour : l'UUID est tiré au premier message du jour et gardé dans `~/.ledge/chat.json` `{ day, sessionId }` ; les suivants reprennent avec `--resume`. Si la reprise échoue (transcription disparue), un nouvel UUID est tiré et la question rejouée une fois.
- Environnement : celui du daemon avec le `PATH` du shell de connexion (comme un lancement), `LEDGE_CHAT=1`, sans `LEDGE_SESSION` ni `LEDGE_NAME`. `ledge hook` ignore tout événement quand `LEDGE_CHAT=1` : ceinture et bretelles, pour qu'aucune session « Ledge » n'apparaisse dans la liste même si un hook tournait.
- Délai : 180 s, puis `SIGTERM` et `chat.error`. `chat.cancel` envoie `SIGTERM`.
- Flux `stream-json` lu ligne à ligne : `system/init` donne `session_id` ; `stream_event` → `content_block_delta/text_delta` → `chat.delta` ; `assistant` avec `tool_use` → `chat.step` ; `result` → texte final (`result`), `is_error`.

### 5.3 Le contexte

Avant chaque question, le daemon réécrit `~/.ledge/chat/context/` :

- `sessions.md` : pour chaque session, prénom, outil, état, sujet, dossier, dépôt et branche, début et dernière activité, demande en attente, sous-agents vivants, et le nom des fichiers ci-dessous qui la concernent.
- `pane-<id>.txt` : les 40 dernières lignes du terminal (capture tmux brute).
- `reply-<id>.md` : la dernière réponse (`lastReply.text`).
- `git-<id>.txt` : `git status --short --branch`, `git log --oneline -10`, `git diff --stat` du dossier.

Chaque `tool_use` dont le chemin tombe dans ce dossier devient une étape typée (`pane`, `reply`, `git`, `sessions`) ; un chemin dans un dépôt devient `repo` avec le nom du dépôt et le chemin relatif. L'overlay traduit les étapes (« Lit le terminal de Nova ») et en dérive la ligne de sources.

### 5.4 La persona

Passée par `--append-system-prompt`, en français :

> Tu es Ledge, le compagnon qui veille sur les sessions d'agents (Claude Code, Codex, Cursor Agent) de l'utilisateur. Tu lis, tu ne touches à rien : pas de commande, pas d'écriture, jamais d'instruction envoyée à une session. Tes sources : le dossier courant contient `sessions.md` (toutes les sessions, leur état et le nom de leurs fichiers), `pane-<id>.txt` (les dernières lignes du terminal d'une session), `reply-<id>.md` (sa dernière réponse) et `git-<id>.txt` (status, log et diff --stat de son dossier). Les dépôts eux-mêmes sont lisibles (Read, Grep, Glob) pour aller plus loin. Commence toujours par lire `sessions.md`. Ne lis que ce que la question demande. Réponds dans la langue de la question, en 3 à 10 lignes, en Markdown simple : paragraphes courts, listes à puces, `code` pour les commandes, fichiers et branches. Nomme chaque bot par son prénom en gras (**Nova**) la première fois. Dis d'où vient chaque fait et de quand il date quand cela compte. Si une information manque, dis-le au lieu de supposer. Tu ne proposes jamais d'agir à la place de l'utilisateur ; tu peux lui dire quel bot ouvrir.

### 5.5 L'overlay

- **Point d'entrée** : un champ « Demander à Ledge… » entre les lignes et le pied de la liste (36 px, mascotte 18 px, raccourci `/` qui lui donne le focus). Entrée sur un texte non vide : la vue chat s'ouvre (glissement de 12 px comme vers une session) et `chat.ask` part. Taper garde la liste ouverte (`typing`).
- **Vue chat**, mode `chat`, 420 px, hauteur mesurée (560 px avant mesure) : en-tête (retour, résidente 28 px, « Ledge. », sous-titre « Voit N sessions · M dépôts · lecture seule », fermer) ; fil des tours ; trois suggestions tant qu'aucun tour ; champ de saisie et bouton d'envoi, désactivés pendant une question.
- **Tour** : la question à droite sur fond `secondary`, 12 px de rayon sauf le coin bas droit ; la réponse à gauche derrière la résidente 24 px, Markdown simple (paragraphes, listes, titres, `inline`), les prénoms en gras devenant des liens `ledge://session/<id>` qui ouvrent la session ; sous la réponse, « Sources » avec les étapes dédoublonnées et « il y a N s ».
- **Pendant la recherche** : la résidente joue `pulse` en boucle, les étapes s'empilent (la dernière en `foreground`, les précédentes cochées), un bouton « Arrêter » envoie `chat.cancel`. Le texte arrive en direct par `chat.delta`.
- **Erreurs** : hors connexion, le champ est désactivé avec la raison ; `chat.error` s'affiche sous la question en `destructive`, le champ se rouvre.
- Mouvement : la vue chat suit les règles des vues de détail (glissement 12 px + fondu) ; un tour qui arrive se déplie en 220 ms ; rien d'autre de neuf.

## 6. Gestion des erreurs

- `claude` introuvable dans le `PATH` : `chat.error` « Claude Code introuvable dans le PATH » ; le champ reste utilisable.
- Code de sortie non nul : le dernier morceau de `stderr` (2 000 caractères au plus) dans `chat.error`.
- `git` absent ou dossier hors dépôt : pas de branche, pas de groupe par dépôt (le dossier sert de groupe), jamais une erreur.
- Session tmux disparue entre la capture et l'écriture : son `pane-<id>.txt` manque, `sessions.md` ne le nomme pas.
- Un `session.rename` sur une session inconnue : `error` avec son id.

## 7. Tests

- Protocole : les nouveaux champs et messages passent le schéma ; `cleanTopic` coupe à 80, ignore les lignes vides, aplatit les espaces ; `sessionTitle`.
- Réducteur : priorité des sources, titre recalculé, `Renamed` vide, aucun `lastActivityAt` touché.
- Hooks : `prompt` lu sur Claude/Codex et Cursor ; `LEDGE_CHAT=1` ignore.
- Adaptateur Claude : `paneTitle` sur une zone de saisie titrée, `null` sinon ; le poller émet `PaneTitle` une fois par titre.
- `gitInfo` sur de vrais dépôts temporaires : worktree principal, worktree lié, HEAD détachée, dossier sans dépôt.
- Serveur : `session.rename`, `@ledge_title` posé, `chat.ask` de bout en bout contre un faux `claude` (`test/fake-claude.mjs`) : étapes, deltas, fin, erreur, une question à la fois, reprise du jour.
- Overlay : groupes et lignes, chip de branche, hauteur de liste et coachmark avec en-têtes, séparateur et slots de la poignée, en-tête de session renommable, store du chat, machine (mode `chat`), vue chat (chips, envoi, étapes, liens vers les sessions, erreur, hors connexion), raccourci `/`, parité fr/en.
- Vérification sur machine (pas automatisable) : `claude -p --restricted` répond avec le compte abonné, aucun hook utilisateur ne tourne, les `Read` dans un `--add-dir` passent sans invite, l'onglet Windows Terminal suit `@ledge_title`.
