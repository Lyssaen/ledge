# Lot F : une seule interface « Équipes » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une seule interface d'équipes, identique quel que soit le moteur. Il s'agit des écrans de Joffrey, rebaptisés « Équipes », sur Desktop, le TUI et le téléphone. Ils affichent les équipes Ledge, que le lot D projette en `Rig` avec `engine: 'ledge'`. La salle technique devient celle du moteur actif. Les écrans de `main` que Joffrey couvre déjà sont retirés. Les autres restent, isolés.

**Architecture :**
- **Textes.** Seuls les textes visibles changent : « Rig(s) » devient « Équipe(s) ». Le code garde ses noms (`rig`, `useRigs`, `RigCard`…), et les commandes de la CLI d'OpenRig (`rig up`, `rig send`, `rig gateway …`) gardent les leurs.
- **Moteur actif.** Les fronts lisent `teams.engine` (lot D, `useTeamsEngine`). Ce qui ne vaut que pour OpenRig ne s'affiche qu'en mode OpenRig : bannière et invitation OpenRig, noyau, specs, lancement par plan. Un rig `engine: 'ledge'` n'est jamais caché par l'état d'OpenRig.
- **Écrans de `main`.**
  - Retirés, parce que l'interface de Joffrey les couvre : l'onglet Équipes « vivantes » et l'onglet Tâches de l'accueil Desktop, les tables d'équipe de l'Atelier (remplacées par la pièce de rig de l'équipe projetée) et les lignes d'équipe de l'arbre de la barre latérale.
  - Gardés, isolés :
    - le catalogue des modèles et des rôles (Desktop, onglet « Modèles ») ;
    - l'éditeur de modèle et de rôle du téléphone ;
    - les cartes d'équipe du chat ;
    - « rejoindre » par glisser-déposer (RoleChooser) ;
    - quitter ;
    - reprendre.
  - L'éditeur de modèle affiche la règle « exactement un lead ».

**Tech Stack :** React (Desktop, PWA), ink (TUI), TypeScript, vitest, pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-11-01-equipes-deux-moteurs-design.md` (§6.5 et §6.6). Plan maître, lot F, avec les deux reports du lot A.

## Global Constraints

- Branche `feat/teams-two-engines`. On ne pousse pas. On ne touche ni `ledge-open-rig` ni `main`.
- **Pas de renommage du code « rig ».** Seuls les textes visibles changent.
- **Mode OpenRig.** Le comportement et les textes propres à OpenRig ne changent pas en mode OpenRig, à part le mot « Rigs » de la navigation, qui devient « Équipes ».
- **Compatibilité du fil.** Seuls des champs optionnels peuvent être ajoutés. Les trames figées 0.32 passent toujours.
- **Textes.** Français dans les fichiers i18n, avec l'anglais à côté pour Desktop et le TUI. Le téléphone garde ses textes en dur dans `copy.ts` ou dans le composant.
- **Chaque tâche finit verte.**
  - `pnpm typecheck` ;
  - puis les paquets touchés, un par un (`TERM=xterm pnpm --filter <pkg> test`) ;
  - les tests e2e Desktop existants (`apps/desktop/e2e`) qui touchent un écran modifié sont mis à jour.
- **Échecs connus et antérieurs**, à ne pas compter :
  - `brain-remote-integration` (un ou deux tests) ;
  - `chat-service` « keeps only the last 50 turns ».
- **Commits.** Un par tâche, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` avec des chemins explicites.

## Review Focus

1. **Une équipe Ledge sur une machine sans OpenRig.** On attend qu'elle apparaisse partout : onglet Équipes, barre latérale, Bureaux, TUI et téléphone. Aujourd'hui, `visibleRigs` la cacherait. Test à la tâche 1, plus un cas par front.
2. **Une équipe Ledge au repos.** On attend qu'elle reste visible, marquée « au repos », avec « Reprendre » (`rig.act up`). Elle ne doit pas disparaître parce que ses sièges sont `stopped`. Test aux tâches 2 et 3.
3. **Le même lancement d'équipe en mode Ledge et en mode OpenRig.** Le bouton « Lancer une équipe » ouvre le formulaire `TeamLaunch` (avec l'objectif) en mode Ledge, et le lancement par plan d'OpenRig en mode OpenRig. Test à la tâche 1.
4. **Doublons.**
   - Une équipe Ledge apparaît une seule fois dans la barre latérale (pas de ligne d'arbre en plus de la ligne de rig) et une seule fois dans les Bureaux (pas de table d'équipe vide en plus du bureau de rig).
   - Il n'y a pas deux onglets « Équipes » sur l'accueil Desktop.

   Tests aux tâches 1 et 2.
5. **Le téléphone en mode OpenRig.** On attend qu'il atteigne les modèles et les rôles depuis l'onglet « Équipes », et que l'écran des modèles montre la barre d'onglets OpenRig. Test à la tâche 4.

---

### Task 1 : Desktop, les textes « Équipes » et l'affichage selon le moteur

**Files :**
- Modify : `apps/desktop/src/i18n/{fr,en}.ts`, `apps/desktop/src/rigs/RigsTab.tsx` (`visibleRigs`, bannière, bouton de lancement), `apps/desktop/src/rigs/RigCard.tsx`, `apps/desktop/src/shell/sidebar/RigsSection.tsx`, `apps/desktop/src/chat/LedgeHome.tsx` (onglets), `apps/desktop/src/chat/LedgeConversation.tsx` et `LedgeRail.tsx` (comptes), `apps/desktop/src/nav/state.ts` (`HOME_TABS`), `apps/desktop/src/teams/Catalog.tsx` (règle du lead)
- Test : les tests existants de ces écrans, plus `apps/desktop/test/teams-engine-ui.test.tsx`

**Interfaces :**
- Consumes : `useTeamsEngine` (lot D, tâche 5) et `Rig.engine` (lot D, tâche 1).
- Produces :
  - **`visibleRigs(all: Rig[], openrig: OpenRigStatus[]): Rig[]`.** Un rig `engine === 'ledge'` est toujours gardé. Un rig OpenRig est filtré comme aujourd'hui.
  - **Textes i18n.** Chaque clé visible qui dit « rig(s) » passe à « équipe(s) », en fr comme en en (« team(s) »). En fr, cela touche `side.rigs.*`, `home.tabs.rigs`, `home.rigsCount`, `rigsTab.*`, `rigActions.*`, `rooms.rig*`, `modalTitles.rigLaunch`, les textes `rigLaunch.*` qui nomment un rig, `atelier.orchestrating` et `side.ledge.calm`.
    - Restent telles quelles : les commandes OpenRig, `openrig.dev/rigs`, `.worktrees/rig-…`, `~/.ledge/rigs/…`, et tout texte qui nomme OpenRig lui-même.
    - Le relecteur vérifie ce périmètre avec `grep -n -i "rig" apps/desktop/src/i18n/fr.ts`.
  - **Onglets de l'accueil.**
    - `HOME_TABS` devient `['conversation', 'rigs', 'models', 'mandat']`. Le libellé de `rigs` est « Équipes · n ».
    - Le nouvel onglet `models` (« Modèles », en « Templates ») affiche le `CatalogView` existant, limité aux vues modèles, rôles et problèmes.
    - Les composants `TeamsTab` et `TasksTab` de `LedgeHome.tsx` sont supprimés, ainsi que leurs textes devenus inutilisés.
  - **Bouton de lancement.** « Lancer une équipe » de l'onglet Équipes et de la barre latérale ouvre en mode Ledge la modale de lancement d'équipe existante (`launch` avec `team: true`, formulaire `TeamLaunch`). En mode OpenRig, il ouvre la modale `rig-launch`. La vue des specs n'existe qu'en mode OpenRig.
  - **Bannière et invitation OpenRig** (`RigsTab.tsx:51-57`, `RigsSection.tsx:36-41`). Elles ne s'affichent qu'en mode OpenRig.
  - **`RigCard` d'un rig Ledge.**
    - La ligne méta affiche le modèle (`spec` porte l'id du modèle quand il y en a un) au lieu de « spec … ».
    - Le texte d'arrêt n'évoque pas l'instantané d'OpenRig : `rigActions.stopBodyLedge`, en fr « Les sessions de l'équipe se ferment ; l'équipe reste au repos et se reprend d'un clic. », en en « The team's sessions close; the team stays at rest and resumes with one click. ».
  - **Catalogue.** `TemplateDetail` affiche une ligne `catalog.leadRule`, en fr « Une équipe a exactement un siège leader : son lead, qui reçoit l'objectif. », en en « A team has exactly one leader seat: its lead, who receives the objective. ». Un problème « il manque le siège @leader » s'y affiche via `ProblemsDetail`, sans changement.

- [ ] **Step 1 : tests.**
  - `visibleRigs` garde un rig Ledge quand OpenRig est `absent` (Review Focus 1).
  - L'accueil a les onglets `conversation`, `rigs` (« Équipes · 1 »), `models` (« Modèles ») et `mandat`, et un seul onglet porte « Équipes » (Review Focus 4).
  - En mode Ledge, le bouton « Lancer une équipe » ouvre `TeamLaunch`. En mode OpenRig, il ouvre `rig-launch` (Review Focus 3).
  - La bannière OpenRig est absente en mode Ledge.
  - `TemplateDetail` affiche la règle du lead.
  - Mettre à jour les tests et l'e2e qui cherchaient les anciens textes ou les onglets retirés.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN.** Lancer `pnpm typecheck`, puis `desktop`.
- [ ] **Step 5 : commit** — `feat(desktop): one « Équipes » screen for both engines; main's live teams and tasks tabs give way, templates stay`

### Task 2 : Desktop, la salle technique du moteur, les Bureaux et la barre latérale

**Files :**
- Modify : `apps/desktop/src/atelier/Atelier.tsx` (cœurs, `sceneOf` sans `teams`, glisser-rejoindre sur une équipe Ledge), `apps/desktop/src/atelier/offices/OfficeFloor.tsx` (plaque, baies), `apps/desktop/src/atelier/offices/layout.ts`, `packages/ui/src/rigs/scene.ts` et `model.ts` (équipe au repos), `apps/desktop/src/shell/sidebar/Tree.tsx` et `model.ts` (lignes d'équipe retirées), `apps/desktop/src/chat/ChatPanel.tsx` et `App.tsx` (`onOpenTeam` vers la pièce de l'équipe), `apps/desktop/src/atelier/ProjectTable.tsx` et `ProjectRoom.tsx` (parties d'équipe retirées)
- Test : `apps/desktop/test/atelier*.test.tsx`, `office-floor*.test.tsx`, `sidebar*.test.tsx`, plus les e2e touchés

**Interfaces :**
- Consumes : `useTeamsEngine` ; `useMachines`, ou ce que la fleet expose pour les machines et leur état de liaison ; les rigs projetés.
- Produces :
  - **`Core = { machine: string; state: 'running' | 'starting' | 'unreachable' | 'stopped' }`.** Les cœurs dépendent du moteur :
    - en mode OpenRig, comme aujourd'hui (les rigs `kernel`, avec l'état d'OpenRig de la machine) ;
    - en mode Ledge, un cœur par machine de la fleet, `running` quand son daemon est lié et `unreachable` sinon.
  - **Plaque de la salle technique.** Elle devient une prop. Le texte est `atelier.techPlate`, en fr `Équipes · {engine}` et en en `Teams · {engine}`, où `engine` vaut « Ledge » ou « OpenRig ».
  - **Classes CSS des baies.** Elles couvrent les quatre états de `Core` (une LED par état, `office-floor.css`).
  - **Bureaux et Atelier.**
    - `sceneOf` ne reçoit plus `teams` : les équipes Ledge y entrent comme rigs projetés.
    - Les parties « table d'équipe » de `ProjectTable` et `ProjectRoom` (en-tête d'équipe, menu, « Nouvelle équipe ici… ») sont retirées.
    - Lancer une équipe se fait depuis l'onglet Équipes (tâche 1).
  - **Équipe au repos (Review Focus 2).**
    - `rigsModel` garde un rig `engine === 'ledge'` dont `lifecycle === 'stopped'`.
    - Sa pièce et son bureau s'affichent vides, avec la plaque `{nom} · au repos` (`atelier.resting`, en fr « au repos », en en « at rest »).
    - L'action « Reprendre » envoie `rig.act { verb: 'up' }`.
  - **Glisser-rejoindre.** Déposer une session sur la pièce d'une équipe Ledge ouvre le `RoleChooser` existant, puis envoie `team.join` (via `useTeamsApi`). Glisser une session hors de la pièce envoie `team.leave`.
  - **Barre latérale.** L'arbre ne dessine plus les lignes d'équipe de `main` (`Tree.tsx:1951-1971`, et leurs entrées dans le modèle). Les équipes Ledge y sont des lignes de `RigsSection`.
  - **Chat.** La carte d'équipe du chat ouvre, une fois l'équipe lancée, la pièce de cette équipe (rig `team-…`) au lieu de l'ancienne table d'équipe.

- [ ] **Step 1 : tests.**
  - **Salle technique.** En mode Ledge avec deux machines (l'une liée, l'autre non), on attend la plaque « Équipes · Ledge », deux baies `running` et `unreachable`. En mode OpenRig, la plaque est « Équipes · OpenRig » et les baies viennent des noyaux.
  - **Review Focus 4.** Une équipe Ledge projetée donne un seul bureau dans les Bureaux, sans table d'équipe vide dans le bureau du projet, et une seule ligne dans la barre latérale.
  - **Review Focus 2.** Une équipe au repos donne un bureau vide « … · au repos ». « Reprendre » envoie `rig.act up`.
  - **Glisser-rejoindre.** Déposer une session sur la pièce ouvre le `RoleChooser`, et choisir `review` envoie `team.join`.
  - Mettre à jour les tests de l'Atelier qui comptaient sur les tables d'équipe de `main`, sans affaiblir ce qu'ils vérifiaient d'autre.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN.** Lancer `pnpm typecheck`, puis `desktop` et `@ledge/ui`.
- [ ] **Step 5 : commit** — `feat(desktop,ui): the tech room of the active engine; Ledge teams live in the Bureaux as their own rooms, at rest included`

### Task 3 : le TUI

**Files :**
- Modify : `packages/ledge/src/tui/i18n/{fr,en}.ts`, `packages/ledge/src/tui/model/left.ts` (lignes d'équipe retirées, équipes Ledge en lignes de rig, équipe au repos), `packages/ledge/src/tui/screens/Home.tsx` (J et R), `packages/ledge/src/tui/ui/RigRoom.tsx` (actions d'une équipe Ledge), `packages/ledge/src/tui/screens/Teams.tsx` (titre « Modèles »), `packages/ledge/src/tui/screens/Help.tsx`
- Test : `packages/ledge/test/tui-*.test.tsx`

**Interfaces :**
- Consumes : `teams.engine`, que le TUI reçoit comme les autres clients (l'ajouter à son état s'il le faut), et les rigs projetés.
- Produces :
  - **Textes.** « rig(s) » devient « équipe(s) » dans les textes visibles : `crumb` donne `1 Ledge · 2 Équipe · 3 Session · 4 Modèles`, `screens`, `rigs`, `noRig`, `room`, `rigAct.*` et l'aide. Les commandes OpenRig gardent leur nom.
  - **Colonne de gauche.**
    - Les équipes Ledge y sont des lignes de rig.
    - Les lignes `kind: 'team'` portées au lot A sont retirées.
    - Une équipe au repos reste une ligne, marquée `au repos`.
    - Les lignes de noyau n'apparaissent qu'en mode OpenRig.
  - **Touches.**
    - `R` sur une ligne d'équipe Ledge au repos envoie `rig.act { verb: 'up' }`.
    - `J` garde son sélecteur : il fait entrer la session choisie dans une équipe Ledge vivante par `team.join`.
    - `D` ne change pas.
  - **Écran 4.** Il s'intitule « Modèles » (« Templates ») et garde son contenu de catalogue.

- [ ] **Step 1 : tests.**
  - Une équipe Ledge donne une seule ligne (pas de doublon `team`).
  - Une équipe au repos donne une ligne `au repos`, et `R` envoie `rig.act up`.
  - `J` fonctionne toujours.
  - En mode Ledge, aucune ligne de noyau.
  - La barre de navigation dit `2 Équipe`.
  - Mettre à jour les tests qui cherchaient les anciens textes, y compris les trois tests J, R et D réactivés au lot A.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN.** Lancer `pnpm typecheck`, puis `@paradow/ledge`.
- [ ] **Step 5 : commit** — `feat(ledge): the TUI shows one kind of team, named « Équipes », whatever the engine`

### Task 4 : le téléphone

**Files :**
- Modify : `apps/mobile/src/copy.ts`, `apps/mobile/src/screens/OpenRig.tsx` (textes en dur, entrée « Modèles »), `apps/mobile/src/screens/Agents.tsx:126`, `apps/mobile/src/screens/Thread.tsx:212`, `apps/mobile/src/screens/Teams.tsx` (prop `openrig` de la barre), `apps/mobile/src/screens/TeamEditor.tsx` (règle du lead), `packages/protocol/src/phoneOpenrig.ts` (`PhoneRig.engine` optionnel), `packages/ledge/src/mobile/*` (passer `engine` et inclure les équipes Ledge projetées dans les rigs du téléphone)
- Test : `apps/mobile/test/screens/*.test.tsx`, `packages/protocol/test/*phone*.test.ts`, `packages/ledge/test/mobile-*.test.ts`

**Interfaces :**
- Consumes : les rigs projetés (lot D) et le passage de `rig.snapshot` aux `PhoneRig` dans la passerelle du téléphone.
- Produces :
  - **`PhoneRig`** gagne `engine: z.enum(['ledge', 'openrig']).optional()`. La passerelle le remplit et inclut les rigs `engine: 'ledge'`.
  - **Textes.**
    - `copy.nav.rigs` devient « Équipes » et `copy.backTo.rigs` devient « Retour aux équipes ».
    - Les textes en dur de `OpenRig.tsx` qui disent « rig » passent à « équipe ». Exemples : « Lancer une équipe… », « Aucune équipe pour le moment. », « Cette équipe est arrêtée », « Vues de l'équipe », « Arrêter l'équipe… ».
    - Les commandes OpenRig et les chemins `.worktrees/rig-…` restent tels quels.
    - `Agents.tsx:126` devient « N équipes travaillent aussi ici : … · Équipes › ».
    - `Thread.tsx:212` devient « Ce siège appartient à l'équipe {…} : son moteur s'occupe de son cycle de vie. ».
  - **Entrée « Modèles ».** Elle est ajoutée à l'en-tête de l'écran Équipes (`Rigs`, `OpenRig.tsx`) et mène à `#/teams`. `Teams.tsx` passe `openrig={state.openrig}` à sa barre d'onglets.
  - **Éditeur de modèle.**
    - Il affiche sous la liste des sièges la ligne « Une équipe a exactement un siège leader : son lead. ».
    - « Enregistrer » est désactivé tant qu'aucun siège n'a le rôle `leader`, avec la raison affichée.
  - **Lancement d'une équipe Ledge depuis le téléphone.** Il passe par les écrans de modèles existants. L'objectif sur le téléphone n'est pas dans ce lot.

- [ ] **Step 1 : tests.**
  - La passerelle met une équipe Ledge projetée dans les rigs du téléphone avec `engine: 'ledge'`.
  - Un `PhoneRig` sans `engine` passe toujours.
  - L'onglet dit « Équipes ».
  - **Review Focus 5.** L'écran Équipes a un lien « Modèles » vers `#/teams`, et l'écran des modèles montre la barre OpenRig (l'onglet Équipes actif).
  - L'éditeur de modèle sans siège `leader` désactive « Enregistrer » et affiche la raison. Avec un siège `leader`, « Enregistrer » est actif.
  - Mettre à jour les tests qui cherchaient « Rigs ».
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN.** Lancer `pnpm typecheck`, puis `@ledge/protocol`, `@ledge/mobile` et `@paradow/ledge`.
- [ ] **Step 5 : commit** — `feat(mobile): « Équipes » on the phone for both engines, templates reachable, the lead rule in the editor`
