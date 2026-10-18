# Ledge Desktop Atelier, lot 4 : l'atelier — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'atelier de la maquette à la place de l'emplacement « Atelier » du lot 3 : le bureau de Ledge, une table par projet avec ses agents, leurs feuilles, les sous-agents et leurs post-its, les plantes, la zone « Sans projet », le rangement par glisser-déposer ou « Ranger dans… », la mosaïque ajustée, le zoom, le déplacement et la légende. Le tout sur le vrai fleet et les projets du daemon.

**Architecture:** Toute la géométrie est pure et testée (`src/atelier/layout.ts`, `zoom.ts`, `plants.ts`) : longueur de table, places, bouts de table, post-its, choix des rangées de la mosaïque, bornes et calculs de zoom, plantes. Les composants (`ProjectTable`, `LedgeDesk`, `Unassigned`, `Atelier`) ne font que rendre ces résultats avec les classes de la maquette. Un seul crochet DOM (`useAtelierView`) mesure, ajuste, zoome et déplace ; jsdom ne mesurant rien, Playwright vérifie l'ajustement réel. Les touches propres à un écran passent par une seule couture (`useScreenKeys`) que l'écouteur global consulte après ses propres touches et ses gardes. Ranger un agent écrit une règle « dossier → projet » au daemon : rien n'est optimiste, l'agent change de table quand le daemon diffuse les projets.

**Tech Stack:** TypeScript, React 19, Vite 6, CSS à la main dans `src/styles/`, glisser-déposer HTML5 natif, propriété CSS `zoom` (comme la maquette), Tauri 2 (`@tauri-apps/api/window`), vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` § 7 lot 4. Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` §§ 2.1, 2.2, 2.3, 2.4, plus 2.5 (filtre), 3 (cibles de dépôt de la barre latérale), 5 (« Nouvelle session » d'une table ou d'un projet vide), 9 (+ / − / 0, Ctrl + molette, Espace + glisser, J / K, Entrée). Maquette : `docs/mockups/desktop-observatory/observatory.tsx` (rendu de l'atelier à partir de `<div className={\`office-shell`, ajustement dans le premier `React.useLayoutEffect`, `zoomAt` / `fitView` / `zoomTo` / `zoomStep`, l'effet suivant pour molette, glisser, double-clic et touches, `dragProps` / `dropProps` / `assign`), `office.tsx` (`TableTop`), `decor.tsx` et `decor.css` (`Plants`), `office.css`, `observatory.css` (ligne 3), `sidebar.css` (lignes 35-37). Page construite : `docs/mockups/ledge-desktop-observatory.html`.

## Global Constraints

- Worktree `.worktrees/desktop-atelier`, branche `feat/desktop-atelier`.
- **La maquette fait foi** pour la disposition, les classes, les CSS et les dessins de plantes. Les styles sont portés de ses CSS avec les sélecteurs tels quels. Deux écarts voulus : la couleur du projet passe par la variable `--project` posée sur `.project-room`, au lieu des règles `[data-project=…]` et `.swatch-<id>` injectées ; le conteneur `.prototype` de la maquette devient `.application`.
- **Rejeté (spec § 2.1), jamais rendu ni porté** : objets décoratifs sur les tables (seuls feuilles et post-its y sont), mur, fenêtre, étagère, horloge, tasse, « coin des idées », thèmes de décor, robot aspirateur, cactus. Les règles `office-wall`, `office-window`, `wall-*`, `shelf-books`, `wall-clock`, `office-plant`, `room-plant`, `coffee-cup`, `table-conversations` et `room-footer` ne sont pas portées.
- **Textes** dans `src/i18n/messages.ts`, `fr` source de vérité. Les textes français des tableaux sont exacts ; l'implémenteur écrit l'anglais, sauf les traductions fixées par les tests, que chaque tâche liste.
- **Le harnais n'est jamais écrit** dans l'atelier : la forme du bot le dit.
- **Agent principal** = une `Session`. **Sous-agent** = une entrée de `session.helpers` (`{ id, kind, task, state }`) : ce n'est pas une place, et un clic dessus ouvre la session de son parent (le lot 6 pourra viser le fil du sous-agent). Son nom affiché est `kind`, son bot a `tool` = celui du parent et la graine `${parent.id}:${helper.id}`.
- **Machine d'un agent** = `session.machineName` (le libellé de la machine, posé par le fleet : « Local », « Dev SSH »…), à défaut `machineId ?? 'local'`.
- **État d'une feuille** : il suit `botState` (un parent `idle` dont un sous-agent travaille est « au travail »). `waiting_permission` donne le marque-page rouge, `waiting_input` l'orange. `exited` **et `idle`** donnent le tampon ✓, comme `dotOf` du lot 3 qui range `idle` dans « terminé » : son tour est fini. `offline` donne une feuille grisée en pointillés et l'emporte sur tout le reste.
- **Rien d'optimiste** : ranger un agent appelle `fleet.setProjects(withRule(projects, ruleFor(session, projectId)))`, et l'agent ne bouge qu'à la diffusion des projets par le daemon.
- **Stockage** : aucune nouvelle clé. Le zoom n'est pas mémorisé : chaque chargement part de la vue ajustée. Les noms de `OBSOLETE_KEYS` ne sont jamais réutilisés.
- Aucune nouvelle dépendance. Aucune erreur console dans Playwright (fixture du lot 1). Pas de `cargo` dans ce WSL ; aucune permission Tauri nouvelle (`core:window:allow-is-fullscreen` et `core:event:allow-listen` sont déjà accordées).
- Suite unitaire en anglais. Commits `feat(desktop): …`, `test(desktop): …`, terminés par la ligne `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Ranger un agent alors que le daemon local est tombé ou trop ancien** : un message en clair dans le toast, l'agent reste dans « Sans projet », aucune exception. Test d'intégration (daemon fermé) et test unitaire (`DaemonOutdated`) ajoutés à la tâche 6.
2. **Plus de six agents principaux et plus de quatre sous-agents à une table** : six places, deux sous-agents par bout, et la pastille « +N à cette table » compte exactement les autres, sous-agents d'agents non assis compris. Elle ouvre la Liste filtrée sur le projet, et aucune plante ne se pose sous elle. Tests ajoutés aux tâches 2 et 3, scénario à la tâche 7.
3. **Touches de l'atelier pendant une saisie**, sous une fenêtre modale ou avec le chat ouvert : + / − / 0 / J / K / Espace ne font rien, alors que Ctrl K et Échap marchent. Tests ajoutés aux tâches 1 et 5.
4. **Un agent qui change de projet à la diffusion d'une règle** : il apparaît une seule fois, à sa nouvelle table, et quitte « Sans projet ». Un filtre « Sans projet » reste valide même vidé. Test ajouté à la tâche 6.
5. **Noms très longs** de projet, d'agent ou de tâche : l'étiquette du tapis tronque avec « … » et donne le nom complet en `title`, sans jamais sortir du tapis, et les feuilles coupent leurs lignes. Tests ajoutés à la tâche 3 (`title`) et à la tâche 7 (boîte de l'étiquette dans celle du tapis).

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/desktop/src/nav/screenKeys.ts` | Nouveau : la couture des touches d'écran |
| `apps/desktop/src/nav/{state,useKeys,agents}.ts` | `Modal` avec cible, `home` avec vue, touches d'écran, `activeCount` |
| `apps/desktop/src/shell/fullscreen.ts` | `onFullscreenLeft` |
| `apps/desktop/src/shell/Toast.tsx` | Nouveau : le message d'état de la maquette (`.toast`) |
| `apps/desktop/src/shell/{Sidebar,TopBar,Footer}.tsx` | Ordre de la coquille, cibles de dépôt, modales avec cible |
| `apps/desktop/src/atelier/layout.ts`, `zoom.ts`, `plants.ts` | Nouveaux : géométrie pure |
| `apps/desktop/src/atelier/{ProjectTable,Plants,LedgeDesk,Unassigned,Atelier}.tsx` | Nouveaux : rendu |
| `apps/desktop/src/atelier/useAtelierView.ts` | Nouveau : ajustement, zoom, déplacement (DOM) |
| `apps/desktop/src/atelier/filing.ts` | Nouveau : ranger un agent |
| `apps/desktop/src/App.tsx` | L'atelier à la place de `Pending`, toasts, rangement |
| `apps/desktop/src/styles/atelier.css` | Nouveau : style porté de `office.css`, `observatory.css`, `decor.css` |
| `apps/desktop/src/styles/{app,shell,sidebar}.css` | Import, ménage, règles de dépôt |
| `apps/desktop/test/*`, `apps/desktop/e2e/atelier.spec.ts` | Tests |

---

### Task 1: La coquille prête pour l'atelier

Ce sont les notes laissées par le lot 3 : une couture pour les touches d'écran, le plein écran qui suit la fenêtre, des fenêtres modales qui portent leur cible, une barre latérale qui prend l'ordre de la coquille, et le ménage.

**Files:**
- Create: `apps/desktop/src/nav/screenKeys.ts`, `apps/desktop/test/screen-keys.test.tsx`, `apps/desktop/test/fullscreen.test.ts`
- Modify: `apps/desktop/src/nav/state.ts`, `src/nav/useKeys.ts`, `src/nav/agents.ts`, `src/shell/fullscreen.ts`, `src/shell/Sidebar.tsx`, `src/shell/TopBar.tsx`, `src/shell/Footer.tsx`, `src/App.tsx`, `src/i18n/messages.ts`, `src/styles/shell.css`, `test/nav-state.test.ts`, `test/nav-agents.test.ts`, `test/shell.test.tsx`

**Interfaces:**
- Consumes : `NavState`, `navReducer`, `useKeys` (lot 3), `isTauri` (`src/tauri/bridge.ts`).
- Produces :

```ts
// nav/state.ts
export type Modal =
  | { kind: 'search' } | { kind: 'shortcuts' }
  | { kind: 'launch'; project?: string }               // project : la table ou le projet d'où on l'a demandée (lot 7)
  | { kind: 'project'; edit?: string; file?: string }  // edit : id du projet à modifier ; file : id de la session à y ranger (lot 8)
  | null;
// NavAction : { type: 'home'; project?: ProjectFilter; view?: View }   — `view` absent : la vue courante
// 'fullscreen' rend `s` lui-même quand `on` ne change rien.

// nav/screenKeys.ts
/** Une touche pour l'écran affiché ; true = prise (l'écouteur appelle alors preventDefault). */
export type ScreenKeyHandler = (e: KeyboardEvent) => boolean;
export interface ScreenKeys { current: ScreenKeyHandler | null }
export const ScreenKeysContext: React.Context<ScreenKeys>;   // défaut : un `{ current: null }` à lui
/** Inscrit l'écran tant qu'il est monté ; la dernière version du gestionnaire est toujours appelée. */
export function useScreenKeys(handler: ScreenKeyHandler): void;

// nav/useKeys.ts
export function useKeys(dispatch: (a: NavAction) => void, ctx: { state: NavState; order: readonly Session[]; screen: ScreenKeys }): void;

// nav/agents.ts
/** Agents principaux ni hors ligne ni terminés : le compteur « Atelier » et la bulle de Ledge. */
export function activeCount(sessions: readonly Session[]): number;

// shell/fullscreen.ts
/** Appelle `cb` quand la fenêtre quitte le plein écran d'elle-même : `fullscreenchange` sans élément dans un navigateur,
 *  `onResized` puis `isFullscreen() === false` dans Tauri. Renvoie la désinscription, sûre même avant la fin de l'inscription Tauri. */
export function onFullscreenLeft(cb: () => void): () => void;

// shell/Sidebar.tsx : props { nav, dispatch, sessions, machines, projects, order: readonly Session[], projectIdOf: (s: Session) => string | null }
```

Ordre dans `useKeys` après le lot 4 :
1. Ctrl/⌘ K, Ctrl , et Échap, toujours ;
2. recherche ouverte : rien d'autre ;
3. fenêtre modale, saisie ou chat : rien d'autre ;
4. Alt 1…9 et Alt ← / → ;
5. avec Ctrl, ⌘ ou Alt : rien ;
6. **`screen.current?.(e)`** : si `true`, `preventDefault` et fin ;
7. `/`, `?`, `n`.

Les lots 5 (J / K / F de la liste) et 6 (R / Y / N / O de la session) s'inscrivent de la même façon.

- [ ] **Step 1: Écrire `test/screen-keys.test.tsx`**

```tsx
const base = initialNav({ view: 'atelier', helpers: true, paused: false });
function Harness({ state, keys, dispatch }: { state: NavState; keys: ScreenKeys; dispatch: (a: NavAction) => void }) {
  useKeys(dispatch, { state, order: [], screen: keys });
  return <input aria-label="field" />;
}

it('hands a key to the screen once the global guards pass; a key it declines stays global', () => {
  const handler = vi.fn((e: KeyboardEvent) => e.key === 'j');
  const dispatch = vi.fn();
  render(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
  expect(fireEvent.keyDown(document.body, { key: 'j' })).toBe(false);          // prevented
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: '/' });
  expect(dispatch).toHaveBeenCalledWith({ type: 'chat', open: true });
});
it('never while typing, under a dialog or with the chat open; Escape and Alt stay global', () => {
  const handler = vi.fn(() => true);
  const dispatch = vi.fn();
  const { rerender } = render(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
  screen.getByRole('textbox', { name: 'field' }).focus();
  fireEvent.keyDown(document.activeElement!, { key: 'j' });
  (document.activeElement as HTMLElement).blur();
  rerender(<Harness state={{ ...base, modal: { kind: 'shortcuts' } }} keys={{ current: handler }} dispatch={dispatch} />);
  fireEvent.keyDown(document.body, { key: 'j' });
  rerender(<Harness state={{ ...base, chat: true }} keys={{ current: handler }} dispatch={dispatch} />);
  fireEvent.keyDown(document.body, { key: 'j' });
  rerender(<Harness state={base} keys={{ current: handler }} dispatch={dispatch} />);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  fireEvent.keyDown(document.body, { key: '1', altKey: true });
  expect(handler).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledWith({ type: 'escape' });
});
it('useScreenKeys registers while mounted and always calls the latest handler', () => {
  const keys: ScreenKeys = { current: null };
  function Screen({ answer }: { answer: boolean }) { useScreenKeys(() => answer); return null; }
  const { rerender, unmount } = render(<ScreenKeysContext.Provider value={keys}><Screen answer={false} /></ScreenKeysContext.Provider>);
  rerender(<ScreenKeysContext.Provider value={keys}><Screen answer={true} /></ScreenKeysContext.Provider>);
  expect(keys.current!(new KeyboardEvent('keydown', { key: 'x' }))).toBe(true);
  unmount();
  expect(keys.current).toBeNull();
});
```

- [ ] **Step 2: Écrire `test/fullscreen.test.ts`**

```ts
const win = vi.hoisted(() => ({ onResized: vi.fn(), isFullscreen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));
const inTauri = () => { (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}; };
const element = (value: Element | null) => Object.defineProperty(document, 'fullscreenElement', { value, configurable: true });
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; element(null); vi.clearAllMocks(); });

it('in a browser, calls back when the page leaves full screen, not when it enters', () => {
  const cb = vi.fn();
  const off = onFullscreenLeft(cb);
  element(document.body); document.dispatchEvent(new Event('fullscreenchange'));
  expect(cb).not.toHaveBeenCalled();
  element(null); document.dispatchEvent(new Event('fullscreenchange'));
  expect(cb).toHaveBeenCalledTimes(1);
  off(); document.dispatchEvent(new Event('fullscreenchange'));
  expect(cb).toHaveBeenCalledTimes(1);
});
it('in the app, asks the window after each resize, and unlistens', async () => {
  inTauri();
  let resized = () => {};
  const unlisten = vi.fn();
  win.onResized.mockImplementation(async (fn: () => void) => { resized = fn; return unlisten; });
  const cb = vi.fn();
  const off = onFullscreenLeft(cb);
  await vi.waitFor(() => expect(win.onResized).toHaveBeenCalled());
  win.isFullscreen.mockResolvedValueOnce(true); resized();
  win.isFullscreen.mockResolvedValueOnce(false); resized();
  await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  off();
  expect(unlisten).toHaveBeenCalled();
});
```

- [ ] **Step 3: Compléter `nav-state.test.ts`, `nav-agents.test.ts` et `shell.test.tsx`**

Dans `nav-state.test.ts`, les `modal: 'search'` deviennent `modal: { kind: 'search' }`. On y ajoute :

```ts
it('home may switch the view too (the « +N » pill opens the List on its project)', () => {
  expect(navReducer(s0, { type: 'home', project: 'ledge', view: 'list' }).place).toEqual({ kind: 'overview', view: 'list', project: 'ledge' });
});
it('dialogs carry their target; full screen off when already off changes nothing', () => {
  expect(navReducer(s0, { type: 'modal', modal: { kind: 'launch', project: 'ledge' } }).modal).toEqual({ kind: 'launch', project: 'ledge' });
  expect(navReducer(s0, { type: 'fullscreen', on: false })).toBe(s0);
});
```

Dans `nav-agents.test.ts` :

```ts
it('counts the active main agents', () => {
  expect(activeCount([fakeSession('a'), fakeSession('b', { state: 'exited' }), fakeSession('c', { offline: true }), fakeSession('d', { state: 'idle' })])).toBe(2);
});
```

Dans `shell.test.tsx` :

```tsx
it('leaving full screen from outside (the browser, the OS) leaves the immersive layout', async () => {
  const { user } = await boot();
  await user.click(screen.getByRole('button', { name: 'Full screen' }));
  expect(document.querySelector('.application')).toHaveClass('immersive');
  document.dispatchEvent(new Event('fullscreenchange'));          // jsdom has no fullscreen element
  await waitFor(() => expect(document.querySelector('.application')).not.toHaveClass('immersive'));
});
it('the rules lot 3 ported for nothing are gone', () => {
  const css = readFileSync(resolve(__dirname, '../src/styles/shell.css'), 'utf8');
  expect(css).not.toMatch(/workspace-footer > span|data-variant=outline\]|\(lot 5\)/);
});
```

- [ ] **Step 4: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/screen-keys.test.tsx test/fullscreen.test.ts test/nav-state.test.ts test/nav-agents.test.ts test/shell.test.tsx`
Expected : FAIL. `screenKeys`, `onFullscreenLeft` et `activeCount` n'existent pas, et le plein écran reste immersif.

- [ ] **Step 5: Implémenter**

- `Modal` devient l'union ci-dessus. Tous les appels passent à `{ kind }` : `useKeys` (Ctrl K, `?`, `n`, et `state.modal?.kind === 'search'`), `Sidebar` (« Nouvelle session », recherche, « + » des projets), `TopBar`, `Footer`, et le plateau dans `App`.
- Le titre de la fenêtre modale `project` est `modalTitles.editProject` (fr : `Modifier le projet`, en : `Edit project`) quand `edit` est donné, sinon `modalTitles.project`. Les deux fenêtres restent `Pending` (lots 7 et 8).
- `Shell` crée `const screenKeys = useRef<ScreenKeys>({ current: null }).current`, le fournit par `ScreenKeysContext.Provider` autour de la coquille et le passe à `useKeys`.
- `Shell` s'abonne une fois, au montage, à `onFullscreenLeft(() => dispatch({ type: 'fullscreen', on: false }))`. L'effet existant vers `setWindowFullscreen` ne change pas : quitter un plein écran déjà quitté est sans effet.
- `Sidebar` ne recalcule plus rien : elle reçoit l'`order` et le `projectIdOf` mémorisés de `App`, et compte avec `activeCount`.
- Ménage :
  - dans `shell.css`, retirer `.workspace-footer > span:first-child`, la règle `.workspace-footer > span:last-child` à 850 px et `.header-actions .ledge-btn[data-variant=outline]` ;
  - le commentaire de `.pending` dit « chat (lot 9) » ;
  - retirer `status` de `messages.ts` (fr et en) : `grep -rn "t\.status" apps/desktop/src` ne doit rien trouver.

- [ ] **Step 6: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 7: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): screen keys after the global ones, full screen follows the window, dialogs carry their target, the sidebar on the shell's order

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: La géométrie de l'atelier

**Files:**
- Create: `apps/desktop/src/atelier/layout.ts`, `apps/desktop/src/atelier/zoom.ts`, `apps/desktop/src/atelier/plants.ts`, `apps/desktop/test/atelier-layout.test.ts`

**Interfaces:**
- Consumes : `Session`, `Helper`, `Project`, `Projects` (`@ledge/protocol`) ; `BotState` et `seedHash` (`@ledge/ui/bots/poseFor`, même hachage que `hash` de `decor.tsx`) ; `ProjectFilter` (`nav/state.ts`).
- Produces :

```ts
// atelier/layout.ts — les constantes de la maquette (observatory.tsx, en tête)
export const STEP = 70, MAX_SEATS = 6, END_SEATS = 2, RUG_SIDE = 130;
export type Side = 't' | 'b';
export type End = 'left' | 'right';
export interface Seat { session: Session; x: number; side: Side }
export interface EndSeat { helper: Helper; parent: Session; end: End; slot: number; count: number }
export interface Note { helper: Helper; more: number }
export interface TableLayout {
  length: number;                    // la table
  width: number;                     // la pièce, tapis compris : la largeur de la tuile (`--room`)
  seats: Seat[];                     // les MAX_SEATS premiers agents principaux, dans l'ordre reçu
  ends: EndSeat[];                   // bout gauche puis bout droit, chacun de haut en bas
  notes: Map<string, Note>;          // par parent assis : son premier sous-agent et le nombre des autres
  extra: { mains: Session[]; helpers: { helper: Helper; parent: Session }[] };
  extraCount: number;                // extra.mains.length + extra.helpers.length
}
export function tableLength(n: number): number;                 // (max(n, 2) + 1) × STEP
export function roomWidth(mains: number): number;               // tableLength(min(mains, MAX_SEATS)) + 2 × RUG_SIDE
export function layoutTable(mains: readonly Session[], showHelpers: boolean): TableLayout;
/** Où poser le post-it à côté de la feuille en `x` : à droite s'il y a la place dans la rangée, sinon à gauche, sinon chevauchant (`noteLeft` de TableTop). */
export function noteX(x: number, row: readonly number[], length: number): number;
/** La branche la plus fréquente parmi les agents principaux de la table, à égalité celle du premier dans l'ordre ; null sans branche. */
export function tableBranch(mains: readonly Session[]): string | null;
/** Suffixe de classe d'une feuille ou d'un post-it : 'offline' d'abord, 'idle' → 'done', 'readonly' → 'working', sinon l'état. */
export function sheetState(state: BotState, offline?: boolean): 'approval' | 'question' | 'done' | 'offline' | 'working' | 'starting' | 'error';
export function helperState(h: Helper): BotState;               // HELPER_STATE de l'overlay (SessionView.tsx)
export interface AtelierScene { tables: { project: Project; mains: Session[] }[]; unassigned: Session[]; empty: Project | null }
/** Ce que montre l'atelier pour un filtre : les tables des projets ayant au moins un agent (ordre des projets), « Sans projet »
 *  ('all' et 'none' seulement ; un projet disparu compte comme sans projet), et le projet filtré sans agent. */
export function sceneOf(order: readonly Session[], projects: Projects | null, projectIdOf: (s: Session) => string | null, filter: ProjectFilter): AtelierScene;
/** L'ordre de J / K : les agents assis, table par table, puis « Sans projet ». */
export function walkOrder(scene: AtelierScene): Session[];

// atelier/zoom.ts
export const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5, FIT_MAX = 1.8, FIT_MIN = 0.4, FIT_STEP = 0.02, FRAME_MAX = 2.2;
export const FLOOR_MARGIN = 56, TILE_GAP = 12, LEDGE_TILE = 230, ZONE_TILE = 420;
/** Largeur de la rangée la plus large quand on vise `rows` rangées (algorithme du premier useLayoutEffect de la maquette). */
export function widestRow(widths: readonly number[], rows: number): number;
export function fitCeiling(viewportWidth: number, widest: number): number;   // min(FIT_MAX, (vw − 8) / (widest + 2 × FLOOR_MARGIN + 16))
export function clampZoom(z: number): number;
export function stepZoom(z: number, dir: 1 | -1): number;                     // × 1,2 ou ÷ 1,2, borné
export function wheelZoom(z: number, deltaY: number): number;                 // z × exp(−deltaY × 0,0022), borné
/** Le défilement qui garde immobile le point `at` (relatif au défileur) quand le zoom passe de `from.zoom` à `zoom`. */
export function zoomAround(from: { zoom: number; left: number; top: number }, zoom: number, at: { x: number; y: number }): { left: number; top: number };
/** Cadre une boîte (px logiques) : zoom = min(FRAME_MAX, max(ZOOM_MIN, min(0,92 × w_vue / w, 0,92 × h_vue / h))), centrée. */
export function frameZoom(box: { x: number; y: number; w: number; h: number }, view: { width: number; height: number }): { zoom: number; left: number; top: number };

// atelier/plants.ts
export type Species = 'monstera' | 'fern' | 'snake' | 'ficus' | 'succulent';
export type Spot = 'tl' | 'tr' | 'br' | 'ml' | 'mr';               // 'bl' porte l'étiquette : jamais de plante
export function plantsFor(projectId: string, avoid: readonly Spot[]): { spot: Spot; species: Species; flip: boolean }[];
```

`layoutTable` :
- places : celles de la maquette (rendu de `project-room`) ; un agent seul est au milieu, en haut ;
- bouts de table :
  - on parcourt les parents assis dans l'ordre, et pour chacun ses `helpers` dans leur ordre ;
  - un sous-agent va du côté de son parent (`x > length / 2` → droite), sinon à l'autre bout, sinon il n'est pas assis ;
  - les sous-agents d'un parent non assis ne sont jamais assis ;
- post-it :
  - **écart voulu** avec la maquette, qui ne compte que les sous-agents assis : le post-it est le premier des `helpers` du parent, et `more` vaut `helpers.length − 1` (« +N quand le parent en a plusieurs », spec § 2.1) ;
- `showHelpers === false` : ni bouts, ni post-its, ni sous-agents dans `extra`.

`plantsFor` reprend `Plants` de `decor.tsx` à l'identique : nombre, tri des emplacements, espèce, retournement.

- [ ] **Step 1: Écrire `test/atelier-layout.test.ts`**

```ts
const main = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { id: `local:${id}`, name: id, machineId: 'local', cwd: '/w/ledge', ...extra });
const helper = (id: string, state: Helper['state'] = 'working'): Helper => ({ id, kind: 'Explore', task: `Task ${id}`, state });

it('a table grows one step per agent, from two, up to six', () => {
  expect([1, 2, 3, 6].map(tableLength)).toEqual([210, 210, 280, 490]);
  expect([1, 6, 9].map(roomWidth)).toEqual([470, 750, 750]);
});
it('seats main agents in a zigzag; a lone agent sits in the middle, on top', () => {
  expect(layoutTable([main('a')], true).seats.map(s => [s.x, s.side])).toEqual([[105, 't']]);
  expect(layoutTable(['a', 'b', 'c'].map(id => main(id)), true).seats.map(s => [s.session.name, s.x, s.side])).toEqual([['a', 70, 't'], ['b', 140, 'b'], ['c', 210, 't']]);
});
it("seats helpers at the ends on their parent's side, two per end; the post-it is the first helper, +N the others", () => {
  const t = layoutTable([main('a', { helpers: [helper('a1'), helper('a2')] }), main('b'), main('c', { helpers: [helper('c1'), helper('c2'), helper('c3')] })], true);
  expect(t.ends.map(e => [e.helper.id, e.end, e.slot, e.count])).toEqual([['a1', 'left', 0, 2], ['a2', 'left', 1, 2], ['c1', 'right', 0, 2], ['c2', 'right', 1, 2]]);
  expect(t.extra.helpers.map(h => h.helper.id)).toEqual(['c3']);
  expect(t.notes.get('local:a')).toEqual({ helper: helper('a1'), more: 1 });
  expect(t.notes.get('local:c')).toEqual({ helper: helper('c1'), more: 2 });
});
it('beyond six main agents, and with helpers hidden', () => {
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => main(id, { helpers: id === 'g' ? [helper('g1')] : [] }));
  const t = layoutTable(seven, true);
  expect(t.seats).toHaveLength(6);
  expect(t.extra.mains.map(s => s.name)).toEqual(['g']);
  expect(t.extra.helpers.map(h => h.helper.id)).toEqual(['g1']);       // the helper of an agent not seated is not seated
  expect(t.extraCount).toBe(2);
  const hidden = layoutTable(seven, false);
  expect(hidden).toMatchObject({ ends: [], extraCount: 1 });
  expect(hidden.notes.size).toBe(0);
});
it('lays a post-it right of its sheet, else left, else overlapping', () => {
  expect(noteX(70, [70, 210], 490)).toBe(114);
  expect(noteX(420, [140, 280, 420], 490)).toBe(324);
  expect(noteX(100, [100], 150)).toBe(98);
});
it("the table's branch is its agents' most frequent one", () => {
  expect(tableBranch([main('a', { branch: 'desktop' }), main('b', { branch: 'main' }), main('c', { branch: 'desktop' }), main('d')])).toBe('desktop');
  expect(tableBranch([main('a', { branch: 'x' }), main('b', { branch: 'y' })])).toBe('x');
  expect(tableBranch([main('a')])).toBeNull();
});
it('sheet states: idle reads as done, offline wins', () => {
  expect((['approval', 'question', 'done', 'idle', 'working', 'readonly'] as BotState[]).map(s => sheetState(s))).toEqual(['approval', 'question', 'done', 'done', 'working', 'working']);
  expect(sheetState('approval', true)).toBe('offline');
  expect(helperState(helper('h', 'waiting_permission'))).toBe('approval');
});
it('the scene of each filter, and the J / K order', () => {
  const projects: Projects = { projects: ['ledge', 'pay', 'docs'].map(id => ({ id, name: id, color: 'blue' as const, description: '', repos: [{ machine: 'local', path: `/w/${id}` }] })), rules: [] };
  const idOf = (s: Session) => projectOf(s, projects);
  const order = mainOrder([main('otto'), main('nova', { cwd: '/w/pay' }), main('kit', { cwd: '/tmp' })], projects);
  const names = (sc: AtelierScene) => [sc.tables.map(t => `${t.project.id}:${t.mains.map(m => m.name).join(',')}`), sc.unassigned.map(s => s.name), sc.empty?.id ?? null];
  expect(names(sceneOf(order, projects, idOf, 'all'))).toEqual([['ledge:otto', 'pay:nova'], ['kit'], null]);
  expect(names(sceneOf(order, projects, idOf, 'ledge'))).toEqual([['ledge:otto'], [], null]);
  expect(names(sceneOf(order, projects, idOf, 'docs'))).toEqual([[], [], 'docs']);
  expect(names(sceneOf(order, projects, idOf, 'none'))).toEqual([[], ['kit'], null]);
  expect(names(sceneOf(order, null, () => null, 'all'))).toEqual([[], ['otto', 'nova', 'kit'], null]);
  const crowd = mainOrder(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => main(id)), projects);
  expect(walkOrder(sceneOf(crowd, projects, idOf, 'all')).map(s => s.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
});
it('mosaic rows and zoom arithmetic', () => {
  expect([1, 2, 3].map(k => widestRow([230, 750, 470, 420], k))).toEqual([1918, 1004, 762]);
  expect(fitCeiling(1200, 1004)).toBeCloseTo(1.053, 3);
  expect(fitCeiling(4000, 300)).toBe(1.8);
  expect([clampZoom(0.1), clampZoom(3), stepZoom(1, 1), stepZoom(2.4, 1), stepZoom(0.32, -1)]).toEqual([0.3, 2.5, 1.2, 2.5, 0.3]);
  expect(wheelZoom(1, -100)).toBeCloseTo(1.246, 3);
  expect(zoomAround({ zoom: 1, left: 0, top: 0 }, 2, { x: 100, y: 50 })).toEqual({ left: 100, top: 50 });
  expect(zoomAround({ zoom: 2, left: 100, top: 50 }, 1, { x: 100, y: 50 })).toEqual({ left: 0, top: 0 });
  const f = frameZoom({ x: 100, y: 50, w: 750, h: 502 }, { width: 1000, height: 600 });
  expect(f.zoom).toBeCloseTo(1.0996, 4); expect(f.left).toBeCloseTo(22.3, 1); expect(f.top).toBeCloseTo(31.0, 1);
});
it('plants: one or two per table, from the project id, never on the label corner, away from the +N pill', () => {
  expect(plantsFor('ledge', [])).toEqual([{ spot: 'br', species: 'monstera', flip: false }]);
  expect(plantsFor('pay', [])).toEqual([{ spot: 'br', species: 'snake', flip: true }, { spot: 'ml', species: 'succulent', flip: false }]);
  expect(plantsFor('pay', ['br'])).toEqual([{ spot: 'ml', species: 'snake', flip: true }, { spot: 'mr', species: 'succulent', flip: false }]);
  for (const id of ['a', 'website', 'payment-service', 'x-1']) {
    const p = plantsFor(id, []);
    expect(p.length).toBeGreaterThanOrEqual(1); expect(p.length).toBeLessThanOrEqual(2);
    expect(p.map(x => x.spot)).not.toContain('bl');
  }
});
```

`fakeSession` vient de `@ledge/fleet/test/mockDaemon`, `projectOf` de `@ledge/fleet`, `mainOrder` de `src/nav/agents.ts`.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/atelier-layout.test.ts`
Expected : FAIL, `src/atelier/*` introuvables.

- [ ] **Step 3: Implémenter `layout.ts`, `zoom.ts` et `plants.ts`**

Fonctions pures, sans React ni DOM. `widestRow` compte chaque tuile avec son espace (`w + TILE_GAP`) et passe à la ligne quand `row > 0 && row + w > (total / rows) × 1,12`, comme la maquette.

- [ ] **Step 4: Vérifier qu'il passe**

Run: `pnpm --filter desktop exec vitest run test/atelier-layout.test.ts`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/atelier apps/desktop/test/atelier-layout.test.ts
git commit -m "feat(desktop): the atelier's geometry: tables, seats, table ends, post-its, scenes, mosaic rows, zoom and plants

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: La table d'un projet

**Files:**
- Create: `apps/desktop/src/atelier/ProjectTable.tsx`, `apps/desktop/src/atelier/Plants.tsx`, `apps/desktop/src/styles/atelier.css`, `apps/desktop/test/atelier-table.test.tsx`
- Modify: `apps/desktop/src/styles/app.css` (`@import "./atelier.css";` après `sidebar.css`), `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâche 2 (`layoutTable`, `noteX`, `tableBranch`, `sheetState`, `helperState`, `plantsFor`, `STEP`, `RUG_SIDE`) ; tâche 1 (`Modal`, `home` avec `view`) ; `Bot`, `botState`, `poseFor`, `Badge`, `Icon`, `ICONS` (`@ledge/ui`) ; `PROJECT_COLORS` ; `useTheme` (`src/shell/theme.ts`), `useMotionPreferences`.
- Produces :

```ts
export interface ProjectTableProps {
  project: Project;
  mains: readonly Session[];            // ses agents principaux, dans l'ordre de mainOrder
  order: readonly Session[];            // mainOrder entier : « Alt n » sur les 9 premiers
  helpers: boolean; paused: boolean;
  isolated: boolean;                    // le filtre est sur ce projet : le menu propose « Voir tous les projets »
  focusedId: string | null;             // classe keyboard-selected (J / K)
  seated: string | null;                // classe just-seated (tâche 6)
  dispatch: (a: NavAction) => void;
}
export function ProjectTable(p: ProjectTableProps): JSX.Element;
export function Plants({ projectId, left, width, avoid }: { projectId: string; left: string; width: number; avoid: readonly Spot[] }): JSX.Element;
```

Le rendu suit `project-room` de la maquette en mode atelier : tapis, étiquette, `+N`, plantes, chaises, `worktable` avec `TableTop`, places, places des bouts. Écarts voulus :
- `<section className="project-room" data-project={id} aria-label={t.atelier.table(name)} style={{ '--room': width px, '--project': PROJECT_COLORS[color] }}>` ;
- l'étiquette :
  - `side-swatch` avec la couleur en `style` ;
  - le nom dans `button.project-conversations` (`title` = nom complet, `aria-label` = `t.atelier.conversations(name)`), qui ouvre la Liste filtrée ;
  - `⎇ branche` (`heading-branch`, `title`), seulement si `tableBranch` donne une branche ;
  - le menu « … » (`room-menu-wrap`, `role="menu"`) : Modifier → `modal: { kind: 'project', edit: id }` ; Nouvelle session → `modal: { kind: 'launch', project: id }` (c'est le « + » d'une table de la spec § 5, comme dans la maquette) ; Isoler → `home` avec `project: id`, ou sans projet si `isolated`.
  
  Le menu se ferme au `mousedown` dehors, et sur Échap avec `stopPropagation`, pour qu'Échap ne ferme pas aussi une couche de navigation ;
- `+N` (`table-more`, coin bas droit) : `extraCount > 0`, jusqu'à trois têtes (bots de 18 px), `+${n} à cette table`. Il envoie `{ type: 'home', project: id, view: 'list' }` ; ses plantes évitent alors `'br'` ;
- une place :
  - `button.agent-seat place-<side>`, `data-agent={id}`, `aria-label={t.atelier.seat(name, task, machine)}` ;
  - dedans, `Bot` 64 avec `frozen={offline}`, `paused`, `reducedMotion` et `readOnly` pour `hook_only` ;
  - puis le nom, `seat-shortcut` « Alt n » seulement si n ≤ 9, `seat-machine`, et `Badge` (`readonly` + `t.atelier.offline` hors ligne, sinon `botState`) ;
  - classes `seat-offline` ou `seat-working` ;
  - un clic envoie `open` ;
- une place de bout : `helper-seat end-<end>`, `Bot` 36, `kind`, `↳ Parent`, `title` = tâche ; un clic envoie `open` du parent ;
- feuilles et post-its : `TableTop` de `office.tsx`, avec `sheet-${sheetState(…)}` et `noteX`. Le marque-page `sheet-flag` va sur approval et question, le tampon `sheet-stamp` sur done ; un post-it hors ligne suit son parent.

`atelier.css`, première part :
- de `observatory.css` ligne 3, les règles `project-room`, `room-heading`, `table-scene`, `worktable`, `agent-seat`, `seat-meta`, `helper-seat` ;
- de `office.css` ligne 3, `seat-shortcut`, `keyboard-selected`, `office-shell`, `office-rug`, `office-chair`, `office-paused`, `.immersive .office-shell …`, sans les règles rejetées ni `[data-project=…]` ;
- de `office.css`, les lignes 11-22, 52, 54-102, 146-151, 155-171 et 279-287 ;
- `decor.css` en entier ;
- puis `.office-shell .office-rug { border-color: color-mix(in srgb, var(--project) 18%, var(--border)); background: color-mix(in srgb, var(--project) 5%, var(--sidebar)); }`.

Textes français (`atelier.*`) :

| Clé | fr |
| --- | --- |
| `table(name)` | `Table ${name}` (en : `${name} table`) |
| `conversations(name)` | `Conversations du projet ${name}` (en : `Conversations of project ${name}`) |
| `actions(name)` / `actionsTitle` | `Actions du projet ${name}` (en : `Actions of project ${name}`) / `Actions du projet` |
| `edit` | `Modifier le projet` (en : `Edit project`) |
| `newSession` / `newSessionAt(name)` | `Nouvelle session` / `Nouvelle session à la table ${name}` (en : `New session at the ${name} table`) |
| `isolate(name)` | `Isoler le projet ${name}` (en : `Isolate project ${name}`) |
| `isolateLabel` / `showAll` | `Isoler cette table` / `Voir tous les projets` |
| `more(n)` / `moreTitle` | `+${n} à cette table` (en : `+${n} at this table`) / `Voir tous les agents du projet dans la liste` |
| `seat(name, task, machine)` | `${name}, ${task}, ${machine}` |
| `helperSeat(kind, parent, task)` | `${kind}, sous-agent de ${parent} : ${task}` (en : `${kind}, subagent of ${parent}: ${task}`) |
| `offline` | `Hors ligne` (en : `Offline`) |

- [ ] **Step 1: Écrire `test/atelier-table.test.tsx`**

Le harnais rend `<LangProvider lang="en"><ProjectTable …/></LangProvider>` avec `dispatch = vi.fn()`, `helpers: true`, `paused: false`, `isolated: false`. Le projet par défaut est `{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [] }` ; `main` et `helper` sont ceux de la tâche 2.

```tsx
it('a seat per main agent with its name, machine and badge, never the harness', () => {
  renderTable([main('otto', { name: 'Otto', topic: 'Préparer la migration', state: 'waiting_permission', tool: 'codex', machineName: 'Dev SSH' }), main('nova', { name: 'Nova', machineName: 'Local' })]);
  const table = screen.getByRole('region', { name: 'Ledge table' });
  const otto = within(table).getByRole('button', { name: 'Otto, Préparer la migration, Dev SSH' });
  expect(within(otto).getByText('Approval')).toHaveAttribute('data-badge', 'approval');
  expect(otto).toHaveTextContent('Alt 1');
  expect(table).not.toHaveTextContent(/Codex|Claude Code|Cursor Agent/);
});
it('sheets carry the state marks', () => {
  renderTable([main('a', { state: 'waiting_permission' }), main('b', { state: 'waiting_input' }), main('c', { state: 'exited' }), main('d', { state: 'idle' }), main('e', { state: 'waiting_permission', offline: true })]);
  const sheets = [...document.querySelectorAll('.task-sheet')];
  expect(sheets.map(s => [...s.classList].find(c => /^sheet-(approval|question|done|offline|working)$/.test(c)))).toEqual(['sheet-approval', 'sheet-question', 'sheet-done', 'sheet-done', 'sheet-offline']);
  expect(sheets.map(s => [!!s.querySelector('.sheet-flag'), !!s.querySelector('.sheet-stamp')])).toEqual([[true, false], [true, false], [false, true], [false, true], [false, false]]);
  expect(screen.getByRole('button', { name: /^e,/ })).toHaveClass('seat-offline');
});
it("helpers sit at the ends with ↳ parent; the first one's task is a post-it with +N; hidden with the toggle", () => {
  const otto = main('otto', { name: 'Otto', helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }, helper('h2')] });
  const { rerender } = renderTable([otto]);
  expect(screen.getByRole('button', { name: 'Explore, subagent of Otto: Lire le code' })).toHaveTextContent('↳ Otto');
  const note = document.querySelector('.sheet-note')!;
  expect(note).toHaveTextContent('Lire le code');
  expect(note.querySelector('.note-more')).toHaveTextContent('+1');
  rerender(tableElement([otto], { helpers: false }));
  expect(document.querySelector('.helper-seat')).toBeNull();
  expect(document.querySelector('.sheet-note')).toBeNull();
});
it('beyond six agents and four helpers: +N opens the List on the project, no plant under it', async () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => main(id, { helpers: id === 'a' ? ['a1', 'a2', 'a3', 'a4', 'a5'].map(h => helper(h)) : [] }));
  const { dispatch } = renderTable(many);
  expect(document.querySelectorAll('.agent-seat:not(.helper-seat)')).toHaveLength(6);
  expect(document.querySelectorAll('.helper-seat')).toHaveLength(4);
  await userEvent.click(screen.getByRole('button', { name: /\+2 at this table/ }));       // g and a5
  expect(dispatch).toHaveBeenCalledWith({ type: 'home', project: 'ledge', view: 'list' });
  expect(document.querySelector('.plant-spot.spot-br')).toBeNull();
});
it('the label: colour, a long name cut with its full name in title, the main branch', () => {
  const long = 'Payment Service Platform Migration Europe';
  renderTable([main('a', { branch: 'desktop' })], { project: { id: 'pay', name: long, color: 'green', description: '', repos: [] } });
  const table = screen.getByRole('region', { name: `${long} table` });
  expect(table.style.getPropertyValue('--project')).toBe('#10b981');
  expect(within(table).getByRole('button', { name: `Conversations of project ${long}` })).toHaveAttribute('title', long);
  expect(within(table).getByText('⎇ desktop')).toHaveAttribute('title', 'desktop');
});
it('the table menu: edit, new session at this table, isolate; Escape closes only the menu', async () => {
  const { dispatch } = renderTable([main('a')]);
  const user = userEvent.setup();
  const open = () => user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
  await open(); await user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
  await open(); await user.click(screen.getByRole('menuitem', { name: 'New session at the Ledge table' }));
  await open(); await user.click(screen.getByRole('menuitem', { name: 'Isolate project Ledge' }));
  expect(dispatch.mock.calls.map(c => c[0])).toEqual([
    { type: 'modal', modal: { kind: 'project', edit: 'ledge' } },
    { type: 'modal', modal: { kind: 'launch', project: 'ledge' } },
    { type: 'home', project: 'ledge' }
  ]);
  await open();
  const onWindow = vi.fn(); window.addEventListener('keydown', onWindow);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(onWindow).not.toHaveBeenCalled();
  window.removeEventListener('keydown', onWindow);
});
it('a seat opens its session, a helper seat its parent', async () => {
  const { dispatch } = renderTable([main('otto', { name: 'Otto', helpers: [helper('h1')] })]);
  await userEvent.click(screen.getByRole('button', { name: /^Otto,/ }));
  await userEvent.click(screen.getByRole('button', { name: /subagent of Otto/ }));
  expect(dispatch.mock.calls.map(c => c[0])).toEqual([{ type: 'open', id: 'local:otto' }, { type: 'open', id: 'local:otto' }]);
});
```

`renderTable(mains, overrides?)` rend la table avec `order: mains` et renvoie `{ dispatch, rerender }` ; `tableElement` construit le même élément pour `rerender`.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/atelier-table.test.tsx`
Expected : FAIL, `ProjectTable` introuvable.

- [ ] **Step 3: Implémenter `ProjectTable`, `Plants`, `atelier.css` et les textes**

Les positions viennent de `layoutTable`. On reprend telle quelle la fonction `at(dx)` de la maquette (`calc(50% - ${length / 2}px + ${dx}px)`), ainsi que les `left` et `top` des places, des chaises, des bouts (126 / 232 quand ils sont deux) et du tapis.

- [ ] **Step 4: Vérifier qu'il passe**

Run: `pnpm --filter desktop exec vitest run test/atelier-table.test.tsx && pnpm --filter desktop typecheck`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/atelier-table.test.tsx
git commit -m "feat(desktop): a project's table: rug, label and menu, seats, sheets with their marks, sub-agents and post-its, plants, +N

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: L'atelier dans la coquille

**Files:**
- Create: `apps/desktop/src/atelier/Atelier.tsx`, `apps/desktop/src/atelier/LedgeDesk.tsx`, `apps/desktop/src/atelier/Unassigned.tsx`, `apps/desktop/test/atelier.test.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/atelier.css`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâche 1 (`useScreenKeys`, `activeCount`) ; tâche 2 (`sceneOf`, `walkOrder`, `layoutTable`) ; tâche 3 (`ProjectTable`) ; `ResidentMascot`, `Kbd`, `Button`, `Badge`, `Bot`.
- Produces :

```ts
export interface AtelierProps {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; projects: Projects | null; order: readonly Session[];
  projectIdOf: (s: Session) => string | null;
}
export function Atelier(p: AtelierProps): JSX.Element;
export function LedgeDesk({ count, chat, paused, onClick }: { count: number; chat: boolean; paused: boolean; onClick: () => void }): JSX.Element;
export function Unassigned({ sessions, order, focusedId, paused, dispatch }: { sessions: readonly Session[]; order: readonly Session[]; focusedId: string | null; paused: boolean; dispatch: (a: NavAction) => void }): JSX.Element | null;
```

- `App` rend `<Atelier …/>` à la place du `Pending` « Atelier » ; « Liste » reste `Pending` (lot 5). `Atelier` rend lui-même `div.overview-scroll.atelier` (`id="view-panel-atelier"`, `role="tabpanel"`, `aria-labelledby="view-tab-atelier"`) puis `div.office-shell` (avec `office-paused` si `nav.paused`). Dedans :
  1. le bureau de Ledge, **toujours**, comme dans la maquette (y compris filtré et sans agent) ;
  2. les tables de `sceneOf` (`project-grid`, `focused` s'il n'y en a qu'une) ;
  3. le projet filtré sans agent : `.empty-project` ;
  4. « Sans projet ».
  
  Puis la légende `workspace-legend` (hors de `.office-shell`).
- `LedgeDesk` : `ledge-corner` > `button.ledge-desk` (`aria-label` `t.atelier.desk`, `aria-pressed` = chat, `active` si ouvert), bulle `t.atelier.watching(count)` + `Kbd /`, ou `t.atelier.listening` chat ouvert, `ResidentMascot` 92, `mini-desk`, `Ledge`, `t.atelier.assistant`. Le clic bascule le chat ; `count = activeCount(sessions)`.
- `Unassigned` : `section.unassigned-zone.atelier` (`aria-labelledby` sur son `h2` « Sans projet »), avec le texte d'aide. Chaque carte `unassigned-card` contient :
  - `button.unassigned-open` (`data-agent`, `aria-label` `${name}, ${task}`) avec `Bot` 56, le nom + `seat-shortcut`, la tâche (`title`) et `code` `${machine} · ${cwd}` ;
  - `unassigned-actions` avec le `Badge`.
  
  Poignée, glisser et « Ranger dans… » arrivent à la tâche 6. La zone n'est pas rendue sans agent.
- `.empty-project` : pastille, `t.atelier.empty.title(name)`, `t.atelier.empty.body(where)` et le bouton « Nouvelle session » → `modal: { kind: 'launch', project: id }`. `where` = les noms de dossier (dernier segment du chemin) des dépôts du projet joints par ` · `, ou `ce projet` sans dépôt.
- J / K / Entrée, inscrits par `useScreenKeys` :
  - `j` ou ↓ : agent suivant ; `k` ou ↑ : précédent ; dans `walkOrder`, en boucle, à partir du premier ou du dernier si aucun n'est choisi ;
  - l'agent choisi prend la classe `keyboard-selected`, et le focus va sur son élément `[data-agent]` du défileur, trouvé en comparant `dataset.agent` (pas de sélecteur construit avec l'id) ;
  - Entrée ouvre l'agent choisi si la cible n'est ni un bouton ni un lien ;
  - les touches sont ignorées (`false`) quand la cible est dans `[role=tablist]` ou `[role=menu]` ;
  - `focusedId` retombe à `null` quand l'agent quitte `walkOrder`.
- `atelier.css`, deuxième part : `office.css` lignes 24-50 (zone, cartes), 125-145 (bureau de Ledge), 152-154 (`empty-project`), la légende de `observatory.css` ligne 3 et ses `@media`, et `office.css` lignes 197-201.

Textes français :

| Clé | fr |
| --- | --- |
| `atelier.desk` | `Parler à Ledge` (en : `Talk to Ledge`) |
| `atelier.watching(n)` | `Je veille sur ${n} agent.` / `Je veille sur ${n} agents.` (en : `I'm watching over ${n} agents.`) |
| `atelier.listening` | `Je vous écoute.` (en : `I'm listening.`) |
| `atelier.assistant` | `Votre assistant` |
| `atelier.unassignedHint` | `Ledge ne relie ces sessions à aucun projet. Glissez-les vers une table, ou utilisez « Ranger dans… ».` |
| `atelier.empty.title(name)` | `Aucun agent à la table ${name}` (en : `No agent at the ${name} table`) |
| `atelier.empty.body(where)` | `La table apparaîtra dès qu'une session démarre dans ${where}.` ; `where` sans dépôt : `ce projet` |
| `atelier.legend` | `{ working: 'En cours', approval: 'Votre accord', question: 'Une question', done: 'Terminé ou hors ligne', helper: 'Un petit bot est un sous-agent.' }` (en `helper` : `A small bot is a subagent.`) |

Le titre de la zone reprend `side.unassigned` (en : `No project`).

- [ ] **Step 1: Écrire `test/atelier.test.tsx`**

Le harnais est `boot()` de `shell.test.tsx`, avec un troisième projet `docs` (`Docs`, dépôt `local:/w/docs`, sans agent).

```tsx
it("Ledge's desk, a table per project with agents, and Sans projet", async () => {
  await boot();
  expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm watching over 3 agents.");
  expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Payment Service Platform Migration Europe table' })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Docs table' })).toBeNull();
  expect(within(screen.getByRole('region', { name: 'No project' })).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  expect(screen.queryByText('This screen is coming soon.')).toBeNull();
});
it("Ledge's desk toggles the chat", async () => {
  const { user } = await boot();
  await user.click(screen.getByRole('button', { name: 'Talk to Ledge' }));
  expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm listening.");
});
it("no agent at all: only Ledge's desk", async () => {
  await boot({ sessions: [] });
  expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm watching over 0 agents.");
  expect(screen.queryAllByRole('region', { name: / table$/ })).toHaveLength(0);
  expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
});
it('a filter shows its table; a project without agents proposes New session; No project shows the zone only', async () => {
  const { side, user } = await boot();
  await user.click(side.getByRole('button', { name: /^Ledge/ }));
  expect(screen.getAllByRole('region', { name: / table$/ }).map(r => r.getAttribute('aria-label'))).toEqual(['Ledge table']);
  expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
  await user.click(side.getByRole('button', { name: /^Docs/ }));
  expect(screen.getByRole('heading', { name: 'No agent at the Docs table' })).toBeVisible();
  await user.click(within(document.querySelector<HTMLElement>('.empty-project')!).getByRole('button', { name: 'New session' }));
  expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(side.getByRole('button', { name: /No project/ }));
  expect(screen.queryAllByRole('region', { name: / table$/ })).toHaveLength(0);
  expect(screen.getByRole('region', { name: 'No project' })).toBeVisible();
});
it('J / K walk the agents shown, Enter opens the chosen one', async () => {
  const { user } = await boot();
  await user.keyboard('j'); expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveFocus();
  await user.keyboard('j'); expect(screen.getByRole('button', { name: /^Nova,/ })).toHaveFocus();
  await user.keyboard('{ArrowUp}'); expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveClass('keyboard-selected');
  await user.keyboard('k'); expect(screen.getByRole('button', { name: /^Kit,/ })).toHaveFocus();       // wraps
  await user.keyboard('{Enter}');
  expect(within(screen.getByRole('banner')).getByText('Kit')).toBeVisible();
});
it("an offline machine's agent is greyed, its bot frozen, and it still opens", async () => {
  const { d, user } = await boot();
  d.upsert(fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'working', offline: true }));
  const rio = await screen.findByRole('button', { name: /^Rio,/ });
  expect(rio).toHaveClass('seat-offline');
  expect(within(rio).getByText('Offline')).toBeVisible();
  await user.click(rio);
  expect(within(screen.getByRole('banner')).getByText('Rio')).toBeVisible();
});
it('freezing the animations pauses the atelier', async () => {
  const { user } = await boot();
  await user.click(screen.getByRole('button', { name: 'Freeze animations' }));
  expect(document.querySelector('.office-shell')).toHaveClass('office-paused');
});
```

`boot({ sessions })` remplace les trois sessions par défaut. Les tests de `shell.test.tsx` et `keys.test.tsx` qui cherchaient un nom d'agent hors de la barre du haut sont limités à `banner` ou à la barre latérale : l'atelier montre maintenant ces noms.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/atelier.test.tsx`
Expected : FAIL, l'atelier est encore `Pending`.

- [ ] **Step 3: Implémenter `Atelier`, `LedgeDesk`, `Unassigned`, le branchement dans `App` et le style**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): the atelier in the shell: Ledge's desk, the tables, Sans projet, empty states, legend, J / K and Enter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Mosaïque ajustée, zoom et déplacement

**Files:**
- Create: `apps/desktop/src/atelier/useAtelierView.ts`, `apps/desktop/test/atelier-zoom.test.tsx`
- Modify: `apps/desktop/src/atelier/Atelier.tsx`, `apps/desktop/src/styles/atelier.css`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâche 2 (`widestRow`, `fitCeiling`, `stepZoom`, `wheelZoom`, `clampZoom`, `zoomAround`, `frameZoom`, `FIT_MIN`, `FIT_STEP`, `FLOOR_MARGIN`, `LEDGE_TILE`, `ZONE_TILE`, `roomWidth`) ; tâche 1 (`ScreenKeyHandler`).
- Produces :

```ts
export interface AtelierView {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  shellRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;              // affiché : le zoom manuel, sinon celui de l'ajustement
  fitted: boolean;           // pas de zoom manuel
  zoomTo(z: number, at?: { x: number; y: number }): void;   // borné ; `at` (coordonnées client) reste immobile, le centre par défaut
  step(dir: 1 | -1): void;
  fit(): void;
  frame(el: HTMLElement): void;
  keys: ScreenKeyHandler;    // + (et =), −, 0, Espace
}
/** `tiles` : largeurs des tuiles dans l'ordre du rendu ; `refit` : ce qui, en changeant, refait l'ajustement. */
export function useAtelierView(tiles: readonly number[], refit: readonly unknown[]): AtelierView;
```

Décisions :
- **Tuiles** : `Atelier` passe `[LEDGE_TILE, ...tables.map(t => roomWidth(t.mains.length)), ...(zone ou projet vide ? [ZONE_TILE] : [])]` ; le crochet ne lit pas les largeurs dans le DOM.
- **Ajustement** (premier `useLayoutEffect` de la maquette) :
  - pour `k` de 1 au nombre de tuiles : `max-width = widestRow(tiles, k) + 2 × FLOOR_MARGIN`, puis un zoom qui part de `fitCeiling` et descend de `FIT_STEP` jusqu'à ce que rien ne défile, ou jusqu'à `FIT_MIN` ;
  - on garde le `k` au plus grand zoom, le premier à égalité ;
  - on remplit ensuite largeur et hauteur (`paddingInline`, `minHeight`), puis on fige la largeur, comme la maquette ;
  - un défileur de largeur 0 (jsdom) donne un ajustement à 1, sans boucle.
- **Quand on refait l'ajustement** :
  - quand `tiles` ou `refit` changent ; `Atelier` passe `[nav.helpers, nav.fullscreen, nav.chat, filtre, sessions.length]` ;
  - quand le défileur change de taille (`ResizeObserver`, ignoré s'il n'existe pas), ce qui couvre la fenêtre, le chat et le plein écran ;
  - un zoom manuel est réappliqué après un nouvel ajustement.
- **Le zoom courant vit dans une ref**, jamais relu depuis `style.zoom` : jsdom ne garde pas cette propriété.
- **Écouteurs sur le défileur** (l'effet molette / glisser / double-clic de la maquette) :
  - Ctrl ou ⌘ + molette : `wheelZoom` au pointeur, écouteur `{ passive: false }` ;
  - glisser le sol, clic molette, ou Espace tenue + glisser : déplacement par capture du pointeur, avec la classe `panning`. On ne glisse pas si rien ne déborde, ni depuis un élément interactif (la liste `interactive` de la maquette) ;
  - double-clic sur une table : `frame` ; sur le sol : `fit`.
- **`keys`** :
  - `+` ou `=` : `step(1)` ; `-` : `step(-1)` ; `0` : `fit` ;
  - Espace (sans répétition) arme le déplacement et met la classe `can-pan` ; `keyup` d'Espace ou `blur` de la fenêtre la retirent (écouteurs sur `window`, sans garde) ;
  - `Atelier` compose ce gestionnaire avec J / K / Entrée en un seul `useScreenKeys`.
- **Barre de zoom** : `zoom-controls` de la maquette, rendue hors de `.office-shell`, comme la légende.
  - `role="toolbar"` ;
  - − ; `zoom-level`, qui affiche `${Math.round(zoom × 100)} %`, porte `aria-label` = `t.zoom.reset` (son texte changeant ne doit pas servir de nom) et revient à 1 au clic ; + ; séparateur ;
  - « Ajuster » : `Button` `secondary` et `aria-pressed` quand l'ajustement est actif, `ghost` sinon ;
  - `zoom-hint`.
  
  Le défileur prend la classe `fitted` (pas de défilement) quand il n'y a pas de zoom manuel.
- **Compactage avec le chat et sol fixe** : on porte `office.css` lignes 175-204 et 219-221, avec `.application:has(.ledge-chat-panel)` à la place de `.prototype:has(...)`. Le quadrillage est le fond du défileur et ne zoome jamais.

Textes français (`zoom.*`) : `bar` `Zoom de l'atelier` (en : `Atelier zoom`), `out` / `outTitle` `Dézoomer` / `Dézoomer (−)` (en : `Zoom out`), `in` / `inTitle` `Zoomer` / `Zoomer (+)` (en : `Zoom in`), `reset` `Revenir à 100 %` (en : `Back to 100 %`), `fit` / `fitTitle` `Ajuster` / `Tout voir (0)` (en : `Fit`), `hint` `Ctrl + molette · glisser le sol · double-clic sur une table`.

- [ ] **Step 1: Écrire `test/atelier-zoom.test.tsx`**

Le harnais est `boot()` de `atelier.test.tsx`. Dans jsdom, l'ajustement vaut 1.

```tsx
const bar = () => within(screen.getByRole('toolbar', { name: 'Atelier zoom' }));
it('the zoom bar: − and + step by 1.2, the percentage goes back to 100 %, Fit is pressed when fitted', async () => {
  const { user } = await boot();
  expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('100 %');
  expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
  await user.click(bar().getByRole('button', { name: 'Zoom in' }));
  expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('120 %');
  expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'false');
  await user.click(bar().getByRole('button', { name: 'Zoom in' }));
  expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('144 %');
  await user.click(bar().getByRole('button', { name: 'Back to 100 %' }));
  expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('100 %');
  await user.click(bar().getByRole('button', { name: /Fit/ }));
  expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
});
it('+ − 0 from the keyboard, never while typing; Ctrl + wheel zooms, a plain wheel does not', async () => {
  const { user } = await boot();
  const level = () => bar().getByRole('button', { name: 'Back to 100 %' });
  await user.keyboard('+'); expect(level()).toHaveTextContent('120 %');
  await user.keyboard('-'); expect(level()).toHaveTextContent('100 %');
  await user.keyboard('+0'); expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
  await user.keyboard('{Control>}k{/Control}+');
  expect(screen.getByRole('combobox')).toHaveValue('+');
  await user.keyboard('{Escape}');
  expect(level()).toHaveTextContent('100 %');
  const scroller = document.querySelector('.overview-scroll.atelier')!;
  fireEvent.wheel(scroller, { deltaY: 100 });
  expect(level()).toHaveTextContent('100 %');
  fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true });
  expect(level()).toHaveTextContent('125 %');
});
it('Space held arms the pan; the bar and the legend sit outside the zoomed content', async () => {
  const { user } = await boot();
  const scroller = document.querySelector('.overview-scroll.atelier')!;
  await user.keyboard('[Space>]'); expect(scroller).toHaveClass('can-pan');
  await user.keyboard('[/Space]'); expect(scroller).not.toHaveClass('can-pan');
  expect(document.querySelector('.zoom-controls')!.closest('.office-shell')).toBeNull();
  expect(document.querySelector('.workspace-legend')!.closest('.office-shell')).toBeNull();
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/atelier-zoom.test.tsx`
Expected : FAIL, pas de barre de zoom.

- [ ] **Step 3: Implémenter `useAtelierView`, la barre de zoom et le style**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/atelier-zoom.test.tsx
git commit -m "feat(desktop): the fitted mosaic, zoom at the pointer, + / − / 0, panning, framing a table, the zoom bar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Ranger un agent

**Files:**
- Create: `apps/desktop/src/atelier/filing.ts`, `apps/desktop/src/shell/Toast.tsx`, `apps/desktop/test/atelier-filing.test.tsx`
- Modify: `apps/desktop/src/atelier/{Atelier,ProjectTable,Unassigned}.tsx`, `apps/desktop/src/shell/Sidebar.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/{atelier,sidebar,shell}.css`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : `withRule` (`@ledge/fleet`), `normalizePath`, `Rule` (`@ledge/protocol`), `Fleet['setProjects']`, `useFleet().fleet` ; tâches 3 et 4 ; tâche 1 (`Modal` `project` avec `file`).
- Produces :

```ts
// atelier/filing.ts
export type FileResult = 'sent' | 'offline' | 'outdated' | 'invalid';
export function ruleFor(s: Session, project: string): Rule;            // { machine: s.machineId ?? 'local', path: normalizePath(s.cwd), project }
/** Écrit la règle au daemon ; ne lève jamais. `projects` null : 'outdated' sans appel. Erreurs par `name` : DaemonOffline → 'offline',
 *  DaemonOutdated → 'outdated', toute autre (zod : chemin non absolu…) → 'invalid'. */
export function fileSession(fleet: Pick<Fleet, 'setProjects'>, projects: Projects | null, s: Session, project: string): FileResult;
export interface DropTarget { onDragOver(e: React.DragEvent): void; onDragLeave(e: React.DragEvent): void; onDrop(e: React.DragEvent): void }
export interface Filing {
  dragging: Session | null;
  over: string | null;                     // id du projet sous le pointeur
  seated: string | null;                   // la session qui vient d'arriver à sa table (1,6 s)
  dragProps(s: Session): { draggable: true; onDragStart(e: React.DragEvent): void; onDragEnd(): void };
  dropProps(projectId: string): DropTarget;
  file(s: Session, projectId: string): void;
}
export function useFiling(o: { fleet: Pick<Fleet, 'setProjects'>; projects: Projects | null; sessions: readonly Session[]; projectIdOf: (s: Session) => string | null; notify: (text: string) => void }): Filing;

// shell/Toast.tsx
export function useToast(ms?: number): { notice: string | null; notify(text: string): void };   // 6000 ms par défaut, comme la maquette
export function Toast({ notice }: { notice: string | null }): JSX.Element | null;                 // <div className="toast" role="status">
```

- `ProjectTable`, `Atelier` et `Sidebar` gagnent `filing: Filing`. `Unassigned` gagne `filing: Filing` et `projects: readonly Project[]` (la liste de « Ranger dans… »). `Atelier` passe `filing` aux tables et à la zone, et `filing.seated` à `ProjectTable`.
- **Glisser** : seules les cartes de « Sans projet » sont glissables (comme dans la maquette). Elles portent `dragProps`, la `drag-grip` et le `title` `t.filing.grip`, plus `is-dragged` pendant le glisser.
- **Cibles** :
  - chaque table (`project-room`, avec `drop-over` et l'indice `drop-hint` dans l'étiquette, `t.filing.dropHere` ou `t.filing.dropNow(name)`) ;
  - chaque projet de la barre latérale (`drop-over`), et sous la liste `side-drop-help` `t.filing.dropHelp(name)` pendant un glisser ;
  - **la ligne « Sans projet » n'est pas une cible** : une règle doit nommer un projet, et seuls les agents sans projet se glissent ;
  - une cible n'accepte qu'un glisser parti de l'app (`dragging` posé), comme `dropProps` de la maquette ;
  - `.application` prend `is-dragging` pendant un glisser.
- **« Ranger dans… »** (`assign-wrap` de la maquette) :
  - les projets, chacun avec en `small` le nom de dossier de ses dépôts ;
  - puis « Nouveau projet… » avec `À partir de ${cwd}`, qui ouvre `modal: { kind: 'project', file: session.id }` (encore `Pending`, lot 8) ;
  - le menu se ferme au `mousedown` dehors, et sur Échap avec `stopPropagation`.
- **Après `file`** :
  - `'sent'` : on retient `{ id, project }`. Quand une diffusion place la session dans ce projet, `notify(t.filing.joined(name, table))`, `seated = id` pendant 1,6 s (classe `just-seated`), et l'entrée est oubliée ;
  - sinon `notify` du message de l'échec, et rien ne bouge.
- `App` tient `useToast`, rend `<Toast>` hors de `.application` et passe `fleet` (de `useFleet`) à `useFiling`.
- CSS :
  - `office.css` lignes 40-46 (`assign-menu`), 107-124 (glisser-déposer, `just-seated`) et 279-287 si pas encore portées ;
  - `sidebar.css` de la maquette, lignes 35-36 (`.side-project.drop-over`, `.is-dragging .side-project`) ;
  - `.toast` (`observatory.css` ligne 3) dans `shell.css`.

Textes français (`filing.*`) :

| Clé | fr |
| --- | --- |
| `moveTo` | `Ranger dans…` (en : `Move to…`) |
| `newProject` / `from(folder)` | `Nouveau projet…` (en : `New project…`) / `À partir de ${folder}` |
| `grip` | `Glisser vers une table pour le ranger` |
| `dropHelp(name)` | `Déposez sur un projet pour y ranger ${name}.` (en : `Drop on a project to move ${name} there.`) |
| `dropHere` / `dropNow(name)` | `Déposer ici` / `Lâcher pour asseoir ${name}` |
| `joined(name, table)` | `${name} rejoint la table ${table}. Ledge s'en souviendra pour ce dossier.` (en : `${name} joins the ${table} table. Ledge will remember this folder.`) |
| `offline(name)` | `Impossible de ranger ${name} : le daemon Ledge local n'est pas joignable.` (en : `${name} could not be moved: the local Ledge daemon is not reachable.`) |
| `outdated(name)` | `Impossible de ranger ${name} : mettez à jour le daemon Ledge local, il ne connaît pas encore les projets.` (en : `${name} could not be moved: update the local Ledge daemon, it does not know projects yet.`) |
| `invalid(name)` | `Impossible de ranger ${name} : Ledge ne peut pas mémoriser ce dossier.` |

- [ ] **Step 1: Écrire `test/atelier-filing.test.tsx`**

```tsx
const named = (name: string) => Object.assign(new Error(name), { name });
const projects: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };

it('writes the folder rule, and names each refusal', () => {
  const fleet = { setProjects: vi.fn() };
  const kit = fakeSession('dev:kit', { machineId: 'dev', cwd: '/home/me/scratch/' });
  expect(fileSession(fleet, projects, kit, 'ledge')).toBe('sent');
  expect(fleet.setProjects).toHaveBeenCalledWith({ projects: projects.projects, rules: [{ machine: 'dev', path: '/home/me/scratch', project: 'ledge' }] });
  expect(ruleFor(fakeSession('kit', { cwd: '/tmp' }), 'ledge')).toEqual({ machine: 'local', path: '/tmp', project: 'ledge' });
  for (const [error, result] of [['DaemonOffline', 'offline'], ['DaemonOutdated', 'outdated'], ['ZodError', 'invalid']] as const) {
    fleet.setProjects.mockImplementationOnce(() => { throw named(error); });
    expect(fileSession(fleet, projects, kit, 'ledge')).toBe(result);
  }
  fleet.setProjects.mockClear();
  expect(fileSession(fleet, null, kit, 'ledge')).toBe('outdated');
  expect(fleet.setProjects).not.toHaveBeenCalled();
});
```

Pour l'intégration, le harnais est `boot()` de `atelier.test.tsx` (Kit dans `/tmp`). Le `DataTransfer` est factice :

```ts
const transfer = () => { const data: Record<string, string> = {}; return { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '', effectAllowed: '', dropEffect: '' }; };
```

```tsx
it('dropping Kit on a table writes the rule; Kit sits there once the daemon broadcasts, once only', async () => {
  const { d } = await boot();
  const card = document.querySelector('.unassigned-card')!;
  const table = screen.getByRole('region', { name: 'Ledge table' });
  const dt = transfer();
  fireEvent.dragStart(card, { dataTransfer: dt });
  fireEvent.dragOver(table, { dataTransfer: dt });
  expect(table).toHaveClass('drop-over');
  fireEvent.drop(table, { dataTransfer: dt });
  await waitFor(() => expect(d.received).toContainEqual({ type: 'projects.set', projects: { projects: projects3.projects, rules: [{ machine: 'local', path: '/tmp', project: 'ledge' }] } }));
  await waitFor(() => expect(within(table).getByRole('button', { name: /^Kit,/ })).toHaveClass('just-seated'));
  expect(screen.getAllByRole('button', { name: /^Kit,/ })).toHaveLength(1);
  expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Kit joins the Ledge table. Ledge will remember this folder.');
});
it('a project of the sidebar is a target too, and says so while dragging', async () => {
  const { side } = await boot();
  const row = side.getByRole('button', { name: /^Payment Service/ });
  const dt = transfer();
  fireEvent.dragStart(document.querySelector('.unassigned-card')!, { dataTransfer: dt });
  expect(screen.getByText('Drop on a project to move Kit there.')).toBeVisible();
  fireEvent.dragOver(row, { dataTransfer: dt });
  expect(row).toHaveClass('drop-over');
  fireEvent.dragOver(side.getByRole('button', { name: /No project/ }), { dataTransfer: dt });
  expect(side.getByRole('button', { name: /No project/ })).not.toHaveClass('drop-over');
  fireEvent.drop(row, { dataTransfer: dt });
  await waitFor(() => expect(within(screen.getByRole('region', { name: /^Payment Service.* table$/ })).getByRole('button', { name: /^Kit,/ })).toBeVisible());
});
it('Move to… files Kit; New project… opens the project dialog; Escape closes only the menu', async () => {
  const { side, user } = await boot();
  await user.click(side.getByRole('button', { name: /No project/ }));            // filter « Sans projet »
  const zone = within(screen.getByRole('region', { name: 'No project' }));
  await user.click(zone.getByRole('button', { name: 'Move to…' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
  await user.click(zone.getByRole('button', { name: 'Move to…' }));
  await user.click(screen.getByRole('menuitem', { name: /New project…/ }));
  expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(zone.getByRole('button', { name: 'Move to…' }));
  await user.click(screen.getByRole('menuitem', { name: /^Ledge/ }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'No project' })).toBeNull());      // the filter stays, the zone empties
  expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
});
it('with the local daemon down, Move to… says so in plain words and Kit stays', async () => {
  const { d, side, user } = await boot();
  await d.close();
  await waitFor(() => expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('offline'));
  const zone = within(screen.getByRole('region', { name: 'No project' }));
  await user.click(zone.getByRole('button', { name: 'Move to…' }));
  await user.click(screen.getByRole('menuitem', { name: /^Ledge/ }));
  expect(screen.getByRole('status')).toHaveTextContent('Kit could not be moved: the local Ledge daemon is not reachable.');
  expect(zone.getByRole('button', { name: /^Kit,/ })).toBeVisible();
});
```

`projects3` désigne les trois projets du harnais.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/atelier-filing.test.tsx`
Expected : FAIL, `filing.ts` introuvable.

- [ ] **Step 3: Implémenter `filing.ts`, `Toast`, les cibles, le menu et le branchement**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/atelier-filing.test.tsx
git commit -m "feat(desktop): put an agent away: drag it onto a table or a sidebar project, or Move to…, the daemon remembers the folder

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: L'atelier dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/atelier.spec.ts`

**Interfaces:**
- Consumes : tout ce qui précède ; `fakeDaemon`, `session`, `eight` (`e2e/daemon.ts`).
- Produces : les scénarios que les lots 5 (Liste, cible du « +N ») et 9 (chat ancré) étendront.

Données du fichier :
- `twoProjects` est celui de `shell.spec.ts` ;
- `crowd` = `eight` plus `session('ada', { name: 'Ada', cwd: '/w/ledge' })`, `session('zed', …)`, `session('zia', …)` dans `/w/ledge`, plus des `helpers` :
  - Otto : `o1`, `o2`, `o3` ;
  - Nova : `n1`, `n2`.
  
  À la table Ledge, l'ordre par id assoit Ada, Bix, Echo, Nova, Otto et Pim. Nova (x = 280) et Otto (x = 350) sont à droite du milieu (245), et Nova passe d'abord : `n1` et `n2` vont à droite, puis `o1` et `o2` à gauche, et `o3` n'a plus de place. D'où `+3 at this table` (Zed, Zia, `o3`) ;
- `kit` = `session('kit', { name: 'Kit', cwd: '/tmp/scratch' })`, sans projet.

- [ ] **Step 1: Écrire `atelier.spec.ts`**

```ts
const noScroll = (page: Page) => page.locator('.overview-scroll.atelier').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);
const level = (page: Page) => page.getByRole('toolbar', { name: 'Atelier zoom' }).getByRole('button', { name: 'Back to 100 %' });

test('at fit nothing scrolls; Ctrl + wheel zooms under the pointer; + − 0', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  expect(await noScroll(page)).toBe(true);
  const fitted = await level(page).textContent();
  const box = (await page.getByRole('region', { name: 'Ledge table' }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
  await expect(level(page)).not.toHaveText(fitted!);
  await page.keyboard.press('0');
  await expect(level(page)).toHaveText(fitted!);
  await page.keyboard.press('+');
  await expect(level(page)).not.toHaveText(fitted!);
});
test('double-click frames a table, the floor fits again; legend and zoom bar stay put', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/');
  const legend = page.locator('.workspace-legend');
  await expect(legend).toBeVisible();
  const before = await legend.boundingBox();
  const table = page.getByRole('region', { name: 'Website table' });
  await table.locator('.office-rug').dblclick({ position: { x: 20, y: 60 } });
  await expect(page.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'false');
  const t = (await table.boundingBox())!, v = (await page.locator('.overview-scroll.atelier').boundingBox())!;
  expect(Math.abs(t.x + t.width / 2 - (v.x + v.width / 2))).toBeLessThan(v.width * 0.1);
  expect(await legend.boundingBox()).toEqual(before);
  await page.locator('.office-shell').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
});
test('a resize and full screen refit without scrollbars', async ({ page }) => {
  await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(() => noScroll(page)).toBe(true);
  const narrow = Number.parseInt((await level(page).textContent())!, 10);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('aside.sidebar')).toBeHidden();
  await expect.poll(async () => Number.parseInt((await level(page).textContent())!, 10)).toBeGreaterThanOrEqual(narrow);
  expect(await noScroll(page)).toBe(true);
});
test('drag Kit from Sans projet onto a table: the daemon gets the rule, Kit sits there', async ({ page }) => {
  const daemon = await fakeDaemon(page, [...eight, kit], { projects: twoProjects });
  await page.goto('/');
  await page.locator('.unassigned-card', { hasText: 'Kit' }).dragTo(page.getByRole('region', { name: 'Ledge table' }));
  await expect(page.getByRole('region', { name: 'Ledge table' }).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  expect(daemon.received).toContainEqual(expect.objectContaining({ type: 'projects.set', projects: expect.objectContaining({ rules: [{ machine: 'local', path: '/tmp/scratch', project: 'ledge' }] }) }));
  await expect(page.getByRole('status')).toHaveText('Kit joins the Ledge table. Ledge will remember this folder.');
});
test('a crowded table: six seats, four at the ends, +N opens the List on the project', async ({ page }) => {
  await fakeDaemon(page, crowd, { projects: twoProjects });
  await page.goto('/');
  const table = page.getByRole('region', { name: 'Ledge table' });
  await expect(table.locator('.agent-seat:not(.helper-seat)')).toHaveCount(6);
  await expect(table.locator('.helper-seat')).toHaveCount(4);
  await table.getByRole('button', { name: /\+3 at this table/ }).click();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('banner').getByText('Ledge')).toBeVisible();
});
test('a long project name on the rug is cut with … and stays inside the rug', async ({ page }) => {
  const long = { projects: [{ ...twoProjects.projects[0]!, name: 'Payment Service Platform Migration Europe' }, twoProjects.projects[1]!], rules: [] };
  await fakeDaemon(page, eight, { projects: long });
  await page.goto('/');
  const table = page.getByRole('region', { name: 'Payment Service Platform Migration Europe table' });
  const name = table.getByRole('button', { name: /^Conversations of project/ });
  await expect(name).toHaveAttribute('title', 'Payment Service Platform Migration Europe');
  expect(await name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const label = (await table.locator('.room-heading').boundingBox())!, rug = (await table.locator('.office-rug').boundingBox())!;
  expect(label.x + label.width).toBeLessThanOrEqual(rug.x + rug.width);
});
```

- [ ] **Step 2: Lancer Playwright**

Run: `pnpm --filter desktop e2e`
Expected : tous les scénarios passent : 4 de `boot`, 4 de `shell` et 6 de `atelier`.

- [ ] **Step 3: Vérification du dépôt**

Run: `pnpm -r typecheck && pnpm test && pnpm -r build`
Expected : tout passe. Seule l'instabilité connue de l'overlay (`prototype-parity`) peut apparaître ; la signaler sans la corriger.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/e2e/atelier.spec.ts
git commit -m "test(desktop): the atelier in the browser: fit without scrollbars, wheel and keys, framing, resize and full screen, drag and drop, a crowded table, a long name

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
