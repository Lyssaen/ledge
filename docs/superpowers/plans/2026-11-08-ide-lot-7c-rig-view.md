# Refonte IDE, lot 7c : la vue Rig, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** derrière l'interrupteur « Interface IDE (aperçu) », un clic sur un rig ou sur le kernel dans la vue Rigs ouvre l'onglet « Rig · nom ». On y gère le rig :
- l'en-tête, avec ses boutons et la confirmation juste en dessous ;
- la topologie, avec les sièges grisés quand le rig est arrêté ;
- les réglages : la spec, les permissions, les sièges par rôle et le dernier snapshot ;
- la file OpenRig.

Le kernel a sa propre vue, sans réglages, avec « Parler à l'operator ». Dans un groupe étroit, la topologie et les réglages passent l'un sous l'autre.

**Ce qui existe déjà et ne se refait pas** (`origin/main` 20e17aed, lots 7a et 7b fusionnés) :
- les hooks du 7a (`packages/fleet/src/openrig.ts`), qui prennent tous `client` en premier :
  - `useRigGraph` → `{ status, graph, error?, reload }` ;
  - `useRigSnapshots` → `{ status, snapshots, error?, reload }`, du plus récent au plus ancien ;
  - `useRigPermissions` → `{ status, policy?, seats, error?, reload }` ;
  - `useRigQueue` → `{ status, rows, truncated, error?, reload }`, relu toutes les 15 s ;
  - `reseatRig(client, machine, rig, seats, delegation?)` et `useOpenRig(…).act`.
- les actions `rig.start`, `rig.stop`, `rig.restart`, `rig.snapshot` et `rig.permissions { rig, mode, seats }` ;
- les helpers du protocole `seatsByRole`, `seatPlan` et `roleOf` (`packages/protocol/src/openrig.ts:275-301`) ;
- la vue Rigs du 7b (`apps/desktop/src/ide/rigs/`) : `RigsView.tsx`, et dans `model.ts` `actionOf`, `confirmOf`, `powerOf` et la logique de pastille des sièges ;
- la confirmation en ligne de la vue Rigs (`confirmBox`, `closeConfirm`, `offered`), encore interne à `RigsView.tsx:49-113` ;
- `operatorOf(state, sessions, machine)` (`openrig/OpenRigPage.tsx:273`), qui trouve la session Ledge de l'operator ;
- `.ide-pane { container-type: inline-size }` (`styles/ide.css:245`) autour de chaque onglet.

**Ce qui manque :** aucun onglet de rig. Le type `'topology'` est déclaré dans `workspace/model.ts:11`, mais rien ne le dessine. Dans la vue Rigs, le clic sur un rig ouvre la page OpenRig (R1 du 7b). Il n'existe aucun dessin de topologie, aucune liste de file et aucun réglage de rig embarquable : `SeatsDialog` et `SeatSettings` sont des fenêtres modales.

**Architecture :**
- `ide/rig/model.ts` (pur) prépare ce que l'onglet montre : l'en-tête, la disposition de la topologie, les sièges par rôle et leur plan, le niveau de permission et les lignes de file.
- `ide/rig/RigTopology.tsx` dessine la topologie (HTML pour les nœuds, SVG pour les liens).
- `ide/rig/RigView.tsx` assemble l'en-tête, la topologie, les réglages et la file, ou la variante kernel.
- La confirmation de la vue Rigs devient un composant partagé, `ide/rigs/RigConfirm.tsx`.
- `workspace/model.ts` remplace `'topology'` par le type `rig` (réf. `<machine>:<rig>`). `App.tsx` et `ide/tabs.tsx` le dessinent et le titrent.

**Tech Stack :** React 19, TypeScript, vitest + Testing Library, Playwright.

**Spec :**
- [`docs/ide-workspace.md`](../../ide-workspace.md), section « OpenRig » : « Vue Rig » (l. 119-125) et « Confirmations » (l. 152).
- [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md), lot 7c et D6.
- Maquette [`docs/mockups/ledge-ide-rigs.html`](../../mockups/ledge-ide-rigs.html) :
  - `topoPage()` (l. 1505), `topoBox()` (l. 1490) et `orConfirm()` (l. 1289) ;
  - les styles `.rp-*`, `.blk*`, `.tnode`, `.topo-box`, `.rx-seg`, `.rx-kv`, `.step`, `.pill`.
- Décisions de l'utilisateur (PR #232) :
  - la permission d'un rig, c'est la politique de la spec plus le mode de chaque siège, et un changement vaut au prochain lancement ;
  - une commande affichée est toujours celle que Ledge lance.

## Global Constraints

- Branche `feat/ide-lot-7c` (worktree `../ledge-ide-lot-7c`), partie de `origin/main` 20e17aed. Une PR vers `main` (`Lyssaen/ledge`), seulement avec l'accord de l'utilisateur.
- Interrupteur coupé, l'interface actuelle est **inchangée**. `Sidebar`, `RigGroups`, `TopBar`, `OpenRigPage`, `SeatsDialog`, `SeatSettings` et leurs tests restent verts sans retouche.
- Le daemon (`packages/ledge`), le protocole (`packages/protocol`) et `packages/fleet` ne changent pas, sauf si l'utilisateur choisit l'option B de R2.
- Une commande montrée est toujours celle que Ledge lance (`commandsOf(action)`), jamais le texte de la maquette.
- Toute nouvelle vue IDE passe par le chunk paresseux de l'IDE (`ide/lazy.tsx`) : ses styles ne se chargent jamais interrupteur coupé.
- Textes en français et en anglais, sous `t.ide.rigTab`. On reprend les textes existants (`t.openrig.confirm.*`, `t.openrig.policy.*`, `t.ide.rigsView.*`, `o.talkToOperator`, `o.operatorNotYet`). Les textes nouveaux de la maquette sont cités mot pour mot.
- Couleurs par les jetons du thème (clair et sombre). Sélecteurs préfixés : `.ide-rig button`.
- Tout état absent de la maquette se demande à `design-ux`. On le note dans `docs/ide-lot-7c-questions.md`, on le reporte dans la PR, puis on supprime le fichier.
- Node 24 dans le shell des outils : `export PATH=$HOME/.local/share/nvm/v24.10.0/bin:$PATH`, `corepack pnpm`.
- Échecs connus sur main : vitest `omp-seats.test.tsx` (2), « reconnect asks Nova's thread again », `session-tab` « a tab hidden… » (instable) ; e2e `island:166`, `proposals:36`, `daemon-update:8`, `atelier:208/234`, `ide-terminals:61`.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jamais `apps/desktop/test-results/*.png`. Jamais `git stash` nu.

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | **L'onglet** est du type `rig`, de réf. `<machine>:<rig>` (le kernel : `<machine>:kernel`), et il remplace le type `'topology'` resté inutilisé. Titre « Rig · nom » ; l'infobulle donne la machine. Le clic sur un rig ou le kernel dans la vue Rigs l'ouvre (`Ctrl`+clic : à droite), et la ligne est surlignée tant que son onglet est actif. | — |
| R2 | **Les six niveaux de permission** (`Spec`, `Auto`, `Standard`, `Ouvert`, `YOLO`, `Verrouillé`). Le protocole du 7a n'écrit que les modes de siège : `Spec` → `inherit`, `Auto` → `auto`, `YOLO` → `full_bypass`. **Option A (recommandée pour 7c)** : ces trois-là sont actifs, et `Standard`, `Ouvert` et `Verrouillé` sont grisés, avec en infobulle « Pas encore réglable depuis Ledge ». **Option B** : une petite tâche côté daemon ajoute `rig.policy { rig, policy, seats }` → `rig policy apply <politique> --seat <siège> --reason Ledge`, et les six niveaux sont actifs (environ ½ jour de plus, et le protocole change). | A : trois niveaux grisés jusqu'à un lot suivant. B : un aller-retour daemon de plus dans ce lot. |
| R3 | **Le niveau affiché.** `Spec` est actif quand tous les sièges héritent (`selection === 'inherit'`). `Auto` ou `YOLO` est actif quand la posture de tous les sièges vaut `auto` ou `full_bypass`. Sinon, aucun segment n'est actif et une ligne dit « Mixte » avec le résumé de chaque siège. La politique de la spec s'affiche à côté (`Spec : builtin:auto`). Un changement vaut **au prochain lancement**, et la ligne le dit. Il n'y a pas de confirmation, comme dans la maquette. | Demander une confirmation. |
| R4 | **Sièges par rôle ±**, seulement quand le rig tourne. Les rôles sont des `pod.member` (`seatsByRole(rig.nodes)`). + et − modifient un **brouillon**, avec au moins 1 siège par rôle, comme dans la maquette. Une barre « Appliquer » montre alors le plan (`seatPlan` : sièges ajoutés, sièges retirés, ceux qui travaillent signalés) et envoie `reseatRig`. La maquette applique tout de suite, mais retirer un siège arrête sa session : on demande donc d'appliquer. | Appliquer à chaque clic, comme la maquette. |
| R5 | **La topologie**, à partir de `useRigGraph` :<br>- une colonne par pod, dans l'ordre du graphe, avec le libellé du pod en tête ; les sièges empilés dans leur colonne ;<br>- les liens en courbes SVG fléchées, selon leur type : `delegates_to` plein, `escalates_to` tirets, `collaborates_with` pointillé, avec une petite légende ;<br>- un nœud montre la pastille (la session Ledge jointe, comme `seatLine` du 7b), le logo du harnais, le nom (de la session, sinon le `logicalId`) et le rôle en petit ;<br>- un clic ouvre le fil (`openClick`, `Ctrl`+clic à droite) ; un siège sans session n'est pas cliquable ;<br>- un rig arrêté a tous ses nœuds grisés (`.off`).<br>La maquette place ses nœuds à la main ; le protocole donne des pods et des liens typés, d'où cette disposition. | Une autre disposition : seule `layoutOf` change. |
| R6 | **Le fichier de spec** : `Rig.specPath` quand Ledge le connaît, sinon « Spec inconnue : rig lancé hors de Ledge ». Le chemin de la maquette (`~/.openrig/rigs/X.yaml`) n'existe pas. | — |
| R7 | **Dernier snapshot** : la date du premier de `useRigSnapshots`, en heure locale. « Snapshot maintenant » (seulement quand le rig tourne) envoie `rig.snapshot`, puis relit la liste. Sans snapshot : « Aucun snapshot ». | — |
| R8 | **File OpenRig** : les lignes de `useRigQueue`. Chacune montre la pastille d'état (en attente, en cours, bloquée), un « ! » quand `needsInput`, le résumé (sinon l'id court), « de → à » avec les noms Ledge des sièges quand on les connaît, et l'ancienneté. La section est cachée quand il n'y a aucune ligne, comme dans la maquette. `truncated` ajoute « Les plus anciennes ne sont pas montrées ». | Une note « Aucune ligne ouverte ». |
| R9 | **La vue du kernel** : l'en-tête, la topologie, et le bloc « Rôle » avec le texte de la maquette mot pour mot. Puis « Parler à l'operator », qui ouvre la session de l'operator (`operatorOf`). Le bouton est désactivé, avec `o.operatorNotYet` en infobulle, tant que Ledge ne suit pas cette session. Pas de réglages ni de file. | — |
| R10 | **La confirmation** de l'en-tête est la même que celle de la vue Rigs, extraite en `RigConfirm` + `useRigConfirm`. On garde l'Échap local, le retour du focus et la fermeture quand l'action n'est plus offerte. | — |
| R11 | **Les relectures** : le graphe, les permissions et les snapshots ne sont pas relus en boucle. Ils sont relus quand l'état du rig change (statut, nombre de sièges, `useOpenRig` toutes les 5 s pendant que l'onglet est affiché) et après une action de la vue. | Un rythme fixe. |
| R12 | **Un rig qui n'existe plus** sur la machine, ou une machine hors ligne : l'onglet le dit (textes existants) et reste fermable. La question part à `design-ux`. | — |

## Review Focus

1. **Le rig s'arrête ou disparaît pendant que l'onglet est ouvert.** La topologie se grise, les ± et « Snapshot maintenant » disparaissent, et la confirmation se ferme. Aucun bouton n'envoie une action devenue sans objet. *(Task 4.)*
2. **Un brouillon de ± existe quand l'état change** (un siège ajouté ailleurs, ou le rig redémarré). Le brouillon repart de l'état réel. Il n'envoie jamais un plan calculé sur d'anciens sièges. *(Task 1 : `seatDraft` ; Task 4.)*
3. **Un gros rig** (7 sièges et plus, factory) **dans un groupe étroit.** La topologie défile horizontalement dans son bloc sans déborder du groupe, et les réglages passent dessous. *(Task 3 ; e2e, Task 5.)*
4. **Un lien qui nomme un siège absent du graphe** (une donnée partielle d'OpenRig). Il est ignoré, sans rien casser. *(Task 1 : `layoutOf`.)*
5. **Un onglet Rig restauré au démarrage** (disposition enregistrée) avant que la machine réponde. Il montre le chargement, puis le rig, sans erreur, et la désérialisation accepte le type `rig`. *(Task 5.)*

---

### Task 1 : le modèle de l'onglet

**Files :**
- Create : `apps/desktop/src/ide/rig/model.ts`
- Test : `apps/desktop/test/ide/rig-model.test.ts`

**Interfaces :**
- Consomme : `RigGraph`, `RigSeatPermission`, `RigRow`, `RigSnapshot`, `Rig`, `Session`, `seatsByRole`, `seatPlan` (`@ledge/protocol`) ; la pastille d'un siège du 7b (exporter `seatDot(session, node)` depuis `ide/rigs/model.ts` si elle n'y est pas déjà, au lieu de la recopier).
- Produit :
  - `rigTabRef(machine: string, rig: string): string` et `parseRigRef(ref: string): { machine: string; rig: string } | null` (coupure au premier `:`)
  - `interface TopoNode { logicalId: string; pod: string; name: string; role?: string; runtime: string; dot: RigDot; session?: Session; x: number; y: number }`
  - `interface TopoEdge { from: string; to: string; kind: string; path: string }` (un `d` de chemin SVG)
  - `layoutOf(graph: RigGraph, sessions: readonly Session[], machine: string, running: boolean): { nodes: TopoNode[]; edges: TopoEdge[]; pods: { id: string; label: string; x: number }[]; width: number; height: number }`
  - `type PermLevel = 'spec' | 'auto' | 'standard' | 'open' | 'yolo' | 'locked'` et `PERM_LEVELS: readonly PermLevel[]` dans l'ordre de la maquette
  - `writableMode(level: PermLevel): SeatPermissions | null` (`spec` → `inherit`, `auto` → `auto`, `yolo` → `full_bypass`, les autres → `null` en option A)
  - `permLevelOf(seats: readonly RigSeatPermission[]): PermLevel | 'mixed' | null` (R3 ; `null` sans siège)
  - `interface RoleCount { role: string; runtime: string; count: number }`
  - `roleCounts(rig: Rig): RoleCount[]`
  - `seatDraft(counts: readonly RoleCount[], draft: Readonly<Record<string, number>>): { seats: Record<string, number>; changed: boolean }` (les rôles absents de `counts` sont retirés du brouillon ; le minimum est 1)
  - `interface QueueLine { id: string; state: string; needsInput: boolean; summary: string; from: string; to: string; age: string }`
  - `queueLines(rows: readonly RigRow[], sessions: readonly Session[], machine: string, now: number): QueueLine[]`

- [ ] **Step 1 : écrire les tests qui échouent**, sur la fixture du graphe `ledge-survey` (`apps/desktop/e2e/openrig-fixtures.ts`, `RIG_7A`) et sur un graphe kernel écrit dans le test (pods `advisor`, `operator`, `queue` ; liens `advisor.lead → operator.agent delegates_to` et `operator.agent → operator.human escalates_to`).
  - `parseRigRef('srv:ledge-dev')` → `{ machine: 'srv', rig: 'ledge-dev' }` ; `parseRigRef('nocolon')` → `null` ; `rigTabRef('local','kernel') === 'local:kernel'`.
  - `layoutOf` :
    - une colonne par pod : les nœuds d'un même pod ont le même `x`, et les pods sont en ordre croissant de `x` ;
    - un nœud par siège ; un lien par `link` dont les deux bouts existent ;
    - un lien vers `ghost.seat` est ignoré (Review Focus 4) ;
    - `running: false` → tous les `dot` valent `'off'` ;
    - un siège joint prend le nom de sa session ;
    - `width` et `height` contiennent tous les nœuds.
  - `writableMode('standard') === null`, `writableMode('yolo') === 'full_bypass'`.
  - `permLevelOf` :
    - tous les sièges `selection: 'inherit'` → `'spec'` ;
    - tous `posture: 'full_bypass'` → `'yolo'` ;
    - un siège `auto` et un siège `inherit` → `'mixed'` ;
    - `[]` → `null`.
  - `roleCounts` sur un rig dont les nœuds sont `dev.build`, `dev.build-2` et `dev.review` → `[{ role: 'dev.build', count: 2, … }, { role: 'dev.review', count: 1, … }]`.
  - `seatDraft` :
    - un brouillon `{ 'dev.build': 0 }` est ramené à 1 ;
    - un rôle disparu de `counts` est retiré (Review Focus 2) ;
    - `changed` est faux quand le brouillon égale l'état.
  - `queueLines` : une ligne avec `needsInput: { count: 1 }` → `needsInput: true` ; un `to` joint à une session prend son nom ; `age` vaut « 5 min » pour une ligne mise à jour 5 minutes avant `now`.
- [ ] **Step 2 : lancer `corepack pnpm --filter desktop exec vitest run test/ide/rig-model.test.ts`.** Attendu : FAIL.
- [ ] **Step 3 : implémenter `model.ts`.**
  - Disposition : colonne de pod de 180 px, nœud de 150 × 44, 28 px entre nœuds, 40 px de marge.
  - Le `path` d'un lien : une courbe de Bézier cubique du bord droit de la source au bord gauche de la cible (ou du bas vers le haut dans un même pod).
  - Pour l'âge, réutiliser une fonction relative existante si `apps/desktop/src` en a une (chercher « il y a » ou `relative`), sinon des minutes, heures et jours simples, avec les textes `t.ide.rigTab.age`.
- [ ] **Step 4 : relancer.** Attendu : PASS.
- [ ] **Step 5 : commit** `feat(desktop): the Rig tab's model (ref, topology layout, permission level, seats draft, queue lines)`.

### Task 2 : la confirmation partagée

**Files :**
- Create : `apps/desktop/src/ide/rigs/RigConfirm.tsx`
- Modify : `apps/desktop/src/ide/rigs/RigsView.tsx` (utilise `RigConfirm` et `useRigConfirm`, sans changer de comportement)
- Test : `apps/desktop/test/ide/rigs-view.test.tsx` doit rester vert **sans retouche**, plus `apps/desktop/test/ide/rig-confirm.test.tsx`

**Interfaces :**
- Produit :
  - `useRigConfirm(view: OpenRigView, offered: (action: OpenRigAction) => boolean): { confirm: OpenRigAction | null; ask(action: OpenRigAction, opener: HTMLElement | null): void; run(action: OpenRigAction): void; close(): void }`. `ask` ouvre la confirmation pour un arrêt ou un redémarrage, et lance tout de suite un démarrage. La confirmation se ferme quand `offered` devient faux. Le focus revient à l'élément d'ouverture.
  - `RigConfirm(props: { action: OpenRigAction; state: OpenRigState; sessions: readonly Session[]; machine: string; label: string; onConfirm(): void; onCancel(): void }): JSX.Element` : la boîte actuelle (`.ide-rigs-conf`), Échap local, `autoFocus` sur Annuler.

- [ ] **Step 1 : écrire `rig-confirm.test.tsx`.** Rendu seul : le titre, les sièges qui travaillent, la commande `rig down ledge-dev` ; Échap appelle `onCancel` et n'atteint pas `window` ; « Confirmer l'arrêt » appelle `onConfirm`.
- [ ] **Step 2 : lancer-le.** Attendu : FAIL.
- [ ] **Step 3 : extraire de `RigsView.tsx:49-113`** vers `RigConfirm.tsx`. Déplacer les classes CSS de la confirmation dans un bloc partagé de `ide-rigs.css`, utilisable hors de `.ide-rigs`.
- [ ] **Step 4 : lancer `rig-confirm.test.tsx` et `rigs-view.test.tsx`.** Attendu : tout passe, `rigs-view` sans modification.
- [ ] **Step 5 : commit** `refactor(desktop): the Rigs confirmation becomes RigConfirm and useRigConfirm, shared with the Rig tab`.

### Task 3 : la topologie

**Files :**
- Create : `apps/desktop/src/ide/rig/RigTopology.tsx`, `apps/desktop/src/styles/ide-rig.css`
- Test : `apps/desktop/test/ide/rig-topology.test.tsx`

**Interfaces :**
- Consomme : `layoutOf` (Task 1) ; `openClick`, `NavAction` ; `ProviderLogo`, `providerOf`.
- Produit : `RigTopology(props: { graph: RigGraph | null; status: 'idle' | 'loading' | 'ready'; error?: string; sessions: readonly Session[]; machine: string; running: boolean; dispatch(a: NavAction): void }): JSX.Element`

Le dessin :
- `.ide-rig-topo` défile horizontalement (`overflow-x: auto`) ;
- un `<svg>` absolu de `width × height` contient les liens, avec un `<marker>` fléché ;
- les nœuds sont des `<button>` absolus quand un siège a sa session, et des `<div>` grisés sinon ;
- la légende des trois types de lien est sous le dessin ;
- l'en-tête du bloc est `<b>Topologie</b>`, avec en sous-titre « clic sur un siège : son fil » quand le rig tourne et « les sièges démarrent avec le rig » sinon (textes de la maquette) ;
- chargement : « Lecture… », et sur erreur, le texte d'erreur existant de la page OpenRig.

- [ ] **Step 1 : écrire les tests.**
  - Avec le graphe `ledge-survey` : 2 nœuds, 1 chemin `path` portant le `marker`, et la légende.
  - Un clic sur un nœud joint donne `dispatch(openClick(id, e))`, et `Ctrl`+clic donne `where: 'right'`.
  - Un nœud non joint n'est pas un bouton.
  - `running: false` : les nœuds ont `.off`, et le sous-titre devient « les sièges démarrent avec le rig ».
  - `status: 'loading'` montre « Lecture… ».
- [ ] **Step 2 : lancer `corepack pnpm --filter desktop exec vitest run test/ide/rig-topology.test.tsx`.** Attendu : FAIL.
- [ ] **Step 3 : implémenter `RigTopology.tsx` et ses styles dans `ide-rig.css`.** Couleurs des liens par jetons ; `.off { opacity: .45 }`, comme `.tnode.off` dans la maquette.
- [ ] **Step 4 : relancer.** Attendu : PASS.
- [ ] **Step 5 : commit** `feat(desktop): the Rig tab's topology (pods in columns, typed links, seats open their thread)`.

### Task 4 : l'onglet Rig

**Files :**
- Create : `apps/desktop/src/ide/rig/RigView.tsx`, `apps/desktop/src/ide/rig/RigSettings.tsx`, `apps/desktop/src/ide/rig/RigQueue.tsx`
- Modify : `apps/desktop/src/styles/ide-rig.css`, `apps/desktop/src/i18n/fr.ts`, `apps/desktop/src/i18n/en.ts` (`t.ide.rigTab`)
- Test : `apps/desktop/test/ide/rig-view.test.tsx`

**Interfaces :**
- Consomme : les Tasks 1 à 3 ; `useOpenRig` (5 s), `useRigGraph`, `useRigSnapshots`, `useRigPermissions`, `useRigQueue`, `reseatRig` ; `operatorOf` (exporté depuis `OpenRigPage.tsx` s'il ne l'est pas ; sinon, le déplacer dans `openrig/model.ts` sans changer son comportement).
- Produit : `RigView(props: { client: DaemonClient; machines: readonly MachineState[]; sessions: readonly Session[]; machine: string; rig: string; dispatch(a: NavAction): void }): JSX.Element`

La page `.ide-rig` :
- **L'en-tête `.ide-rig-head`** :
  - la pastille, `<h3>` avec le nom, la pastille de statut « en marche » / « arrêté », et « N sièges · machine » ;
  - à droite : « Redémarrer » et « Arrêter », ou « Démarrer », ou « le daemon est arrêté » (textes de la maquette) ;
  - la `RigConfirm` juste en dessous (R10).
- **La grille `.ide-rig-grid`** (`repeat(auto-fit, minmax(340px, 1fr))`) contient la topologie, puis à côté les réglages (`RigSettings`) et la file (`RigQueue`).
- **`RigSettings`** (R2, R3, R4, R6, R7) :
  - `<b>Réglages</b>` et le fichier de spec ;
  - « Permissions », avec le segment des six niveaux (`t.openrig.policy.*` ; « Spec » est nouveau), le niveau courant, la ligne « au prochain lancement », et la ligne Mixte le cas échéant ;
  - « Sièges par rôle », avec les rangées ± et la barre « Appliquer » avec son plan ; quand le rig est arrêté, le compte seul et « · modifiables quand le rig tourne » ;
  - « Dernier snapshot » et « Snapshot maintenant ».
- **`RigQueue`** (R8).
- **La variante kernel** (R9) : l'en-tête, la topologie et le bloc « Rôle », avec son texte et « Parler à l'operator ».

- [ ] **Step 1 : écrire les tests**, avec le faux client (`test/openrig-page.test.tsx:12-16`) qui répond `openrig.state`, `openrig.graphState`, `openrig.permissionList`, `openrig.snapshotList` et `openrig.queueState`.
  - **En-tête** : `ledge-dev` en marche affiche « en marche », « 2 sièges · Local », « Redémarrer » et « Arrêter ». « Arrêter » ouvre la confirmation sous l'en-tête, avec `rig down ledge-dev`, et Confirmer envoie `rig.stop`.
  - **Permissions** :
    - « YOLO » envoie `openrig.act { kind: 'rig.permissions', rig: 'ledge-dev', mode: 'full_bypass', seats: [les 2 sièges] }`, puis relit les permissions ;
    - « Standard » est désactivé, avec son infobulle (option A) ;
    - des sièges mixtes affichent « Mixte ».
  - **Sièges par rôle** :
    - + sur `dev.build` montre « Appliquer » et le plan (un siège ajouté) ;
    - « Appliquer » envoie `openrig.seats { rig: 'ledge-dev', seats: { 'dev.build': 2, 'dev.review': 1 } }` ;
    - − ne descend pas sous 1.
  - **Snapshot** : « Snapshot maintenant » envoie `rig.snapshot`, puis relit la liste. Le dernier snapshot s'affiche en heure locale.
  - **File** : une ligne avec `needsInput` montre « ! ». Sans ligne, pas de section.
  - **Rig arrêté** (Review Focus 1) : une confirmation ouverte se ferme ; ni ± ni « Snapshot maintenant » ; « Démarrer » est présent.
  - **Brouillon** (Review Focus 2) : un brouillon en cours, puis un état où `dev.build` compte 3 sièges → le brouillon repart de 3.
  - **Kernel** : le bloc « Rôle », sans « Réglages ». « Parler à l'operator » ouvre la session de l'operator, et il est désactivé quand elle n'est pas suivie.
  - **Rig absent** de l'état : le texte de R12, sans action.
- [ ] **Step 2 : lancer `corepack pnpm --filter desktop exec vitest run test/ide/rig-view.test.tsx`.** Attendu : FAIL.
- [ ] **Step 3 : implémenter `RigView.tsx`, `RigSettings.tsx`, `RigQueue.tsx`, les styles et les textes fr/en.** Les relectures suivent R11. Les états absents vont dans `docs/ide-lot-7c-questions.md`.
- [ ] **Step 4 : relancer, puis `corepack pnpm --filter desktop typecheck`.** Attendu : PASS et aucune erreur.
- [ ] **Step 5 : commit** `feat(desktop): the Rig tab (header and confirmation, settings, seats per role, snapshot, queue, the kernel's view)`.

### Task 5 : le branchement dans l'IDE

**Files :**
- Modify :
  - `apps/desktop/src/workspace/model.ts` (`TabKind` : `'topology'` → `'rig'`, et la liste de `deserialize`, l. ~351) ;
  - `apps/desktop/src/workspace/store.ts` (`rigTab(machine, rig): Tab`) ;
  - `apps/desktop/src/ide/tabs.tsx` (titre « Rig · nom », infobulle de la machine) ;
  - `apps/desktop/src/App.tsx` (le corps de l'onglet `rig`, l. ~717-767) ;
  - `apps/desktop/src/ide/lazy.tsx` et `apps/desktop/src/ide/IdeFrame.tsx` (exporter `RigView` par le chunk) ;
  - `apps/desktop/src/ide/rigs/RigsView.tsx` (le clic sur un rig ou le kernel ouvre `rigTab`, `Ctrl`+clic à droite ; la ligne est `sel` quand son onglet est actif) ;
  - `apps/desktop/e2e/daemon.ts` si une réponse manque.
- Test : `apps/desktop/test/ide/rigs-view.test.tsx` (le test du clic sur un rig change d'attendu), `apps/desktop/test/workspace-model.test.ts` (ou le fichier existant qui couvre `deserialize`), `apps/desktop/e2e/ide-rig.spec.ts`

**Interfaces :**
- Consomme : `RigView` (Task 4), `rigTabRef` et `parseRigRef` (Task 1).
- Produit : `rigTab(machine: string, rig: string): Tab` (`{ kind: 'rig', ref: rigTabRef(machine, rig) }`).

- [ ] **Step 1 : écrire les tests qui échouent.**
  - `deserialize` garde un onglet `{ kind: 'rig', ref: 'local:ledge-dev' }` (Review Focus 5).
  - Dans `rigs-view.test.tsx` : un clic sur `ledge-dev` donne `onTab(rigTab('local','ledge-dev'))` ; `Ctrl`+clic l'ouvre à droite ; avec `activeTab = rigTab('local','ledge-dev')`, la ligne a `sel`.
  - `ide-rig.spec.ts` (`fakeDaemon` avec `openrig`, `rigGraphs`, `rigSnapshots`, `rigPermissions` et `rigQueues` de `RIG_7A`, avec `openrigRig: true` dans `extras.daemon`) :
    - Rigs → clic sur le rig → l'onglet « Rig · ledge-survey » montre l'en-tête, la topologie (nœuds et liens), les réglages et la file ;
    - « Arrêter » ouvre la confirmation sous l'en-tête ;
    - le kernel affiche « Parler à l'operator » ;
    - à 480 px de large, les réglages passent sous la topologie, et la topologie défile sans déborder du groupe (Review Focus 3) ;
    - après un rechargement, l'onglet restauré se dessine (Review Focus 5) ;
    - l'interrupteur coupé ne montre rien de nouveau.
- [ ] **Step 2 : lancer-les.** Attendu : FAIL.
- [ ] **Step 3 : implémenter.**
  - Le corps de l'onglet : `parseRigRef(tab.ref)`. Sans réf. valide, le texte de R12.
  - Le titre : `t.ide.rigTab.title(rig)`.
- [ ] **Step 4 : lancer la suite desktop (vitest + typecheck), puis les e2e `ide-*.spec.ts` avec `--workers=2`.** Attendu : verts, hors échecs connus.
- [ ] **Step 5 : commit** `feat(desktop): « Rig · nom » tabs open from the Rigs view and survive a reload`.

### Task 6 : relecture, questions, PR

- [ ] Relecture finale de la branche (superpowers:requesting-code-review).
- [ ] Reporter `docs/ide-lot-7c-questions.md` dans la description de la PR (section repliable), puis supprimer le fichier.
- [ ] PR vers `main` avec l'accord de l'utilisateur. Elle liste R1 à R12, les tests et ce qui n'est pas testé (Tauri).
