# Ledge — les Bureaux, nouvel Atelier

Date : 2026-10-31 · Projet personnel, hors story Jira · Statut : **maquette validée par l'utilisateur, intégration
après les lots OpenRig** (voir `2026-10-30-ledge-openrig-orchestrator-brainstorm.md`).

- **Maquette** (privée) : https://claude.ai/artifact/4wcv9chArCBAfshBpqRfUM
- **Sources** : dépôt `~/Workspace/graphics-resources`, dossier `web/ledge-bureaux/` (page) et `tools/` (générateur, test).
- **Captures** : `docs/mockups/ledge-bureaux/shots/` (jour, nuit, plein écran, visite, réunion chez Ledge, marche).

Ce document décrit ce que la maquette fixe, comment ses données correspondent à celles de Ledge et dans quel ordre
l'intégrer dans `apps/desktop`. La maquette tourne sur des données simulées ; tout ce qui est simulé est signalé.

## 1. Intention

L'Atelier actuel (une table par projet sur un sol quadrillé) devient un **étage de bureaux** en pixel art, vu de dessus :
chaque projet ou rig a son bureau, les agents y sont assis avec leur portable, se déplacent quand leur état change, se
reposent quand ils ont fini, se rendent visite et répondent aux demandes de Ledge dans son propre bureau. Le but reste
celui de l'Atelier : voir d'un coup d'œil qui travaille, qui attend une action et qui a fini. Il colle à la cible
OpenRig : les agents hors rig, les agents des rigs et Ledge sont visibles au même endroit.

## 2. Lancer et vérifier la maquette

Depuis `graphics-resources` (Python 3 avec Pillow et numpy dans `.venv`, le dépôt Ledge à côté) :

| Commande | Effet |
|---|---|
| `tools/ledge-bureaux.sh build` | Génère les images de jour (`img/`) et de nuit (`img-night/`) et `offices.json`, compile les mascottes depuis ce dépôt (`bots.<empreinte>.js`) et met à jour la page. |
| `tools/ledge-bureaux.sh serve` | Sert la maquette sur http://localhost:8765/. |
| `tools/ledge-bureaux.sh check` | Test Playwright : aucune erreur, aucune image cassée, Ledge présent, bots assis, marche et repos, bulles, visite, réunion chez Ledge, Projet / Rig / Open-space, nuit, zoom, déplacement, plein écran. Captures dans `web/ledge-bureaux/.check/`. |
| `tools/ledge-bureaux.sh files` | Liste les fichiers à publier, chemins relatifs à `web/ledge-bureaux/`. |

`LEDGE_REPO` désigne ce dépôt (par défaut `~/Workspace/harness-assistant`) : esbuild, React, Playwright et les mascottes
en viennent. Le bundle des mascottes est compilé depuis la branche `design/approved-logo-mascots`, modifications non
commitées comprises.

## 3. Ce que la maquette fixe

### 3.1 Le bâtiment

- **Ailes et couloirs.** Une aile = une rangée de bureaux au nord (porte au sud), un couloir, une rangée au sud (porte au
  nord). Quand les rangées sont pleines, une nouvelle aile s'ouvre sous la précédente. Un **couloir vertical** à l'ouest
  relie les couloirs ; l'**entrée** est sur la façade ouest, au premier couloir.
- **Fenêtres en façade seulement.** Rangée nord de la première aile et rangée sud de la dernière : fenêtres et lumière au
  sol. Les bureaux dos à dos à l'intérieur ont un mur plein (panneaux de feutre, cadre). Ouvrir une aile retire les
  fenêtres de l'ancienne dernière rangée sans déplacer ses bureaux.
- **Couloirs** : moquette anthracite, spots au plafond, porte-manteaux, bancs, fontaine, imprimante, tri, plantes.
  Pas de long tapis de passage.

### 3.2 Les pièces

| Pièce | Tailles | Places | Quand |
|---|---|---|---|
| Bureau de Ledge | une | Ledge + 2 fauteuils visiteurs | Toujours, en premier, près de l'entrée. |
| Salle technique OpenRig | une (144 px) | 4 baies, une par noyau | Dès qu'un noyau OpenRig existe, juste après Ledge. |
| Bureau de projet ou de rig | S, M, L (176, 208, 240 px) | 2, 4, 6 + 4 sous-agents en bout de table | Une équipe avec au moins une session. |
| Open-space « Sans projet » | o2, o4, o6 (208, 272, 320 px) | 4, 8, 12 + sous-agents | Les sessions hors projet et hors rig, à des îlots de bureaux séparés (2 × 2 postes, 1 × 2 dans le petit), répartis sur toute la largeur avec des allées égales (`islands` dans `offices.json`). Les bots passent par l'allée la plus proche pour rejoindre un poste de l'autre côté. |
| Salle de repos | rs, rm, rl (144, 272, 384 px) | 5, 9, 13 | Seulement si les zones de repos ne suffisent pas. |
| Zone de repos | salon, café, lecture, jeux (96 à 112 px) | 3 à 5 | Dans l'espace libre d'une rangée. |
| Petit coin | café, fauteuil, banquette, poufs (48 à 56 px) | 1 à 2 | Dans un espace libre trop étroit pour une zone. |

Au-delà de la capacité (6 pour un projet ou un rig, 12 pour l'open-space, 4 noyaux pour la salle technique), l'équipe
**ouvre une salle de plus** du même type (`roomsOf(p)` ; plaque « Website · 2 »). Les salles se remplissent dans l'ordre,
sans rééquilibrage, pour que personne ne change de place quand une session arrive. Il n'y a plus de badge « +N ».
Seules les sessions présentes comptent : une session terminée ou hors ligne libère sa place.

### 3.3 Le placement (fonction pure, à porter telle quelle)

Dans `index.html` : `layout(bw)` → `buildLayout(bw, rest)`, `planRest(need)`, `restDemand()`.

1. **Les bureaux d'abord** : Ledge, la salle technique, puis chaque salle de chaque équipe active dans la **première rangée où elle rentre** (first-fit).
   Les petits bureaux comblent les trous plutôt que de laisser de la place au repos.
2. **L'espace libre d'une rangée s'ouvre au milieu** : la moitié des bureaux à gauche, l'espace, l'autre moitié à droite.
3. **Les salles de repos ensuite, sans jamais déplacer un bureau** : dans un espace libre où elles rentrent, sinon dans
   une nouvelle rangée en fin d'étage. Le besoin compte les agents disponibles depuis 5 minutes et ceux qui sont encore au
   repos ou y vont ; on prend la plus petite salle qui suffit, puis on recommence.
4. **Les zones de repos remplissent ce qui reste** : grandes zones si la place le permet, petits coins sinon, types en
   rotation. Elles sont utilisées avant les salles de repos ; le placement est recalculé jusqu'à ce que tout le monde
   ait une place.

`bw` (la largeur de l'étage, en pixels du plan) vient de la largeur de la vue (§ 3.9).

### 3.4 Les sièges et les calques

Chaque variante de bureau existe en 3 images : **fond** (sol, murs, chaises du fond), **table**, **avant** (dossiers des
chaises du rang du bas). Empilement : fond → bots du rang du haut → table → portables → bots du rang du bas (vus de
dos) → dossiers → sous-agents en bout de table. Les coordonnées des sièges, de la table, de la porte et des places de
repos sont dans `offices.json`. Les sièges alternent haut / bas comme `layoutTable` aujourd'hui.

### 3.5 Les mascottes

- **Agents** : `LogoBot` avec `branded` (`packages/ui/src/preview/LogoBot.tsx`, approuvé sur
  `design/approved-logo-mascots`), matière galet le jour, Signal la nuit. Vue de dos pour le rang du bas : visage
  masqué (`.gaze`, `.shine`) et silhouette retournée.
- **Ledge** : `LedgeSketch`, palette `darkred`, **sans son rebord** (`.ls-wall`, `.ls-slab`, `.ls-accent-line` masqués),
  assis derrière son bureau, les mains sur le bord. Il s'appelle **« Ledge »**, sans autre titre ni bulle de veille.
- **Prérequis d'intégration** : `LogoBot` et `LedgeSketch` sont encore dans `preview/`. Ils doivent devenir les
  composants de `packages/ui/src/bots/` (remplacer `Bot`), ou la page de mascottes doit l'être avant.

### 3.6 Les états, en image

| État de la session (`botState`) | Bot | Portable | Badge |
|---|---|---|---|
| `working`, `starting` | assis, saut de travail | écran bleu (code) | — |
| `approval` | assis, halo rouge | bandeau rouge | « ! » |
| `question` | assis, halo jaune | bandeau jaune | « ? » |
| `idle` | assis, yeux plissés ; **part en pause après 5 min** sans relance | écran vert | — |
| `done` (exited) | **quitte l'étage** par l'entrée | — | — |
| hors ligne | **quitte l'étage** ; revient s'il se reconnecte | — | — |

La plaque de porte porte un voyant : l'état le plus urgent du bureau, clignotant pour une approbation ou une question.

### 3.7 Les déplacements

Les bots marchent le long des couloirs et passent les portes (`buildWorld` fournit les lieux et leurs chemins,
`route(a, b)` les relie par le couloir vertical) :

- **Arrivée** d'une session : de l'entrée à son siège ; le portable apparaît à l'arrivée.
- **Pause** (`idle` depuis 5 min, `IDLE_REST`) : bulle « Petite pause », puis de son siège à la première place libre au
  repos ; retour au siège dès qu'elle est relancée.
- **Fin, hors ligne ou fermeture** : du siège ou du repos vers l'entrée, puis le bot disparaît. Si sa salle ferme en
  même temps, il part de son ancien poste (`updatePresence` reçoit le monde précédent).
- **Visite** (nouvelle façon de communiquer) : un agent marche jusqu'au bureau d'un collègue, ils échangent trois
  bulles, il revient. Elle remplace la lettre animée de `MessageLayer`.
- **Demande de Ledge** : Ledge appelle un ou deux agents (« orch-lead, build : passez me voir. »), ils s'assoient dans ses
  fauteuils visiteurs, de dos, répondent chacun leur tour, puis repartent. Les agents nommés passent d'abord, sinon
  ceux du projet ou du rig cité.

Au chargement, chacun est déjà à sa place. Avec « réduire les animations », il n'y a aucune marche (visites et réunions
désactivées, changements de place immédiats).

### 3.8 Les bulles

Bulles pixel (9 tranches, queue, police Pixelify Sans, version de nuit), **texte seul, sans barre de progression**.
Avancement de temps en temps (« J'écris : … », « Tests : 9/14 au vert »), « ! J'ai besoin de ton accord », « ? »
suivi de la question. Au plus 3 à la fois, une par bureau, jamais par-dessus une conversation.

### 3.9 La vue

- **Résolution d'après l'écran** : un pixel du plan vaut 1 à 4 pixels écran (`round(largeur / 640)`), et l'étage est
  construit pour remplir la largeur de la vue. En plein écran, il se réorganise.
- **Navigation** : molette ou pincement (zoom sous le curseur, 20 à 400 %), glisser pour se déplacer, double-clic sur un
  bureau pour le cadrer, boutons −, %, +, Ajuster, Plein écran ; clavier + − 0 F et flèches quand le plan a le focus.
  Plein écran natif, sinon mode immersif.
- À rapprocher de `useAtelierView` (zoom, ajustement, Espace pour déplacer) : garder ses raccourcis existants.

### 3.10 Jour et nuit

Toutes les images existent de jour et de nuit (lumière bleutée, lampes et écrans comme sources, ciel étoilé, ville
illuminée, halos des spots du couloir). La nuit suit le thème de l'app (`data-theme`, sinon le système), avec un choix
Auto / Jour / Nuit. Les mascottes passent en matière Signal.

### 3.11 Couleurs

Murs graphite, têtes de mur gris foncé, parquet chêne chaud dans les bureaux, moquette anthracite dans les couloirs,
moquette grise claire en dalles dans l'open-space, touches de rouge Ledge (feutre, cloisons, liserés), plantes.
Pas de grille, de règles ni de cartouche de plan.

## 4. Correspondance avec les données de Ledge

| Maquette | Ledge |
|---|---|
| `project.kind = "project"` | `Project` de `@ledge/protocol` |
| `project.kind = "rig"` | Rig OpenRig (lots OpenRig) |
| `project.kind = "none"`, « Sans projet » | Sessions sans projet (`scene.unassigned`, zone « Sans projet » d'aujourd'hui) |
| `session.tool`, `state` | `Session.tool` (+ `omp`), `botState(session)` |
| `session.helpers` | `Session.helpers`, `helperState` |
| `session.task` | `taskOf(session)` |
| Avancement simulé (`progress`) | **À définir** : dernière étape ou dernier message de la session |
| Visite entre deux agents | Messages entre agents (`agent-messages`, `MessageLayer`) |
| Demande à Ledge | Questions de Ledge orchestrateur aux agents (brainstorm OpenRig, décision 1) |
| Plaque Projet / Rig / Open-space | Arbre de la barre latérale (Projets, Rigs) |

Ce qui reste propre à la page de maquette et ne part pas dans Ledge : le formulaire « Lancer une session » (Ledge a son
propre lancement), le sélecteur d'état, la simulation et le stockage `localStorage`.

## 5. Intégration, après les lots OpenRig

1. **Mascottes** : promouvoir `LogoBot` et `LedgeSketch` dans `packages/ui/src/bots/` (prérequis § 3.5).
2. **Ressources** : générer les images avec le script de `graphics-resources` et les ranger dans `apps/desktop`
   (`img/`, `img-night/`, `offices.json`), ou déplacer le générateur dans ce dépôt (`scripts/`). Environ 220 PNG utiles,
   ~2 Mo ; le générateur produit encore d'anciens sprites inutilisés (cafétéria fixe, tapis, comptoir d'accueil) à retirer.
3. **Placement** : porter `layout`, `buildLayout`, `planRest`, `restDemand` en TypeScript pur dans
   `apps/desktop/src/atelier/layout.ts`, avec des tests (`test/atelier-layout.test.ts`) : first-fit, espace au milieu,
   salle de repos qui ne déplace aucun bureau, zones avant salles, nouvelle aile.
4. **Monde et présences** : porter `buildWorld`, `route`, `updatePresence` et la marche (`walk`, `step`) dans un hook
   (`usePresence`), qui reçoit les sessions du daemon au lieu de la simulation.
5. **Composants** : `Floor` (bâtiment, couloirs, zones), `Room` (calques, plaque), `Seat` (bouton accessible, menu de
   session existant `useSessionMenu`), `Walker`, `Bubble`, `LedgeOffice`. Remplacent `ProjectTable`, `Plants`,
   `LedgeDesk`, `Unassigned` et `MessageLayer`.
6. **Vue** : fusionner la vue de la maquette dans `useAtelierView` (résolution d'après la largeur, zoom sous le
   curseur, plein écran), en gardant ses raccourcis et `J` / `K` pour parcourir les agents.
7. **Jour / nuit** : brancher sur `useTheme()`.
8. **Données réelles** : l'avancement des bulles, les visites sur les messages entre agents, les invitations sur les
   demandes de Ledge orchestrateur.

## 6. Questions ouvertes

- **Avancement des bulles** : quelle source réelle (dernier message, étape du hook, todo de l'agent) ?
- **Noyaux OpenRig** : quelle donnée représente un noyau (un daemon par machine ?) et quels états au-delà de
  « En marche » / « Arrêté » ?

Décisions prises le 2026-10-31 :

- **Terminée ou hors ligne** : la session quitte l'étage. **Disponible** : reste 5 minutes à son poste, puis part en
  pause si personne ne la relance.
- **Débordement** : au-delà de 12 sessions sans projet, un nouvel open-space s'ouvre ; même règle pour les projets et
  les rigs (6) et la salle technique (4 noyaux).
- **Salle technique** : une baie par noyau OpenRig, voyants verts qui clignotent en marche, rouges à l'arrêt ; nom du
  noyau au-dessus de la baie.
- **Performances** : au-delà de 40 bots (`PERF_LIMIT`, sous-agents compris), un bandeau prévient que l'animation peut
  ralentir et les déplacements deviennent instantanés. « Voir les salles à suivre » atténue les autres salles, met
  leurs animations en pause et cadre la vue sur Ledge et les salles qui attendent un accord ou une réponse (à défaut,
  celles qui travaillent, plus une salle technique avec un noyau arrêté).

## 7. Fichiers de la maquette

| Fichier (`graphics-resources`) | Rôle |
|---|---|
| `web/ledge-bureaux/index.html` | La page : placement, présences, marche, bulles, vue, panneau de contrôle (~1600 lignes). |
| `web/ledge-bureaux/offices.json` | Géométrie : variantes, sièges, tables, portes, places de repos, fauteuils de Ledge. |
| `web/ledge-bureaux/img/`, `img-night/` | Sprites de jour et de nuit. |
| `web/ledge-bureaux/src/bots-entry.tsx` | Point d'entrée du bundle des mascottes (`LogoBot`, `LedgeSketch`). |
| `tools/generate_ledge_offices.py` | Générateur des sprites (pièces, calques, zones, portables, bulles, nuit). |
| `tools/ledge-bureaux.sh`, `tools/check_ledge_bureaux.cjs` | Build, serveur, test, liste des fichiers. |
