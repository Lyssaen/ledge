# Ledge Desktop Atelier, lot 3 : squelette — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La coquille de Ledge Desktop telle que la maquette la montre (barre latérale, barre du haut, pied de page), branchée sur le fleet et les projets du daemon. S'y ajoutent la navigation entre vue d'ensemble, session et réglages, le filtre de projet, Échap, les raccourcis globaux, la recherche Ctrl K et l'aide des raccourcis. Les écrans des lots suivants sont des emplacements « à venir ».

**Architecture:** Un état de navigation pur (`src/nav/`) décrit où l'on est (`Place`) et ce qui est ouvert (fenêtre modale, chat, plein écran). Un réducteur testé le fait évoluer, et seules les préférences d'affichage sont mémorisées. La coquille (`src/shell/`) le rend avec les composants de l'overlay, déplacés dans `@ledge/ui` en tâche 1. Les raccourcis globaux sont un seul écouteur clavier qui traduit les touches en actions du réducteur. Chaque écran pas encore construit (Atelier, Liste, Session, Réglages, Nouvelle session, Projet, Chat) rend `Pending` à sa place, et le lot qui le construit le remplace.

**Tech Stack:** TypeScript, React 19, Vite 6, Tailwind 4 (styles à la main dans `src/styles/`), Tauri 2 (`@tauri-apps/api/window`), vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` (§ 2 non-objectifs : pas de réglages de l'île ni d'état de l'île dans le pied de page ; § 4 composants ; § 7 lot 3). Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` §§ 2.4 (plein écran), 2.5, 2.7 (fil d'Ariane de session, sans sous-agent), 3, 7 (liste des sections), 9. Maquette : `docs/mockups/desktop-observatory/observatory.tsx` (rendu à partir de `return <LangProvider`, clavier dans le second `useEffect` `onKey`), `sidebar.css`, `observatory.css`, `office.css` (lignes 200-310). Page construite : `docs/mockups/ledge-desktop-observatory.html`.

## Global Constraints

- Worktree `.worktrees/desktop-atelier`, branche `feat/desktop-atelier`.
- **La maquette fait foi** pour la disposition, les classes CSS et les icônes. Le style est porté depuis ses CSS (sélecteurs repris tels quels quand c'est possible) et les tracés d'icônes depuis `observatory.tsx` (`gridIcon`, `listIcon`, `chatIcon`, `searchIcon`, `helpIcon`, `collapseIcon`, `subagentsIcon`, `subagentsOffIcon`, `pauseIcon`, `playIcon`, `unassignedIcon`, `terminalIcon`) et `settings.tsx` (`gearIcon`).
- **Textes** dans `src/i18n/messages.ts`, `fr` source de vérité, `en` traduit. Les textes français ci-dessous sont exacts ; l'implémenteur écrit l'anglais. Pas de titre de page : le fil d'Ariane dit où l'on est (spec Atelier § 2.5).
- **Le harnais n'est jamais écrit** dans les vues d'ensemble ; il est cherchable (Ctrl K) par son nom : `Claude Code`, `Codex`, `Cursor Agent`.
- **Pas d'état de l'île** dans le pied de page (build spec § 2). Le pied de page porte « Sessions locales et SSH » et les rappels Ctrl K, / et ?.
- **Le thème** ne se règle pas dans la coquille (spec Atelier § 2.5).
- Clés locales préfixées `desktop.` et validées champ par champ. Ce lot ajoute **`desktop.overview`** = `{ view: 'atelier' | 'list', helpers: boolean, paused: boolean }` (défaut `{ view: 'atelier', helpers: true, paused: false }`). Ce qui n'est **pas** mémorisé : le filtre de projet, la session ouverte, la section de réglages, le chat et le plein écran. Les noms de `OBSOLETE_KEYS` (lot 1) ne sont jamais réutilisés.
- **Agent principal** = une `Session` du fleet. Les sous-agents sont les `helpers` d'une session et ne sont pas des places dans ce lot.
- **Ordre des agents principaux** (`mainOrder`, partagé avec les lots 4 et 5 qui l'utiliseront pour asseoir et lister) : d'abord par projet, dans l'ordre de `projects.projects`, puis « Sans projet » ; dans chaque groupe, par `startedAt` croissant, puis par `id`.
- Aucune erreur console dans Playwright (fixture du lot 1).
- Pas de `cargo` dans ce WSL. Le seul changement côté Tauri est la permission JSON du plein écran.
- Commits `refactor(ui): …`, `feat(desktop): …`, `test(desktop): …`, terminés par la ligne `Co-Authored-By` de la session.

## Review Focus

1. **Saisie en cours** : quand le focus est dans un champ (la recherche, plus tard la réponse), N, /, ? et Alt 1…9 ne font rien. Ctrl K, Ctrl , et Échap marchent toujours. Test ajouté à la tâche 4.
2. **Plusieurs couches ouvertes** (recherche ouverte au-dessus d'une session filtrée sur un projet, en plein écran) : chaque Échap ferme **une** couche, dans l'ordre fenêtre modale → chat → réglages → session → filtre → plein écran. Test ajouté aux tâches 2 et 4.
3. **Projet filtré qui disparaît**, ou daemon qui n'a jamais envoyé de projets (`useProjects` → `null`) : le filtre retombe sur « tous les projets », le fil d'Ariane dit « Atelier », sans erreur. Test ajouté aux tâches 2 et 3.
4. **Session ouverte qui disparaît du fleet** (terminée puis retirée, ou machine retirée) : on revient à la vue d'ensemble d'où elle avait été ouverte, avec son filtre. Une session figée hors ligne (`offline`) reste ouverte. Test ajouté aux tâches 2 et 3.
5. **Noms longs** de projet ou de machine : tronqués avec « … » dans la barre latérale et le fil d'Ariane, nom complet en info-bulle (`title`) ; la barre du haut ne passe jamais sur deux lignes. Test ajouté à la tâche 3 (attribut `title`) et à la tâche 5 (largeur 1000 px).

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/ui/src/ui/{Button,Badge,Kbd,Tabs,icons,BranchChip}.tsx` | Déplacés depuis `apps/overlay/src/ui/` |
| `packages/ui/src/i18n/copy.tsx` | `UiCopy.stateLabel` |
| `apps/overlay/src/ui/*.tsx` | Réexportent `@ledge/ui/ui/*` |
| `apps/overlay/src/i18n/lang.tsx`, `apps/desktop/src/i18n/lang.tsx` | Fournissent `stateLabel` |
| `apps/desktop/src/nav/state.ts` | Nouveau : `Place`, `NavState`, `navReducer`, `reconcile` |
| `apps/desktop/src/nav/overview.ts` | Nouveau : `desktop.overview` |
| `apps/desktop/src/nav/agents.ts` | Nouveau : `mainOrder`, `searchSessions`, `toolName`, `taskOf`, `dotOf` |
| `apps/desktop/src/nav/useKeys.ts` | Nouveau : raccourcis globaux |
| `apps/desktop/src/shell/{Sidebar,TopBar,Footer,Pending,SearchPalette,ShortcutsHelp,Modal}.tsx` | Nouveaux |
| `apps/desktop/src/shell/icons.ts` | Nouveau : tracés de la maquette |
| `apps/desktop/src/shell/fullscreen.ts` | Nouveau |
| `apps/desktop/src/shell/Waiting.tsx` | Supprimé |
| `apps/desktop/src/App.tsx` | La coquille |
| `apps/desktop/src/styles/{app,shell,sidebar}.css` | Style porté de la maquette |
| `apps/desktop/src-tauri/capabilities/default.json` | `core:window:allow-set-fullscreen`, `core:window:allow-is-fullscreen` |
| `apps/desktop/test/*`, `apps/desktop/e2e/boot.spec.ts`, `apps/desktop/e2e/shell.spec.ts` | Tests |

---

### Task 1: Les contrôles de l'overlay dans `@ledge/ui`

**Files:**
- Create: `packages/ui/src/ui/Button.tsx`, `Badge.tsx`, `Kbd.tsx`, `Tabs.tsx`, `icons.tsx`, `BranchChip.tsx` (contenu déplacé avec `git mv`), `packages/ui/test/badge.test.tsx`
- Modify: `apps/overlay/src/ui/*.tsx` (chacun devient `export * from '@ledge/ui/ui/<Nom>';`), `packages/ui/package.json` (`exports` : `"./ui/*": "./src/ui/*.tsx"`), `packages/ui/src/index.ts`, `packages/ui/src/i18n/copy.tsx`, `apps/overlay/src/i18n/lang.tsx`, `apps/desktop/src/i18n/lang.tsx`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : `transition` (`@ledge/ui/motion`), `BotState` (`@ledge/ui/bots/poseFor`), `useUiCopy` (`@ledge/ui/i18n/copy`).
- Produces :
  - `@ledge/ui/ui/Button` (`Button`), `@ledge/ui/ui/Badge` (`Badge`, `BADGE`), `@ledge/ui/ui/Kbd` (`Kbd`), `@ledge/ui/ui/Tabs` (`Tabs`), `@ledge/ui/ui/icons` (`Icon`, `ICONS`), `@ledge/ui/ui/BranchChip`, avec les mêmes signatures qu'aujourd'hui ;
  - `UiCopy.stateLabel: Record<BotState, string>`. `Badge` lit `label ?? useUiCopy().stateLabel[state]` au lieu de `useI18n().t.state` ;
  - Desktop : `messages.stateLabel` (fr : `{ approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' }`, comme `state` de l'overlay).

- [ ] **Step 1: Écrire `packages/ui/test/badge.test.tsx`**

```tsx
it('labels a state from the app copy, a given label wins', () => {
  const copy = { ...defaultCopy, stateLabel: { ...defaultCopy.stateLabel, approval: 'Your approval' } };
  render(<UiCopyProvider copy={copy}><Badge state="approval" /><Badge state="question" label="Hors ligne" /></UiCopyProvider>);
  expect(screen.getByText('Your approval')).toHaveAttribute('data-badge', 'approval');
  expect(screen.getByText('Hors ligne')).toHaveAttribute('data-badge', 'question');
});
```

`defaultCopy` est obtenu avec `useUiCopy()` hors fournisseur, dans un `renderHook`. Le défaut français de `copy.tsx` gagne un `stateLabel` français.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter @ledge/ui exec vitest run test/badge.test.tsx`
Expected : FAIL, `@ledge/ui` n'a pas de `ui/Badge`.

- [ ] **Step 3: Déplacer et rebrancher**

- `git mv` des six fichiers ; leurs imports relatifs deviennent ceux du paquet (`../motion`, `../bots/poseFor`, `../i18n/copy`).
- Chaque fichier de `apps/overlay/src/ui/` réexporte, comme `apps/overlay/src/bots/Bot.ts` : les 39 imports de l'overlay ne changent pas.
- Ajouter `stateLabel` au `uiCopy` de l'overlay (`m.state`) et de Desktop (`m.stateLabel`).
- Si `Tabs` ou `BranchChip` lit une autre chaîne de l'overlay, la passer de la même façon par `UiCopy`. Ne rien laisser dans `@ledge/ui` qui importe depuis `apps/`.

- [ ] **Step 4: Vérifier les trois paquets**

Run: `pnpm --filter @ledge/ui test && pnpm -r typecheck && pnpm --filter overlay test && pnpm --filter desktop test`
Expected : tout passe. L'overlay garde 563 tests sur 564 au minimum ; seul `prototype-parity` « drafts survive view and connection changes » peut échouer, et seulement en suite complète.

- [ ] **Step 5: Commit**

```bash
git add packages/ui apps/overlay/src apps/desktop/src
git commit -m "refactor(ui): Button, Badge, Kbd, Tabs, icons and BranchChip move to @ledge/ui, badge labels through UiCopy"
```

### Task 2: L'état de navigation

**Files:**
- Create: `apps/desktop/src/nav/state.ts`, `apps/desktop/src/nav/overview.ts`, `apps/desktop/src/nav/agents.ts`, `apps/desktop/test/nav-state.test.ts`, `apps/desktop/test/nav-agents.test.ts`

**Interfaces:**
- Consumes : `Session` (`@ledge/protocol`), `Projects` (`@ledge/protocol`), `projectOf` (`@ledge/fleet`), `botState` (`@ledge/ui/bots/poseFor`), `readJson` et `writeJson` (`src/state/storage.ts`).
- Produces, dans `nav/state.ts` :

```ts
export type View = 'atelier' | 'list';
/** 'all', 'none' (Sans projet) or a project id. */
export type ProjectFilter = string;
export type SectionId = 'general' | 'appearance' | 'notifications' | 'sounds' | 'machines' | 'projects' | 'shortcuts' | 'about';
export const SECTIONS: readonly SectionId[];
export type Place =
  | { kind: 'overview'; view: View; project: ProjectFilter }
  | { kind: 'session'; id: string; view: View; project: ProjectFilter }   // view/project: where it was opened from
  | { kind: 'settings'; section: SectionId; back: Exclude<Place, { kind: 'settings' }> };
export type Modal = 'search' | 'shortcuts' | 'launch' | 'project' | null;
export interface NavState { place: Place; modal: Modal; chat: boolean; fullscreen: boolean; helpers: boolean; paused: boolean }
export type NavAction =
  | { type: 'home'; project?: ProjectFilter }           // overview of the current view, filter given or 'all'; closes settings and session
  | { type: 'view'; view: View }
  | { type: 'open'; id: string }                        // a session, from the current overview (or the overview the current session came from)
  | { type: 'settings'; section?: SectionId }           // defaults to 'general'; from settings, changes section and keeps `back`
  | { type: 'modal'; modal: Modal }
  | { type: 'chat'; open?: boolean }                    // toggles without `open`
  | { type: 'fullscreen'; on: boolean }
  | { type: 'helpers' } | { type: 'paused' }
  | { type: 'escape' };
export function initialNav(overview: Overview): NavState;
export function navReducer(s: NavState, a: NavAction): NavState;
/** Drops what no longer exists: a session gone from `sessions` (offline ones stay), a project filter naming no project. `projects` null = unknown, filters other than 'all'/'none' fall back to 'all'. Returns `s` itself when nothing changes. */
export function reconcile(s: NavState, sessions: readonly Session[], projects: Projects | null): NavState;
```

- Dans `nav/overview.ts` : `export interface Overview { view: View; helpers: boolean; paused: boolean }`, `OVERVIEW_KEY = 'desktop.overview'`, `loadOverview(): Overview`, `saveOverview(o: Overview): void`.
- Dans `nav/agents.ts` :
  - `toolName(tool: Session['tool']): string` (`Claude Code`, `Codex`, `Cursor Agent`) ;
  - `taskOf(s: Session): string` (`topic ?? title`) ;
  - `mainOrder(sessions: readonly Session[], projects: Projects | null): Session[]` ;
  - `searchSessions(sessions: readonly Session[], query: string, projectName: (s: Session) => string): Session[]` : sans accents ni casse, sur le nom, la tâche, le nom du harnais, `machineName` et le nom de projet ; une requête vide renvoie tout, dans l'ordre reçu ;
  - `type Dot = 'working' | 'approval' | 'question' | 'done' | 'offline' | 'error'` et `dotOf(s: Session): Dot` : `offline` d'abord, puis `waiting_permission` → `approval`, `waiting_input` → `question`, `exited` et `idle` → `done`, `error` → `error`, le reste → `working`.

- [ ] **Step 1: Écrire `test/nav-state.test.ts`**

```ts
const o: Overview = { view: 'atelier', helpers: true, paused: false };
const s0 = initialNav(o);
const sess = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { machineId: 'local', ...extra });

it('starts on the overview of the stored view, nothing open', () => {
  expect(s0).toEqual({ place: { kind: 'overview', view: 'atelier', project: 'all' }, modal: null, chat: false, fullscreen: false, helpers: true, paused: false });
  expect(initialNav({ ...o, view: 'list' }).place).toEqual({ kind: 'overview', view: 'list', project: 'all' });
});
it('opens a session from a filtered overview and comes back to it', () => {
  let s = navReducer(s0, { type: 'home', project: 'ledge' });
  s = navReducer(navReducer(s, { type: 'view', view: 'list' }), { type: 'open', id: 'local:otto' });
  expect(s.place).toEqual({ kind: 'session', id: 'local:otto', view: 'list', project: 'ledge' });
  expect(navReducer(s, { type: 'escape' }).place).toEqual({ kind: 'overview', view: 'list', project: 'ledge' });
});
it('settings remember where they were opened from; a section change keeps it', () => {
  const inSession = navReducer(s0, { type: 'open', id: 'local:otto' });
  let s = navReducer(inSession, { type: 'settings' });
  expect(s.place).toEqual({ kind: 'settings', section: 'general', back: inSession.place });
  s = navReducer(s, { type: 'settings', section: 'machines' });
  expect(s.place).toMatchObject({ section: 'machines', back: inSession.place });
  expect(navReducer(s, { type: 'escape' }).place).toEqual(inSession.place);
});
it('escape closes one layer at a time: modal, chat, settings, session, filter, fullscreen', () => {
  let s = navReducer(s0, { type: 'home', project: 'ledge' });
  s = navReducer(s, { type: 'open', id: 'local:otto' });
  s = navReducer(navReducer(navReducer(navReducer(s, { type: 'fullscreen', on: true }), { type: 'settings' }), { type: 'chat' }), { type: 'modal', modal: 'search' });
  const steps: NavState[] = [];
  for (let i = 0; i < 7; i++) { s = navReducer(s, { type: 'escape' }); steps.push(s); }
  expect(steps.map(x => [x.modal, x.chat, x.place.kind, x.place.kind !== 'settings' ? x.place.project : '-', x.fullscreen])).toEqual([
    [null, true, 'settings', '-', true],
    [null, false, 'settings', '-', true],
    [null, false, 'session', 'ledge', true],
    [null, false, 'overview', 'ledge', true],
    [null, false, 'overview', 'all', true],
    [null, false, 'overview', 'all', false],
    [null, false, 'overview', 'all', false]
  ]);
});
it('the view change and home keep the place kind sensible', () => {
  const inSession = navReducer(s0, { type: 'open', id: 'local:otto' });
  expect(navReducer(inSession, { type: 'home' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
  expect(navReducer(s0, { type: 'view', view: 'list' }).place).toEqual({ kind: 'overview', view: 'list', project: 'all' });
});
it('reconcile drops a gone session and a gone project filter, keeps an offline session, returns the same object when nothing changes', () => {
  const projects: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [] }], rules: [] };
  let s = navReducer(navReducer(s0, { type: 'home', project: 'ledge' }), { type: 'open', id: 'local:otto' });
  expect(reconcile(s, [sess('otto', { id: 'local:otto', offline: true })], projects)).toBe(s);
  expect(reconcile(s, [], projects).place).toEqual({ kind: 'overview', view: 'atelier', project: 'ledge' });
  expect(reconcile(s, [], { projects: [], rules: [] }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
  expect(reconcile(navReducer(s0, { type: 'home', project: 'ledge' }), [], null).place).toMatchObject({ project: 'all' });
  expect(reconcile(navReducer(s0, { type: 'home', project: 'none' }), [], null).place).toMatchObject({ project: 'none' });
});
it('overview storage survives garbage and keeps valid fields', () => {
  localStorage.setItem('desktop.overview', JSON.stringify({ view: 'room', helpers: 'yes', paused: true }));
  expect(loadOverview()).toEqual({ view: 'atelier', helpers: true, paused: true });
  saveOverview({ view: 'list', helpers: false, paused: false });
  expect(loadOverview()).toEqual({ view: 'list', helpers: false, paused: false });
});
```

- [ ] **Step 2: Écrire `test/nav-agents.test.ts`**

```ts
const projects: Projects = { projects: [
  { id: 'b', name: 'Payment Service', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] },
  { id: 'a', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }
], rules: [] };
const s = (id: string, cwd: string, startedAt: string, extra: Partial<Session> = {}) => fakeSession(id, { id: `local:${id}`, machineId: 'local', cwd, startedAt, ...extra });
const list = [s('kit', '/tmp', '2026-10-16T08:00:00.000Z'), s('otto', '/w/ledge', '2026-10-16T09:00:00.000Z'), s('nova', '/w/pay/api', '2026-10-16T10:00:00.000Z'), s('rio', '/w/ledge', '2026-10-16T07:00:00.000Z')];

it('orders by project order, then Sans projet, then start time', () => {
  expect(mainOrder(list, projects).map(x => x.id)).toEqual(['local:nova', 'local:rio', 'local:otto', 'local:kit']);
  expect(mainOrder(list, null).map(x => x.id)).toEqual(['local:rio', 'local:kit', 'local:otto', 'local:nova']);
});
it('searches name, task, harness, machine and project without accents or case', () => {
  const named = (x: Session) => (projectOf(x, projects) === 'a' ? 'Ledge' : projectOf(x, projects) === 'b' ? 'Payment Service' : 'Sans projet');
  const one = [s('otto', '/w/ledge', '2026-10-16T09:00:00.000Z', { name: 'Otto', topic: 'Préparer la migration', tool: 'codex', machineName: 'Dev SSH' })];
  for (const q of ['otto', 'MIGRATION', 'preparer', 'codex', 'dev ssh', 'ledge']) expect(searchSessions(one, q, named)).toHaveLength(1);
  expect(searchSessions(one, 'claude', named)).toHaveLength(0);
  expect(searchSessions(list, '', named)).toEqual(list);
});
it('gives each session its sidebar dot', () => {
  expect(['working', 'waiting_permission', 'waiting_input', 'exited', 'idle', 'error', 'starting'].map(state => dotOf(fakeSession('x', { state: state as Session['state'] }))))
    .toEqual(['working', 'approval', 'question', 'done', 'done', 'error', 'working']);
  expect(dotOf(fakeSession('x', { state: 'waiting_permission', offline: true }))).toBe('offline');
});
```

`fakeSession` vient de `@ledge/fleet/test/mockDaemon`.

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/nav-state.test.ts test/nav-agents.test.ts`
Expected : FAIL, les modules `../src/nav/*` sont introuvables.

- [ ] **Step 4: Implémenter `nav/state.ts`, `nav/overview.ts` et `nav/agents.ts`**

- `escape`, couche par couche :
  1. `modal` → `null` ;
  2. sinon `chat` → `false` ;
  3. sinon en réglages → `back` ;
  4. sinon en session → `{ kind: 'overview', view, project }` de la session ;
  5. sinon un filtre ≠ `'all'` → `'all'` ;
  6. sinon `fullscreen` → `false` ;
  7. sinon rien (même objet).
- `open` depuis les réglages part de `back` ; `home` et `view` ferment les réglages et la session.
- `open` et `settings` ferment `modal` et `chat`, comme la maquette (`open`, `openSettings`).
- `mainOrder` regroupe avec `projectOf` et garde les sessions dont le projet a disparu dans « Sans projet ».

- [ ] **Step 5: Vérifier qu'ils passent**

Run: `pnpm --filter desktop exec vitest run test/nav-state.test.ts test/nav-agents.test.ts`
Expected : PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/nav apps/desktop/test/nav-state.test.ts apps/desktop/test/nav-agents.test.ts
git commit -m "feat(desktop): navigation state, overview preferences, agent order, search and dots"
```

### Task 3: La coquille : barre latérale, barre du haut, pied de page

**Files:**
- Create: `apps/desktop/src/shell/Sidebar.tsx`, `TopBar.tsx`, `Footer.tsx`, `Pending.tsx`, `Modal.tsx`, `icons.ts`, `apps/desktop/src/styles/shell.css`, `apps/desktop/src/styles/sidebar.css`, `apps/desktop/test/shell.test.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/app.css` (importe les deux feuilles, retire `.waiting`), `apps/desktop/src/i18n/messages.ts`, `apps/desktop/test/app.test.tsx`, `apps/desktop/test/app-tray.test.tsx`
- Delete: `apps/desktop/src/shell/Waiting.tsx` et les textes `waiting`

**Interfaces:**
- Consumes : tâche 1 (`Button`, `Badge`, `Kbd`, `Icon`, `ICONS`) ; tâche 2 (`NavState`, `navReducer`, `reconcile`, `loadOverview`, `saveOverview`, `mainOrder`, `taskOf`, `dotOf`, `SECTIONS`) ; `useFleet` (`src/fleet/useFleet.ts`), `useProjects` et `projectOf` (`@ledge/fleet`), `PROJECT_COLORS` (`@ledge/protocol`), `Bot` (`@ledge/ui/bots/Bot`), `ResidentMascot`, `botState`.
- Produces :
  - `Pending({ title }: { title: string })` : `<section className="pending" aria-label={title}>` avec `title` en `<h2>` et `t.pending` (fr : `Cet écran arrive bientôt.`). Les lots suivants remplacent chaque usage ;
  - `Modal({ title, onClose, wide?, children })` : `role="dialog"`, `aria-modal`, `aria-labelledby`, fond qui ferme au clic, bouton « Fermer » ;
  - dans `App.tsx`, `Shell` détient `useReducer(navReducer, …, initialNav(loadOverview()))`. Il appelle `saveOverview` quand `view`, `helpers` ou `paused` changent, et `dispatch` via `reconcile` à chaque changement de `sessions` ou `projects` (seulement si le résultat diffère) ;
  - le contenu selon la place : vue d'ensemble → `Pending` « Atelier » ou « Liste » ; session → `Pending` avec la tâche ; réglages → `Pending` avec le nom de section ; `chat` → `<aside className="ledge-chat-panel" aria-label="Chat Ledge">` contenant `Pending` « Chat Ledge » et un bouton « Fermer » ; `modal` `launch` → `Modal` « Nouvelle session » + `Pending` ; `modal` `project` → `Modal` « Nouveau projet » + `Pending`.

Textes français, dans `messages.ts` :

| Clé | fr |
| --- | --- |
| `side.label` | `Barre latérale` (en : `Sidebar`) |
| `side.newSession` | `Nouvelle session` |
| `side.search` | `Rechercher` |
| `side.searchLabel` | `Rechercher une session` |
| `side.views` | `Vues` |
| `side.atelier` | `Atelier` |
| `side.chat` | `Chat Ledge` |
| `side.projects` | `Projets` |
| `side.newProject` | `Nouveau projet` |
| `side.unassigned` | `Sans projet` |
| `side.machines` | `Machines` |
| `side.manageMachines` | `Gérer les machines` |
| `side.agents(n)` | `${n} agent` / `${n} agents` |
| `side.offline` | `hors ligne` |
| `side.settings` | `Réglages` |
| `crumb.atelier` | `Atelier` |
| `crumb.list` | `Liste` |
| `crumb.settings` | `Réglages` |
| `crumb.clearFilter` | `Retirer le filtre : voir tous les projets` |
| `crumb.clearFilterTitle` | `Tous les projets (Échap)` |
| `top.viewTabs` | `Vue des agents` |
| `top.helpersHide` / `top.helpersShow` | `Masquer les sous-agents` / `Afficher les sous-agents` |
| `top.pause` / `top.play` | `Figer les animations` / `Animer` |
| `top.search` | `Rechercher une session (Ctrl K)` |
| `top.chat` | `Chat Ledge (/)` |
| `top.shortcuts` | `Raccourcis clavier (?)` |
| `top.fullscreen` / `top.fullscreenExit` | `Plein écran` / `Quitter le plein écran` |
| `foot.sessions` | `Sessions locales et SSH` |
| `foot.search` | `Une session` |
| `foot.chat` | `Chat Ledge` |
| `foot.shortcuts` | `Raccourcis` |
| `sections` | `general: 'Général', appearance: 'Apparence', notifications: 'Notifications', sounds: 'Sons', machines: 'Machines', projects: 'Projets', shortcuts: 'Raccourcis', about: 'À propos'` |
| `pending` | `Cet écran arrive bientôt.` |
| `close` | `Fermer` |
| `modalTitles.launch` / `modalTitles.project` | `Nouvelle session` / `Nouveau projet` |

- [ ] **Step 1: Écrire `test/shell.test.tsx`**

Le harnais rend `App` sur `createMockDaemon` comme `app.test.tsx` :
- `d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }])` ;
- `d.projects(projects)` avec deux projets : `ledge` (dépôt `local:/w/ledge`) et `pay`, nommé `'Payment Service Platform Migration Europe'` (dépôt `local:/w/pay`) ;
- des sessions : Otto dans `/w/ledge` en `waiting_permission`, Nova dans `/w/pay` en `working`, Kit dans `/tmp` en `waiting_input`.

Assertions, en anglais (la suite tourne en anglais) :

```tsx
it('sidebar: views, projects with their dots, Sans projet, machines, settings', async () => {
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));   // <aside className="sidebar" aria-label={t.side.label}>
  expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent('3');          // active main agents
  const ledge = side.getByRole('button', { name: /^Ledge/ });
  expect(ledge.querySelectorAll('.side-dots i.dot-approval')).toHaveLength(1);
  expect(side.getByRole('button', { name: /Payment Service Platform/ }).querySelector('span')).toHaveAttribute('title', 'Payment Service Platform Migration Europe');
  expect(side.getByRole('button', { name: /No project/ })).toHaveTextContent('1');
  expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('3 agents');
});
it('a project row filters the overview; the crumb shows it and clears it', async () => {
  await user.click(side.getByRole('button', { name: /^Ledge/ }));
  const top = within(screen.getByRole('banner'));
  expect(top.getByText('Ledge')).toBeVisible();
  await user.click(top.getByRole('button', { name: 'Remove the filter: show every project' }));
  expect(top.getByText('Atelier')).toBeVisible();
});
it('the view tabs switch Atelier / List and the choice survives a remount', async () => {
  await user.click(screen.getByRole('tab', { name: 'List' }));
  expect(screen.getByRole('region', { name: 'List' })).toBeVisible();      // Pending
  expect(JSON.parse(localStorage.getItem('desktop.overview')!)).toMatchObject({ view: 'list' });
});
it('helpers and animation toggles are pressed buttons, remembered', async () => {
  await user.click(screen.getByRole('button', { name: 'Hide subagents' }));
  expect(screen.getByRole('button', { name: 'Show subagents' })).toHaveAttribute('aria-pressed', 'false');
});
it('a machine row opens Settings › Machines with its crumb', async () => {
  await user.click(side.getByRole('button', { name: /Dev SSH/ }));
  expect(within(screen.getByRole('banner')).getByText('Machines')).toBeVisible();
});
it('a filter naming a project the daemon removed falls back to every project', async () => {
  await user.click(side.getByRole('button', { name: /^Ledge/ }));
  d.projects({ projects: [], rules: [] });
  await waitFor(() => expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Remove the filter: show every project' })).toBeNull());
});
it('the footer says local and SSH sessions, and has no island state', () => {
  const foot = within(screen.getByRole('contentinfo'));
  expect(foot.getByText('Local and SSH sessions')).toBeVisible();
  expect(foot.queryByText(/island/i)).toBeNull();
});
```

Les textes anglais attendus ici fixent les traductions de ces clés : `Remove the filter: show every project`, `List`, `Hide subagents`, `Show subagents`, `No project`, `Local and SSH sessions`, `${n} agents`, `offline`.

Réécrire `app.test.tsx`, qui ne teste plus `Waiting` :
- démarrage sur le vrai fleet : le fil d'Ariane dit « Atelier » et la barre latérale liste la machine locale ;
- daemon absent : la machine locale est « offline » dans la barre latérale, sans exception ;
- langue enregistrée `fr` : `Sessions locales et SSH` dès le premier rendu.

`app-tray.test.tsx` garde ses deux cas ; « new » ouvre maintenant la fenêtre modale « New session » au lieu d'être ignoré.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/shell.test.tsx test/app.test.tsx test/app-tray.test.tsx`
Expected : FAIL, pas de barre latérale.

- [ ] **Step 3: Implémenter la coquille**

- La structure DOM et les classes viennent du rendu de la maquette : `.application` > `aside.sidebar` + `section.workspace` > `header.app-header` + contenu + `footer.workspace-footer`.
- `Sidebar` :
  - `side-brand` : `ResidentMascot` taille 30 et « Ledge » ;
  - `side-actions` : `Button` primaire « Nouvelle session » + `Kbd N` → `modal: 'launch'` ; bouton de recherche + `Kbd Ctrl K` → `modal: 'search'` ;
  - vues : « Atelier » avec le nombre d'agents principaux non `offline` et non `exited` → `home`, et « Chat Ledge » + `Kbd /` → `chat` ;
  - projets : pour chaque projet, la pastille `PROJECT_COLORS[color]` en `style`, le nom dans un `<span title={name}>` et jusqu'à 6 points `dot-<dotOf>`. Puis « Sans projet », s'il existe des agents sans projet, avec son compteur et la marque `side-alert` si l'un attend une décision ; le « + » ouvre `modal: 'project'` ;
  - machines : `machine-dot` (`off` si `status === 'unreachable'`) et `${n} agents` ou `hors ligne` → `settings`, section `machines` ;
  - pied de barre : « Réglages » + `Kbd Ctrl ,` → `settings`.
  - Le dépôt par glisser-déposer viendra au lot 4.
- `TopBar` : à gauche, le fil d'Ariane, avec l'icône et les éléments de la maquette :
  - vue d'ensemble : `<strong>Atelier|Liste</strong>`, ou le lien vers la vue suivi de `/` puis du `project-filter` (pastille, nom, ×) ;
  - session : vue / projet (lien vers `home` avec ce projet, ou « Sans projet ») / `Bot` taille 22 + nom en `strong` + `crumb-task` (`title` = tâche) ;
  - réglages : `Réglages` (lien vers la section `general`) / `strong` nom de section.
  
  À droite :
  - sur la vue d'ensemble seulement : les deux onglets icônes (`role="tablist"`, ← / → passent de l'un à l'autre), un séparateur, la bascule sous-agents et la bascule figer/animer (`aria-pressed`) ;
  - sur une session : le `Badge` de `botState`. Le terminal viendra au lot 6 ;
  - toujours : recherche, chat, raccourcis (`Button` ghost icon, `title` avec le raccourci), un séparateur, puis le plein écran.
- `Footer` : `footer-status` « Sessions locales et SSH » avec `connection-dot`, puis `keyboard-footer` avec trois boutons (`Kbd Ctrl K` Une session → recherche, `Kbd /` Chat Ledge → chat, `Kbd ?` Raccourcis → aide).
- Plein écran (`state.fullscreen`) : la classe `immersive` sur `.application` masque la barre latérale. L'appel natif est à la tâche 4 ; ici la bascule ne fait que changer l'état.
- CSS :
  - `sidebar.css` est copié de la maquette, en retirant les règles `swatch-<id>`, `is-dragging` et `drop-over` (lot 4) ;
  - `shell.css` reprend de `observatory.css` les règles de `.application`, `.sidebar` (largeur), `.workspace`, `.app-header`, `.breadcrumb`, `.header-actions`, `.workspace-footer`, `.modal-backdrop`, `.modal`, `.modal-title` et `.immersive .sidebar`, plus les `@media` qui les touchent ;
  - il reprend aussi de `office.css` les règles `view-actions-sep`, `project-filter`, `crumb-link`, `crumb-session`, `crumb-task`, `header-view`, `icon-tabs`, `footer-status` et `keyboard-footer` ;
  - `app.css` garde la base (de la maquette : `html, body, #root { height: 100% }`, `body { overflow: hidden }`, boutons sans bordure).

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): the Atelier shell: sidebar, top bar with crumbs and view controls, footer, places waiting for their lots"
```

### Task 4: Raccourcis globaux, recherche, aide et plein écran

**Files:**
- Create: `apps/desktop/src/nav/useKeys.ts`, `apps/desktop/src/shell/SearchPalette.tsx`, `apps/desktop/src/shell/ShortcutsHelp.tsx`, `apps/desktop/src/shell/fullscreen.ts`, `apps/desktop/test/keys.test.tsx`, `apps/desktop/test/search.test.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/i18n/messages.ts`, `apps/desktop/src/styles/shell.css`, `apps/desktop/src-tauri/capabilities/default.json`, `apps/desktop/test/tauri-config.test.ts`

**Interfaces:**
- Consumes : tâche 2 (`navReducer`, `NavAction`, `mainOrder`, `searchSessions`, `toolName`, `taskOf`) ; tâche 3 (`Modal`, `Shell`) ; `isTauri` (`src/tauri/bridge.ts`).
- Produces :
  - `useKeys(dispatch: (a: NavAction) => void, ctx: { state: NavState; order: readonly Session[] }): void` : un seul écouteur `keydown` sur `window` ;
  - `SearchPalette({ sessions, projectName, order, onOpen, onClose })` ;
  - `ShortcutsHelp({ onClose })` ;
  - `setWindowFullscreen(on: boolean): Promise<void>` dans `shell/fullscreen.ts` : `getCurrentWindow().setFullscreen(on)` dans Tauri, sinon `document.documentElement.requestFullscreen()` ou `document.exitFullscreen()`, les erreurs étant avalées. `Shell` l'appelle quand `state.fullscreen` change.

Règles de `useKeys` (maquette, `onKey`) :
- ignorer `e.isComposing` ;
- **toujours** :
  - Ctrl/⌘ K → `modal: 'search'` ;
  - Ctrl/⌘ , → `settings` ;
  - Échap → `escape` (avec `preventDefault`) ;
- **dans la recherche** (`modal === 'search'`) : rien d'autre ici, la palette gère ↑ ↓ Entrée ;
- **si une fenêtre modale est ouverte, si le focus est dans `input`, `textarea`, `select` ou `[contenteditable=true]`, ou si le chat est ouvert** : rien d'autre ;
- Alt + 1…9 → `open` du n-ième de `order` ; Alt + ← / → → session précédente ou suivante dans `order`, en boucle, à partir de la session ouverte (sinon la première ou la dernière) ;
- avec Ctrl, ⌘ ou Alt (cas restants) : rien ;
- `/` → `chat` ouvert ; `n` (hors réglages et hors session) → `modal: 'launch'` ; `?` → `modal: 'shortcuts'` ;
- en réglages, seuls `/` et `?` agissent.

Textes français :
- `search.title` : `Aller à une session` ;
- `search.placeholder` : `Agent, tâche, projet ou machine…` ;
- `search.empty` : `Aucune session ne correspond à cette recherche.` ;
- `search.footer` : `Parcourir`, `Ouvrir`, `Fermer` (avec `Kbd ↑ ↓`, `Kbd Entrée`, `Kbd Échap`) ;
- `shortcuts.title` : `Raccourcis clavier` ;
- traductions anglaises fixées par les tests : `Go to a session`, `No session matches this search.`, `Keyboard shortcuts`, `New session`, `Chat Ledge` ;
- les lignes de l'aide sont celles de `shortcutRows` de la maquette **sans** la ligne `Ctrl Alt N`, dans le même ordre et avec les mêmes textes, plus les deux paragraphes de la maquette (texte d'intro, puis le texte sur Ctrl K, Y et N).

- [ ] **Step 1: Écrire `test/keys.test.tsx`**

Il réutilise le harnais de `shell.test.tsx` (trois sessions, deux projets), avec `userEvent`.

```tsx
it('Ctrl K opens the search from anywhere, even while typing', async () => {
  await user.keyboard('{Control>}k{/Control}');
  expect(screen.getByRole('dialog', { name: 'Go to a session' })).toBeVisible();
  await user.keyboard('{Control>}k{/Control}');   // still one dialog
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});
it('single keys do nothing while typing in a field; Escape still closes', async () => {
  await user.keyboard('{Control>}k{/Control}');
  await user.keyboard('n/?');
  expect(screen.getByRole('combobox')).toHaveValue('n/?');
  expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('N opens New session, ? the shortcuts, / the chat', async () => {
  await user.keyboard('n'); expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible(); await user.keyboard('{Escape}');
  await user.keyboard('?'); expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible(); await user.keyboard('{Escape}');
  await user.keyboard('/'); expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
});
it('Alt 1…9 open the main agents in order; Alt → / ← walk them', async () => {
  await user.keyboard('{Alt>}1{/Alt}');
  expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible();     // Ledge first in project order
  await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
  expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
  await user.keyboard('{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}');
  expect(within(screen.getByRole('banner')).getByText('Kit')).toBeVisible();      // wraps around
});
it('Ctrl , opens settings; Escape walks back one layer at a time', async () => {
  await user.click(side.getByRole('button', { name: /^Ledge/ }));
  await user.keyboard('{Alt>}1{/Alt}{Control>},{/Control}');
  await user.keyboard('{Escape}'); expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible();
  await user.keyboard('{Escape}'); expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
  await user.keyboard('{Escape}'); expect(within(screen.getByRole('banner')).getByText('Atelier')).toBeVisible();
});
```

Dans ce harnais, `order` vaut `[Otto (Ledge), Nova (Payment…), Kit (Sans projet)]` : les projets sont fournis dans l'ordre `ledge`, `pay`.

- [ ] **Step 2: Écrire `test/search.test.tsx`**

```tsx
it('filters as you type, walks with arrows and opens with Enter', async () => {
  await user.keyboard('{Control>}k{/Control}');
  await user.keyboard('pay');
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([expect.stringContaining('Nova')]);
  await user.clear(screen.getByRole('combobox')); await user.keyboard('{ArrowDown}{Enter}');
  expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();     // second of the received order
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('says when nothing matches', async () => {
  await user.keyboard('{Control>}k{/Control}zzz');
  expect(screen.getByText('No session matches this search.')).toBeVisible();
});
it('shows Alt n on the first nine main agents', async () => {
  await user.keyboard('{Control>}k{/Control}');
  expect(screen.getByRole('option', { name: /Otto/ })).toHaveTextContent('Alt 1');
});
```

Dans `tauri-config.test.ts`, ajouter que `capabilities/default.json` contient `core:window:allow-set-fullscreen` et `core:window:allow-is-fullscreen`.

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/keys.test.tsx test/search.test.tsx test/tauri-config.test.ts`
Expected : FAIL, les touches n'ont pas d'effet et la palette n'existe pas.

- [ ] **Step 4: Implémenter**

- `SearchPalette` : structure et classes de la maquette (`palette-search`, `palette-results`, `palette-footer`).
  - Le champ `role="combobox"` est `autoFocus`, avec `aria-controls` et `aria-activedescendant`.
  - Les options `role="option"` portent `aria-selected`. Chacune affiche `Bot` taille 32, le nom, `· projet`, `tâche · machine`, le `Badge`, et `Kbd Alt n` pour les 9 premiers de `order`.
  - ↑ et ↓ bornent l'index ; Entrée ouvre ; le survol choisit ; l'index revient à 0 quand on tape.
- `ShortcutsHelp` : `shortcut-list` de la maquette.
- Les styles `command-palette`, `palette-*` et `shortcut-list` sont à trouver par `grep` dans `docs/mockups/desktop-observatory/*.css`, ou dans la page construite si absents des sources, et à copier dans `shell.css`.
- `useKeys` est monté dans `Shell`. `setWindowFullscreen` est appelé par un effet sur `state.fullscreen`. Le bouton plein écran envoie `fullscreen` avec `on: !state.fullscreen`.

- [ ] **Step 5: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`
Expected : tout passe.

- [ ] **Step 6: Commit**

```bash
git add -A apps/desktop
git commit -m "feat(desktop): global shortcuts, Ctrl K search, the shortcuts help and full screen"
```

### Task 5: Le squelette dans le navigateur

**Files:**
- Modify: `apps/desktop/e2e/boot.spec.ts`, `apps/desktop/e2e/daemon.ts` (option `projects` de `fakeDaemon` : envoyé après `machines`, et réponse à `projects.set`)
- Create: `apps/desktop/e2e/shell.spec.ts`

**Interfaces:**
- Consumes : tout ce qui précède ; `fakeDaemon`, `fakeRemote`, `session`, `eight` (`e2e/daemon.ts`).
- Produces : les scénarios que les lots suivants étendent.

- [ ] **Step 1: Mettre à jour `boot.spec.ts`**

Les quatre scénarios du lot 1 restent. Leurs assertions passent sur la coquille :
- le fil d'Ariane dit « Atelier » au lieu du titre « Ledge Desktop » ;
- « Local » s'affiche avec son nombre d'agents (`8 agents` avec `eight`), ou « offline », dans la barre latérale au lieu de la ligne d'état ;
- « Devbox » est « offline » dans la barre latérale.

- [ ] **Step 2: Écrire `shell.spec.ts`**

```ts
test('projects from the daemon in the sidebar, a filter from a click, cleared with Escape', async ({ page }) => {
  // twoProjects (defined in the spec file): Ledge with repo local:/w/ledge, Website with repo local:/w/website, the cwds of `eight`
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('button', { name: /^ledge/i }).click();
  await expect(page.getByRole('banner').getByText('ledge', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
});
test('Ctrl K finds a session by its task and opens it; Escape comes back', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('Luna');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('banner').getByText('Luna')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
});
test('the view choice survives a reload', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
});
test('at 1000 px the top bar stays on one line with a long project name', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await fakeDaemon(page, eight, { projects: { projects: [{ id: 'ledge', name: 'Payment Service Platform Migration Europe', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] } });
  await page.goto('/');
  await page.getByRole('button', { name: /Payment Service Platform/ }).click();
  const box = await page.getByRole('banner').boundingBox();
  expect(box!.height).toBeLessThanOrEqual(57);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
```

- [ ] **Step 3: Lancer Playwright**

Run: `pnpm --filter desktop e2e`
Expected : tous les scénarios passent (4 de `boot` + 4 de `shell`).

- [ ] **Step 4: Vérification du dépôt**

Run: `pnpm -r typecheck && pnpm test && pnpm -r build`
Expected : tout passe, sauf peut-être l'instabilité connue de l'overlay (`prototype-parity`), à signaler sans la corriger.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/e2e
git commit -m "test(desktop): the shell in the browser: projects, filter, search, view memory, a long name at 1000 px"
```
