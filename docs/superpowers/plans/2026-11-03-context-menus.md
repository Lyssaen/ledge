# Context Menus (lot 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A right click anywhere in Desktop's sidebar opens a Ledge menu fitted to what was clicked (session, project, « No project », the Archives header, one archive) and never the webview's native menu.

**Architecture:** One hook, `useContextMenu`, replaces `useSessionMenu`. It holds a single open menu `{ target, at, opener }`, where `target` is a tagged union. The session target keeps rendering through `SessionMenuHost` (App, AtelierWindow). The four sidebar targets render inside `Sidebar` through a new `SidebarMenuHost`, because their fold actions need the fold state, which this plan lifts from `Tree` and `Archives` into `Sidebar`. Client only: no protocol or daemon change.

**Tech Stack:** React 19 + TypeScript strict, vitest + Testing Library (`apps/desktop/test`, full-app `boot()` from `test/helpers.ts`), Playwright (`apps/desktop/e2e`, fake daemon `e2e/daemon.ts`).

**Spec:** `docs/superpowers/specs/2026-11-03-context-menus-design.md`

## Global Constraints

- Branch `feat/context-menus`, worktree `.claude/worktrees/context-menus`; never push to `main`.
- Client only: no change under `packages/protocol`, `packages/daemon`, `packages/fleet`.
- Reuse `src/shell/Menu.tsx` (`Menu` with `at`, `MenuItem`): no second menu component.
- The session menu keeps its entries, shortcuts and disabled states everywhere it opens: tree, Attention, Atelier, the session page's « … », the detached Atelier window.
- Every new string in both `src/i18n/fr.ts` and `src/i18n/en.ts`.
- Unit tests: `cd apps/desktop && pnpm vitest run <file>`. E2E: `cd apps/desktop && pnpm exec playwright test <file>` (never `pnpm --filter @ledge/desktop`: false green).
- Commits in English, `feat(desktop): …` / `refactor(desktop): …` / `test(desktop): …`.

## Review Focus

1. The target disappears while its menu is open (project deleted elsewhere, archive deleted by another client, session removed): the menu closes, nothing acts on a stale id. Pinned in Task 1.
2. « Delete all » with some archives on a machine whose daemon cannot archive: those are left out, the item says how many, and with none deletable it is disabled. Pinned in Task 5.
3. The Archives filter narrows the list: « Delete all » / « Restore all » still act on every archive, not only the shown ones. Pinned in Task 5.
4. A right click in a sidebar text field (archive filter, search) keeps the native menu for copy/paste. Pinned in Task 6.
5. A right click on a second target while a menu is open replaces it (one menu at a time), and Escape gives the focus back to the row that opened it. Pinned in Task 4.

---

### Task 1: `useContextMenu` replaces `useSessionMenu`

**Files:**
- Create: `apps/desktop/src/manage/useContextMenu.ts` (moved from `useSessionMenu.ts`, which is deleted)
- Modify: `apps/desktop/src/manage/SessionMenu.tsx` (`SessionMenuHost`), `apps/desktop/src/App.tsx:53-54,204,304,310-319,328,357`, `apps/desktop/src/atelier/AtelierWindow.tsx:22-23,78-98`, `apps/desktop/src/atelier/Atelier.tsx:103,115,133-134,167`
- Test: `apps/desktop/test/menu.test.tsx` (its `useSessionMenu` cases move to `useContextMenu`)

**Interfaces:**
- Produces:
  ```ts
  export type MenuTarget =
    | { kind: 'session'; id: string }
    | { kind: 'project'; id: string }
    | { kind: 'unassigned' }
    | { kind: 'archives' }
    | { kind: 'archive'; id: string };
  export interface ContextMenuOpen { target: MenuTarget; at: { x: number; y: number }; opener: HTMLElement | null }
  export interface ContextMenuState {
    menu: ContextMenuOpen | null;
    /** The session of a `session` target while it is still listed, else null. */
    session: Session | null;
    renaming: Session | null;
    /** Shorthand for a session target (the existing callers keep it). */
    open(id: string, at: { x: number; y: number }, opener: HTMLElement | null): void;
    openOn(target: MenuTarget, at: { x: number; y: number }, opener: HTMLElement | null): void;
    close(): void;
    terminal(s: Session): void; rename(s: Session): void; closeRename(): void; sendRename(topic: string): void;
  }
  export function useContextMenu(o: { client: DaemonClient; sessions: readonly Session[]; archived: readonly Session[]; projects: readonly Project[]; onShowTerminal(id: string): void }): ContextMenuState;
  ```
- `close()` keeps today's focus rule (back to `opener` when the focus is on `body` or inside `[role=menu]`).
- A target that no longer exists closes the menu: `session` not in `sessions`, `archive` not in `archived`, `project` not in `projects`.
- Callers that read `menu.menu?.id` (Atelier's `menuId`, SessionPage's `manage.open`) read `menu.menu?.target.kind === 'session' ? menu.menu.target.id : null`.

- [ ] **Step 1: Write the failing tests** in `test/menu.test.tsx`, `describe('useContextMenu')`:
  - `it('open(id) is a session target; openOn holds any target; one at a time')`: `open('otto', …)` → `menu.target` is `{ kind: 'session', id: 'otto' }` and `session.id === 'otto'`. Then `openOn({ kind: 'archives' }, …)` → `menu.target` is `{ kind: 'archives' }` and `session` is null.
  - `it('closes when its target goes away')`: three cases, one per kind. A `project` target, rerendered with `projects: []` → `menu` is null. Same for an `archive` target with `archived: []`, and for a `session` target with `sessions: []`.
  - Keep the existing `useSessionMenu` cases, renamed to the new hook.
- [ ] **Step 2: Run** `pnpm vitest run test/menu.test.tsx`. Expected: FAIL, `useContextMenu` is not exported.
- [ ] **Step 3: Implement `useContextMenu`** in `src/manage/useContextMenu.ts` and delete `useSessionMenu.ts`. Then switch `App`, `AtelierWindow`, `Atelier` and `SessionMenuHost` (prop `state: ContextMenuState`; it renders only when `menu.target.kind === 'session'`) to it. `Sidebar`'s `menu` prop keeps its shape for now (Task 4 widens it).
- [ ] **Step 4: Run** `pnpm vitest run test/menu.test.tsx test/atelier-manage.test.tsx test/sidebar-manage.test.tsx test/sidebar-attention.test.tsx test/handover.test.tsx`, then `pnpm exec tsc --noEmit -p .`. Expected: PASS, no type error.
- [ ] **Step 5: Commit** `refactor(desktop): one context menu state for every target`

### Task 2: Lift the fold state of the tree and the Archives into `Sidebar`

**Files:**
- Modify: `apps/desktop/src/shell/sidebar/Tree.tsx`, `apps/desktop/src/shell/sidebar/Archives.tsx`, `apps/desktop/src/shell/sidebar/Sidebar.tsx`
- Test: `apps/desktop/test/sidebar-tree.test.tsx`, `apps/desktop/test/sidebar-archives.test.tsx` (unchanged; they must stay green)

**Interfaces:**
- Produces:
  - Tree props: `closed: ReadonlySet<string>; onClosed(next: Set<string>): void`. The keys stay `p:<id|none>` and `p:<id>:<branch>`. Export `projectKey(id: string | null): string` from `Tree.tsx`.
  - Archives props: `open: boolean; onOpenChange(open: boolean): void`. The `reveal` and « reading an archive » effects call `onOpenChange(true)`.
  - `Sidebar` holds `const [closed, setClosed] = useState<Set<string>>(new Set())` and `const [archivesOpen, setArchivesOpen] = useState(false)`.

- [ ] **Step 1: Make `Tree` and `Archives` controlled** as above. This is a pure refactor with no behaviour change.
- [ ] **Step 2: Run** `pnpm vitest run test/sidebar-tree.test.tsx test/sidebar-archives.test.tsx test/sidebar.test.tsx`. Expected: PASS, with no test edited.
- [ ] **Step 3: Commit** `refactor(desktop): the sidebar owns what is folded`

### Task 3: « Add a folder… » opens the project editor on the folder browser

**Files:**
- Modify: `apps/desktop/src/nav/state.ts:32` (`{ kind: 'project'; edit?: string; …; addFolder?: true }`), `apps/desktop/src/App.tsx:349` (pass it, and add it to the dialog's `key`), `apps/desktop/src/projects/ProjectDialog.tsx`, the `EditorPlace` in `projects/lazy.tsx` if it forwards props, `apps/desktop/src/projects/ProjectEditor.tsx:84`
- Test: `apps/desktop/test/project-editor.test.tsx`

**Interfaces:**
- Produces: `ProjectDialog` prop `addFolder?: boolean` and `ProjectEditor` prop `addFolder?: boolean`. The initial state becomes `useState(p.addFolder === true || (p.mode === 'new' && p.initial.repos.length === 0))`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**: `it('opened with addFolder on an existing project, the folder browser is open; without it, closed')`. Render `<ProjectDialog edit="ledge" addFolder …>` with `PROJECTS`. The folder browser's machine picker (`getByRole('radiogroup', { name: 'Machine to browse' })`) is present. Without `addFolder`, it is absent.
- [ ] **Step 2: Run** `pnpm vitest run test/project-editor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Thread `addFolder`** from the modal through `ProjectDialog` and `EditorPlace` to `ProjectEditor`'s initial `adding`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): open the project editor on its folder browser`

### Task 4: Project and « No project » menus

**Files:**
- Create: `apps/desktop/src/shell/sidebar/SidebarMenus.tsx` (`SidebarMenuHost` plus one component per target)
- Modify: `apps/desktop/src/shell/sidebar/Tree.tsx` (project row: `onContextMenu`; keyboard), `apps/desktop/src/shell/sidebar/Sidebar.tsx` (prop `menu: ContextMenuState`; renders `SidebarMenuHost`), `apps/desktop/src/App.tsx:310` (pass the state), `src/i18n/fr.ts`, `src/i18n/en.ts`
- Test: create `apps/desktop/test/sidebar-context-menus.test.tsx`

**Interfaces:**
- Consumes: `ContextMenuState`, `MenuTarget` (Task 1); `closed`, `setClosed`, `projectKey` (Task 2); modal `addFolder` (Task 3).
- Produces:
  - `SidebarMenuHost(p: { state: ContextMenuState; projects: Projects | null; groups: ProjectGroup[]; archived: readonly Session[]; actions: SessionActions; dispatch(a: NavAction): void; broadcast: boolean; closed: ReadonlySet<string>; onClosed(n: Set<string>): void; archivesOpen: boolean; onArchivesOpen(o: boolean): void; notify(text: string): void }): JSX.Element | null`. It renders for every target but `session`.
  - Tree prop `onMenu(target: MenuTarget, at: { x: number; y: number }, opener: HTMLElement | null): void`. It replaces `onMenu(id, e)`; a session row passes `{ kind: 'session', id }`.
  - `menuPoint(e: MouseEvent | KeyboardEvent, el: HTMLElement): { x: number; y: number }`, exported from `SidebarMenus.tsx`. A pointer event gives its client point. A keyboard event, or a pointer event at (0, 0), gives `{ x: rect.left, y: rect.bottom + 4 }`, as in `Atelier.menuAt`.
  - i18n `t.side.ctx`:

    | key | en | fr |
    |---|---|---|
    | `label(name)` | `Actions for ${name}` | `Actions pour ${name}` |
    | `newHere` | `New session here` | `Nouvelle session ici` |
    | `broadcast` | `Write to the whole project…` | `Écrire à tout le projet…` |
    | `addFolder` | `Add a folder…` | `Ajouter un dossier…` |
    | `edit` | `Edit project…` | `Modifier le projet…` |
    | `fold` | `Fold` | `Replier` |
    | `unfold` | `Unfold` | `Déplier` |
    | `deleteProject` | `Delete project…` | `Supprimer le projet…` |
    | `newSession` | `New session…` | `Nouvelle session…` |
    | `newProject` | `New project…` | `Nouveau projet…` |
- Project menu, in this order:
  1. `newHere` → `dispatch({ type: 'modal', modal: { kind: 'launch', project: id } })`
  2. `broadcast`, only if `broadcast` → `modal: { kind: 'broadcast', to: { project: id } }`
  3. `addFolder` → `modal: { kind: 'project', edit: id, addFolder: true }`
  4. `edit` → `modal: { kind: 'project', edit: id }`
  5. `fold` / `unfold`, only if the group has sessions → toggles `projectKey(id)`
  6. `<hr/>`, then `deleteProject` (class `danger`) → `modal: { kind: 'project', edit: id, delete: true }`

  The menu head shows the project's swatch and name (the `session-menu-head` style).
- « No project » menu:
  1. `newSession` → `modal: { kind: 'launch' }`
  2. `newProject` → `modal: { kind: 'project' }`
  3. `fold` / `unfold` → toggles `projectKey(null)`
- Keyboard: in `Tree.onTreeKey`, `e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')` on a project row or a session row opens its menu under the row.

- [ ] **Step 1: Write the failing tests** in `test/sidebar-context-menus.test.tsx`. Use `boot({ projects: PROJECTS, sessions: listSessions(), daemon: CAN })` and `fireEvent.contextMenu` on the row.
  - `it('right click on a project lists New session here, Write to the whole project…, Add a folder…, Edit project…, Fold, Delete project…')`: assert `menuLabels(menu)` equals exactly that array.
  - `it('New session here opens the launcher on that project')`: the launch dialog shows the project selected.
  - `it('Add a folder… opens the editor of that project on its folder browser')`.
  - `it('Fold folds the project; the menu then says Unfold')`.
  - `it('Delete project… opens the editor on its deletion view')`: the dialog title is `Delete ${name}`.
  - `it('right click on No project lists New session…, New project…, Fold')`.
  - `it('the native menu is prevented on a project row')`: `fireEvent.contextMenu` returns `false`.
  - Review Focus 5: `it('a right click on a project while a session menu is open replaces it; Escape gives the focus back to the project row')`.
  - `it('Shift+F10 on a focused project row opens its menu')`.
- [ ] **Step 2: Run** `pnpm vitest run test/sidebar-context-menus.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `SidebarMenus.tsx`, the i18n keys, and the Tree and Sidebar wiring described above.
- [ ] **Step 4: Run** `pnpm vitest run test/sidebar-context-menus.test.tsx test/sidebar-manage.test.tsx test/sidebar-tree.test.tsx test/i18nNotch.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): right click on a project or No project`

### Task 5: Archives header and archive row menus

**Files:**
- Modify: `apps/desktop/src/shell/sidebar/SidebarMenus.tsx`, `apps/desktop/src/shell/sidebar/Archives.tsx` (prop `onMenu(target, at, opener)`; `onContextMenu` on the header toggle and on each row; keyboard as in Task 4), `src/i18n/fr.ts`, `src/i18n/en.ts`
- Test: `apps/desktop/test/sidebar-context-menus.test.tsx`

**Interfaces:**
- Consumes: Task 4's `SidebarMenuHost` and `menuPoint`; `actions.request('delete', ids)`, `actions.restore(id)`, `actions.resume(id)`, `actions.allowed(id)`.
- Produces: i18n `t.side.ctx`, continued:

  | key | en | fr |
  |---|---|---|
  | `deleteAll(n)` | `Delete all (${n})…` | `Tout supprimer (${n})…` |
  | `skipped(k)` | `${k} kept: their machine must update Ledge` | `${k} gardée(s) : leur machine doit mettre Ledge à jour` |
  | `restoreAll` | `Restore all` | `Tout restaurer` |
  | `restoredAll(n)` | `${n} sessions put back at their table.` | `${n} sessions remises à leur table.` |
  | `read` | `Read` | `Lire` |

  `skipped` is a `<small>` under the item, and the plural agrees in French. Restore, Resume and Delete reuse `t.manage.archivedBanner.restore`, `t.manage.menu.resume` and `t.manage.archivedBanner.delete`.
- Archives menu:
  - `deleteAll(n)` (danger) → `actions.request('delete', ok)`, where `ok = archived.filter(s => actions.allowed(s.id)).map(s => s.id)` and `n = ok.length`. Disabled when `n === 0`.
  - `restoreAll` → `actions.restore(id)` for each id of `ok`, then a single `notify(restoredAll(n))`. Disabled when `n === 0`.
  - `fold` / `unfold` → `onArchivesOpen`.
- Archive row menu: `read` → `dispatch({ type: 'open', id })`, then Restore, Resume, `<hr/>`, Delete (danger), each disabled when `!actions.allowed(id)`, as the hover buttons are.

- [ ] **Step 1: Write the failing tests**:
  - `it('right click on Archives: Delete all (2)… asks once for the two, confirmed sends two session.delete')`.
  - Review Focus 2: `it('an archive on a machine that cannot archive is left out: Delete all (1)…, and 1 kept is said')`. Use two machines, the way `sidebar-archives.test.tsx` builds a machine without `archive`.
  - `it('with no allowed archive, Delete all and Restore all are disabled')`.
  - Review Focus 3: `it('the filter shows one of five archives; Delete all (5)… still asks for the five')`.
  - `it('Restore all sends one session.restore per archive and says it once')`.
  - `it('right click on an archive row: Read, Restore, Resume, Delete; Read opens it')`.
  - Review Focus 1: `it('an archive deleted elsewhere while its menu is open closes the menu')`. Use `act(() => d.remove(id))`, or the mock's equivalent.
- [ ] **Step 2: Run** `pnpm vitest run test/sidebar-context-menus.test.tsx`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the two menus and the `Archives` wiring.
- [ ] **Step 4: Run** `pnpm vitest run test/sidebar-context-menus.test.tsx test/sidebar-archives.test.tsx test/i18nNotch.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): right click on the Archives and on an archive`

### Task 6: No native menu in the sidebar; Rigs sessions get the session menu

**Files:**
- Modify: `apps/desktop/src/shell/sidebar/Sidebar.tsx` (the `<aside>`), `apps/desktop/src/shell/sidebar/RigGroups.tsx:51-55` (prop `onMenu`, `onContextMenu` on `row`)
- Test: `apps/desktop/test/sidebar-context-menus.test.tsx`, `apps/desktop/test/sidebar-rigs.test.tsx`

**Interfaces:**
- Consumes: `ContextMenuState.open` (Task 1).
- Produces: `onContextMenu` on the sidebar's `<aside>`. It calls `e.preventDefault()` unless `e.target` is inside `input, textarea, [contenteditable="true"]`. Rows that open a menu still handle the event first.

- [ ] **Step 1: Write the failing tests**:
  - `it('a right click on an empty place of the sidebar opens nothing and prevents the native menu')`: `fireEvent.contextMenu(side.getByRole('region', { name: 'Archives' }).parentElement!)` returns `false`, and there is no `menu` role.
  - Review Focus 4: `it('a right click in the archive filter keeps the native menu')`. With five archives, open the section; `fireEvent.contextMenu` on the filter input returns `true`.
  - In `sidebar-rigs.test.tsx`: `it('a right click on a rig seat opens its session menu')`.
- [ ] **Step 2: Run** `pnpm vitest run test/sidebar-context-menus.test.tsx test/sidebar-rigs.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** both changes.
- [ ] **Step 4: Run** the same command plus `test/sidebar.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): no webview menu in the sidebar; rig seats get theirs`

### Task 7: End-to-end journeys and full gate

**Files:**
- Create: `apps/desktop/e2e/context-menus.spec.ts`

**Interfaces:**
- Consumes: `fakeDaemon`, `session`, `twoProjects`, `openAtelier` from `e2e/daemon.ts`; `daemon.remove(id)` to stand for the daemon's answer to `session.delete`.

- [ ] **Step 1: Write the tests**:
  - `test('right click a project › Add a folder…: the editor of that project opens on the folder browser')`.
  - `test('right click Archives › Delete all (2)… › confirm: two session.delete are sent and, once removed, the Archives are empty')`. Poll `daemon.received` for the two `session.delete`, then call `daemon.remove` for each.
- [ ] **Step 2: Run** `cd apps/desktop && pnpm exec playwright test e2e/context-menus.spec.ts e2e/sidebar.spec.ts e2e/manage.spec.ts`. Expected: PASS. `e2e/atelier.spec.ts:113` is known flaky on `main`; ignore it only if it also fails on `main`.
- [ ] **Step 3: Run the full desktop unit suite** `cd apps/desktop && pnpm vitest run` and `pnpm exec tsc --noEmit -p .`. Expected: PASS. Rerun a timing failure alone before blaming the branch.
- [ ] **Step 4: Commit** `test(desktop): context menu journeys`
