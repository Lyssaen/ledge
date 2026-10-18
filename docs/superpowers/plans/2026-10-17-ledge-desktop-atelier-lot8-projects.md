# Ledge Desktop Atelier, lot 8 : Projets dans l'app — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'éditeur de projets de la maquette, sur le vrai daemon :
- nom, couleur parmi 8, description, et dépôts. Un dépôt est une machine plus un chemin, avec sa branche détectée ou « Dossier sans Git » ;
- un explorateur de dossiers par machine (dépôts Git marqués, machine hors ligne grisée), ou un chemin tapé ;
- la validation : nom vide ou déjà pris, dépôt en double, chemin introuvable ;
- la suppression : elle dit ce que deviennent les agents et les règles, avec « Sans projet » ou « Déplacer vers… » ;
- « Ranger dans… › Nouveau projet… ».

**Architecture:**
- **Daemon** : `folder.list` / `folder.listing` apprennent la machine visée (`machineId`, routée par le fleet), une corrélation (`requestId`), et les dépôts Git d'un dossier avec leur branche (`repos`).
- **Desktop** :
  - un modèle pur `src/projects/draft.ts` : brouillon, problèmes, état après l'enregistrement ou la suppression, confirmation ;
  - l'explorateur `FolderPicker` (avec `useFolderListing`), l'éditeur `ProjectEditor` et le composant `ProjectSwatch`, tous dans `src/projects/` ;
  - le branchement de la fenêtre `{ kind: 'project', edit?, file? }`.
- **Enregistrer et supprimer** passent par `fleet.setProjects` avec les aides du lot 2 (`withProject`, `withoutProject`, `withRule`, `newProjectId`). Rien n'est optimiste : l'éditeur attend la diffusion `projects` qui contient le changement, comme le rangement du lot 4.

**Tech Stack:** TypeScript, zod, Node (daemon), React 19, Vite 6, vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:**
- `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md`, à trois endroits :
  - § 5 : les projets dans le daemon local. La validation du nom et du dépôt en double est faite par le daemon local ; le chemin introuvable et la branche sont vérifiés par le daemon de la machine du dépôt ;
  - § 6 : l'explorateur marque les dépôts Git et donne leur branche ;
  - § 7, lot 8.
- Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` § 6 (« Projets ») et § 2.3 (« Ranger dans… », dont « Nouveau projet… »).
- Maquette : `docs/mockups/desktop-observatory/projects.tsx` (`FolderPicker`, `ProjectEditor`) et `projects.css` ; dans `observatory.tsx` : `newProject`, `editProject`, `saveProject`, `deleteProject`, et le « Nouveau projet… » de « Ranger dans… ».

**Hors de ce lot :**
- « Laisser Ledge faire », « Demander à Ledge » et les propositions viennent au lot 11 : leurs boutons ne sont pas rendus.
- Réglages › Projets vient au lot 10.

## Global Constraints

- Celles des lots 6a, 6b et 7, toutes :
  - la maquette fait foi ;
  - les textes sont dans `messages.ts`, `fr` est la source de vérité, et l'anglais fixé par les tests est listé par tâche ;
  - rien d'optimiste ;
  - aucune nouvelle dépendance ;
  - pas de Tauri ni de Rust ;
  - la suite unitaire est en anglais ;
  - les commits se terminent par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Un projet garde son id** : renommer ne change pas l'id, qui tire les plantes et les places. Un nouveau projet prend `newProjectId(nom, ids existants)`.
- **Les couleurs** sont les 8 clés de `PROJECT_COLORS`, dans l'ordre de la maquette :
  - fr : Bleu, Vert, Ambre, Violet, Sarcelle, Rose, Rouge, Ardoise ;
  - en : Blue, Green, Amber, Violet, Teal, Pink, Red, Slate.

  Un nouveau projet prend la première couleur qu'aucun projet n'utilise, sinon `blue`.
- **Validation** :
  - nom : vide, ou déjà pris par un autre projet (sans tenir compte de la casse ni des accents, comme `projectsProblems`) ;
  - dépôt : déjà dans la liste (même machine et même chemin) ;
  - chemin tapé : introuvable sur sa machine (`repos.inspect`, lot 7), ou machine hors ligne.

  Un dépôt qui appartient aussi à un autre projet est permis, avec l'avertissement « Aussi dans {projet} » (maquette).
- **Rien d'optimiste** : « Créer le projet » ou « Enregistrer » envoie `setProjects`, puis l'éditeur reste ouvert (bouton « Enregistrement… ») jusqu'à la diffusion `projects` qui contient le changement. Un refus (`DaemonOffline`, `DaemonOutdated`, schéma) ou 8 s de silence s'affichent dans l'éditeur. Même règle pour la suppression.
- **Supprimer** suit `withoutProject` du lot 2 : avec « Déplacer vers… », les dépôts et les règles du projet supprimé passent au projet choisi, donc ses agents le rejoignent ; avec « Sans projet », ils partent, et les agents se retrouvent « Sans projet ». Le texte de confirmation le dit, et rien d'autre.

## Review Focus

1. **Un enregistrement que le daemon refuse** (daemon hors ligne ou trop ancien, nom pris par un autre client entre-temps) : l'éditeur reste ouvert avec le message, les valeurs restent, et rien ne change dans l'atelier. Test à la tâche 4.
2. **Un chemin tapé sur une machine hors ligne, introuvable, ou déjà listé** : l'erreur nommée s'affiche sous le champ, rien n'est ajouté, et le champ garde le texte. Test à la tâche 3.
3. **Supprimer le projet du filtre courant**, ou celui de la session ouverte : le filtre repasse à « Tous », la page de session reste ouverte (l'agent passe à « Sans projet » ou rejoint le projet choisi), et rien ne casse. Test à la tâche 5.
4. **Un projet supprimé ailleurs pendant qu'on le modifie** : « Enregistrer » dit que le projet n'existe plus au lieu de le recréer. Test à la tâche 4.
5. **Renommer un projet** garde son id, donc ses plantes, ses places et ses règles. Test à la tâche 2.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/protocol/src/messages.ts`, `packages/ledge/src/daemon/folders.ts` | `folder.list` avec `machineId` et `requestId` ; `folder.listing` avec `requestId` et `repos` |
| `packages/fleet/src/fleet.ts`, `packages/fleet/test/mockDaemon.ts` | Routage de l'explorateur ; faux daemon |
| `apps/desktop/src/projects/{draft.ts,useFolderListing.ts,FolderPicker.tsx,ProjectEditor.tsx,ProjectSwatch.tsx,useProjectSave.ts}` | Nouveaux |
| `apps/desktop/src/styles/projects.css` | Porté de la maquette (éditeur et explorateur ; pas les propositions ni Réglages) |
| `apps/desktop/src/{App.tsx,i18n/messages.ts}`, les pastilles existantes (`atelier/`, `session/AgentsRail.tsx`, `shell/TopBar.tsx`, `shell/Sidebar.tsx`, `launch/`) | Branchement, textes, `ProjectSwatch` |
| `apps/desktop/e2e/{daemon.ts,projects.spec.ts}` | Faux daemon et scénarios |

---

### Task 1: L'explorateur de dossiers du daemon connaît la machine et les dépôts Git

**Files:**
- Modify: `packages/protocol/src/messages.ts`, `packages/ledge/src/daemon/folders.ts`, `packages/ledge/src/daemon/server.ts`, `packages/fleet/src/fleet.ts`, `packages/fleet/test/mockDaemon.ts`, et leurs tests

**Interfaces:**
- Produces :

```ts
// folder.list gagne
machineId: z.string().optional(), requestId: z.string().min(1).max(100).optional()
// folder.listing gagne
requestId: z.string().optional(),
repos: z.array(z.object({ name: z.string(), branch: z.string() })).optional()   // les sous-dossiers qui sont des dépôts Git, avec leur branche
// ledge/daemon/folders.ts
export async function gitBranchOf(dir: string): Promise<string | null>;
```

Règles :
- `gitBranchOf` lit `<dir>/.git/HEAD` sans lancer git :
  - `ref: refs/heads/<b>` donne `<b>` ;
  - un SHA donne ses 7 premiers caractères ;
  - quand `.git` est un fichier (worktree, sous-module), il délègue à `inspectRepos([dir])` du lot 7 ;
  - pas de `.git` : `null`.
- `listFolder` renvoie `repos` pour les entrées qui ont une branche (dans l'ordre des entrées), et recopie `requestId` quand il est fourni. `createFolder` aussi.
- **Fleet** :
  - `folder.list` avec `machineId` va à cette machine, sans `machineId`. La mémoire `requestId → machine` (comme `repos.inspect` au lot 7) relaie le `folder.listing` qui porte ce `requestId`, et seulement depuis cette machine ;
  - une machine hors ligne répond `folder.listing { requestId, path, parent: null, entries: [], error: 'offline' }` ;
  - sans `requestId`, le comportement d'aujourd'hui (machine choisie, `emit` si `machine === selected`) ne change pas, et l'overlay non plus.
- Le faux daemon du fleet répond à `folder.list` depuis `folders: Map<string, { entries: string[]; repos?: { name: string; branch: string }[] }>`, avec `error: 'not found'` pour un chemin inconnu.
- **`repos.inspect` (reporté du lot 7)** : `inspectRepos` lance au plus 8 git à la fois, et un HEAD détaché ne dépasse pas 2 s au total pour un chemin. Rappel : `repos.info` renvoie chaque chemin tel qu'il a été demandé (correctif du lot 7).

- [ ] **Step 1: Écrire les tests**
  - Daemon (`folders.test.ts` ou `server.test.ts`) :
    - un dossier temporaire qui contient un dépôt `git init -b trunk`, un dossier simple, et un dépôt au HEAD détaché : `repos` vaut `[{ name: 'repo', branch: 'trunk' }, { name: 'detached', branch: <7 caractères> }]` ;
    - `requestId` est recopié.
  - Fleet :
    - un `folder.list { machineId: 'nas', requestId }` arrive à nas sans `machineId`, et sa réponse revient ;
    - nas hors ligne donne la réponse `error: 'offline'` ;
    - un `folder.listing` d'une autre machine ou avec un autre `requestId` n'est pas relayé ;
    - sans `requestId`, l'ancien comportement reste.
- [ ] **Step 2: Vérifier qu'ils échouent** — `pnpm --filter @paradow/ledge exec vitest run test/folders.test.ts && pnpm --filter @ledge/fleet test`. Expected : FAIL.
- [ ] **Step 3: Implémenter**
- [ ] **Step 4: Vérifier** — paquet par paquet : `pnpm --filter @ledge/protocol test`, `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/fleet test`, `pnpm --filter overlay test`, `pnpm -r typecheck`. Expected : tout passe. L'échec connu de l'overlay, « drafts survive… », doit être signalé s'il apparaît.
- [ ] **Step 5: Commit** — `feat(daemon): the folder browser names Git repositories with their branch and answers the machine and request that asked`

### Task 2: Le modèle de l'éditeur

**Files:**
- Create: `apps/desktop/src/projects/draft.ts`, `apps/desktop/test/projects-draft.test.ts`

**Interfaces:**
- Consumes : `Project`, `Projects`, `Repo`, `Rule`, `Session`, `PROJECT_COLORS`, `ProjectColor`, `projectsProblems` (`@ledge/protocol`) ; `withProject`, `withoutProject`, `withRule`, `newProjectId` (`@ledge/fleet`) ; `ruleFor` (`atelier/filing.ts`).
- Produces :

```ts
export const COLOR_ORDER: readonly ProjectColor[];   // blue, green, amber, violet, teal, pink, red, slate
export interface ProjectDraft { id?: string; name: string; color: ProjectColor; description: string; repos: Repo[]; file: string[] }   // file : ids des sessions à ranger aussi (cochées)
export function draftOf(p: Project): ProjectDraft;
/** Un nouveau projet : la première couleur libre ; depuis « Ranger dans… › Nouveau projet… », le dossier de la session en dépôt et la session cochée. */
export function newDraft(state: Projects, from?: Session): ProjectDraft;
export type DraftProblem = { code: 'name_empty' } | { code: 'name_taken' } | { code: 'repo_duplicate'; index: number } | { code: 'gone' };
/** Le premier problème qui empêche d'enregistrer, dans cet ordre : gone (le projet modifié n'existe plus), name_empty, name_taken, repo_duplicate. */
export function draftProblem(d: ProjectDraft, state: Projects): DraftProblem | null;
/** Le projet qui possède aussi ce dépôt (autre que celui du brouillon), pour « Aussi dans … ». */
export function alsoIn(repo: Repo, d: ProjectDraft, state: Projects): Project | undefined;
/** L'état à envoyer : withProject (id gardé, ou newProjectId pour un nouveau), puis withRule pour chaque session de `file`. */
export function afterSave(state: Projects, d: ProjectDraft, sessions: readonly Session[]): { next: Projects; id: string };
/** Ce que la suppression fera : les agents de la table (projectIdOf) et le nombre de règles du projet. */
export function deletion(state: Projects, id: string, sessions: readonly Session[], projectIdOf: (s: Session) => string | null): { agents: Session[]; rules: number };
/** Confirmé quand l'état diffusé contient le projet tel qu'envoyé (enregistrer), ou ne contient plus `id` (supprimer). */
export function saved(state: Projects, sent: Project): boolean;
export function removed(state: Projects, id: string): boolean;
```

- [ ] **Step 1: Écrire les tests**

```ts
it('a new project takes the first unused colour; from a session, its folder and the session itself', () => {
  expect(newDraft({ projects: [p('a', 'blue'), p('b', 'green')], rules: [] }).color).toBe('amber');
  const otto = session({ id: 'local:otto', machineId: 'local', cwd: '/w/scratch/notes' });
  expect(newDraft(state, otto)).toMatchObject({ repos: [{ machine: 'local', path: '/w/scratch/notes' }], file: ['local:otto'], name: '' });
});
it('the first problem: gone, empty name, taken name (case and accents), duplicate repo', () => {
  expect(draftProblem({ ...draftOf(ledge), id: 'deleted' }, state)).toEqual({ code: 'gone' });
  expect(draftProblem({ ...newDraft(state), name: '  ' }, state)).toEqual({ code: 'name_empty' });
  expect(draftProblem({ ...newDraft(state), name: 'LÉDGE' }, state)).toEqual({ code: 'name_taken' });
  expect(draftProblem({ ...draftOf(ledge), name: 'Ledge' }, state)).toBeNull();   // its own name
  expect(draftProblem({ ...newDraft(state), name: 'X', repos: [r('local', '/a'), r('local', '/a')] }, state)).toEqual({ code: 'repo_duplicate', index: 1 });
});
it('saving keeps the id on rename, slugs a new one, and files the checked sessions', () => {
  expect(afterSave(state, { ...draftOf(ledge), name: 'Ledge Desktop' }, []).id).toBe('ledge');
  const { next, id } = afterSave(state, { ...newDraft(state, otto), name: 'Notes' }, [otto]);
  expect(id).toBe('notes');
  expect(next.rules).toContainEqual({ machine: 'local', path: '/w/scratch/notes', project: 'notes' });
});
it('deletion counts the agents at the table and the rules; confirmation reads the broadcast', () => {
  expect(deletion(state, 'ledge', sessions, s => projectOf(s, state))).toEqual({ agents: [ottoAtLedge, milo], rules: 1 });
  expect(saved(withProject(state, sent), sent)).toBe(true);
  expect(saved(state, sent)).toBe(false);
  expect(removed(withoutProject(state, 'ledge', null), 'ledge')).toBe(true);
});
```

- [ ] **Step 2: Vérifier qu'ils échouent** — `pnpm --filter desktop exec vitest run test/projects-draft.test.ts`. Expected : FAIL.
- [ ] **Step 3: Implémenter `draft.ts`** (fonctions pures). `saved` compare l'id, le nom, la couleur, la description et les dépôts, dans l'ordre.
- [ ] **Step 4: Vérifier** — même commande, puis `pnpm --filter desktop typecheck`. Expected : PASS.
- [ ] **Step 5: Commit** — `feat(desktop): the project editor's model: drafts, the first problem, saving and deleting through the lot 2 helpers, the broadcast that confirms`

### Task 3: L'explorateur de dossiers

**Files:**
- Create: `apps/desktop/src/projects/useFolderListing.ts`, `apps/desktop/src/projects/FolderPicker.tsx`, `apps/desktop/test/folder-picker.test.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâche 1 (`folder.list` / `folder.listing` avec `machineId`, `requestId`, `repos`) ; lot 7 (`useRepoInfo` ou `repos.inspect` directement, pour un chemin tapé) ; `MachineState` (« en ligne » = `status === 'open'`, comme au lot 7).
- Produces :

```ts
export type Listing = { status: 'loading' } | { status: 'ready'; path: string; parent: string | null; entries: string[]; repos: ReadonlyMap<string, string> } | { status: 'error'; message: string };
export function useFolderListing(client: DaemonClient, machine: string | null, path: string | undefined): Listing;   // un requestId par demande, l'ancienne réponse ignorée
export function FolderPicker(p: { client: DaemonClient; machines: readonly MachineState[]; taken(machine: string, path: string): boolean; onAdd(repo: Repo & { branch: string | null }): void }): JSX.Element;
```

Rendu (`FolderPicker` de la maquette, classes de `projects.css`) :
- Puces de machine (`radiogroup` « Machine à parcourir »). Une machine hors ligne est grisée avec « hors ligne », et la choisir montre `p.picker-offline`.
- Le fil d'Ariane, avec « racine » pour `/`. Le premier dossier ouvert est celui de l'accueil (`folder.list` sans chemin).
- La liste :
  - « Dossier parent » ;
  - pour chaque sous-dossier : l'icône branche et la classe `is-git` pour un dépôt Git, l'icône dossier sinon ; `span.picker-branch` vaut `⎇ {branche}` ou « sans Git » ;
  - un bouton « Ajouter » (`outline` pour un dépôt Git, `ghost` sinon) qui devient « Ajouté » quand le dépôt est déjà dans la liste.
- Contrairement à la maquette, le nom ouvre le dossier même s'il n'a pas de sous-dossier connu : le daemon ne compte pas les petits-enfants.
- Le chemin tapé est vérifié, dans cet ordre :
  1. machine hors ligne : `offlinePath` ;
  2. déjà dans la liste : `alreadyListed` ;
  3. `repos.inspect` dit `exists: false` : `notFound` ;
  4. sinon le dépôt est ajouté avec la branche que l'inspection a renvoyée.

  Le chemin est normalisé avec `normalizePath`. `~` est résolu par le daemon : l'explorateur affiche et envoie le chemin résolu par `folder.listing` (absolu, ce que `RepoSchema` exige). Un chemin tapé qui commence par `~` est refusé avec `absolute` (« Saisissez un chemin complet, qui commence par / »).

Textes (`projects.picker.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `machines` / `offline` / `offlineBody(m)` | `Machine à parcourir` / `hors ligne` / `${m} est hors ligne. Reconnectez-la dans Réglages › Machines pour parcourir ses dossiers.` | `Machine to browse` / `offline` / `${m} is offline. Reconnect it in Settings › Machines to browse its folders.` |
| `crumbs` / `root` / `parent` / `contents(d, m)` | `Dossier courant` / `racine` / `Dossier parent` / `Contenu de ${d} sur ${m}` | `Current folder` / `root` / `Parent folder` / `Contents of ${d} on ${m}` |
| `noGit` / `add` / `added` / `addLabel(n, m)` / `addedLabel(n)` | `sans Git` / `Ajouter` / `Ajouté` / `Ajouter ${n} (${m})` / `${n} déjà ajouté` | `no Git` / `Add` / `Added` / `Add ${n} (${m})` / `${n} already added` |
| `typed(m)` / `typedPlaceholder(m)` | `Chemin sur ${m}` / `Ou saisissez un chemin sur ${m}` | `Path on ${m}` / `Or type a path on ${m}` |
| `offlinePath(m)` / `notFound(m)` / `alreadyListed` / `absolute` | `${m} est hors ligne : impossible de vérifier ce chemin.` / `Dossier introuvable sur ${m}.` / `Ce dépôt est déjà dans la liste.` / `Saisissez un chemin complet, qui commence par /.` | `${m} is offline: this path cannot be checked.` / `Folder not found on ${m}.` / `This repository is already in the list.` / `Type a full path, starting with /.` |

- [ ] **Step 1: Écrire les tests** (le composant seul, monté avec le faux daemon du fleet et `folders`) :
  - la liste montre `⎇ main` sur un dépôt Git et « no Git » sur un dossier simple ;
  - ouvrir un dossier puis « Parent folder » revient ;
  - « Add » appelle `onAdd` avec la machine, le chemin et la branche ;
  - un dépôt déjà pris montre « Added » (désactivé) ;
  - une machine hors ligne montre le message, et un chemin tapé dessus donne l'erreur `offlinePath` ;
  - un chemin introuvable donne `notFound` ;
  - un chemin en double donne `alreadyListed` ;
  - un `~/x` donne `absolute` ;
  - dans chaque cas d'erreur, rien n'est ajouté et le champ garde le texte.
- [ ] **Step 2: Vérifier qu'ils échouent** — `pnpm --filter desktop exec vitest run test/folder-picker.test.tsx`. Expected : FAIL.
- [ ] **Step 3: Implémenter `useFolderListing`, `FolderPicker` et les textes**
- [ ] **Step 4: Vérifier** — même commande, puis `pnpm --filter desktop typecheck`. Expected : PASS.
- [ ] **Step 5: Commit** — `feat(desktop): the folder browser: machines, crumbs, Git repositories with their branch, a typed path checked on its machine`

### Task 4: L'éditeur de projets

**Files:**
- Create: `apps/desktop/src/projects/ProjectEditor.tsx`, `apps/desktop/src/projects/ProjectSwatch.tsx`, `apps/desktop/src/projects/useProjectSave.ts`, `apps/desktop/src/styles/projects.css`, `apps/desktop/test/project-editor.test.tsx`
- Modify: `apps/desktop/src/App.tsx` (la fenêtre `project` remplace le `Pending`), `apps/desktop/src/i18n/messages.ts`, les pastilles existantes (`<i className="side-swatch" style=…>` → `<ProjectSwatch project={…} />`)

**Interfaces:**
- Consumes : tâches 2 et 3 ; `fleet.setProjects` ; `FleetView` (`machines`, `sessions`) ; `projects` et `projectIdOf` de `App` ; `notify` ; `Modal`.
- Produces :

```ts
export function ProjectSwatch({ project }: { project: Pick<Project, 'color'> | null }): JSX.Element;   // .side-swatch à la couleur, ou la pastille « Sans projet » (filter-none) pour null
export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'refused'; reason: 'offline' | 'outdated' | 'invalid' | 'timeout' };
/** setProjects(next), puis attend `confirm(projects)` sur les diffusions (8 s) ; un seul envoi à la fois ; ignore ce qui arrive après reset. */
export function useProjectSave(fleet: Pick<Fleet, 'setProjects'>, projects: Projects | null): { state: SaveState; send(next: Projects, confirm: (p: Projects) => boolean, onDone: () => void): void; reset(): void };
export function ProjectEditor(p: { mode: 'new' | 'edit'; initial: ProjectDraft; projects: Projects; sessions: readonly Session[]; machines: readonly MachineState[];
  client: DaemonClient; fleet: Pick<Fleet, 'setProjects'>; projectIdOf(s: Session): string | null; onClose(): void; onSaved(id: string, created: boolean, filed: Session[]): void;
  onDeleted(id: string, moveTo: string | null, agents: number): void }): JSX.Element;
```

Rendu (`ProjectEditor` de la maquette, sans « Laisser Ledge faire », « Demander à Ledge » ni proposition) :
- **Identité** :
  - Nom : le focus à l'ouverture, `maxLength` 60, placeholder « Ex. Paper Rendering » ;
  - 8 couleurs (`radio` avec `aria-label` = nom de la couleur) ;
  - Description (facultatif, `maxLength` 120).
- **Dépôts de travail · n** (n = nombre de dépôts) : chaque dépôt montre son nom (dernier segment), sa machine avec son point, sa branche (`⎇ b`, avec le `title` « Branche par défaut détectée ») ou « Dossier sans Git », son chemin, « Aussi dans {projet} », et un bouton « Retirer ».
  - Les branches des dépôts déjà enregistrés viennent de `repos.inspect` sur leur machine.
  - Un dépôt d'une machine hors ligne montre « hors ligne » à la place de la branche.
  - Un dépôt `exists: false` montre « introuvable » (`set-warn`). Il reste enregistrable : le dossier peut revenir ou être sur une machine qu'on reconnecte.
- **Sans dépôt** : `p.pe-empty` « Aucun dépôt pour l'instant. Le projet peut exister sans, mais Ledge ne saura pas y ranger les sessions. »
- **« Ajouter un dépôt »** ouvre le `FolderPicker`. Pour un nouveau projet sans dépôt, il est ouvert d'emblée.
- **« Ranger aussi »** (depuis « Ranger dans… › Nouveau projet… ») : une puce cochable par session de `file`, avec son bot.
- **Pied de page** :
  - l'aperçu : la pastille, le nom (ou « Nouveau projet »), `n dépôt(s) sur machines`, et pour un nouveau projet « · la table apparaîtra avec la première session » ;
  - le problème (après une tentative), « Annuler », puis le bouton principal avec `Kbd Ctrl ↵` : « Créer le projet », « Enregistrer », ou « Enregistrement… » pendant l'envoi ;
  - en mode modification, à gauche : « Supprimer le projet » (tâche 5).
- **Après confirmation** : la fenêtre se ferme et un message s'affiche :
  - modification : `{nom} enregistré.` ;
  - création avec agents rangés : `Projet {nom} créé. {noms} rejoignent sa table.` ;
  - création sans agent : `Projet {nom} créé. Il apparaît dans la barre latérale ; sa table s'ouvrira avec la première session.`
- **Refus** : `p.composer-missing[role=alert]` avec le texte du motif. Les valeurs restent.
- **Points d'entrée** (ils passent déjà `{ kind: 'project', edit?, file? }`) : le « + » de Projets dans la barre latérale, « Modifier le projet » du menu « … » d'une table, « Ranger dans… › Nouveau projet… » (`file`), et « Modifier le projet » / « Nouveau projet » du formulaire de nouvelle session (lot 7). Un `edit` inconnu ferme la fenêtre.

Textes (`projects.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `titles` | `{ new: 'Nouveau projet', edit: (n) => \`Modifier ${n}\`, delete: (n) => \`Supprimer ${n}\` }` | `New project`, `Edit ${n}`, `Delete ${n}` |
| `name` / `namePlaceholder` / `color` / `colors` | `Nom` / `Ex. Paper Rendering` / `Couleur` / `{ blue: 'Bleu', green: 'Vert', amber: 'Ambre', violet: 'Violet', teal: 'Sarcelle', pink: 'Rose', red: 'Rouge', slate: 'Ardoise' }` | `Name` / `E.g. Paper Rendering` / `Colour` / `Blue`, `Green`, `Amber`, `Violet`, `Teal`, `Pink`, `Red`, `Slate` |
| `description` / `optional` / `descriptionPlaceholder` | `Description` / `facultatif` / `Une phrase qui dit à quoi sert le projet` | `Description` / `optional` / `One sentence on what the project is for` |
| `repos(n)` / `branchTitle` / `noGit` / `alsoIn(p)` / `notFound` / `offline` / `remove(n, m)` / `addRepo` / `empty` | `Dépôts de travail · ${n}` / `Branche par défaut détectée` / `Dossier sans Git` / `Aussi dans ${p}` / `introuvable` / `hors ligne` / `Retirer ${n} (${m})` / `Ajouter un dépôt` / `Aucun dépôt pour l’instant. Le projet peut exister sans, mais Ledge ne saura pas y ranger les sessions.` | `Working repositories · ${n}` / — / `Folder without Git` / `Also in ${p}` / `not found` / `offline` / `Remove ${n} (${m})` / `Add a repository` / `No repository yet. The project can exist without one, but Ledge will not be able to file sessions in it.` |
| `fileToo` | `Ranger aussi` | `Also file` |
| `problems` | `{ name_empty: 'Donnez un nom au projet', name_taken: 'Ce nom est déjà utilisé par un autre projet', repo_duplicate: 'Ce dépôt est en double', gone: 'Ce projet a été supprimé entre-temps' }` | `Give the project a name`, `This name is already used by another project`, `This repository is listed twice`, `This project was deleted meanwhile` |
| `refused` | `{ offline: 'Le daemon local est hors ligne : rien n’a été enregistré.', outdated: 'Le daemon local est trop ancien pour les projets : mettez-le à jour.', invalid: 'Le daemon a refusé ce projet.', timeout: 'Le daemon n’a pas confirmé l’enregistrement.' }` | `The local daemon is offline: nothing was saved.`, `The local daemon is too old for projects: update it.`, `The daemon refused this project.`, `The daemon did not confirm the save.` |
| `preview(n, ms)` / `firstSession` / `newName` | `${n} dépôt(s)` + ` sur ${ms}` / ` · la table apparaîtra avec la première session` / `Nouveau projet` | `${n} repositor(y/ies)` + ` on ${ms}` / ` · the table appears with the first session` / `New project` |
| `create` / `save` / `saving` / `cancel` / `deleteProject` | `Créer le projet` / `Enregistrer` / `Enregistrement…` / `Annuler` / `Supprimer le projet` | `Create the project` / `Save` / `Saving…` / `Cancel` / `Delete the project` |
| `saved(n)` / `created(n)` / `createdWith(n, names)` | `${n} enregistré.` / `Projet ${n} créé. Il apparaît dans la barre latérale ; sa table s’ouvrira avec la première session.` / `Projet ${n} créé. ${names} rejoignent sa table.` | `${n} saved.` / `Project ${n} created. It appears in the sidebar; its table opens with the first session.` / `Project ${n} created. ${names} join its table.` |

- [ ] **Step 1: Écrire `test/project-editor.test.tsx`**
  - **« + » de Projets** : le nom a le focus et le sélecteur de dossiers est ouvert. Ctrl ↵ sans nom affiche « Give the project a name ». Avec un nom et un dépôt ajouté depuis l'explorateur, « Create the project » envoie un `projects.set` contenant le projet (id `paper-rendering`, couleur la première libre) et le bouton passe à « Saving… ».
  - **Diffusion** : la fenêtre se ferme, le message s'affiche, et le projet apparaît dans la barre latérale.
  - **Refus et délai** : le faux daemon ne diffuse pas, et 8 s plus tard « The daemon did not confirm the save. » s'affiche, les valeurs restant (minuteries factices). Un daemon local hors ligne donne « The local daemon is offline: nothing was saved. » et aucun `projects.set`.
  - **« Modifier le projet »** depuis le menu d'une table : renommer garde l'id (le `projects.set` envoyé porte `id: 'ledge'`). « Also in {p} » s'affiche sur un dépôt partagé, et « not found » sur un dépôt que `repoInfo` dit absent.
  - **Projet supprimé ailleurs pendant l'édition** : une diffusion sans ce projet, puis « Save », affichent « This project was deleted meanwhile » ; aucun `projects.set` ne part.
  - **« Ranger dans… › Nouveau projet… »** sur un agent sans projet : le dépôt et la puce « Also file » sont préremplis. Après l'enregistrement, l'agent est assis à la nouvelle table et le message dit « … join its table. »
  - **`ProjectSwatch`** : la pastille de la barre latérale a la couleur du projet, et celle de « Sans projet » la classe `filter-none`.
- [ ] **Step 2: Vérifier qu'il échoue** — `pnpm --filter desktop exec vitest run test/project-editor.test.tsx`. Expected : FAIL.
- [ ] **Step 3: Implémenter `ProjectSwatch` (et remplacer les pastilles en ligne), `useProjectSave`, `ProjectEditor`, le CSS, les textes et le branchement**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`. Expected : tout passe, sans avertissement de taille de morceau. L'éditeur et l'explorateur se chargent **toujours** par le motif de `session/lazy.tsx` / `launch/lazy.tsx` (préchargés au montage, sans écran d'attente une fois chargés) : le morceau principal est à 472 kB sur 500 après le lot 7.
- [ ] **Step 5: Commit** — `feat(desktop): the project editor: name, colour, description, repositories with their branch from a folder browser or a typed path, saved only when the daemon confirms; « Move to › New project… »`

### Task 5: Supprimer un projet

**Files:**
- Modify: `apps/desktop/src/projects/ProjectEditor.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/i18n/messages.ts`
- Create: `apps/desktop/test/project-delete.test.tsx`

**Interfaces:**
- Consumes : tâches 2 et 4 (`deletion`, `withoutProject`, `removed`, `useProjectSave`).
- Produces : la vue de suppression de l'éditeur (`.pe-delete`, maquette), et `onDeleted`.

Comportement :
- « Supprimer le projet » passe l'éditeur en vue de suppression. Le titre devient « Supprimer {nom} » et le corps est `div.pe-delete[role=alert]` :
  - `p` : « **{nom}** disparaît de la barre latérale et de l'atelier. Ses dépôts restent intacts sur vos machines. » ;
  - un premier `li` pour les agents :
    - aucun : « Aucun agent à cette table. » ;
    - sinon : `{n} agent(s) ({quatre noms au plus, puis …})`, suivi de « passeront dans « Sans projet ». » ou de « rejoindront **{projet}**. » ;
  - un second `li` pour les règles : `{n} dossier(s) mémorisé(s)`, suivi de « sera/seront oublié(s). » ou de « pointera/pointeront vers ce projet. » ;
  - le choix « Ses agents » : `Sans projet` ou `Déplacer vers…`. Le second fait apparaître un `select` « Projet de destination », dont les autres projets sont les options et dont le premier est choisi par défaut. « Déplacer vers… » est désactivé s'il n'y a pas d'autre projet.
- Le pied de page montre « Annuler » (retour à la modification) et un bouton principal : « Supprimer {nom} », ou « Déplacer et supprimer » quand une destination est choisie.
- **Envoi** : `setProjects(withoutProject(state, id, moveTo))`, puis attente de `removed`. Les refus et le délai suivent les règles de la tâche 4.
- **Après confirmation** :
  - la fenêtre se ferme ;
  - si le filtre courant est ce projet, il repasse à « Tous » (`dispatch({ type: 'home', project: 'all' })` en gardant la vue), même sur une page de session ;
  - un message s'affiche : `{nom} supprimé.`, suivi de ` {n} agent(s) rejoignent {projet}.` ou de ` {n} agent(s) passent dans « Sans projet ».` quand il y avait des agents.

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `delete.lead(n)` | `${n} disparaît de la barre latérale et de l’atelier. Ses dépôts restent intacts sur vos machines.` | `${n} disappears from the sidebar and the atelier. Its repositories stay untouched on your machines.` |
| `delete.noAgents` / `delete.agents(n, names)` / `delete.toNone` / `delete.toProject(p)` | `Aucun agent à cette table.` / `${n} agent(s) (${names})` / `passeront dans « Sans projet ».` / `rejoindront ${p}.` | `No agent at this table.` / `${n} agent(s) (${names})` / `will move to « No project ».` / `will join ${p}.` |
| `delete.rules(n)` / `delete.rulesForget(n)` / `delete.rulesMove(n)` | `${n} dossier(s) mémorisé(s)` / `sera oublié.` · `seront oubliés.` / `pointera vers ce projet.` · `pointeront vers ce projet.` | `${n} remembered folder(s)` / `will be forgotten.` / `will point to that project.` |
| `delete.their` / `delete.none` / `delete.moveTo` / `delete.target` | `Ses agents` / `Sans projet` / `Déplacer vers…` / `Projet de destination` | `Its agents` / `No project` / `Move to…` / `Target project` |
| `delete.confirm(n)` / `delete.moveAndDelete` | `Supprimer ${n}` / `Déplacer et supprimer` | `Delete ${n}` / `Move and delete` |
| `delete.done(n)` / `delete.doneMoved(k, p)` / `delete.doneNone(k)` | `${n} supprimé.` / ` ${k} agent(s) rejoignent ${p}.` / ` ${k} agent(s) passent dans « Sans projet ».` | `${n} deleted.` / ` ${k} agent(s) join ${p}.` / ` ${k} agent(s) move to « No project ».` |

- [ ] **Step 1: Écrire `test/project-delete.test.tsx`**
  - **Sans projet** : le texte dit les 2 agents de la table Ledge et la règle oubliée. Supprimer envoie `projects.set` sans `ledge` et sans sa règle. Après la diffusion, le message dit « Ledge deleted. 2 agents move to « No project ». » et les agents sont dans « Sans projet ».
  - **« Move to… » Payment** : le texte dit « will join Payment Service. » et « will point to that project. ». L'envoi transporte les dépôts et la règle vers `payment`. Les agents rejoignent la table Payment.
  - **Filtre et page de session** : supprimer le projet du filtre courant (vue Atelier filtrée sur Ledge) remet le filtre à « Tous ». Le même cas depuis la page de session d'un agent de Ledge laisse la page ouverte.
  - **Un seul projet** : « Move to… » est désactivé.
- [ ] **Step 2: Vérifier qu'il échoue** — `pnpm --filter desktop exec vitest run test/project-delete.test.tsx`. Expected : FAIL.
- [ ] **Step 3: Implémenter la vue de suppression et `onDeleted`**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck`. Expected : tout passe.
- [ ] **Step 5: Commit** — `feat(desktop): deleting a project says what becomes of its agents and remembered folders, to « No project » or moved to another project, confirmed by the daemon`

### Task 6: Les projets dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/projects.spec.ts`
- Modify: `apps/desktop/e2e/daemon.ts`, qui gagne :
  - `folder.list` depuis `extras.folders`, avec `repos` et `requestId` ;
  - `projects.set` qui diffuse l'état reçu (déjà en place pour le rangement ; à vérifier) ;
  - `repos.inspect` depuis `extras.repoInfo` (lot 7).

Scénarios :
1. **Créer un projet** : « + » Projets, un nom, puis l'explorateur (ouvrir `Workspace`, ajouter le dépôt `paper-fonts` marqué `⎇ main`). « Créer le projet » fait apparaître le projet dans la barre latérale, avec sa couleur.
2. **Ranger dans… › Nouveau projet…** sur un agent sans projet : le nouveau projet se crée avec son dossier, et l'agent quitte « Sans projet » pour s'asseoir à la nouvelle table.
3. **Supprimer avec « Déplacer vers… »** : depuis « Modifier le projet », les agents rejoignent l'autre table et le filtre repasse à « Tous ».
4. **Fenêtre de 900 px** : l'éditeur et l'explorateur tiennent sans défilement horizontal. Le corps défile verticalement, et le pied de page reste visible.

- [ ] **Step 1: Écrire les scénarios et étendre le faux daemon**
- [ ] **Step 2: Lancer Playwright** — `pnpm --filter desktop e2e`. Expected : les scénarios d'avant et les 4 de `projects` passent.
- [ ] **Step 3: Vérification du dépôt** — paquet par paquet :
  - `pnpm --filter @ledge/protocol test` ;
  - `pnpm --filter @paradow/ledge test` ;
  - `pnpm --filter @ledge/fleet test` ;
  - `pnpm --filter desktop test` ;
  - `pnpm --filter overlay test` ;
  - `pnpm -r typecheck` ;
  - `pnpm -r build`.

  Expected : tout passe. Seule l'instabilité connue de l'overlay peut apparaître ; la signaler.
- [ ] **Step 4: Commit** — `test(desktop): projects in the browser: create from the folder browser, file an agent into a new project, delete and move, a narrow window`
