# Démarrer une session depuis Ledge — spécification

Date : 2026-10-10 · Projet personnel, hors story Jira · Auteur : Joffrey Desantoine avec Claude Code

Maquette validée : https://claude.ai/artifact/YBX4UV7Z2eBRNKAwNh3876 (cinq planches : point d'entrée dans la liste, liste vide, formulaire, choix du dossier, session en démarrage).

## 1. Objectif

Aujourd'hui une session n'existe que si l'utilisateur tape `ledge claude` dans un terminal. L'overlay doit pouvoir démarrer un compagnon lui-même : choisir un dossier, un outil, un nom, une première instruction, et voir la session apparaître dans la liste comme n'importe quelle autre.

Succès :

- Depuis la liste (bouton `+`, ou le bouton de la liste vide), un formulaire démarre une session en une validation.
- La session créée est une session `launcher` ordinaire : même tmux, mêmes hooks, mêmes décisions depuis l'overlay.
- L'onglet du terminal reste accessible : ouvert au démarrage si l'option est cochée, sinon à un clic depuis la fiche.
- Rien ne change pour `ledge claude` dans un terminal.

Hors périmètre : navigateur de fichiers Windows, réglage du mode de permission, profils de lancement enregistrés.

## 2. Protocole

Client vers daemon :

| Message | Rôle |
| --- | --- |
| `session.launch { tool, cwd, name?, prompt?, continue? }` | L'overlay demande une session. `cwd` est un chemin WSL absolu (`~` accepté). |

Daemon vers clients :

| Message | Rôle |
| --- | --- |
| `session.launched { id }` | Réponse au seul demandeur : la session est créée (la `session.updated` suit par diffusion). Une erreur est un `error { message }` sans `id`. |
| `snapshot { sessions, recents?, launcher? }` | `recents` : les dossiers récents (`{ cwd, project, lastAt }`, 12 au plus, le plus récent en tête). `launcher` : la commande qui exécute `ledge` dans WSL (`[node, cli]`), pour attacher un terminal. |
| `recents { recents }` | La liste des dossiers récents a changé. |

## 3. Daemon

- `spawnSession` (nouveau module `packages/ledge/src/spawn.ts`) : ce que `createSession` du launcher faisait de la création tmux à l'objet `Session`, sans client. Le launcher et le serveur l'appellent.
- `session.launch` : vérifie l'outil et le dossier (`~` développé, chemin absolu, répertoire existant, sinon `error`), construit les arguments de l'agent (`--continue` si demandé, l'instruction en argument positionnel), crée la session tmux avec `LEDGE_SESSION` et `LEDGE_NAME`, l'enregistre en `starting`, met à jour les récents, répond `session.launched`.
- Pas d'enveloppe d'exit code : personne ne la lit ; la fin de la session est vue par le poller (`PaneGone`).
- Les récents sont tenus par le store, écrits dans le journal (`sessions.json` gagne `recents`) et mis à jour à chaque `session.register` ou `session.launch`.
- `ledge attach <id>` (nouveau mode CLI) : renomme l'onglet au titre de la session puis attache le terminal à `ledge-<id>`. C'est ce que l'overlay lance dans un nouvel onglet Windows Terminal.

## 4. Overlay

- Nouveau mode de surface `launch`, vue de détail comme `settings` et `help` (même en-tête, même pliage).
- Entrées : le bouton `+` dans l'en-tête de la liste ; le bouton « Nouvelle session » de la liste vide.
- `LaunchView` : Dossier (champ texte + dossiers récents du daemon, en cours marqués), Outil (segmenté, Codex et Cursor annoncés en lecture seule), Compagnon (nom pré-tiré parmi les noms libres, un dé pour en changer, vide = le daemon choisit), Première instruction (facultative), deux interrupteurs : Reprendre la dernière conversation (`--continue`), Ouvrir l'onglet du terminal (mémorisé). Entrée démarre, Échap revient à la liste.
- Après `session.launched` : retour à la liste, bandeau « X démarre dans Y · Ouvrir le terminal » quelques secondes ; si l'option est cochée, l'onglet s'ouvre tout seul.
- Commande native `open_terminal { title, command }` : `wt.exe -w 0 new-tab --title <title> wsl.exe -- <command>`. Le bouton ↗ de la fiche tente d'abord `focus_terminal` ; sans onglet trouvé, il en ouvre un.
- Les noms des compagnons passent dans `@ledge/protocol` pour que l'overlay pré-tire un nom libre.

## 5. Tests

- Protocole : les nouveaux messages se valident.
- Daemon : `session.launch` crée la session tmux avec le bon dossier, nom, outil et arguments, répond `session.launched`, refuse un dossier inexistant ; les récents suivent et survivent au redémarrage.
- Overlay : la machine (mode `launch`, retour, pliage) ; la vue (remplissage, envoi, dé, annulation) ; la surface (bouton `+`, retour à la liste et bandeau sur `session.launched`, ouverture du terminal selon l'option) ; le bridge (no-op dans le navigateur).
