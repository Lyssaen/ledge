# Ledge Desktop Atelier, lot 2 : projets dans le daemon — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les projets (nom, couleur, description, dépôts) et les règles « dossier → projet » existent comme donnée partagée. Le daemon local les persiste et les diffuse, `@ledge/fleet` les expose aux fronts et leur dit à quel projet appartient chaque session.

**Architecture:** Les projets suivent exactement le chemin de la liste des machines. Le schéma vit dans `@ledge/protocol` et le daemon local les lit et écrit dans `projects.json`. Il les envoie après chaque snapshot (message `projects`) et remplace l'ensemble sur `projects.set`, puis rediffuse. Le pont SSH et le transport SSH les arrêtent dans les deux sens. Dans `@ledge/fleet`, le fleet garde les projets du daemon local, les expose (`projects()`, `setProjects()`, `useProjects`), et une fonction pure `projectOf` rattache une session à un projet à partir des dépôts et des règles.

**Tech Stack:** TypeScript, zod 3, Node (`ws`), React 19 (`useSyncExternalStore`), vitest 3, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` (§ 5, § 7 lot 2). Écrans concernés plus tard : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` §§ 2.1, 2.3, 6. Couleurs : `docs/mockups/desktop-observatory/projects.tsx` (`COLORS`).

## Global Constraints

- Branche `feat/desktop-atelier`, worktree `.worktrees/desktop-atelier`.
- **Modèle de la liste des machines** pour tout ce qui suit : remplacement de l'ensemble par un seul message (`projects.set`), écriture du fichier **avant** la mémoire, écriture atomique (fichier `.tmp` puis `rename`), diffusion aux seuls clients locaux. Un fichier invalide fait retomber sur la valeur par défaut, est laissé tel quel et est signalé dans le journal (`packages/ledge/src/daemon/machines.ts`).
- **Les projets sont privés à leur hôte** : le daemon d'une machine distante ne les reçoit jamais et n'envoie jamais les siens. Le pont et le transport SSH les filtrent comme `machines`, sans couper la liaison. Le fleet n'accepte `projects` que de la machine `local`.
- **8 couleurs**, stockées par clé et non par valeur hexadécimale : `blue #3b82f6`, `green #10b981`, `amber #f59e0b`, `violet #8b5cf6`, `teal #14b8a6`, `pink #ec4899`, `red #ef4444`, `slate #64748b` (ordre et teintes de la maquette).
- **Chemins** : absolus POSIX, normalisés. Ils commencent par `/`, n'ont pas de `/` final sauf pour `/` lui-même et pas de `//`. Les fronts normalisent avec `normalizePath` avant d'envoyer, et le schéma refuse un chemin non normalisé.
- **Validation dans le daemon** (par le schéma) : nom vide après trim, nom déjà pris (comparé trimé et sans casse), identifiant en double, même dépôt (machine + chemin) deux fois dans l'ensemble, même règle (machine + chemin) deux fois, règle vers un projet inexistant. « Chemin introuvable » et la détection de branche viendront au lot 8, demandés au daemon de la machine du dépôt ; ils ne sont pas dans ce lot.
- **Rattachement** (spec § 5, choix du cadrage) : c'est une fonction pure de `@ledge/fleet`, pas le daemon. Parmi les dépôts et les règles **de la machine de la session** dont le chemin contient le `cwd`, on retient le chemin le plus long. À longueur égale, la règle gagne sur le dépôt. Sans correspondance, la session est « Sans projet » (`null`).
- Pas de `cargo` dans ce WSL ; rien de Rust dans ce lot.
- Commits `feat(protocol): …`, `feat(daemon): …`, `feat(fleet): …`, terminés par la ligne `Co-Authored-By` de la session.

## Review Focus

1. **Préfixe trompeur** : un dépôt `/w/ledge` ne rattache pas une session dans `/w/ledge-docs`, mais rattache `/w/ledge` et `/w/ledge/app`. Test ajouté à la tâche 3.
2. **Dépôts imbriqués et règle sur le même chemin** : avec `/w/ledge` dans A et `/w/ledge/docs` dans B, une session dans `/w/ledge/docs/x` va à B. Avec une règle `/w/ledge` → C et un dépôt `/w/ledge` dans A, une session dans `/w/ledge` va à C. Test ajouté à la tâche 3.
3. **Même chemin sur deux machines** : un dépôt `/w/ledge` sur `devbox` ne rattache pas une session `local` au même chemin. Une session sans `machineId` compte comme `local`. Test ajouté à la tâche 3.
4. **`projects.json` modifié à la main et devenu invalide** (couleur inconnue, règle vers un projet supprimé, JSON tronqué) : le daemon démarre avec une liste vide, ne réécrit pas le fichier et le note dans le journal. Un `projects.set` valide le remplace ensuite. Test ajouté à la tâche 2.
5. **Daemon distant ou plus ancien** : un `projects` venu d'un daemon distant par le pont, ou un `projects.set` d'un front vers un distant, est arrêté sans couper la liaison. Le fleet ignore un `projects` d'une machine autre que `local`. Test ajouté aux tâches 2 et 4.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/protocol/src/projects.ts` | Nouveau : schémas, couleurs, `normalizePath`, `projectsProblems` |
| `packages/protocol/src/messages.ts` | `projects` (serveur), `projects.set` (client) |
| `packages/protocol/src/index.ts` | Export de `projects.ts` |
| `packages/protocol/test/projects.test.ts` | Nouveau |
| `packages/ledge/src/paths.ts` | `projects: <dir>/projects.json` |
| `packages/ledge/src/daemon/projects.ts` | Nouveau : `readProjects`, `writeProjects`, `DEFAULT_PROJECTS` |
| `packages/ledge/src/daemon/server.ts` | Envoi après le snapshot, `projects.set`, option `projectsFile` |
| `packages/ledge/src/transport/ssh.ts`, `packages/ledge/src/cli/bridge.ts` | Filtrent `projects` et `projects.set` |
| `packages/ledge/test/projects.test.ts` | Nouveau |
| `packages/ledge/test/server.test.ts`, `packages/ledge/test/ssh-transport.test.ts` | Cas ajoutés, séquences mises à jour |
| `packages/fleet/src/projects.ts` | Nouveau : `projectOf`, `withProject`, `withoutProject`, `withRule`, `newProjectId` |
| `packages/fleet/src/fleet.ts`, `packages/fleet/src/machines.ts` | `Fleet.projects()`, `Fleet.setProjects()`, `useProjects` |
| `packages/fleet/src/index.ts` | Export de `projects.ts` |
| `packages/fleet/test/projects.test.ts`, `packages/fleet/test/projects-source.test.ts` | Nouveaux |
| `packages/fleet/test/mockDaemon.ts` | `projects(state)` pour les tests des fronts |

---

### Task 1: Le schéma des projets dans le protocole

**Files:**
- Create: `packages/protocol/src/projects.ts`, `packages/protocol/test/projects.test.ts`
- Modify: `packages/protocol/src/messages.ts` (union serveur près de `machines`, union client près de `machines.set`), `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes : l'identifiant de machine de `MachineSchema` (`/^[a-zA-Z0-9_-]{1,64}$/`), à extraire en `MachineIdSchema` exporté par `machines.ts` et réutilisé par `MachineSchema`.
- Produces :
  - `PROJECT_COLORS: Readonly<Record<ProjectColor, string>>` et `ProjectColorSchema = z.enum(['blue','green','amber','violet','teal','pink','red','slate'])` ;
  - `ProjectIdSchema` (`/^[a-z0-9][a-z0-9-]{0,63}$/`) ;
  - `normalizePath(raw: string): string` ;
  - `RepoSchema = { machine, path }` ;
  - `ProjectSchema = { id, name (trim, 1..80), color, description (max 500, défaut ''), repos (max 50) }` ;
  - `RuleSchema = { machine, path, project }` ;
  - `ProjectsSchema = { projects (max 100), rules (max 1000) }` avec `superRefine` ;
  - `DEFAULT_PROJECTS` (`{ projects: [], rules: [] }`) ;
  - les types `ProjectColor`, `Repo`, `Project`, `Rule`, `Projects` ;
  - `type ProjectsProblemCode = 'duplicate_id' | 'duplicate_name' | 'duplicate_repo' | 'duplicate_rule' | 'unknown_project'` ;
  - `projectsProblems(p: Projects): { code: ProjectsProblemCode; path: (string | number)[] }[]` ;
  - les messages `{ type: 'projects', projects: Projects }` (serveur) et `{ type: 'projects.set', projects: Projects }` (client).

- [ ] **Step 1: Écrire `packages/protocol/test/projects.test.ts`**

```ts
const p = (id: string, name: string, repos: Repo[] = [], color: ProjectColor = 'blue') => ({ id, name, color, description: '', repos });
const r = (machine: string, path: string): Repo => ({ machine, path });

it('has the eight mockup colours in order', () => {
  expect(Object.entries(PROJECT_COLORS)).toEqual([['blue', '#3b82f6'], ['green', '#10b981'], ['amber', '#f59e0b'], ['violet', '#8b5cf6'], ['teal', '#14b8a6'], ['pink', '#ec4899'], ['red', '#ef4444'], ['slate', '#64748b']]);
});
it('normalizes paths', () => {
  expect(normalizePath('/w/ledge/')).toBe('/w/ledge');
  expect(normalizePath('/w//ledge///app')).toBe('/w/ledge/app');
  expect(normalizePath('  /w/ledge  ')).toBe('/w/ledge');
  expect(normalizePath('/')).toBe('/');
});
it('accepts a valid set and trims names, defaults the description', () => {
  const out = ProjectsSchema.parse({ projects: [{ id: 'ledge', name: '  Ledge ', color: 'blue', repos: [r('local', '/w/ledge')] }], rules: [{ machine: 'devbox', path: '/srv/x', project: 'ledge' }] });
  expect(out.projects[0]).toEqual({ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [r('local', '/w/ledge')] });
});
it('refuses an empty name, an unknown colour, a relative or non-normalized path, a bad id', () => {
  for (const bad of [p('a', '   '), { ...p('a', 'A'), color: 'orange' }, p('a', 'A', [r('local', 'w/x')]), p('a', 'A', [r('local', '/w/x/')]), p('A B', 'A')])
    expect(ProjectsSchema.safeParse({ projects: [bad], rules: [] }).success).toBe(false);
});
it('names every cross-project problem', () => {
  const state = { projects: [p('a', 'Ledge', [r('local', '/w/x')]), p('a', 'ledge ', [r('local', '/w/x')])], rules: [{ machine: 'local', path: '/w/y', project: 'zz' }, { machine: 'local', path: '/w/y', project: 'a' }] };
  expect(projectsProblems(state as Projects).map(x => x.code).sort()).toEqual(['duplicate_id', 'duplicate_name', 'duplicate_repo', 'duplicate_rule', 'unknown_project']);
  expect(ProjectsSchema.safeParse(state).success).toBe(false);
});
it('lets the same path live on two machines', () => {
  expect(projectsProblems({ projects: [p('a', 'A', [r('local', '/w/x')]), p('b', 'B', [r('devbox', '/w/x')])], rules: [] })).toEqual([]);
});
it('carries projects both ways', () => {
  const projects = { projects: [p('a', 'A')], rules: [] };
  expect(parseServerMessage({ type: 'projects', projects })).toEqual({ type: 'projects', projects });
  expect(parseClientMessage({ type: 'projects.set', projects })).toEqual({ type: 'projects.set', projects });
  expect(() => parseClientMessage({ type: 'projects.set', projects: { projects: [p('a', ''), p('a', 'B')], rules: [] } })).toThrow();
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter @ledge/protocol exec vitest run test/projects.test.ts`
Expected : FAIL, le module `../src/projects` est introuvable.

- [ ] **Step 3: Implémenter `packages/protocol/src/projects.ts` et les deux messages**

- `normalizePath` : trim, puis remplacer `\/+` par `/`, puis retirer le `/` final sauf si le résultat vaut `/`.
- Le chemin de `RepoSchema` et `RuleSchema` est `z.string().max(4096)`, raffiné par `p.startsWith('/') && p === normalizePath(p)`.
- `projectsProblems` compare les noms avec `name.trim().toLocaleLowerCase()` et les dépôts ou règles par la clé `${machine}\n${path}`.
- `ProjectsSchema.superRefine` ajoute un issue `custom` par problème, avec `message: code` et `path`.
- Exporter depuis `index.ts`.

- [ ] **Step 4: Vérifier que le paquet passe**

Run: `pnpm --filter @ledge/protocol test && pnpm --filter @ledge/protocol typecheck`
Expected : tout passe, y compris l'ancien `machines.test.ts` après l'extraction de `MachineIdSchema`.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): projects, repos and folder rules, their colours and the projects / projects.set messages"
```

### Task 2: Le daemon local garde et diffuse les projets

**Files:**
- Create: `packages/ledge/src/daemon/projects.ts`, `packages/ledge/test/projects.test.ts`
- Modify: `packages/ledge/src/paths.ts`, `packages/ledge/src/daemon/server.ts:75-130,247-251`, `packages/ledge/src/transport/ssh.ts:29-45`, `packages/ledge/src/cli/bridge.ts:22-36`
- Test: `packages/ledge/test/server.test.ts` (séquences autour des lignes 509-524, nouveau `describe('projects')` à côté de `describe('machines list')`), `packages/ledge/test/ssh-transport.test.ts` (à côté des cas `machines`, lignes 70-95)

**Interfaces:**
- Consumes : `ProjectsSchema`, `DEFAULT_PROJECTS`, `Projects`, les messages `projects` et `projects.set` (tâche 1).
- Produces :
  - `paths().projects` ;
  - `readProjects(file = paths().projects): Projects` et `writeProjects(state: Projects, file = paths().projects): void` dans `packages/ledge/src/daemon/projects.ts` ;
  - l'option `projectsFile?: string` de `startServer` ;
  - côté fil : un client local reçoit `snapshot`, `machines`, **`projects`**, puis les aperçus et `chat.history`. Un `projects.set` valide est écrit puis diffusé à tous les clients locaux, l'émetteur compris.

- [ ] **Step 1: Écrire `packages/ledge/test/projects.test.ts`**, sur le modèle de `machines.test.ts`

```ts
it('lives in the ledge dir', () => { expect(paths().projects).toBe(join(paths().dir, 'projects.json')); });
it('is empty when absent, truncated, invalid or naming a missing project, and a bad file is left alone', () => {
  const f = file();
  expect(readProjects(f)).toEqual(DEFAULT_PROJECTS);
  writeFileSync(f, '{"projects":['); expect(readProjects(f)).toEqual(DEFAULT_PROJECTS);
  writeFileSync(f, JSON.stringify({ projects: [{ id: 'a', name: 'A', color: 'orange', repos: [] }], rules: [] })); expect(readProjects(f)).toEqual(DEFAULT_PROJECTS);
  writeFileSync(f, JSON.stringify({ projects: [], rules: [{ machine: 'local', path: '/w', project: 'gone' }] })); expect(readProjects(f)).toEqual(DEFAULT_PROJECTS);
  expect(readFileSync(f, 'utf8')).toContain('gone');   // untouched for the user to look at
});
it('round-trips a valid set', () => {
  const f = file(); writeProjects(state, f);
  expect(readProjects(f)).toEqual(state);
});
```

`state` contient deux projets, l'un avec un dépôt `local` et l'autre avec un dépôt `devbox`, plus une règle.

- [ ] **Step 2: Ajouter les cas serveur et SSH**

Dans `server.test.ts` :
- Mettre à jour les séquences attendues des lignes 509, 517 et 524 en insérant `'projects'` après chaque `'machines'`.
- Ajouter `describe('projects')`, avec un `projectsFile` temporaire par test, comme `machinesFile` dans `describe('machines list')` :

```ts
it('sends the stored projects right after the machines list', async () => {
  // projectsFile pre-written with `state`
  expect(got.map(m => m.type).slice(0, 3)).toEqual(['snapshot', 'machines', 'projects']);
  expect(got.find(m => m.type === 'projects')).toEqual({ type: 'projects', projects: state });
});
it('projects.set is validated, written first, and broadcast to every local client', async () => {
  a.send(JSON.stringify({ type: 'projects.set', projects: state }));
  await until(() => gotB.filter(m => m.type === 'projects').length === 2);
  expect(gotB.filter(m => m.type === 'projects').at(-1)).toEqual({ type: 'projects', projects: state });
  expect(JSON.parse(readFileSync(projectsFile, 'utf8'))).toEqual(state);
});
it('refuses an invalid projects.set: nothing written, nothing broadcast, an error to the sender', async () => {
  a.send(JSON.stringify({ type: 'projects.set', projects: { projects: [{ id: 'a', name: 'A', color: 'blue', repos: [] }, { id: 'b', name: 'a', color: 'blue', repos: [] }], rules: [] } }));
  await until(() => gotA.some(m => m.type === 'error'));
  expect(gotB.filter(m => m.type === 'projects')).toHaveLength(1);   // the one after the snapshot
  expect(existsSync(projectsFile)).toBe(false);
});
```

Dans `ssh-transport.test.ts`, étendre les deux cas existants, `bridge drops the daemon machines frame…` et `serveSsh drops a remote machines frame…` :
- le faux daemon distant envoie aussi `{ type: 'projects', projects: { projects: [], rules: [] } }` ;
- le front envoie aussi `projects.set` ;
- on vérifie que ni `projects` n'arrive au front, ni `projects.set` au distant, et que la liaison reste ouverte (le message `after` ou `snapshot.request` passe toujours).

- [ ] **Step 3: Vérifier que les nouveaux cas échouent**

Run: `pnpm --filter @paradow/ledge exec vitest run test/projects.test.ts test/server.test.ts test/ssh-transport.test.ts`
Expected : FAIL. `../src/daemon/projects.js` est introuvable, les séquences de `server.test.ts` n'ont pas `projects`, et `projects` traverse le pont SSH.

- [ ] **Step 4: Implémenter**

- `paths.ts` : ajouter `projects: join(dir, 'projects.json')`.
- `daemon/projects.ts` : copie de `machines.ts`, adaptée à `ProjectsSchema` et `DEFAULT_PROJECTS`. Message de journal : `projects.json is invalid, using no projects: <première ligne>`.
- `server.ts` :
  - `const projectsFile = opts.projectsFile ?? paths().projects` et `let projects = readProjects(projectsFile)` ;
  - `projectsMsg()` envoyé dans `sendSnapshot` juste après `machinesMsg()` ;
  - `case 'projects.set'` : `writeProjects` d'abord, puis l'affectation, puis `broadcast(projectsMsg())`.
- `transport/ssh.ts` et `cli/bridge.ts` : ajouter `projects` aux types de messages serveur ignorés et `projects.set` aux types de messages client ignorés, avec le même commentaire que pour `machines` (« private to its host »).

- [ ] **Step 5: Vérifier que le paquet passe**

Run: `pnpm --filter @paradow/ledge test && pnpm --filter @paradow/ledge typecheck`
Expected : tout passe (866 tests avant ce lot, plus les nouveaux).

- [ ] **Step 6: Commit**

```bash
git add packages/ledge
git commit -m "feat(daemon): projects.json shared by the local fronts, kept off the SSH bridge"
```

### Task 3: Rattacher une session et modifier les projets, en fonctions pures

**Files:**
- Create: `packages/fleet/src/projects.ts`, `packages/fleet/test/projects.test.ts`
- Modify: `packages/fleet/src/index.ts`

**Interfaces:**
- Consumes : `Projects`, `Project`, `Rule`, `Repo`, `normalizePath` (tâche 1) ; `Session` (`machineId?`, `cwd`).
- Produces, dans `packages/fleet/src/projects.ts` :
  - `projectOf(session: Pick<Session, 'machineId' | 'cwd'>, state: Projects): string | null` ;
  - `withProject(state: Projects, project: Project): Projects` : insère, ou remplace par `id` en gardant la position ;
  - `withoutProject(state: Projects, id: string, moveTo: string | null): Projects` : avec `moveTo`, les règles du projet pointent vers `moveTo` et ses dépôts s'ajoutent à ceux de `moveTo`, sans doublon. Avec `null`, ses règles et ses dépôts disparaissent ;
  - `withRule(state: Projects, rule: Rule): Projects` : remplace une règle de même machine et même chemin, sinon l'ajoute ; le chemin est normalisé ;
  - `newProjectId(name: string, taken: readonly string[]): string`.

- [ ] **Step 1: Écrire `packages/fleet/test/projects.test.ts`**

```ts
const A = { id: 'a', name: 'A', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] } as const;
const B = { id: 'b', name: 'B', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/ledge/docs' }, { machine: 'devbox', path: '/w/api' }] } as const;
const state: Projects = { projects: [A, B], rules: [{ machine: 'local', path: '/tmp/scratch', project: 'b' }] };
const at = (cwd: string, machineId?: string) => ({ cwd, machineId });

describe('projectOf', () => {
  it('matches a repo folder and what is under it, never a sibling sharing the prefix', () => {
    expect(projectOf(at('/w/ledge'), state)).toBe('a');
    expect(projectOf(at('/w/ledge/app/src'), state)).toBe('a');
    expect(projectOf(at('/w/ledge-docs'), state)).toBeNull();
  });
  it('picks the deepest path, and a rule over a repo on the same path', () => {
    expect(projectOf(at('/w/ledge/docs/x'), state)).toBe('b');
    expect(projectOf(at('/w/ledge'), { ...state, rules: [{ machine: 'local', path: '/w/ledge', project: 'b' }] })).toBe('b');
  });
  it('only looks at the session machine; no machine means local', () => {
    expect(projectOf(at('/w/api', 'devbox'), state)).toBe('b');
    expect(projectOf(at('/w/api', 'local'), state)).toBeNull();
    expect(projectOf(at('/w/ledge/x', 'devbox'), state)).toBeNull();
    expect(projectOf(at('/tmp/scratch/a'), state)).toBe('b');
  });
  it('tolerates a trailing slash in the session cwd', () => { expect(projectOf(at('/w/ledge/'), state)).toBe('a'); });
});

describe('edits', () => {
  it('withProject replaces in place or appends', () => {
    expect(withProject(state, { ...A, name: 'A2' }).projects.map(p => p.name)).toEqual(['A2', 'B']);
    expect(withProject(state, { ...A, id: 'c', name: 'C', repos: [] }).projects.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('withoutProject moves rules and repos, or drops them', () => {
    const moved = withoutProject(state, 'b', 'a');
    expect(moved.projects.map(p => p.id)).toEqual(['a']);
    expect(moved.projects[0]!.repos).toEqual([...A.repos, ...B.repos]);
    expect(moved.rules).toEqual([{ machine: 'local', path: '/tmp/scratch', project: 'a' }]);
    expect(withoutProject(state, 'b', null)).toEqual({ projects: [A], rules: [] });
  });
  it('withRule replaces the rule for the same folder and normalizes it', () => {
    expect(withRule(state, { machine: 'local', path: '/tmp/scratch/', project: 'a' }).rules).toEqual([{ machine: 'local', path: '/tmp/scratch', project: 'a' }]);
  });
  it('every edit result passes the schema', () => {
    for (const s of [withoutProject(state, 'b', 'a'), withRule(state, { machine: 'devbox', path: '/srv', project: 'a' })]) expect(ProjectsSchema.safeParse(s).success).toBe(true);
  });
});

describe('newProjectId', () => {
  it('slugs the name and avoids taken ids', () => {
    expect(newProjectId('Payment Service', [])).toBe('payment-service');
    expect(newProjectId('Payment Service', ['payment-service', 'payment-service-2'])).toBe('payment-service-3');
    expect(newProjectId('Entrepôt données', [])).toBe('entrepot-donnees');
    expect(newProjectId('!!!', [])).toBe('project');
  });
});
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter @ledge/fleet exec vitest run test/projects.test.ts`
Expected : FAIL, le module `../src/projects` est introuvable.

- [ ] **Step 3: Implémenter `packages/fleet/src/projects.ts`**

- `projectOf` : `machine = session.machineId ?? 'local'` et `cwd = normalizePath(session.cwd)`.
  - Les candidats sont les dépôts de chaque projet et les règles, limités à `machine`, dont le chemin `p` vérifie `p === '/' || cwd === p || cwd.startsWith(p + '/')`.
  - On trie par longueur de chemin décroissante, puis règle avant dépôt, et on renvoie le premier projet ou `null`.
  - Une règle qui vise un projet absent est ignorée.
- `withoutProject` déduplique les dépôts par machine et chemin.
- `newProjectId` : `normalize('NFD')`, on retire les diacritiques, on met en minuscules, on remplace `[^a-z0-9]+` par `-`, on retire les `-` en bord et on coupe à 40 caractères. Un résultat vide donne `project`. On ajoute ensuite `-2`, `-3`… tant que l'identifiant est pris.
- Exporter depuis `index.ts`.

- [ ] **Step 4: Vérifier qu'il passe**

Run: `pnpm --filter @ledge/fleet exec vitest run test/projects.test.ts`
Expected : PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fleet/src/projects.ts packages/fleet/src/index.ts packages/fleet/test/projects.test.ts
git commit -m "feat(fleet): which project a session belongs to, and pure project edits"
```

### Task 4: Le fleet expose les projets du daemon local

**Files:**
- Create: `packages/fleet/test/projects-source.test.ts`
- Modify: `packages/fleet/src/machines.ts` (interface `Fleet`, `useProjects`), `packages/fleet/src/fleet.ts` (`receive`, objet `fleet`), `packages/fleet/test/mockDaemon.ts`

**Interfaces:**
- Consumes : `ProjectsSchema`, `Projects`, les messages `projects` et `projects.set` (tâche 1) ; le comportement du daemon (tâche 2).
- Produces :
  - `Fleet.projects(): Projects | null` : `null` tant que le daemon local n'a rien envoyé ; même référence tant que rien ne change ; la dernière valeur est gardée quand le daemon local tombe ;
  - `Fleet.setProjects(next: Projects): void` : lève une erreur zod si `next` est invalide. Lève `Error` nommée `DaemonOffline` (même construction que `configure`) si le daemon local n'est pas connecté. Sinon envoie `projects.set` au daemon local et attend sa diffusion pour appliquer : rien d'optimiste ;
  - `useProjects(client: DaemonClient): Projects | null` dans `machines.ts`, à côté de `useMachines` ;
  - `mockDaemon.projects(state: Projects)` : comme `machines(list)`, mémorisé, envoyé après `machines` à chaque connexion et diffusé. Il répond à un `projects.set` reçu en diffusant `projects`.

- [ ] **Step 1: Écrire `packages/fleet/test/projects-source.test.ts`**

Reprendre le harnais `peer()` et `setup()` de `machines-source.test.ts`, avec un pair distant `server`.

```ts
it('is null until the local daemon sends projects, then follows each broadcast', () => {
  const { api, local } = setup();
  expect(api.fleet!.projects()).toBeNull();
  local.emit({ type: 'projects', projects: state });
  expect(api.fleet!.projects()).toEqual(state);
  const first = api.fleet!.projects();
  local.emit(snap(['a', 'b']));
  expect(api.fleet!.projects()).toBe(first);   // stable reference for useSyncExternalStore
});
it('ignores projects from a remote machine', () => {
  // configure a remote (as machines-source does), open it, emit a snapshot with its sshAlias, then { type: 'projects', projects: state } from it
  expect(api.fleet!.projects()).toBeNull();
});
it('keeps the last projects while the local daemon is down', () => {
  local.emit({ type: 'projects', projects: state }); local.set('unreachable');
  expect(api.fleet!.projects()).toEqual(state);
});
it('setProjects validates, refuses offline, and waits for the broadcast', () => {
  expect(() => api.fleet!.setProjects({ projects: [{ ...A, name: ' ' }], rules: [] })).toThrow();
  api.fleet!.setProjects(state);
  expect(local.sent.filter(m => (m as { type: string }).type === 'projects.set')).toEqual([{ type: 'projects.set', projects: state }]);
  expect(api.fleet!.projects()).toBeNull();   // not applied before the daemon answers
  local.set('unreachable');
  expect(() => api.fleet!.setProjects(state)).toThrow(expect.objectContaining({ name: 'DaemonOffline' }));
});
it('notifies subscribers on a projects broadcast', () => {
  let calls = 0; api.fleet!.subscribe(() => { calls++; });
  local.emit({ type: 'projects', projects: state });
  expect(calls).toBeGreaterThan(0);
});
```

`useProjects` est couvert par un test `renderHook` dans le même fichier, sur `createMockDaemon` :
1. `d.projects(state)` ;
2. `renderHook(() => useProjects(client))` après `attachClient` et `connect` (comme `useMachines` dans les tests existants, ou `use-fleet.test.tsx` de Desktop) ;
3. attendre `state` ;
4. envoyer `setProjects(next)` et attendre `next`.

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `pnpm --filter @ledge/fleet exec vitest run test/projects-source.test.ts`
Expected : FAIL, `projects` n'est pas une fonction de `fleet`.

- [ ] **Step 3: Implémenter**

- `fleet.ts` :
  - ajouter `let projects: Projects | null = null` ;
  - dans `receive`, avant `machineMessages.forEach`, traiter `projects` : `if (machine !== 'local') return; projects = m.projects; listeners.forEach(fn => fn()); return;`. Le message n'est pas relayé, comme `machines` ;
  - dans `fleet`, ajouter `projects: () => projects` et `setProjects(next)` : `ProjectsSchema.parse(next)`, puis le même contrôle de connexion que `configure` en mode daemon, puis `send`.
- `machines.ts` : ajouter les deux membres à `Fleet` et `useProjects(client)` sur `useSyncExternalStore(client.fleet?.subscribe ?? noopSubscribe, client.fleet?.projects ?? nullSnapshot, nullSnapshot)`.
- `mockDaemon.ts` : ajouter `projects(state)`, plus la réponse à `projects.set` dans le gestionnaire de messages.

- [ ] **Step 4: Vérifier le fleet et ses consommateurs**

Run: `pnpm --filter @ledge/fleet test && pnpm -r typecheck && pnpm --filter overlay test && pnpm --filter desktop test`
Expected : tout passe. L'overlay et Desktop ne lisent pas encore les projets ; l'ajout dans l'interface `Fleet` ne doit rien casser chez eux. L'instabilité connue de l'overlay (`prototype-parity` « drafts survive view and connection changes », seulement en suite complète) se signale sans être corrigée.

- [ ] **Step 5: Commit**

```bash
git add packages/fleet
git commit -m "feat(fleet): the local daemon's projects for every front, set through the daemon"
```
