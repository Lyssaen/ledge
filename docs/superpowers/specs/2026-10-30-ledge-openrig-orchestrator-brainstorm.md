# Ledge, orchestrateur d'OpenRig : état du brainstorm

Brainstorm du 2026-10-30, session Otto. **Ce n'est pas encore un design approuvé** : le document rassemble les décisions prises, les propositions d'écrans et les questions encore ouvertes, pour qu'une nouvelle session reprenne exactement là où on s'est arrêtés.

- **Page de maquettes** (privée) : https://claude.ai/artifact/FUfjAAe1tSUiK7FRMAt4JC
- **Copie locale** : `docs/mockups/ledge-openrig/`. Elle contient `shots/` (les captures), `canvas/` (les fichiers de la page) et `capture/` (les scripts qui refont les captures).

## L'intention

Aujourd'hui, Ledge sert à voir où en est chaque agent et lequel attend une action. Il doit devenir **l'agent orchestrateur d'OpenRig** : l'agent clé, et non plus un tableau de bord.

- Il lance, crée et suit des rigs OpenRig.
- Il prend les décisions des équipes en s'appuyant sur sa mémoire.
- Il ne revient vers l'utilisateur que si c'est nécessaire.
- **Son mandat** : il ne tranche jamais seul une décision de design, d'architecture ou critique. Celles-là remontent à l'utilisateur.
- **Ce qui part** : la gestion d'équipe propre à Ledge (rôles, `ledge team`, `ledge task`). OpenRig s'occupe de la mécanique des équipes.
- **Ce qui reste** : l'Atelier. On y voit ensemble :
  - les agents hors rig (les sessions seules) ;
  - les agents des rigs ;
  - le noyau OpenRig (operator, queue).

## Décisions de l'utilisateur

1. **Ledge est l'« humain » d'OpenRig** (`rig gateway human add ledge …`). Toutes les escalades des rigs et de l'operator arrivent à Ledge, et **Ledge seul contacte l'utilisateur**.
2. **Le cerveau de Ledge** est une session qui tourne en permanence, quel que soit l'outil (Claude, Codex, OMP…).
3. **Les rigs, agents et équipes sont visibles dans Ledge.** On agit sur les agents d'un rig comme sur les sessions seules, et on voit les échanges entre agents, comme les cartes d'échange de Ledge.
4. **L'encoche** :
   - à l'ouverture, elle montre le fil des rigs, et Ledge reste toujours joignable ;
   - fermée, elle ne montre que Ledge, sans rangée de bots.
5. **Les maquettes partent de la version actuelle** (app réelle, 0.29.0), pas de dessins.
6. **Barre latérale.** On garde la section **Projets** pour les sessions seules, et on ajoute une section **Rigs**.
7. **Une pièce, une table** : un projet = une table, un rig = une table. Il n'y a plus de table d'équipe à l'intérieur d'un projet.
8. **Lancer un rig hors projet.** On peut lancer un rig dans un espace de travail créé à la volée, hors de tout projet. Les dépôts sont identifiés en route : ceux que le rig clone ou que ses agents ouvrent.
9. **Ranger un rig dans un projet (option 1).** Le rig garde sa propre pièce, avec « dans <projet> » sur la plaque. Il ne devient pas une seconde table dans la pièce du projet.
10. **L'affichage actuel du chat ne plaît pas** sur l'écran Ledge, ni dans la barre latérale. Des propositions ont été faites (voir plus bas).
11. **Barre latérale : variante 1a retenue** (`s1a.png`). Ledge s'affiche comme une ligne de messagerie : avatar, « Ledge. », heure, aperçu d'une ligne et nombre de non-lus. Le champ « Demander à Ledge… » quitte la barre latérale (on écrit sur l'écran Ledge, ou avec `/`). La section « À toi » reste en dessous, inchangée.
12. **Écran Ledge : proposition A retenue** (`c-A.png`, messagerie).
    - La conversation prend toute la place, en bulles : Ledge à gauche avec sa mascotte, l'utilisateur à droite.
    - Une décision arrive *dans* le message de Ledge, avec ses boutons.
    - Les échanges entre agents sont regroupés par rig et repliables (« factory · 3 échanges · 16:36 → 16:42 »).
    - « Le point » devient un rail à droite : À toi, Rigs, Tranché aujourd'hui, puis « Résumer la journée ».
    - La barre de saisie réelle reste en bas, avec ses suggestions.
14. **Maquettes TUI et mobile.**
    - **TUI** (Tuin) : https://claude.ai/artifact/39cmxt4BPuZRSArkHPcowt. L'accueil de `ledge tui` devient l'écran Ledge (A) en trois colonnes.
    - **Mobile** (Mobi) : https://claude.ai/artifact/2FXtE18YzaXkkKD7ZXGC32. Onglets Ledge · À toi · Rigs · Projets, confirmés (Équipes disparaît, Agents devient Projets). L’écran Ledge suit la variante **A1** (bandeau « Le point » qui s'ouvre en feuille) ; A2 est écartée.
    - **Clé d'accès mobile** : demandée seulement pour ce qui agit (lancer, arrêter ou relancer un rig ; accords risqués). Répondre à une décision remontée se fait d'un geste, y compris depuis la notification.
    - Le plan d'implémentation est confié à Plume.
13. **Suite lancée** : une session sur la réécriture du TUI et une sur la version mobile. Chacune doit produire une maquette alignée sur ces décisions.

## Recommandations faites, non validées

- **L'operator reste le mécanicien d'OpenRig.** Ledge lui donne les ordres, mais ne réécrit pas sa logique (reboot, mises à jour, snapshots).
- **L'advisor du noyau fait doublon avec Ledge.** Il est rangé dans « +2 » sur les maquettes.
- **Les actions sur le cycle de vie passent par OpenRig** (arrêter, relancer, restaurer). Un `kill` côté Ledge serait vu comme un crash.
- **L'onglet « Tâches » disparaît**, puisque la queue d'OpenRig le remplace. L'onglet « Rôles » devient « Agents ».
- **Écran Ledge** : la proposition C (Ledge résume) a ma préférence.
- **Le plan avant lancement** : étape obligatoire, ou cachée derrière « Voir le plan » ? Non tranché.

## Questions ouvertes

- **La conversation avec Ledge dans l'encoche** : mélangée au fil des rigs (comme sur les maquettes), ou dans un espace à part ?
- **L'onglet « Décisions » de l'écran Ledge** : le garder, ou le fondre dans Mandat › Dernières décisions ?
- **Le plan avant lancement** : obligatoire ou facultatif ?
- **Point technique** : Slack est le seul connecteur documenté pour livrer au canal humain d'OpenRig. Reste à vérifier si OpenRig accepte un connecteur local, ou si Ledge doit lire et répondre directement dans la queue (`rig queue list --destination ledge@external`).
- **Point technique** : la détection des dépôts d'un rig hors projet. L'hypothèse : chercher les dossiers git dans l'espace, puis les rattacher au siège qui les a créés ou ouverts grâce aux hooks.

## Faits OpenRig (0.6.14, lus dans le paquet installé)

- **Le noyau** compte quatre sièges :
  - l'**advisor** (Claude) traduit l'intention en équipe, sans rien lancer ;
  - l'**operator** (Codex, accès complet) fait tourner OpenRig : up/down, santé, reprise après reboot, mises à jour, watches, alerte `needs_input`, guide de la première équipe. Il ne décide jamais de ce qui a un gros impact ;
  - le **queue worker** range le flux entrant en tâches ;
  - `operator.human` est le terminal du tableau de bord TUI.
- **Les messages vers l'humain** sont des lignes de queue adressées à `<id>@external`. Chaque ligne porte une intention (`human_intent` : decision ou update), de 1 à 4 questions avec options (dont une recommandée), et un fil de discussion via `--reply-to`. Une tâche bloquée reprend quand la décision est close.
- **L'API du daemon** écoute sur `127.0.0.1:7433` : `/rigs`, `/rigs/summary`, `/rigs/:id/graph`, `/ps`, queue, attention, events.
- **La base** `~/.openrig/openrig.sqlite` contient :
  - `outbox_entries` : chaque `rig send` (expéditeur, destinataire, texte, livraison) ;
  - `queue_items` : tâches, passations et décisions humaines ;
  - `edges` : le schéma du rig ;
  - `events` : `queue.created`, `queue.handed_off`, `seat.activity_changed`…
- **L'espace de travail** est `~/.openrig/workspace` (`workspace.root`, `workspace.projects_root`), avec un catalogue de projets dans `workspace.yaml`.
- **Les specs livrées** : starter (2 sièges), workshop (4, à installer depuis le registre) et factory (7).
- **Lancer une équipe dans un dossier ajoute des fichiers** (`CLAUDE.md`, `.mcp.json`, `.openrig/`, `.claude/settings.local.json`). Ce dernier fait démarrer la session Claude de l'utilisateur, dans ce dossier, en mode « accepter les modifications ».
- **Le daemon OpenRig était arrêté** depuis le 2026-10-24 au moment du brainstorm.

## Les écrans (page de maquettes et `docs/mockups/ledge-openrig/shots/`)

Toutes les captures viennent de l'app réelle (`origin/main` 0.29.0), lancée avec le faux daemon des tests e2e. Le texte et la structure ont été réécrits au moment de la capture.

| Rangée de la page | Écran | Fichier |
|---|---|---|
| L'encoche | Fermée, quatre états : calme, échange, tranché, pour toi | `nn-closed-*.png` |
| | Ouverte : décision épinglée, fil, champ Écrire à Ledge | `nn-open.png` |
| Desktop | Accueil de Ledge, avec Projets et Rigs dans la barre latérale | `new-home.png` |
| | Atelier, rig factory avec un échange en cours | `new-atelier-factory.png` |
| | Atelier, vue d'ensemble | `new-atelier.png` |
| L'écran Ledge (1re proposition) | Conversation et fil | `p-ledge-conv.png` |
| | Mandat et souvenirs | `p-ledge-mandat.png` |
| Gestion des rigs | Rigs › En cours | `p-rigs-live.png` |
| | Rigs › Specs | `p-rigs-spec.png` |
| Une pièce, une table | Avant (0.29) : projet à deux tables, étiquette d'équipe corrigée | `p-before-ledge.png` |
| | Après : projet à une table | `p-after-ledge.png` |
| | Après : rig à une table, avec ses actions | `p-after-factory.png` |
| Lancer un rig | 1 · Nouveau rig : le but, la spec, où | `l-1-nouveau.png` |
| | 2 · Le plan | `l-2-plan.png` |
| | 3 · Le démarrage | `l-3-demarrage.png` |
| Rig hors projet | 1 · Nouvel espace | `w-1-nouveau.png` |
| | 2 · Dépôts trouvés, « Ranger dans un projet » | `w-2-encours.png` |
| | 3 · Sa pièce | `w-3-piece.png` |
| Chat de l'écran Ledge | A · Messagerie | `c-A.png` |
| | B · Deux colonnes | `c-B.png` |
| | C · Ledge résume | `c-C.png` |
| Ledge dans la barre latérale | 1 · Conversation épinglée | `s-1.png` |
| | 2 · Ledge absorbe « À toi » | `s-2.png` |
| | 3 · Dock en bas | `s-3.png` |
| Variantes de la conversation épinglée | 1a · une ligne, 1b · la mascotte parle, 1c · la question en aperçu, 1d · mini-fil | `s1a.png` à `s1d.png` |

Références de l'app actuelle :
- encoche : `notch-rest.png`, `notch-awake.png`, `notch-bubble.png`, `notch-chat.png` ;
- écrans Équipes : `raw-live.png`, `raw-spec.png`, `raw-launch.png` ;
- fenêtre Nouvelle session : `probe-composer*.png`.

`p-rig-launch.png` est l'ancienne fenêtre de lancement unique, remplacée par `l-1` à `l-3`.

## Refaire les captures

La copie de travail est `.worktrees/capture-main`, détachée sur `origin/main`. À recréer si besoin :

```sh
git worktree add --detach .worktrees/capture-main origin/main
cd .worktrees/capture-main
pnpm install --frozen-lockfile
```

- **Desktop** :
  ```sh
  cd .worktrees/capture-main/apps/desktop
  pnpm exec playwright test -c ../../../../docs/mockups/ledge-openrig/capture/playwright.config.ts -g "<nom du test>"
  ```
- **Encoche** : même commande depuis `apps/overlay`, avec `pw-notch.config.ts`.

Points à connaître :
- Les ports sont 5311 (Desktop) et 5312 (encoche). Ne jamais réutiliser 5299 : un serveur d'une autre session peut y tourner.
- Vite met environ 2 min à démarrer.
- Les identifiants d'équipe doivent suivre `team-[0-9a-f]{4,8}`.
- Un modèle d'équipe ne peut pas répéter un rôle.
- Les scripts importent `e2e/daemon.ts` depuis `.worktrees/capture-main`.

## Défaut repéré dans l'app réelle (0.29)

L'étiquette d'une table d'équipe (`.heading-team-line`, « équipe · opérateur Ledge · 0/0 tâche ») déborde de son cadre sur le tapis de l'Atelier.

## Suite

1. Écran Ledge (A) et barre latérale (1a) réglés. Reste : les questions ouvertes ci-dessus, et les maquettes TUI et mobile des deux sessions lancées.
2. Rédiger le design complet (`docs/superpowers/specs/<date>-ledge-openrig-orchestrator-design.md`) et le faire relire.
3. Puis le plan (superpowers:writing-plans).
