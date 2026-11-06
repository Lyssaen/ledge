# Refonte IDE, lot 2 : session et siège en onglet, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interrupteur « Interface IDE (aperçu) » mis, un onglet de session ou de siège garde son propre état (vue, défilement, brouillon). Il porte le logo du provider, la pastille d'état, le soulignement rouge ou ambre, le nom du rig et `>_`. Sa barre du bas montre modèle, contexte, branche, projet, « Interrompre » et `+N −N`, et ce dernier ouvre les Modifications à côté. `Ctrl+`` bascule fil ⇄ terminal, le clic droit ouvre le menu de l'onglet, et `Y` / `N` visent la session active du groupe actif.

**Architecture:** dockview garde montés les panneaux cachés : en mode `onlyWhenVisible`, il détache leur DOM mais leur portail React reste vivant. Chaque onglet a donc déjà sa propre instance de `SessionPage`, et il ne manque que deux choses. D'abord, chaque onglet reçoit son état propre : sa vue vient de `Tab.view` (le modèle), et non plus de la préférence partagée. Ensuite, les ressources uniques de la fenêtre ne sont prises que par l'onglet visible du groupe actif : le gestionnaire de touches de l'écran (`ScreenKeys`) et l'écran de l'agent (`TermStore.showAgent`). Un contexte `TabPlace`, posé par `DockHost` autour de chaque panneau, dit à son contenu s'il est visible et actif. Hors IDE, ce contexte vaut `null` et rien ne change. `DockHost` dessine désormais tous les groupes de la fenêtre principale, côte à côte, ce que demande « Modifications à côté » (`beside`). Diviser, glisser et le carré de lien restent au lot 3.

**Tech Stack:** React 19, TypeScript, `dockview-react` 8.6.1 (on n'importe jamais `dockview-core`), vitest + Testing Library (jsdom), Playwright.

**Spec:** [`docs/ide-workspace.md`](../../ide-workspace.md) (« Une session ou un siège dans un onglet », « Raccourcis », « Onglets et groupes »), [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md) (lot 2, D1 à D5, 4.1 point 1). Le prototype [`docs/mockups/ledge-ide-interactive.html`](../../mockups/ledge-ide-interactive.html) (v26) fait foi pour l'aspect : `tabLabel()`, `groupHtml()`, `agentView()`, `menuHtml()` (`tabctx`, `model`), `openBeside()`, le `keydown` global et la CSS `.tab.alert`, `.cbox`, `.sfoot.cbar.pfoot`, `.dchip` et les `@container`.

## Global Constraints

- Branche `feat/ide-lot-2`, partie de `origin/main` (f57c1b6e). Une PR vers `main`, seulement avec l'accord explicite de l'utilisateur (D4). Rien n'est poussé sans lui.
- Interrupteur coupé, l'interface actuelle est **inchangée** : tous les tests et e2e existants restent verts sans retouche. Toute différence de comportement passe par la prop `ide` ou par le contexte `TabPlace` (qui vaut `null` hors IDE).
- Échecs déjà présents sur `origin/main`, sans lien avec la branche : e2e `island.spec.ts:166` et `proposals.spec.ts:36`, vitest `session-conversation` « reconnect asks Nova's thread again ».
- `dockview-react` 8.6.1 seulement ; aucun import depuis `dockview-core`.
- Textes en français et en anglais dans `src/i18n/fr.ts` et `en.ts`, sous `ide`. Le français reprend la maquette (cité dans les tâches).
- Tout état absent de la maquette se demande à `design-ux` et ne s'invente pas. On le note dans `docs/ide-lot-2-questions.md` (créé à la tâche 1, supprimé avec le brief à la tâche 9 une fois reporté dans le compte rendu).
- Node 22 : `eval "$(fnm env)"; fnm use 22`. Tests : `pnpm --filter desktop test`, `pnpm --filter desktop typecheck`, `pnpm --filter desktop e2e`.
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Hors lot 2 : diviser (`Ctrl+\`), le groupe vide, glisser, le carré de lien (lot 3) ; la modale « Nouvelle session » (lot 4 ; au lot 2, `N` ouvre le dialogue de lancement actuel) ; les terminaux du panneau du bas (lot 5) ; les icônes des onglets non agents (lot 6) ; role.md en onglet (lot 7, voir Rulings) ; la puce MR/PR (lot 8) ; « Ouvrir dans… » (lot 11).

## Rulings (choix du plan, à valider)

| # | Choix | Ce que ça coûte s'il est faux |
|---|---|---|
| R1 | `DockHost` dessine tous les groupes de la fenêtre principale dès le lot 2, pour que `+N −N` ouvre bien les Modifications **à côté**. Au lot 2, seul `beside` crée un groupe. | Si l'utilisateur préfère un lot 2 à un seul groupe, on retire la tâche 3 et `+N −N` ouvre les Modifications dans le même groupe en attendant le lot 3. |
| R2 | « Lire role.md » n'est **pas** dans le menu au lot 2. Le rôle d'un siège ne se relie pas de façon sûre à la bibliothèque des rôles depuis la session (`rig.role` contre l'id de rôle et la clé `rig/logicalId`). Il passe au lot 7 (OpenRig). | Une entrée de menu et une vue à ajouter plus tard. |
| R3 | « Diviser à droite » et « Ouvrir dans… » ne sont pas dans le menu au lot 2 (lots 3 et 11). Le menu contient : basculer fil ⇄ terminal, fermer l'onglet, fermer les autres. | Deux entrées à ajouter dans leurs lots. |
| R4 | Dans l'IDE, l'onglet de session n'a ni le sélecteur Fil / Terminal, ni la ligne `SessionMeta` d'en-tête, ni le panneau de droite de la page (« ± Modifications » et shells, touche `O`). Les Modifications passent par `+N −N`, les shells par le panneau du bas (lot 5). | On les remet derrière la prop `ide`, sans autre changement. |
| R5 | Ce que la maquette ne place pas (relève, Story/Objectif, « N sous-agents », Navigateur, puce « terminal local / distant ») reste dans une ligne d'en-tête mince, masquée quand elle est vide. C'est une question pour `design-ux`. | Si `design-ux` les déplace, on retouche un composant. |
| R6 | La vue d'un onglet est enregistrée dans le modèle (`Tab.view`, donc dans `ledge.ide.workspace`). Le défilement et le brouillon vivent dans la page, qui reste montée, et dans `SessionMemory` : ils survivent au changement d'onglet, pas au redémarrage, comme aujourd'hui. | Persister le défilement serait un ajout à `SessionMemory`. |
| R7 | `N` ouvre le dialogue de lancement actuel depuis n'importe quel onglet de l'IDE. Si la session active du groupe actif attend une autorisation, `N` la refuse, comme dans la maquette. | Si « refusé » voulait dire « ne fait rien », on change une ligne du gestionnaire. |
| R8 | « Interrompre » envoie `session.interrupt` (le daemon l'accepte pour une session tmux ou `omp-rpc`). Le bouton s'affiche quand la session est `working`, ni archivée, ni hors ligne, ni `hook_only`. Un refus du daemon s'annonce dans le toast. | Un test et une condition à revoir. |
| R9 | Cursor Agent n'a pas de logo dans la maquette. Son onglet n'en montre pas (question `design-ux`). | Une icône à ajouter. |
| R10 | Un clic sur une action, dans l'onglet Modifications, met l'onglet de la session au premier plan. Il n'allume pas l'action dans le fil, faute de chemin entre deux onglets montés. | La lumière sur l'action, ajoutable par un canal `TabPlace` plus tard. |

## Review Focus

1. **Deux onglets de session, celui qui est caché attend une autorisation.** `Y` décide pour l'onglet visible du groupe actif, et jamais pour le caché, même si sa page est montée plus tard. Test en tâche 5.
2. **Un onglet en vue terminal qu'on quitte puis qu'on retrouve.** L'écran de l'agent se rattache à sa session. Un onglet caché ne détache jamais l'écran de l'onglet visible. Test en tâche 2 (`hideAgent(id)`) et en tâche 5.
3. **`Y`, `N` et `Ctrl+`` tapés dans le champ de réponse, ou dans l'xterm.** Ils s'écrivent dans le champ, et l'xterm garde toutes ses touches. Test en tâche 7.
4. **Un siège OMP arrêté, ou une session archivée, alors que son onglet est en vue terminal.** Il revient sur le fil (`tabView`), avec le bandeau « Session archivée » sans zone de réponse, et sa barre n'a pas « Interrompre ». Test en tâches 1 et 6.
5. **Un groupe étroit.** La barre se resserre dans l'ordre de la maquette (projet, puis pourcentage et caret, puis branche) et ne déborde jamais. La limite d'usage n'y apparaît pas. Test e2e en tâche 8.

---

### Task 1 : Les règles pures de l'onglet de session

**Files:**
- Create: `apps/desktop/src/workspace/sessionTab.ts`, `docs/ide-lot-2-questions.md`
- Modify: `apps/desktop/src/workspace/model.ts`
- Test: `apps/desktop/test/workspace/sessionTab.test.ts`, `apps/desktop/test/workspace/model.test.ts` (ajouts)

**Interfaces:**
- Produces :
  ```ts
  // sessionTab.ts
  export type Provider = 'anthropic' | 'openai' | 'omp';
  export function providerOf(tool: Session['tool']): Provider | null;      // claude→anthropic, codex→openai, omp→omp, cursor→null
  export function tabView(tab: Tab, s: Session | undefined): SessionView;  // la vue qu'affiche l'onglet
  export function tabAlert(s: Session | undefined): 'perm' | 'ask' | null; // dotOf : approval→perm, question→ask
  export function changeTotals(files: readonly ChangedFile[]): { files: number; plus: number; minus: number };
  export function projectLabel(s: Session, projectName: (s: Session) => string): string; // siège : « rig · rôle » (ou « rig »), sinon le projet
  // model.ts
  export function closeOthers(w: Workspace, key: string): Workspace;     // ferme les autres onglets du groupe de `key` ; le groupe reste
  export function changesBeside(w: Workspace, key: string): Link | null; // la couleur du groupe lié dont l'onglet en tête est changesTab(ref), sinon null
  ```
- `tabView` : un siège OMP arrêté ou archivé → `'thread'`, quoi que dise l'onglet. Sinon `tab.view === 'terminal'` → `'terminal'`, `'thread'` → `'thread'`, et `'role'` → `'thread'` (role.md vient au lot 7). Sans vue → `viewShown(s ?? null, 'thread', null)` : un siège OMP en marche s'ouvre sur son terminal, le reste sur le fil.
- `docs/ide-lot-2-questions.md` reçoit, dès cette tâche, les questions pour `design-ux` : le logo de Cursor Agent (R9), la ligne d'en-tête restante (R5), et les deux questions laissées par le lot 1 (le texte d'un onglet dont la machine est hors ligne, le cadre vide du panneau du bas).

- [ ] **Step 1 : Tests qui échouent.**
  - `providerOf` : les quatre outils.
  - `tabView` : `{kind:'session', ref:'a'}` sur une session Claude → `'thread'` ; avec `view:'terminal'` → `'terminal'`. Un siège OMP en marche sans vue → `'terminal'`. Avec `view:'thread'` → `'thread'`. Un siège OMP `state:'exited'` avec `view:'terminal'` → `'thread'` (Review Focus 4). `view:'role'` → `'thread'`. Session inconnue avec `view:'terminal'` → `'terminal'`.
  - `tabAlert` : `waiting_permission` → `'perm'`, `waiting_input` → `'ask'`, `working` → `null`, `offline: true` en `waiting_permission` → `null`.
  - `changeTotals` : deux fichiers (+3 −1, +0 −4) → `{ files: 2, plus: 3, minus: 5 }` ; `[]` → zéros.
  - `projectLabel` : `rig: { seat:'dev@x', name:'ledge-dev', role:'dev.build' }` → `'ledge-dev · dev.build'` ; sans rôle → `'ledge-dev'` ; sans rig → `projectName(s)`.
  - `closeOthers` : un groupe à trois onglets, la clé du deuxième → il reste seul et actif. Les autres groupes ne changent pas. Une clé inconnue rend le même objet.
  - `changesBeside` : après `beside(w, g, 'changes', 'a')`, `changesBeside(w, 'session:a')` → la couleur posée. Sans groupe lié → `null`. Si le groupe lié a un autre onglet en tête → `null`.
- [ ] **Step 2 :** `pnpm --filter desktop test test/workspace` → FAIL.
- [ ] **Step 3 : Implémenter.** `changeTotals` et `projectLabel` n'importent que des types (`ChangedFile` de `session/changedFiles.ts`), pour que le premier bundle ne tire pas le chunk de session.
- [ ] **Step 4 :** PASS.
- [ ] **Step 5 :** Commit `feat(desktop): the IDE session tab's rules — its view, alert, change totals, project label; closeOthers`.

### Task 2 : Les ressources uniques à l'onglet actif

**Files:**
- Create: `apps/desktop/src/workspace/tabPlace.ts`
- Modify: `apps/desktop/src/nav/screenKeys.ts`, `apps/desktop/src/term/store.ts`, `apps/desktop/src/ide/DockHost.tsx`
- Test: `apps/desktop/test/screen-keys.test.tsx` (ajouts), `apps/desktop/test/term-store.test.ts` (ajouts), `apps/desktop/test/ide/dock.test.tsx` (nouveau)

**Interfaces:**
- Produces :
  ```ts
  // tabPlace.ts : ce qu'un contenu d'onglet sait de sa place. null hors IDE.
  export interface TabPlace { key: string; group: string; visible: boolean; active: boolean } // active = visible et groupe focalisé
  export const TabPlaceContext: React.Context<TabPlace | null>;
  export function useTabPlace(): TabPlace | null;
  // screenKeys.ts
  export function useScreenKeys(handler: ScreenKeyHandler): void; // inchangé hors IDE ; dans un onglet, inscrit seulement quand place.active
  // store.ts
  hideAgent(sessionId?: string): void; // avec un id : ne fait rien si l'écran montré est celui d'une autre session
  ```
- `useScreenKeys` lit `useTabPlace()`. Sans place (`null`) : comportement actuel. Avec une place : l'écran s'inscrit quand `active` devient vrai (y compris après un autre écran) et se retire quand il devient faux, seulement s'il est encore l'inscrit. Tous les écrans posés dans un onglet (page de session, atelier, OpenRig, réglages) sont ainsi gardés, sans retouche de leur code.
- `DockHost` : chaque `Pane` suit `api.isVisible` par `api.onDidVisibilityChange` et pose `TabPlaceContext` avec `{ key: api.id, group: <id du groupe du modèle qui contient l'onglet>, visible, active: visible && group === ws.focus }`.

- [ ] **Step 1 : Tests qui échouent.**
  - `screen-keys.test.tsx` : deux écrans dans deux `TabPlaceContext` (`active` à `true` pour A et `false` pour B, montés dans l'ordre A puis B) → `keys.current` appelle le gestionnaire de A. On passe B à actif et A à inactif → celui de B. A redevient actif → A. Sans contexte : le dernier monté gagne, comme aujourd'hui (le test existant reste vert).
  - `term-store.test.ts` : `showAgent('a', live)` puis `hideAgent('b')` → l'écran de `a` reste attaché. `hideAgent('a')` → détaché. `hideAgent()` → détaché.
  - `dock.test.tsx` : un `DockHost` avec deux onglets de session, dont le contenu affiche `useTabPlace()` en texte. L'onglet en tête lit `visible:true, active:true`, l'autre `visible:false`. On active l'autre dans le modèle → les valeurs s'inversent.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 :** PASS, puis `pnpm --filter desktop test test/keys test/ide test/term-store` → vert.
- [ ] **Step 5 :** Commit `feat(desktop): screen keys and the agent's screen belong to the IDE's active tab`.

### Task 3 : `DockHost` dessine les groupes de la fenêtre principale (R1)

**Files:**
- Modify: `apps/desktop/src/ide/DockHost.tsx`, `apps/desktop/src/styles/ide.css`
- Test: `apps/desktop/test/ide/dock.test.tsx` (ajouts)

**Interfaces:**
- Consumes : `Workspace`, `Group`, `activate`, `close`, `focused` (`model.ts`).
- Produces : `DockHost` garde ses props (`DockHostProps`). Les groupes du modèle dont `window === MAIN` deviennent des groupes dockview, de gauche à droite, dans l'ordre du modèle. Un groupe du modèle ↔ un groupe dockview, par une table tenue dans un `useRef`. Le premier groupe dockview est celui que dockview crée au premier panneau.
- Modèle → dockview : on crée un groupe dockview à droite de son voisin de gauche (`addPanel` avec `position: { referenceGroup, direction: 'right' }` pour son premier onglet). On retire les panneaux disparus, et un groupe dockview vidé disparaît avec eux. On active l'onglet en tête de chaque groupe, puis le groupe focalisé (`group.api.setActive()`).
- Dockview → modèle : `onDidActivePanelChange` appelle `activate(w, groupe, index)`, ce qui pose aussi `focus`. Un clic dans le contenu d'un groupe le focalise (`onDidActiveGroupChange` → `activate` de son onglet en tête). La fermeture d'un onglet appelle `close`. `disableDnd` et `disableFloatingGroups` restent.
- CSS : le groupe focalisé marque son onglet actif d'un filet de 2 px en haut (`.grp.focus .tab.on::before` de la maquette, couleur `--ring` faute du violet des liens, qui vient au lot 3).

- [ ] **Step 1 : Tests qui échouent** (`dock.test.tsx`) :
  - `beside` sur la session `a` → deux groupes dockview (`document.querySelectorAll('.dv-groupview')` vaut 2), le second contient l'onglet `changes:a`.
  - fermer `changes:a` → un seul groupe dockview, et le modèle n'a plus qu'un groupe.
  - un clic sur l'onglet du second groupe → `ws.focus` est son id, et le `TabPlace` de son contenu lit `active:true`, celui du premier `active:false` (il reste `visible`).
  - un modèle relu avec deux groupes (`deserialize`) → deux groupes dockview au montage.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 :** PASS, et `test/ide/frame.test.tsx` reste vert.
- [ ] **Step 5 :** Commit `feat(desktop): the IDE's editing area draws the main window's groups side by side`.

### Task 4 : L'onglet dockview d'une session, et son menu

**Files:**
- Create: `apps/desktop/src/ide/SessionTabLabel.tsx`, `apps/desktop/src/ide/ProviderLogo.tsx`, `apps/desktop/src/ide/TabMenu.tsx`
- Modify: `apps/desktop/src/ide/DockHost.tsx` (prop `tab`, `defaultTabComponent`), `apps/desktop/src/ide/tabs.tsx` (titre `changes`), `apps/desktop/src/App.tsx` (rendu de l'onglet et actions du menu), `apps/desktop/src/styles/ide.css`, `apps/desktop/src/i18n/fr.ts`, `en.ts`
- Test: `apps/desktop/test/ide/tab-label.test.tsx`, `apps/desktop/test/ide/tabs.test.ts` (ajout)

**Interfaces:**
- Consumes : `providerOf`, `tabView`, `tabAlert`, `closeOthers` (tâche 1) ; `dotOf` (`nav/agents.ts`) ; `Menu`, `MenuItem` (`shell/Menu.tsx`, avec `at` pour un clic droit).
- Produces :
  ```ts
  ProviderLogo(p: { provider: Provider; size?: number }): JSX.Element // les SVG de logo() de la maquette (Anthropic, OpenAI, omp)
  SessionTabLabel(p: { session: Session | undefined; tab: Tab; title: string }): JSX.Element
  TabMenu(p: { at: { x: number; y: number }; tab: Tab; others: boolean; onView(): void; onClose(): void; onCloseOthers(): void; onDismiss(): void }): JSX.Element
  // DockHostProps gagne :
  label(t: Tab): ReactNode;                // le contenu de l'onglet (SessionTabLabel pour une session ou un siège, le titre sinon)
  alert(t: Tab): 'perm' | 'ask' | null;    // la classe alert / alert-a de l'onglet
  onTabMenu(t: Tab, at: { x: number; y: number }): void;
  ```
- `SessionTabLabel` (maquette `tabLabel()`) : le logo (sans logo pour `cursor`, R9), le nom, `>_` (`title` « Vue terminal ») quand `tabView` vaut `'terminal'`, le nom du rig (`session.rig.name`) pour un siège, puis la pastille `dotOf(session)` aux couleurs de l'encoche (`settings.css`, `.preview-notch .d-*` : approval `--sidebar-primary`, question `--warning`, working `--info` ; les autres états prennent `--muted-foreground`). Le nom accessible de l'onglet reste le titre seul (les tests du lot 1 ciblent `toHaveAccessibleName('Otto')`).
- L'onglet porte `alert` (`box-shadow: inset 0 -2px 0` rouge, `--destructive`) ou `alert-a` (ambre, `--warning`), selon `alert(tab)`. Le × de fermeture reste.
- `tabTitle` pour `changes` : `t.ide.changesTitle(name)`.
- Menu (`menuHtml()` `tabctx`, R2 et R3). Pour une session ou un siège : un en-tête au nom de la session, puis « Basculer sur le terminal » ou « Revenir au fil » (avec `Ctrl `` à droite), un séparateur, « Fermer l'onglet » et « Fermer les autres » (seulement s'il y a d'autres onglets dans le groupe). Pour un autre onglet : les deux dernières entrées. Échap et un clic dehors le ferment (`Menu`). Un siège OMP arrêté n'a pas l'entrée de bascule.
- `App` : `label`, `alert`, et un état `tabMenu: { tab, at } | null`. `onView` appelle `setView(w, key, tabView === 'terminal' ? 'thread' : 'terminal')`, `onClose` appelle `close`, `onCloseOthers` appelle `closeOthers`.
- Textes : `ide.tabTerminalView = 'Vue terminal'`, `ide.toTerminal = 'Basculer sur le terminal'`, `ide.toThread = 'Revenir au fil'`, `ide.viewKey = 'Ctrl `'`, `ide.closeThisTab = 'Fermer l’onglet'`, `ide.closeOthers = 'Fermer les autres'`, `ide.tabMenu = 'Onglet'`, `ide.changesTitle = (name) => \`Modifications · ${name}\``. En anglais : `'Terminal view'`, `'Switch to the terminal'`, `'Back to the thread'`, `'Ctrl `'`, `'Close tab'`, `'Close others'`, `'Tab'`, `` `Changes · ${name}` ``.

- [ ] **Step 1 : Tests qui échouent.**
  - `tab-label.test.tsx` : Claude en `working` → le logo Anthropic (`title` « Anthropic »), « Otto » et la pastille `working`. Avec `view:'terminal'` → `>_` (« Vue terminal »). Un siège avec `rig.name: 'ledge-dev'` → « ledge-dev ». Cursor → aucun `.logo`. Session inconnue → le titre seul, sans pastille.
  - `frame.test.tsx` (ajouts) : une session en `waiting_permission` ouverte → son onglet dockview a la classe `alert` ; une en `waiting_input` → `alert-a`.
  - `frame.test.tsx` : clic droit sur l'onglet d'Otto → un menu « Otto » avec « Basculer sur le terminal », « Fermer l'onglet » et « Fermer les autres ». « Basculer sur le terminal » → l'onglet montre `>_`. Rouvrir le menu → « Revenir au fil ». « Fermer les autres » → seul l'onglet d'Otto reste.
  - `tabs.test.ts` : `tabTitle({kind:'changes', ref:'a'})` → « Modifications · Otto ».
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : Implémenter.** Le composant d'onglet de dockview se donne par `defaultTabComponent` (le `IDockviewPanelHeaderProps` de `dockview-react`). Il lit `label` et `alert` par le même contexte `Content` que `Pane`.
- [ ] **Step 4 :** PASS, puis `pnpm --filter desktop test test/messages` → les deux langues ont les mêmes clés.
- [ ] **Step 5 :** Commit `feat(desktop): an IDE session tab shows its provider, state, alert and view; its right-click menu`.

### Task 5 : La page de session dans un onglet, avec son état propre

**Files:**
- Modify: `apps/desktop/src/session/SessionPage.tsx`, `apps/desktop/src/session/Workspace.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/ide.css`
- Test: `apps/desktop/test/ide/session-tab.test.tsx` (nouveau)

**Interfaces:**
- Consumes : `tabView` (tâche 1), `useTabPlace`, `hideAgent(id)` (tâche 2), `setView` (`model.ts`).
- Produces :
  - `WorkspaceProps` gagne `ide?: boolean` ; `SessionPageProps` le reçoit.
  - Avec `ide` (R4) : pas de `.view-switch` ni de `SessionMeta` dans l'en-tête, qui ne rend que ce qui reste (R5) et disparaît s'il est vide. Pas de `RightPanel` ni de `TermHandle`, et `O` n'est pas pris (le gestionnaire rend `false`).
  - L'effet de l'écran de l'agent (`Workspace`) n'agit que si `place === null || place.visible`. Visible en terminal → `showAgent`. Visible sur le fil → `hideAgent(session.id)`. Au démontage → `hideAgent(session.id)`. Caché → rien.
  - Le défilement (R6) : quand `place.visible` repasse à `true` sur la vue fil, la page remet `pos.current` (ou la fin si elle suivait la fin). C'est la branche `returning = 'restore'` de l'effet existant, déclenchée par la visibilité.
  - `Y` / `N` en vue terminal : le gestionnaire de la page, après `replyKeys`, décide une autorisation en attente de la session (`session.pending?.kind` d'une autorisation, pas sur la page d'un sous-agent) par `decisions.decide(session, 'accept' | 'deny')`. Il ne le fait pas pour une touche répétée. Sur le fil, `Reply` le fait déjà.
- `App`, corps d'un onglet de session : `prefs = { ...sessionPrefs, view: tabView(tab, s), terminal: false }`, et `setPrefs(fn)` applique `fn`. Une vue changée va dans le modèle (`setView`, jamais `desktop.session`), le reste (`split`) dans `sessionPrefs`. Les deux sont mémoïsés par clé d'onglet, pour que la page ne se rende pas à chaque rendu de `Shell`. Le `nav` passé reste `tabNav(nav, tab)`.

- [ ] **Step 1 : Tests qui échouent** (`session-tab.test.tsx`, montage de `frame.test.tsx`, Otto et Nova ouverts en onglets) :
  - pas de `role="tablist"` « Vues » dans la page d'Otto ; interrupteur coupé, la page d'aujourd'hui l'a toujours ;
  - l'onglet d'Otto passé en terminal (menu de la tâche 4), puis Nova au premier plan → Nova est sur son fil. On revient sur Otto → il est en terminal. `localStorage['desktop.session']` n'a pas changé de vue ;
  - un brouillon tapé dans la réponse d'Otto, puis Nova, puis Otto → le brouillon est là. Celui de Nova est vide ;
  - Review Focus 1 : Nova passe en `waiting_permission` pendant qu'Otto est en tête. `Y` → aucun `session.decide` pour Nova (le daemon simulé n'en reçoit pas). Nova au premier plan, `Y` → un `session.decide` `accept` pour Nova ;
  - Review Focus 2 : Otto en terminal et en tête, Nova sur le fil et cachée, puis Nova démontée (onglet fermé) → l'écran d'Otto reste attaché (`termStore` montre `otto`) ;
  - `Y` en vue terminal (le focus hors de l'xterm) sur une session en autorisation → `session.decide` `accept` ;
  - `O` dans l'IDE n'ouvre pas de panneau `.conversation-workspace.with-terminal`.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 :** PASS. `pnpm --filter desktop test` en entier → vert, hors l'échec connu.
- [ ] **Step 5 :** Commit `feat(desktop): each IDE session tab keeps its own view, scroll and draft; keys and screen follow the active tab`.

### Task 6 : La barre du bas de l'onglet, et les Modifications à côté

**Files:**
- Create: `apps/desktop/src/session/SessionBar.tsx`, `apps/desktop/src/session/ChangesTab.tsx`
- Modify: `apps/desktop/src/session/SessionPage.tsx`, `apps/desktop/src/session/Workspace.tsx` (exporte `ChangesTab` du chunk), `apps/desktop/src/session/lazy.tsx` (`ChangesPlace`), `apps/desktop/src/session/Reply.tsx` (prop `modelChip`), `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/ide.css`, `apps/desktop/src/i18n/fr.ts`, `en.ts`
- Test: `apps/desktop/test/ide/session-bar.test.tsx`

**Interfaces:**
- Consumes : `changeTotals`, `projectLabel`, `changesBeside` (tâche 1) ; `beside` (`model.ts`) ; `SessionModel` ; `contextShare` ; `useContextNear` ; `modelName` ; `Changes`, `changedFiles`, `useThread`.
- Produces :
  ```ts
  SessionBar(p: { client: DaemonClient; session: Session; project: string; files: readonly ChangedFile[]; besideLink: Link | null; notify(text: string): void; onChanges(): void }): JSX.Element
  ChangesPlace(p: { client: DaemonClient; session: Session; notify(text: string): void; onTouch(): void }): JSX.Element // lazy, dans le chunk de session
  // WorkspaceProps gagne (lus seulement avec `ide`) :
  project?: string; besideLink?: Link | null; onChanges?(): void;
  // Reply gagne : modelChip?: boolean (défaut true ; l'IDE passe false, le modèle est dans la barre)
  ```
- `SessionBar` (`agentView()` `.sfoot.cbar.pfoot` : 28 px, filet en haut, fond `--shell`), de gauche à droite :
  - le modèle : `SessionModel` quand la machine le permet, sinon `modelName(session.model)` sans caret, `title` « Changer de modèle » ;
  - le contexte : jauge de 34 px, puis `N %` en gras, ambre au-delà de `near`. `title` « Contexte : 84k / 200k » (`t.ide.context(used, window)`, en milliers arrondis, sans espace avant `k`, comme la maquette). Rien quand le contexte est inconnu ;
  - un séparateur, puis la branche (`session.branch`, `title` « Branche X », tronquée à 150 px), puis le projet (`project`) ;
  - à droite : « Interrompre » (carré plein, `aria-label` et `title` « Interrompre », R8), qui envoie `{ type: 'session.interrupt', id }` ; puis `+N −N` (`.dchip`), avec l'icône des modifications, `+N` en vert (`--t-green` ou le jeton vert du thème) et `−N` en rouge, et `title` « Modifications : 3 fichiers · à côté, dans un groupe lié ». Un terme nul n'est pas écrit, et rien ne s'affiche quand les deux sont nuls. Le bouton est `on` et montre la pastille de couleur quand `besideLink` n’est pas `null`. Un clic appelle `onChanges`.
  - Jamais de limite d'usage.
- Resserrement (`@container` sur le groupe, `container-type: inline-size` sur le contenu du panneau dockview) : sous 560 px le projet disparaît, sous 470 px le pourcentage et le caret, sous 400 px la branche et le séparateur.
- La barre est rendue en vue fil comme en vue terminal, sous la réponse. Une session archivée la garde, sans « Interrompre ».
- La réponse dans l'IDE (`.cbox` de la maquette) : le `textarea` de `Reply` fait 72 px au moins et 240 px au plus, s'étire avec son texte (`field-sizing: content`). Entrée envoie et Maj+Entrée passe à la ligne, ce qui est déjà le cas. Seule la CSS sous `.ide` change.
- `App` : `project = projectLabel(s, projectName)`, `besideLink = changesBeside(ws, keyOf(tab))`, `onChanges = () => wsStore.update(w => { const hit = find(w, keyOf(tab)); return hit ? beside(w, hit.group.id, 'changes', s.id) : w; })`. Le corps d'un onglet `changes` rend `ChangesPlace`, dont `onTouch` met l'onglet de la session au premier plan (`dispatch({ type: 'open', id })`, R10).
- Textes : `ide.changeModel = 'Changer de modèle'`, `ide.context = (used, window) => \`Contexte : ${used} / ${window}\``, `ide.branch = (b) => \`Branche ${b}\``, `ide.interrupt = 'Interrompre'`, `ide.changesChip = (n) => \`Modifications : ${n} fichier${n > 1 ? 's' : ''} · à côté, dans un groupe lié\``, `ide.interruptRefused = (name, why) => …` (le toast, sur le modèle de `t.session.model.refused`). En anglais : `'Change model'`, `` `Context: ${used} / ${window}` ``, `` `Branch ${b}` ``, `'Interrupt'`, `` `Changes: ${n} file${n > 1 ? 's' : ''} · beside, in a linked group` ``.

- [ ] **Step 1 : Tests qui échouent** (`session-bar.test.tsx`, avec `SessionBar` rendu seul et un client simulé) :
  - une session `model: 'claude-sonnet-5-5'`, `context: { used: 84000, window: 200000 }`, `branch: 'feat/x'`, `working` → le nom du modèle, « 42 % », `title` « Contexte : 84k / 200k », « feat/x », le projet, « Interrompre ». Le clic sur « Interrompre » envoie `session.interrupt` pour son id ;
  - `idle` → pas d'« Interrompre ». Archivée et `working` → pas d'« Interrompre » (Review Focus 4). `hook_only` → pas d'« Interrompre » ;
  - les fichiers +3 −1 et +0 −4 → « +3 », « −5 », et `title` « Modifications : 2 fichiers · à côté, dans un groupe lié ». Le clic appelle `onChanges`. Aucun fichier → pas de bouton. +2 −0 → « +2 » sans « −0 » ;
  - aucune limite d'usage (`.ufoot` ou équivalent absent) ;
  - `frame.test.tsx` (ajout) : Otto, qui a une action d'écriture réussie dans son fil, puis un clic sur `+1` → un second groupe avec l'onglet « Modifications · Otto », et le bouton est `on`. Dans l'IDE, la réponse d'Otto n'a pas de puce de modèle, et la barre en a une ;
  - interrupteur coupé : la puce de modèle est toujours dans la réponse (`test/session-model.test.tsx` reste vert sans retouche).
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : Implémenter.** Les fichiers sont ceux que `Workspace` calcule déjà (`files`). La page passe à `SessionBar` les mêmes.
- [ ] **Step 4 :** PASS, `test/messages` vert.
- [ ] **Step 5 :** Commit `feat(desktop): the IDE session tab's bottom bar — model, context, branch, project, Interrompre, +N −N beside`.

### Task 7 : Les raccourcis de l'onglet actif

**Files:**
- Modify: `apps/desktop/src/nav/useKeys.ts`, `apps/desktop/src/App.tsx`
- Test: `apps/desktop/test/keys.test.tsx` (ajouts), `apps/desktop/test/ide/session-tab.test.tsx` (ajouts)

**Interfaces:**
- Consumes : `setView`, `focused`, `tabView`.
- Produces : `useKeys(dispatch, { …, ide?: { toggle(panel): void; newSessionAnywhere: true } })`. Avec `ide`, `N` (sans modificateur, hors champ, aucun dialogue) ouvre `{ type: 'modal', modal: { kind: 'launch' } }` quel que soit l'onglet. Le gestionnaire de l'écran passe avant : sur une autorisation en attente, `N` refuse (R7).
- `App`, IDE mis :
  - `toTerminal` (le `Ctrl+`` hors xterm) bascule l'onglet en tête du groupe actif, s'il s'agit d'une session ou d'un siège dont la vue terminal existe (pas un siège OMP arrêté) : `setView(…, 'terminal' | 'thread')`. Le focus suit à l'image suivante : `focusAgentView` vers le terminal, `focusThread` vers le fil. La fonction rend `false` sur un autre onglet, et la touche n'est alors pas prise ;
  - `termThread.current` (le `Ctrl+²` dans l'xterm de l'agent) passe l'onglet en tête sur le fil, puis `focusThread`. Depuis un autre xterm, rien ne change (le comportement actuel, sans panneau de droite).
  - Interrupteur coupé : `toTerminal` et `termThread` sont ceux d'aujourd'hui.

- [ ] **Step 1 : Tests qui échouent.**
  - `keys.test.tsx` : avec `ide`, `N` sur une place `session` → `modal launch`. Sans `ide`, sur une place `session` → rien (comportement actuel). `N` dans un `<textarea>` → rien. Review Focus 3 : avec `ide`, un focus sous `[data-terminal]`, `N`, `Y` et `Ctrl+`` → aucun `dispatch`, ni `toTerminal`.
  - `session-tab.test.tsx` : Otto en tête, `Ctrl+`` (`code: 'Backquote'`, `ctrlKey`) → son onglet montre `>_`. Une seconde fois → plus de `>_`. L'Atelier en tête → `Ctrl+`` ne change aucun onglet. Nova en `waiting_permission` et en tête : `N` → `session.decide` `deny`, sans dialogue « Nouvelle session ». Sans autorisation, `N` → le dialogue s'ouvre. `Y` tapé dans la réponse s'écrit, sans `session.decide`.
- [ ] **Step 2 :** FAIL.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 :** PASS, et `pnpm --filter desktop test` en entier → vert, hors l'échec connu.
- [ ] **Step 5 :** Commit `feat(desktop): Ctrl+\` and N on the IDE's active tab`.

### Task 8 : e2e et comparaison avec la maquette

**Files:**
- Create: `apps/desktop/e2e/ide-session-tab.spec.ts`

- [ ] **Step 1 : Écrire le spec**, sur le modèle de `e2e/ide-shell.spec.ts`, en 1920×1080 avec `ledge.ide.enabled = 'true'`. Le daemon simulé (`e2e/daemon.ts`, `e2e/thread.ts`) doit fournir une session au fil long avec des écritures de fichiers, une autre en autorisation, et un siège avec `rig` :
  - l'onglet d'une session montre son logo, sa pastille et son nom. L'onglet en autorisation est souligné en rouge (`box-shadow` calculé). Celui du siège porte le nom de son rig ;
  - le défilement de chaque onglet (R6) : on fait défiler le fil de A à mi-hauteur, on passe à B puis on revient → le `scrollTop` de A est le même, à 2 px près. Ce contrôle ne vaut que dans Chromium, car le DOM détaché y perd sa position ;
  - `Ctrl+`` → l'écran de l'agent remplace le fil et `>_` apparaît. Le clic droit → « Revenir au fil » ;
  - la barre du bas fait 28 px de haut, avec dans l'ordre le modèle, le contexte, la branche, le projet, puis `+N −N` collé à droite. Un clic sur `+N` → un second groupe « Modifications · … » à droite ;
  - Review Focus 5 : le second groupe ouvert, on resserre la fenêtre (`setViewportSize`) jusqu'à ce que le premier groupe passe sous 560, puis 470, puis 400 px. Le projet, puis le pourcentage, puis la branche disparaissent, et la barre n'a jamais de `scrollWidth` supérieur à son `clientWidth` ;
  - les captures `ide-session-tab.png` et `ide-session-bar.png`, à comparer à l'œil avec la maquette v26 (onglets, barre du bas, réponse). Les écarts vont dans le compte rendu.
- [ ] **Step 2 :** `pnpm --filter desktop e2e ide-session-tab` → PASS. Puis `pnpm --filter desktop e2e` en entier → seuls les deux échecs connus.
- [ ] **Step 3 :** Commit `test(desktop): e2e of the IDE session tab at 1920×1080`.

### Task 9 : Relecture finale et compte rendu

- [ ] **Step 1 :** Relecture de toute la branche par un relecteur neuf (subagent-driven, revue finale). On corrige ce qu'il trouve.
- [ ] **Step 2 :** `pnpm --filter desktop test`, `typecheck` et `e2e` en entier. On note les résultats exacts.
- [ ] **Step 3 :** On reporte `docs/ide-lot-2-questions.md` dans le compte rendu, puis on supprime ce fichier et `docs/ide-lot-2-brief.md`. Commit `chore: drop the lot 2 working notes`.
- [ ] **Step 4 :** Le compte rendu à l'utilisateur : quoi essayer (la branche, le commit, l'interrupteur, deux sessions, `Ctrl+``, le clic droit, `+N`, `Y` / `N`), les Rulings avec leur coût, les questions pour `design-ux` et les écarts avec la maquette. **Ni push ni PR** sans son accord.
