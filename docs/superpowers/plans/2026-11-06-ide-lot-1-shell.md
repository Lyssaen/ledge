# Refonte IDE, lot 1 — la coque : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derrière un interrupteur « Interface IDE (aperçu) », Ledge Desktop s'affiche en coque IDE : barre de titre, barre d'activité, barre latérale redimensionnable, un groupe d'onglets dockview, panneau du bas, panneau de droite (chat de Ledge seul) et barre d'état. L'interrupteur coupé, rien ne change.

**Architecture:** `Shell` (`apps/desktop/src/App.tsx`) garde tous ses hooks (flotte, alertes, terminaux, dialogues). Quand l'interrupteur est mis, il rend `IdeFrame` au lieu de `TitleBar` + `.application`. Les dialogues restent communs. L'état de l'IDE est double : le modèle d'espace de travail du lot 0 (`workspace/model.ts`, ses onglets) dans un magasin hors de React, et la disposition de la coque (`workspace/layout.ts`, les panneaux). Les composants existants envoient toujours des `NavAction`. Une fonction pure, `routeNav`, les traduit en opérations sur les onglets et les panneaux. Ainsi, l'atelier, la session, les réglages et OpenRig marchent dans un onglet sans être réécrits (ils le seront aux lots 2 et 6).

**Tech Stack:** React 19, TypeScript, `dockview-react` + `dockview-core` 8.6.1 (version du POC), vitest + Testing Library (jsdom), Playwright.

**Spec:** [`docs/ide-workspace.md`](../../ide-workspace.md) (« La fenêtre », « Raccourcis »), [`docs/ide-workspace-plan.md`](../../ide-workspace-plan.md) (lot 1, D1, D3), [`docs/ide-workspace-l0.md`](../../ide-workspace-l0.md) (leçons du lot 0). Le prototype [`docs/mockups/ledge-ide-interactive.html`](../../mockups/ledge-ide-interactive.html) (v26) fait foi pour l'aspect.

## Global Constraints

- Branche `feat/ide-lot-1`, partie de `origin/main` (0.49.0). Une PR vers `main`, relue par `review-qa`, fusionnée sur accord de l'utilisateur (D4).
- L'interrupteur est coupé par défaut. Coupé, l'application rend exactement l'interface actuelle : tous les tests et e2e existants restent verts sans retouche.
- `dockview-react` et `dockview-core` en `8.6.1` exacte, plus la CSS `dockview-react/dist/styles/dockview.css`.
- Dimensions de la maquette : barre de titre 34 px, barre d'état 24 px, barre d'activité 48 px, barre latérale 248 px par défaut (glisser entre 120 et 440 px ; lâchée sous 150 px elle se replie et retrouve 248 px), panneau de droite 300 px, panneau du bas 240 px.
- Raccourcis de l'IDE : `Ctrl+B` (barre latérale), `Ctrl+J` (panneau du bas), `Ctrl+/` (panneau de droite, bascule). `/` seul ouvre le panneau de droite, le champ du chat prend le focus (l'Accueil n'existe pas dans l'IDE, D3). `Ctrl+K`, `Ctrl+,`, `Échap`, `?`, `Alt+1…9`, `Alt+←/→` gardent leur sens.
- Textes en français et en anglais, dans `src/i18n/fr.ts` et `src/i18n/en.ts`, sous une clé `ide`. Les textes français viennent de la maquette (cités dans les tâches).
- Clés de stockage : `ledge.ide.enabled`, `ledge.ide.layout`, `ledge.ide.workspace`. Toute lecture survit à une valeur absente ou corrompue (`readJson` / `writeJson` de `src/state/storage.ts`).
- Tests : `pnpm --filter desktop test` et `pnpm --filter desktop typecheck` sous Node 22. e2e : `pnpm --filter desktop e2e`.
- Hors lot 1 : diviser, glisser, groupes liés (lot 3), la barre du bas des onglets de session (lot 2), les terminaux du panneau du bas (lot 5), la vue MR et PR (lot 8), les dispositions (lot 10), plusieurs fenêtres (lot 9).

## Review Focus

1. **Une session archivée ou supprimée pendant qu'elle est ouverte dans un onglet.** Supprimée : l'onglet se ferme (`reconcile` du modèle). Archivée : il reste ouvert et se lit. Test en tâche 3.
2. **Une disposition enregistrée illisible ou d'une autre version.** L'IDE s'ouvre alors sur un espace vide avec l'atelier, sans planter. Test en tâche 3.
3. **Basculer l'interrupteur pendant qu'une session est ouverte.** Couper l'IDE ramène l'interface actuelle sur la même session (la `NavState` est restée à jour). L'activer ouvre l'onglet de la session en cours. Test en tâche 7.
4. **Les raccourcis à une seule touche dans un champ ou un terminal.** `/`, `Ctrl+B` et `Ctrl+J` ne volent rien à un champ ni à un xterm (`[data-terminal]`). Test en tâche 6.
5. **Fenêtre de moins de 1280 px.** La barre latérale et le panneau de droite ne doivent pas écraser la zone d'édition sous 360 px : sous cette largeur, le panneau de droite se masque. Test en tâche 2. L'état dessiné reste à demander à `design-ux` (plan, 4.1 point 5).

---

### Task 1: Le socle — modèle du lot 0, dockview, docs

**Files:**
- Add (déjà dans l'index du worktree) : `apps/desktop/src/workspace/model.ts`, `apps/desktop/test/workspace/model.test.ts`, `docs/ide-workspace.md`, `docs/ide-workspace-plan.md`, `docs/ide-workspace-l0.md`, `docs/mockups/ledge-ide-interactive.html`
- Modify: `apps/desktop/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces : `workspace/model.ts` tel que le lot 0 l'a laissé (`Tab`, `Workspace`, `empty`, `open`, `close`, `activate`, `focused`, `find`, `keyOf`, `reconcile`, `serialize`, `deserialize`, `MAIN`).

- [ ] **Step 1:** `pnpm --filter desktop add dockview-react@8.6.1 dockview-core@8.6.1 --save-exact`
- [ ] **Step 2:** `pnpm --filter desktop test test/workspace` → 25 tests PASS. `pnpm --filter desktop typecheck` → aucune erreur.
- [ ] **Step 3:** Commit `feat(desktop): the IDE workspace model from lot 0, dockview 8.6.1, the IDE docs`.

### Task 2: La disposition de la coque (`workspace/layout.ts`)

**Files:**
- Create: `apps/desktop/src/workspace/layout.ts`
- Test: `apps/desktop/test/workspace/layout.test.ts`

**Interfaces:**
- Produces :
  ```ts
  export type SideView = 'projects' | 'rigs' | 'atoi';
  export interface IdeLayout { sideOpen: boolean; sideWidth: number; sideView: SideView; bottom: boolean; right: boolean }
  export const SIDE_DEFAULT = 248, SIDE_MIN = 120, SIDE_MAX = 440, SIDE_FOLD = 150, RIGHT_WIDTH = 300, EDITOR_MIN = 360;
  export type LayoutAction =
    | { type: 'toggle'; panel: 'side' | 'bottom' | 'right' }
    | { type: 'show'; panel: 'side' | 'bottom' | 'right'; on: boolean }
    | { type: 'view'; view: SideView }        // la barre d'activité
    | { type: 'drag'; width: number }          // pendant le glisser du bord
    | { type: 'drop'; width: number }          // au lâcher
    | { type: 'resetWidth' };                  // double-clic sur le bord
  export function layoutReducer(s: IdeLayout, a: LayoutAction): IdeLayout;
  export function loadLayout(): IdeLayout;     // ledge.ide.layout, défauts sinon
  export function saveLayout(l: IdeLayout): void;
  /** Le panneau de droite se masque quand la zone d'édition passerait sous EDITOR_MIN. */
  export function rightFits(l: IdeLayout, windowWidth: number): boolean;
  ```

- [ ] **Step 1: Écrire les tests qui échouent**, dans `layout.test.ts` :
  - `default layout` : `loadLayout()` sans stockage → `{ sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, right: true }`.
  - `view on the active view folds the sidebar` : `view: 'projects'` sur `sideView: 'projects', sideOpen: true` → `sideOpen: false`. Sur une autre vue → la vue change et `sideOpen: true`.
  - `drag clamps` : `drag 90` → `sideWidth 120` ; `drag 600` → `440`.
  - `drop under 150 folds and restores the default` : `drop 140` → `sideOpen false, sideWidth 248`. `drop 300` → `sideOpen true, sideWidth 300`.
  - `resetWidth` → `248`.
  - `corrupt storage` : `localStorage['ledge.ide.layout'] = '{"sideWidth":"x"}'` → défauts. Un champ isolé valide (`{"bottom":true}`) est gardé, les autres prennent les défauts.
  - `rightFits` : fenêtre 1920, barre ouverte à 248 → `true`. Fenêtre 1000, barre à 440 → `false` (48 + 440 + 300 + 360 > 1000). Barre repliée, fenêtre 760 → `true` (48 + 300 + 360 = 708).
- [ ] **Step 2:** `pnpm --filter desktop test test/workspace/layout` → FAIL (module absent).
- [ ] **Step 3: Implémenter** `layout.ts`. Toute action qui ne change rien rend le même objet.
- [ ] **Step 4:** Les tests passent.
- [ ] **Step 5:** Commit `feat(desktop): the IDE shell's layout — panels, sidebar width and fold`.

### Task 3: Le magasin d'espace de travail et `routeNav`

**Files:**
- Create: `apps/desktop/src/workspace/store.ts`, `apps/desktop/src/workspace/route.ts`
- Test: `apps/desktop/test/workspace/store.test.ts`, `apps/desktop/test/workspace/route.test.ts`

**Interfaces:**
- Consumes : `model.ts` (tâche 1), `NavAction` de `src/nav/state.ts`, `LayoutAction` (tâche 2).
- Produces :
  ```ts
  // store.ts : un magasin hors de React, comme daemonStore de @ledge/fleet
  export interface WorkspaceStore { get(): Workspace; update(fn: (w: Workspace) => Workspace): void; subscribe(cb: () => void): () => void }
  export function createWorkspaceStore(initial?: Workspace): WorkspaceStore; // persiste dans ledge.ide.workspace à chaque changement
  export function loadWorkspace(): Workspace;  // deserialize, sinon open(empty(), ATELIER_TAB)
  export function useWorkspace(store: WorkspaceStore): Workspace; // useSyncExternalStore
  export const ATELIER_TAB: Tab = { kind: 'atelier', ref: 'main' };
  export const SETTINGS_TAB: Tab = { kind: 'settings', ref: 'main' };
  export const openrigTab = (machine = 'local'): Tab => ({ kind: 'openrig', ref: machine });

  // route.ts : une NavAction des composants existants, traduite pour l'IDE
  export interface Routed { nav?: NavAction; ws?: (w: Workspace) => Workspace; layout?: LayoutAction }
  export function routeNav(a: NavAction, ctx: { isSeat(id: string): boolean; modalOpen: boolean }): Routed;
  /** La NavState vue par le contenu d'un onglet : la vraie si elle parle de lui, sinon une place synthétique. */
  export function tabNav(nav: NavState, tab: Tab): NavState;
  ```

`routeNav`, cas par cas (c'est la règle que les tests fixent) :
| Action | `nav` | `ws` | `layout` |
|---|---|---|---|
| `open {id,…}` | l'action telle quelle | `open(w, { kind: isSeat(id) ? 'seat' : 'session', ref: id })` | — |
| `home {project?}` | `filter` si `project` est donné | `open(w, ATELIER_TAB)` | — |
| `ledge` | `{ type: 'chat', open: true }` | — | `show right true` |
| `chat {open: false}` | l'action | — | `show right false` |
| `chat` sinon | l'action | — | `show right true` |
| `settings` | l'action | `open(w, SETTINGS_TAB)` | — |
| `openrig {machine?}` | l'action | `open(w, openrigTab(machine))` | — |
| `escape` | `{ type: 'modal', modal: null }` si `modalOpen`, sinon rien | — | — |
| toute autre | l'action | — | — |

`tabNav` : un onglet `session`/`seat` dont `ref` égale `nav.place.id` (place `session`) → `nav`. Sinon → `{ ...nav, place: { kind: 'session', id: tab.ref, view: 'atelier', project: 'all' } }`. Un onglet `settings` → `nav` si `nav.place.kind === 'settings'`, sinon place `settings` sur `general` avec `back` atelier. `atelier` et `openrig` → `nav`.

- [ ] **Step 1: Écrire les tests qui échouent.**
  - `route.test.ts` : une ligne de test par ligne du tableau. Elle vérifie `nav`, puis applique `ws` à `empty()` et regarde l'onglet actif (`focused(w).tabs[focused(w).active]`), et vérifie `layout`. En plus : `open` deux fois le même id → un seul onglet (le modèle ne duplique pas). `tabNav` : les trois cas ci-dessus.
  - `store.test.ts` :
    - `persists` : `update(w => open(w, SETTINGS_TAB))` → `localStorage['ledge.ide.workspace']` se relit en un espace où `settings:main` est actif.
    - `first run opens the atelier` : rien de stocké → l'onglet actif est `atelier:main`.
    - `unreadable layout` (Review Focus 2) : `'{"version":2}'`, puis `'not json'` → idem, sans exception.
    - `deleted session tab closes, archived stays` (Review Focus 1) : avec `reconcile(w, t => t.kind !== 'session' || known.has(t.ref))` et `known` = actives + archivées. Une session retirée des deux → onglet fermé ; une session passée en archive → onglet gardé.
    - `subscribe` : un abonné est appelé une fois par changement réel, pas pour une fonction qui rend le même objet.
- [ ] **Step 2:** Lancer → FAIL.
- [ ] **Step 3: Implémenter** `store.ts` (`writeJson` après chaque changement) et `route.ts`.
- [ ] **Step 4:** Les tests passent.
- [ ] **Step 5:** Commit `feat(desktop): the IDE workspace store, and NavAction routed to tabs and panels`.

### Task 4: L'interrupteur « Interface IDE (aperçu) »

**Files:**
- Create: `apps/desktop/src/workspace/prefs.ts`
- Modify: `apps/desktop/src/settings/General.tsx` (un `SwitchRow` après la langue), `apps/desktop/src/i18n/fr.ts`, `apps/desktop/src/i18n/en.ts`
- Test: `apps/desktop/test/workspace/prefs.test.tsx`

**Interfaces:**
- Produces : `loadIdeEnabled(): boolean` (`ledge.ide.enabled`, `false` par défaut), `saveIdeEnabled(on: boolean): void`, et `useIdeEnabled(): [boolean, (on: boolean) => void]`, un magasin à abonnement pour que `Shell` bascule sans relance.
- Textes : `ide.setting = 'Interface IDE (aperçu)'`, `ide.settingHint = 'Groupes d'onglets, panneaux et barre d'activité, à la manière de VS Code. L'ancienne interface reste disponible tant que l'aperçu dure.'` (en : `'IDE interface (preview)'`, `'Tab groups, panels and an activity bar, the VS Code way. The current interface stays available while the preview lasts.'`). Le changement passe par `ctx.saved(...)` comme les autres réglages.

- [ ] **Step 1: Test qui échoue** : rendre `General` (voir le montage de `test/desktop-prefs.test.tsx`), cliquer le switch « Interface IDE (aperçu) » → `loadIdeEnabled()` vaut `true`, et `ctx.saved` a été appelé. Second clic → `false`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4:** PASS, puis `pnpm --filter desktop test test/messages` (les deux langues ont les mêmes clés) → PASS.
- [ ] **Step 5:** Commit `feat(desktop): Settings › General, the « IDE interface (preview) » switch`.

### Task 5: Barre de titre, barre d'activité, barre d'état

**Files:**
- Create: `apps/desktop/src/ide/IdeTitleBar.tsx`, `apps/desktop/src/ide/ActivityBar.tsx`, `apps/desktop/src/ide/IdeStatusBar.tsx`, `apps/desktop/src/styles/ide.css`
- Modify: `apps/desktop/src/i18n/fr.ts`, `en.ts`
- Test: `apps/desktop/test/ide/chrome.test.tsx`

**Interfaces:**
- Consumes : `IdeLayout`, `LayoutAction` (tâche 2) ; `WindowCaps`, `waitingSessions` (`shell/TitleBar.tsx`), `Footer`, `UsageFooter`.
- Produces :
  ```ts
  IdeTitleBar(p: { layout: IdeLayout; onLayout(a: LayoutAction): void; onSearch(): void; blocked: boolean })
  ActivityBar(p: { layout: IdeLayout; onLayout(a: LayoutAction): void; onTab(t: Tab): void; activeTab: Tab | null; badge: { perm: number; ask: number } })
  IdeStatusBar(p: { footer: ReactNode; waiting: readonly Session[]; onNextWaiting(): void })
  ```
- Barre de titre (maquette `titlebar()`) : la marque « Ledge », le bouton de recherche (« Session, commande, tâche, rig… » + `Ctrl K`) qui appelle `onSearch`, les trois bascules avec `aria-pressed` (titres « Barre latérale (Ctrl+B) », « Panneau du bas (Ctrl+J) », « Panneau de droite (Ctrl+/) »), puis `WindowCaps`. La barre et ses vides portent `data-tauri-drag-region`, comme `TitleBar`.
- Barre d'activité (maquette `activity()`) : Projets, Rigs (« Rigs OpenRig »), À toi (badge rouge si `perm`, sinon ambre si `ask`), une zone vide, puis OpenRig (« OpenRig (onglet) »), Atelier (« Atelier (onglet) ») et, en bas, Réglages (« Réglages (onglet) »). Les trois premiers envoient `view`. Les trois autres appellent `onTab(openrigTab())`, `onTab(ATELIER_TAB)`, `onTab(SETTINGS_TAB)`. La vue active porte `on` seulement quand la barre latérale est ouverte. **MR et PR n'apparaît pas avant le lot 8.**
- Barre d'état : à gauche `footer` (le `Footer` existant, avec `UsageFooter`) ; s'il y a des demandes, un bouton « N en attente » qui appelle `onNextWaiting`. Textes : `ide.waiting(n) = n === 1 ? '1 demande' : \`${n} demandes\``.
- `ide.css` : la grille `.ide` (`grid-template-rows: 34px 1fr 24px`) et `.ide-body` (`48px [largeur] 1fr [300px]`), avec les jetons du thème actuel. Pas de nouvelle couleur.

- [ ] **Step 1: Tests qui échouent** (`chrome.test.tsx`) :
  - `title bar toggles` : un clic sur « Panneau du bas » appelle `onLayout({ type: 'toggle', panel: 'bottom' })`, et `aria-pressed` suit `layout.bottom`.
  - `search opens the palette` : un clic sur le champ appelle `onSearch`.
  - `activity views and tabs` : « Rigs » → `view: 'rigs'` ; « Atelier (onglet) » → `onTab` avec `atelier:main`. « Projets » est `on` quand `sideView: 'projects'` et que la barre est ouverte, et ne l'est plus quand elle est repliée.
  - `À toi badge` : `{ perm: 2, ask: 1 }` → badge « 2 », rouge (classe sans `amber`). `{ perm: 0, ask: 3 }` → « 3 » avec `amber`. `{ 0, 0 }` → pas de badge.
  - `no MR et PR yet` : aucun bouton dont le nom contient « MR ».
  - `status bar waiting` : deux sessions en attente → « 2 demandes ». Le clic appelle `onNextWaiting`. Sans attente, pas de bouton.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): the IDE title bar, activity bar and status bar`.

### Task 6: La barre latérale de l'IDE et les raccourcis

**Files:**
- Create: `apps/desktop/src/ide/IdeExplorer.tsx`
- Modify: `apps/desktop/src/shell/sidebar/Sidebar.tsx` (prop `section`), `apps/desktop/src/nav/useKeys.ts` (option `ide`)
- Test: `apps/desktop/test/ide/explorer.test.tsx`, `apps/desktop/test/keys.test.tsx` (ajouts)

**Interfaces:**
- Consumes : `SideView`, `layoutReducer` (tâche 2).
- Produces :
  - `Sidebar` reçoit `section?: SideView`. Quand elle est donnée, elle ne rend que le contenu de cette vue, sans l'entrée Ledge, `st-views`, `st-grouping` ni `st-foot` : `projects` = `Tree` + `Archives` ; `rigs` = `RigGroups` ; `atoi` = `Attention`. Sans `section`, la barre latérale reste exactement celle d'aujourd'hui.
  - `IdeExplorer(p: { width: number; onLayout(a: LayoutAction): void; children: ReactNode })` : l'enveloppe. Le bord `.ide-resize` (5 px, `title` « Glisser pour redimensionner · double-clic : largeur par défaut ») envoie `drag` pendant le mouvement et `drop` au lâcher, et `resetWidth` au double-clic. En bas, le bouton « « Réduire » (`title` « Réduire la barre latérale (Ctrl+B) ») envoie `show side false`.
  - `useKeys(dispatch, { …, ide?: { toggle(panel: 'side' | 'bottom' | 'right'): void } })` : quand `ide` est donné, `Ctrl+B`, `Ctrl+J` et `Ctrl+/` appellent `ide.toggle`. `/` seul (hors champ) envoie `{ type: 'ledge' }` comme aujourd'hui : `routeNav` en fait l'ouverture du panneau de droite. La règle `[data-terminal]` reste en tête, donc rien n'est volé à un xterm.

- [ ] **Step 1: Tests qui échouent.**
  - `explorer.test.tsx` : `mousedown` sur le bord, `mousemove` à `clientX` 300 puis `mouseup` → `onLayout` reçoit `drag`, puis `drop` avec `300 - 48` (le bord gauche de la barre). Double-clic → `resetWidth`. « « Réduire » → `show side false`.
  - `Sidebar section` : avec `section="atoi"`, une session en autorisation apparaît, et ni l'arbre des projets ni « Archives » ne sont rendus. Avec `section="projects"`, « Archives » est là, sans la ligne de l'entrée Ledge.
  - `keys.test.tsx` (Review Focus 4) : avec `ide`, `Ctrl+B` → `toggle('side')`, `Ctrl+J` → `toggle('bottom')`, `Ctrl+/` → `toggle('right')`. Le focus dans un `<textarea>` : `Ctrl+B` appelle quand même `toggle` (comme VS Code), mais `/` tape un caractère et n'envoie rien. Le focus dans un élément sous `[data-terminal]` : aucune des trois n'agit. Sans `ide` : `Ctrl+B` ne fait rien et `Ctrl+/` garde son effet actuel.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4:** PASS, et `pnpm --filter desktop test test/sidebar` (ou les fichiers `sidebar*`) reste vert.
- [ ] **Step 5:** Commit `feat(desktop): the IDE sidebar — one view at a time, resizable, Ctrl+B/J/`.

### Task 7: La zone d'édition dockview et l'assemblage dans `Shell`

**Files:**
- Create: `apps/desktop/src/ide/DockHost.tsx`, `apps/desktop/src/ide/IdeFrame.tsx`, `apps/desktop/src/ide/tabs.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/test/ide/tabs.test.ts`, `apps/desktop/test/ide/frame.test.tsx`

**Interfaces:**
- Consumes : tout ce qui précède.
- Produces :
  ```ts
  // tabs.tsx
  export function tabTitle(t: Tab, ctx: { session(id: string): Session | undefined; t: Messages }): string; // nom de la session, « Atelier », « Réglages », « OpenRig · <machine> »
  export type TabBody = (tab: Tab) => ReactNode;  // fourni par Shell : SessionPlace (avec tabNav), Atelier, SettingsPlace, OpenRigPage
  // DockHost.tsx : synchronise le groupe principal du modèle avec dockview, dans les deux sens
  DockHost(p: { ws: Workspace; store: WorkspaceStore; title(t: Tab): string; body: TabBody })
  // IdeFrame.tsx : la coque entière
  IdeFrame(p: { layout: IdeLayout; onLayout(a: LayoutAction): void; explorer: ReactNode; editor: ReactNode; chat: ReactNode; footer: ReactNode; … })
  ```
- `DockHost` : `DockviewReact` avec `disableDnd` (le glisser arrive au lot 3), un panneau dockview par onglet du groupe focalisé (`id = keyOf(tab)`), le titre via `title`. Modèle → dockview : on ajoute, retire et active pour suivre `ws`. Dockview → modèle : `onDidActivePanelChange` appelle `activate`, la fermeture d'un onglet appelle `close`. Seul le panneau visible rend son contenu (`renderer: 'onlyWhenVisible'`, le défaut).
- `Shell` (`App.tsx`) : `const [ide] = useIdeEnabled()`. Quand `ide` est vrai :
  - un `WorkspaceStore` créé une fois (`loadWorkspace()`), et `useStored(loadLayout, saveLayout)` ;
  - `ideDispatch(a)` = `routeNav(a, { isSeat: id => known.find(s => s.id === id)?.rig != null, modalOpen: nav.modal !== null })`, puis on applique `nav`, `ws` et `layout`. Ce `ideDispatch` remplace `dispatch` pour tous les enfants (Sidebar, contenus d'onglets, palette, `useKeys`, `onOpenTarget`, `onAtelier`, la barre des notifications) ;
  - `reconcile` du modèle sur `known`, dans le même effet que celui de la `NavState` (Review Focus 1) ;
  - le rendu : `IdeFrame` au lieu de `TitleBar` + `.application`. Les dialogues, `SessionMenuHost`, `WhatsNew`, `ConfirmDialog`, `PairingDialog` et `Toast` sont rendus comme avant ;
  - le panneau de droite : `ChatPlace` sans `onClose` (le × de la maquette n'existe pas, `Ctrl+/` le masque), visible quand `layout.right && rightFits(layout, innerWidth)` ;
  - le panneau du bas : un cadre de 240 px avec deux onglets en icônes, Terminaux et Sortie (les icônes de la maquette `bottomPanel()`), et × (« Masquer le panneau »). Leur contenu arrive au lot 5. Le texte du cadre vide est à demander à `design-ux` avant la PR ; en attendant, le panneau reste vide ;
  - activer l'IDE alors que `nav.place` est une session ouvre son onglet (Review Focus 3). La `NavState` continue d'être tenue à jour, donc couper l'IDE retombe sur la même session.
- La CSS `dockview-react/dist/styles/dockview.css` s'importe dans `DockHost.tsx`, dans le chunk de l'IDE et non dans le premier bundle. `IdeFrame` se charge en `lazy` comme `SessionPlace` (voir `session/lazy.tsx`).

- [ ] **Step 1: Tests qui échouent.**
  - `tabs.test.ts` : `tabTitle` d'une session connue → son nom. Session inconnue → `ref`. `atelier:main` → « Atelier ». `openrig:srv-build` → « OpenRig · srv-build ».
  - `frame.test.tsx`, avec `App` et la flotte simulée (`test/fleet-helpers.ts`, comme `test/app.test.tsx`), `ledge.ide.enabled = true`. jsdom n'a pas `ResizeObserver` : on en pose un factice dans le test. Si dockview ne se monte pas sous jsdom, on remplace `DockHost` par un rendu de la liste des onglets avec `vi.mock`, et la vraie surface passe au contrôle e2e de la tâche 8.
    - le titre « Ledge », la barre d'activité et la barre d'état sont rendus, et pas la `TitleBar` « Commande » ;
    - au premier lancement, l'onglet actif est « Atelier » ;
    - un clic sur une session de la vue Projets ouvre un onglet portant son nom. Un second clic n'en ouvre pas d'autre ;
    - `Ctrl+/` masque puis rend le chat ;
    - Review Focus 3 : avec l'IDE coupé, ouvrir une session puis mettre l'IDE → son onglet est actif. Le couper → la page de session de l'interface actuelle est rendue ;
    - avec l'IDE coupé, `test/app.test.tsx` passe sans retouche.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implémenter** dans l'ordre `tabs.tsx`, `DockHost.tsx`, `IdeFrame.tsx`, puis le branchement dans `App.tsx`.
- [ ] **Step 4:** `pnpm --filter desktop test` en entier → PASS. `pnpm --filter desktop typecheck` → aucune erreur.
- [ ] **Step 5:** Commit `feat(desktop): the IDE shell behind its switch — dockview editor, chat panel, bottom frame`.

### Task 8: e2e et comparaison avec la maquette

**Files:**
- Create: `apps/desktop/e2e/ide-shell.spec.ts`

- [ ] **Step 1: Écrire le spec**, sur le modèle de `e2e/atelier.spec.ts` (le daemon simulé de `e2e/daemon.ts`), en 1920×1080 avec `ledge.ide.enabled = 'true'` posé par `addInitScript` :
  - la grille : la barre de titre fait 34 px, la barre d'état 24 px, la barre d'activité 48 px, la barre latérale 248 px et le panneau de droite 300 px (`boundingBox`) ;
  - glisser le bord de la barre latérale à 100 px → elle se replie. `Ctrl+B` la rend à 248 px ;
  - `Ctrl+J` montre le panneau du bas, de 240 px ;
  - ouvrir deux sessions → deux onglets dockview, avec le nom de chacune ; un clic sur le premier rend son fil ;
  - une capture `ide-shell.png`, à comparer à l'œil avec la maquette v26 en 1920×1080 (alignements, hauteurs, séparateurs). Les écarts vont dans le compte rendu de la PR.
- [ ] **Step 2:** `pnpm --filter desktop e2e ide-shell` → PASS. Puis `pnpm --filter desktop e2e` en entier → les specs existants restent verts.
- [ ] **Step 3:** Commit `test(desktop): e2e of the IDE shell at 1920×1080`.

### Task 9: Vérification sous Windows et PR

- [ ] **Step 1:** Construire l'installeur selon la recette Windows du projet (powershell.exe depuis `C:\Users\Desan\Workspace\ledge`), activer l'aperçu et vérifier trois choses : la barre de titre se glisse et se maximise par double-clic, `WindowCaps` répond, et dockview ne capte pas de glisser de fichiers (`dragDropEnabled: false` est déjà posé sur la fenêtre principale).
- [ ] **Step 2:** Pousser `feat/ide-lot-1` et ouvrir la PR vers `main`. Le compte rendu dit quoi essayer : la branche, le commit, Réglages › Général › « Interface IDE (aperçu) », `Ctrl+B` / `Ctrl+J` / `Ctrl+/`, ouvrir deux sessions. Il liste les écarts avec la maquette et les deux questions pour `design-ux` (le cadre vide du panneau du bas, l'état sous 1280 px).
- [ ] **Step 3:** Revue `review-qa`, puis fusion sur accord de l'utilisateur.
