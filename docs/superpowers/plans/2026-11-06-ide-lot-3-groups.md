# Refonte IDE, lot 3 : les groupes, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ce lot complète l'interface IDE, derrière l'interrupteur « Interface IDE (aperçu) » :
- diviser (`Ctrl+\`), avec un groupe vide qui fait des propositions ;
- glisser un onglet vers un autre groupe ou vers une nouvelle colonne, sans qu'il perde son état ;
- une largeur minimale par groupe, et le défilement horizontal de la zone d'édition ;
- les groupes liés, avec le carré de couleur ;
- le terminal d'un agent dans son propre onglet, avec plusieurs écrans d'agent à la fois ;
- le menu clic droit de l'explorateur, et `Ctrl`+clic pour ouvrir à droite ;
- Réglages › Espace de travail, avec « Ouvrir une session ».

Le nouveau logo de Ledge remplace le robot comme icône du produit, partout.

**Architecture :** le modèle (`workspace/model.ts`) sait déjà diviser (`split`), déplacer (`move`), lier (`cycleLink`) et suivre la session (`follow`). Le lot les branche à l'écran.

- **`DockHost`** dessine les groupes vides. Il déplace un panneau sans le recréer : le panneau garde son contenu React. Il traduit le glisser de dockview en `move`.
- **`TermStore`** passe d'un seul écran d'agent à un écran par session. Chaque session a son rattachement, ses reconnexions et son état hors ligne. La même session ne s'affiche que dans une seule vue à la fois. Si elle est montrée à deux endroits, l'autre vue l'indique et propose de la ramener (R2).
- Un onglet `terminal:agent:<id>` rend l'écran de l'agent seul.
- Interrupteur coupé, l'interface actuelle ne change pas. Seule exception, le logo : le nouveau signe est l'identité du produit. Il remplace l'icône de l'app et, dans les deux barres de titre, se place devant « Ledge ».

**Tech Stack:** React 19, TypeScript, `dockview-react` 8.6.1 (jamais `dockview-core` en import), Tauri 2, vitest + Testing Library, Playwright.

**Spec:**
- [`docs/ide-workspace.md`](../../ide-workspace.md) : « Onglets et groupes », « Terminaux » (les quatre sortes), « Réglages », « Raccourcis ».
- [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md) : lot 3.
- Le prototype [`docs/mockups/ledge-ide-interactive.html`](../../mockups/ledge-ide-interactive.html) (v26), qui fait foi pour l'aspect :
  - fonctions `groupHtml()`, `emptyGroup()`, `menuHtml()` (`ctx`, `tabctx`), `doSplit()`, `openBeside()`, `settingsPage()`, `ledgeMark()` ;
  - gestion du glisser `dragstart` / `dragover` / `drop` (lignes ~1498-1517) ;
  - CSS `.lkbtn`, `.lk`, `.dropnew`, `.grow-row>.pane{min-width:300px}`, `.empty .go`.

## Global Constraints

- Branche `feat/ide-lot-3`, partie de `main` (4e422cbd, lot 2 fusionné). Une PR vers `main`, seulement avec l'accord de l'utilisateur.
- Interrupteur coupé, l'interface actuelle est inchangée. Les tests et e2e existants restent verts sans retouche. Seule exception : le logo (tâche 7), dont les tests sont mis à jour.
- Échecs déjà présents sur `main` : e2e `island.spec.ts:166`, `proposals.spec.ts:36` ; vitest « reconnect asks Nova's thread again ».
- `dockview-react` 8.6.1 seulement.
- Textes en français et en anglais sous `ide` (et `settings` pour la section). Le français reprend la maquette.
- Tout état absent de la maquette se demande à `design-ux`. On le note dans `docs/ide-lot-3-questions.md`, qu'on supprime avant la PR après l'avoir reporté.
- Node 22. Tests : `pnpm --filter desktop test`, `typecheck`, `e2e`.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Hors lot 3 :
  - « Ouvrir dans une nouvelle fenêtre » et le choix « Nouvelle fenêtre » du réglage (lot 9) : **masqués** ;
  - « Ouvrir dans… l'éditeur » (lot 11) : **masqué** ;
  - « Redémarrer le siège… » (lot 7, R4) : **masqué** ;
  - les terminaux du panneau du bas, la sortie et le glisser vers le panneau (lot 5) ;
  - « Au démarrage », les dispositions, la barre d'état, « Ouvrir dans… » et les terminaux WebGL dans Espace de travail (lots 6, 10, 11).

## Choix de l'utilisateur (2026-11-06)

1. Le nouveau logo de Ledge va **partout** : la barre de titre, l'icône de l'app Windows (exe, installeur, barre des tâches), la zone de notification, le favicon, la PWA du téléphone et le profil Windows Terminal. Le robot reste la mascotte de l'atelier et de l'encoche.
2. **Plusieurs écrans d'agent** à la fois : `TermStore` évolue.
3. **Réglages › Espace de travail** est créée dès le lot 3, avec « Ouvrir une session » seulement.
4. Les entrées des lots suivants sont **masquées**.

## Rulings (à valider)

| # | Choix | Si c'est faux |
|---|---|---|
| R1 | Le logo est le `ledgeMark()` de la maquette (carré noir arrondi, L blanc, point rouge). La version 64×64 sert aux grandes tailles, la version 16×16 aux petites (tray, 16/32 px, favicon). | On remplace la source SVG et on régénère. |
| R2 | Deux sessions différentes s'affichent côte à côte. La **même** session ne s'affiche qu'à un endroit à la fois : le daemon n'a qu'une surveillance par session, et les tailles se disputeraient. La vue qui a le focus la prend. L'autre affiche « Terminal affiché dans l'autre groupe » avec « Afficher ici » (question pour `design-ux`). | Il faudrait un compteur de surveillances côté daemon (`term.watch` / `unwatch`), en back-end. |
| R3 | Le terminal d'un siège ouvert depuis l'explorateur s'intitule « Capture dans un terminal » et se lit seulement, comme le prévoit la spec (« lecture seule : la capture d'un siège »). | Une option à retirer. |
| R4 | « Envoyer un message… » ouvre le siège, réponse en focus. « Redémarrer le siège… » attend le lot 7 : il n'existe pas d'action de redémarrage par siège. | Une entrée de plus au lot 7. |
| R5 | Le réglage « Ouvrir une session » vaut pour un clic dans l'explorateur, l'atelier, la palette et l'encoche. `Ctrl`+clic ouvre toujours à droite. « Terminal » (menus, chat) garde son comportement du lot 2 : la vue terminal de l'onglet de la session. | Une ligne dans `routeNav`. |
| R6 | La largeur minimale d'un groupe est de 300 px, comme dans la maquette (`.grow-row>.pane`). | Une constante. |

## Review Focus

1. **Deux sessions en terminal côte à côte, puis le focus qui passe de l'une à l'autre.** Les deux écrans restent attachés et vivants. Une mise à jour du daemon ne fait reconnecter aucun des deux.
2. **Un onglet glissé vers un autre groupe.** Il garde son fil, sa position de défilement et son brouillon, sans être recréé. Un groupe vidé disparaît, sauf le dernier de la fenêtre.
3. **Diviser depuis un groupe dont l'onglet en tête n'est pas une session** (l'atelier, les réglages). Le groupe vide ne propose pas « Terminal · X ».
4. **Lier puis délier un groupe pendant que son onglet en tête est un onglet Modifications.** Il suit la session tant qu'il est lié, et s'arrête dès qu'il ne l'est plus.
5. **La fenêtre étroite avec quatre groupes.** Chaque groupe garde 300 px, la zone défile à l'horizontale, et aucun onglet n'est inaccessible.

---

### Task 1 : Les règles pures du lot

**Files:** Modify `src/workspace/model.ts`, `src/workspace/route.ts`, `src/nav/state.ts`. Create `src/workspace/openPrefs.ts`. Tests `test/workspace/model.test.ts`, `test/workspace/route.test.ts`, `test/workspace/openPrefs.test.ts`.

**Interfaces — Produces :**
```ts
// nav/state.ts : la NavAction 'open' reçoit `where?: 'active' | 'right'` (ignoré hors IDE)
// openPrefs.ts : « Ouvrir une session » (ledge.ide.openSession), 'active' par défaut, valeur illisible → 'active'
export type OpenSession = 'active' | 'right';
export function loadOpenSession(): OpenSession; export function saveOpenSession(v: OpenSession): void;
export function useOpenSession(): [OpenSession, (v: OpenSession) => void];
// route.ts : routeNav(a, ctx & { openSession: OpenSession }) → open(w, tab, a.where ?? ctx.openSession)
// model.ts
export function emptyProposals(w: Workspace, groupId: string): { terminalOf: string | null }; // la session quittée (group.from), si elle existe encore dans un onglet ou dans ctx
export function moveTo(w: Workspace, key: string, to: { group: string; index?: number } | { rightOf: string }): Workspace; // move, avec la position d'arrivée
```
- [ ] **Tests qui échouent :**
  - `routeNav` : `open` sans `where`, avec `openSession: 'right'` → un nouveau groupe à droite, et l'onglet y est actif. Avec `where: 'active'` → le groupe actif, quel que soit le réglage. Un onglet déjà ouvert → mis en avant, jamais dupliqué.
  - `openPrefs` : rien de stocké → `'active'` ; `'window'` ou `'x'` stockés → `'active'` (le choix « Nouvelle fenêtre » est masqué jusqu'au lot 9).
  - `moveTo` : vers l'index 0 d'un autre groupe → l'onglet y est en tête et actif. Le groupe source vidé disparaît, sauf s'il est le dernier de MAIN. `{rightOf}` → un groupe neuf juste à droite.
  - `split` puis `emptyProposals` : depuis une session → `terminalOf` = son id. Depuis l'atelier → `null` (Review Focus 3).
  - Review Focus 4 : `cycleLink` sur un groupe en tête Modifications lié, une autre session activée dans le groupe source → le groupe suit. On relance `cycleLink` jusqu'à `null`, puis on active une autre session → il ne suit plus.
- [ ] Implémenter, PASS, commit `feat(desktop): the IDE lot 3 rules — open where the setting says, move to a place, the empty group's proposals`.

### Task 2 : Un écran d'agent par session (`TermStore`)

**Files:** Modify `src/term/store.ts`, `src/session/AgentView.tsx`, `src/session/Workspace.tsx`, `src/session/agentFocus.ts`, `src/App.tsx`. Tests `test/term-store.test.ts`, `test/agent-view.test.tsx`, `test/ide/session-tab.test.tsx`.

**Interfaces — Produces :**
```ts
// store.ts : l'état d'un écran par session
showAgent(sessionId: string, mode: AgentMode, viewer?: string): void; // viewer : la vue qui le montre (clé d'onglet), 'page' hors IDE
hideAgent(sessionId?: string, viewer?: string): void;                // sans id : tout (comportement d'aujourd'hui) ; avec id : cette session, seulement si `viewer` la tient
viewerOf(sessionId: string): string | null;                          // qui montre cette session
retryNow(sessionId: string): void; refreshAgent(): void;             // refreshAgent : toutes les sessions montrées
```
- `shown`, `attachment`, `retry`, `drops` et `openedAt` deviennent une `Map<sessionId, …>`. Chaque session a son flux (`createAgentStream` en ouvre déjà un par session), sa reconnexion avec backoff et son état hors ligne. `refreshAgent` parcourt les sessions montrées.
- Une seule surface xterm par session (`agentTabId(sid)`). Le `viewer` qui l'a demandée en dernier la tient (R2). `AgentView` reçoit `viewer`. S'il ne tient pas l'écran, il affiche la note R2 avec « Afficher ici », qui rappelle `showAgent(sid, mode, viewer)`.
- `Workspace` (lot 2) : le verrou `attachHere`, qui exigeait le groupe actif, disparaît. Un onglet visible en terminal montre son agent (`viewer = tabPlace.key`). Caché, il ne fait rien. Démonté, il fait `hideAgent(sid, viewer)`.
- Hors IDE, `viewer` vaut `'page'` et le comportement est celui d'aujourd'hui : une seule page, donc une seule session à la fois. `hideAgent()` sans argument reste « tout ».
- Textes : `ide.agentElsewhere = 'Terminal affiché dans l’autre groupe'`, `ide.showHere = 'Afficher ici'` (en : `'Terminal shown in the other group'`, `'Show here'`).
- [ ] **Tests qui échouent :**
  - `term-store` : on montre `a` puis `b` → deux flux ouverts, aucun fermé. On cache `a` → seul `a` est fermé. La coupure de `a` relance `a` seul, avec son backoff. `refreshAgent` reprend les deux.
  - `term-store` : `a` montré par `t1`, puis par `t2` → `viewerOf('a') === 't2'` et un seul flux. `hideAgent('a', 't1')` → rien ne change.
  - `session-tab` (Review Focus 1) : deux groupes, Otto et Nova en terminal. On focalise l'un puis l'autre → les deux `.agent-view` restent attachées. Une mise à jour de Nova n'appelle pas `showAgent` pour Otto, ni de nouvelle connexion pour Nova.
  - Interrupteur coupé : `test/terminal*.test.*`, `agent-view.test.tsx` et `term-store.test.ts` (ses cas existants) restent verts sans retouche.
- [ ] Implémenter, PASS (suite complète), commit `feat(desktop): an agent's screen per session — several at once in the IDE`.

### Task 3 : L'onglet Terminal d'un agent

**Files:** Create `src/session/AgentTerminalTab.tsx`, export lazy `AgentTerminalPlace` (`session/lazy.tsx`). Modify `src/App.tsx` (corps et titre de l'onglet), `src/ide/tabs.tsx`, `src/ide/SessionTabLabel.tsx`. Tests `test/ide/agent-terminal-tab.test.tsx`.

- `AgentTerminalPlace(p: { client; session; readOnly: boolean; viewer: string })` : en tête, une ligne de 26 px avec la sorte du terminal (« attaché », ou « lecture seule » pour un siège, R3), comme le `chip-k` de la maquette. Dessous, l'écran de l'agent (`AgentView`), montré quand l'onglet est visible.
- Titre `>_ <nom> · tmux`, comme le `termFor()` de la maquette. Le libellé porte le logo de l'outil, comme l'onglet Modifications.
- Une session disparue ferme son onglet Terminal (la règle de réconciliation de `changes`). Les groupes liés suivent déjà (`follow`).
- [ ] **Tests :** l'onglet `terminal:agent:otto` rend l'écran d'Otto et la puce « attaché ». Pour un siège : « lecture seule », et l'écran refuse la frappe. Otto supprimé → l'onglet se ferme.
- [ ] Commit `feat(desktop): an agent's terminal in a tab of its own`.

### Task 4 : Diviser, le groupe vide, le carré de lien, beaucoup de groupes

**Files:** Modify `src/ide/DockHost.tsx`, `src/ide/TabMenu.tsx`, `src/App.tsx`, `src/nav/useKeys.ts`, `src/styles/ide.css`. Create `src/ide/EmptyGroup.tsx`. Tests `test/ide/dock.test.tsx`, `test/ide/frame.test.tsx`, `test/keys.test.tsx`.

- **Diviser** : le bouton au bout des onglets (icône `split` de la maquette, `title` « Diviser à droite (Ctrl+\\) »), après « + ». Il y a aussi `Ctrl+\` (IDE seulement, jamais dans un xterm) et l'entrée « Diviser à droite » du menu de l'onglet (`Ctrl \` à droite).
- **Groupe vide** (`emptyGroup()`) : `DockHost` dessine aussi les groupes vides du modèle. Le contenu reprend la maquette :
  - le titre « Groupe vide » ;
  - « Glisse un onglet ici, ouvre une session depuis l'explorateur, ou : » ;
  - les boutons : « Terminal · X » en premier et mis en avant, s'il y a une session quittée ; puis « Nouvelle session », « OpenRig », « Réglages », « Atelier ». « Terminal » (un shell) n'apparaît pas : il arrive au lot 5 ;
  - l'astuce : « Astuce : lie ce groupe (carré à gauche des onglets) avec celui de la session : il suivra la session choisie. »
  
  Un groupe vide focalisé porte le focus de dockview, ce qui corrige le point mineur laissé par le lot 2.
- **Carré de lien** (`.lkbtn`, `leftHeaderActionsComponent`) : un carré de 9 px, aux couleurs `--ide-link-violet` et `--ide-link-teal`, ou vide quand le groupe n'est pas lié. `title` « Lier ce groupe (violet, vert d'eau, aucun) ». Le clic appelle `cycleLink`.
- **Largeur** : 300 px minimum par groupe (R6). La zone d'édition défile à l'horizontale, et les onglets défilent dans leur barre.
- [ ] **Tests :**
  - `Ctrl+\` sur Otto → deux groupes, le second vide et focalisé, avec « Terminal · Otto ». Un clic sur ce bouton → l'onglet `terminal:agent:otto` dans ce groupe.
  - Diviser depuis l'atelier → pas de « Terminal · … » (Review Focus 3).
  - Le carré : trois clics → violet, vert d'eau, aucun.
  - Review Focus 5 (e2e, tâche 8) : quatre groupes dans une fenêtre de 1280 px.
  - `Ctrl+\` dans un `<textarea>` → divise, comme VS Code. Dans `[data-terminal]` → rien.
- [ ] Commit `feat(desktop): split, the empty group and its proposals, the link square`.

### Task 5 : Glisser un onglet

**Files:** Modify `src/ide/DockHost.tsx`, `src/styles/ide.css`. Tests `test/ide/dock.test.tsx`, e2e (tâche 8).

- `disableDnd` est retiré. Le glisser intérieur de dockview est gardé, mais **toute arrivée passe par le modèle** :
  - `onWillDrop` : `preventDefault`, puis `moveTo` ;
  - dépôt sur un groupe (centre ou barre d'onglets) → `{group, index}` ;
  - dépôt sur le bord droit d'un groupe, ou sur la zone « Déposer ici : nouveau groupe » (`.dropnew`, 140 px, visible seulement pendant le glisser) → `{rightOf}` ;
  - les bords haut, bas et gauche et les groupes flottants sont refusés (`dndEdges` restreint) : on n'empile pas de groupes au lot 3.
- **Sans recréation** : la synchronisation modèle → dockview déplace le panneau existant (`moveTo` de l'api du panneau, ou `moveGroupOrPanel`) au lieu de le retirer puis de le rajouter. Son contenu React et son DOM sont gardés.
- Le glisser hors de la fenêtre (lot 9) et vers le panneau du bas (lot 5) ne sont pas traités.
- [ ] **Tests :**
  - dock : une arrivée simulée (`onWillDrop` appelé avec un groupe cible) → le modèle a bougé, et le panneau est **le même objet** (la même instance de `Pane`, un compteur de montage reste à 1).
  - Review Focus 2 (e2e) : glisser l'onglet d'Otto de A vers B. Son brouillon et son défilement sont gardés, et A disparaît s'il est vidé.
- [ ] Commit `feat(desktop): drag a tab to another group or a new column, its state kept`.

### Task 6 : Ouvrir : le menu de l'explorateur, `Ctrl`+clic, Réglages › Espace de travail

**Files :**
- Modify : `src/manage/SessionMenu.tsx` (entrées IDE), `src/shell/sidebar/Tree.tsx`, `RigGroups.tsx`, `src/atelier/ProjectTable.tsx`, `Unassigned.tsx`, `ProjectRoom.tsx` (`Ctrl`+clic), `src/nav/state.ts` (section `workspace`), `src/settings/SettingsPage.tsx`, `src/i18n/*`, `docs/ledge-guide.md`.
- Create : `src/settings/WorkspaceSection.tsx`.
- Tests : `test/ide/explorer-menu.test.tsx`, `test/settings-page.test.tsx`, `test/ledge-guide.test.ts`.

- **Menu de l'explorateur** (maquette `menuHtml()` `ctx`), dans l'IDE seulement. En tête du menu de session actuel, au nom de l'agent :
  - « Ouvrir » (`Entrée`) ;
  - « Ouvrir à droite » (`Ctrl clic`) ;
  - un séparateur ;
  - « Son terminal » (session) ou « Capture dans un terminal » (siège, R3), qui ouvre l'onglet Terminal dans le groupe lié si le groupe en a un, sinon à droite (`beside`) ;
  - pour un siège : « Envoyer un message… » (R4).
  
  Les entrées actuelles (renommer, relève, archiver…) suivent. Interrupteur coupé, le menu est inchangé.
- **`Ctrl`+clic** (ou `⌘`) sur une session dans l'explorateur ou dans l'atelier → `dispatch({ type: 'open', id, where: 'right' })`.
- **Réglages › Espace de travail** (section `workspace`, placée juste après Général, comme dans la maquette) :
  - le titre « Espace de travail » ;
  - le réglage « Ouvrir une session » : « Dans le groupe actif » / « À droite », en boutons radio (« Nouvelle fenêtre » masqué) ;
  - l'enregistrement passe par `ctx.saved(...)` ;
  - la section n'apparaît que lorsque l'IDE est activé ;
  - `docs/ledge-guide.md` la décrit (le test `ledge-guide` l'exige).
- [ ] **Tests :**
  - menu : clic droit sur Otto dans l'IDE → « Ouvrir », « Ouvrir à droite », « Son terminal ». Sur un siège → « Capture dans un terminal » et « Envoyer un message… ». Aucune entrée « nouvelle fenêtre », « éditeur » ni « Redémarrer ». Interrupteur coupé → le menu d'aujourd'hui, sans ces entrées.
  - `Ctrl`+clic sur Nova dans l'arbre → un groupe à droite.
  - Le réglage « À droite » → un simple clic ouvre à droite. Il est relu après un rechargement.
  - Interrupteur coupé → pas de section Espace de travail.
- [ ] Commit `feat(desktop): open — the explorer's menu, Ctrl+click, Settings › Workspace`.

### Task 7 : Le nouveau logo de Ledge, partout

**Files :**
- Create : `apps/desktop/src-tauri/icons/ledge-mark.svg` (64×64) et `ledge-mark-16.svg`, d'après `ledgeMark()` ; `src/shell/LedgeMark.tsx`.
- Regenerate : `src-tauri/icons/*` (dont `icon.ico` et `icon.icns`), `ledge-tray.png`, `apps/mobile/public/*` (favicon, icônes 180/192/512 et maskable), `packages/ledge/assets/ledge.ico`.
- Modify : `src/ide/IdeTitleBar.tsx`, `src/shell/TitleBar.tsx`, `apps/desktop/index.html` (favicon), `apps/mobile/scripts/icons.mjs`, `packages/ledge/assets/ledge-icon.py` (ou son remplaçant), les tests d'icônes.

- `LedgeMark({ size })` : le SVG de la maquette, la version 16 sous 24 px et la version 64 au-delà. Les deux barres de titre affichent le signe de 16 px devant « Ledge », comme la maquette (`.brand`). Le point du mot « Ledge. » de la barre actuelle disparaît, puisque le signe le porte.
- **Icônes Desktop** : `pnpm tauri icon <mark 1024 px>` régénère tout le dossier. Les petites tailles (16 et 32) sont refaites depuis `ledge-mark-16.svg`, plus lisible. `ledge-tray.png` reprend la version 16.
- **Téléphone et Windows Terminal** :
  - `apps/mobile/scripts/icons.mjs` dessine le signe au lieu du robot ;
  - l'icône maskable garde sa marge de sécurité ;
  - `ledge.ico` (profil Windows Terminal) est régénéré.
- Le robot reste la mascotte de l'atelier, de l'encoche et des pages de démonstration.
- [ ] **Tests :**
  - `LedgeMark` rendu dans les deux barres de titre ;
  - `manifest.test.ts` (mobile) et `app-tray.test.tsx` restent verts, ou sont mis à jour pour les nouveaux fichiers ;
  - un test vérifie que `icon.png` n'est plus l'ancienne image (comparaison d'empreinte avec l'ancienne) ;
  - Rappel (mémoire du projet) : après un changement d'icône, `cargo clean --release -p ledge-desktop` avant la compilation Windows, sinon l'exe garde l'ancienne.
- [ ] Commit `feat: the new Ledge mark is the product's icon — title bars, app, tray, phone, terminal profile`.

### Task 8 : e2e et comparaison avec la maquette

**Files:** Create `apps/desktop/e2e/ide-groups.spec.ts`.
- [ ] En 1920×1080, interrupteur mis :
  - Diviser → groupe vide → « Terminal · Otto » ;
  - deux terminaux de sessions côte à côte, vivants (Review Focus 1) ;
  - glisser un onglet d'un groupe à l'autre, puis vers « nouveau groupe », en gardant brouillon et défilement (Review Focus 2) ;
  - le carré de lien et un groupe Modifications qui suit ;
  - quatre groupes à 1280 px, 300 px chacun, avec défilement (Review Focus 5) ;
  - `Ctrl`+clic ;
  - le réglage « À droite » ;
  - le logo dans la barre de titre.
- [ ] Captures `ide-groups.png` et `ide-empty-group.png`, à comparer à la maquette rendue à l'échelle 1. Les écarts vont dans le compte rendu.
- [ ] La suite e2e complète : seuls les deux échecs connus.
- [ ] Commit `test(desktop): e2e of the IDE groups at 1920×1080`.

### Task 9 : Relecture finale, Windows, compte rendu

- [ ] Relecture finale de toute la branche (subagent-driven).
- [ ] Questions reportées dans le compte rendu, puis `docs/ide-lot-3-questions.md` supprimé.
- [ ] Installeur Windows compilé selon la recette du projet, avec `cargo clean --release -p ledge-desktop` à cause des icônes. On vérifie que l'exe porte le nouveau logo.
- [ ] Compte rendu : quoi essayer, les Rulings avec leur coût, les questions et les écarts. Ni push ni PR sans accord.
