# Ledge Desktop Atelier, lot 7 : Nouvelle session — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le formulaire « Nouvelle session » de la maquette, sur le vrai daemon. On écrit la consigne (avec des suggestions), on choisit l'agent par la forme de son bot, puis le projet, la machine et les dépôts du projet sur cette machine, avec la branche affichée. L'aperçu dit « Néo rejoindra la table Ledge · Place 5 ». Ctrl ↵ lance, et l'agent apparaît à sa place en « Démarrage » puis « Au travail ».

**Architecture:**
- **Daemon** : il apprend deux choses. `session.launch` reçoit des dossiers en plus (`dirs`, passés à Claude par `--add-dir`) et la machine visée (`machineId`, que le fleet route puis retire). Le nouveau message `repos.inspect` → `repos.info` dit, pour chaque chemin, s'il existe et sa branche Git ; le lot 8 s'en resservira pour valider les dépôts de l'éditeur de projets.
- **Desktop** : un modèle pur `src/launch/model.ts` (valeurs par défaut, dépôts d'un projet sur une machine, champ manquant, aperçu), le composant `LaunchComposer` (CSS de `launch.css` de la maquette), et un hook `useLaunch` qui envoie la demande et attend `session.launched`, un refus ou l'expiration du délai. Rien n'est optimiste : la fenêtre reste ouverte jusqu'à la réponse du daemon.

**Tech Stack:** TypeScript, zod, Node (daemon, `child_process` pour git), React 19, Vite 6, vitest 3 + Testing Library + jsdom, Playwright 1.49.

**Spec:**
- `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-build-design.md` §§ 5 (dépôts : machine + chemin, branche détectée ou « Dossier sans Git » ; chemin introuvable et branche par le daemon de la machine du dépôt), 6 (masqué plutôt que simulé) et 7 lot 7.
- Écrans : `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md` § 5 (« Démarrer une session ») et § 9 (N, Ctrl ↵, Échap).
- Maquette : `docs/mockups/desktop-observatory/launch.tsx`, `launch.css`, et `startAgent` dans `observatory.tsx` : après le lancement, le filtre repasse à « Tous » si le projet diffère, la place s'allume, l'agent est amené à l'écran, et un message dit « {nom} démarre à la table {projet}. ».

**Décision de l'utilisateur (2026-10-17)** : pas de « Sans projet » dans ce formulaire, comme dans la maquette. Si un projet n'a aucun dépôt sur la machine choisie, le formulaire le dit et propose « Modifier le projet » (l'éditeur arrive au lot 8).

## Global Constraints

- Celles des lots 6a et 6b, toutes :
  - la maquette fait foi ;
  - les textes sont dans `messages.ts`, `fr` est la source de vérité, et l'anglais fixé par les tests est listé par tâche ;
  - rien d'optimiste ;
  - aucune nouvelle dépendance ;
  - pas de Tauri ni de Rust ;
  - la suite unitaire est en anglais ;
  - les commits se terminent par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Le harnais n'est jamais écrit en toutes lettres** dans les vues d'ensemble. Le formulaire est l'exception : c'est la maquette qui nomme les trois harnais sur leurs tuiles.
- **Plusieurs dépôts seulement pour Claude Code** (`MULTI_REPO_TOOLS = new Set(['claude'])`, vérifié en direct : `claude --add-dir a b -- "consigne"`). Pour Codex et Cursor Agent, les dépôts se choisissent un seul à la fois (boutons radio). C'est le « masqué plutôt que simulé » : rien n'annonce plusieurs dépôts à un harnais qui ne les prendrait pas.
- **Le nom de l'agent** est choisi par Desktop avec `pickName` (`@ledge/protocol`), parmi les sessions non terminées de la machine choisie, puis envoyé dans `name`. L'aperçu montre donc le nom que le daemon gardera s'il est encore libre.
- **Une machine hors ligne n'est pas choisissable.** Un champ manquant est nommé, dans cet ordre : agent, consigne, machine, dépôt. Lancer sans avoir tout rempli affiche le premier manquant ; rien n'est bloqué en silence.
- **Pas d'optimisme** : « Lancer » devient « Lancement… » et ne renvoie rien de plus tant que le daemon n'a pas répondu. Un refus s'affiche dans le formulaire et les valeurs restent. Sans réponse après `LAUNCH_TIMEOUT_MS = 20_000`, le formulaire le dit.

## Review Focus

1. **Une machine qui tombe pendant que le formulaire est ouvert.** Sa puce devient « hors ligne ». Si elle était choisie, le choix passe à la première machine en ligne, ou le formulaire dit « Aucune machine en ligne ». Un lancement déjà parti reçoit le refus « … is offline » du fleet et l'affiche. Tests à la tâche 4 et à la tâche 5.
2. **Deux Ctrl ↵ rapides, ou un clic pendant le lancement** : un seul `session.launch` part. Test à la tâche 5.
3. **Un refus du daemon** (agent introuvable, dossier disparu) : le message apparaît dans le formulaire, les valeurs restent, et on peut réessayer. Test à la tâche 5.
4. **Un projet sans dépôt sur la machine, ou un dépôt dont le dossier a disparu** : c'est dit sur la puce (« introuvable », non cochable) ou à la place des puces (« Aucun dépôt de X sur Y » avec « Modifier le projet »). Rien ne bloque en silence. Tests aux tâches 3 et 4.
5. **Un lancement qui ne répond jamais** : après 20 s, le formulaire dit que le démarrage n'a pas répondu et redevient utilisable. Une réponse tardive ne ferme pas un formulaire qu'on a déjà quitté. Test à la tâche 5.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/protocol/src/{messages,repos}.ts` | `session.launch` avec `dirs` et `machineId` ; `repos.inspect` / `repos.info` |
| `packages/ledge/src/daemon/{server,repos}.ts` | `launchArgs` avec `--add-dir`, l'inspection des dépôts |
| `packages/fleet/src/fleet.ts`, `packages/fleet/test/mockDaemon.ts` | Routage par `machineId` ; faux daemon |
| `apps/desktop/src/launch/{model,useLaunch,useRepoInfo}.ts`, `LaunchComposer.tsx` | Nouveaux |
| `apps/desktop/src/styles/launch.css` | Porté de la maquette |
| `apps/desktop/src/{App.tsx,fleet/useFleet.ts,atelier/filing.ts,i18n/messages.ts}` | Branchement, `lastLaunched`, place allumée, textes |
| `apps/desktop/e2e/{daemon.ts,launch.spec.ts}` | Faux daemon et scénarios |

---

### Task 1: Le daemon lance avec plusieurs dossiers et inspecte les dépôts

**Files:**
- Create: `packages/protocol/src/repos.ts`, `packages/ledge/src/daemon/repos.ts`, `packages/ledge/test/repos.test.ts`
- Modify: `packages/protocol/src/messages.ts` (et l'index du paquet), `packages/ledge/src/daemon/server.ts`, `packages/ledge/test/server.test.ts`, `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces :

```ts
// protocol — session.launch gagne :
dirs: z.array(z.string().min(1)).max(20).optional(),   // dossiers en plus du cwd (Claude : --add-dir)
machineId: z.string().optional()                       // routage par le fleet, retiré avant d'atteindre le daemon
// protocol/repos.ts
export const ReposInspectSchema = z.object({ type: z.literal('repos.inspect'), requestId: z.string().min(1).max(100),
  paths: z.array(z.string().min(1)).min(1).max(50), machineId: z.string().optional() });
export const RepoInfoSchema = z.object({ path: z.string(), exists: z.boolean(), branch: z.string().nullable() });   // branch null : pas un dépôt Git
export const ReposInfoSchema = z.object({ type: z.literal('repos.info'), requestId: z.string(), repos: z.array(RepoInfoSchema) });
// ledge/daemon/server.ts
export const MULTI_DIR_ARGS: Partial<Record<Tool, (dirs: string[]) => string[]>> = { claude: dirs => ['--add-dir', ...dirs] };
export function launchArgs(msg: { tool: Tool; prompt?: string; continue?: boolean; dirs?: string[] }): string[];
// ledge/daemon/repos.ts
export async function inspectRepos(paths: readonly string[], opts?: { home?: string; git?: (cwd: string) => Promise<string | null> }): Promise<RepoInfo[]>;
```

Règles :
- `launchArgs` : les drapeaux de reprise, puis `--add-dir d1 d2` si le harnais le permet et que `dirs` n'est pas vide, puis `--` suivi de la consigne quand il y en a une. Le `--` n'est ajouté que derrière `--add-dir`, pour que l'option variadique ne mange pas la consigne. Sans `dirs`, les arguments restent ceux d'aujourd'hui.
- Un `session.launch` avec `dirs` pour un harnais absent de `MULTI_DIR_ARGS` est refusé avec l'erreur `launch: ${tool} takes one folder` (`request: 'session.launch'`). Les dossiers de `dirs` se résolvent comme le `cwd` (`~` permis) ; un dossier introuvable est refusé comme un `cwd` introuvable.
- `inspectRepos` résout `~`, puis pour chaque chemin :
  - pas de dossier : `exists: false, branch: null` ;
  - dossier Git : la branche donnée par `git -C <path> rev-parse --abbrev-ref HEAD`, en 2 s au plus ;
  - HEAD détaché : `HEAD` remplacé par les 7 premiers caractères du commit (`rev-parse --short HEAD`) ;
  - pas Git, ou git absent : `branch: null`.
- Le serveur répond `repos.info` sur la même socket, avec les chemins dans l'ordre demandé.

- [ ] **Step 1: Écrire les tests**

```ts
// server.test.ts (ou le fichier qui teste launchArgs)
it('extra folders go to Claude with --add-dir, the prompt after --', () => {
  expect(launchArgs({ tool: 'claude', prompt: 'Relis', dirs: ['/w/a', '/w/b'] })).toEqual(['--add-dir', '/w/a', '/w/b', '--', 'Relis']);
  expect(launchArgs({ tool: 'claude', prompt: 'Relis' })).toEqual(['Relis']);
  expect(launchArgs({ tool: 'claude', continue: true, dirs: ['/w/a'] })).toEqual(['--continue', '--add-dir', '/w/a']);
});
it('a harness that takes one folder refuses extra ones', async () => {
  // session.launch { tool: 'codex', cwd, dirs: ['/tmp'] } → error 'launch: codex takes one folder', request 'session.launch', nothing spawned
});
it('repos.inspect answers each path: missing, plain folder, Git branch, in order', async () => {
  // a temp dir with `git init -b trunk` + one commit, a plain temp dir, a missing path → [{ exists: true, branch: 'trunk' }, { exists: true, branch: null }, { exists: false, branch: null }]
});
```

`repos.test.ts` teste `inspectRepos` avec un `git` factice : un HEAD détaché donne le commit court, et un git qui dépasse 2 s donne `branch: null`. `messages.test.ts` vérifie les deux schémas et le nouveau `session.launch`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter @paradow/ledge exec vitest run test/repos.test.ts test/server.test.ts && pnpm --filter @ledge/protocol test`
Expected : FAIL, `dirs` inconnu, `repos.inspect` refusé.

- [ ] **Step 3: Implémenter le protocole, `launchArgs`, `inspectRepos` et la réponse du serveur**

- [ ] **Step 4: Vérifier**

Run: `pnpm --filter @ledge/protocol test && pnpm --filter @paradow/ledge test && pnpm -r typecheck`
Expected : tout passe.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(daemon): a launch takes extra folders (Claude --add-dir) and repos.inspect tells each path's existence and Git branch

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Le fleet route la nouvelle session et l'inspection vers leur machine

**Files:**
- Modify: `packages/fleet/src/fleet.ts`, `packages/fleet/src/store.ts` si besoin, `packages/fleet/test/*.test.ts`, `packages/fleet/test/mockDaemon.ts`, `apps/desktop/src/fleet/useFleet.ts`

**Interfaces:**
- Consumes : tâche 1 (`session.launch.machineId`, `repos.inspect`, `repos.info`).
- Produces :
  - `send({ type: 'session.launch', machineId, … })` part vers la machine `machineId` (à défaut, la machine choisie comme aujourd'hui), sans `machineId` ;
  - `repos.inspect` part vers `machineId` (défaut `local`), et son `repos.info` revient à l'appelant tel quel. Les chemins restent ceux de la machine : les ids de session sont qualifiés, pas les chemins ;
  - une machine hors ligne donne `error` (`request: 'session.launch'`, `message` « {label} is offline ») pour le lancement, et `repos.info` avec `exists: false, branch: null` pour chaque chemin d'une inspection ;
  - le faux daemon du fleet (`mockDaemon`) répond à `repos.inspect` depuis `repoInfo: Map<string, RepoInfo>` (par défaut `exists: true, branch: 'main'`), et à `session.launch` en enregistrant une session `starting` (nom = `name`, `cwd`), puis `session.launched` ;
  - `FleetView` gagne `lastLaunched: { id: string; seq: number } | null`, l'id qualifié, tiré du store.

- [ ] **Step 1: Écrire les tests** (dans le fichier de tests du fleet qui couvre le routage multi-machines) :
  - un lancement avec `machineId: 'nas'` arrive au daemon de `nas` sans `machineId` ;
  - `repos.inspect` vers `nas` revient avec le même `requestId` ;
  - `nas` hors ligne : l'inspection revient avec `exists: false` partout, le lancement avec l'erreur « NAS is offline » ;
  - `session.launched` de `nas` est qualifié dans `lastLaunched`.
- [ ] **Step 2: Vérifier qu'ils échouent** — `pnpm --filter @ledge/fleet test`. Expected : FAIL.
- [ ] **Step 3: Implémenter**, sur le modèle de `document.read` (`fleet.ts`, branche `machineId`) pour le routage et la mémoire `requestId → machine`.
- [ ] **Step 4: Vérifier** — `pnpm --filter @ledge/fleet test && pnpm --filter desktop test && pnpm --filter overlay test && pnpm -r typecheck`. Expected : tout passe. L'overlay ne change pas : il n'envoie ni `machineId` ni `dirs`. Son échec connu « drafts survive… » peut apparaître ; il faut alors le signaler.
- [ ] **Step 5: Commit** — `feat(fleet): launches and repository checks go to the machine they name; an offline machine answers for them`

### Task 3: Le modèle du formulaire

**Files:**
- Create: `apps/desktop/src/launch/model.ts`, `apps/desktop/test/launch-model.test.ts`

**Interfaces:**
- Consumes : `Project`, `Repo`, `RepoInfo`, `MachineState`, `Session`, `pickName`, `projectOf`.
- Produces :

```ts
export type Tool = Session['tool'];
export const MULTI_REPO_TOOLS: ReadonlySet<Tool>;                       // claude
export const LAUNCH_TIMEOUT_MS = 20_000;
export type LaunchMessage = Extract<ClientMessage, { type: 'session.launch' }>;
export interface LaunchForm { tool: Tool | null; prompt: string; project: string | null; machine: string | null; repos: string[] }   // repos : chemins sur `machine`
export type Missing = 'tool' | 'prompt' | 'machine' | 'repos';
/** Les dépôts du projet sur la machine, dans l'ordre du projet. */
export function reposOn(project: Project | undefined, machine: string | null): Repo[];
/** project : celui demandé, s'il existe, sinon le filtre courant, s'il existe, sinon le premier ; machine : `local` en ligne, sinon la première en ligne,
 *  sinon null ; repos : le premier dépôt du projet sur cette machine qui n'est pas connu introuvable. tool : null (pas de défaut), prompt : ''. */
export function launchDefaults(projects: readonly Project[], machines: readonly MachineState[], wanted: { project?: string; filter?: string }): LaunchForm;
/** Changer de projet ou de machine remet `repos` au premier dépôt disponible ; un harnais à un seul dépôt ne garde que le premier coché. */
export function withProject(f: LaunchForm, projects: readonly Project[], id: string): LaunchForm;
export function withMachine(f: LaunchForm, projects: readonly Project[], machine: string): LaunchForm;
export function withTool(f: LaunchForm, tool: Tool): LaunchForm;
export function toggleRepo(f: LaunchForm, path: string): LaunchForm;      // multi : coche / décoche ; un seul dépôt : remplace
/** Le premier champ manquant, dans l'ordre agent, consigne, machine (aucune en ligne, ou la choisie tombée), dépôt. */
export function missingOf(f: LaunchForm, machines: readonly MachineState[]): Missing | null;
/** Le nom libre sur la machine (sessions non terminées de cette machine), et la place : agents principaux de la table + 1. */
export function previewOf(f: LaunchForm, sessions: readonly Session[], projectIdOf: (s: Session) => string | null): { name: string; seat: number };
/** Le message : cwd = premier dépôt coché, dirs = les autres (seulement pour MULTI_REPO_TOOLS), name, prompt rogné, machineId. */
export function launchMessage(f: LaunchForm, name: string): LaunchMessage;
```

Un dépôt connu introuvable (`RepoInfo.exists === false`) n'est ni coché par défaut, ni cochable. `withMachine` et `launchDefaults` reçoivent pour cela un `infos?: ReadonlyMap<string, RepoInfo>` optionnel (la clé est le chemin), en dernier paramètre.

- [ ] **Step 1: Écrire les tests**

```ts
it('defaults: the asked project, local when online, its first repo there, no harness', () => {
  expect(launchDefaults(projects, machines, { project: 'payment' })).toEqual({ tool: null, prompt: '', project: 'payment', machine: 'local', repos: ['/w/payment/api'] });
  expect(launchDefaults(projects, [{ ...local, status: 'offline' }, nasOnline], {}).machine).toBe('nas');
  expect(launchDefaults(projects, machines, { filter: 'ledge' }).project).toBe('ledge');
  expect(launchDefaults([], machines, {}).project).toBeNull();
});
it('the first missing field is named in order', () => {
  const f = launchDefaults(projects, machines, {});
  expect(missingOf(f, machines)).toBe('tool');
  expect(missingOf({ ...f, tool: 'codex' }, machines)).toBe('prompt');
  expect(missingOf({ ...f, tool: 'codex', prompt: 'x' }, machines.map(m => ({ ...m, status: 'offline' })))).toBe('machine');
  expect(missingOf({ ...f, tool: 'codex', prompt: 'x', repos: [] }, machines)).toBe('repos');
  expect(missingOf({ ...f, tool: 'codex', prompt: ' x ' }, machines)).toBeNull();
});
it('one repository for Codex and Cursor, several for Claude', () => {
  let f = withTool({ ...launchDefaults(projects, machines, { project: 'ledge' }) }, 'claude');
  f = toggleRepo(f, '/w/ledge/docs');
  expect(f.repos).toEqual(['/w/ledge/app', '/w/ledge/docs']);
  expect(withTool(f, 'codex').repos).toEqual(['/w/ledge/app']);
  expect(toggleRepo(withTool(f, 'codex'), '/w/ledge/docs').repos).toEqual(['/w/ledge/docs']);
});
it('changing machine keeps only repositories there; a missing folder is never picked', () => {
  const infos = new Map([['/w/ledge/app', { path: '/w/ledge/app', exists: false, branch: null }]]);
  expect(withMachine(launchDefaults(projects, machines, { project: 'ledge' }), projects, 'nas', infos).repos).toEqual(['/srv/ledge']);
  expect(launchDefaults(projects, machines, { project: 'ledge' }, infos).repos).toEqual(['/w/ledge/docs']);
});
it('the preview: the free name on that machine, the next seat at the table', () => {
  // sessions: Otto (local, ledge), Pim (local, ledge, exited), Nova (nas, ledge) → on local, taken = { Otto } → name 'Pim'; seat = mains at the ledge table + 1
});
it('the message: first repo as cwd, the others as dirs for Claude only, the prompt trimmed', () => {
  expect(launchMessage({ tool: 'claude', prompt: ' Relis ', project: 'ledge', machine: 'local', repos: ['/w/ledge/app', '/w/ledge/docs'] }, 'Pim'))
    .toEqual({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge/app', dirs: ['/w/ledge/docs'], name: 'Pim', prompt: 'Relis', machineId: 'local' });
  expect(launchMessage({ tool: 'codex', prompt: 'x', project: 'ledge', machine: 'local', repos: ['/w/ledge/app'] }, 'Pim')).not.toHaveProperty('dirs');
});
```

Fixtures (dans le test) :
- `projects` :
  - `ledge`, avec `local:/w/ledge/app`, `local:/w/ledge/docs` et `nas:/srv/ledge` ;
  - `payment`, avec `local:/w/payment/api`.
- `machines` : `local` et `nas`, tous deux en ligne (`MachineState` du fleet).

« La place » compte les agents principaux de la table, comme `sceneOf`, sur toutes les machines : sous-agents exclus, mêmes états que ceux que l'Atelier assoit.

- [ ] **Step 2: Vérifier qu'ils échouent** — `pnpm --filter desktop exec vitest run test/launch-model.test.ts`. Expected : FAIL, module introuvable.
- [ ] **Step 3: Implémenter `model.ts`** (fonctions pures, sans React).
- [ ] **Step 4: Vérifier** — même commande, puis `pnpm --filter desktop typecheck`. Expected : PASS.
- [ ] **Step 5: Commit** — `feat(desktop): the launch form's model: defaults, repositories per machine, one or several by harness, the missing field, the preview, the message`

### Task 4: Le formulaire

**Files:**
- Create: `apps/desktop/src/launch/LaunchComposer.tsx`, `apps/desktop/src/launch/useRepoInfo.ts`, `apps/desktop/src/styles/launch.css`, `apps/desktop/test/launch.test.tsx`
- Modify: `apps/desktop/src/App.tsx` (la fenêtre `launch` remplace le `Pending`), `apps/desktop/src/i18n/messages.ts`, l'import des styles

**Interfaces:**
- Consumes : tâche 3 ; tâche 2 (`repos.inspect`, `FleetView`) ; `Modal`, `Bot`, `Button`, `Kbd`, `Icon`, `useTheme`, `useMotionPreferences`, la pastille de projet de la barre latérale (`side-swatch`, lot 3).
- Produces :

```ts
// launch/useRepoInfo.ts — un repos.inspect par (machine, ensemble de chemins), requestId propre, réponses d'une autre requête ignorées
export function useRepoInfo(client: DaemonClient, machine: string | null, paths: readonly string[]): ReadonlyMap<string, RepoInfo>;
// launch/LaunchComposer.tsx
export function LaunchComposer(p: { client: DaemonClient; projects: readonly Project[]; machines: readonly MachineState[]; sessions: readonly Session[];
  projectIdOf(s: Session): string | null; wanted: { project?: string; filter?: string }; onEditProject(id: string): void; onNewProject(): void;
  launch: LaunchState; onLaunch(msg: LaunchMessage, preview: { name: string; project: string }): void; onCancel(): void }): JSX.Element;
```

`LaunchState` et `onLaunch` viennent de la tâche 5. Dans cette tâche, `App` passe `{ status: 'idle' }`, et `onLaunch` est une fonction vide.

Rendu (`LaunchComposer` de la maquette, classes de `launch.css`) :
- la consigne a le focus à l'ouverture ;
- les suggestions s'affichent tant que la consigne est vide, et un clic remplit le champ et y remet le focus ;
- trois tuiles d'agent (`input[type=radio]`, bot `working` quand il est choisi, sinon `idle`, taille 46), sans choix par défaut ;
- les puces de projet portent la pastille de couleur ;
- les puces de machine : une machine hors ligne est désactivée, avec `small` « hors ligne » et un `title` ;
- le groupe de dépôts :
  - légende `Dépôts sur ${label}` ;
  - `checkbox` pour Claude, `radio` pour les autres, et un `small` qui dit « Un seul dépôt pour ${harnais} » quand le projet en a plusieurs sur la machine ;
  - chaque puce a pour `title` sa branche ou « Dossier sans Git » ;
  - un dossier introuvable donne une puce désactivée avec `small` « introuvable » ;
  - `span.chip-note` montre `⎇ ${branche}` du premier dépôt coché quand elle est connue ;
  - sans dépôt sur la machine : `p.muted` « Aucun dépôt de ${projet} sur ${machine}. » et un bouton « Modifier le projet » (`onEditProject`) ;
- sans aucun projet, à la place du bloc « où » : « Aucun projet pour l'instant. » / « Créez un projet pour y lancer des agents. », et un bouton « Nouveau projet » (`onNewProject`) ;
- le pied de page :
  - l'aperçu : le bot `starting` du harnais choisi, sinon le cercle pointillé, puis « {nom | Un nouvel agent} rejoindra la table {projet} » et `Place {n} · {machine} · {dépôts}` ;
  - le champ manquant (`role=alert`, seulement après une tentative), puis « Annuler » et « Lancer » avec `Kbd Ctrl ↵` ;
  - `aria-invalid` sur le champ manquant après une tentative.
- **Ctrl ↵** (et ⌘ ↵) soumet de n'importe où dans le formulaire. **Échap** ferme, comme toute fenêtre (lot 3).
- Les entrées existantes (barre latérale, N, plateau, « + » d'une table, groupe de la Liste, projet vide, « Nouvelle session ici ») passent déjà `{ kind: 'launch', project? }`. `wanted.filter` est le filtre de projet de la vue courante.
- `onEditProject(id)` ouvre `{ kind: 'project', edit: id }`, et `onNewProject()` ouvre `{ kind: 'project' }` (fenêtres du lot 8, encore en attente).

Textes (`launch.*`) :

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `prompt` / `placeholder` | `Consigne` / `Que doit faire l’agent ? Décrivez le résultat attendu.` | `Instruction` / `What should the agent do? Describe the expected result.` |
| `suggestions` / `ideas` | `Suggestions` / `['Relire la dernière pull request', 'Corriger les tests qui échouent', 'Mettre à jour la documentation']` | `Suggestions` / `['Review the latest pull request', 'Fix the failing tests', 'Update the documentation']` |
| `agent` / `tools` | `Agent` / `{ claude: ['Claude Code', 'Conception, revue'], codex: ['Codex', 'Code et tests'], cursor: ['Cursor Agent', 'Dans l’éditeur'] }` | `Agent` / `Design, review`, `Code and tests`, `In the editor` |
| `project` / `machine` / `offline` / `offlineTitle` | `Projet` / `Machine` / `hors ligne` / `Hors ligne : reconnectez la machine dans les réglages` | `Project` / `Machine` / `offline` / — |
| `repos(m)` / `noGit` / `notFound` / `oneRepo(t)` | `Dépôts sur ${m}` / `Dossier sans Git` / `introuvable` / `Un seul dépôt pour ${t}` | `Repositories on ${m}` / `Folder without Git` / `not found` / `One repository only for ${t}` |
| `noRepos(p, m)` / `editProject` | `Aucun dépôt de ${p} sur ${m}.` / `Modifier le projet` | `No repository of ${p} on ${m}.` / `Edit the project` |
| `noProjects` / `noProjectsBody` / `newProject` | `Aucun projet pour l’instant.` / `Créez un projet pour y lancer des agents.` / `Nouveau projet` | `No project yet.` / `Create a project to launch agents in it.` / `New project` |
| `newAgent` / `joins(n, t)` / `seat(n, m, r)` / `noRepo` | `Un nouvel agent` / `${n} rejoindra la table ${t}` / `Place ${n} · ${m} · ${r}` / `aucun dépôt` | `A new agent` / `${n} will join the ${t} table` / `Seat ${n} · ${m} · ${r}` / `no repository` |
| `missing` | `{ tool: 'Choisissez un agent', prompt: 'Écrivez la consigne', machine: 'Aucune machine en ligne', repos: 'Choisissez au moins un dépôt' }` | `Choose an agent`, `Write the instruction`, `No machine online`, `Choose at least one repository` |
| `cancel` / `launch` / `launching` | `Annuler` / `Lancer` / `Lancement…` | `Cancel` / `Launch` / `Launching…` |

`joins` s'affiche avec le nom et la table en `strong` : on peut le rendre en deux morceaux ou découper le texte. Les tests lisent le `textContent` de `.preview-line`.

- [ ] **Step 1: Écrire `test/launch.test.tsx`**

```tsx
async function openLaunch(opts: { project?: string; machines?: MachineState[] } = {}) {
  const env = await boot({ sessions: listSessions(), list: true, projects: twoProjects, repoInfo: new Map([['/w/ledge/docs', { path: '/w/ledge/docs', exists: true, branch: 'main' }], ['/w/ledge/app', { path: '/w/ledge/app', exists: true, branch: 'desktop' }]]) });
  await env.user.keyboard('n');
  return { ...env, form: within(await screen.findByRole('dialog', { name: 'New session' })) };
}
it('instruction first with suggestions; no harness by default; the preview names who joins which table', async () => {
  const { user, form } = await openLaunch();
  expect(form.getByRole('textbox', { name: 'Instruction' })).toHaveFocus();
  await user.click(form.getByRole('button', { name: 'Fix the failing tests' }));
  expect(form.getByRole('textbox', { name: 'Instruction' })).toHaveValue('Fix the failing tests');
  expect(form.queryByRole('button', { name: 'Review the latest pull request' })).toBeNull();
  expect(form.getAllByRole('radio', { checked: true }).map(r => r.getAttribute('name'))).not.toContain('tool');
  await user.click(form.getByRole('radio', { name: /Codex/ }));
  expect(document.querySelector('.preview-line')!.textContent).toMatch(/^\w+ will join the Ledge table$/);
  expect(document.querySelector('.composer-preview small')!.textContent).toMatch(/^Seat \d+ · /);
});
it('Launch with a field missing names it; Ctrl Enter launches when complete', async () => {
  const { user, form } = await openLaunch();
  await user.click(form.getByRole('button', { name: /Launch/ }));
  expect(form.getByRole('alert')).toHaveTextContent('Choose an agent');
  await user.click(form.getByRole('radio', { name: /Claude Code/ }));
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(form.getByRole('alert')).toHaveTextContent('Write the instruction');
});
it('Claude takes several repositories, Codex one; the branch shows; a missing folder cannot be picked', async () => {
  // claude: checkboxes, two checked possible; codex: radios + « One repository only for Codex »; « ⎇ desktop » in .chip-note;
  // repoInfo exists:false on one path → its chip disabled with « not found »
});
it('an offline machine is not selectable; the selected one going offline moves the choice or says none is online', async () => {
  // machine nas offline → its radio disabled, « offline »; d.machines(...) flips local offline while open → choice moves to nas, or alert 'No machine online' after a try
});
it('a project with no repository on the machine says so and offers to edit it; no project at all offers a new one', async () => {
  // project 'payment' has no repo on nas → « No repository of Payment Service on nas. » + « Edit the project » → modal project edit (title 'Edit project')
});
```

`boot` (helpers des tests) gagne `projects` et `repoInfo`, qu'il passe au faux daemon. Les fixtures `twoProjects` existent déjà pour les tests de projets du lot 4/5 ; il suffit de leur ajouter des dépôts `local` et, au besoin, une machine `nas`.

- [ ] **Step 2: Vérifier qu'il échoue** — `pnpm --filter desktop exec vitest run test/launch.test.tsx`. Expected : FAIL, pas de formulaire.
- [ ] **Step 3: Implémenter `useRepoInfo`, `LaunchComposer`, les textes, le CSS et le branchement dans `App`**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter desktop build`. Expected : tout passe, sans avertissement de taille de morceau. Le formulaire est léger ; s'il fait grossir le morceau principal au-delà de 500 kB, le charger avec le même `lazy.tsx` que la page de session.
- [ ] **Step 5: Commit** — `feat(desktop): the New session form: instruction and suggestions, the harness by its bot, project, machine, repositories with their branch, the preview, the missing field named`

### Task 5: Le lancement

**Files:**
- Create: `apps/desktop/src/launch/useLaunch.ts`, `apps/desktop/test/launch-flow.test.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/atelier/filing.ts` (place allumée), `apps/desktop/src/launch/LaunchComposer.tsx`, `apps/desktop/src/i18n/messages.ts`

**Interfaces:**
- Consumes : tâches 2 à 4 ; `FleetView.lastLaunched`, `FleetView.errors` (le refus porte `request: 'session.launch'` et pas d'`id`) ; `notify` ; `useFiling`.
- Produces :

```ts
export type LaunchState = { status: 'idle' } | { status: 'launching' } | { status: 'refused'; message: string } | { status: 'timeout' };
/** Un seul lancement à la fois : send, puis le prochain lastLaunched (seq plus grand que celui d'avant l'envoi) → onLaunched(id) ;
 *  la prochaine erreur session.launch → refused ; LAUNCH_TIMEOUT_MS sans rien → timeout. Une réponse arrivée après un reset (fenêtre fermée) est ignorée. */
export function useLaunch(view: FleetView, onLaunched: (id: string) => void): { state: LaunchState; launch(msg: LaunchMessage): void; reset(): void };
// filing.ts : useFiling gagne
markSeated(id: string): void;   // la place allumée (just-seated) et l'agent amené à l'écran, comme après un rangement
```

Comportement :
- **Lancement en cours** : « Lancement… », le bouton a `aria-disabled` et un second envoi (clic ou Ctrl ↵) ne part pas. Annuler et Échap ferment toujours la fenêtre. Ils ne tuent rien ; une session déjà démarrée apparaît à sa place.
- **`session.launched`** :
  - la fenêtre se ferme ;
  - si le filtre de projet n'est ni « Tous » ni le projet du lancement, il repasse à « Tous » (`dispatch({ type: 'home', project: 'all' })` en gardant la vue) ;
  - `markSeated(id)` allume la place ;
  - `notify(t.launch.started(nom, projet))`.

  L'agent paraît en « Démarrage » (état `starting`) puis « Au travail » au gré des mises à jour du daemon.
- **Refus** : `p.composer-missing[role=alert]` « Démarrage refusé : {message} », les valeurs restent, et « Lancer » redevient possible.
- **Délai** : `role=alert` `timeout`, et « Lancer » redevient possible.

| Clé | fr | en (fixé par les tests) |
| --- | --- | --- |
| `started(n, t)` | `${n} démarre à la table ${t}.` | `${n} is starting at the ${t} table.` |
| `refused(m)` | `Démarrage refusé : ${m}` | `Launch refused: ${m}` |
| `timeout` | `Le démarrage n’a pas répondu. Vérifiez la machine puis réessayez.` | `The launch did not answer. Check the machine, then try again.` |

- [ ] **Step 1: Écrire `test/launch-flow.test.tsx`**

```tsx
it('one launch at a time; launched: the form closes, the seat lights, the notice names agent and table', async () => {
  const { d, user, form } = await openLaunch();
  await user.type(form.getByRole('textbox', { name: 'Instruction' }), 'Relis la PR');
  await user.click(form.getByRole('radio', { name: /Codex/ }));
  d.holdLaunch();                                                    // the fake daemon answers only when released
  await user.keyboard('{Control>}{Enter}{/Control}');
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(form.getByRole('button', { name: /Launching…/ })).toHaveAttribute('aria-disabled', 'true');
  expect(d.received.filter(m => m.type === 'session.launch')).toEqual([{ type: 'session.launch', tool: 'codex', cwd: '/w/ledge/app', name: expect.any(String), prompt: 'Relis la PR' }]);
  d.releaseLaunch();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull());
  expect(screen.getByText(/ is starting at the Ledge table\.$/)).toBeVisible();
  expect(document.querySelector('.agent-seat.just-seated')).not.toBeNull();
});
it('a refusal stays in the form with its message and values; a retry is possible', async () => {
  // d.refuseLaunch('codex: command not found') → alert 'Launch refused: codex: command not found', instruction kept, Launch enabled again
});
it('no answer within 20 s says so; a late answer after closing does not reopen or toast', async () => {
  // fake timers: advance LAUNCH_TIMEOUT_MS → alert timeout text; Escape closes; release the held launch → no toast, no dialog
});
it('a launch from another project filter switches the filter to All', async () => {
  // filter 'payment' then launch into 'ledge' → filter All after launched
});
```

Le faux daemon du fleet gagne `holdLaunch()`, `releaseLaunch()` et `refuseLaunch(message)`. Le refus est une `error` sans `id`, avec `request: 'session.launch'`, comme le vrai daemon.

- [ ] **Step 2: Vérifier qu'il échoue** — `pnpm --filter desktop exec vitest run test/launch-flow.test.tsx`. Expected : FAIL.
- [ ] **Step 3: Implémenter `useLaunch`, `markSeated` et le branchement**
- [ ] **Step 4: Vérifier** — `pnpm --filter desktop test && pnpm --filter desktop typecheck && pnpm --filter @ledge/fleet test`. Expected : tout passe.
- [ ] **Step 5: Commit** — `feat(desktop): launching: one at a time, nothing optimistic, the form closes on launched and the agent's seat lights; refusals and silence are said in the form`

### Task 6: Le lancement dans le navigateur

**Files:**
- Create: `apps/desktop/e2e/launch.spec.ts`
- Modify: `apps/desktop/e2e/daemon.ts` (`repos.inspect` depuis `extras.repoInfo` ; `session.launch` ajoute une session `starting` puis la passe `working` 1,5 s plus tard, et répond `session.launched`)

Scénarios :
1. **N, consigne, Claude, deux dépôts, Ctrl ↵** :
   - un seul `session.launch` part, avec `dirs` ;
   - la fenêtre se ferme ;
   - le nouvel agent est assis à la table Ledge avec la place allumée, en « Démarrage », puis en « Au travail » (attendre son état) ;
   - le message « … démarre à la table Ledge » s'affiche.
2. **Fenêtre de 900 px de large** : le formulaire tient sans défilement horizontal (les tuiles passent en colonne sous 700 px, comme dans le CSS de la maquette), et Échap le ferme.
3. **Machine hors ligne** : sa puce est désactivée ; le formulaire reste utilisable sur `local`.

- [ ] **Step 1: Écrire les scénarios et étendre le faux daemon**
- [ ] **Step 2: Lancer Playwright** — `pnpm --filter desktop e2e`. Expected : 33 scénarios passent (les 30 d'avant et les 3 de `launch`).
- [ ] **Step 3: Vérification du dépôt** — paquet par paquet :
  - `pnpm --filter @ledge/protocol test` ;
  - `pnpm --filter @paradow/ledge test` ;
  - `pnpm --filter @ledge/fleet test` ;
  - `pnpm --filter desktop test` ;
  - `pnpm --filter overlay test` ;
  - `pnpm -r typecheck` ;
  - `pnpm -r build`.

  Expected : tout passe. Seule l'instabilité connue de l'overlay peut apparaître ; la signaler.
- [ ] **Step 4: Commit** — `test(desktop): launching a session in the browser: Claude with two repositories, the seat in Démarrage then Au travail, a narrow window, an offline machine`
