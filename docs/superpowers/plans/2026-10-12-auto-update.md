# Mise à jour automatique — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un tag `vX.Y.Z` publie le daemon sur npm (`@paradow/ledge`) et l'application signée sur GitHub. Ledge le voit, le dit, et met à jour les deux moitiés d'un clic sans perdre une session.

**Architecture:** l'overlay pilote. Il lit `latest.json` de la dernière release GitHub (plugin updater de Tauri), demande au daemon de se mettre à jour (`update.daemon`), attend qu'il revienne avec la bonne version et toutes ses sessions, puis installe l'application et la relance. Le daemon exécute `npm i -g` avec le npm de son propre Node et redémarre son service. Avant tout, le serveur tmux sort du cgroup du service pour qu'un redémarrage ne tue plus les agents.

**Tech Stack:** Node 22+ / TypeScript / tsup / ws / zod / vitest (daemon et protocole) ; React 19 / Vite / vitest / Playwright 1.49 (overlay) ; Tauri 2 avec `tauri-plugin-updater` et `tauri-plugin-process` (Rust, compilé seulement en CI) ; GitHub Actions ; npm.

**Spec:** [docs/superpowers/specs/2026-10-12-auto-update-design.md](../specs/2026-10-12-auto-update-design.md). Maquette : [docs/mockups/ledge-update.html](../../mockups/ledge-update.html).

## Global Constraints

- Une seule version pour tout : `MAJOR.MINOR.PATCH`, sans suffixe (`set-version.mjs` refuse les pré-versions : la version de fichier Windows est numérique).
- Nom npm : `@paradow/ledge`, commande `ledge`, `engines.node` `>=22`, publication publique avec provenance.
- Dépôt : `Paradow-dev/ledge`. Endpoint de l'updater : `https://github.com/Paradow-dev/ledge/releases/latest/download/latest.json`.
- Secrets déjà présents : `NPM_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Clé publique : `~/secrets/ledge-updater.key.pub` (jamais la clé privée dans le dépôt).
- Vérification au démarrage puis toutes les 6 heures. Attente du daemon redémarré : 45 s au plus. Délai de npm : 3 minutes.
- Rien ne se fait sans clic. Daemon d'abord, application ensuite. Aucune session perdue : refuser plutôt que risquer.
- Les ajouts au protocole sont tous optionnels : un vieux client et un nouveau daemon (et l'inverse) continuent de fonctionner.
- Textes visibles en français et en anglais via `apps/overlay/src/i18n/messages.ts`. Pas de tiret cadratin en incise ; phrases courtes.
- Tests (le filtre `ledge` devient `@paradow/ledge` à partir de la tâche 6) : `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/protocol test`, `pnpm --filter overlay test`, `pnpm typecheck` à la racine. Pas de Rust en local : le code Rust n'est compilé que par le workflow (voir tâche 9).
- Commits au style du dépôt (`feat(daemon): …`, `ci: …`), terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Ne jamais ajouter `docs/island-test-guide.md` (fichier non suivi de l'utilisateur).
- Environnement de test : voir la mémoire « Ledge test env quirks » (Node 26, Playwright 1.49 face au Chromium installé, flakiness e2e connue).

## Review Focus

1. **Le serveur tmux est déjà né dans le service** (cas réel de la machine de référence) : la mise à jour doit refuser avec `sessions-at-risk`, jamais redémarrer. Tests : tâche 2, « refuses when the tmux server lives in the daemon service », et tâche 5, « refuses when the tmux server lives in the daemon service ».
2. **Le daemon revient avec moins de sessions qu'avant** : l'application ne doit pas être installée, et la carte doit nommer les sessions manquantes. Une session retirée normalement pendant la mise à jour (`session.removed` reçu avant la coupure) ne compte pas. Test : tâche 11, « fails with sessions-lost… » et « a session removed before the restart is not lost ».
3. **Le npm trouvé dans le PATH n'est pas celui du daemon** (`/usr/bin/npm` Node 18 contre nvm Node 26) : la commande doit utiliser le npm voisin de `process.execPath`. Test : tâche 5, « uses the npm next to the running node ».
4. **Le daemon est déjà à la version cible** (clone mis à jour à la main, ou nouvel essai après un échec de l'application) : le clic doit sauter l'étape daemon et aller directement au téléchargement. Test : tâche 11, « skips the daemon step when it already runs the target ».
5. **Deux clics, ou deux overlays connectés** : une seule mise à jour à la fois côté daemon (`busy`). Test : tâche 5, « answers busy while an update runs ».

---

## Carte des fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/ledge/src/tmux.ts` (modifié) | `runFile`, `newSessionCommand`, `systemdAvailable` ; `realTmux(socket, { scope })` lance le premier serveur dans un scope systemd. |
| `packages/ledge/src/update/guard.ts` (nouveau) | `inDaemonService`, `tmuxServerAtRisk` : le serveur tmux vit-il dans le cgroup du service ? |
| `packages/ledge/src/version.ts` (nouveau) | `LEDGE_VERSION`, injectée par tsup. |
| `packages/ledge/src/update/self.ts` (nouveau) | `installKind`, `gitRoot`, `underSystemd`, `manualCommand`, `daemonInfo()`. |
| `packages/ledge/src/update/run-update.ts` (nouveau) | `npmCommand`, `lastLines`, `createDaemonUpdater` (logique pure, dépendances injectées), `realUpdaterDeps`. |
| `packages/ledge/src/daemon/server.ts`, `daemon/index.ts` (modifiés) | `snapshot.daemon`, `case 'update.daemon'`. |
| `packages/ledge/src/cli/setup.ts` (modifié) | `relinkBin` : `~/.local/bin/ledge` suit la version npm. |
| `packages/ledge/src/cli/index.ts` (modifié) | `ledge --version`. |
| `packages/ledge/package.json`, `packages/ledge/tsup.config.ts` (nouveau) | Paquet `@paradow/ledge`, protocole intégré au bundle, version injectée. |
| `packages/protocol/src/messages.ts` (modifié) | `DaemonInfoSchema`, `update.progress`, `update.failed`, `update.daemon`. |
| `apps/overlay/scripts/set-version.mjs` (modifié) | Écrit aussi `packages/ledge/package.json`. |
| `apps/overlay/scripts/latest-json.mjs` (nouveau) | Construit `latest.json` à partir du tag, de l'installeur et de sa signature. |
| `.github/workflows/release.yml` (modifié) | Job `npm`, artefacts de l'updater, `latest.json`, déclenchement manuel sans publication. |
| `apps/overlay/src-tauri/*` (modifiés) | Plugins updater et process, clé publique, permissions. |
| `apps/overlay/src/update/semver.ts` (nouveau) | `compareVersions`. |
| `apps/overlay/src/update/machine.ts` (nouveau) | Machine d'état pure de la mise à jour et ses sélecteurs (`cardView`, `pipTone`). |
| `apps/overlay/src/update/bridge.ts` (nouveau) | Adaptateur vers `@tauri-apps/plugin-updater`, `plugin-process`, `api/app`. |
| `apps/overlay/src/update/prefs.ts` (nouveau) | `localStorage` : recherche auto, version écartée, dernière vérification, version d'avant. |
| `apps/overlay/src/update/useUpdate.ts` (nouveau) | Le contrôleur React : branche machine, daemon, updater, minuteries. |
| `apps/overlay/src/update/UpdateCard.tsx` (nouveau) | La carte de la liste. |
| `apps/overlay/src/daemon/store.ts` (modifié) | Garde `daemon`, `snapshotSeq`, `lastUpdate`. |
| `apps/overlay/src/surface/SessionList.tsx`, `Handle.tsx`, `SettingsView.tsx`, `Surface.tsx`, `App.tsx` (modifiés) | Emplacement de la carte, pastilles, onglet « À propos ». |
| `apps/overlay/src/i18n/messages.ts` (modifié) | Textes `update.*` et `settings.about*`. |
| `README.md`, `packages/ledge/README.md` (modifiés) | Installation npm, mise à jour par le bouton. |

---

### Task 1 : le premier serveur tmux naît dans son propre scope systemd

**Files:**
- Modify: `packages/ledge/src/tmux.ts`
- Test: `packages/ledge/test/tmux-scope.test.ts` (nouveau), `packages/ledge/test/tmux.test.ts` (passer `scope: async () => false`)

**Interfaces:**
- Produces:
  - `runFile(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }>`. `run(args, env)` devient `runFile('tmux', args, env)`.
  - `newSessionCommand(tmuxArgs: string[], scoped: boolean, unit: string): { file: string; args: string[] }`.
  - `systemdAvailable(env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean): boolean`.
  - `realTmux(socket = 'ledge', opts: { scope?: () => Promise<boolean> } = {}): Tmux`. Par défaut, `scope` vaut `async () => systemdAvailable()`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// packages/ledge/test/tmux-scope.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { newSessionCommand, systemdAvailable, realTmux, run } from '../src/tmux.js';
import { killTestServer } from './helpers.js';

describe('newSessionCommand', () => {
  it('runs tmux directly when not scoped', () => {
    expect(newSessionCommand(['-L', 'ledge', 'new-session', '-d'], false, 'u')).toEqual({ file: 'tmux', args: ['-L', 'ledge', 'new-session', '-d'] });
  });
  it('wraps tmux in a transient user scope when scoped, so the server leaves the caller cgroup', () => {
    expect(newSessionCommand(['-L', 'ledge', 'new-session', '-d'], true, 'ledge-tmux-42')).toEqual({
      file: 'systemd-run',
      args: ['--user', '--scope', '--quiet', '--collect', '--unit=ledge-tmux-42', '--', 'tmux', '-L', 'ledge', 'new-session', '-d']
    });
  });
});

describe('systemdAvailable', () => {
  it('needs the user manager socket under XDG_RUNTIME_DIR', () => {
    expect(systemdAvailable({ XDG_RUNTIME_DIR: '/run/user/1000' }, p => p === '/run/user/1000/systemd/private')).toBe(true);
    expect(systemdAvailable({ XDG_RUNTIME_DIR: '/run/user/1000' }, () => false)).toBe(false);
    expect(systemdAvailable({}, () => true)).toBe(false);
  });
});

const socket = `ledge-scope-${process.pid}-${Date.now()}`;
afterAll(async () => { await killTestServer(socket); });

describe.skipIf(!systemdAvailable())('a scoped server (real systemd)', () => {
  it('lives in its own ledge-tmux scope, not in the caller cgroup', async () => {
    const tmux = realTmux(socket, { scope: async () => true });
    await tmux.newSession({ name: 'ledge-s1', cwd: '/tmp', env: {}, command: ['cat'] });
    const pid = (await run(['-L', socket, 'list-sessions', '-F', '#{pid}'])).stdout.trim().split('\n')[0]!;
    expect(readFileSync(`/proc/${pid}/cgroup`, 'utf8')).toMatch(/ledge-tmux-\d+\.scope/);
  });
  it('does not open a second scope once the server runs', async () => {
    const tmux = realTmux(socket, { scope: async () => true });
    await tmux.newSession({ name: 'ledge-s2', cwd: '/tmp', env: {}, command: ['cat'] });
    expect(await tmux.listSessions()).toEqual(expect.arrayContaining(['ledge-s1', 'ledge-s2']));
  });
});
```

Dans `packages/ledge/test/tmux.test.ts`, remplacer `const tmux = realTmux(socket);` par `const tmux = realTmux(socket, { scope: async () => false });`. Les autres tests restent sans scope.

- [ ] **Step 2 : lancer, constater l'échec**

Run: `pnpm --filter ledge exec vitest run test/tmux-scope.test.ts`
Expected: FAIL, `newSessionCommand is not a function`.

- [ ] **Step 3 : implémenter dans `packages/ledge/src/tmux.ts`**

```ts
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.js';

export function runFile(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024, env }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? (err as unknown as { code: number }).code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
export const run = (args: string[], env?: NodeJS.ProcessEnv) => runFile('tmux', args, env);

/** The user manager answers on this socket: present when WSL runs systemd (`systemd=true`). */
export function systemdAvailable(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): boolean {
  return !!env.XDG_RUNTIME_DIR && exists(join(env.XDG_RUNTIME_DIR, 'systemd', 'private'));
}

/**
 * The tmux server forks from the client that starts it and stays in that client's cgroup. Started from the daemon, it
 * would sit in ledge-daemon.service and die with every restart, taking every agent with it (spec 2026-10-12 auto-update §3).
 * Scoped, the first `new-session` runs under its own transient scope, so the server outlives the daemon.
 */
export function newSessionCommand(tmuxArgs: string[], scoped: boolean, unit: string): { file: string; args: string[] } {
  if (!scoped) return { file: 'tmux', args: tmuxArgs };
  return { file: 'systemd-run', args: ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', 'tmux', ...tmuxArgs] };
}
```

Dans `realTmux`, nouvelle signature `realTmux(socket = 'ledge', opts: { scope?: () => Promise<boolean> } = {})`, avec `const scope = opts.scope ?? (async () => systemdAvailable());`. `newSession` devient :

```ts
    async newSession({ name, cwd, env, command }) {
      const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
      const clientEnv = env.PATH === undefined ? undefined : { ...process.env, PATH: env.PATH };
      const args = [...base(), 'new-session', '-d', '-s', name, '-c', cwd, '-x', '200', '-y', '50', ...envArgs, '--', ...command];
      // Only the call that starts the server needs a scope: later sessions are created by that server.
      const serverUp = (await t(['list-sessions'])).code === 0;
      const { file, args: argv } = newSessionCommand(args, !serverUp && await scope(), `ledge-tmux-${Date.now()}`);
      const r = await runFile(file, argv, clientEnv);
      if (r.code !== 0) throw new Error(`tmux new-session failed: ${r.stderr.trim()}`);
    },
```

- [ ] **Step 4 : lancer les tests**

Run: `pnpm --filter ledge exec vitest run test/tmux-scope.test.ts test/tmux.test.ts test/launch.test.ts test/e2e.test.ts`
Expected: PASS. Le bloc « real systemd » s'exécute sur la machine de référence (systemd présent).

- [ ] **Step 5 : commit**

```bash
git add packages/ledge/src/tmux.ts packages/ledge/test/tmux-scope.test.ts packages/ledge/test/tmux.test.ts
git commit -m "fix(daemon): start the tmux server in its own systemd scope so a daemon restart keeps every agent"
```

---

### Task 2 : le garde-fou « sessions à risque »

**Files:**
- Create: `packages/ledge/src/update/guard.ts`
- Test: `packages/ledge/test/update-guard.test.ts`

**Interfaces:**
- Consumes: `run` (tâche 1).
- Produces:
  - `inDaemonService(cgroup: string): boolean`.
  - `tmuxServerAtRisk(opts?: { socket?: string; runTmux?: typeof run; readCgroup?: (pid: string) => Promise<string> }): Promise<boolean>`.

- [ ] **Step 1 : tests**

```ts
// packages/ledge/test/update-guard.test.ts
import { describe, it, expect } from 'vitest';
import { inDaemonService, tmuxServerAtRisk } from '../src/update/guard.js';

const IN_SERVICE = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/ledge-daemon.service\n';
const IN_SCOPE = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/ledge-tmux-1760266000000.scope\n';

describe('inDaemonService', () => {
  it('spots the daemon service in a cgroup line', () => {
    expect(inDaemonService(IN_SERVICE)).toBe(true);
    expect(inDaemonService(IN_SCOPE)).toBe(false);
  });
});

describe('tmuxServerAtRisk', () => {
  const tmuxWith = (stdout: string, code = 0) => async () => ({ code, stdout, stderr: code ? 'no server running on /tmp/tmux-1000/ledge' : '' });
  it('refuses when the tmux server lives in the daemon service', async () => {
    expect(await tmuxServerAtRisk({ runTmux: tmuxWith('406005\n406005\n'), readCgroup: async () => IN_SERVICE })).toBe(true);
  });
  it('is safe when the server has its own scope', async () => {
    expect(await tmuxServerAtRisk({ runTmux: tmuxWith('5000\n'), readCgroup: async () => IN_SCOPE })).toBe(false);
  });
  it('is safe when no server runs', async () => {
    expect(await tmuxServerAtRisk({ runTmux: tmuxWith('', 1), readCgroup: async () => { throw new Error('unused'); } })).toBe(false);
  });
  it('fails closed when the cgroup cannot be read', async () => {
    expect(await tmuxServerAtRisk({ runTmux: tmuxWith('5000\n'), readCgroup: async () => { throw new Error('EACCES'); } })).toBe(true);
  });
});
```

- [ ] **Step 2 : lancer, constater l'échec**

Run: `pnpm --filter ledge exec vitest run test/update-guard.test.ts` — Expected: FAIL (module absent).

- [ ] **Step 3 : implémenter**

```ts
// packages/ledge/src/update/guard.ts
import { readFile } from 'node:fs/promises';
import { run } from '../tmux.js';

export const SERVICE = 'ledge-daemon.service';

/** A `/proc/<pid>/cgroup` text: true when the process belongs to the daemon's unit (killed with it on restart). */
export const inDaemonService = (cgroup: string): boolean => cgroup.split('\n').some(l => l.split('/').includes(SERVICE));

/**
 * Whether restarting the daemon would kill the tmux server, hence every agent. A server started before the scope fix
 * still lives in the service. An unreadable cgroup counts as at risk: refusing an update costs less than losing sessions.
 */
export async function tmuxServerAtRisk(opts: { socket?: string; runTmux?: typeof run; readCgroup?: (pid: string) => Promise<string> } = {}): Promise<boolean> {
  const runTmux = opts.runTmux ?? run;
  const readCgroup = opts.readCgroup ?? (pid => readFile(`/proc/${pid}/cgroup`, 'utf8'));
  const r = await runTmux(['-L', opts.socket ?? 'ledge', 'list-sessions', '-F', '#{pid}']);
  if (r.code !== 0) return false;
  const pid = r.stdout.split('\n').map(s => s.trim()).find(Boolean);
  if (!pid) return false;
  try { return inDaemonService(await readCgroup(pid)); } catch { return true; }
}
```

- [ ] **Step 4 : tests verts** — `pnpm --filter ledge exec vitest run test/update-guard.test.ts` → PASS.

- [ ] **Step 5 : commit**

```bash
git add packages/ledge/src/update/guard.ts packages/ledge/test/update-guard.test.ts
git commit -m "feat(daemon): tell when a restart would take the tmux server down"
```

---

### Task 3 : le protocole de mise à jour

**Files:**
- Modify: `packages/protocol/src/messages.ts`
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces (exportés par `@ledge/protocol`) :
  - `SEMVER = /^\d+\.\d+\.\d+$/`.
  - `DaemonInfoSchema` / `type DaemonInfo = { version: string; install: 'npm' | 'git' | 'unknown'; systemd: boolean; manual?: string }`.
  - `UpdateFailureSchema` / `type UpdateFailure = 'git-install' | 'no-systemd' | 'sessions-at-risk' | 'npm-failed' | 'busy'`.
  - Serveur : `snapshot.daemon?`, `{ type: 'update.progress'; version; step: 'installing' | 'restarting' }`, `{ type: 'update.failed'; version; reason: UpdateFailure; detail?; command? }`.
  - Client : `{ type: 'update.daemon'; version }` (semver strict).

- [ ] **Step 1 : tests** (à ajouter dans `messages.test.ts`)

```ts
import { parseServerMessage, parseClientMessage } from '../src/index.js';

describe('update messages', () => {
  it('keeps a snapshot without daemon info valid (older daemons)', () => {
    expect(parseServerMessage({ type: 'snapshot', sessions: [] })).toEqual({ type: 'snapshot', sessions: [] });
  });
  it('carries the daemon version, how it was installed and the manual command', () => {
    const m = parseServerMessage({ type: 'snapshot', sessions: [], daemon: { version: '0.3.0', install: 'git', systemd: true, manual: 'cd ~/x && git pull' } });
    expect(m).toMatchObject({ daemon: { version: '0.3.0', install: 'git', systemd: true } });
  });
  it('parses progress and failures', () => {
    expect(parseServerMessage({ type: 'update.progress', version: '0.3.0', step: 'restarting' })).toMatchObject({ step: 'restarting' });
    expect(parseServerMessage({ type: 'update.failed', version: '0.3.0', reason: 'npm-failed', detail: 'EACCES', command: 'npm i -g @paradow/ledge@0.3.0' })).toMatchObject({ reason: 'npm-failed' });
    expect(() => parseServerMessage({ type: 'update.failed', version: '0.3.0', reason: 'nope' })).toThrow();
  });
  it('accepts update.daemon only with a plain semver', () => {
    expect(parseClientMessage({ type: 'update.daemon', version: '0.3.0' })).toEqual({ type: 'update.daemon', version: '0.3.0' });
    expect(() => parseClientMessage({ type: 'update.daemon', version: 'latest' })).toThrow();
    expect(() => parseClientMessage({ type: 'update.daemon', version: '0.3.0; rm -rf ~' })).toThrow();
  });
});
```

- [ ] **Step 2 : échec** — `pnpm --filter @ledge/protocol test` → FAIL.

- [ ] **Step 3 : implémenter** dans `messages.ts`, avant `ServerMessageSchema` :

```ts
/** A release version as the tag gives it, without the `v` and without a pre-release suffix. */
export const SEMVER = /^\d+\.\d+\.\d+$/;
/** What the daemon knows of itself (spec 2026-10-12 auto-update §6): its version, how it was installed, whether it runs
 *  as the systemd service, and the command a person runs by hand when it cannot update itself. */
export const DaemonInfoSchema = z.object({ version: z.string(), install: z.enum(['npm', 'git', 'unknown']), systemd: z.boolean(), manual: z.string().optional() });
export type DaemonInfo = z.infer<typeof DaemonInfoSchema>;
export const UpdateFailureSchema = z.enum(['git-install', 'no-systemd', 'sessions-at-risk', 'npm-failed', 'busy']);
export type UpdateFailure = z.infer<typeof UpdateFailureSchema>;
```

`snapshot` : ajouter `daemon: DaemonInfoSchema.optional()`. Dans `ServerMessageSchema`, ajouter :

```ts
  /** The daemon updating itself: npm is running, then the service restarts (the socket closes right after). */
  z.object({ type: z.literal('update.progress'), version: z.string(), step: z.enum(['installing', 'restarting']) }),
  /** Nothing was changed. `detail`: the useful end of npm's output; `command`: what the person can run instead. */
  z.object({ type: z.literal('update.failed'), version: z.string(), reason: UpdateFailureSchema, detail: z.string().optional(), command: z.string().optional() }),
```

Dans `ClientMessageSchema` :

```ts
  /** Install `@paradow/ledge@version` and restart the service (spec 2026-10-12 auto-update §6). */
  z.object({ type: z.literal('update.daemon'), version: z.string().regex(SEMVER) }),
```

Vérifier que `packages/protocol/src/index.ts` réexporte bien tout `messages.ts` (sinon ajouter les exports).

- [ ] **Step 4 : tests verts et typecheck** — `pnpm --filter @ledge/protocol test && pnpm typecheck` → PASS. Le `switch` de `server.ts` reste exhaustif ; s'il y a un `never` de contrôle, ajouter temporairement `case 'update.daemon': return;` (remplacé en tâche 5).

- [ ] **Step 5 : commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): daemon version in the snapshot, update.daemon and its progress"
```

---

### Task 4 : le daemon connaît sa version et son mode d'installation

**Files:**
- Create: `packages/ledge/src/version.ts`, `packages/ledge/src/update/self.ts`, `packages/ledge/tsup.config.ts`
- Modify: `packages/ledge/package.json` (script `build`), `packages/ledge/src/cli/index.ts` (`--version`)
- Test: `packages/ledge/test/update-self.test.ts`

**Interfaces:**
- Produces:
  - `LEDGE_VERSION: string` (`'0.0.0-dev'` hors build).
  - `gitRoot(script: string, exists?: (p: string) => boolean): string | null`.
  - `installKind(script: string, exists?: (p: string) => boolean): 'npm' | 'git' | 'unknown'`.
  - `underSystemd(env: NodeJS.ProcessEnv, cgroup: string): boolean`.
  - `manualCommand(root: string): string`.
  - `daemonInfo(): Promise<DaemonInfo>`.

- [ ] **Step 1 : tests**

```ts
// packages/ledge/test/update-self.test.ts
import { describe, it, expect } from 'vitest';
import { gitRoot, installKind, underSystemd, manualCommand } from '../src/update/self.js';
import { LEDGE_VERSION } from '../src/version.js';

const NPM = '/home/u/.local/share/nvm/v26.7.0/lib/node_modules/@paradow/ledge/dist/cli/index.js';
const CLONE = '/home/u/soft/ledge/packages/ledge/dist/cli/index.js';
const hasGit = (p: string) => p === '/home/u/soft/ledge/.git';

describe('installKind', () => {
  it('is npm under a global node_modules', () => { expect(installKind(NPM, hasGit)).toBe('npm'); });
  it('is git inside a clone', () => { expect(installKind(CLONE, hasGit)).toBe('git'); expect(gitRoot(CLONE, hasGit)).toBe('/home/u/soft/ledge'); });
  it('is unknown elsewhere', () => { expect(installKind('/opt/ledge/index.js', () => false)).toBe('unknown'); });
});

describe('underSystemd', () => {
  const CG = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/ledge-daemon.service\n';
  it('needs both the invocation id and the service cgroup', () => {
    expect(underSystemd({ INVOCATION_ID: 'abc' }, CG)).toBe(true);
    expect(underSystemd({}, CG)).toBe(false);
    expect(underSystemd({ INVOCATION_ID: 'abc' }, '0::/user.slice/session-2.scope\n')).toBe(false);
  });
});

describe('manualCommand', () => {
  it('pulls, rebuilds and restarts from the clone', () => {
    expect(manualCommand('/home/u/soft/ledge')).toBe('cd /home/u/soft/ledge && git pull && pnpm install && pnpm --filter @paradow/ledge build && systemctl --user restart ledge-daemon');
  });
});

describe('LEDGE_VERSION', () => {
  it('falls back to a dev version when not built', () => { expect(LEDGE_VERSION).toBe('0.0.0-dev'); });
});
```

- [ ] **Step 2 : échec** — `pnpm --filter ledge exec vitest run test/update-self.test.ts` → FAIL.

- [ ] **Step 3 : implémenter**

```ts
// packages/ledge/src/version.ts
declare const __LEDGE_VERSION__: string | undefined;
/** The package version, written in by tsup at build time; tests and `tsx` runs see the dev fallback. */
export const LEDGE_VERSION: string = typeof __LEDGE_VERSION__ === 'string' ? __LEDGE_VERSION__ : '0.0.0-dev';
```

```ts
// packages/ledge/src/update/self.ts
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DaemonInfo } from '@ledge/protocol';
import { LEDGE_VERSION } from '../version.js';
import { SERVICE, inDaemonService } from './guard.js';

export function gitRoot(script: string, exists: (p: string) => boolean = existsSync): string | null {
  for (let dir = dirname(script); ; dir = dirname(dir)) {
    if (exists(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

export function installKind(script: string, exists: (p: string) => boolean = existsSync): DaemonInfo['install'] {
  if (script.includes('/node_modules/@paradow/ledge/')) return 'npm';
  return gitRoot(script, exists) ? 'git' : 'unknown';
}

/** systemd sets INVOCATION_ID for every unit it starts; the cgroup says which one. */
export const underSystemd = (env: NodeJS.ProcessEnv, cgroup: string): boolean => !!env.INVOCATION_ID && inDaemonService(cgroup);

export const manualCommand = (root: string): string =>
  `cd ${root} && git pull && pnpm install && pnpm --filter @paradow/ledge build && systemctl --user restart ${SERVICE.replace(/\.service$/, '')}`;

export async function daemonInfo(): Promise<DaemonInfo> {
  const script = await realpath(process.argv[1] ?? '').catch(() => process.argv[1] ?? '');
  const cgroup = await readFile('/proc/self/cgroup', 'utf8').catch(() => '');
  const install = installKind(script);
  const root = install === 'git' ? gitRoot(script) : null;
  return { version: LEDGE_VERSION, install, systemd: underSystemd(process.env, cgroup), ...(root ? { manual: manualCommand(root) } : {}) };
}
```

```ts
// packages/ledge/tsup.config.ts
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist/cli',
  clean: true,
  // The protocol is a workspace package, not published: it ships inside the bundle.
  noExternal: ['@ledge/protocol'],
  define: { __LEDGE_VERSION__: JSON.stringify(version) }
});
```

`packages/ledge/package.json` : `"build": "tsup"`.

`packages/ledge/src/cli/index.ts`, en tête du `switch` des commandes (à côté de `case 'daemon'`) :

```ts
    case '--version': case 'version': { const { LEDGE_VERSION } = await import('../version.js'); console.log(LEDGE_VERSION); return 0; }
```

Ajouter la ligne `ledge --version                                              print the installed version` dans `USAGE`.

- [ ] **Step 4 : tests et build**

Run: `pnpm --filter ledge exec vitest run test/update-self.test.ts && pnpm --filter ledge build && node packages/ledge/dist/cli/index.js --version && grep -c "@ledge/protocol" packages/ledge/dist/cli/index.js || true`
Expected: tests PASS ; `--version` affiche `0.1.0` (la version actuelle du paquet, alignée en tâche 6) ; aucun `import ... from "@ledge/protocol"` restant dans le bundle (le grep peut trouver des commentaires, pas un import).

- [ ] **Step 5 : commit**

```bash
git add packages/ledge/src/version.ts packages/ledge/src/update/self.ts packages/ledge/tsup.config.ts packages/ledge/package.json packages/ledge/src/cli/index.ts packages/ledge/test/update-self.test.ts
git commit -m "feat(daemon): know its own version and whether npm or a clone installed it"
```

---

### Task 5 : `update.daemon` — npm, puis redémarrage du service

**Files:**
- Create: `packages/ledge/src/update/run-update.ts`
- Modify: `packages/ledge/src/daemon/server.ts`, `packages/ledge/src/daemon/index.ts`
- Test: `packages/ledge/test/update-run.test.ts`, `packages/ledge/test/server.test.ts`

**Interfaces:**
- Consumes: `DaemonInfo`, `UpdateFailure`, `ServerMessage` (tâche 3) ; `tmuxServerAtRisk` (tâche 2) ; `daemonInfo` (tâche 4) ; `runFile` (tâche 1).
- Produces:
  - `npmCommand(execPath: string, version: string): { file: string; args: string[] }`.
  - `lastLines(output: string, n?: number): string`.
  - `interface UpdaterDeps { info: () => DaemonInfo; atRisk: () => Promise<boolean>; npm: (cmd: { file: string; args: string[] }) => Promise<{ code: number; output: string }>; restart: () => Promise<void>; save: () => Promise<void>; execPath?: string }`.
  - `createDaemonUpdater(deps: UpdaterDeps): { update(version: string, send: (m: ServerMessage) => void): Promise<void>; running(): boolean }`.
  - `realUpdaterDeps(opts: { info: DaemonInfo; save: () => Promise<void> }): UpdaterDeps`.
  - `startServer` reçoit `daemon?: DaemonInfo` et `updater?: ReturnType<typeof createDaemonUpdater>`.

- [ ] **Step 1 : tests de la logique**

```ts
// packages/ledge/test/update-run.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { DaemonInfo, ServerMessage } from '@ledge/protocol';
import { createDaemonUpdater, npmCommand, lastLines, type UpdaterDeps } from '../src/update/run-update.js';

const NPM_INFO: DaemonInfo = { version: '0.2.2', install: 'npm', systemd: true };
function deps(over: Partial<UpdaterDeps> = {}): UpdaterDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls, execPath: '/home/u/.local/share/nvm/v26.7.0/bin/node',
    info: () => NPM_INFO, atRisk: async () => false,
    npm: async cmd => { calls.push(`npm ${cmd.file} ${cmd.args.join(' ')}`); return { code: 0, output: 'added 1 package' }; },
    restart: async () => { calls.push('restart'); }, save: async () => { calls.push('save'); },
    ...over
  };
}
const collect = () => { const sent: ServerMessage[] = []; return { sent, send: (m: ServerMessage) => { sent.push(m); } }; };

describe('npmCommand', () => {
  it('uses the npm next to the running node, not the one on PATH', () => {
    expect(npmCommand('/home/u/.local/share/nvm/v26.7.0/bin/node', '0.3.0')).toEqual({ file: '/home/u/.local/share/nvm/v26.7.0/bin/npm', args: ['i', '-g', '@paradow/ledge@0.3.0'] });
  });
});

describe('lastLines', () => {
  it('keeps the end of npm output, without blank lines', () => {
    expect(lastLines('a\n\nnpm ERR! code EACCES\nnpm ERR! path /usr/local/lib/node_modules\n\n', 2)).toBe('npm ERR! code EACCES\nnpm ERR! path /usr/local/lib/node_modules');
  });
});

describe('createDaemonUpdater', () => {
  it('installs, says so, saves the journal, then restarts', async () => {
    const d = deps(); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent).toEqual([{ type: 'update.progress', version: '0.3.0', step: 'installing' }, { type: 'update.progress', version: '0.3.0', step: 'restarting' }]);
    expect(d.calls).toEqual(['npm /home/u/.local/share/nvm/v26.7.0/bin/npm i -g @paradow/ledge@0.3.0', 'save', 'restart']);
  });
  it('refuses a clone and gives its command, touching nothing', async () => {
    const d = deps({ info: () => ({ version: '0.2.2', install: 'git', systemd: true, manual: 'cd /c && git pull' }) }); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent).toEqual([{ type: 'update.failed', version: '0.3.0', reason: 'git-install', command: 'cd /c && git pull' }]);
    expect(d.calls).toEqual([]);
  });
  it('refuses without systemd and gives the npm command', async () => {
    const d = deps({ info: () => ({ ...NPM_INFO, systemd: false }) }); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent[0]).toMatchObject({ reason: 'no-systemd', command: '/home/u/.local/share/nvm/v26.7.0/bin/npm i -g @paradow/ledge@0.3.0' });
    expect(d.calls).toEqual([]);
  });
  it('refuses when the tmux server lives in the daemon service', async () => {
    const d = deps({ atRisk: async () => true }); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent).toEqual([{ type: 'update.failed', version: '0.3.0', reason: 'sessions-at-risk' }]);
    expect(d.calls).toEqual([]);
  });
  it('reports npm failures with its output and never restarts', async () => {
    const d = deps({ npm: async () => ({ code: 243, output: 'npm ERR! code EACCES\nnpm ERR! path /usr/local/lib/node_modules\n' }) }); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent.at(-1)).toMatchObject({ type: 'update.failed', reason: 'npm-failed', detail: expect.stringContaining('EACCES'), command: expect.stringContaining('@paradow/ledge@0.3.0') });
    expect(d.calls).not.toContain('restart');
  });
  it('answers busy while an update runs', async () => {
    let release!: () => void;
    const d = deps({ npm: () => new Promise(r => { release = () => r({ code: 0, output: '' }); }) });
    const u = createDaemonUpdater(d); const a = collect(); const b = collect();
    const first = u.update('0.3.0', a.send);
    await vi.waitFor(() => expect(u.running()).toBe(true));
    await u.update('0.3.0', b.send);
    expect(b.sent).toEqual([{ type: 'update.failed', version: '0.3.0', reason: 'busy' }]);
    release(); await first;
    expect(u.running()).toBe(false);
  });
});
```

- [ ] **Step 2 : échec** — `pnpm --filter ledge exec vitest run test/update-run.test.ts` → FAIL.

- [ ] **Step 3 : implémenter `run-update.ts`**

```ts
// packages/ledge/src/update/run-update.ts
import { dirname, join } from 'node:path';
import type { DaemonInfo, ServerMessage } from '@ledge/protocol';
import { runFile } from '../tmux.js';
import { log } from '../log.js';
import { tmuxServerAtRisk, SERVICE } from './guard.js';

export const PACKAGE = '@paradow/ledge';
const NPM_TIMEOUT_MS = 3 * 60_000;

/** The npm of the node running the daemon: under nvm, the one on PATH may be another node's (and need sudo). */
export const npmCommand = (execPath: string, version: string) => ({ file: join(dirname(execPath), 'npm'), args: ['i', '-g', `${PACKAGE}@${version}`] });
export const lastLines = (output: string, n = 3) => output.split('\n').map(l => l.trimEnd()).filter(Boolean).slice(-n).join('\n');

export interface UpdaterDeps {
  info: () => DaemonInfo;
  atRisk: () => Promise<boolean>;
  npm: (cmd: { file: string; args: string[] }) => Promise<{ code: number; output: string }>;
  restart: () => Promise<void>;
  save: () => Promise<void>;
  execPath?: string;
}

/** Spec 2026-10-12 auto-update §6: every refusal leaves the install untouched; the restart comes only after npm succeeded. */
export function createDaemonUpdater(deps: UpdaterDeps) {
  let busy = false;
  return {
    running: () => busy,
    async update(version: string, send: (m: ServerMessage) => void): Promise<void> {
      if (busy) return send({ type: 'update.failed', version, reason: 'busy' });
      const info = deps.info();
      const cmd = npmCommand(deps.execPath ?? process.execPath, version);
      const shown = `${cmd.file} ${cmd.args.join(' ')}`;
      if (info.install !== 'npm') return send({ type: 'update.failed', version, reason: 'git-install', ...(info.manual ? { command: info.manual } : {}) });
      if (!info.systemd) return send({ type: 'update.failed', version, reason: 'no-systemd', command: shown });
      busy = true;
      try {
        if (await deps.atRisk()) return send({ type: 'update.failed', version, reason: 'sessions-at-risk' });
        send({ type: 'update.progress', version, step: 'installing' });
        log(`update: ${shown}`);
        const r = await deps.npm(cmd);
        if (r.code !== 0) { log(`update: npm failed (${r.code})\n${r.output}`); return send({ type: 'update.failed', version, reason: 'npm-failed', detail: lastLines(r.output), command: shown }); }
        send({ type: 'update.progress', version, step: 'restarting' });
        await deps.save();
        await deps.restart();
      } finally { busy = false; }
    }
  };
}

export function realUpdaterDeps(opts: { info: DaemonInfo; save: () => Promise<void> }): UpdaterDeps {
  return {
    info: () => opts.info,
    atRisk: () => tmuxServerAtRisk(),
    npm: cmd => new Promise(resolve => {
      const timer = setTimeout(() => resolve({ code: 124, output: 'npm timed out after 3 minutes' }), NPM_TIMEOUT_MS);
      runFile(cmd.file, cmd.args, process.env).then(r => { clearTimeout(timer); resolve({ code: r.code, output: `${r.stdout}\n${r.stderr}` }); });
    }),
    // --no-block: this systemctl runs inside the cgroup being stopped; the job must not depend on it staying alive.
    restart: async () => { await runFile('systemctl', ['--user', 'restart', '--no-block', SERVICE]); },
    save: opts.save
  };
}
```

- [ ] **Step 4 : brancher le serveur**

Dans `startServer(opts…)`, ajouter `daemon?: DaemonInfo; updater?: ReturnType<typeof createDaemonUpdater>` au type des options. Dans `sendSnapshot` :

```ts
    send(ws, { type: 'snapshot', sessions: store.all(), recents: store.recents(), launcher, ...(opts.daemon ? { daemon: opts.daemon } : {}) });
```

Dans `handle` :

```ts
      // Broadcast: every overlay shows the same progress, and the one that asked may be the one that reconnects.
      case 'update.daemon':
        if (!opts.updater) return send(ws, { type: 'update.failed', version: msg.version, reason: 'no-systemd' });
        return opts.updater.update(msg.version, broadcast);
```

Dans `daemon/index.ts`, avant `startServer` :

```ts
  const daemon = await daemonInfo();
  const updater = createDaemonUpdater(realUpdaterDeps({ info: daemon, save: () => store.save() }));
  const server = await startServer({ store, tmux, port: opts.port, daemon, updater });
```

(imports : `daemonInfo` de `../update/self.js`, `createDaemonUpdater, realUpdaterDeps` de `../update/run-update.js`). Vérifier que `store.save()` est public (il est appelé dans `stop`).

Test serveur, à ajouter dans `server.test.ts` (même fichier, mêmes helpers que les tests existants) :

```ts
describe('update.daemon', () => {
  it('sends the daemon info in the snapshot and routes update.daemon to the updater', async () => {
    await srv.close();
    const seen: string[] = [];
    srv = await startServer({ store, tmux, port: 0, agentPath: async () => '/usr/bin', daemon: { version: '0.2.2', install: 'npm', systemd: true },
      updater: { running: () => false, update: async (v, send) => { seen.push(v); send({ type: 'update.progress', version: v, step: 'installing' }); } } });
    const c = await connect({ port: srv.port });
    const snap = await c.next('snapshot');
    expect(snap.daemon).toEqual({ version: '0.2.2', install: 'npm', systemd: true });
    c.send({ type: 'update.daemon', version: '0.3.0' });
    expect(await c.next('update.progress')).toMatchObject({ step: 'installing' });
    expect(seen).toEqual(['0.3.0']);
    c.close();
  });
});
```

Adapter `connect`/`next` aux helpers réellement présents dans `server.test.ts` (le fichier ouvre déjà des clients et attend des messages typés : réutiliser le même helper, ne pas en écrire un second).

- [ ] **Step 5 : tests verts** — `pnpm --filter ledge test && pnpm typecheck` → PASS.

- [ ] **Step 6 : commit**

```bash
git add packages/ledge/src/update/run-update.ts packages/ledge/src/daemon packages/ledge/test/update-run.test.ts packages/ledge/test/server.test.ts
git commit -m "feat(daemon): update itself from npm on request, then restart its service"
```

---

### Task 6 : le paquet `@paradow/ledge` et `ledge setup` qui suit la version npm

**Files:**
- Modify: `packages/ledge/package.json`, `apps/overlay/scripts/set-version.mjs`, `apps/overlay/test/version.test.ts`, `packages/ledge/src/cli/setup.ts`
- Create: `packages/ledge/README.md` (s'il n'existe pas : le README racine y renvoie déjà ; sinon le modifier)
- Test: `packages/ledge/test/setup.test.ts`

**Interfaces:**
- Produces: `relinkBin(opts: { link: string; target: string }): Promise<string | null>` (renvoie la ligne à afficher, ou null si rien n'a changé).

- [ ] **Step 1 : tests**

Dans `apps/overlay/test/version.test.ts`, ajouter :

```ts
  it('is the same in the npm package of the daemon', () => {
    const pkg = JSON.parse(read('package.json')).version;
    expect(JSON.parse(read('../../packages/ledge/package.json')).version).toBe(pkg);
  });
```

Dans `packages/ledge/test/setup.test.ts`, ajouter :

```ts
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readlinkSync, existsSync } from 'node:fs';
import { relinkBin } from '../src/cli/setup.js';

describe('relinkBin', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'ledge-bin-'));
  it('points a link to an older Ledge CLI at the running one', async () => {
    const d = dir(); const old = join(d, 'clone/packages/ledge/dist/cli/index.js'); const now = join(d, 'npm/node_modules/@paradow/ledge/dist/cli/index.js');
    mkdirSync(join(old, '..'), { recursive: true }); mkdirSync(join(now, '..'), { recursive: true }); writeFileSync(old, ''); writeFileSync(now, '');
    symlinkSync(old, join(d, 'ledge'));
    expect(await relinkBin({ link: join(d, 'ledge'), target: now })).toMatch(/now points to/);
    expect(readlinkSync(join(d, 'ledge'))).toBe(now);
  });
  it('leaves an up-to-date link, a missing link and a foreign file alone', async () => {
    const d = dir(); const now = join(d, 'cli/dist/cli/index.js'); mkdirSync(join(now, '..'), { recursive: true }); writeFileSync(now, '');
    symlinkSync(now, join(d, 'ledge'));
    expect(await relinkBin({ link: join(d, 'ledge'), target: now })).toBeNull();
    expect(await relinkBin({ link: join(d, 'absent'), target: now })).toBeNull();
    expect(existsSync(join(d, 'absent'))).toBe(false);
    writeFileSync(join(d, 'mine'), '#!/bin/sh\n');
    expect(await relinkBin({ link: join(d, 'mine'), target: now })).toBeNull();
  });
});
```

- [ ] **Step 2 : échec** — `pnpm --filter overlay exec vitest run test/version.test.ts` et `pnpm --filter ledge exec vitest run test/setup.test.ts` → FAIL.

- [ ] **Step 3 : implémenter**

`packages/ledge/package.json` devient :

```json
{
  "name": "@paradow/ledge",
  "version": "0.2.2",
  "description": "Follow and answer your WSL agent sessions (Claude Code, Codex, Cursor Agent) from the Ledge island on Windows.",
  "type": "module",
  "bin": { "ledge": "./dist/cli/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=22" },
  "repository": { "type": "git", "url": "git+https://github.com/Paradow-dev/ledge.git", "directory": "packages/ledge" },
  "homepage": "https://github.com/Paradow-dev/ledge#readme",
  "license": "UNLICENSED",
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": {
    "dev": "tsx src/cli/index.ts",
    "build": "tsup",
    "prepublishOnly": "pnpm build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "ws": "^8.18.0", "zod": "^3.23.8" },
  "devDependencies": { "@ledge/protocol": "workspace:*", "@types/node": "^22.7.0", "@types/ws": "^8.5.12", "tsup": "^8.3.0" }
}
```

`"license"` : à confirmer avec l'utilisateur avant la première publication (le dépôt n'a pas de fichier LICENSE). Puis `pnpm install` à la racine pour mettre à jour le lockfile.

`set-version.mjs`, après la dernière ligne :

```js
replaceOnce('../../packages/ledge/package.json', /^(  "version": )"[^"]*"/m, `$1"${version}"`);
```

et mettre à jour son commentaire d'en-tête (« … the overlay package and the daemon's npm package »). Le test de version dit maintenant « cinq fichiers ».

`setup.ts` :

```ts
import { lstat, readlink, symlink, unlink } from 'node:fs/promises';

/** `~/.local/bin/ledge` from the README's clone install: once npm installed Ledge, it must follow, or hooks run the clone. */
export async function relinkBin(opts: { link: string; target: string }): Promise<string | null> {
  const st = await lstat(opts.link).catch(() => null);
  if (!st?.isSymbolicLink()) return null;
  const current = await readlink(opts.link);
  if (current === opts.target || !current.endsWith('/dist/cli/index.js')) return null;
  await unlink(opts.link);
  await symlink(opts.target, opts.link);
  return `${opts.link} now points to ${opts.target} (was ${current})`;
}
```

Dans `runSetup`, avant le bloc `service` :

```ts
  if (!process.argv[1]?.endsWith('.ts')) {
    const line = await relinkBin({ link: join(homedir(), '.local', 'bin', 'ledge'), target: await realpath(process.argv[1]!) });
    if (line) out.push(line);
  }
```

Remplacer partout `pnpm --filter ledge` par `pnpm --filter @paradow/ledge` : `README.md` (lignes 334 et 391), `docs/island-test-guide.md` **non** (fichier de l'utilisateur, non suivi).

- [ ] **Step 4 : vérifier le paquet**

Run: `pnpm --filter ledge test && pnpm --filter overlay exec vitest run test/version.test.ts && cd packages/ledge && pnpm build && npm pack --dry-run 2>&1 | tail -15`
Expected: tests PASS ; `npm pack` liste `dist/cli/index.js`, `package.json`, `README.md` et rien d'autre (ni `src/`, ni `test/`).

- [ ] **Step 5 : commit**

```bash
git add packages/ledge/package.json packages/ledge/README.md packages/ledge/src/cli/setup.ts packages/ledge/test/setup.test.ts apps/overlay/scripts/set-version.mjs apps/overlay/test/version.test.ts pnpm-lock.yaml README.md
git commit -m "build(daemon): publish as @paradow/ledge; setup moves the ledge link to the npm install"
```

---

### Task 7 : `latest.json`

**Files:**
- Create: `apps/overlay/scripts/latest-json.mjs`
- Test: `apps/overlay/test/latest-json.test.ts`

**Interfaces:**
- Produces: `latestJson({ tag, notes, signature, exeName, pubDate }): object` exportée, et un mode CLI `node scripts/latest-json.mjs <tag> <exe path> <notes file>` qui lit `<exe path>.sig` et écrit le JSON sur stdout.

- [ ] **Step 1 : test**

```ts
// apps/overlay/test/latest-json.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain ESM script without types
import { latestJson } from '../scripts/latest-json.mjs';

describe('latestJson', () => {
  it('describes the Windows installer of the tag for the Tauri updater', () => {
    expect(latestJson({ tag: 'v0.3.0', notes: '- Une\n- Deux', signature: 'dW50cnVzdGVk...', exeName: 'Ledge_0.3.0_x64-setup.exe', pubDate: '2026-10-20T09:00:00.000Z' })).toEqual({
      version: '0.3.0', notes: '- Une\n- Deux', pub_date: '2026-10-20T09:00:00.000Z',
      platforms: { 'windows-x86_64': { signature: 'dW50cnVzdGVk...', url: 'https://github.com/Paradow-dev/ledge/releases/download/v0.3.0/Ledge_0.3.0_x64-setup.exe' } }
    });
  });
  it('refuses a tag that is not a plain version', () => {
    expect(() => latestJson({ tag: 'v0.3', notes: '', signature: 's', exeName: 'x.exe', pubDate: '2026-10-20T09:00:00.000Z' })).toThrow(/MAJOR.MINOR.PATCH/);
  });
});
```

- [ ] **Step 2 : échec** — `pnpm --filter overlay exec vitest run test/latest-json.test.ts` → FAIL.

- [ ] **Step 3 : implémenter**

```js
#!/usr/bin/env node
// Writes the updater manifest the installed Ledge reads from releases/latest/download/latest.json (spec 2026-10-12 auto-update §4).
// Usage: node scripts/latest-json.mjs v0.3.0 path/to/Ledge_0.3.0_x64-setup.exe notes.md > latest.json
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Paradow-dev/ledge';

export function latestJson({ tag, notes, signature, exeName, pubDate }) {
  const version = tag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`latest-json: expected MAJOR.MINOR.PATCH, got "${tag}"`);
  return {
    version, notes, pub_date: pubDate,
    platforms: { 'windows-x86_64': { signature, url: `https://github.com/${REPO}/releases/download/${tag}/${exeName}` } }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [tag, exe, notesFile] = process.argv.slice(2);
  const out = latestJson({
    tag, exeName: basename(exe), pubDate: new Date().toISOString(),
    signature: readFileSync(`${exe}.sig`, 'utf8').trim(),
    notes: notesFile ? readFileSync(notesFile, 'utf8').trim() : ''
  });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
```

- [ ] **Step 4 : test vert** — PASS.

- [ ] **Step 5 : commit**

```bash
git add apps/overlay/scripts/latest-json.mjs apps/overlay/test/latest-json.test.ts
git commit -m "ci: build the updater manifest from the tag, the installer and its signature"
```

---

### Task 8 : l'application embarque l'updater (Tauri)

**Files:**
- Modify: `apps/overlay/src-tauri/Cargo.toml`, `apps/overlay/src-tauri/src/main.rs`, `apps/overlay/src-tauri/tauri.conf.json`, `apps/overlay/src-tauri/capabilities/default.json`, `apps/overlay/package.json`
- Test: `apps/overlay/test/tauri-config.test.ts` (nouveau)

**Interfaces:**
- Produces: les permissions `updater:default`, `process:allow-restart` ; les paquets JS `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` (utilisés en tâche 10).

- [ ] **Step 1 : test de configuration**

```ts
// apps/overlay/test/tauri-config.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('updater configuration', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  it('reads the latest release of the public repository, signed with our key', () => {
    expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/Paradow-dev/ledge/releases/latest/download/latest.json']);
    expect(Buffer.from(conf.plugins.updater.pubkey, 'base64').toString()).toMatch(/^untrusted comment: minisign public key/);
    expect(conf.plugins.updater.windows.installMode).toBe('passive');
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
  });
  it('lets the window check, install and relaunch', () => {
    const caps = JSON.parse(read('src-tauri/capabilities/default.json'));
    expect(caps.permissions).toEqual(expect.arrayContaining(['updater:default', 'process:allow-restart']));
  });
  it('registers both plugins in the shell', () => {
    const main = read('src-tauri/src/main.rs');
    expect(main).toContain('tauri_plugin_updater::Builder::new().build()');
    expect(main).toContain('tauri_plugin_process::init()');
  });
});
```

- [ ] **Step 2 : échec** — `pnpm --filter overlay exec vitest run test/tauri-config.test.ts` → FAIL.

- [ ] **Step 3 : implémenter**

`Cargo.toml`, dans `[dependencies]` :

```toml
# Updates from the GitHub release (latest.json, minisign signature) and the relaunch after install.
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

`main.rs`, dans `main()` après le plugin autostart :

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

`tauri.conf.json` : dans `bundle`, ajouter `"createUpdaterArtifacts": true` ; à la racine, ajouter (la clé publique est le contenu exact de `~/secrets/ledge-updater.key.pub`, sur une ligne) :

```json
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDc2M0NDQ0YzRDAxMzM2QUQKUldTdE5oUFE4OHc4ZGdHSHlOUVVCemdoSUlxanArMitsWng2cEZSNWx4bXMxTjg0RWlNUnJ0REQK",
      "endpoints": ["https://github.com/Paradow-dev/ledge/releases/latest/download/latest.json"],
      "windows": { "installMode": "passive" }
    }
  }
```

Garder la ligne `"version"` à deux espaces d'indentation : `set-version.mjs` la cherche ainsi.

`capabilities/default.json` : ajouter `"updater:default"` et `"process:allow-restart"` à `permissions`, et compléter la description (« … the updater and the relaunch after an update »).

`apps/overlay` : `pnpm --filter overlay add @tauri-apps/plugin-updater@^2 @tauri-apps/plugin-process@^2`.

`Cargo.lock` ne peut pas être régénéré ici (pas de cargo) : le build CI le mettra à jour. La tâche 9 ajoute un déclenchement manuel qui compile sans publier, pour vérifier le Rust avant le premier tag.

- [ ] **Step 4 : tests verts** — `pnpm --filter overlay test && pnpm typecheck` → PASS.

- [ ] **Step 5 : commit**

```bash
git add apps/overlay/src-tauri apps/overlay/package.json pnpm-lock.yaml apps/overlay/test/tauri-config.test.ts
git commit -m "feat(overlay): ship the Tauri updater, signed with the Ledge key"
```

---

### Task 9 : le workflow publie npm, puis l'application avec `latest.json`

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `set-version.mjs` (tâche 6), `latest-json.mjs` (tâche 7), la config Tauri (tâche 8), les secrets `NPM_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

- [ ] **Step 1 : déclencheurs et permissions**

```yaml
on:
  push:
    tags: ['v*']
  # Builds everything without publishing: checks the Rust (no toolchain on the dev machine) before a real tag.
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to stamp, e.g. 0.3.0 (nothing is published)'
        required: true

permissions:
  contents: write
  id-token: write
```

Définir au niveau du workflow :

```yaml
env:
  PUBLISH: ${{ github.event_name == 'push' }}
  VERSION_TAG: ${{ github.event_name == 'push' && github.ref_name || format('v{0}', inputs.version) }}
```

- [ ] **Step 2 : job `npm`, avant le job Windows**

```yaml
  npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'
      - run: sudo apt-get install -y tmux
      - run: pnpm install --frozen-lockfile
      - name: Stamp the version from the tag
        run: node apps/overlay/scripts/set-version.mjs "$VERSION_TAG"
      - run: pnpm --filter @ledge/protocol test
      - run: pnpm --filter @paradow/ledge test
      - run: pnpm --filter @paradow/ledge build
      - name: Publish to npm
        if: env.PUBLISH == 'true'
        working-directory: packages/ledge
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          v="${VERSION_TAG#v}"
          # A re-run of the same tag must not fail on a version npm already has.
          if npm view "@paradow/ledge@$v" version >/dev/null 2>&1; then echo "@paradow/ledge@$v already published"; exit 0; fi
          npm publish --access public --provenance
      - name: Check the package without publishing
        if: env.PUBLISH != 'true'
        working-directory: packages/ledge
        run: npm pack --dry-run
```

Avec `NPM_TOKEN` absent (après le passage à Trusted Publishing), `NODE_AUTH_TOKEN` est vide et npm passe par l'OIDC (`id-token: write`).

- [ ] **Step 3 : job Windows**

`needs: npm`. Remplacer `$env:GITHUB_REF_NAME` par `$env:VERSION_TAG` dans l'étape « Stamp the version from the tag ». L'étape « Build the installer » reçoit :

```yaml
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

L'étape « Publish » prend `if: env.PUBLISH == 'true'`, et `$env:TAG` vient de `env.VERSION_TAG`. Dans son script, après le calcul de `$body` :

```powershell
          $sig = "$($exe.FullName).sig"
          if (-not (Test-Path $sig)) { throw "No updater signature next to $($exe.Name)" }
          Set-Content -Path release-notes.md -Value $body -Encoding utf8
          node apps/overlay/scripts/latest-json.mjs $env:TAG $exe.FullName release-notes.md | Set-Content -Path latest.json -Encoding utf8
```

Dans le bloc d'installation des notes, l'étape 1 devient :
`1. In WSL: ``npm i -g @paradow/ledge@__VERSION__`` (or let Ledge do it: the island offers the update).`, avec `-replace '__VERSION__', $version`.

Les appels `gh release upload` / `gh release create` envoient aussi `latest.json` : `gh release create $env:TAG $exe.FullName latest.json …` et `gh release upload $env:TAG $exe.FullName latest.json --clobber`.

Ajouter une étape non publiante en fin de job : `- name: Show the updater manifest` (`if: env.PUBLISH != 'true'`), qui génère `latest.json` de la même façon et l'affiche (`Get-Content latest.json`).

- [ ] **Step 4 : vérifier la syntaxe**

Run: `pnpm dlx @action-validator/cli@0.6.0 .github/workflows/release.yml` (ou, à défaut, `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))"`).
Expected: aucune erreur.

- [ ] **Step 5 : commit, pousser la branche, lancer le build sans publication**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish @paradow/ledge before the installer, sign it and attach latest.json"
```

Demander à l'utilisateur avant de pousser (action visible à l'extérieur). Une fois la branche poussée : `gh workflow run Release --ref <branche> -f version=0.3.0`, puis `gh run watch`.
Expected: les deux jobs verts. Le job Windows compile le Rust avec les deux plugins (premier contrôle du Rust de la tâche 8), produit un `.exe.sig` et affiche un `latest.json` valide. `pnpm tauri build` n'utilise pas `--locked` : cargo complète `Cargo.lock` sur le runner. Le lock du dépôt reste donc sans les nouvelles crates ; c'est sans conséquence pour le build, et `set-version.mjs` n'y lit que l'entrée `ledge-overlay`, qui ne change pas.

---

### Task 10 : l'overlay garde l'état du daemon et parle à l'updater

**Files:**
- Modify: `apps/overlay/src/daemon/store.ts`
- Create: `apps/overlay/src/update/semver.ts`, `apps/overlay/src/update/bridge.ts`, `apps/overlay/src/update/prefs.ts`
- Test: `apps/overlay/test/update-store.test.ts`, `apps/overlay/test/update-semver.test.ts`

**Interfaces:**
- Consumes: `DaemonInfo`, messages `update.*` (tâche 3).
- Produces:
  - `DaemonState` gagne `daemon: DaemonInfo | null`, `snapshotSeq: number`, `lastUpdate: { msg: Extract<ServerMessage, { type: 'update.progress' | 'update.failed' }>; seq: number } | null`.
  - `compareVersions(a: string, b: string): -1 | 0 | 1` (versions `X.Y.Z` ; `0.0.0-dev` compte comme `0.0.0`).
  - `interface AvailableUpdate { version: string; notes: string; downloadAndInstall(onProgress: (done: number, total: number | null) => void): Promise<void> }`.
  - `checkForUpdate(): Promise<AvailableUpdate | null>`, `relaunchApp(): Promise<void>`, `appVersion(): Promise<string | null>`.
  - `prefs` : `loadAuto(): boolean`, `saveAuto(on)`, `loadDismissed(): string | null`, `saveDismissed(v)`, `loadCheckedAt(): number | null`, `saveCheckedAt(ms)`, `takeUpdatedFrom(): string | null` (lit puis efface), `saveUpdatedFrom(v)`.

- [ ] **Step 1 : tests**

```ts
// apps/overlay/test/update-semver.test.ts
import { describe, it, expect } from 'vitest';
import { compareVersions } from '../src/update/semver';

describe('compareVersions', () => {
  it('orders by major, minor, patch numerically', () => {
    expect(compareVersions('0.3.0', '0.2.9')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.2', '0.3.0')).toBe(-1);
  });
  it('treats a dev build as the oldest', () => { expect(compareVersions('0.0.0-dev', '0.0.1')).toBe(-1); });
});
```

```ts
// apps/overlay/test/update-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { daemonStore } from '../src/daemon/store';

describe('daemon store: update state', () => {
  beforeEach(() => daemonStore.reset());
  it('keeps the daemon info of each snapshot and counts snapshots', () => {
    daemonStore.apply({ type: 'snapshot', sessions: [], daemon: { version: '0.2.2', install: 'npm', systemd: true } });
    daemonStore.apply({ type: 'snapshot', sessions: [] });
    const s = daemonStore.getState();
    expect(s.snapshotSeq).toBe(2);
    expect(s.daemon).toBeNull();
  });
  it('keeps the last update message with a sequence number', () => {
    daemonStore.apply({ type: 'update.progress', version: '0.3.0', step: 'installing' });
    daemonStore.apply({ type: 'update.progress', version: '0.3.0', step: 'installing' });
    expect(daemonStore.getState().lastUpdate).toMatchObject({ seq: 2, msg: { step: 'installing' } });
  });
});
```

- [ ] **Step 2 : échec** — `pnpm --filter overlay exec vitest run test/update-semver.test.ts test/update-store.test.ts` → FAIL.

- [ ] **Step 3 : implémenter**

```ts
// apps/overlay/src/update/semver.ts
const parts = (v: string) => v.split('-')[0]!.split('.').map(n => Number.parseInt(n, 10) || 0);
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parts(a); const y = parts(b);
  for (let i = 0; i < 3; i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d > 0 ? 1 : -1; }
  // Same numbers: a pre-release (0.0.0-dev) comes before the release.
  return a === b ? 0 : a.includes('-') ? -1 : b.includes('-') ? 1 : 0;
}
```

`store.ts` : ajouter les trois champs à `DaemonState` et à `empty()` (`daemon: null, snapshotSeq: 0, lastUpdate: null`) ; dans `apply`, avant le `switch` :

```ts
    if (m.type === 'update.progress' || m.type === 'update.failed') { state = { ...state, lastUpdate: { msg: m, seq: (state.lastUpdate?.seq ?? 0) + 1 } }; emit(); return; }
```

Dans `case 'snapshot'`, mettre à jour `daemon = m.daemon ?? null` et `snapshotSeq = state.snapshotSeq + 1` (déclarer `let { recents, launcher, daemon, snapshotSeq } = state;` et les réinjecter dans le `state = { … }` final).

```ts
// apps/overlay/src/update/bridge.ts
import { isTauri } from '../tauri/bridge';

export interface AvailableUpdate { version: string; notes: string; downloadAndInstall(onProgress: (done: number, total: number | null) => void): Promise<void> }

/** The newer release from latest.json, or null (none, or not in the app: browser, tests). Throws on network errors. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return null;
  return {
    version: u.version, notes: u.body ?? '',
    async downloadAndInstall(onProgress) {
      let done = 0; let total: number | null = null;
      await u.downloadAndInstall(e => {
        if (e.event === 'Started') total = e.data.contentLength ?? null;
        else if (e.event === 'Progress') { done += e.data.chunkLength; onProgress(done, total); }
      });
    }
  };
}

export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

export async function appVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}
```

```ts
// apps/overlay/src/update/prefs.ts
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* in-memory only */ } };
export const loadAuto = () => get('ledge.update.auto') !== '0';
export const saveAuto = (on: boolean) => set('ledge.update.auto', on ? '1' : '0');
export const loadDismissed = () => get('ledge.update.dismissed');
export const saveDismissed = (v: string | null) => set('ledge.update.dismissed', v);
export const loadCheckedAt = () => { const v = Number(get('ledge.update.checkedAt')); return Number.isFinite(v) && v > 0 ? v : null; };
export const saveCheckedAt = (ms: number) => set('ledge.update.checkedAt', String(ms));
/** The app version before an update, written just before installing; read once after the relaunch. */
export const saveUpdatedFrom = (v: string) => set('ledge.update.from', v);
export function takeUpdatedFrom(): string | null { const v = get('ledge.update.from'); set('ledge.update.from', null); return v; }
```

- [ ] **Step 4 : tests verts** — `pnpm --filter overlay test && pnpm typecheck` → PASS.

- [ ] **Step 5 : commit**

```bash
git add apps/overlay/src/daemon/store.ts apps/overlay/src/update/semver.ts apps/overlay/src/update/bridge.ts apps/overlay/src/update/prefs.ts apps/overlay/test/update-semver.test.ts apps/overlay/test/update-store.test.ts
git commit -m "feat(overlay): keep the daemon version and talk to the Tauri updater"
```

---

### Task 11 : la machine d'état de la mise à jour

**Files:**
- Create: `apps/overlay/src/update/machine.ts`
- Test: `apps/overlay/test/update-machine.test.ts`

**Interfaces:**
- Consumes: `compareVersions` (tâche 10), `DaemonInfo`, `UpdateFailure` (tâche 3).
- Produces:

```ts
export type Failure = UpdateFailure | 'daemon-timeout' | 'sessions-lost' | 'download';
export type Phase =
  | { kind: 'idle' }
  | { kind: 'daemon'; step: 'sent' | 'installing' | 'restarting' }
  | { kind: 'waiting' }
  | { kind: 'downloading'; done: number; total: number | null }
  | { kind: 'installing' }
  | { kind: 'failed'; reason: Failure; detail?: string; command?: string; missing?: string[] };
export interface UpdateState {
  app: string | null; daemon: DaemonInfo | null; latest: { version: string; notes: string } | null;
  phase: Phase; target: string | null; before: { ids: string[]; names: Record<string, string> } | null;
  dismissed: string | null; justUpdated: string | null; checkedAt: number | null;
}
export type UpdateEvent =
  | { type: 'app'; version: string | null; updatedFrom: string | null }
  | { type: 'checked'; at: number; latest: { version: string; notes: string } | null }
  | { type: 'snapshot'; daemon: DaemonInfo | null; ids: string[] }
  | { type: 'removed'; id: string }
  | { type: 'start'; sessions: Array<{ id: string; name: string }> }
  | { type: 'progress'; step: 'installing' | 'restarting' }
  | { type: 'failed'; reason: UpdateFailure; detail?: string; command?: string }
  | { type: 'disconnected' } | { type: 'timeout' }
  | { type: 'download'; done: number; total: number | null } | { type: 'downloaded' } | { type: 'download-failed' }
  | { type: 'dismiss' } | { type: 'ack-updated' } | { type: 'retry' };
export function initialUpdate(dismissed: string | null, checkedAt: number | null): UpdateState;
export function reduceUpdate(s: UpdateState, e: UpdateEvent): UpdateState;
export function targetOf(s: UpdateState): string | null;   // version à atteindre, null si tout est à jour
export function needsDaemon(s: UpdateState): boolean;
export function needsApp(s: UpdateState): boolean;
export type CardView =
  | { kind: 'hidden' }
  | { kind: 'available'; version: string; current: string; notes: string[] }
  | { kind: 'manual'; version: string; command: string | null; canInstallApp: boolean }
  | { kind: 'running'; steps: Array<{ key: 'daemon' | 'restart' | 'download' | 'install'; status: 'done' | 'run' | 'todo'; meta?: string; progress?: number }> }
  | { kind: 'failed'; reason: Failure; detail?: string; command?: string; missing?: string[] }
  | { kind: 'updated'; version: string };
export function cardView(s: UpdateState): CardView;
export type PipTone = 'new' | 'busy' | 'bad' | 'ok' | null;
export function pipTone(s: UpdateState): PipTone;          // pastille de l'île (null si écartée par « Plus tard »)
export function gearPip(s: UpdateState): boolean;          // pastille de la roue dentée (reste après « Plus tard »)
```

- [ ] **Step 1 : tests** (ils fixent le comportement ; chaque ligne du tableau §7 de la spec y est)

```ts
// apps/overlay/test/update-machine.test.ts
import { describe, it, expect } from 'vitest';
import { initialUpdate, reduceUpdate, cardView, pipTone, gearPip, targetOf, type UpdateEvent, type UpdateState } from '../src/update/machine';

const NPM = { version: '0.2.2', install: 'npm' as const, systemd: true };
const run = (events: UpdateEvent[], s: UpdateState = initialUpdate(null, null)) => events.reduce(reduceUpdate, s);
const base: UpdateEvent[] = [
  { type: 'app', version: '0.2.2', updatedFrom: null },
  { type: 'snapshot', daemon: NPM, ids: ['a', 'b'] },
  { type: 'checked', at: 1, latest: { version: '0.3.0', notes: '- Une\n- Deux\n- Trois\n- Quatre' } }
];
const START: UpdateEvent = { type: 'start', sessions: [{ id: 'a', name: 'Otto' }, { id: 'b', name: 'Nova' }] };

describe('update machine', () => {
  it('offers a newer release with its first three notes', () => {
    const s = run(base);
    expect(targetOf(s)).toBe('0.3.0');
    expect(cardView(s)).toEqual({ kind: 'available', version: '0.3.0', current: '0.2.2', notes: ['Une', 'Deux', 'Trois'] });
    expect(pipTone(s)).toBe('new'); expect(gearPip(s)).toBe(true);
  });
  it('shows nothing when everything is current', () => {
    const s = run([base[0]!, { type: 'snapshot', daemon: { ...NPM }, ids: [] }, { type: 'checked', at: 1, latest: null }]);
    expect(cardView(s)).toEqual({ kind: 'hidden' }); expect(pipTone(s)).toBeNull(); expect(gearPip(s)).toBe(false);
  });
  it('"later" hides the card and the island pip until a newer version, the gear pip stays', () => {
    const s = run([...base, { type: 'dismiss' }]);
    expect(cardView(s)).toEqual({ kind: 'hidden' }); expect(pipTone(s)).toBeNull(); expect(gearPip(s)).toBe(true);
    expect(cardView(run([{ type: 'checked', at: 2, latest: { version: '0.3.1', notes: '' } }], s)).kind).toBe('available');
  });
  it('walks daemon, reconnect, download, install when all sessions come back', () => {
    let s = run([...base, START]);
    expect(s.phase).toEqual({ kind: 'daemon', step: 'sent' });
    s = run([{ type: 'progress', step: 'installing' }, { type: 'progress', step: 'restarting' }, { type: 'disconnected' }], s);
    expect(s.phase.kind).toBe('waiting');
    s = run([{ type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a', 'b'] }], s);
    expect(s.phase).toEqual({ kind: 'downloading', done: 0, total: null });
    s = run([{ type: 'download', done: 5, total: 10 }], s);
    expect(cardView(s)).toMatchObject({ kind: 'running', steps: [{ key: 'daemon', status: 'done' }, { key: 'restart', status: 'done', meta: '2/2' }, { key: 'download', status: 'run', progress: 0.5 }, { key: 'install', status: 'todo' }] });
    expect(pipTone(s)).toBe('busy');
    s = run([{ type: 'downloaded' }], s);
    expect(s.phase.kind).toBe('installing');
  });
  it('fails with sessions-lost and does not touch the app when a session is missing', () => {
    const s = run([...base, START, { type: 'disconnected' }, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a'] }]);
    expect(s.phase).toEqual({ kind: 'failed', reason: 'sessions-lost', missing: ['Nova'] });
    expect(pipTone(s)).toBe('bad');
  });
  it('a session removed before the restart is not lost', () => {
    const s = run([...base, START, { type: 'removed', id: 'b' }, { type: 'disconnected' }, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a'] }]);
    expect(s.phase.kind).toBe('downloading');
  });
  it('keeps waiting while the old daemon answers, then times out', () => {
    let s = run([...base, START, { type: 'disconnected' }, { type: 'snapshot', daemon: NPM, ids: ['a', 'b'] }]);
    expect(s.phase.kind).toBe('waiting');
    s = run([{ type: 'timeout' }], s);
    expect(s.phase).toMatchObject({ kind: 'failed', reason: 'daemon-timeout' });
  });
  it('turns a daemon refusal into a failure with its command', () => {
    const s = run([...base, START, { type: 'failed', reason: 'npm-failed', detail: 'EACCES', command: 'npm i -g @paradow/ledge@0.3.0' }]);
    expect(cardView(s)).toEqual({ kind: 'failed', reason: 'npm-failed', detail: 'EACCES', command: 'npm i -g @paradow/ledge@0.3.0' });
  });
  it('retry goes back to available', () => {
    const s = run([...base, START, { type: 'failed', reason: 'sessions-at-risk' }, { type: 'retry' }]);
    expect(cardView(s).kind).toBe('available');
  });
  it('skips the daemon step when it already runs the target', () => {
    const s = run([base[0]!, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: ['a'] }, base[2]!, START]);
    expect(s.phase.kind).toBe('downloading');
  });
  it('offers the app alone when the daemon is ahead', () => {
    const s = run([base[0]!, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: [] }, { type: 'checked', at: 1, latest: null }]);
    expect(targetOf(s)).toBe('0.3.0'); expect(cardView(s).kind).toBe('available');
  });
  it('a clone shows the manual command; the app button wakes up once the daemon has the target', () => {
    const git = { version: '0.2.2', install: 'git' as const, systemd: true, manual: 'cd /c && git pull' };
    let s = run([base[0]!, { type: 'snapshot', daemon: git, ids: [] }, base[2]!]);
    expect(cardView(s)).toEqual({ kind: 'manual', version: '0.3.0', command: 'cd /c && git pull', canInstallApp: false });
    s = run([{ type: 'snapshot', daemon: { ...git, version: '0.3.0' }, ids: [] }], s);
    expect(cardView(s)).toEqual({ kind: 'manual', version: '0.3.0', command: 'cd /c && git pull', canInstallApp: true });
  });
  it('says the app was updated after the relaunch, until acknowledged', () => {
    let s = run([{ type: 'app', version: '0.3.0', updatedFrom: '0.2.2' }, { type: 'snapshot', daemon: { ...NPM, version: '0.3.0' }, ids: [] }]);
    expect(cardView(s)).toEqual({ kind: 'updated', version: '0.3.0' }); expect(pipTone(s)).toBe('ok');
    s = run([{ type: 'ack-updated' }], s);
    expect(cardView(s)).toEqual({ kind: 'hidden' });
  });
  it('ignores a start while not available, and progress outside an update', () => {
    const idle = run([base[0]!, { type: 'snapshot', daemon: NPM, ids: [] }, { type: 'checked', at: 1, latest: null }]);
    expect(run([START, { type: 'progress', step: 'installing' }], idle).phase).toEqual({ kind: 'idle' });
  });
});
```

- [ ] **Step 2 : échec** — `pnpm --filter overlay exec vitest run test/update-machine.test.ts` → FAIL.

- [ ] **Step 3 : implémenter `machine.ts`**

```ts
import type { DaemonInfo, UpdateFailure } from '@ledge/protocol';
import { compareVersions } from './semver';

// (types exactement comme dans l'encadré Interfaces ci-dessus)

export const initialUpdate = (dismissed: string | null, checkedAt: number | null): UpdateState =>
  ({ app: null, daemon: null, latest: null, phase: { kind: 'idle' }, target: null, before: null, dismissed, justUpdated: null, checkedAt });

const newer = (a: string | null | undefined, b: string | null | undefined) => (!a ? b ?? null : !b ? a : compareVersions(a, b) >= 0 ? a : b);
/** The version both halves should run: the newest of the release and the daemon, when one half is behind it. */
export function targetOf(s: UpdateState): string | null {
  const t = newer(s.latest?.version, s.daemon?.version);
  if (!t) return null;
  const behind = (v: string | null | undefined) => !!v && compareVersions(v, t) < 0;
  return behind(s.app) || behind(s.daemon?.version) ? t : null;
}
export const needsDaemon = (s: UpdateState, t = s.target ?? targetOf(s)) => !!t && !!s.daemon && compareVersions(s.daemon.version, t) < 0;
export const needsApp = (s: UpdateState, t = s.target ?? targetOf(s)) => !!t && !!s.app && compareVersions(s.app, t) < 0;
const running = (p: Phase) => p.kind === 'daemon' || p.kind === 'waiting' || p.kind === 'downloading' || p.kind === 'installing';

/** After the daemon came back: every session it had must be there, or the app is left alone. */
function afterDaemon(s: UpdateState, ids: string[]): UpdateState {
  const missing = (s.before?.ids ?? []).filter(id => !ids.includes(id)).map(id => s.before?.names[id] ?? id);
  if (missing.length) return { ...s, phase: { kind: 'failed', reason: 'sessions-lost', missing } };
  return needsApp(s) ? { ...s, phase: { kind: 'downloading', done: 0, total: null } } : { ...s, phase: { kind: 'idle' }, target: null, before: null };
}

export function reduceUpdate(s: UpdateState, e: UpdateEvent): UpdateState {
  switch (e.type) {
    case 'app': return { ...s, app: e.version, justUpdated: e.updatedFrom && e.version && e.updatedFrom !== e.version ? e.version : null };
    case 'checked': return { ...s, latest: e.latest, checkedAt: e.at };
    case 'removed': return s.before ? { ...s, before: { ...s.before, ids: s.before.ids.filter(id => id !== e.id) } } : s;
    case 'snapshot': {
      const next = { ...s, daemon: e.daemon };
      if ((s.phase.kind === 'waiting' || s.phase.kind === 'daemon') && s.target && e.daemon && compareVersions(e.daemon.version, s.target) >= 0) return afterDaemon(next, e.ids);
      return next;
    }
    case 'start': {
      const target = targetOf(s);
      if (!target || running(s.phase)) return s;
      const before = { ids: e.sessions.map(x => x.id), names: Object.fromEntries(e.sessions.map(x => [x.id, x.name])) };
      const t = { ...s, target, before };
      if (needsDaemon(t, target)) return s.daemon?.install === 'npm' ? { ...t, phase: { kind: 'daemon', step: 'sent' } } : s;
      return needsApp(t, target) ? { ...t, phase: { kind: 'downloading', done: 0, total: null } } : s;
    }
    case 'progress': return s.phase.kind === 'daemon' ? { ...s, phase: { kind: 'daemon', step: e.step } } : s;
    case 'failed': return s.phase.kind === 'daemon' ? { ...s, phase: { kind: 'failed', reason: e.reason, detail: e.detail, command: e.command } } : s;
    case 'disconnected': return s.phase.kind === 'daemon' ? { ...s, phase: { kind: 'waiting' } } : s;
    case 'timeout': return s.phase.kind === 'waiting' || s.phase.kind === 'daemon' ? { ...s, phase: { kind: 'failed', reason: 'daemon-timeout' } } : s;
    case 'download': return s.phase.kind === 'downloading' ? { ...s, phase: { kind: 'downloading', done: e.done, total: e.total } } : s;
    case 'downloaded': return s.phase.kind === 'downloading' ? { ...s, phase: { kind: 'installing' } } : s;
    case 'download-failed': return s.phase.kind === 'downloading' || s.phase.kind === 'installing' ? { ...s, phase: { kind: 'failed', reason: 'download' } } : s;
    case 'dismiss': return { ...s, dismissed: targetOf(s) };
    case 'ack-updated': return { ...s, justUpdated: null };
    case 'retry': return s.phase.kind === 'failed' ? { ...s, phase: { kind: 'idle' }, target: null, before: null } : s;
  }
}

const noteLines = (notes: string) => notes.split('\n').map(l => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean).slice(0, 3);
const isDismissed = (s: UpdateState, t: string) => !!s.dismissed && compareVersions(s.dismissed, t) >= 0;

export function cardView(s: UpdateState): CardView {
  const p = s.phase;
  if (p.kind === 'failed') return { kind: 'failed', reason: p.reason, ...(p.detail ? { detail: p.detail } : {}), ...(p.command ? { command: p.command } : {}), ...(p.missing ? { missing: p.missing } : {}) };
  if (running(p)) {
    const daemonDone = p.kind !== 'daemon';
    const restarted = p.kind === 'downloading' || p.kind === 'installing';
    const n = s.before?.ids.length ?? 0;
    return { kind: 'running', steps: [
      { key: 'daemon', status: daemonDone || (p.kind === 'daemon' && p.step === 'restarting') ? 'done' : 'run', ...(s.target ? { meta: s.target } : {}) },
      { key: 'restart', status: restarted ? 'done' : daemonDone || (p.kind === 'daemon' && p.step === 'restarting') ? 'run' : 'todo', ...(restarted ? { meta: `${n}/${n}` } : {}) },
      { key: 'download', status: p.kind === 'installing' ? 'done' : p.kind === 'downloading' ? 'run' : 'todo', ...(p.kind === 'downloading' && p.total ? { progress: p.done / p.total } : {}) },
      { key: 'install', status: p.kind === 'installing' ? 'run' : 'todo' }
    ] };
  }
  if (s.justUpdated) return { kind: 'updated', version: s.justUpdated };
  const t = targetOf(s);
  if (!t || isDismissed(s, t)) return { kind: 'hidden' };
  if (needsDaemon(s, t) && s.daemon?.install !== 'npm') return { kind: 'manual', version: t, command: s.daemon?.manual ?? null, canInstallApp: false };
  if (!needsDaemon(s, t) && s.daemon && s.daemon.install !== 'npm' && needsApp(s, t)) return { kind: 'manual', version: t, command: s.daemon.manual ?? null, canInstallApp: true };
  return { kind: 'available', version: t, current: s.app ?? s.daemon?.version ?? '', notes: noteLines(s.latest?.notes ?? '') };
}

export function pipTone(s: UpdateState): PipTone {
  const v = cardView(s);
  return v.kind === 'running' ? 'busy' : v.kind === 'failed' ? 'bad' : v.kind === 'updated' ? 'ok' : v.kind === 'hidden' ? null : 'new';
}
export const gearPip = (s: UpdateState): boolean => !!targetOf(s);
```

Note : l'état « Redémarrage » de la maquette correspond à `installing` (l'installeur passif ferme et relance l'application).

- [ ] **Step 4 : tests verts** — `pnpm --filter overlay exec vitest run test/update-machine.test.ts && pnpm typecheck` → PASS. Si un test échoue, corriger le réducteur, jamais le test (les tests fixent la spec).

- [ ] **Step 5 : commit**

```bash
git add apps/overlay/src/update/machine.ts apps/overlay/test/update-machine.test.ts
git commit -m "feat(overlay): the update state machine, daemon first and only with every session back"
```

---

### Task 12 : le contrôleur `useUpdate`

**Files:**
- Create: `apps/overlay/src/update/useUpdate.ts`
- Test: `apps/overlay/test/use-update.test.tsx`

**Interfaces:**
- Consumes: `reduceUpdate`, `initialUpdate`, `cardView`, `pipTone`, `gearPip` (tâche 11) ; `daemonStore`/`useDaemon` (tâche 10) ; `checkForUpdate`, `relaunchApp`, `appVersion`, `AvailableUpdate` (tâche 10) ; `prefs` (tâche 10) ; `DaemonClient.send` (existant, `apps/overlay/src/daemon/client.ts`).
- Produces:

```ts
export interface UpdateController {
  state: UpdateState; card: CardView; pip: PipTone; gear: boolean; auto: boolean;
  start(): void; later(): void; retry(): void; ackUpdated(): void; checkNow(): void; setAuto(on: boolean): void;
}
export function useUpdate(client: DaemonClient, deps?: { check?: typeof checkForUpdate; relaunch?: typeof relaunchApp; version?: typeof appVersion; now?: () => number; everyMs?: number; waitMs?: number }): UpdateController;
```

Comportement :
- Au montage : `version()` puis `dispatch({ type: 'app', version, updatedFrom: takeUpdatedFrom() })`.
- `checkNow()` et, si `auto`, au montage puis toutes les `everyMs` (6 h) : `check()` → `dispatch({ type: 'checked', at: now(), latest: u ? { version, notes } : null })` ; garde l'objet `AvailableUpdate` dans une ref ; `saveCheckedAt`. Une erreur réseau est avalée (pas de dispatch).
- Abonné à `daemonStore` : à chaque nouveau `snapshotSeq`, `dispatch({ type: 'snapshot', daemon, ids })` ; à chaque nouveau `lastUpdate.seq`, `progress` ou `failed` ; quand `status` passe de `open` à autre chose, `disconnected` ; un `session.removed` se voit comme un id qui disparaît de `sessions` entre deux états sans nouveau snapshot → `removed`.
- `start()` : `dispatch({ type: 'start', sessions })`, puis si la phase devient `daemon`, `client.send({ type: 'update.daemon', version: target })`.
- Phase `waiting` ou `daemon` : minuterie `waitMs` (45 s) → `timeout`.
- Phase `downloading` (une seule fois par entrée dans la phase) : `saveUpdatedFrom(app)`, puis `ref.downloadAndInstall((d, t) => dispatch({ type: 'download', done: d, total: t }))` → `downloaded` → `relaunch()` ; une erreur → `download-failed`. Si la ref est vide (application déjà à jour mais daemon en retard, impossible ici car `needsApp` est faux) → ne rien faire.
- `later()` : `dispatch({ type: 'dismiss' })` puis `saveDismissed(target)`.

- [ ] **Step 1 : tests** (React Testing Library, avec `createMockDaemon` de `test/mockDaemon.ts` et un client réel `createDaemonClient`, comme `test/daemon.test.ts`)

```tsx
// apps/overlay/test/use-update.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { useUpdate } from '../src/update/useUpdate';

let cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.reverse()) await c(); cleanup = []; daemonStore.reset(); localStorage.clear(); });

async function setup(daemonVersion = '0.2.2') {
  const daemon = await createMockDaemon();
  daemon.extras.daemon = { version: daemonVersion, install: 'npm', systemd: true };
  daemon.sessions.set('a', fakeSession('a', { name: 'Otto' }));
  const client = createDaemonClient({ url: daemon.url, minBackoffMs: 20, maxBackoffMs: 50 });
  const off = attachClient(client); client.connect();
  cleanup.push(() => { off(); client.close(); }, () => daemon.close());
  const install = vi.fn(async (p: (d: number, t: number | null) => void) => { p(5, 10); p(10, 10); });
  const relaunch = vi.fn(async () => {});
  const hook = renderHook(() => useUpdate(client, { version: async () => '0.2.2', check: async () => ({ version: '0.3.0', notes: '- Une', downloadAndInstall: install }), relaunch, waitMs: 2000 }));
  await waitFor(() => expect(hook.result.current.card.kind).toBe('available'));
  return { daemon, hook, install, relaunch };
}

describe('useUpdate', () => {
  it('asks the daemon, then installs the app once it is back with every session', async () => {
    const { daemon, hook, install, relaunch } = await setup();
    act(() => hook.result.current.start());
    await waitFor(() => expect(daemon.received).toContainEqual({ type: 'update.daemon', version: '0.3.0' }));
    // The daemon restarts: the socket drops, then the new daemon answers with 0.3.0 and the same sessions.
    daemon.extras.daemon = { version: '0.3.0', install: 'npm', systemd: true };
    await daemon.dropClients();
    await waitFor(() => expect(install).toHaveBeenCalledOnce());
    await waitFor(() => expect(relaunch).toHaveBeenCalledOnce());
    expect(localStorage.getItem('ledge.update.from')).toBe('0.2.2');
  });
  it('never installs the app when a session did not come back', async () => {
    const { daemon, hook, install } = await setup();
    act(() => hook.result.current.start());
    await waitFor(() => expect(daemon.received).toContainEqual({ type: 'update.daemon', version: '0.3.0' }));
    daemon.extras.daemon = { version: '0.3.0', install: 'npm', systemd: true };
    daemon.sessions.delete('a');
    await daemon.dropClients();
    await waitFor(() => expect(hook.result.current.card).toMatchObject({ kind: 'failed', reason: 'sessions-lost', missing: ['Otto'] }));
    expect(install).not.toHaveBeenCalled();
  });
  it('remembers "later" across reloads', async () => {
    const { hook } = await setup();
    act(() => hook.result.current.later());
    expect(hook.result.current.card.kind).toBe('hidden');
    expect(localStorage.getItem('ledge.update.dismissed')).toBe('0.3.0');
  });
});
```

Ajouter à `test/mockDaemon.ts` : `extras` accepte `daemon?: DaemonInfo` (le snapshot l'envoie déjà via `...extras`), et une méthode `dropClients(): Promise<void>` qui fait `terminate()` sur chaque client ouvert (le client se reconnecte seul et reçoit un nouveau snapshot).

- [ ] **Step 2 : échec** — `pnpm --filter overlay exec vitest run test/use-update.test.tsx` → FAIL.

- [ ] **Step 3 : implémenter `useUpdate.ts`** selon le comportement listé : `useReducer(reduceUpdate, undefined, () => initialUpdate(loadDismissed(), loadCheckedAt()))`, un `useEffect` par source (montage, minuterie de vérification, abonnement `daemonStore.subscribe` avec mémoire du dernier `snapshotSeq` / `lastUpdate.seq` / `status` / ids dans des refs, minuterie d'attente sur `state.phase.kind`, téléchargement sur entrée en `downloading` gardé par une ref `downloadingFor`). Les envois au daemon passent par `client.send(...)`.

- [ ] **Step 4 : tests verts** — `pnpm --filter overlay test && pnpm typecheck` → PASS.

- [ ] **Step 5 : commit**

```bash
git add apps/overlay/src/update/useUpdate.ts apps/overlay/test/use-update.test.tsx apps/overlay/test/mockDaemon.ts
git commit -m "feat(overlay): drive the update from the app, wait for the daemon, then install"
```

---

### Task 13 : la carte, les pastilles et les textes

**Files:**
- Create: `apps/overlay/src/update/UpdateCard.tsx`
- Modify: `apps/overlay/src/i18n/messages.ts`, `apps/overlay/src/surface/SessionList.tsx`, `apps/overlay/src/surface/Handle.tsx`, `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/App.tsx`
- Test: `apps/overlay/test/update-card.test.tsx`, `apps/overlay/test/i18n.test.tsx` (le test existant vérifie que les deux langues ont les mêmes clés : il doit rester vert)

**Interfaces:**
- Consumes: `UpdateController`, `CardView`, `PipTone` (tâches 11-12).
- Produces:
  - `UpdateCard({ view, sessions, onUpdate, onLater, onRetry, onAck, onNotes })`.
  - `SessionList` gagne `update?: ReactNode; updateRef?: Ref<HTMLDivElement>; gearPip?: boolean`.
  - `Handle` gagne `updatePip?: PipTone`.
  - `Surface` gagne `update?: UpdateController` ; `App` crée `const update = useUpdate(client)` et le passe.

- [ ] **Step 1 : textes** — ajouter un bloc `update` dans les deux langues de `messages.ts` (même forme ; anglais en miroir) :

```ts
  update: {
    available: (v: string) => `Ledge ${v} est disponible`, current: (v: string) => `Vous avez la ${v}`, badgeNew: 'Nouveau',
    update: 'Mettre à jour', later: 'Plus tard', notes: 'Notes complètes', retry: 'Réessayer', ok: 'OK', copy: 'Copier', copied: 'Copié', log: 'Journal du daemon',
    keepRunning: (n: number) => n === 0 ? 'Ledge se ferme environ 20 s pour se mettre à jour.' : `Vos ${n} session${n > 1 ? 's' : ''} continue${n > 1 ? 'nt' : ''}. Ledge se ferme environ 20 s pour se mettre à jour.`,
    running: (v: string) => `Mise à jour vers ${v}`, dontClose: 'Ne fermez pas Ledge', badgeRunning: 'En cours',
    steps: { daemon: 'Daemon WSL mis à jour', restart: 'Daemon redémarré, sessions retrouvées', download: 'Téléchargement de l’application', install: 'Installation et redémarrage' },
    updated: (v: string) => `Ledge ${v} est installé`, badgeUpdated: 'À jour',
    manualTitle: 'Votre daemon tourne depuis un clone git', manualHint: 'Ledge ne touche pas à un clone. Mettez le daemon à jour dans WSL :', manualApp: 'Mettre à jour l’application', manualWait: (v: string) => `Le bouton s’active dès que le daemon annonce ${v}.`, badgeManual: 'Manuel',
    failedBadge: 'Échec',
    failed: {
      'git-install': 'Votre daemon tourne depuis un clone git : mettez-le à jour vous-même.',
      'no-systemd': 'Le daemon ne tourne pas comme service : il ne peut pas se relancer seul.',
      'sessions-at-risk': 'Vos sessions tournent dans le service du daemon : un redémarrage les fermerait. Fermez-les, ou redémarrez WSL, puis réessayez.',
      'npm-failed': 'Le daemon n’a pas pu se mettre à jour. Rien n’a changé.',
      'busy': 'Une mise à jour est déjà en cours.',
      'daemon-timeout': 'Le daemon ne répond plus.',
      'sessions-lost': 'Toutes vos sessions ne sont pas revenues. L’application n’a pas été mise à jour.',
      'download': 'L’application n’a pas pu être téléchargée. Elle n’a pas changé.'
    },
    timeoutCommand: 'systemctl --user status ledge-daemon',
    missing: (names: string[]) => `Manquantes : ${names.join(', ')}`,
    pip: { new: (v: string) => `Ledge ${v} est prêt`, busy: 'Mise à jour en cours…', bad: 'La mise à jour a échoué', ok: 'Ledge est à jour' }
  },
```

- [ ] **Step 2 : tests de la carte**

```tsx
// apps/overlay/test/update-card.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LangProvider } from '../src/i18n/lang';
import { UpdateCard } from '../src/update/UpdateCard';

const r = (ui: React.ReactElement) => render(<LangProvider lang="fr">{ui}</LangProvider>);
const noop = () => {};

describe('UpdateCard', () => {
  it('offers the update with the notes and says sessions keep running', () => {
    const onUpdate = vi.fn();
    r(<UpdateCard view={{ kind: 'available', version: '0.3.0', current: '0.2.2', notes: ['Une', 'Deux'] }} sessions={4} onUpdate={onUpdate} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect(screen.getByText('Ledge 0.3.0 est disponible')).toBeTruthy();
    expect(screen.getByText(/Vos 4 sessions continuent/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });
  it('shows the failure, the exact command and retry', () => {
    r(<UpdateCard view={{ kind: 'failed', reason: 'npm-failed', detail: 'npm ERR! code EACCES', command: 'npm i -g @paradow/ledge@0.3.0' }} sessions={0} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect(screen.getByText(/n’a pas pu se mettre à jour/)).toBeTruthy();
    expect(screen.getByText('npm i -g @paradow/ledge@0.3.0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });
  it('names the sessions that did not come back', () => {
    r(<UpdateCard view={{ kind: 'failed', reason: 'sessions-lost', missing: ['Nova'] }} sessions={0} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect(screen.getByText('Manquantes : Nova')).toBeTruthy();
  });
  it('a clone gets the manual command and a disabled app button until the daemon catches up', () => {
    r(<UpdateCard view={{ kind: 'manual', version: '0.3.0', command: 'cd /c && git pull', canInstallApp: false }} sessions={0} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect((screen.getByRole('button', { name: 'Mettre à jour l’application' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('cd /c && git pull')).toBeTruthy();
  });
  it('renders the running steps as a list with progress', () => {
    r(<UpdateCard view={{ kind: 'running', steps: [{ key: 'daemon', status: 'done', meta: '0.3.0' }, { key: 'restart', status: 'done', meta: '4/4' }, { key: 'download', status: 'run', progress: 0.62 }, { key: 'install', status: 'todo' }] }} sessions={4} onUpdate={noop} onLater={noop} onRetry={noop} onAck={noop} onNotes={noop} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62');
  });
});
```

- [ ] **Step 3 : échec** — `pnpm --filter overlay exec vitest run test/update-card.test.tsx` → FAIL.

- [ ] **Step 4 : implémenter `UpdateCard.tsx`** d'après la maquette (`docs/mockups/ledge-update.html`, classes `.upd`, `.uh`, `.steps`, `.cmd`) en styles inline et variables existantes : fond `var(--well)`, bordure `1px solid var(--input)` (rouge mêlé pour `failed`, vert mêlé pour `updated` avec `color-mix`), rayon `var(--radius-lg)`, marge `NOTICE_GAP px 12px 0`, `padding: 12`, `gap: 10`. En-tête : `ResidentMascot` taille 28 ; titre 14/18 gras ; sous-titre 12/16 `--muted-foreground` ; badge (`Badge` de `ui/Badge.tsx` si sa signature convient, sinon un `span` 11 px gras sur fond `--status-*-soft`). Boutons : `Button` de `ui/Button.tsx` (`variant="primary" size="sm"`, `"ghost"`, `"outline"`). Étapes : `<ol>` de `<li>` ; puce `✓` sur `--status-success-soft`, rond tournant bordé `--info` (sans animation si `prefers-reduced-motion`), rond vide bordé `--input` ; barre de progression `role="progressbar"` avec `aria-valuenow` arrondi en pourcentage. Commande : `code.mono` 11 px sur une ligne qui défile horizontalement, et un bouton « Copier » (`navigator.clipboard.writeText`, libellé « Copié » pendant 1,5 s, erreur ignorée). « Notes complètes » appelle `onNotes`, branché dans `Surface` sur `openUrl('https://github.com/Paradow-dev/ledge/releases/latest')` (`tauri/bridge.ts`). `role="status"` sur la carte en cours, `role="alert"` sur un échec.

- [ ] **Step 5 : brancher**

- `SessionList` : après le bloc `notice`, avant `AskField` :

```tsx
      {update && <div ref={updateRef} data-update>{update}</div>}
```

  et, sur le bouton réglages du header, une pastille quand `gearPip` est vrai (`position: 'relative'` sur le bouton, puis `<span data-gear-pip aria-hidden="true" style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 9999, background: 'var(--sidebar-primary)', border: '2px solid var(--sidebar)' }} />`). Mettre à jour son `aria-label` : `t.list.settings` + `, ${t.update.pip.new(v)}` n'est pas disponible ici, donc ajouter une prop `gearLabel?: string` passée par `Surface`.
- `Surface` : `const updateRef = useRef<HTMLDivElement>(null); const updateH = useMeasuredHeight(updateRef, st.mode === 'list' && !!updateCard, ps); const updateExtraH = updateCard ? NOTICE_GAP + (updateH || 120) : 0;` et ajouter `updateExtraH` partout où `noticeExtraH` entre dans la hauteur de la liste (chercher `noticeExtraH` dans `Surface.tsx`). `updateCard` vaut `update && update.card.kind !== 'hidden' ? <UpdateCard … /> : null`, avec `sessions={sessions.length}`.
- `Handle` : sur le bouton `data-resident`, ajouter la pastille quand `updatePip` est non nul :

```tsx
          {updatePip && <span data-update-pip={updatePip} aria-hidden="true" style={{ position: 'absolute', top: 0, right: -2, width: 9, height: 9, borderRadius: 9999, border: '2px solid var(--notch)', background: { new: 'var(--sidebar-primary)', busy: 'var(--info)', bad: 'var(--danger-text)', ok: 'var(--success)' }[updatePip], animation: updatePip === 'busy' && !reducedMotion ? 'ledge-pulse 1.2s ease-in-out infinite' : undefined }} />}
```

  et, dans le `title` du bouton, préfixer le texte de `t.update.pip[...]` quand une pastille est là. Ajouter `@keyframes ledge-pulse { 50% { opacity: .35 } }` dans `styles/base.css` s'il n'existe pas déjà une animation équivalente.
- La pastille `ok` ne reste que six secondes : `useUpdate` expose `pip`, et `Surface` la masque après 6 s (`useDelayed` existe dans `surface/useDelayed.ts`).
- `App.tsx` : `const update = useUpdate(client);` puis `update={update}` sur `<Surface>`.

- [ ] **Step 6 : tests** — `pnpm --filter overlay test && pnpm typecheck` → PASS, i18n compris. Ajouter à `test/list.test.tsx` un cas : avec `update={<div>card</div>}`, la carte est rendue entre l'en-tête et le champ « Demander à Ledge », et `gearPip` affiche `[data-gear-pip]`. Ajouter à `test/handle.test.tsx` : `updatePip="new"` rend `[data-update-pip="new"]`.

- [ ] **Step 7 : commit**

```bash
git add apps/overlay/src apps/overlay/test
git commit -m "feat(overlay): the update card in the list and its pips on the island and the gear"
```

---

### Task 14 : l'onglet « À propos »

**Files:**
- Modify: `apps/overlay/src/surface/SettingsView.tsx`, `apps/overlay/src/i18n/messages.ts`, `apps/overlay/src/surface/Surface.tsx`
- Test: `apps/overlay/test/settings.test.tsx`

**Interfaces:**
- Consumes: `UpdateController` (tâche 12), `compareVersions` (tâche 10).
- Produces: `SETTINGS_TABS = ['display', 'notifications', 'sounds', 'about']` ; `SettingsViewProps` gagne `about?: { app: string | null; daemon: DaemonInfo | null; latest: string | null; auto: boolean; checkedAt: number | null; onAuto: (on: boolean) => void; onCheck: () => void }`.

- [ ] **Step 1 : textes** (dans `settings`, les deux langues) :

```ts
    tabAbout: 'À propos', versions: 'Versions', versionsHint: 'Les deux moitiés de Ledge doivent avoir la même version.',
    versionsMismatch: 'Les deux moitiés n’ont pas la même version.', versionApp: 'Application Windows', versionDaemon: 'Daemon WSL', versionLatest: 'Dernière version',
    installKind: { npm: 'npm', git: 'clone git', unknown: 'inconnu' }, unknownVersion: '—',
    autoUpdate: 'Rechercher les mises à jour', autoUpdateHint: 'Au démarrage, puis toutes les 6 heures. Ledge ne met jamais à jour sans votre clic.',
    checked: (ago: string) => `Vérifié ${ago}`, neverChecked: 'Jamais vérifié', checkedHint: 'Sur les releases GitHub de Paradow-dev/ledge.', checkNow: 'Vérifier',
```

Pour `ago`, réutiliser le formateur de durée existant dans `src/format.ts` (celui qu'utilise la liste pour « 18 min ») : chercher la fonction exportée et l'appeler, ne pas en écrire une nouvelle.

- [ ] **Step 2 : test**

```tsx
// à ajouter dans apps/overlay/test/settings.test.tsx (reprendre le rendu de base des tests existants du fichier)
it('shows both versions, flags a mismatch and checks on demand', () => {
  localStorage.setItem('ledge.settings.tab', 'about');
  const onCheck = vi.fn();
  renderSettings({ about: { app: '0.2.2', daemon: { version: '0.3.0', install: 'npm', systemd: true }, latest: '0.3.0', auto: true, checkedAt: Date.now() - 12 * 60_000, onAuto: () => {}, onCheck } });
  expect(screen.getByText('0.2.2')).toBeTruthy();
  expect(screen.getByText('0.3.0 · npm')).toBeTruthy();
  expect(screen.getByText('Les deux moitiés n’ont pas la même version.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
  expect(onCheck).toHaveBeenCalledOnce();
});
```

(`renderSettings` : le helper de rendu déjà utilisé dans ce fichier ; s'il n'existe pas, créer une fonction locale qui rend `<LangProvider lang="fr"><SettingsView …props minimales des autres tests… {...extra} /></LangProvider>`.)

- [ ] **Step 3 : échec**, puis **Step 4 : implémenter** : ajouter `'about'` à `SETTINGS_TABS` et au `tabLabel` ; le panneau `about` affiche une `Row` « Versions » (une `<dl>` à deux colonnes : application, daemon `version · installKind`, dernière version en `var(--sidebar-primary)` si plus récente ; l'indication passe en `var(--warning)` avec `versionsMismatch` quand application et daemon diffèrent), une `Row` avec le `Switch` existant pour `autoUpdate`, puis une ligne « Vérifié il y a … » avec `Button variant="outline" size="sm"` « Vérifier ». L'onglet n'apparaît que si `about` est fourni. `Surface` passe `about` depuis `update`.

- [ ] **Step 5 : tests verts** — `pnpm --filter overlay test && pnpm typecheck` → PASS.

- [ ] **Step 6 : commit**

```bash
git add apps/overlay/src apps/overlay/test/settings.test.tsx
git commit -m "feat(overlay): an About tab with both versions and the update check"
```

---

### Task 15 : e2e, captures et documentation

**Files:**
- Create: `apps/overlay/e2e/update.spec.ts`
- Modify: `apps/overlay/e2e/daemon.ts` (snapshot avec `daemon`, envoi de `update.*`), `apps/overlay/e2e/screenshots.spec.ts`, `README.md`, `packages/ledge/README.md`, `docs/tour.md`, spec (statut)

- [ ] **Step 1 : e2e.** Dans le navigateur, il n'y a pas de Tauri : `checkForUpdate` renvoie null. Exposer un point d'injection pour les tests et la démo seulement : dans `useUpdate`, si `import.meta.env.DEV && window.__LEDGE_FAKE_UPDATE__` est défini, l'utiliser comme résultat de `check` (même forme que `AvailableUpdate`, `downloadAndInstall` qui appelle la progression puis se résout). Le spec :

```ts
// apps/overlay/e2e/update.spec.ts
import { test, expect } from './fixtures';
import { fakeDaemon, session } from './daemon';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).__LEDGE_FAKE_UPDATE__ = { version: '0.3.0', notes: '- Réponses depuis le chat\n- Île plus réactive', downloadAndInstall: async (p: any) => { p(5, 10); } }; });
});

test('the island and the list offer the update, and the click asks the daemon first', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Otto' })], { daemon: { version: '0.2.2', install: 'npm', systemd: true } });
  await page.goto('/');
  await expect(page.locator('[data-update-pip="new"]')).toBeVisible();
  await page.locator('[data-resident]').click();
  await expect(page.getByText('Ledge 0.3.0 est disponible')).toBeVisible();
  await page.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect.poll(() => d.received).toContainEqual({ type: 'update.daemon', version: '0.3.0' });
  d.send({ type: 'update.failed', version: '0.3.0', reason: 'sessions-at-risk' });
  await expect(page.getByRole('alert')).toContainText('un redémarrage les fermerait');
});
```

Ajouter à `e2e/daemon.ts` : `extras.daemon` dans le type et le snapshot, et une méthode `send(m: unknown)` publique (elle existe en interne). La version de l'application dans le navigateur vaut null : `targetOf` doit quand même proposer la version, parce que le daemon est en retard. C'est le cas couvert par `needsDaemon`.

- [ ] **Step 2 : captures.** Dans `screenshots.spec.ts`, ajouter `update-available-dark.png`, `update-running-dark.png`, `update-failed-dark.png` et `settings-about-dark.png`, sur le modèle des captures existantes. Les recapturer (voir la mémoire « Ledge test env quirks » pour la commande et les pièges).

- [ ] **Step 3 : documentation**
  - `README.md`, « 1. Install the CLI and the daemon in WSL » : `npm i -g @paradow/ledge && ledge setup` (avec la note sur nvm : utiliser le npm du Node 22+ qui fera tourner le daemon). L'installation depuis le clone passe dans « Development ».
  - « Update » : le bouton (pastille sur la mascotte, carte dans la liste) ; à la main : `npm i -g @paradow/ledge@latest && systemctl --user restart ledge-daemon` puis l'installeur. Avertir qu'un serveur tmux lancé avant la version avec scope reste dans le service : fermer les sessions ou redémarrer WSL une fois.
  - « Components » / « Security and failure model » : l'updater, la signature minisign, la règle « daemon d'abord, aucune session perdue ».
  - `docs/tour.md` : une section « Mise à jour » avec les trois captures.
  - Spec : `Statut : implémenté le <date> (plan : 2026-10-12-auto-update.md)`.

- [ ] **Step 4 : tout vérifier**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm --filter overlay test:e2e`
Expected: tout vert, à la flakiness e2e connue près (la relancer une fois avant de conclure).

- [ ] **Step 5 : commit**

```bash
git add apps/overlay/e2e apps/overlay/src docs README.md packages/ledge/README.md
git commit -m "docs: install from npm, update from the island; e2e and captures of the update card"
```

---

### Task 16 : première release et migration (gestes humains, guidés)

Pas de code. Chaque étape visible à l'extérieur se fait avec l'accord explicite de l'utilisateur.

- [ ] **Step 1 : licence.** Confirmer le champ `license` de `packages/ledge/package.json` (`UNLICENSED` par défaut) avant de rendre le code public.
- [ ] **Step 2 : build de contrôle.** `gh workflow run Release --ref main -f version=0.3.0` → deux jobs verts, `latest.json` affiché, `npm pack` correct.
- [ ] **Step 3 : dépôt public.** L'utilisateur passe `Paradow-dev/ledge` en public (Settings > General > Danger Zone).
- [ ] **Step 4 : tag.** `node apps/overlay/scripts/set-version.mjs 0.3.0`, commit `chore: 0.3.0`, puis tag annoncé en français (`Ledge 0.3.0 — mises à jour depuis l'île`, puces, « Les réglages existants sont conservés. », et « Le Rust change : plugins updater et process. »). `git push origin main v0.3.0`, puis `gh run watch`.
- [ ] **Step 5 : vérifier la publication.** `npm view @paradow/ledge version` → `0.3.0` ; `curl -sL https://github.com/Paradow-dev/ledge/releases/latest/download/latest.json` → JSON avec `version: "0.3.0"` et une signature.
- [ ] **Step 6 : migrer la machine de référence vers npm.** Avant tout : `tmux -L ledge list-sessions` ; si des sessions tournent dans l'ancien serveur (cgroup du service), ne pas redémarrer le daemon tant qu'elles vivent. Ensuite :

```sh
~/.local/share/nvm/v26.7.0/bin/npm i -g @paradow/ledge@0.3.0
~/.local/share/nvm/v26.7.0/bin/ledge setup     # réécrit l'unité et le lien ~/.local/bin/ledge
ledge --version                                # 0.3.0
systemctl --user status ledge-daemon           # ExecStart pointe sous node_modules/@paradow/ledge
```

  Sur Windows, installer `Ledge_0.3.0_x64-setup.exe` à la main : c'est la première version qui embarque l'updater.
- [ ] **Step 7 : Trusted Publishing.** Sur npmjs.com, `@paradow/ledge` > Settings > Trusted Publisher > GitHub Actions (`Paradow-dev`, `ledge`, `release.yml`). Puis `gh secret delete NPM_TOKEN --repo Paradow-dev/ledge` et révocation du jeton.
- [ ] **Step 8 : premier vrai test du bouton** à la release suivante (0.3.1) : vérifier sur la machine de référence que la carte apparaît, que le daemon passe en 0.3.1 avec toutes ses sessions, puis que l'application se relance en 0.3.1.
- [ ] **Step 9 : mémoire.** Mettre à jour la mémoire « Ledge release process » : job npm, `latest.json`, déclenchement manuel, Trusted Publishing.
