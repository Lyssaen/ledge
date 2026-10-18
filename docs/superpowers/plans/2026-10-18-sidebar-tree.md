# Sidebar arbre (Nova) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la sidebar Desktop par l'explorateur de la maquette Nova (arbre projet › branche › session, « À toi », Archives) et retirer la vue Liste.

**Architecture:**
- Un modèle pur (`treeModel`, `attentionOf`, `filterArchived`) lit les `Session` déjà annotées (`branch`, `worktree`, `helpers`, `archivedAt`).
- La sidebar compose Ask / Atelier / À toi / arbre / Archives / pied machines, et réutilise `SessionActions`, `SessionMenu`, `useDecisions`.
- Aucun message daemon nouveau. La titlebar garde la marque et la recherche. La Liste disparaît ; `list/time.ts` et `repoOf` restent.

**Tech Stack:** TypeScript, React 19, Tauri (`apps/desktop`), Vitest + Testing Library, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-18-sidebar-tree-design.md`. Maquette : `docs/mockups/session-management/sidebar-tree.tsx` + `sidebar-tree.css` (page `docs/mockups/ledge-session-management.html`).

## Global Constraints

- **Pas de word mark, pas de bouton Rechercher** dans la sidebar (titlebar). Interdit : `[data-brand]`, `.side-brand`, un bouton dont le nom matche `/Search|Go to a session|Rechercher/`.
- **Pas de sélecteur d'archivage automatique** (`.st-auto` n'existe pas).
- **Largeur :** 288 px ; 256 px sous 1250 px ; rail 64 px sous 850 px ; cachée sous 540 px et en plein écran.
- **Branche absente = `main`.** Une seule branche, ou « Sans projet » : pas de rangée branche.
- **Terminées = `exited` | `idle`, `!offline`.** Masquées par défaut (`hideDone: true`).
- **Actions :** uniquement via `SessionActions` / `SessionMenu`. Jamais `session.archive|restore|resume|delete` si `!actions.allowed(id)`.
- **Langues :** `fr.ts` source, `en.ts` traduction, e2e en anglais.
- **Raccourcis sidebar :** `/` focus ask ; Ctrl ⇧ E focus arbre ; Alt ↓ prochaine carte « À toi » ; dans l'arbre : ↑ ↓ ← →, E, Suppr, H, D.
- **Sous-agents :** pas de menu, suivent le principal.
- **Liste :** plus de `View = 'list'`. `desktop.overview.view === 'list'` se lit atelier. « +N à cette table » → `{ type: 'home', project }`.
- Ne pas modifier les fichiers non listés d'un autre chantier en cours (`Thread.tsx`, `poller.ts`, overlay, etc.).

## File Structure

| Fichier | Responsabilité |
|---|---|
| `apps/desktop/src/shell/sidebar/model.ts` | `branchOf`, `isFinished`, `treeModel`, `attentionOf`, `filterArchived` |
| `apps/desktop/src/shell/sidebar/prefs.ts` | `desktop.sidebar` (`hideDone`, `dense`) |
| `apps/desktop/src/shell/sidebar/Sidebar.tsx` | Composition, ask, clavier global de la barre |
| `apps/desktop/src/shell/sidebar/Attention.tsx` | Cartes « À toi » |
| `apps/desktop/src/shell/sidebar/Tree.tsx` | Arbre + « +N terminées » |
| `apps/desktop/src/shell/sidebar/Archives.tsx` | Section Archives |
| `apps/desktop/src/styles/sidebar.css` | Styles maquette adaptés |
| `apps/desktop/src/shell/Sidebar.tsx` | Réexport de `./sidebar/Sidebar` (les imports existants restent) |

## Review Focus

1. **Deux sessions Ledge, branches `desktop` et `main` :** une rangée branche chacune, pas de fusion. Test tâche 1.
2. **Session ouverte archivée pendant qu'on la lit :** l'arbre la perd, Archives se déplie, la rangée archive est `aria-current`. Test tâche 8.
3. **`/` focus le champ ask, n'ouvre pas le chat ; Entrée avec du texte ouvre le chat et envoie `chat.ask`.** Test tâche 5.
4. **Machine sans `daemon.archive` :** Archiver / Reprendre / Remettre / Supprimer de la rangée n'envoient rien. Test tâche 7.
5. **`desktop.overview.view: 'list'` au boot :** l'atelier s'affiche, pas la Liste, pas d'onglet Liste. Test tâche 11.

---

## Partie A — modèle et préférences

### Task 1: Le modèle d'arbre

**Files:**
- Create: `apps/desktop/src/shell/sidebar/model.ts`
- Test: `apps/desktop/test/sidebar-model.test.ts`

**Interfaces:**
- Consumes: `Session`, `Projects`, `projectOf` / `projectIdOf`, `taskOf`, `fold` (`nav/agents.ts`).
- Produces:
  - `branchOf(s: Pick<Session,'branch'>): string` — `s.branch?.trim() || 'main'`
  - `isFinished(s: Pick<Session,'state'|'offline'>): boolean` — `!s.offline && (s.state === 'exited' || s.state === 'idle')`
  - `export interface BranchGroup { branch: string; worktree: boolean; sessions: Session[] }`
  - `export interface ProjectGroup { id: string | null; name: string; repo?: string; flatten: boolean; branches: BranchGroup[] }`
  - `treeModel(sessions: readonly Session[], projects: Projects | null, projectIdOf: (s: Session) => string | null): ProjectGroup[]`
    - Un groupe par projet de `projects.projects` (même vide), puis `{ id: null, name: sentinelle }` s'il reste des sessions sans projet. Sans `projects`, un seul groupe `id: null`.
    - Dans un groupe : sessions groupées par `branchOf`, ordre d'apparition (première session de la branche). `worktree` si l'une d'elles a `worktree: true`. `repo` = premier `s.repo` du groupe.
    - `flatten` = `id === null || branches.length <= 1`.
  - `export type AttnKind = 'approval' | 'question' | 'error'`
  - `export interface AttnItem { session: Session; helper?: import('@ledge/protocol').Helper; kind: AttnKind; since: string }`
  - `attentionOf(sessions: readonly Session[], waits: ReadonlyMap<string, { since: string }>): AttnItem[]`
    - Ignore `offline`. `kind` : `waiting_permission` → `approval`, `waiting_input` → `question`, `error` → `error`. Autres : exclus.
    - Si `pending.helperId` matche un helper, `helper` est posé.
    - Tri : `since` croissant (plus ancienne d'abord). `since` = `waits.get(session.id)?.since ?? session.lastActivityAt`.
  - `filterArchived(archived: readonly Session[], q: string, projectName: (s: Session) => string): Session[]` — `fold` sur `name`, `taskOf`, nom de projet ; vide → copie.

- [ ] **Step 1: Write the failing tests** in `sidebar-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { projectOf } from '@ledge/fleet';
import { TWO_PROJECTS } from './helpers';
import { attentionOf, branchOf, filterArchived, isFinished, treeModel } from '../src/shell/sidebar/model';

const idOf = (s: ReturnType<typeof fakeSession>) => projectOf(s, TWO_PROJECTS);

describe('treeModel', () => {
  it('folds a single branch into the project and names it repo · branch', () => {
    const otto = fakeSession('otto', { cwd: '/w/ledge', branch: 'desktop', repo: 'harness-assistant' });
    const [g] = treeModel([otto], TWO_PROJECTS, idOf);
    expect(g).toMatchObject({ id: 'ledge', name: 'Ledge', repo: 'harness-assistant', flatten: true });
    expect(g!.branches).toEqual([expect.objectContaining({ branch: 'desktop', worktree: false, sessions: [otto] })]);
  });

  it('splits two branches and marks a linked worktree', () => {
    const a = fakeSession('a', { cwd: '/w/ledge', branch: 'desktop', repo: 'harness-assistant' });
    const b = fakeSession('b', { cwd: '/w/ledge', branch: 'release-0.6', worktree: true, repo: 'harness-assistant' });
    const [g] = treeModel([a, b], TWO_PROJECTS, idOf);
    expect(g!.flatten).toBe(false);
    expect(g!.branches.map(x => [x.branch, x.worktree, x.sessions.map(s => s.id)])).toEqual([
      ['desktop', false, [a.id]],
      ['release-0.6', true, [b.id]]
    ]);
  });

  it('treats a missing branch as main and keeps Sans projet flat', () => {
    const kit = fakeSession('kit', { cwd: '/tmp' });
    const [none] = treeModel([kit], TWO_PROJECTS, idOf).filter(g => g.id === null);
    expect(none).toMatchObject({ flatten: true });
    expect(none!.branches[0]!.branch).toBe('main');
    expect(none!.branches[0]!.sessions).toEqual([kit]);
  });

  it('keeps an empty project so the sidebar can still launch into it', () => {
    const ids = treeModel([], TWO_PROJECTS, idOf).map(g => g.id);
    expect(ids).toEqual(['ledge', 'pay']);
  });
});

describe('attentionOf', () => {
  it('oldest wait first, a helper-routed request is the helper', () => {
    const otto = fakeSession('otto', {
      state: 'waiting_permission', lastActivityAt: '2026-10-18T10:00:00.000Z',
      pending: { kind: 'permission', text: 'npm test', source: 'hook', helperId: 'h1' },
      helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire', state: 'waiting_permission' }]
    });
    const kit = fakeSession('kit', { cwd: '/tmp', state: 'waiting_input', lastActivityAt: '2026-10-18T10:12:00.000Z', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } });
    const nova = fakeSession('nova', { state: 'working' });
    const items = attentionOf([nova, kit, otto], new Map([[otto.id, { since: '2026-10-18T09:48:00.000Z' }]]));
    expect(items.map(i => [i.session.name, i.helper?.kind, i.kind])).toEqual([
      ['Otto', 'Explore', 'approval'],
      ['Kit', undefined, 'question']
    ]);
    expect(items[0]!.since).toBe('2026-10-18T09:48:00.000Z');
  });
});

describe('filterArchived / helpers', () => {
  it('branchOf and isFinished', () => {
    expect(branchOf({})).toBe('main');
    expect(branchOf({ branch: '  desktop ' })).toBe('desktop');
    expect(isFinished(fakeSession('a', { state: 'exited' }))).toBe(true);
    expect(isFinished(fakeSession('a', { state: 'idle' }))).toBe(true);
    expect(isFinished(fakeSession('a', { state: 'exited', offline: true }))).toBe(false);
    expect(isFinished(fakeSession('a', { state: 'working' }))).toBe(false);
  });
  it('filterArchived matches name, task and project', () => {
    const old = fakeSession('old', { name: 'Nova', topic: 'Migration', archivedAt: '2026-10-18T10:00:00.000Z' });
    expect(filterArchived([old], 'migr', () => 'Payment').map(s => s.id)).toEqual([old.id]);
    expect(filterArchived([old], 'zzz', () => 'Payment')).toEqual([]);
    expect(filterArchived([old], '', () => 'Payment')).toEqual([old]);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/sidebar-model.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `model.ts`. `treeModel` : pour chaque projet, `sessions.filter(s => projectIdOf(s) === p.id)` ; ensuite les `projectIdOf(s) === null`. Grouper avec une `Map<string, Session[]>` dans l'ordre d'arrivée. Ne pas importer React.
- [ ] **Step 4: Run** le même test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): model the sidebar as project, branch and session`

### Task 2: Préférences hide / dense

**Files:**
- Create: `apps/desktop/src/shell/sidebar/prefs.ts`
- Test: `apps/desktop/test/sidebar-prefs.test.ts`

**Interfaces:**
- Produces:
  - `export const SIDEBAR_KEY = 'desktop.sidebar'`
  - `export interface SidebarPrefs { hideDone: boolean; dense: boolean }`
  - `loadSidebarPrefs(): SidebarPrefs` — défaut `{ hideDone: true, dense: false }` ; JSON cassé ou clé absente → défaut.
  - `saveSidebarPrefs(p: SidebarPrefs): void` — `writeJson`.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, expect, it } from 'vitest';
import { loadSidebarPrefs, saveSidebarPrefs, SIDEBAR_KEY } from '../src/shell/sidebar/prefs';

afterEach(() => localStorage.removeItem(SIDEBAR_KEY));

it('defaults to hiding finished sessions, not dense', () => {
  expect(loadSidebarPrefs()).toEqual({ hideDone: true, dense: false });
});

it('round-trips and survives a broken value', () => {
  saveSidebarPrefs({ hideDone: false, dense: true });
  expect(loadSidebarPrefs()).toEqual({ hideDone: false, dense: true });
  localStorage.setItem(SIDEBAR_KEY, '{');
  expect(loadSidebarPrefs()).toEqual({ hideDone: true, dense: false });
});
```

- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/sidebar-prefs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** avec `readJson` / `writeJson` / `isRecord` de `state/storage.ts`, comme `nav/overview.ts`.
- [ ] **Step 4: Run** le même test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): remember whether the sidebar hides finished sessions`

---

## Partie B — rendu

### Task 3: Textes

**Files:**
- Modify: `apps/desktop/src/i18n/fr.ts` (`side`)
- Modify: `apps/desktop/src/i18n/en.ts` (`side`)
- Test: les tests d'UI des tâches suivantes (anglais). Vérifier ici que `pnpm --filter desktop exec tsc --noEmit -p tsconfig.json` (ou `pnpm --filter desktop typecheck`) échoue tant que `en.ts` n'a pas la même forme.

**Interfaces:**
- Produces: étendre `side` (garder les clés existantes utilisées ailleurs : `label`, `newSession`, `searchLabel`, `atelier`, `chat`, `projects`, `newProject`, `unassigned`, `machines`, `agents`, `offline`, `settings`) :

```ts
// fr.ts — ajouter dans side, ne pas retirer les clés existantes
ask: 'Demander à Ledge', askPlaceholder: 'Demander à Ledge…',
openChat: 'Ouvrir la conversation avec Ledge',
active: (n: number) => plural(n, `${n} actif`, `${n} actifs`),
yours: 'À toi', yoursMore: (n: number) => `Voir les ${n} autres`, yoursLess: 'Réduire',
allow: 'Oui', deny: 'Non', reply: 'Répondre', see: 'Voir',
ofHelper: (parent: string) => `↳ ${parent}`,
hideDone: 'Masquer les sessions terminées (H)', showDone: 'Afficher les sessions terminées (H)',
dense: 'Mode compact (D)', foldAll: 'Tout replier',
tree: 'Projets, branches et sessions',
fold: (name: string) => `Replier ${name}`, unfold: (name: string) => `Déplier ${name}`,
foldKids: (name: string) => `Masquer les sous-agents de ${name}`,
unfoldKids: (name: string) => `Afficher les sous-agents de ${name}`,
newHere: (name: string) => `Nouvelle session dans ${name}`,
newOn: (branch: string) => `Nouvelle session sur ${branch}`,
filterProject: (name: string) => `N’afficher que ${name} dans l’atelier`,
moreDone: (n: number) => `+${n} ${plural(n, 'terminée', 'terminées')}`,
hideDoneLink: (n: number) => n > 1 ? 'Masquer les terminées' : 'Masquer la terminée',
archiveDone: 'Archiver les sessions terminées de cette branche',
archiveOne: (name: string) => `Archiver ${name}`,
manageOne: (name: string) => `Gérer la session ${name}`,
terminalOne: (name: string) => `Ouvrir le terminal de ${name}`,
kids: (n: number) => `${n} ${plural(n, 'sous-agent', 'sous-agents')}`,
wt: 'Worktree lié',
tallyNeed: 'à décider', tallyWork: 'au travail', tallyOff: 'hors ligne', tallyDone: 'terminées',
archives: 'Archives', archiveFilter: 'Filtrer les archives', archiveFilterPh: 'Filtrer les archives…',
archiveEmpty: 'Rien d’archivé pour l’instant.', archiveNone: 'Aucune archive ne correspond.',
read: (name: string, project: string, task: string, when: string) => `Relire ${name}, ${project}, ${task}, archivée ${when}`,
restoreOne: (name: string) => `Remettre ${name} à la table`,
resumeOne: (name: string) => `Reprendre ${name}`,
deleteOne: (name: string) => `Supprimer ${name}`,
dropHelp: (name: string) => `Déposez sur un projet pour y ranger ${name}.`,
hint: '↑ ↓ parcourir · ← → plier · E archiver · H terminées · Ctrl ⇧ E focus',
state: {
  approval: 'attend ton accord', question: 'te pose une question', error: 'en erreur',
  working: 'au travail', starting: 'démarre', idle: 'au repos', done: 'terminée', offline: 'hors ligne'
} satisfies Record<string, string>
```

Anglais (`en.ts`) : "Ask Ledge", "Ask Ledge…", "Open the conversation with Ledge", `${n} active`, "Your turn", `See the other ${n}`, "Show less", "Yes", "No", "Reply", "View", `↳ ${parent}`, "Hide finished sessions (H)", "Show finished sessions (H)", "Compact mode (D)", "Fold all", "Projects, branches and sessions", `Fold ${name}`, `Unfold ${name}`, `Hide ${name}’s subagents`, `Show ${name}’s subagents`, `New session in ${name}`, `New session on ${branch}`, `Show only ${name} in the atelier`, `+${n} finished`, `Hide finished` / `Hide the finished one`, "Archive this branch’s finished sessions", `Archive ${name}`, `Manage ${name}’s session`, `Open ${name}’s terminal`, `${n} subagent(s)`, "Linked worktree", "to decide" / "working" / "offline" / "finished", "Archives", "Filter the archives", "Filter the archives…", "Nothing archived yet.", "No archive matches.", `Reread ${name}, ${project}, ${task}, archived ${when}`, `Put ${name} back at the table`, `Resume ${name}`, `Delete ${name}`, `Drop on a project to file ${name}.`, "↑ ↓ move · ← → fold · E archive · H finished · Ctrl ⇧ E focus", states: "is waiting for you" / "has a question" / "has an error" / "is working" / "is starting" / "is idle" / "finished" / "offline".

- [ ] **Step 1:** Ajouter les clés dans `fr.ts` **et** `en.ts` (même forme, sinon `Messages` casse).
- [ ] **Step 2: Run** `pnpm --filter desktop typecheck`. Expected: PASS.
- [ ] **Step 3: Commit** `feat(desktop): copy for the explorer sidebar`

### Task 4: Styles de la maquette, sans marque ni recherche

**Files:**
- Modify: `apps/desktop/src/styles/sidebar.css` (remplacer le contenu)
- Modify: `apps/desktop/src/styles/shell.css` (largeur `.sidebar` : 288 / 256 / 64)
- Test: `apps/desktop/test/settings-page.test.tsx` (`.side-footer{` — garder ce sélecteur)
- Test: `apps/desktop/test/atelier-filing.test.tsx` (`.side-project.drop-over` → `.st-project.drop-over`)
- Test: `apps/desktop/test/shell.test.tsx` (`.side-dots .dot-error` : supprimer ou remplacer par `.t-need` / `.st-time.t-error`)

**Interfaces:**
- Produces: le CSS de `docs/mockups/session-management/sidebar-tree.css`, avec ces écarts :
  - pas de `.st-brand strong` (pas de word mark) ; `.st-brand` ne porte que le bouton Session ;
  - pas de `.st-search` ;
  - pas de `.st-auto` ;
  - garder `.side-footer{…}` comme alias de `.st-foot` (le test Settings le lit) ;
  - garder `.machine-dot` / `.machine-dot.off` (déjà dans le fichier) ;
  - `.st-project.drop-over` comme l'actuel `.side-project.drop-over`.

- [ ] **Step 1:** Copier `sidebar-tree.css` dans `sidebar.css`. Retirer `.st-search`, `.st-auto`, le word mark. Ajouter :

```css
.side-footer{padding:0;border:0} /* alias: Settings' test reads this selector; the foot is .st-foot */
```

Dans `shell.css`, remplacer les largeurs `.sidebar` : 216→288, 190→256, 64 inchangé.

- [ ] **Step 2:** Adapter les trois tests CSS ci-dessus (filing : `declarations('sidebar.css', '.st-project.drop-over')` et `.is-dragging .st-project:not(.drop-over)`).
- [ ] **Step 3: Run** `pnpm --filter desktop exec vitest run test/settings-page.test.tsx test/atelier-filing.test.tsx test/shell.test.tsx`. Expected: PASS pour ces assertions CSS (d'autres tests UI de ces fichiers peuvent encore viser l'ancienne sidebar : les corriger à la tâche 9, pas ici, si le fichier teste le rendu). Si `shell.test.tsx` mélange CSS et UI, ne toucher qu'à l'assertion `.side-dots`.
- [ ] **Step 4: Commit** `feat(desktop): style the sidebar as the explorer mockup`

### Task 5: Coquille — Session, ask, Atelier, pied

**Files:**
- Create: `apps/desktop/src/shell/sidebar/Sidebar.tsx`
- Modify: `apps/desktop/src/shell/Sidebar.tsx` — `export { Sidebar } from './sidebar/Sidebar';` (retirer l'ancien composant)
- Modify: `apps/desktop/src/App.tsx` — passer `archived`, `actions`, `menu`, `decisions`, `waits`, `client`, `reveal`, `theme`/`paused` déjà connus
- Modify: `apps/desktop/src/nav/useKeys.ts` — `/` focus `[data-ask-input]` s'il est là ; sinon ouvre le chat (plein écran)
- Test: `apps/desktop/test/sidebar.test.tsx` (nouveau)
- Test: `apps/desktop/test/titlebar.test.tsx` (déjà : pas de marque / recherche dans la sidebar — doit rester vert)
- Test: `apps/desktop/test/keys.test.tsx` (le `/` ouvre le chat : le faire viser le champ ask)

**Interfaces:**
- Consumes: `NavState`, `NavAction`, `Filing`, `SessionActions`, `SessionMenuState` (`useSessionMenu`), `Decisions`, `Wait`, `DaemonClient`.
- Produces: `<Sidebar>` avec les props :

```ts
export function Sidebar(p: {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; archived: readonly Session[];
  machines: readonly MachineState[]; projects: Projects | null;
  order: readonly Session[]; projectIdOf: (s: Session) => string | null;
  filing: Filing; actions: SessionActions; decisions: Decisions;
  waits: ReadonlyMap<string, Wait>;
  menu: { open(id: string, at: { x: number; y: number }, opener?: HTMLElement): void };
  onAsk(text: string): void;
  onTerminal(s: Session): void;
  revealArchives: number; revealCurrent: number;
}): JSX.Element
```

Pour cette tâche, `Attention`, `Tree` et `Archives` peuvent être des stubs vides (sections `aria-label` seulement). Le pied machines + Réglages, le bouton Session, le champ ask et la rangée Atelier sont vrais.

Ask :

```tsx
const submitAsk = () => {
  const q = ask.trim();
  dispatch({ type: 'chat', open: true });
  if (q) { p.onAsk(q); setAsk(''); }
};
```

`onAsk` dans `App.tsx` (à côté de `ChatPanel.ask`) :

```ts
const [tool] = useDefaultTool();
const askLedge = (text: string) => {
  if (!fleetView.machines.find(m => m.id === 'local')?.ready) { dispatch({ type: 'chat', open: true }); return; }
  const qid = `q-${crypto.randomUUID()}`;
  daemonStore.beginTurn({ qid, question: text, askedAt: new Date().toISOString(), steps: [] });
  fleetClient.send({ type: 'chat.ask', qid, text, tool });
};
```

`/` dans `useKeys.ts` (à la place des deux `dispatch({ type: 'chat' })` sur `/`) :

```ts
if (e.key === '/' && !mod && !e.altKey && !typing(document.activeElement)) {
  const ask = document.querySelector<HTMLInputElement>('[data-ask-input]');
  if (ask) { e.preventDefault(); ask.focus(); return; }
  e.preventDefault(); dispatch({ type: 'chat', open: true });
}
```

- [ ] **Step 1: Write the failing tests** in `sidebar.test.tsx` (boot + `TWO_PROJECTS` + `listSessions`) :

  - `it('has New session, Ask Ledge and Atelier, and neither brand nor search')` : bouton New session, textbox « Ask Ledge », bouton Atelier avec le compteur `activeCount` ; `document.querySelector('.sidebar [data-brand]')` null ; pas de bouton Search dans `side`.
  - `it('/ focuses Ask Ledge; Enter with text opens the chat and sends chat.ask')` : `user.keyboard('/')` → textbox focused, chat absent ; taper `hello` + Enter → complementary « Chat Ledge » visible, et `d.received` contient `{ type: 'chat.ask', qid: expect.stringMatching(/^q-/), text: 'hello', tool: 'claude' }` (comme `asks()` dans `chat.test.tsx`).
  - `it('the machine chips open Settings › Machines; the gear opens Settings')`.

- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/sidebar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** Sidebar + câblage App (props nouvelles ; `Attention`/`Tree`/`Archives` : `<section aria-label={…} />` vides pour l'instant). Adapter `useKeys`. Adapter `keys.test.tsx` : `/` focus ask. `titlebar.test.tsx` doit rester vert.
- [ ] **Step 4: Run** `pnpm --filter desktop exec vitest run test/sidebar.test.tsx test/titlebar.test.tsx test/keys.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): the sidebar asks Ledge and keeps the title bar as the brand`

### Task 6: L'arbre projet › branche › session

**Files:**
- Create: `apps/desktop/src/shell/sidebar/Tree.tsx`
- Modify: `apps/desktop/src/shell/sidebar/Sidebar.tsx` (monter Tree)
- Test: `apps/desktop/test/sidebar-tree.test.tsx`

**Interfaces:**
- Consumes: `treeModel`, `isFinished`, `branchOf`, `SidebarPrefs`, `Filing.dropProps`, `SessionBot` / `HelperBot`, `taskOf`, `spanOf` + textes `list.when` **ou** un court `when(ms)` local identique à la maquette (`N min` / `N h` / `N j`). Préférer `spanOf` de `list/time.ts` + `t.list.when.units` pour rester cohérent avec la Liste / titlebar.
- Produces: `<Tree>` :

```ts
export function Tree(p: {
  groups: ProjectGroup[];
  sessions: readonly Session[];
  current: string | null;
  filter: string;
  hideDone: boolean; dense: boolean;
  filing: Filing;
  revealCurrent: number;
  onHome(project?: string): void;
  onOpen(id: string, helper?: string): void;
  onLaunch(project?: string): void;
  onMenu(id: string, e: React.MouseEvent): void;
  onArchive(ids: string[]): void;
  onDelete(ids: string[]): void;
  onTerminal(s: Session): void;
  paused: boolean;
}): JSX.Element
```

Comportement (maquette `sidebar-tree.tsx`) :
- `role="tree"` `aria-label={t.side.tree}`.
- Projet : chevron, `ProjectSwatch` (ou icône unassigned), bouton nom (+ `repo · branch` si `flatten`), tally (need / work / off / done si `!hideDone`), `+` lance dans le projet. Clic nom → `onHome(id ?? 'none')`. `dropProps` si `id`.
- Si `!flatten` : rangée branche (icône, nom mono, badge `wt` si `worktree`, compteur, `+` lance, terminal de la première session).
- Session : bot, nom, `taskOf`, délai, pastille kids si sous-agents repliés, actions hover (terminal, archive si principal, …). `aria-selected` si `current === id`. Clic → `onOpen`. `onContextMenu` → `onMenu`.
- Helper : indenté, `HelperBot`, pas d'archive. Clic → `onOpen(parent.id, helper.id)`.
- `+N terminées` / Archiver sur les `isFinished` du niveau (projet flatten ou branche). `shown` (Set de clés `p:id` / `p:id:branch`) déplie.
- `closed` (Set) replie projet / branche. Défaut : tout ouvert.
- Sous-agents : ouverts si l'un `needs` (state approval/question/error du helper, ou `pending.helperId`) ; le Set `kids` inverse.
- Session ouverte : `useEffect` sur `current` + `revealCurrent` déplie projet / branche / terminées / kids et `scrollIntoView({ block: 'nearest' })` via `data-tree-key={id}` (comparer en JS, pas en sélecteur CSS).

Clavier (sur `.st-tree`) : comme la maquette — ↑ ↓, ← (replier ou parent), → (déplier), E / Delete sur un principal, H / D via callbacks `onToggleHide` / `onToggleDense` passés par Sidebar (qui tient `useStored`). `stopPropagation` pour que l'atelier n'entende pas E / J / K.

- [ ] **Step 1: Write the failing tests** (sessions : Otto `branch:'desktop'` Ledge permission + helper, Bix exited Ledge, Rio offline Ledge `branch:'desktop'`, Nova working pay `branch:'checkout'`, Kit `/tmp` question) :

  - `it('lists projects, folds a single branch, and hides Bix behind +1 finished')` : boutons Ledge (avec `harness-assistant · desktop` ou au moins Ledge), Payment, Sans projet ; Otto et Nova visibles ; Bix absent ; `+1 finished` visible sous Ledge ; clic → Bix apparaît, lien « Archive ».
  - `it('opens a session from its row and filters the atelier from the project row')` : clic Otto → `place.kind === 'session'` (crumb / heading Otto) ; clic Payment → filtre (crumb Payment).
  - `it('unfolds two branches of the same project')` : ajouter une session Ledge `branch:'release-0.6', worktree:true` ; les deux noms de branche sont des boutons ; badge `wt`.
  - `it('a right click on Otto opens the session menu')` : `contextMenu` → menuitem Open.
  - `it('H hides finished ones; the open session stays in view')` : ouvrir Bix (afficher les terminées, clic Bix) ; la rangée Bix a `aria-selected` / `aria-current`.

- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/sidebar-tree.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** Tree + prefs via `useStored(loadSidebarPrefs, saveSidebarPrefs)` dans Sidebar. Port minimal depuis `sidebar-tree.tsx` (ignorer `WORK`/`REPO` mock : utiliser `branchOf` / `s.repo`).
- [ ] **Step 4: Run** le test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): the sidebar tree is project, branch, then session`

### Task 7: Menu, E, Suppr, « Archiver » des terminées

**Files:**
- Modify: `apps/desktop/src/shell/sidebar/Tree.tsx` / `Sidebar.tsx` (déjà câblé si la tâche 6 a passé `onMenu` / `onArchive` / `onDelete`)
- Modify: `apps/desktop/src/App.tsx` — `sessionMenu.open`, `actions.request('archive'|'delete', ids)`, `openSessionTerminal` pour le bouton terminal
- Test: `apps/desktop/test/sidebar-manage.test.tsx`

**Interfaces:**
- Consumes: `useSessionMenu`, `SessionActions.request`, `openSessionTerminal(client, s)` (`session/terminal.ts`).
- Produces: rien de nouveau. Le menu déjà monté par `SessionMenuHost` dans App s'ouvre aussi depuis l'arbre.

- [ ] **Step 1: Write the failing tests** (`daemon: { version:'0.7.0', install:'npm', systemd:true, archive:true }`) :

  - `it('… and a right click open the same session menu; E archives a finished principal')` : Bix visible (afficher terminées) ; `user.keyboard` focus rangée Bix puis `e` → toast archive / `session.archive` vu par le mock. Clic « … » Otto → menu.
  - `it('Archiver next to +N finished archives every finished principal of that group')` : clic Archiver à côté de `+1 finished` → Bix archivé (disparaît de l'arbre, apparaît aux Archives une fois la tâche 8 là ; pour l'instant assert `session.archive` id Bix).
  - `it('a machine without daemon.archive sends nothing')` : boot **sans** `archive: true` ; E sur Bix → aucun `session.archive`.

- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/sidebar-manage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** les handlers. Terminal : `void openSessionTerminal(client, s)` (comme le menu). Sous-agent : pas de E / Suppr / archive.
- [ ] **Step 4: Run** le test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): archive and delete from the sidebar tree`

### Task 8: Archives

**Files:**
- Create: `apps/desktop/src/shell/sidebar/Archives.tsx`
- Modify: `apps/desktop/src/shell/sidebar/Sidebar.tsx`
- Modify: `apps/desktop/src/shell/TopBar.tsx` — pastille « Archivée » cliquable → `onRevealArchives()`
- Modify: `apps/desktop/src/App.tsx` — `const [revealArchives, setRevealArchives] = useState(0)` (idem `revealCurrent`)
- Test: `apps/desktop/test/sidebar-archives.test.tsx`

**Interfaces:**
- Consumes: `FleetView.archived` (déjà plus récente d'abord), `filterArchived`, `actions.restore` / `resume` / `request('delete', [id])`, `isArchived`.
- Produces:

```ts
export function Archives(p: {
  archived: readonly Session[];
  current: string | null;
  projectName: (s: Session) => string;
  reveal: number;
  onRead(id: string): void;
  onRestore(id: string): void;
  onResume(id: string): void;
  onDelete(ids: string[]): void;
  allowed(id: string): boolean;
  paused: boolean;
}): JSX.Element
```

Repliée par défaut. `reveal` ou `archived.some(s => s.id === current)` → ouverte + scroll. Filtre si `archived.length > 4`. Pas de `<select>` auto. Rangée : bot (état done), pastille projet + nom, tâche, délai depuis `archivedAt` (`spanOf`), kids, actions Remettre / Reprendre / Supprimer (`disabled` si `!allowed`). Clic rangée → `onRead` (`dispatch({ type: 'open', id })`).

TopBar : la pastille `archived-pill` devient un bouton `onClick={() => onRevealArchives?.()}` si fourni.

- [ ] **Step 1: Write the failing tests**

  - `it('archives fold away; opening one reads it and unfolds the section')` : upsert une session `archivedAt` ; section Archives compte 1 ; fermée (pas de bouton Relire) ; clic toggle → rangée ; clic rangée → page + bandeau « Archived session » / « Session archivée ».
  - `it('Restore, Resume and Delete go through SessionActions')` : Remettre → `session.restore` ; Reprendre (session avec `agentSessionId`) → `session.resume` ; Supprimer → alertdialog.
  - `it('the Archived crumb unfolds the section')` : page déjà ouverte sur l'archive ; clic pastille header → `aria-expanded=true` et rangée dans le viewport (assert `aria-expanded` suffit).
  - `it('a filter appears past four archives')`.

- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/sidebar-archives.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** le test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): archived sessions live in the sidebar`

### Task 9: « À toi »

**Files:**
- Create: `apps/desktop/src/shell/sidebar/Attention.tsx`
- Modify: `apps/desktop/src/shell/sidebar/Sidebar.tsx`
- Modify: `apps/desktop/src/shell/sidebar/Sidebar.tsx` (effet Alt ↓, déjà prévu dans la maquette)
- Test: `apps/desktop/test/sidebar-attention.test.tsx`

**Interfaces:**
- Consumes: `attentionOf`, `decisions.decide`, `ProjectSwatch`.
- Produces:

```ts
export function Attention(p: {
  items: AttnItem[];
  current: string | null;
  projectOf: (s: Session) => { id: string; name: string } | null;
  onOpen(id: string, helper?: string, focus?: 'reply'): void;
  onDecide(s: Session, ok: boolean): void;
  paused: boolean;
}): JSX.Element
```

4 cartes max + « See the other N ». Alt ↓ (écouteur window, comme la maquette) : `onOpen` de `items[(i+1)%n]`. Oui → `decide(s, 'accept')` ; Non → `decide(s, 'deny')` ; Répondre → `onOpen(id, helperId, 'reply')` ; Voir (error) → `onOpen`. `onContextMenu` → menu du **principal** (`session.id`).

- [ ] **Step 1: Write the failing tests** (`listSessions`) :

  - `it('Your turn lists Otto then Kit; Yes sends allow; Reply opens Kit on the field')` : section « Your turn », badge 2 ; Oui sur Otto → `d.received` contient `{ type: 'session.decide', id: otto.id, decision: 'accept', expect: { kind: 'permission', text: 'npm test', key: pendingKey(otto.pending) } }` (comme `list-actions.test.tsx`) ; Répondre Kit → textbox reply.
  - `it('Alt ↓ cycles the waiting sessions')` : Alt+ArrowDown → page Otto ; encore → Kit.
  - `it('a helper-routed request shows ↳ parent')` : Otto + helper Explore en attente → carte « Explore » / `↳ Otto`.

- [ ] **Step 2: Run** `pnpm --filter desktop exec vitest run test/sidebar-attention.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**. Ctrl ⇧ E : focus `[data-tree-key]` de la session ouverte, sinon la première (écouteur dans Sidebar).
- [ ] **Step 4: Run** le test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): Your turn sits at the top of the sidebar`

### Task 10: Raccrocher les tests existants de la sidebar

**Files:**
- Modify: tout test qui clique `Chat Ledge` **dans** `complementary` sidebar, ou qui attend une rangée projet `side-row` / « 2 agents » sur une machine comme seul contenu.
- Known : `apps/desktop/test/app.test.tsx` (machine « 2 agents » → chip `Local` + `2`), `chat.test.tsx`, `settings-general.test.tsx`, `keys.test.tsx`, `helpers.ts` `boot` (attend encore le bouton du dernier projet — l'arbre le garde).

**Interfaces:** aucune.

- [ ] **Step 1: Run** `pnpm --filter desktop test`. Noter les échecs dont le message cite Sidebar / Chat Ledge / side-row / `.side-dots`.
- [ ] **Step 2:** Adapter chaque assertion à l'arbre (Atelier, nom de projet, chip machine, ask / titlebar pour le chat). Ne pas affaiblir : le même comportement, un autre sélecteur.
- [ ] **Step 3: Run** `pnpm --filter desktop test`. Expected: PASS (sauf tests Liste encore valides : ils restent verts tant que la Liste est là).
- [ ] **Step 4: Commit** `test(desktop): point the shell tests at the explorer sidebar`

---

## Partie C — retirer la Liste

### Task 11: Plus de vue Liste

**Files:**
- Modify: `apps/desktop/src/nav/state.ts` — `export type View = 'atelier'` ; `case 'view'` devient no-op ou disparaît ; `home.view` ignoré
- Modify: `apps/desktop/src/nav/overview.ts` — `view` toujours `'atelier'` ; une valeur `'list'` stockée se lit atelier
- Modify: `apps/desktop/src/shell/TopBar.tsx` — retirer `icon-tabs` Atelier / Liste
- Modify: `apps/desktop/src/App.tsx` — plus de `<List />` ; `view === 'atelier'` toujours
- Modify: `apps/desktop/src/atelier/ProjectTable.tsx` — `toList` → `dispatch({ type: 'home', project: id })` ; titre `t.atelier.moreTitle` → voir tous les agents **dans l'atelier** (mettre à jour fr/en : « Voir tous les agents du projet »)
- Modify: `apps/desktop/src/i18n/fr.ts` / `en.ts` — `shortcuts.rows` : retirer « F · Filtrer la liste » ; J/K « atelier » seulement ; `crumb.list` peut rester (inutilisé) ou partir
- Keep: `apps/desktop/src/list/time.ts`, `repoOf` / `bucketOf` dans `list/model.ts` (SessionPage, TitleBar, waits, ArchivedBanner, General). Ne pas supprimer `list/time.ts`.
- Delete UI only once les tests sont retargetés : `List.tsx`, `ListRow.tsx`, `ListGroup.tsx`, `ListToolbar.tsx`, `list/prefs.ts` — **après** la mise à jour des tests (étape 3).
- Test: `apps/desktop/test/nav-state.test.ts`, `shell.test.tsx`, `atelier.test.tsx`, `atelier-table.test.tsx`, `project-delete.test.tsx`, `session-messages.test.tsx`, `helpers.ts` (`list` option → no-op ou retiré)
- Test delete: `list.test.tsx`, `list-keys.test.tsx` (la UI Liste n'existe plus). **Garder** dans `list-model.test.ts` les tests de `spanOf` / `whenOf` / `trackWaits` / `repoOf` / `bucketOf` ; retirer ceux de `listModel` / `walkRows` / `quickActions` si ces fonctions partent avec `List.tsx`. Si `quickActions` n'est plus importé hors tests, le retirer de `model.ts`.
- E2E: `apps/desktop/e2e/list.spec.ts` → supprimer. `atelier.spec.ts` « +N opens the List » → « +N filters the atelier ». `session.spec.ts`, `session-review.spec.ts`, `shell.spec.ts` : ouvrir Otto via la sidebar (`getByRole('tree')` / bouton Otto) au lieu de l'onglet List.

**Interfaces:**
- Produces: `View = 'atelier'` uniquement. `NavAction` `view` : à supprimer ; tout `dispatch({ type: 'view', view: 'list' })` disparaît.

- [ ] **Step 1: Write / rewrite the failing tests**
  - `nav-state.test.ts` : `initialNav({ view: 'list', … })` → `place.view === 'atelier'` ; plus de `type: 'view'`.
  - `atelier-table.test.tsx` : `+N` dispatch `{ type: 'home', project: 'ledge' }` (plus `view: 'list'`).
  - `shell.test.tsx` / `atelier.test.tsx` : plus d'onglet List ; le boot avec `list: true` montre l'atelier.
  - Nouveau dans `sidebar-tree.test.tsx` ou `atelier-table` : `it('a stored list preference opens the atelier')`.

- [ ] **Step 2: Run** les tests touchés. Expected: FAIL (onglets encore là).
- [ ] **Step 3: Implement** le retrait. Mettre à jour e2e. Supprimer les fichiers UI Liste et `e2e/list.spec.ts`.
- [ ] **Step 4: Run** `pnpm --filter desktop test` et `pnpm --filter desktop e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): the atelier is the only overview; the list view is gone`

### Task 12: e2e de la sidebar

**Files:**
- Create: `apps/desktop/e2e/sidebar.spec.ts`
- Test helpers e2e existants (`fakeDaemon`)

**Interfaces:** aucune.

- [ ] **Step 1: Write**

```ts
test('open Otto from the tree, archive Bix from +N finished, reread him in Archives', async ({ page }) => {
  // fakeDaemon + sessions listSessions-like, archive: true
  await expect(page.getByRole('tree', { name: /Projects, branches and sessions/ })).toBeVisible();
  await page.getByRole('tree').getByRole('button', { name: /^Otto/ }).click();
  await expect(page.getByRole('banner').getByText('Otto')).toBeVisible();
  await page.getByRole('button', { name: /\+1 finished/ }).click();
  await page.getByRole('button', { name: /^Archive$/ }).click();
  await page.getByRole('button', { name: /Archives/ }).click();
  await page.getByRole('button', { name: /Reread Bix/ }).click();
  await expect(page.getByRole('status')).toContainText(/Archived session/);
});
```

Ajuster les noms au copy anglais réel et au `fakeDaemon` déjà utilisé dans `e2e/manage.spec.ts`.

- [ ] **Step 2: Run** `pnpm --filter desktop e2e -- sidebar.spec.ts`. Expected: FAIL puis, après le câblage (déjà fait), PASS.
- [ ] **Step 3:** Si un sélecteur pêche, le corriger ; ne pas élargir le scénario.
- [ ] **Step 4: Run** `pnpm --filter desktop test`, `pnpm --filter desktop e2e`, `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `test(desktop): the sidebar tree opens, archives and rereads a session`

---

## Après ce plan

Rien d'autre pour la sidebar. Le sélecteur de délai d'archivage attend un message daemon dédié. Les messages inter-agents ne portent pas de pastille ici (spec agent-messages).
