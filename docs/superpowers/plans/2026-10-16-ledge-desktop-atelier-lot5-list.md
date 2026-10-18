# Ledge Desktop Atelier, lot 5 : la Liste — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La Liste de la maquette à la place de l'emplacement « Liste » du lot 3 : une barre d'outils fixe (filtre texte, pastilles d'état, « Grouper par », densité), des groupes à en-tête fixe, des lignes en colonnes où ce qui attend une décision passe en tête, les sous-agents discrets, les actions rapides (Autoriser / Refuser, Répondre, Ouvrir), F / J / K / Entrée, « Sans projet » rangé par glisser-déposer ou « Ranger dans… ». Le tout sur le vrai fleet, les projets du daemon et le rangement du lot 4.

**Architecture:** Tout ce que la Liste affiche est calculé par une fonction pure (`src/list/model.ts` : seaux, filtres, groupes, ordre, compteurs, lignes de sous-agents, ordre de J / K) et un formateur pur d'activité (`src/list/time.ts`), testés sur des valeurs exactes. Les composants (`List`, `ListToolbar`, `ListGroup`, `ListRow`) ne font que rendre ce modèle avec les classes de la maquette. Les décisions passent par un crochet partagé (`src/fleet/decisions.ts`) que le lot 6 reprendra pour la demande épinglée : rien n'est optimiste, une décision part une fois par demande et la ligne bouge quand le daemon diffuse la session. Avant d'ajouter une troisième copie, le lot extrait un menu partagé, le bot et le badge d'une session, et le harnais de test.

**Tech Stack:** TypeScript, React 19, Vite 6, CSS à la main dans `src/styles/` (requête de conteneur `@container` comme la maquette), glisser-déposer HTML5 natif (via `useFiling` du lot 4), vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` § 7 lot 5. Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` § 2.6 en entier, plus §§ 2.3 (« Sans projet » : glisser vers un groupe de projet ou « Ranger dans… »), 2.5 (filtre de projet, fil d'Ariane « Liste »), 3 (les projets de la barre latérale restent des cibles de dépôt), 9 (F, J / K, Entrée, Échap). Maquette : `docs/mockups/desktop-observatory/list.tsx` (`SessionList` : `bucketOf`, `BUCKETS`, `when`, `Hl`, `treeRows`, `groups`, `summary`, `header`, `row`, la barre d'outils lignes 143-154, les états vides lignes 155-156, la note lignes 161), `list.css` en entier, `observatory.tsx` (le branchement de `SessionList` ligne 310, `quickDecide` ligne 234, `listOrder` / `navigable` lignes 196-197, la pastille « +N » ligne 328). Page construite : `docs/mockups/ledge-desktop-observatory.html`.

## Global Constraints

- Worktree `.worktrees/desktop-atelier`, branche `feat/desktop-atelier`.
- **La maquette fait foi** pour la disposition, les classes et les CSS. `list.css` est porté avec ses sélecteurs tels quels. Écarts voulus :
  - `.overview-scroll.compact` devient `.overview-scroll.list` (l'identifiant de vue du lot 3) ;
  - la couleur d'un projet passe en `style` sur `.side-swatch` (`PROJECT_COLORS`), au lieu des règles `.swatch-<id>` injectées ;
  - **l'ordre dans un groupe** : ce qui attend une décision d'abord (la plus longue attente en tête), puis le reste dans l'ordre de `mainOrder` (le même que l'atelier et Alt n). La maquette trie aussi le reste par activité récente : avec le vrai fleet, `lastActivityAt` change à chaque événement et les lignes bougeraient sans cesse sous le pointeur ;
  - **les sous-agents restent sous leur parent dans les trois groupements**, État compris (la maquette les aplatit en « ↳ Parent » quand on groupe par état) : un sous-agent n'a ni machine ni horloge à lui, et ses demandes passent par son parent.
- **Textes** dans `src/i18n/messages.ts`, `fr` source de vérité. Les textes français des tableaux sont exacts ; l'implémenteur écrit l'anglais, sauf les traductions fixées par les tests, que chaque tâche liste.
- **Le harnais n'est jamais écrit** dans la Liste : la forme du bot le dit.
- **Agent principal** = une `Session`, une ligne. **Sous-agent** = une entrée de `session.helpers` : une ligne enfant, sans action propre ; l'ouvrir ouvre la session de son parent. Son nom est `kind`, son bot a `tool` = celui du parent et la graine `${parent.id}:${helper.id}`, qui est aussi la clé de sa ligne.
- **Seau d'un agent** (pastilles et groupement par état) : `offline` d'abord ; sinon `botState` `approval` ou `question` → `decide` ; `done` ou `idle` → `done` (comme `dotOf` et les feuilles du lot 4) ; tout le reste (`starting`, `working`, `error`, `readonly`) → `running`, comme `bucketOf` de la maquette.
- **Rien d'optimiste** : une décision envoie `session.decide` une seule fois par demande ; la ligne ne change qu'à la diffusion de la session. Ranger un agent suit les règles du lot 4 (`useFiling`).
- **Pas de Y / N dans la Liste** : N y ouvre déjà « Nouvelle session » (lot 3), et une décision au clavier sur la ligne choisie se prendrait par erreur. On décide au clavier par Tab jusqu'au bouton. Y / N restent à la demande épinglée de la session (lot 6).
- **Stockage** : une nouvelle clé, `desktop.list` = `{ group: 'project' | 'machine' | 'state', density: 'comfy' | 'tight' }`, validée champ par champ (défauts `project` et `comfy`). Le filtre texte, la pastille d'état, les groupes repliés et les sous-agents dépliés ne sont pas mémorisés : ils vivent dans la Liste et repartent à zéro quand elle se démonte (ouvrir une session, passer à l'atelier), comme dans la maquette. Les noms de `OBSOLETE_KEYS` ne sont jamais réutilisés.
- Aucune nouvelle dépendance. Aucune erreur console dans Playwright. Aucun changement Tauri.
- Suite unitaire en anglais. Commits `feat(desktop): …`, `refactor(desktop): …`, `test(desktop): …`, terminés par la ligne `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Une décision cliquée alors que la machine tombe ou que le daemon refuse** : un seul `session.decide` même sur un double clic, les boutons attendent pendant l'envoi, un refus (ou une machine hors ligne au moment de l'envoi) est dit en clair dans le toast et rend les boutons, une décision jamais confirmée revient au bout de 8 s avec un avis, et la ligne garde son état réel. Tests à la tâche 6 (crochet et intégration).
2. **Filtre de projet, filtre texte et pastille combinés jusqu'au vide** : un état vide qui nomme ce qui filtre, « Effacer les filtres » qui ne retire pas le filtre de projet, une pastille choisie qui reste active même à 0, et des compteurs justes (pastilles sous le filtre texte, `n/total` dans l'en-tête). Tests aux tâches 3 et 4.
3. **Une session qui change d'état pendant qu'elle est choisie ou focalisée** : elle passe en tête de son groupe, la sélection clavier et le focus restent sur elle, et J repart d'elle. Test à la tâche 5.
4. **Taper dans le filtre** : J, K, F et N y sont du texte ; Échap vide d'abord le champ, puis le quitte, et seulement ensuite retire le filtre de projet. Tests à la tâche 5.
5. **Beaucoup de sessions et une fenêtre étroite** : les en-têtes restent collés sous la barre d'outils, un groupe replié le reste à chaque mise à jour du fleet, et sous 780 px machine et activité passent sous la tâche sans défilement horizontal. Tests aux tâches 4 (repli) et 8 (en-têtes collés, 760 px).

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/desktop/test/helpers.ts` | Nouveau : `declarations`, `transfer`, `boot`, jeux de sessions partagés |
| `apps/desktop/src/shell/SessionBot.tsx` | Nouveau : le bot et le badge d'une session ou d'un sous-agent |
| `apps/desktop/src/shell/Menu.tsx` | Nouveau : le menu partagé (« … » des tables, « Ranger dans… », la Liste) |
| `apps/desktop/src/atelier/MoveTo.tsx` | Nouveau : « Ranger dans… », partagé par « Sans projet » et la Liste |
| `apps/desktop/src/list/model.ts`, `time.ts`, `prefs.ts` | Nouveaux : le modèle pur, l'activité, la clé `desktop.list` |
| `apps/desktop/src/list/{List,ListToolbar,ListGroup,ListRow}.tsx` | Nouveaux : rendu |
| `apps/desktop/src/fleet/decisions.ts` | Nouveau : `requestKey`, `useDecisions` |
| `apps/desktop/src/fleet/useFleet.ts` | `lastError` dans `FleetView` |
| `apps/desktop/src/nav/agents.ts` | `machineOf` (venu de `ProjectTable`), `fold` exporté |
| `apps/desktop/src/atelier/{ProjectTable,Unassigned}.tsx`, `src/shell/{SearchPalette,TopBar,icons}.ts(x)` | Menu, bot et badge partagés |
| `apps/desktop/src/App.tsx` | La Liste à la place de `Pending`, `useDecisions` |
| `apps/desktop/src/styles/list.css` | Nouveau : `list.css` de la maquette |
| `apps/desktop/src/styles/{app,shell}.css` | Import, `z-index` du toast |
| `apps/desktop/test/*`, `apps/desktop/e2e/{daemon.ts,list.spec.ts}` | Tests |

---

### Task 1: Hygiène : harnais de test, toast au premier plan, bot et badge d'une session

Trois restes du lot 4, sans changement visible sauf le toast. Le toast passe sous le voile d'une fenêtre modale (`z-index: 5`) et sous le chat étroit (`z-index: 4`) : `.toast-region` est en `position: fixed` sans `z-index`, donc le `z-index: 10` de `.toast` ne vaut qu'à l'intérieur de son contexte d'empilement. Le harnais `boot()` et l'aide `declarations()` sont copiés dans six fichiers de test, et le bot d'une session dans cinq composants.

**Files:**
- Create: `apps/desktop/test/helpers.ts`, `apps/desktop/src/shell/SessionBot.tsx`, `apps/desktop/test/session-bot.test.tsx`
- Modify: `apps/desktop/src/styles/shell.css`, `src/atelier/{ProjectTable,Unassigned}.tsx`, `src/shell/{SearchPalette,TopBar}.tsx`, `test/{shell,keys,search,atelier,atelier-zoom,atelier-filing}.test.tsx`

**Interfaces:**
- Consumes : `Bot`, `botState`, `poseFor`, `BotState` (`@ledge/ui`), `Badge`, `useTheme`, `useMotionPreferences`, `helperState` (`src/atelier/layout.ts`), `createMockDaemon`, `fakeSession` (`@ledge/fleet/test/mockDaemon`), `createDesktopFleet`, `App`.
- Produces :

```ts
// shell/SessionBot.tsx
/** Le bot d'une session : figé hors ligne (`frozen`), lecture seule pour `hook_only`, graine = id. */
export function SessionBot({ session, size, paused }: { session: Session; size: number; paused?: boolean }): JSX.Element;
/** Le bot d'un sous-agent : `tool` du parent, graine `${parent.id}:${helper.id}`, état `helperState`, figé si le parent est hors ligne. */
export function HelperBot({ helper, parent, size, paused }: { helper: Helper; parent: Session; size: number; paused?: boolean }): JSX.Element;
/** Hors ligne : `<Badge state="readonly" label={t.atelier.offline} />`, quel que soit l'état ; sinon `<Badge state={state} />`. */
export function StateBadge({ state, offline }: { state: BotState; offline?: boolean }): JSX.Element;

// test/helpers.ts
/** jsdom ne charge aucune feuille : les déclarations des règles de premier niveau qui nomment `selector` (blocs @media ET @container retirés). */
export function declarations(sheet: string, selector: string): string;
/** Le DataTransfer factice du glisser-déposer (celui de atelier-filing.test.tsx). */
export function transfer(): { setData(k: string, v: string): void; getData(k: string): string; effectAllowed: string; dropEffect: string };
export const PROJECTS: Projects;        // ledge (Ledge, /w/ledge), pay (Payment Service Platform Migration Europe, /w/pay), docs (Docs, /w/docs)
export const TWO_PROJECTS: Projects;    // ledge et pay : shell, keys, search
export const DEFAULT_SESSIONS: Session[];   // Otto (Ledge, approval), Nova (pay, working), Kit (/tmp, question)
export type MockDaemon = Awaited<ReturnType<typeof createMockDaemon>>;
/** Monte l'app sur un daemon factice (machines Local et Dev SSH). `list` écrit `desktop.overview` sur la Liste avant le rendu.
 *  Prêt quand la ligne du dernier projet est dans la barre latérale et, s'il y a des sessions, que le nom de la première est affiché. */
export function boot(o?: { sessions?: Session[]; projects?: Projects; list?: boolean }): Promise<{ d: MockDaemon; side: ReturnType<typeof within>; view: RenderResult; client: DaemonClient; user: UserEvent }>;
/** À appeler dans le afterEach de chaque fichier qui utilise boot. */
export function closeDaemons(): Promise<void>;
```

`SessionBot` et `StateBadge` remplacent les `<Bot>` et `<Badge>` de `ProjectTable` (place, têtes du « +N »), `Unassigned`, `SearchPalette` et `TopBar` (bot du fil d'Ariane, badge de la session) ; `HelperBot` remplace `helperBot` de `ProjectTable`. Le bot de la recherche et du fil d'Ariane devient figé pour une session hors ligne, et le badge de la barre du haut dit « Hors ligne » : c'est voulu.

- [ ] **Step 1: Écrire `test/session-bot.test.tsx` et le test du toast**

```tsx
it("a session's bot: frozen offline, read-only for hook_only; a helper's bot borrows its parent's tool", () => {
  const parent = fakeSession('local:otto', { tool: 'codex', offline: true, state: 'waiting_permission' });
  render(<LangProvider lang="en">
    <SessionBot session={parent} size={32} />
    <SessionBot session={fakeSession('local:hook', { source: 'hook_only' })} size={32} />
    <HelperBot helper={{ id: 'h1', kind: 'Explore', task: 'Lire', state: 'waiting_input' }} parent={parent} size={24} />
  </LangProvider>);
  const [a, b, c] = [...document.querySelectorAll('[data-frozen]')];
  expect(a).toHaveAttribute('data-frozen', 'true'); expect(a).toHaveAttribute('data-state', 'approval');
  expect(b).toHaveAttribute('data-readonly', 'true');
  expect(c).toHaveAttribute('data-tool', 'codex'); expect(c).toHaveAttribute('data-state', 'question'); expect(c).toHaveAttribute('data-frozen', 'true');
});
it('the badge says Offline over any state', () => {
  render(<LangProvider lang="en"><StateBadge state="approval" offline /><StateBadge state="question" /></LangProvider>);
  expect(screen.getByText('Offline')).toHaveAttribute('data-badge', 'readonly');
  expect(screen.getByText('Question')).toHaveAttribute('data-badge', 'question');
});
```

Dans `shell.test.tsx`, avec `declarations` importé de `helpers.ts` :

```ts
it('the toast sits above a dialog and the narrow chat', () => {
  expect(declarations('shell.css', '.toast-region')).toBe('position:fixed;width:0;height:0;z-index:10');
});
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/session-bot.test.tsx test/shell.test.tsx`
Expected : FAIL, `SessionBot` introuvable et `.toast-region` sans `z-index`.

- [ ] **Step 3: Implémenter**

- `.toast-region{position:fixed;width:0;height:0;z-index:10}` dans `shell.css`.
- `SessionBot.tsx`, puis la migration des cinq composants.
- `test/helpers.ts`, puis la migration : `shell`, `keys` et `search` passent `projects: TWO_PROJECTS` ; `atelier`, `atelier-zoom` et `atelier-filing` gardent `PROJECTS` (`projects3` devient `PROJECTS`) ; chaque fichier garde `beforeEach(() => localStorage.clear())` et fait `afterEach(async () => { cleanup(); await closeDaemons(); })` en plus de ce qu'il faisait déjà. `app-tray.test.tsx` garde son `boot` (une seule machine, le plateau). Aucun fichier ne garde sa copie de `declarations`, `boot` ou `transfer`.

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe ; `grep -ln "function declarations\|async function boot" apps/desktop/test` ne trouve que `helpers.ts` et `app-tray.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "refactor(desktop): one test harness, one session bot and badge; the toast sits above dialogs and the narrow chat

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Le menu partagé

Le menu « … » d'une table et « Ranger dans… » ont chacun leur copie de la fermeture (clic dehors, Échap capturé sur la fenêtre). La Liste en ajouterait une troisième. Un seul composant les remplace, et apprend ce qui manquait : les flèches, Début / Fin, et le focus rendu au bouton.

**Files:**
- Create: `apps/desktop/src/shell/Menu.tsx`, `apps/desktop/test/menu.test.tsx`
- Modify: `apps/desktop/src/atelier/ProjectTable.tsx`, `apps/desktop/src/atelier/Unassigned.tsx`

**Interfaces:**
- Consumes : rien de neuf.
- Produces :

```ts
// shell/Menu.tsx
export interface MenuTrigger { ref: React.RefObject<HTMLButtonElement | null>; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; onClick(): void }
export interface MenuProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  label: string;                         // aria-label du role="menu"
  className: string;                     // l'enveloppe : 'room-menu-wrap', 'assign-wrap', 'lrow-menu assign-wrap'
  menuClassName: string;                 // 'assign-menu room-menu', 'assign-menu'
  /** À l'ouverture, le menu s'ouvre vers le haut (classe `up`) si le bas du bouton dépasse 55 % de la hauteur de la fenêtre (la Liste). */
  flip?: boolean;
  trigger(t: MenuTrigger): React.ReactNode;
  children: React.ReactNode;             // des MenuItem
}
export function Menu(p: MenuProps): JSX.Element;
/** Un choix : ferme le menu, rend le focus au bouton, puis appelle onSelect. */
export function MenuItem(p: Omit<React.ComponentPropsWithoutRef<'button'>, 'onClick' | 'role'> & { onSelect(): void }): JSX.Element;
```

Comportement :
- ouvert, le premier `menuitem` prend le focus ;
- ↓ / ↑ passent à l'élément suivant / précédent, en boucle ; Début / Fin vont au premier / dernier (`preventDefault`) ;
- Échap : écouteur `keydown` **capturé sur `window`** pendant que le menu est ouvert, `preventDefault` + `stopPropagation`, fermeture, focus rendu au bouton. L'écouteur global (`useKeys`) n'en voit rien, donc Échap ne ferme pas aussi une couche de navigation ;
- `mousedown` hors de l'enveloppe : fermeture, sans rendre le focus ;
- `MenuItem` lit la fermeture par un contexte.

Migrations : `ProjectTable` garde son état `menu` et ses trois choix ; `Unassigned` garde `assigning`, la fermeture au `dragstart` et celle quand la session quitte la zone. Les tests du lot 4 (`atelier-table`, `atelier-filing`) restent tels quels et passent.

- [ ] **Step 1: Écrire `test/menu.test.tsx`**

```tsx
function Harness({ onSelect }: { onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Menu open={open} onOpenChange={setOpen} label="Actions" className="assign-wrap" menuClassName="assign-menu" trigger={p => <button {...p}>Actions</button>}>
      {['Alpha', 'Beta', 'Gamma'].map(v => <MenuItem key={v} onSelect={() => onSelect(v)}>{v}</MenuItem>)}
    </Menu>
    <button>Elsewhere</button>
  </>;
}
const setup = () => { const onSelect = vi.fn(); render(<Harness onSelect={onSelect} />); return { onSelect, user: userEvent.setup(), trigger: screen.getByRole('button', { name: 'Actions' }) }; };

it('the trigger says it opens a menu; the menu opens on its first item; ↓ ↑ wrap, Home and End', async () => {
  const { user, trigger } = setup();
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu'); expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu', { name: 'Actions' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
  await user.keyboard('{ArrowDown}'); expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveFocus();
  await user.keyboard('{ArrowUp}{ArrowUp}'); expect(screen.getByRole('menuitem', { name: 'Gamma' })).toHaveFocus();
  await user.keyboard('{Home}'); expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
  await user.keyboard('{End}'); expect(screen.getByRole('menuitem', { name: 'Gamma' })).toHaveFocus();
});
it('Escape closes it, goes no further and gives the focus back to its trigger', async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  const onWindow = vi.fn(); window.addEventListener('keydown', onWindow);
  await user.keyboard('{Escape}');
  window.removeEventListener('keydown', onWindow);
  expect(onWindow).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
});
it('a choice closes it, gives the focus back, then acts; a mousedown outside closes it', async () => {
  const { user, trigger, onSelect } = setup();
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: 'Beta' }));
  expect(onSelect).toHaveBeenCalledWith('Beta');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(screen.queryByRole('menu')).toBeNull();
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/menu.test.tsx`
Expected : FAIL, `Menu` introuvable.

- [ ] **Step 3: Implémenter `Menu`, `MenuItem` et les deux migrations**

Les `autoFocus` des deux menus disparaissent (le menu focalise lui-même son premier élément), ainsi que leurs deux copies de l'effet de fermeture.

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe, `atelier-table` et `atelier-filing` compris.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/menu.test.tsx
git commit -m "refactor(desktop): one menu for the table actions and Move to…: arrows, Home / End, Escape and a choice give the focus back

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Le modèle de la Liste

**Files:**
- Create: `apps/desktop/src/list/model.ts`, `apps/desktop/src/list/time.ts`, `apps/desktop/src/fleet/decisions.ts` (`requestKey` seulement), `apps/desktop/test/list-model.test.ts`
- Modify: `apps/desktop/src/nav/agents.ts` (`machineOf` venu de `ProjectTable`, `fold` exporté ; les imports de `ProjectTable` et `Unassigned` suivent), `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : `mainOrder`, `taskOf`, `fold`, `machineOf` (`nav/agents.ts`) ; `botState` ; `helperState`, `tableBranch` (`atelier/layout.ts`) ; `folderOf` (`atelier/filing.ts`) ; `ProjectFilter` ; `MachineState` (`@ledge/fleet`) ; `Messages` (`i18n/messages.ts`).
- Produces :

```ts
// list/model.ts
export type Bucket = 'decide' | 'running' | 'done' | 'offline';
export const BUCKETS: readonly Bucket[];                 // ['decide', 'running', 'done', 'offline'] : pastilles et groupes par état
export type Chip = Bucket | 'all';
export type GroupBy = 'project' | 'machine' | 'state';
export function bucketOf(s: Session): Bucket;
export function helperBucket(h: Helper, parent: Session): Bucket;       // parent hors ligne → 'offline', sinon le seau de helperState(h)
/** Le dépôt d'une ligne : `s.repo`, à défaut le nom du dossier de `cwd`. */
export function repoOf(s: Session): string;
/** Ce que la ligne propose : Autoriser / Refuser pour une permission ou un diff (pas une question, pas un plan à relire), Répondre pour une question ;
 *  jamais hors ligne ni en lecture seule (`hook_only`). */
export function quickActions(s: Session): { decide: boolean; reply: boolean };

export type ListRow =
  | { kind: 'main'; key: string; session: Session; context: boolean; kids: number; expanded: boolean }   // key = session.id
  | { kind: 'helper'; key: string; helper: Helper; parent: Session; last: boolean };                    // key = `${parent.id}:${helper.id}`
export interface ListGroup {
  key: string;                          // 'project:<id>' | 'project:none' | 'machine:<id>' | 'state:<bucket>'
  kind: GroupBy;
  label: string;                        // nom du projet, labels.unassigned, libellé de la machine, ou labels.buckets[bucket]
  project?: Project;
  unassigned?: true;
  machine?: { id: string; offline: boolean };
  bucket?: Bucket;
  branch: string | null;                // tableBranch des agents principaux d'un groupe de projet ; null sinon
  members: readonly Session[];          // ses agents principaux sous le filtre de projet, avant filtre texte et pastille
  tally: Record<Bucket, number>;        // « x à décider · y en cours… » sur `members`
  shown: number;                        // les lignes d'agents principaux affichées (lignes de contexte comprises)
  rows: readonly ListRow[];
}
export interface ListCtx {
  projects: Projects | null;
  projectIdOf: (s: Session) => string | null;
  machines: readonly Pick<MachineState, 'id' | 'label' | 'status'>[];
  waits: ReadonlyMap<string, string>;   // début de chaque attente (time.ts, trackWaits) ; à défaut lastActivityAt
  labels: { unassigned: string; buckets: Record<Bucket, string> };
}
export interface ListQuery { text: string; chip: Chip; group: GroupBy; helpers: boolean; toggled: ReadonlySet<string>; filter: ProjectFilter }
export interface ListModel {
  groups: ListGroup[];                  // seulement les groupes qui ont des membres ET des lignes
  counts: Record<Chip, number>;         // les pastilles : agents principaux sous le filtre de projet et le filtre texte
  total: number;                        // agents principaux sous le filtre de projet
  filtering: boolean;                   // texte non vide ou pastille autre que 'all'
  empty: Project | null;                // le projet filtré n'a aucun agent
}
export function listModel(order: readonly Session[], ctx: ListCtx, q: ListQuery): ListModel;
/** L'ordre affiché, celui de J / K : groupe par groupe, sans les groupes repliés, lignes de sous-agents dépliées comprises. */
export function walkRows(groups: readonly ListGroup[], collapsed: ReadonlySet<string>): ListRow[];

// list/time.ts
export type Span = 'now' | { n: number; unit: 'min' | 'h' | 'd' };
/** Arrondi à l'unité inférieure : < 1 min → 'now', < 60 min → min, < 24 h → h, sinon jours ; une durée négative → 'now'. */
export function spanOf(ms: number): Span;
export interface When { text: string; title: string; waiting: boolean }
/** « depuis 12 min » pour une attente (depuis `since`, à défaut lastActivityAt), « il y a 3 min » sinon (lastActivityAt). */
export function whenOf(s: Session, since: string | undefined, now: number, t: Messages['list']['when']): When;
export interface Wait { key: string; since: string }
/** Le début de chaque attente : le plus ancien lastActivityAt vu pour la même demande (état + requestKey). PaneChanged rafraîchit
 *  lastActivityAt pendant une attente : sans ce suivi, « depuis » repartirait de zéro. Seules les sessions du seau 'decide' sont suivies. */
export function trackWaits(prev: ReadonlyMap<string, Wait>, sessions: readonly Session[]): Map<string, Wait>;
```

`trackWaits` utilise `requestKey` de la tâche 6 : cette tâche l'écrit déjà dans `src/fleet/decisions.ts` (`${pending.kind}\n${pending.text}\n${pending.helperId ?? ''}`, null sans demande, comme `sends.ts` de `origin/feat/desktop`), sans le crochet.

Règles de `listModel` :
- **Portée** : le filtre de projet comme `sceneOf` du lot 4 (`'all'`, `'none'`, un id ; un projet disparu ou `projects` null compte comme sans projet).
- **Filtre texte** (plié comme `fold` : sans accents ni casse) : un agent principal correspond par son nom, sa tâche (`taskOf`), sa machine (`machineOf`), son dépôt (`repoOf`) ou le nom de son projet (`labels.unassigned` sans projet) ; un sous-agent par `kind` ou `task`, seulement si `helpers`.
- **Pastille** : sur le seau de l'agent principal seulement. Quand un sous-agent attend, son parent attend aussi (le daemon le met en `waiting_permission`).
- **Ligne de contexte** : un agent principal qui ne correspond pas au texte mais dont un sous-agent correspond est affiché `context: true`, avec ses seuls sous-agents correspondants dépliés.
- **Sous-agents** : `kids = helpers.length` (0 si `!helpers`) ; hors recherche, `expanded = (un sous-agent est en 'decide') !== toggled.has(session.id)` ; dépliés, tous dans leur ordre, le dernier `last: true`.
- **Ordre dans un groupe** : seau `decide` d'abord, par début d'attente croissant (`waits`, à défaut `lastActivityAt`), puis le reste dans l'ordre reçu (`mainOrder`).
- **Groupes** : par projet, les projets dans leur ordre puis « Sans projet » ; par machine, les machines du fleet dans leur ordre puis les ids inconnus dans l'ordre d'apparition (`machineId ?? 'local'`, libellé de la machine sinon `machineOf`, `offline` = `status === 'unreachable'`) ; par état, les quatre `BUCKETS` dans l'ordre.
- **Compteurs** : `counts[b]` = agents principaux de la portée qui correspondent au texte (par eux-mêmes ou un sous-agent) et sont dans le seau `b` ; `counts.all` leur somme. La somme des `shown` vaut donc `counts[chip]`.

Textes ajoutés à cette tâche (le reste de `list.*` vient aux tâches 4 à 7) :

| Clé | fr | en |
| --- | --- | --- |
| `list.buckets` | `{ decide: 'À décider', running: 'En cours', done: 'Terminés', offline: 'Hors ligne' }` | `To decide`, `Running`, `Done`, `Offline` |
| `list.when.now` | `à l’instant` | `just now` |
| `list.when.wait(d)` / `ago(d)` | `depuis ${d}` / `il y a ${d}` | `for ${d}` / `${d} ago` |
| `list.when.requestNow` / `waitTitle(d)` | `Demande reçue à l’instant` / `En attente depuis ${d}` | `Request received just now` / `Waiting for ${d}` |
| `list.when.activityNow` / `activityAgo(d)` | `Dernière activité à l’instant` / `Dernière activité il y a ${d}` | `Last activity just now` / `Last activity ${d} ago` |
| `list.when.seenAgo(d)` | `Vu pour la dernière fois il y a ${d}` | `Last seen ${d} ago` |
| `list.when.units` | `{ min: 'min', h: 'h', d: 'j' }` | `{ min: 'min', h: 'h', d: 'd' }` |

`d` vaut `${n} ${unité}`. Les unités sont des abréviations : ni le français ni l'anglais ne prennent de pluriel.

- [ ] **Step 1: Écrire `test/list-model.test.ts`**

```ts
const P: Projects = { projects: [
  { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
  { id: 'pay', name: 'Payment', color: 'green', description: '', repos: [{ machine: 'dev', path: '/w/pay' }] },
  { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/docs' }] }
], rules: [] };
const at = (min: number) => new Date(Date.parse(T0) - min * 60_000).toISOString();
const ask = (kind: Pending['kind'], text = 'npm test'): Pending => ({ kind, text, source: 'hook' });
const s = (id: string, extra: Partial<Session> = {}) => fakeSession(`local:${id}`, { name: id[0]!.toUpperCase() + id.slice(1), machineId: 'local', machineName: 'Local', cwd: '/w/ledge', ...extra });
const otto = s('otto', { branch: 'desktop', helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }, { id: 'h2', kind: 'Review', task: 'Relire la PR', state: 'waiting_permission' }] });
const nova = s('nova', { state: 'waiting_input', pending: ask('question'), lastActivityAt: at(2), branch: 'main', helpers: [{ id: 'n1', kind: 'Plan', task: 'Découper', state: 'working' }] });
const pim = s('pim', { state: 'waiting_permission', pending: ask('permission'), lastActivityAt: at(10), branch: 'desktop', topic: 'Écrire la doc' });
const bix = s('bix', { state: 'idle' });
const rio = fakeSession('dev:rio', { name: 'Rio', machineId: 'dev', machineName: 'Dev SSH', cwd: '/w/pay', offline: true });
const kit = s('kit', { cwd: '/tmp/scratch', repo: 'scratch' });
const order = mainOrder([otto, nova, pim, bix, rio, kit], P);                   // bix, nova, otto, pim · rio · kit
const ctx: ListCtx = {
  projects: P, projectIdOf: x => projectOf(x, P), waits: new Map(),
  machines: [{ id: 'local', label: 'Local', status: 'open' }, { id: 'dev', label: 'Dev SSH', status: 'unreachable' }],
  labels: { unassigned: 'Sans projet', buckets: MESSAGES.fr.list.buckets }
};
const q = (over: Partial<ListQuery> = {}): ListQuery => ({ text: '', chip: 'all', group: 'project', helpers: true, toggled: new Set(), filter: 'all', ...over });
const names = (m: ListModel) => m.groups.map(g => `${g.key}=${g.rows.map(r => r.kind === 'main' ? r.session.name + (r.context ? '?' : '') : `↳${r.helper.kind}`).join(',')}`);

it('groups by project, Sans projet last; what waits first, the longest wait on top, then the shell order', () => {
  const m = listModel(order, ctx, q());
  expect(names(m)).toEqual(['project:ledge=Pim,Nova,Bix,Otto,↳Explore,↳Review', 'project:pay=Rio', 'project:none=Kit']);
  expect(m.groups[0]).toMatchObject({ label: 'Ledge', branch: 'desktop', shown: 4, tally: { decide: 2, running: 1, done: 1, offline: 0 } });
  expect(m.groups[2]).toMatchObject({ label: 'Sans projet', unassigned: true });
  expect(m.groups[0]!.rows.filter(r => r.kind === 'helper').map(r => r.kind === 'helper' && r.last)).toEqual([false, true]);
  expect(m.counts).toEqual({ all: 6, decide: 2, running: 2, done: 1, offline: 1 });
  expect([m.total, m.filtering, m.empty]).toEqual([6, false, null]);
});
it('subagents fold unless one waits; a toggle flips that; hidden, they are neither rows nor counted', () => {
  expect(names(listModel(order, ctx, q({ toggled: new Set(['local:otto', 'local:nova']) })))[0]).toBe('project:ledge=Pim,Nova,↳Plan,Bix,Otto');
  const hidden = listModel(order, ctx, q({ helpers: false }));
  expect(names(hidden)[0]).toBe('project:ledge=Pim,Nova,Bix,Otto');
  expect(hidden.groups[0]!.rows.every(r => r.kind === 'main' && r.kids === 0)).toBe(true);
  expect(names(listModel(order, ctx, q({ helpers: false, text: 'lire le code' })))).toEqual([]);
});
it('the text filter folds accents and reads name, task, machine, repo, project; a subagent keeps its parent as context', () => {
  const ctxOf = (text: string) => names(listModel(order, ctx, q({ text })));
  expect(ctxOf('ecrire')).toEqual(['project:ledge=Pim']);
  expect(ctxOf('dev ssh')).toEqual(['project:pay=Rio']);
  expect(ctxOf('payment')).toEqual(['project:pay=Rio']);
  expect(ctxOf('scratch')).toEqual(['project:none=Kit']);
  expect(ctxOf('sans projet')).toEqual(['project:none=Kit']);
  const sub = listModel(order, ctx, q({ text: 'lire le code' }));
  expect(names(sub)).toEqual(['project:ledge=Otto?,↳Explore']);
  expect(sub.counts).toEqual({ all: 1, decide: 0, running: 1, done: 0, offline: 0 });
  expect([sub.groups[0]!.shown, sub.filtering]).toEqual([1, true]);
});
it('a chip narrows the rows, never its own counts; the project filter narrows everything; an empty project is said', () => {
  const decide = listModel(order, ctx, q({ chip: 'decide' }));
  expect(names(decide)).toEqual(['project:ledge=Pim,Nova']);
  expect(decide.groups[0]).toMatchObject({ shown: 2, members: [bix, nova, otto, pim] });
  expect(decide.counts).toEqual({ all: 6, decide: 2, running: 2, done: 1, offline: 1 });
  const pay = listModel(order, ctx, q({ chip: 'decide', filter: 'pay' }));
  expect([pay.groups, pay.counts, pay.total, pay.empty]).toEqual([[], { all: 1, decide: 0, running: 0, done: 0, offline: 1 }, 1, null]);
  const docs = listModel(order, ctx, q({ filter: 'docs' }));
  expect([docs.groups, docs.total, docs.empty?.id]).toEqual([[], 0, 'docs']);
  expect(names(listModel(order, ctx, q({ filter: 'none' })))).toEqual(['project:none=Kit']);
  expect(names(listModel(order, { ...ctx, projects: null, projectIdOf: () => null }, q()))).toEqual(['project:none=Pim,Nova,Bix,Otto,↳Explore,↳Review,Rio,Kit']);
});
it('by machine (an offline one hollow) and by state, in their fixed order', () => {
  const byMachine = listModel(order, ctx, q({ group: 'machine' }));
  expect(names(byMachine)).toEqual(['machine:local=Pim,Nova,Bix,Otto,↳Explore,↳Review,Kit', 'machine:dev=Rio']);
  expect(byMachine.groups[1]).toMatchObject({ label: 'Dev SSH', machine: { id: 'dev', offline: true }, branch: null });
  const byState = listModel(order, ctx, q({ group: 'state' }));
  expect(names(byState)).toEqual(['state:decide=Pim,Nova', 'state:running=Otto,↳Explore,↳Review,Kit', 'state:done=Bix', 'state:offline=Rio']);
  expect(byState.groups.map(g => g.label)).toEqual(['À décider', 'En cours', 'Terminés', 'Hors ligne']);
});
it('J / K walk what is shown, unfolded subagents included, collapsed groups skipped', () => {
  const m = listModel(order, ctx, q());
  expect(walkRows(m.groups, new Set(['project:pay'])).map(r => r.key)).toEqual(['local:pim', 'local:nova', 'local:bix', 'local:otto', 'local:otto:h1', 'local:otto:h2', 'local:kit']);
});
it('buckets and quick actions', () => {
  expect([bix, s('e', { state: 'error' }), s('x', { state: 'exited' }), s('i', { state: 'idle', helpers: [{ id: 'h', kind: 'K', task: 't', state: 'working' }] }), nova, rio].map(bucketOf))
    .toEqual(['done', 'running', 'done', 'running', 'decide', 'offline']);
  expect(helperBucket({ id: 'h', kind: 'K', task: 't', state: 'waiting_input' }, otto)).toBe('decide');
  expect(helperBucket({ id: 'h', kind: 'K', task: 't', state: 'waiting_input' }, rio)).toBe('offline');
  expect([pim, nova, s('p', { state: 'waiting_permission', pending: ask('plan') }), s('d', { state: 'waiting_permission', pending: ask('diff') }),
    { ...pim, offline: true }, { ...pim, source: 'hook_only' as const }].map(quickActions)).toEqual([
    { decide: true, reply: false }, { decide: false, reply: true }, { decide: false, reply: false }, { decide: true, reply: false },
    { decide: false, reply: false }, { decide: false, reply: false }
  ]);
  expect([repoOf(kit), repoOf(otto)]).toEqual(['scratch', 'ledge']);
});
it('spans round down: minutes, hours, days', () => {
  const min = 60_000, h = 60 * min, d = 24 * h;
  expect([0, min - 1, min, 60 * min - 1, h, 24 * h - 1, d, 3 * d, -5000].map(spanOf)).toEqual([
    'now', 'now', { n: 1, unit: 'min' }, { n: 59, unit: 'min' }, { n: 1, unit: 'h' }, { n: 23, unit: 'h' }, { n: 1, unit: 'd' }, { n: 3, unit: 'd' }, 'now'
  ]);
});
it('a wait says « depuis », the rest « il y a », offline « vu pour la dernière fois »; French and English', () => {
  const now = Date.parse(T0), fr = MESSAGES.fr.list.when, en = MESSAGES.en.list.when;
  expect(whenOf(pim, undefined, now, fr)).toEqual({ text: 'depuis 10 min', title: 'En attente depuis 10 min', waiting: true });
  expect(whenOf(pim, at(25), now, en)).toEqual({ text: 'for 25 min', title: 'Waiting for 25 min', waiting: true });
  expect(whenOf(s('b', { lastActivityAt: at(120) }), undefined, now, fr)).toEqual({ text: 'il y a 2 h', title: 'Dernière activité il y a 2 h', waiting: false });
  expect(whenOf({ ...rio, lastActivityAt: at(3 * 1440) }, undefined, now, fr)).toEqual({ text: 'il y a 3 j', title: 'Vu pour la dernière fois il y a 3 j', waiting: false });
  expect(whenOf({ ...rio, lastActivityAt: at(3 * 1440) }, undefined, now, en)).toEqual({ text: '3 d ago', title: 'Last seen 3 d ago', waiting: false });
  expect(whenOf(s('k', { state: 'waiting_input', pending: ask('question') }), undefined, now, fr)).toEqual({ text: 'à l’instant', title: 'Demande reçue à l’instant', waiting: true });
  expect(whenOf(s('w'), undefined, now, en)).toEqual({ text: 'just now', title: 'Last activity just now', waiting: false });
});
it('a wait starts at its request: pane activity during it does not restart it, a new request does', () => {
  const w0 = trackWaits(new Map(), [pim, nova, bix]);
  expect([...w0.keys()]).toEqual(['local:pim', 'local:nova']);
  expect(w0.get('local:pim')!.since).toBe(at(10));
  expect(trackWaits(w0, [{ ...pim, lastActivityAt: at(1) }]).get('local:pim')!.since).toBe(at(10));
  expect(trackWaits(w0, [{ ...pim, pending: ask('permission', 'rm -rf dist'), lastActivityAt: at(1) }]).get('local:pim')!.since).toBe(at(1));
  expect(trackWaits(w0, [{ ...pim, state: 'working', pending: undefined }]).has('local:pim')).toBe(false);
});
```

`fakeSession` et `T0` viennent de `@ledge/fleet/test/mockDaemon`, `projectOf` de `@ledge/fleet`, `MESSAGES` de `src/i18n/messages.ts`.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/list-model.test.ts`
Expected : FAIL, `src/list/model.ts` introuvable.

- [ ] **Step 3: Implémenter `model.ts`, `time.ts`, `requestKey`, et déplacer `machineOf`**

Fonctions pures, sans React ni DOM.

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/list-model.test.ts
git commit -m "feat(desktop): the List's model: buckets, filters, groups by project / machine / state, waits first, counters, subagent rows, activity

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: La Liste dans la coquille

**Files:**
- Create: `apps/desktop/src/list/{List,ListToolbar,ListGroup,ListRow}.tsx`, `apps/desktop/src/list/prefs.ts`, `apps/desktop/src/styles/list.css`, `apps/desktop/test/list.test.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/styles/app.css` (`@import "./list.css";` après `atelier.css`), `apps/desktop/src/shell/icons.ts`, `apps/desktop/src/i18n/messages.ts`, `apps/desktop/test/helpers.ts`, `test/shell.test.tsx`, `test/atelier.test.tsx`

**Interfaces:**
- Consumes : tâche 3 (`listModel`, `walkRows`, `whenOf`, `trackWaits`, `repoOf`, `BUCKETS`) ; tâche 1 (`SessionBot`, `HelperBot`, `StateBadge`) ; `isRecord`, `readJson`, `writeJson`, `useStored` (`src/state`) ; `Button`, `Icon`, `ICONS`, `Kbd` ; `PROJECT_COLORS` ; `folderOf`.
- Produces :

```ts
// list/prefs.ts
export type Density = 'comfy' | 'tight';
export interface ListPrefs { group: GroupBy; density: Density }
export const LIST_KEY = 'desktop.list';
export function loadListPrefs(): ListPrefs;              // champ par champ ; défauts { group: 'project', density: 'comfy' }
export function saveListPrefs(p: ListPrefs): void;

// list/List.tsx
export interface ListProps {
  nav: NavState; dispatch: (a: NavAction) => void;
  order: readonly Session[];                             // mainOrder
  projects: Projects | null; projectIdOf: (s: Session) => string | null;
  machines: readonly MachineState[];
}
export function List(p: ListProps): JSX.Element;

// test/helpers.ts
/** La Liste du lot 5 : Otto (Ledge, permission, depuis 12 min, branche desktop, un sous-agent Explore « Lire le code »), Bix (Ledge, terminé, il y a 90 min),
 *  Rio (Ledge, hors ligne, il y a 3 jours), Nova (pay, au travail, il y a 3 min), Kit (/tmp, question, à l'instant). Heures relatives à l'appel. */
export function listSessions(): Session[];
```

Les tâches 5, 6 et 7 ajoutent à `ListProps` : `decisions` (tâche 6) et `filing` (tâche 7).

`App` rend `<List …/>` à la place du `Pending` « Liste ». Le rendu suit `SessionList` de la maquette :
- **Racine** : `div.overview-scroll.list` (`id="view-panel-list"`, `role="tabpanel"`, `aria-labelledby="view-tab-list"`), puis `div.list-view.density-${density}.group-${group}`. La variable `--toolbar-h` suit la hauteur de la barre d'outils par un `ResizeObserver` (ignoré s'il n'existe pas), comme la maquette.
- **Barre d'outils** (`ListToolbar`, balisage des lignes 143-154 de la maquette) :
  - le filtre, avec `mark` sur la correspondance (`Hl` de la maquette, avec `fold`) dans le nom, la tâche, le dépôt et la machine ; `Kbd F` à vide, la croix `filter-clear` sinon ;
  - les pastilles `state-chips` : « Tous » puis les quatre seaux avec leurs `counts`. « Hors ligne » n'apparaît que si son compteur est non nul ou qu'elle est choisie. Une pastille à 0 est `disabled` sauf si elle est choisie, et un second clic sur la pastille choisie revient à « Tous » ;
  - `seg` `role="radiogroup"` (Projet / Machine / État, `role="radio"`, `aria-checked`) ;
  - la densité (`density-toggle`, `aria-pressed` en compacte, nom et `title` = la densité qu'on obtiendrait). Les icônes `searchIcon`, `machineIcon` et `densityIcon` de la maquette rejoignent `SHELL_ICONS` (`search` y est déjà).
- **Groupes** (`ListGroup`) : `section.lgroup` (`aria-label` = `label`, classes `collapsed`, `unassigned`), puis l'en-tête `lgroup-head`, puis `div.lgroup-rows` `role="list"` s'il n'est pas replié. L'en-tête suit `header` de la maquette :
  - `g-toggle` (`aria-expanded`, `t.list.collapse(label)` / `t.list.expand(label)`) ;
  - la pastille de couleur (projet), l'icône `SHELL_ICONS.unassigned` (« Sans projet »), `machine-dot` (avec `off` hors ligne) ou `g-dot dot-${bucket}` ;
  - le nom : un bouton `g-name` pour un projet (`title` = `t.list.only(label)`) qui envoie `{ type: 'home', project: id }`, la vue restant la Liste ; `strong.g-name` sinon ;
  - `⎇ branche` (`g-branch`, `title` = `t.list.branch(b)`) ; pour une machine hors ligne, `g-branch` dit `t.list.buckets.offline` ;
  - `g-count` : `shown`, suivi de `/${members.length}` quand `filtering` et `shown !== members.length` ;
  - `g-summary`, sauf par état : `g-alert` `t.list.tally.decide(n)` si n > 0, puis en `muted` les autres seaux non nuls joints par ` · ` ;
  - « Sans projet » : `g-help` `t.list.unassignedHelp` ;
  - **« + Nouvelle session »** (`g-add`, `aria-label` = `t.list.newSessionIn(label)`, texte `t.atelier.newSession`) sur un groupe de projet seulement : il envoie `modal: { kind: 'launch', project: id }`. Ni « Sans projet », ni une machine, ni un état n'en ont : aucune de ces cibles ne fixe le projet de la nouvelle session.
- **Les groupes repliés** sont un `Set` de clés de groupe dans `List` : une mise à jour du fleet ne les déplie pas.
- **Lignes** (`ListRow`, `row` de la maquette) :
  - `div.lrow` `role="listitem"` `tabIndex={0}` `data-agent={key}`, classes `b-${bucket}`, `s-${botState}` (ce qui donne le liseré rouge ou orange de la maquette), `child`, `last`, `context` ;
  - `aria-label` = `t.list.row(name, task, bucketLabel.toLowerCase(), ctx)` ; un sous-agent prend `t.atelier.helperSeat(kind, parent, task)` ;
  - colonnes `r-bot` (32 px, 24 en compacte et pour un sous-agent), `r-name` (avec `kids-chip` : `aria-expanded`, `t.list.kids.show(n)` / `hide(n)`, `title` `t.list.kids.count(n)`), `r-task` (`r-title` avec `title`, `r-repo` = `repoOf` ; par état, précédé de la pastille et du nom du projet puis `·`), `r-state` (`StateBadge`, ou celui de `helperState` pour un sous-agent, hors ligne si le parent l'est), `r-ctx` (icône machine + `machineOf`, ou la pastille et le nom du projet quand on groupe par machine), `r-when` (`whenOf`, classe `waiting`, `title`) ;
  - une ligne de sous-agent n'a pas d'activité (`r-when` vide : un sous-agent n'a pas d'horloge) et prend la machine de son parent ;
  - un clic sur la ligne hors bouton envoie `open` (le parent pour un sous-agent) ; un clic sur `kids-chip` bascule `toggled`.
- **Heure** : un `now` rafraîchi toutes les 30 s dans `List` ; les attentes suivies par `trackWaits` sur `order`, dans une ref.
- **États vides** (lignes 155-156 de la maquette), à la place des groupes :
  - `model.empty` : pastille, `t.list.empty.projectTitle(name)`, `t.list.empty.projectBody(where)` (`where` comme `EmptyProject` du lot 4), bouton « Nouvelle session » → `launch` avec ce projet ;
  - aucun groupe et `total === 0` : `t.list.empty.noneTitle`, `noneBody`, bouton « Nouvelle session » → `launch` sans projet ;
  - aucun groupe sinon : `t.list.empty.noMatch`, `t.list.empty.noMatchBody(text, chip)` et « Effacer les filtres », qui vide le texte et la pastille, jamais le filtre de projet.
- **Note** `list-foot` (ligne 161 de la maquette), quand il y a des groupes.
- **CSS** : `list.css` de la maquette en entier dans `src/styles/list.css`, avec les écarts des Global Constraints.

Textes français (`list.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `filter` / `filterPlaceholder` / `clearFilter` | `Filtrer les sessions` / `Agent, tâche, machine, dépôt…` / `Effacer le filtre` | `Filter the sessions` / — / `Clear the filter` |
| `chips` / `all` | `Filtrer par état` / `Tous` | `Filter by state` / `All` |
| `groupBy` / `groupLabel` / `groups` | `Grouper par` / `Grouper` / `{ project: 'Projet', machine: 'Machine', state: 'État' }` | `Group by` / `Group` / `Project`, `Machine`, `State` |
| `comfy` / `tight` | `Lignes confortables` / `Lignes compactes` | `Comfortable rows` / `Compact rows` |
| `collapse(n)` / `expand(n)` / `only(n)` / `branch(b)` | `Replier ${n}` / `Déplier ${n}` / `Voir seulement ${n}` / `Branche ${b}` | `Collapse ${n}` / `Expand ${n}` / — / — |
| `newSessionIn(n)` | `Nouvelle session dans ${n}` | `New session in ${n}` |
| `tally` | `decide: ${n} à décider`, `running: ${n} en cours`, `done: ${n} terminé` / `${n} terminés`, `offline: ${n} hors ligne` | `${n} to decide`, `${n} running`, `${n} done`, `${n} offline` |
| `unassignedHelp` | `Glissez vers un projet, ou « Ranger dans… ».` | — |
| `row(name, task, state, ctx)` | `${name}, ${task}, ${state}, ${ctx}` | idem |
| `kids.show(n)` / `hide(n)` / `count(n)` | `Afficher ${n} sous-agent(s)` / `Masquer ${n} sous-agent(s)` / `${n} sous-agent(s)` (pluriel par `plural`) | `Show 1 subagent` / `Hide 1 subagent` / — |
| `empty.projectTitle(n)` / `projectBody(w)` | `Aucune session dans ${n}` / `Le projet se remplira dès qu’une session démarre dans ${w}.` | `No session in ${n}` / `The project will fill as soon as a session starts in ${w}.` |
| `empty.noneTitle` / `noneBody` | `Aucune session` / `Lancez une session pour la voir ici.` | `No session` / `Start a session to see it here.` |
| `empty.noMatch` / `clear` | `Aucune session ne correspond` / `Effacer les filtres` | `No session matches` / `Clear the filters` |
| `empty.noMatchBody(q, chip)` | `Rien pour « ${q} » parmi les sessions « ${chip} ».` ; sans pastille `Rien pour « ${q} ».` ; sans texte `Rien parmi les sessions « ${chip} ».` (`chip` en minuscules) | `Nothing for “${q}” among the “${chip}” sessions.` / `Nothing for “${q}”.` / `Nothing among the “${chip}” sessions.` |
| `foot` / `enter` | `{ walk: 'parcourir', open: 'ouvrir', filter: 'filtrer', note: 'les demandes en attente passent en tête de chaque groupe.' }` / `Entrée` (la touche, dans la note et sur « Ouvrir ») | — / `Enter` |

- [ ] **Step 1: Écrire `test/list.test.tsx`**

```tsx
const rowsOf = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('listitem').map(r => r.getAttribute('aria-label')!.split(',')[0]);
const row = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) });
const head = (name: string) => within(document.querySelector<HTMLElement>(`.lgroup[aria-label="${name}"] .lgroup-head`)!);
const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Filter by state' })).getByRole('button', { name });

it('groups by project, Sans projet last, what waits first in its group, with its stripe', async () => {
  await boot({ sessions: listSessions(), list: true });
  expect([...document.querySelectorAll('.lgroup')].map(g => g.getAttribute('aria-label'))).toEqual(['Ledge', 'Payment Service Platform Migration Europe', 'No project']);
  expect(rowsOf('Ledge')).toEqual(['Otto', 'Bix', 'Rio']);
  expect(row('Otto')).toHaveClass('b-decide', 's-approval');
  expect(row('Kit')).toHaveClass('b-decide', 's-question');
  expect(screen.queryByText('This screen is coming soon.')).toBeNull();
});
it('a row: task with its repo, badge, machine, activity; never the harness', async () => {
  await boot({ sessions: listSessions(), list: true });
  const otto = row('Otto');
  expect(otto.querySelector('.r-repo')).toHaveTextContent('ledge');
  expect(within(otto).getByText('Approval')).toHaveAttribute('data-badge', 'approval');
  expect(otto.querySelector('.r-ctx')).toHaveTextContent('Local');
  expect(otto.querySelector('.r-when')).toHaveTextContent('for 12 min');
  expect(otto.querySelector('.r-when')).toHaveClass('waiting');
  expect(row('Nova').querySelector('.r-when')).toHaveTextContent('3 min ago');
  expect(row('Bix').querySelector('.r-when')).toHaveTextContent('1 h ago');
  expect(row('Rio').querySelector('.r-when')).toHaveAttribute('title', 'Last seen 3 d ago');
  expect(within(row('Rio')).getByText('Offline')).toHaveAttribute('data-badge', 'readonly');
  expect(row('Kit').querySelector('.r-when')).toHaveTextContent('just now');
  expect(document.querySelector('.list-view')).not.toHaveTextContent(/Codex|Claude Code|Cursor Agent/);
});
it('a group header: count, what waits, branch; collapsed it stays collapsed through updates; its name filters', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  expect(head('Ledge').getByText('3')).toHaveClass('g-count');
  expect(head('Ledge').getByText('1 to decide')).toHaveClass('g-alert');
  expect(head('Ledge').getByText('1 done · 1 offline')).toBeVisible();
  expect(head('Ledge').getByText('⎇ desktop')).toBeVisible();
  await user.click(head('Ledge').getByRole('button', { name: 'Collapse Ledge' }));
  expect(screen.queryByRole('listitem', { name: /^Otto,/ })).toBeNull();
  d.upsert(fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'working' }));
  await waitFor(() => expect(head('Ledge').getByText('1 running · 1 offline')).toBeVisible());
  expect(head('Ledge').getByRole('button', { name: 'Expand Ledge' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('listitem', { name: /^Otto,/ })).toBeNull();
  await user.click(head('Ledge').getByRole('button', { name: 'Ledge' }));
  expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
});
it('subagents: a quiet count beside the parent, folded unless one waits, a click folds them back; the top bar toggle hides them', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  expect(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('listitem', { name: /subagent of Otto/ })).toBeNull();
  d.upsert({ ...listSessions()[0]!, helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'waiting_permission' }] });
  const kid = await screen.findByRole('listitem', { name: 'Explore, subagent of Otto: Lire le code' });
  expect(kid).toHaveClass('child', 'last', 'b-decide');
  await user.click(within(row('Otto')).getByRole('button', { name: 'Hide 1 subagent' }));
  expect(screen.queryByRole('listitem', { name: /subagent of Otto/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Hide subagents' }));
  expect(within(row('Otto')).queryByRole('button', { name: /subagent/ })).toBeNull();
});
it('the text filter marks its match; chips count under it and narrow the rows; n/total in the header', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  expect(chip(/^All/)).toHaveTextContent('All5');
  expect(chip(/^To decide/)).toHaveTextContent('To decide2');
  expect(chip(/^Offline/)).toHaveTextContent('Offline1');
  await user.type(screen.getByRole('textbox', { name: 'Filter the sessions' }), 'nov');
  expect(within(row('Nova')).getByText('Nov', { selector: 'mark' })).toBeVisible();
  expect(chip(/^All/)).toHaveTextContent('All1');
  expect(chip(/^To decide/)).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Clear the filter' }));
  await user.click(chip(/^To decide/));
  expect(chip(/^To decide/)).toHaveAttribute('aria-pressed', 'true');
  expect(rowsOf('Ledge')).toEqual(['Otto']);
  expect(head('Ledge').getByText('1/3')).toHaveClass('g-count');
});
it('filters combined down to nothing: the empty state names them, Clear keeps the project filter, the chosen chip stays', async () => {
  const { side, user } = await boot({ sessions: listSessions(), list: true });
  await user.click(side.getByRole('button', { name: /^Ledge/ }));
  await user.type(screen.getByRole('textbox', { name: 'Filter the sessions' }), 'zzz');
  expect(screen.getByRole('heading', { name: 'No session matches' })).toBeVisible();
  expect(screen.getByText('Nothing for “zzz”.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear the filters' }));
  expect(rowsOf('Ledge')).toEqual(['Otto', 'Bix', 'Rio']);
  expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
  await user.click(chip(/^To decide/));
  await user.click(side.getByRole('button', { name: /^Payment/ }));
  expect(screen.getByText('Nothing among the “to decide” sessions.')).toBeVisible();
  expect(chip(/^To decide/)).toBeEnabled();
  expect(chip(/^To decide/)).toHaveTextContent('To decide0');
});
it('an empty project offers a session there; no session at all offers one too', async () => {
  const { side, user } = await boot({ sessions: listSessions(), list: true });
  await user.click(side.getByRole('button', { name: /^Docs/ }));
  expect(screen.getByRole('heading', { name: 'No session in Docs' })).toBeVisible();
  expect(screen.getByText('The project will fill as soon as a session starts in docs.')).toBeVisible();
  await user.click(within(document.querySelector<HTMLElement>('.list-empty')!).getByRole('button', { name: 'New session' }));
  expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
  cleanup(); await closeDaemons();
  await boot({ sessions: [], list: true });
  expect(screen.getByRole('heading', { name: 'No session' })).toBeVisible();
  expect(screen.getByText('Start a session to see it here.')).toBeVisible();
});
it('+ New session on a project group only', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  expect(head('No project').queryByRole('button', { name: /^New session in/ })).toBeNull();
  await user.click(head('Ledge').getByRole('button', { name: 'New session in Ledge' }));
  expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('radio', { name: 'Machine' }));
  expect(screen.queryAllByRole('button', { name: /^New session in/ })).toHaveLength(0);
});
it('grouping and density are remembered; the filter and the chip are not', async () => {
  const { view, client, user } = await boot({ sessions: listSessions(), list: true });
  await user.click(screen.getByRole('radio', { name: 'State' }));
  expect([...document.querySelectorAll('.lgroup')].map(g => g.getAttribute('aria-label'))).toEqual(['To decide', 'Running', 'Done', 'Offline']);
  await user.click(screen.getByRole('button', { name: 'Compact rows' }));
  await user.type(screen.getByRole('textbox', { name: 'Filter the sessions' }), 'otto');
  expect(JSON.parse(localStorage.getItem('desktop.list')!)).toEqual({ group: 'state', density: 'tight' });
  view.unmount();
  render(<App client={client} />);
  expect(await screen.findByRole('radio', { name: 'State' })).toHaveAttribute('aria-checked', 'true');
  expect(document.querySelector('.list-view')).toHaveClass('density-tight');
  expect(screen.getByRole('textbox', { name: 'Filter the sessions' })).toHaveValue('');
});
it('prefs are read field by field, and the key is new', () => {
  expect(loadListPrefs()).toEqual({ group: 'project', density: 'comfy' });
  localStorage.setItem(LIST_KEY, JSON.stringify({ group: 'state', density: 'dense' }));
  expect(loadListPrefs()).toEqual({ group: 'state', density: 'comfy' });
  localStorage.setItem(LIST_KEY, '{oops');
  expect(loadListPrefs()).toEqual({ group: 'project', density: 'comfy' });
  expect(OBSOLETE_KEYS).not.toContain(LIST_KEY);
});
it('the styles port the mockup: a sticky toolbar, sticky headers under it, a narrow layout under 780 px', () => {
  expect(declarations('list.css', '.list-toolbar')).toContain('position:sticky;top:0;z-index:6');
  expect(declarations('list.css', '.lgroup-head')).toContain('position:sticky;top:var(--toolbar-h);z-index:4');
  expect(declarations('list.css', '.list-view')).toContain('container-type:inline-size');
  expect(readFileSync(resolve(__dirname, '../src/styles/list.css'), 'utf8')).toMatch(/@container \(max-width:780px\)\{/);
});
```

Dans `shell.test.tsx` et `atelier.test.tsx`, les `getByRole('region', { name: 'List' })` (le `Pending`) deviennent `getByRole('tabpanel', { name: 'List' })` ; le test « the List view is still pending » devient « the List tab shows the list » et vérifie `document.querySelector('.list-view')`.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/list.test.tsx`
Expected : FAIL, la Liste est encore `Pending`.

- [ ] **Step 3: Implémenter `prefs.ts`, `List`, `ListToolbar`, `ListGroup`, `ListRow`, `list.css`, les textes et le branchement**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): the List in the shell: toolbar, chips with counters, group by, density, sticky groups, rows in columns, subagents, empty states

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Le clavier de la Liste

**Files:**
- Create: `apps/desktop/test/list-keys.test.tsx`
- Modify: `apps/desktop/src/list/{List,ListToolbar,ListRow}.tsx`

**Interfaces:**
- Consumes : `useScreenKeys` (lot 4) ; tâche 3 (`walkRows`) ; tâche 4 (`List`).
- Produces : rien de neuf hors de la Liste.

`List` tient `focusedId: string | null` (une clé de ligne) et s'inscrit par `useScreenKeys` :
- `f` : focus et sélection du filtre ; prise ;
- `j` ou ↓ : ligne suivante, `k` ou ↑ : précédente, dans `walkRows(model.groups, collapsed)`, en boucle, à partir de la première ou de la dernière si aucune n'est choisie. La ligne choisie prend `keyboard-selected` et le focus, trouvée parmi les `[data-agent]` de la Liste en comparant `dataset.agent` (pas de sélecteur construit avec la clé) ;
- Entrée : ouvre la ligne choisie (le parent pour un sous-agent) si la cible n'est ni un bouton, ni un lien, ni un champ ;
- J / K / ↓ / ↑ et Entrée sont refusés (`false`) quand la cible est dans `[role=tablist]` ou `[role=menu]` (les onglets et les menus ont leurs flèches) ; F marche aussi depuis un onglet ; la liste vide ne prend pas J / K ;
- les gardes de `useKeys` s'appliquent avant : rien de tout cela pendant une saisie, sous une fenêtre modale ou avec le chat.

Le filtre a son propre `onKeyDown` :
- Échap avec du texte ou une pastille choisie : vide les deux, `preventDefault` + `stopPropagation` (l'écouteur global ne retire donc pas le filtre de projet), le focus reste ;
- Échap à vide : quitte le champ (`blur`), `stopPropagation` ;
- ↓ ou Entrée : `preventDefault`, choisit et focalise la première ligne de `walkRows`.

Le focus d'une ligne la choisit (`onFocus` quand la cible est la ligne elle-même). `focusedId` retombe à `null` quand sa ligne quitte `walkRows`.

**Le focus suit la ligne choisie** : une ligne qui change de place (son état change) ou un bouton qui disparaît (une décision prise) peut faire perdre le focus à `body`. Après chaque rendu (`useLayoutEffect` sans dépendances), si `focusedId` est posé, que la Liste avait le focus et que `document.activeElement` est `body`, la ligne choisie reprend le focus. « Avait le focus » : `focusin` sur la racine le pose ; un `pointerdown` hors de la racine, ou un `focusout` vers un élément hors de la racine, l'efface.

- [ ] **Step 1: Écrire `test/list-keys.test.tsx`**

```tsx
const row = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) });
const filter = () => screen.getByRole('textbox', { name: 'Filter the sessions' });
const banner = () => within(screen.getByRole('banner'));

it('F goes to the filter, ↓ reaches the first row; J / K walk the rows shown, unfolded subagents included; Enter opens', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  await user.keyboard('f'); expect(filter()).toHaveFocus();
  await user.keyboard('{ArrowDown}'); expect(row('Otto')).toHaveFocus();
  await user.keyboard('j'); expect(row('Bix')).toHaveFocus();
  await user.keyboard('jjj'); expect(row('Kit')).toHaveFocus();
  await user.keyboard('j'); expect(row('Otto')).toHaveFocus();                 // wraps
  await user.keyboard('k'); expect(row('Kit')).toHaveClass('keyboard-selected');
  await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
  row('Otto').focus();
  await user.keyboard('j'); expect(screen.getByRole('listitem', { name: /subagent of Otto/ })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(banner().getByText('Otto')).toBeVisible();
});
it('a collapsed group is skipped', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  await user.click(screen.getByRole('button', { name: 'Collapse Ledge' }));
  (document.activeElement as HTMLElement).blur();
  await user.keyboard('j'); expect(row('Nova')).toHaveFocus();
});
it('typing in the filter never walks, opens or launches: j, k, f and n are text there', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  await user.click(filter());
  await user.keyboard('jkfn');
  expect(filter()).toHaveValue('jkfn');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.querySelector('.lrow.keyboard-selected')).toBeNull();
});
it('Escape in the filter clears it, then leaves it; only then does Escape remove the project filter', async () => {
  const { side, user } = await boot({ sessions: listSessions(), list: true });
  await user.click(side.getByRole('button', { name: /^Ledge/ }));
  const clear = () => banner().queryByRole('button', { name: 'Remove the filter: show every project' });
  await user.keyboard('f'); await user.keyboard('bix');
  await user.keyboard('{Escape}');
  expect(filter()).toHaveValue(''); expect(filter()).toHaveFocus(); expect(clear()).not.toBeNull();
  await user.keyboard('{Escape}');
  expect(filter()).not.toHaveFocus(); expect(clear()).not.toBeNull();
  await user.keyboard('{Escape}');
  expect(clear()).toBeNull();
});
it('a row that starts waiting moves up its group; the selection and the focus stay on it', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  await user.keyboard('jjj'); expect(row('Rio')).toHaveFocus();
  d.upsert(fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'rm -rf dist', source: 'hook' }, lastActivityAt: new Date().toISOString() }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Ledge' })).getAllByRole('listitem').map(r => r.getAttribute('aria-label')!.split(',')[0])).toEqual(['Otto', 'Rio', 'Bix']));
  expect(row('Rio')).toHaveFocus();
  expect(row('Rio')).toHaveClass('keyboard-selected');
  await user.keyboard('j'); expect(row('Bix')).toHaveFocus();
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/list-keys.test.tsx`
Expected : FAIL, F et J ne font rien dans la Liste.

- [ ] **Step 3: Implémenter les touches de la Liste, celles du filtre et le suivi du focus**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe, `screen-keys` et `keys` compris.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/list-keys.test.tsx
git commit -m "feat(desktop): the List's keys: F to filter, Escape clears then leaves, J / K follow the rows shown, Enter opens, the focus stays on the chosen row

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Les actions rapides

**Files:**
- Modify: `apps/desktop/src/fleet/decisions.ts` (le crochet), `apps/desktop/src/fleet/useFleet.ts`, `apps/desktop/src/list/{List,ListRow}.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/i18n/messages.ts`
- Create: `apps/desktop/test/decisions.test.tsx`, `apps/desktop/test/list-actions.test.tsx`

**Interfaces:**
- Consumes : `requestKey` (tâche 3) ; `quickActions` (tâche 3) ; `DaemonClient`, `DaemonError` (`@ledge/fleet`) ; `useDaemon` ; `notify` (`useToast`, lot 4).
- Produces :

```ts
// fleet/useFleet.ts — FleetView gagne :
lastError: DaemonError | null;           // useDaemon().lastError

// fleet/decisions.ts
export interface Decisions {
  /** Une décision est partie pour la demande en cours de cette session. */
  busy(id: string): boolean;
  /** La session dont la décision vient d'aboutir, pendant 1,8 s (classe `flash` de la ligne). */
  landed: string | null;
  /** false sans envoi : hors ligne, lecture seule (`hook_only`), sans demande, demande de type question, ou déjà partie. */
  decide(s: Session, decision: 'accept' | 'deny'): boolean;
}
export function useDecisions(o: { client: Pick<DaemonClient, 'send'>; sessions: readonly Session[]; lastError: DaemonError | null; notify(text: string): void }): Decisions;

// list/List.tsx — ListProps gagne :
decisions: Decisions;
```

Le crochet reprend la logique de `sends.ts` et `useConversations.ts` de `origin/feat/desktop` (`git show origin/feat/desktop:apps/desktop/src/conversation/sends.ts`), réduite aux décisions :
- un miroir synchrone (ref) des envois : deux clics dans la même image voient le premier ;
- à l'envoi, on retient `{ request: requestKey(s), errorSeq: lastError?.seq ?? 0, name: s.name }` et une minuterie de 8 s (comme `UNCONFIRMED_MS` du rangement) ;
- **aboutie** : la session est encore là, pas hors ligne, et `requestKey` a changé. On oublie l'envoi et on pose `landed` pendant 1,8 s ;
- **disparue** : on oublie l'envoi, sans message ;
- **refusée** : un `lastError` de même `id` et de `seq` plus grand. On oublie l'envoi et `notify(t.decisions.failed(name, message))`. Une machine hors ligne au moment de l'envoi passe par là : le fleet répond tout de suite `${label} is offline` ;
- **jamais confirmée** : au bout de 8 s, on oublie l'envoi et `notify(t.decisions.unconfirmed(name))`.

`App` crée `useDecisions({ client: fleetClient, sessions, lastError, notify })` et le passe à `List` ; le lot 6 le passera à la session.

Dans une ligne d'agent principal (`r-actions`, comme la maquette) :
- `quickActions(s).decide` : `Button primary sm` « Autoriser » et `Button sm` « Refuser », tous deux `disabled` tant que `busy(s.id)` ;
- `quickActions(s).reply` : `Button primary sm` « Répondre », qui envoie `open` (le lot 6 posera le focus sur la réponse) ;
- toujours : `Button ghost sm` `r-open` « Ouvrir » (`title` = `t.list.openTitle`), avec `Kbd` `t.list.enter` sauf si la ligne propose une décision ou une réponse ; il envoie `open` ;
- la ligne prend `flash` quand `landed === s.id` ;
- une ligne de sous-agent n'a que « Ouvrir », qui ouvre son parent ; une ligne hors ligne, en lecture seule ou avec un plan à relire n'a que « Ouvrir ».

Textes français :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `list.allow` / `deny` / `reply` / `open` | `Autoriser` / `Refuser` / `Répondre` / `Ouvrir` | `Allow` / `Deny` / `Reply` / `Open` |
| `list.openTitle` | `Ouvrir la session (Entrée)` | — |
| `decisions.failed(name, message)` | `Décision non transmise à ${name} : ${message}` | `Could not send the decision to ${name}: ${message}` |
| `decisions.unconfirmed(name)` | `Ledge n’a pas vu la décision pour ${name} aboutir. Ouvrez la session pour vérifier.` | `Ledge did not see the decision for ${name} land. Open the session to check.` |

- [ ] **Step 1: Écrire `test/decisions.test.tsx`**

```tsx
const otto = fakeSession('local:otto', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
type P = Parameters<typeof useDecisions>[0];
const wrapper = ({ children }: { children: React.ReactNode }) => <LangProvider lang="en">{children}</LangProvider>;
const setup = (over: Partial<P> = {}) => {
  const props: P = { client: { send: vi.fn() }, sessions: [otto], lastError: null, notify: vi.fn(), ...over };
  const hook = renderHook((p: P) => useDecisions(p), { initialProps: props, wrapper });
  return { ...hook, props };
};

it('one decision per request, even clicked twice; it lands when the request changes', () => {
  const { result, rerender, props } = setup();
  act(() => { expect(result.current.decide(otto, 'accept')).toBe(true); });
  act(() => { expect(result.current.decide(otto, 'deny')).toBe(false); });
  expect(props.client.send).toHaveBeenCalledTimes(1);
  expect(props.client.send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'accept' });
  expect(result.current.busy('local:otto')).toBe(true);
  rerender({ ...props, sessions: [{ ...otto, state: 'working', pending: undefined }] });
  expect(result.current.busy('local:otto')).toBe(false);
  expect(result.current.landed).toBe('local:otto');
  expect(props.notify).not.toHaveBeenCalled();
});
it('an error for that session after the send frees it and says why; an older or another one does not', () => {
  const { result, rerender, props } = setup({ lastError: { id: 'local:otto', message: 'old', seq: 1 } });
  act(() => { result.current.decide(otto, 'deny'); });
  rerender({ ...props, lastError: { id: 'local:nova', message: 'other', seq: 2 } });
  expect(result.current.busy('local:otto')).toBe(true);
  rerender({ ...props, lastError: { id: 'local:otto', message: 'Dev SSH is offline', seq: 3 } });
  expect(result.current.busy('local:otto')).toBe(false);
  expect(props.notify).toHaveBeenCalledWith('Could not send the decision to Otto: Dev SSH is offline');
});
it('never for an offline, read-only or question session, nor without a request', () => {
  const { result, props } = setup();
  for (const s of [{ ...otto, offline: true }, { ...otto, source: 'hook_only' as const }, { ...otto, state: 'waiting_input' as const, pending: { kind: 'question' as const, text: 'Port?', source: 'hook' as const } }, { ...otto, pending: undefined }])
    act(() => { expect(result.current.decide(s, 'accept')).toBe(false); });
  expect(props.client.send).not.toHaveBeenCalled();
});
it('a decision nobody confirms within 8 s comes back with a notice', () => {
  vi.useFakeTimers();
  try {
    const { result, props } = setup();
    act(() => { result.current.decide(otto, 'accept'); });
    act(() => { vi.advanceTimersByTime(7999); });
    expect(result.current.busy('local:otto')).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.busy('local:otto')).toBe(false);
    expect(props.notify).toHaveBeenCalledWith('Ledge did not see the decision for Otto land. Open the session to check.');
  } finally { vi.useRealTimers(); }
});
```

- [ ] **Step 2: Écrire `test/list-actions.test.tsx`**

```tsx
const row = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) });
const decides = (d: MockDaemon) => d.received.filter(m => m.type === 'session.decide');
/** Only « Ouvrir » (its name also holds the Kbd hint). */
const onlyOpen = (el: HTMLElement) => {
  expect(within(el).queryByRole('button', { name: /^(Allow|Deny|Reply|Move to…)$/ })).toBeNull();
  expect(within(el).getByRole('button', { name: /^Open/ })).toBeInTheDocument();
};

it('Allow sends one decision; the buttons wait; the row moves once the daemon says the agent resumed', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  const allow = within(row('Otto')).getByRole('button', { name: 'Allow' });
  await user.dblClick(allow);
  await waitFor(() => expect(decides(d)).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]));
  expect(allow).toBeDisabled();
  expect(within(row('Otto')).getByRole('button', { name: 'Deny' })).toBeDisabled();
  d.upsert({ ...listSessions()[0]!, state: 'working', pending: undefined });
  await waitFor(() => expect(within(row('Otto')).getByText('Running')).toBeVisible());
  expect(within(row('Otto')).queryByRole('button', { name: 'Allow' })).toBeNull();
  expect(row('Otto')).toHaveClass('flash');
});
it('a refusal from the daemon is said in plain words and gives the buttons back', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  await user.click(within(row('Otto')).getByRole('button', { name: 'Deny' }));
  await waitFor(() => expect(decides(d)).toHaveLength(1));
  d.push({ type: 'error', id: 'otto', message: 'no pending request' });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not send the decision to Otto: Local: no pending request'));
  expect(within(row('Otto')).getByRole('button', { name: 'Allow' })).toBeEnabled();
  expect(within(row('Otto')).getByText('Approval')).toBeVisible();
});
it('a question offers Reply, which opens the session; offline, a plan, a subagent offer only Open', async () => {
  const { d, user } = await boot({ sessions: listSessions(), list: true });
  onlyOpen(row('Rio'));
  d.upsert(fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: 'Plan', source: 'hook' } }));
  onlyOpen(await screen.findByRole('listitem', { name: /^Pia,/ }));
  await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
  onlyOpen(screen.getByRole('listitem', { name: /subagent of Otto/ }));
  await user.click(within(row('Kit')).getByRole('button', { name: 'Reply' }));
  expect(within(screen.getByRole('banner')).getByText('Kit')).toBeVisible();
});
```

`d.push` diffuse l'erreur à toutes les connexions ; le fleet la qualifie (`local:otto`) et la préfixe (`Local: `), parce que le harnais déclare deux machines.

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `pnpm --filter desktop exec vitest run test/decisions.test.tsx test/list-actions.test.tsx`
Expected : FAIL, `useDecisions` introuvable et aucune action dans les lignes.

- [ ] **Step 4: Implémenter `useDecisions`, `lastError`, les actions et le branchement**

- [ ] **Step 5: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe.

- [ ] **Step 6: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/decisions.test.tsx apps/desktop/test/list-actions.test.tsx
git commit -m "feat(desktop): quick actions in the List: Allow / Deny sent once per request, a refusal said in plain words, Reply and Open

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Ranger depuis « Sans projet » dans la Liste

**Files:**
- Create: `apps/desktop/src/atelier/MoveTo.tsx`, `apps/desktop/test/list-filing.test.tsx`
- Modify: `apps/desktop/src/atelier/Unassigned.tsx`, `apps/desktop/src/list/{List,ListGroup,ListRow}.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : `Filing`, `folderOf` (lot 4) ; tâche 2 (`Menu`, `MenuItem`).
- Produces :

```ts
// atelier/MoveTo.tsx — « Ranger dans… » (assign-wrap de la maquette) : les projets, chacun avec en `small` les noms de dossier de ses dépôts,
// puis « Nouveau projet… » « À partir de ${cwd} » → modal { kind: 'project', file: session.id }. Un choix appelle filing.file.
export function MoveTo(p: { session: Session; projects: readonly Project[]; filing: Filing; dispatch: (a: NavAction) => void; open: boolean; onOpenChange(open: boolean): void; className: string; flip?: boolean }): JSX.Element;

// list/List.tsx — ListProps gagne :
filing: Filing;
```

- `Unassigned` rend `MoveTo` (`className="assign-wrap"`), avec le même bouton `outline` que le lot 4 ; ses tests restent tels quels.
- Dans la Liste :
  - **Glisser** : seules les lignes d'agents principaux de « Sans projet » portent `filing.dragProps`, la `drag-grip` (`title` = `t.list.grip`) et `is-dragged` pendant le glisser, comme `loose` dans la maquette ;
  - **Cibles** : chaque `section.lgroup` d'un projet porte `filing.dropProps(id)` (une seule cible pour l'en-tête et les lignes) et prend `drop-over` quand `filing.over === id`. Pendant un glisser, son en-tête montre `drop-hint` : `t.filing.dropHere`, ou `t.list.dropNow(name)` sous le pointeur. Les projets de la barre latérale restent des cibles (lot 4). « Sans projet », les machines et les états ne sont pas des cibles ;
  - pendant un glisser, `g-help` de « Sans projet » dit `t.list.dropHelp` ;
  - **« Ranger dans… »** : `MoveTo` dans `r-actions` des lignes de « Sans projet », avec `className="lrow-menu assign-wrap"`, `flip`, et le bouton `Button sm` de la maquette. La ligne prend `menu-open` tant que le menu est ouvert. Le menu se ferme quand sa session quitte « Sans projet » ;
  - `Kbd Entrée` disparaît d'« Ouvrir » sur ces lignes, comme dans la maquette.
- Les toasts sont ceux du lot 4 (`joined`, `offline`, `outdated`, `invalid`, `unconfirmed`) ; rien ne bouge avant la diffusion des projets.

Textes français :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `list.grip` | `Glisser vers un projet` | — |
| `list.dropHelp` | `Déposez sur un projet de la barre latérale ou sur son groupe.` | `Drop on a project in the sidebar or on its group.` |
| `list.dropNow(name)` | `Lâcher pour ranger ${name}` | `Drop to move ${name}` |

- [ ] **Step 1: Écrire `test/list-filing.test.tsx`**

```tsx
const row = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) });
const group = (name: string) => screen.getByRole('region', { name });

it('dragging Kit onto the Ledge group writes the rule; Kit joins that group once the daemon broadcasts', async () => {
  const { d } = await boot({ sessions: listSessions(), list: true });
  const dt = transfer();
  fireEvent.dragStart(row('Kit'), { dataTransfer: dt });
  expect(screen.getByText('Drop on a project in the sidebar or on its group.')).toBeVisible();
  fireEvent.dragOver(group('Ledge'), { dataTransfer: dt });
  expect(group('Ledge')).toHaveClass('drop-over');
  expect(within(group('Ledge')).getByText('Drop to move Kit')).toBeVisible();
  fireEvent.dragOver(group('No project'), { dataTransfer: dt });
  expect(group('No project')).not.toHaveClass('drop-over');
  fireEvent.drop(group('Ledge'), { dataTransfer: dt });
  await waitFor(() => expect(d.received).toContainEqual({ type: 'projects.set', projects: { projects: PROJECTS.projects, rules: [{ machine: 'local', path: '/tmp', project: 'ledge' }] } }));
  await waitFor(() => expect(within(group('Ledge')).getByRole('listitem', { name: /^Kit,/ })).toBeVisible());
  expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Kit joins the Ledge table. Ledge will remember this folder.');
});
it('Move to… on a row: ↓ reaches the next project, Escape gives the focus back, a choice files Kit', async () => {
  const { user } = await boot({ sessions: listSessions(), list: true });
  const trigger = within(row('Kit')).getByRole('button', { name: 'Move to…' });
  await user.click(trigger);
  expect(row('Kit')).toHaveClass('menu-open');
  expect(screen.getByRole('menuitem', { name: /^Ledge/ })).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: /^Payment/ })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: /^Payment/ }));
  await waitFor(() => expect(within(group('Payment Service Platform Migration Europe')).getByRole('listitem', { name: /^Kit,/ })).toBeVisible());
});
it('with the local daemon down, a drop says so in plain words and Kit stays in Sans projet', async () => {
  const { d, side } = await boot({ sessions: listSessions(), list: true });
  await d.close();
  await waitFor(() => expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('offline'));
  const dt = transfer();
  fireEvent.dragStart(row('Kit'), { dataTransfer: dt });
  fireEvent.dragOver(group('Ledge'), { dataTransfer: dt });
  fireEvent.drop(group('Ledge'), { dataTransfer: dt });
  expect(screen.getByRole('status')).toHaveTextContent('Kit could not be moved: the local Ledge daemon is not reachable.');
  expect(within(group('No project')).getByRole('listitem', { name: /^Kit,/ })).toBeVisible();
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter desktop exec vitest run test/list-filing.test.tsx`
Expected : FAIL, les lignes de « Sans projet » ne se glissent pas.

- [ ] **Step 3: Implémenter `MoveTo`, sa reprise dans `Unassigned`, les cibles et le glisser de la Liste**

- [ ] **Step 4: Vérifier que la suite passe**

Run: `pnpm --filter desktop test && pnpm --filter desktop typecheck`
Expected : tout passe, `atelier-filing` compris.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop/src apps/desktop/test/list-filing.test.tsx
git commit -m "feat(desktop): put an agent away from the List: drag a Sans projet row onto a project group, or Move to…

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 8: La Liste dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/list.spec.ts`
- Modify: `apps/desktop/e2e/daemon.ts` (`twoProjects` exporté, repris par `shell.spec.ts` et `atelier.spec.ts`)

**Interfaces:**
- Consumes : tout ce qui précède ; `fakeDaemon`, `session`, `eight`, `T0` (`e2e/daemon.ts`, `T0` = maintenant moins 5 min).
- Produces : les scénarios que le lot 6 étendra (Répondre qui pose le focus sur la réponse).

Données du fichier :
- `kit` (`/tmp/scratch`, sans projet) comme dans `atelier.spec.ts` ;
- `fleet` = `eight` où Otto porte une demande (`pending: { kind: 'permission', text: 'npm test', source: 'hook' }` : sans demande, la ligne ne propose pas Autoriser), plus `kit` ;
- `crowd30` = trente sessions `p01`…`p30` dans `/w/ledge` (noms `P01`…`P30`), pour les en-têtes collés.

- [ ] **Step 1: Écrire `list.spec.ts`**

```ts
const list = (page: Page) => page.locator('.overview-scroll.list');
const row = (page: Page, name: string) => page.getByRole('listitem', { name: new RegExp(`^${name},`) });

test('the List groups by project, what waits first, Sans projet last; activity reads in minutes', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page.locator('.lgroup')).toHaveCount(3);
  expect(await page.locator('.lgroup').evaluateAll(gs => gs.map(g => g.getAttribute('aria-label')))).toEqual(['Ledge', 'Website', 'No project']);
  await expect(page.getByRole('region', { name: 'Ledge' }).getByRole('listitem').first()).toHaveAccessibleName(/^Otto,/);
  await expect(row(page, 'Otto').locator('.r-when')).toHaveText('for 5 min');
  await expect(row(page, 'Nova').locator('.r-when')).toHaveText('5 min ago');
});
test('F filters, J walks, Enter opens; Escape comes back to the List', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await page.keyboard.press('f');
  await page.keyboard.type('web');
  await expect(page.locator('.lgroup')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Luna')).toBeFocused();
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('banner').getByText('Milo')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
});
test('Allow from a row: the daemon gets one decision, the row follows the agent', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await row(page, 'Otto').hover();
  await row(page, 'Otto').getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.decide')).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]);
  daemon.upsert({ ...fleet[0]!, state: 'working', pending: undefined });
  await expect(row(page, 'Otto').getByText('Running')).toBeVisible();
});
test('drag Kit from Sans projet onto the Ledge group: the daemon gets the rule, Kit joins it', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await row(page, 'Kit').dragTo(page.getByRole('region', { name: 'Ledge' }));
  await expect(page.getByRole('region', { name: 'Ledge' }).getByRole('listitem', { name: /^Kit,/ })).toBeVisible();
  expect(daemon.received).toContainEqual(expect.objectContaining({ type: 'projects.set', projects: expect.objectContaining({ rules: [{ machine: 'local', path: '/tmp/scratch', project: 'ledge' }] }) }));
});
test('under 780 px machine and activity go under the task, nothing scrolls sideways; group headers stay under the toolbar', async ({ page }) => {
  await fakeDaemon(page, crowd30, { projects: twoProjects });
  await page.setViewportSize({ width: 760, height: 700 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  const first = row(page, 'P01');
  const title = (await first.locator('.r-title').boundingBox())!, ctx = (await first.locator('.r-ctx').boundingBox())!;
  expect(ctx.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  expect(await list(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await list(page).evaluate(el => { el.scrollTop = 900; });
  const bar = (await page.locator('.list-toolbar').boundingBox())!, head = (await page.locator('.lgroup[aria-label="Ledge"] .lgroup-head').boundingBox())!;
  expect(Math.abs(head.y - (bar.y + bar.height))).toBeLessThan(2);
});
test('grouping and density survive a reload', async ({ page }) => {
  await fakeDaemon(page, fleet, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await page.getByRole('radio', { name: 'Machine' }).click();
  await page.getByRole('button', { name: 'Compact rows' }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Machine' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.list-view')).toHaveClass(/density-tight/);
});
```

Dans `atelier.spec.ts`, le scénario « a crowded table… » vérifie en plus, une fois sur la Liste, que seul le groupe « Ledge » est affiché et qu'il compte ses huit agents principaux, les six assis et les deux de « +3 » : `await expect(page.locator('.lgroup')).toHaveCount(1)` puis `await expect(page.getByRole('region', { name: 'Ledge' }).getByRole('listitem')).toHaveCount(8)` (les sous-agents d'Otto et de Nova travaillent : ils restent repliés).

- [ ] **Step 2: Lancer Playwright**

Run: `pnpm --filter desktop e2e`
Expected : tous les scénarios passent : 4 de `boot`, 4 de `shell`, 6 de `atelier` et 6 de `list`.

- [ ] **Step 3: Vérification du dépôt**

Run: `pnpm -r typecheck && pnpm test && pnpm -r build`
Expected : tout passe. Seule l'instabilité connue de l'overlay (`prototype-parity`) peut apparaître ; la signaler sans la corriger.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/e2e
git commit -m "test(desktop): the List in the browser: groups and activity, F / J / Enter, Allow, drag and drop, 760 px and sticky headers, remembered grouping

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
