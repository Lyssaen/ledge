# Lot 5 : cycle de vie des rigs et lancement — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** agir sur les rigs depuis Ledge. On arrête, relance, reprend un rig ; on relance, arrête ou relève un siège ; on écrit à un siège. On lance un rig en trois temps, dans un projet ou hors projet. Ledge suit les dépôts trouvés d'un rig hors projet et permet de le « Ranger dans un projet… ». Le daemon refuse tout geste destructif direct sur un siège (`rig_managed`).

**Architecture :**
- Daemon : le pont du lot 2 (`packages/ledge/src/daemon/openrig/`) gagne six modules, chacun derrière une fonction pure testée contre le faux OpenRig :
  - `actions.ts` : `rig.act` → routes HTTP ;
  - `guard.ts` : refus `rig_managed` ;
  - `plan.ts` : `rig.prepare` → plan ;
  - `launch.ts` : `rig.launch`, remise du but, annulation ;
  - `workspace.ts` : copie `git worktree` ou espace hors projet ;
  - `repos.ts` : dépôts trouvés.

  Plus `rig.send` et `rig.adopt` dans `server.ts`, et le contexte de siège dans `cli/hook.ts`.
- Desktop : la fenêtre « Nouveau rig » en trois temps (`apps/desktop/src/launch/`), sur le modèle de `LaunchComposer`. Les actions de Rigs › En cours, la confirmation « Arrêter… », les dépôts trouvés et « Ranger » se branchent sur `RigCard` et `RigRoom` (lot 3).
- Le lot 6 se charge de l'exécution distante. Ici, le choix de machine envoie à la machine choisie par la flotte, sans relais propre.

**Tech Stack :** TypeScript, zod, vitest (minuteries factices), React 19, playwright, `git` en sous-processus (`daemon/git.ts`, `execGit`), le binaire `rig` d'`@openrig/cli` 0.6.14 (jamais lancé en test).

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` (§4.5, §4.6, §4.7, §8.2 En cours, §8.4). Plan maître : `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md` (contrat et Global Constraints font foi). Maquettes : `l-1-nouveau.png`, `l-2-plan.png`, `l-3-demarrage.png`, `w-1-nouveau.png`, `w-2-encours.png`, `w-3-piece.png`, `p-rigs-live.png`.

## Global Constraints

Celles du plan maître s'appliquent toutes, en particulier :
- **Cycle de vie d'un siège uniquement par OpenRig.** Aucun `tmux kill-session` ni `kill` sur une session appariée à un rig.
- Ledge démarre OpenRig lui-même (`rig daemon start`) au lancement d'un rig et à une action sur un rig, et le dit dans le fil.
- Accès à OpenRig par `127.0.0.1:7433` (ou `OPENRIG_PORT`) et le binaire `rig`, jamais par la base SQLite.
- Persistance sous `paths()` : `rigs/<nom>/` (espaces hors projet), et `rig-launches.json` (nouveau, voir Task 6).
- Libellés mot pour mot : « Nouveau rig », « But donné au lead », « Spec OpenRig », « L'équipe qu'OpenRig monte », « Recommandé par Ledge », « Changer », « Choisir pour ce rig », « Depuis le registre… », « Fournisseurs », « Projet », « Machine », « Dossiers et dépôts sur {machine} », « nouvelle branche {b} », « Où travaille le rig », « + Nouvel espace, hors projet », « Espace de travail », « Ledge le crée vide, nommé d'après le but. OpenRig y installe le rig. », « Annuler », « Voir le plan », « Lancer le rig », « Plan du rig {spec} », « Ce qui démarre · n sièges », « Ce qui change dans {dossier} », « Travailler dans une copie : .worktrees/rig-{spec} », « Après le lancement », « Retour », « Annuler le lancement », « Ouvrir l'invite », « Arrêter… », « Arrêter le rig », « Seulement ce siège », « Dépôts trouvés · n », « ce que le rig a cloné ou ouvert », « Ranger dans un projet… », « Ranger dans {projet} », « Je ne déplace rien sans toi ».
- Commits `feat(ledge): …`, `feat(protocol): …`, `feat(desktop): …`, un par tâche, avec `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests : `pnpm --filter @paradow/ledge test`, `pnpm --filter @ledge/protocol test`, `pnpm --filter desktop test`, `pnpm --filter desktop e2e`. Racine `pnpm test && pnpm typecheck` verte en fin de lot. **Aucun test ne lance un vrai `rig` ni un vrai OpenRig.**

## Faits OpenRig 0.6.14 vérifiés (lecture seule, `daemon/dist/routes/*.js`)

| Verbe Ledge | Appel | Corps |
|---|---|---|
| `down` (rig) | `POST /api/down` | `{ rigId, snapshot: true }` (`delete`/`force` jamais envoyés). 404 rig inconnu, 500 erreur |
| `up` (rig) | `POST /api/rigs/:id/up` | `{}`. Restaure depuis l'instantané utilisable choisi par OpenRig ; refus `code: 'no_snapshot'` |
| `restore` (rig) | `GET /api/rigs/:rigId/snapshots` puis `POST /api/rigs/:rigId/restore/:snapshotId` | la route de la spec (`/restore`) exige un `snapshotId` : on prend le plus récent |
| `restart` (siège) | `POST /api/seat/restart/:seatRef` | `{ reason, operator }`, `reason` **obligatoire** (`missing_reason`) |
| `stop` (siège) | `POST /api/seat/stop/:seatRef` | `{ reason, operator }`, `reason` obligatoire |
| `handover` (siège) | `POST /api/seat/handover/:seatRef` | `{ reason, source: 'fresh', operator }` (`parseHandoverSource` : `fresh`, `rebuild`, `fork:…`) |
| écrire à un siège | `rig send <ref> "<texte>" --json` | jamais `--raw` ni `--dangerously-interact` |
| lancer | `rig up <spec> --cwd <dossier> --yes --json` | pas de drapeau « but » |
| plan d'un siège | `GET /api/specs/library/:id` (YAML) | `specSeats` du lot 3 |

- `reason` [P] : « Ledge : {geste} demandé par l'utilisateur » ;
- `operator` [P] : `ledge@external`, ou l'adresse fixée par la fiche du lot 0 si elle diffère.
- L'en-tête `From:` de `rig send` vient de `OPENRIG_SESSION_NAME` ; Ledge lance `rig send` avec `OPENRIG_SESSION_NAME=<adresse humaine du lot 0>` et préfixe le texte par « Ledge : ».

## Hypothèses sur les lots 2, 3 et 4

On suit leur code si un nom diffère.
- **Lot 2** (plan `2026-10-30-ledge-openrig-2-pont-lecture.md`) :
  - `OpenRigHttp` (`createOpenRigHttp({ base })`, méthodes nommées `health`, `ps`, `nodes`, `kernel`, `queue`, `outbox`) ; `RigExec` (`(args, opts?) => Promise<{ code, stdout, stderr }>`) et `RigCli` (`createRigCli(exec)` : `available`, `version`, `daemonStart`, `humans`, `addHuman`) ;
  - le miroir `Mirror` (`rigs()`, `byRef(ref)`, `byName(name)`, `pair`) et le pont `Bridge` (`status()`, `rigs()`, `onMessage(fn)` qui émet `rig.updated`, `ensureRunning(reason: 'launch' | 'action')`, `pair`) ; `BridgeDeps.notice(text)` est la voix de Ledge dans le fil (branchée par le lot 4) ;
  - `OpenRigStatus` a `unreachable` et `install?` ; la flotte expose `fleet.openrig(): OpenRigStatus[]` et le hook `useOpenRig(client)` ; `useRigs(client)` ; `RIG_RESULT_CODES` ;
  - l'appariement passe par `session.event.openrig { sessionName, nodeId? }`, que le hook envoie grâce à `openrigSeat(agent, env)` ;
  - le faux `createFakeOpenRig()` (vrai port local, `requests`, `rigs`, `emit`) et `fakeRigCli(rig, opts)` qui rend un `RigExec`.
  - **Le lot 6** rend les gestionnaires de ce lot idempotents par `rid` (il les enveloppe) : rien à faire ici pour un `rid` rejoué.
- **Lot 3** :
  - `specSeats(yaml)` et `listSpecs(http)` (`openrig/specs.ts`) ;
  - `useRigSpecs`, `fleet.seatTerminal` ;
  - `RigCard` (props `actions`, `seatAction`, `footer`), `RigRoom` (prop `extraActions`) ;
  - le modèle `apps/desktop/src/rigs/model.ts` ;
  - la modale `{ kind: 'rig-launch', project?, spec?, goal?, machine? }` et `launch/RigLaunch.tsx` (attente, remplacée ici) ;
  - le faux daemon e2e étendu (`rigs`, `specs`, `pushRig`).
- **Lot 4** : il branche `BridgeDeps.notice` sur le fil de Ledge. Ce lot parle au fil par la même fonction (`say`, ci-dessous) ; sans le lot 4, elle écrit dans le journal du daemon, sans plus.

## Review Focus

1. **Geste destructif sur un siège depuis une vieille surface** (plan maître, n° 3) : `session.kill`, `session.archive`, `session.delete`, la fermeture par carte (`session.close`), `session.model` (qui relance la session) et la relève Ledge (`handover.ts`) visent une session appariée. Attendu : refus `rig_managed`, aucun appel à `tmux.killSession`, le siège intact. Test : Task 2.
2. **« Lancer » confirmé deux fois** (double clic, Desktop et téléphone sur le même plan). Attendu : un seul `rig up`, et le second `rig.launch` reçoit `rig.result { ok: false, code: 'failed', reason: 'plan already launched' }`. Test : Task 6.
3. **Le dossier ou la branche de la copie existe déjà** (relancer factory dans le même dépôt). Attendu : une copie `.worktrees/rig-factory` déjà sur la branche voulue est réutilisée ; un dossier présent qui n'est pas cette copie est refusé avec sa raison ; jamais `git worktree add --force`, jamais `rm`. Test : Task 6.
4. **Le daemon Ledge redémarre pendant un lancement.** Attendu : le but part quand même, une seule fois (lancement et `goalSentAt` persistés dans `rig-launches.json`). Le délai de 10 min compte depuis le début réel. Test : Task 6.
5. **Nom d'espace hors projet dangereux ou pris** (`../x`, `a b`, majuscules, nom de 60 caractères, dossier existant non vide). Attendu : refus avant toute écriture disque, avec la raison affichée sous le champ. Le nom suit `^[a-z0-9][a-z0-9-]{0,39}$`. Test : Task 5 (daemon) et Task 11 (champ).

---

### Task 1 : Contrat (lancement, `rig_managed`, rigs rangés)

**Files :**
- Modify : `packages/protocol/src/openrig.ts`, `packages/protocol/src/messages.ts`, `packages/protocol/src/projects.ts`
- Test : `packages/protocol/test/openrig.test.ts`, `packages/protocol/test/projects.test.ts`

**Interfaces :**
- Produces :
  ```ts
  // openrig.ts
  export const RigLaunchInfoSchema = z.object({ planId: z.string(), goal: z.string(), lead: z.string(),   // ref du siège lead
    startedAt: z.string().datetime(), goalSentAt: z.string().datetime().optional(), lateNotice: z.boolean().optional() });
  // RigSchema gagne : launch: RigLaunchInfoSchema.optional()
  export const RIG_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
  // messages.ts : RefusalCodeSchema gagne 'rig_managed'
  // projects.ts : ProjectSchema gagne rigs: z.array(z.string().min(1).max(200)).max(200).default([])  (ids de rig, spec §4.7)
  //               ProjectsProblemCode gagne 'duplicate_rig' (un rig rangé dans deux projets)
  ```

- [ ] **Step 1 : tests qui échouent**
```ts
it('RigSchema accepte launch et le garde', () => expect(RigSchema.parse({ ...RIG, launch: L }).launch).toEqual(L));
it('RefusalCodeSchema connaît rig_managed', () => expect(RefusalCodeSchema.parse('rig_managed')).toBe('rig_managed'));
it('un projets.json sans rigs se lit avec rigs: []', () => expect(ProjectsSchema.parse(OLD).projects[0]!.rigs).toEqual([]));
it('un rig rangé dans deux projets → duplicate_rig', () =>
  expect(projectsProblems(TWO_WITH_SAME_RIG).map(p => p.code)).toContain('duplicate_rig'));
it('RIG_NAME refuse ../x, a b, Factory, 41 caractères', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @ledge/protocol test` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter @ledge/protocol test && pnpm typecheck` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(protocol): rig launch info, rig_managed refusal, rigs filed in projects"`

---

### Task 2 : Refus `rig_managed` sur toute session appariée

**Files :**
- Create : `packages/ledge/src/daemon/openrig/guard.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (cas `session.kill`, `session.archive`, `session.delete`, `session.model`, `closeForCard`, et `endSession`), `packages/ledge/src/daemon/handover.ts` (`relieve`)
- Test : `packages/ledge/test/openrig-guard.test.ts`

**Interfaces :**
- Produces :
  ```ts
  export const RIG_MANAGED = 'this session is a seat of an OpenRig rig: stop or restart it through its rig';
  export function rigManaged(s: Pick<Session, 'rig'>): Refusal | null; // Refusal(RIG_MANAGED, 'rig_managed') si s.rig
  export class RigManagedError extends Error { code: 'rig_managed' }
  ```

Règle : chaque cas listé appelle `rigManaged(s)` d'abord et `refuse(r, msg.id)` s'il refuse. `endSession` jette `RigManagedError` sur une session appariée, en dernier filet pour un chemin oublié (actions de carte, téléphone). La relève Ledge (`handover.ts`) ne relève pas un siège : elle sort sans rien faire et le note dans le journal. La relève d'un siège passe par `rig.act { verb: 'handover' }`.

- [ ] **Step 1 : tests qui échouent** (serveur réel du test, tmux factice qui compte les `killSession`)
```ts
for (const msg of [{ type: 'session.kill', id: 'b' }, { type: 'session.archive', id: 'b' }, { type: 'session.delete', id: 'b' },
                   { type: 'session.model', id: 'b', model: 'sonnet' }] as const)
  it(`${msg.type} sur un siège → error rig_managed, tmux intact`, async () => {
    const { send, tmux } = await serverWith([{ ...session('b'), source: 'launcher', rig: SEAT_RIG }]);
    expect(await send(msg)).toMatchObject({ type: 'error', id: 'b', code: 'rig_managed', request: msg.type });
    expect(tmux.killed).toEqual([]);
  });
it('carte de fermeture qui vise un siège : la ligne échoue, rien n’est tué', …);
it('relève Ledge d’un siège : ignorée, journal « seat of a rig »', …);
it('une session seule se tue toujours', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @paradow/ledge test openrig-guard` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter @paradow/ledge test openrig-guard server handover` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): refuse direct kills of rig seats (rig_managed)"`

---

### Task 3 : `rig.act` vers les routes d'OpenRig

**Files :**
- Create : `packages/ledge/src/daemon/openrig/actions.ts`
- Modify : `packages/ledge/src/daemon/openrig/http.ts` (méthode générique `call`), `packages/ledge/src/daemon/openrig/cli.ts` (`RigExec` accepte `env`, `RigCli.up`, `RigCli.send`), `packages/ledge/src/daemon/openrig/bridge.ts` (`annotate`), `packages/ledge/src/daemon/server.ts` (cas `rig.act`), `packages/ledge/test/fakes/openrig.ts` (routes de cycle de vie et d'instantanés, `body` noté, `fakeRigCli` scriptable pour `up`/`send` avec `calls`)
- Test : `packages/ledge/test/openrig-actions.test.ts`

**Interfaces :**
- Consumes : `OpenRigHttp`, `Bridge.ensureRunning('action')`, `Bridge.rigs()`.
- Produces (ajouts aux modules du lot 2, réutilisés par les Tasks 4 à 8) :
  ```ts
  // http.ts
  call(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<{ status: number; json: unknown }>;
  // cli.ts
  export type RigExec = (args: string[], opts?: { timeoutMs?: number; env?: Record<string, string> }) => Promise<{ code: number; stdout: string; stderr: string }>;
  up(spec: string, cwd: string): Promise<{ ok: true; rigId: string; rigName: string } | { ok: false; detail: string }>; // RigCli, délai 300 s
  send(ref: string, text: string, human: string): Promise<{ ok: boolean; detail?: string }>;                           // RigCli
  // bridge.ts : champs propres à Ledge, gardés à travers les relectures du miroir, émis en rig.updated
  annotate(rigId: string, extra: { launch?: RigLaunchInfo | null; repos?: RigRepo[] }): Rig | null;
  // fakes/openrig.ts
  //   FakeOpenRig.requests[] gagne body? ; FakeOpenRig.snapshots: Map<rigId, { id: string; createdAt: string }[]> ;
  //   FakeOpenRig.reply(method, path, status, json) pour scripter un refus ;
  //   fakeRigCli(rig, { calls?: { args: string[]; env?: Record<string, string> }[]; up?: (spec, cwd) => { code, stdout, stderr } })
  // actions.ts
  export type RigTarget = { rigId: string; seatRef?: undefined } | { rigId?: string; seatRef: string };
  export interface RigRequest { method: 'POST'; path: string; body: Record<string, unknown> }
  export function rigActRequest(verb: RigVerb, target: RigTarget, operator: string): RigRequest | 'restore'; // 'restore' : deux appels
  export async function actOnRig(d: { http: OpenRigHttp; ensureRunning(r: 'action'): Promise<OpenRigStatus>; operator: string },
    msg: { verb: RigVerb } & RigTarget): Promise<{ ok: true } | { ok: false; code: 'openrig_down' | 'unsupported' | 'failed'; reason: string }>;
  ```

Règles :
- Verbe de rig sans `rigId`, ou verbe de siège sans `seatRef` → `failed`, `reason: 'invalid target'`, sans appel.
- `up` vers un siège : refusé de même. Les verbes de siège sont `restart`, `stop` et `handover` ; ceux de rig sont `down`, `up` et `restore`.
- `ensureRunning` avant tout appel ; un état final autre que `running` → `openrig_down` (ou `unsupported`).
- Réponse non 2xx → `failed`, `reason` = `error`, `message` ou `code` du corps JSON, sinon `HTTP <status>`.
- `restore` : `GET /api/rigs/:rigId/snapshots`, puis le plus récent par `createdAt` ; aucun → `failed`, `reason: 'no snapshot'`.
- `server.ts` répond `rig.result { rid, ok, code?, reason? }` au demandeur seul. Le miroir montre l'effet par le SSE (lot 2).

- [ ] **Step 1 : tests qui échouent**
```ts
it.each([
  ['down',     { rigId: 'r1' },              'POST /api/down',                         { rigId: 'r1', snapshot: true }],
  ['up',       { rigId: 'r1' },              'POST /api/rigs/r1/up',                   {}],
  ['restart',  { seatRef: 'dev-build@r' },   'POST /api/seat/restart/dev-build%40r',   { reason: expect.stringMatching(/^Ledge : /), operator: 'ledge@external' }],
  ['stop',     { seatRef: 'dev-build@r' },   'POST /api/seat/stop/dev-build%40r',      { reason: expect.any(String), operator: 'ledge@external' }],
  ['handover', { seatRef: 'dev-build@r' },   'POST /api/seat/handover/dev-build%40r',  { reason: expect.any(String), source: 'fresh', operator: 'ledge@external' }],
])('%s → %s', async (verb, target, route, body) => {
  const rig = await createFakeOpenRig(); rig.rigs.push(FACTORY_FAKE);
  expect(await actOnRig(deps(rig), { verb, ...target })).toEqual({ ok: true });
  expect(rig.requests.at(-1)).toMatchObject({ method: route.split(' ')[0], path: route.split(' ')[1], body });
});
it('restore : le plus récent des instantanés', …);
it('restore sans instantané → failed « no snapshot »', …);
it('OpenRig arrêté : ensureRunning est appelé ; s’il échoue → openrig_down, aucun appel de cycle', …);
it('refus OpenRig (409, code no_snapshot) → failed avec la raison', …);
it('restart sans seatRef → failed invalid target, aucun appel', …);
it('server : rig.act répond rig.result au seul demandeur', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @paradow/ledge test openrig-actions` · Expected : FAIL.
- [ ] **Step 3 :** implémenter. Le `seatRef` est encodé avec `encodeURIComponent` dans le chemin.
- [ ] **Step 4 :** Run `pnpm --filter @paradow/ledge test openrig-actions` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): rig.act drives rigs and seats through OpenRig"`

---

### Task 4 : `rig.send` (écrire à un siège)

**Files :**
- Create : `packages/ledge/src/daemon/openrig/send.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (cas `rig.send`)
- Test : `packages/ledge/test/openrig-send.test.ts`

**Interfaces :**
- Produces :
  ```ts
  export async function sendToSeat(d: { cli: RigCli; human: string; ensureRunning(r: 'action'): Promise<OpenRigStatus> },
    seatRef: string, text: string): Promise<{ ok: true } | { ok: false; code: 'openrig_down' | 'failed'; reason: string }>;
  ```

Règles : `RigCli.send` (Task 3) passe l'argv exact `['send', seatRef, 'Ledge : ' + text, '--json']` et l'env `OPENRIG_SESSION_NAME=<human>` ; texte vide ou blanc → `failed` sans appel ; code ≠ 0 → `failed` avec la première ligne de `stderr`. Le lot 4 réutilise `sendToSeat` pour `@siège` dans le fil.

- [ ] **Step 1 : tests qui échouent**
```ts
it('rig send <ref> « Ledge : … » --json, signé par OPENRIG_SESSION_NAME', async () => {
  const calls: Call[] = []; const cli = createRigCli(fakeRigCli(null, { calls }));
  await sendToSeat({ cli, human: 'ledge@external', ensureRunning: running }, 'dev-build@starter', 'relis la PR');
  expect(calls.at(-1)).toEqual({ args: ['send', 'dev-build@starter', 'Ledge : relis la PR', '--json'], env: { OPENRIG_SESSION_NAME: 'ledge@external' } });
});
it('n’utilise jamais --raw ni --dangerously-interact', …); // vérifie tous les appels du fichier de test
it('échec du CLI → failed avec stderr', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @paradow/ledge test openrig-send` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter @paradow/ledge test openrig-send` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): rig.send writes to a seat, signed Ledge"`

---

### Task 5 : `rig.prepare` → plan

**Files :**
- Create : `packages/ledge/src/daemon/openrig/plan.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (cas `rig.prepare`), `packages/ledge/src/paths.ts` (`rigs: join(dir, 'rigs')`, `rigLaunches: join(dir, 'rig-launches.json')`)
- Test : `packages/ledge/test/openrig-plan.test.ts`

**Interfaces :**
- Consumes : `specSeats` et la route `GET /api/specs/library/:id` (lot 3), `readProjects`, `RIG_NAME` (Task 1).
- Produces :
  ```ts
  export const PLAN_TTL_MS = 30 * 60_000;
  export function rigCwd(where: RigLaunchWhere, spec: string, home: string): string;
  //   project + copy  → `${repo}/.worktrees/rig-${spec}` ; project sans copie → repo ; off-project → `${home}/rigs/${name}` (home = paths().dir)
  export function isPlanRequired(where: RigLaunchWhere): boolean;      // project && !copy  (spec §4.6 : vrai dépôt)
  export function plannedWrites(seats: readonly RigSpecSeat[]): string[];
  //   toujours '.openrig/' et '.mcp.json' ; claude-code → 'CLAUDE.md', '.claude/settings.local.json' ; codex → 'AGENTS.md' ; sans doublon, dans cet ordre
  export function upCommand(spec: string, cwd: string): string;        // `rig up ${spec} --cwd ${cwd} --yes --json`
  export interface Plans { put(p: RigPlan): void; take(id: string): RigPlan | 'used' | null; get(id: string): RigPlan | null }
  export function createPlans(now: () => number): Plans;               // mémoire, TTL, un plan ne se prend qu'une fois
  export async function prepareRigPlan(d: { http: OpenRigHttp; home: string; projects(): Projects; machine: string },
    msg: { spec: string; goal: string; where: RigLaunchWhere }): Promise<RigPlan | { refused: string }>;
  ```

Règles de validation (refus avant tout, renvoyé en `rig.result { ok: false, code: 'failed', reason }`) :
- but vide → `goal required` ;
- spec inconnue de la bibliothèque → `unknown spec <s>` ;
- projet inconnu, ou `repo` absent du projet sur cette machine → `unknown repo` ;
- branche vide quand `copy` → `branch required` ;
- nom hors projet hors `RIG_NAME` → `invalid name` ;
- dossier `rigs/<nom>` existant et non vide → `workspace exists`.

Le plan porte :
- `seats` : `{ address, runtime, model?, autonomy: profile ?? 'default' }` ;
- `writes` = `plannedWrites` ;
- `command` = `upCommand` ;
- `required` = `isPlanRequired` ;
- `id` = `plan-<uuid>`.

`server.ts` répond `rig.plan { rid, plan }`.

- [ ] **Step 1 : tests qui échouent**
```ts
it('projet + copie : cwd .worktrees/rig-factory, plan non imposé', async () => {
  const plan = await prepareRigPlan(d, { spec: 'factory', goal: 'G', where: { kind: 'project', projectId: 'ledge', repo: '/w/ledge', branch: 'feat/rigs', copy: true } });
  expect(plan).toMatchObject({ cwd: '/w/ledge/.worktrees/rig-factory', required: false, command: 'rig up factory --cwd /w/ledge/.worktrees/rig-factory --yes --json' });
  expect((plan as RigPlan).seats).toHaveLength(7);
});
it('projet sans copie : vrai dépôt → required', …);
it('hors projet : ~/.ledge/rigs/reprise-wsl, non imposé', …);
it.each(['../x', 'a b', 'Factory', 'x'.repeat(41)])('nom « %s » refusé, rien d’écrit', …);
it('dossier hors projet existant non vide → workspace exists', …);
it('plannedWrites : claude-code + codex → .openrig/, .mcp.json, CLAUDE.md, .claude/settings.local.json, AGENTS.md', …);
it('Plans.take : une fois, puis « used » ; après 30 min, null', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @paradow/ledge test openrig-plan` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter @paradow/ledge test openrig-plan` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): rig.prepare builds a launch plan"`

---

### Task 6 : `rig.launch`, espace de travail, remise du but, annulation

**Files :**
- Create : `packages/ledge/src/daemon/openrig/workspace.ts`, `packages/ledge/src/daemon/openrig/launch.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (cas `rig.launch`, démarrage du suivi au boot), `packages/ledge/test/fakes/openrig.ts` (`rig up` scripté : JSON `{ rigId, rigName }`, puis un `rig.updated` de sièges qui démarrent)
- Test : `packages/ledge/test/openrig-launch.test.ts`, `packages/ledge/test/openrig-workspace.test.ts`

**Interfaces :**
- Consumes : `Plans.take` (Task 5), `sendToSeat` (Task 4), `RigCli.up` et `Bridge.annotate` (Task 3), `Bridge.onMessage` (`rig.updated`), `Bridge.rigs()`, `Bridge.ensureRunning('launch')`, `say` (= la `notice` du pont), `execGit`.
- Produces :
  ```ts
  // workspace.ts
  export async function prepareWorkspace(plan: RigPlan, git: Exec): Promise<{ ok: true; created: boolean } | { ok: false; reason: string }>;
  // launch.ts
  export const GOAL_TIMEOUT_MS = 10 * 60_000;
  export interface PendingLaunch { planId: string; machine: string; rigId: string; rigName: string; goal: string; lead: string; startedAt: string; goalSentAt?: string; lateNotice?: boolean }
  export function leadOf(seats: readonly RigSeat[]): RigSeat | undefined;   // nom ou adresse contenant 'lead', sinon le premier siège
  export function goalMessage(goal: string, mandate: string): string;
  export function createLaunches(d: { cli: RigCli; bridge: Pick<Bridge, 'rigs' | 'onMessage' | 'annotate' | 'ensureRunning'>; send: typeof sendToSeat; say(text: string): void; mandate(): string;
    file: string; now(): number; setTimer: typeof setTimeout; clearTimer: typeof clearTimeout }): {
    launch(plan: RigPlan): Promise<{ ok: true; rigId: string } | { ok: false; code: 'openrig_down' | 'failed'; reason: string }>;
    pending(): PendingLaunch[]; resume(): void; cancel(rigId: string): Promise<void>; // cancel : oubli du suivi (le down passe par rig.act)
  };
  ```

Comportement :
- `prepareWorkspace` :
  - `copy` : `git -C <repo> worktree list --porcelain`. Si `cwd` y figure sur `refs/heads/<branch>` → réutilisé (`created: false`). Si `cwd` existe sans être cette copie → `{ ok: false, reason: 'folder exists: <cwd>' }`. Sinon `git -C <repo> worktree add -b <branch> <cwd>`, ou `worktree add <cwd> <branch>` quand la branche existe déjà (`git rev-parse --verify refs/heads/<branch>`). Jamais `--force`.
  - Hors projet : `mkdir -p` du dossier.
  - Projet sans copie : rien.
- `launch(plan)` :
  1. `Plans.take` a déjà refusé un plan pris (`plan already launched`) ou expiré (`plan expired`).
  2. `ensureRunning('launch')`.
  3. `prepareWorkspace`.
  4. `RigCli.up` : `rig up <spec> --cwd <cwd> --yes --json`, sans shell.
  5. On lit `rigId` dans le JSON. Un code ≠ 0 ou un JSON illisible → `failed` avec la fin de `stderr` ; la copie créée reste sur le disque, et le fil le dit.
  6. Enregistrement de `PendingLaunch` dans `rig-launches.json`, et `bridge.annotate(rigId, { launch: {…} })` pour que les clients voient `launch` (contrat Task 1).
- **Remise du but** : à chaque `rig.updated` de ce rig (`Bridge.onMessage`), si chaque siège est `ready | working | idle`, on appelle `send(lead.ref, goalMessage(goal, mandate()))`. Puis :
  - `goalSentAt` est écrit, le fichier enregistré ;
  - le fil dit « J'ai donné le but à {lead}. ».
- **Au bout de `GOAL_TIMEOUT_MS`** depuis `startedAt`, si le but n'est pas parti, il part quand même. Le fil dit « Les sièges de {rig} ne sont pas tous prêts après 10 min : j'ai quand même donné le but à {lead}. {siège} attend encore. », et `lateNotice: true`.
- `resume()` au démarrage du daemon : relit le fichier et réarme le délai restant, sans renvoyer un but déjà parti.
- **Invites de confiance** : un siège `trust` n'est jamais servi ni répondu. Aucun appel `rig send` ne vise un siège en `trust`, et aucun argv ne contient `--dangerously-interact`. Le lead en `trust` au bout de 10 min : le but attend et le fil le dit (« {lead} attend ta confiance dans le dossier : le but partira après. »).
- **Annuler le lancement** = `rig.act { verb: 'down', rigId }` côté client (Task 3). Le suivi s'arrête quand le miroir montre le rig `stopped` ou retiré.
- `mandate()` : le résumé de `mandateSummary` (Task 9).
- `goalMessage` : « But donné par l'utilisateur, via Ledge : {goal}\n\n{mandate} ».

- [ ] **Step 1 : tests qui échouent** (minuteries factices `vi.useFakeTimers()`)
```ts
it('lance rig up une seule fois ; un second rig.launch du même plan → plan already launched', async () => {
  const r1 = await launches.launch(plans.take(id) as RigPlan);
  expect(plans.take(id)).toBe('used');
  expect(calls.filter(c => c.args[0] === 'up')).toHaveLength(1);
});
it('copie : worktree add -b feat/rigs …/.worktrees/rig-factory, sans --force', …);
it('copie déjà sur la branche : réutilisée, aucun worktree add', …);
it('dossier présent qui n’est pas la copie → folder exists, pas de rig up', …);
it('but remis au lead quand les 7 sièges sont prêts, une fois', async () => {
  emitSeats('r1', allReady); await flush();
  expect(calls.filter(c => c.args[0] === 'send')).toEqual([expect.objectContaining({ args: ['send', 'orch-lead@factory', expect.stringContaining('Ledge : But donné'), '--json'] })]);
  emitSeats('r1', allReady); await flush();
  expect(calls.filter(c => c.args[0] === 'send')).toHaveLength(1);
});
it('10 min sans tous les sièges : but remis quand même et l’utilisateur prévenu', …);
it('lead en trust : rien envoyé, « attend ta confiance » dans le fil', …);
it('redémarrage : resume() relit rig-launches.json et n’envoie pas un but déjà parti', …);
it('aucun argv de tout le fichier de test ne contient --dangerously-interact', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @paradow/ledge test openrig-launch openrig-workspace` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter @paradow/ledge test openrig-launch openrig-workspace` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): launch a rig, give the goal to its lead"`

---

### Task 7 : Dépôts trouvés (scan de 30 s, attribution)

**Files :**
- Create : `packages/ledge/src/daemon/openrig/repos.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (démarrage du veilleur), `packages/ledge/src/daemon/scan.ts` (exporter ce qui est réutilisé, sans changer `scanRepos`)
- Test : `packages/ledge/test/openrig-repos.test.ts`

**Interfaces :**
- Consumes : `originUrl`, `SKIP` (`scan.ts`), `headBranch` (`repos.ts`), `execGit`, `Bridge.annotate` (Task 3).
- Produces :
  ```ts
  export const REPO_SCAN_MS = 30_000, REPO_DEPTH = 3;
  export async function findRigRepos(root: string, opts?: { depth?: number; git?: Exec }): Promise<Omit<RigRepo, 'by' | 'how'>[]>;
  export function attributeRepos(repos: readonly Omit<RigRepo, 'by' | 'how'>[], rig: Rig, sessions: readonly Session[], rigStartedAt: number,
    gitBirth: (path: string) => number | null): RigRepo[];
  export function watchRigRepos(d: { bridge: Pick<Bridge, 'rigs' | 'annotate'>; sessions(): Session[]; every?: number; find?: typeof findRigRepos }): () => void;
  ```

Règles :
- Le veilleur ne parcourt que les rigs `offProject` (spec §8.2 : les dépôts trouvés s'affichent pour un rig hors projet). Il parcourt `rig.cwd` jusqu'à 3 niveaux, à la recherche de dossiers contenant `.git`, en sautant `SKIP`.
- Pour chaque dépôt trouvé :
  - `name` = nom du dossier ;
  - `branch` = `headBranch` ;
  - `remote` = `originUrl` de `.git/config` ;
  - `modified` = nombre de lignes de `git status --porcelain`.
- Attribution [P] : le premier siège, par `startedAt` de sa session, dont le `cwd` ou le `repoPath` de la session appariée est dans le dépôt.
  - `how` vaut `created` sans dépôt distant ;
  - `cloned` si le `.git` est né après le lancement du rig ;
  - `opened` sinon.
  - Pas de siège trouvé : `by` et `how` absents.
- `bridge.annotate(rigId, { repos })` seulement si la liste a changé ; une erreur de parcours est notée dans le journal et garde l'ancienne liste.

- [ ] **Step 1 : tests qui échouent** (dossier temporaire avec `git init`)
```ts
it('trouve ledge (modifié, distant) et wsl-notes (sans distant) à ≤ 3 niveaux, ignore node_modules', …);
it('n’entre pas au 4e niveau', …);
it('attribution : ledge cloné par build, openrig lu (opened) par advisor, wsl-notes créé par design', () => {
  expect(attributeRepos(found, RIG, sessions, T0, birth).map(r => [r.name, r.by, r.how]))
    .toEqual([['ledge', 'build', 'cloned'], ['openrig', 'advisor', 'opened'], ['wsl-notes', 'design', 'created']]);
});
it('veilleur : un parcours toutes les 30 s, rigs dans un projet ignorés, patch seulement si changé', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @paradow/ledge test openrig-repos` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter @paradow/ledge test openrig-repos scan` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): find the repositories an off-project rig works in"`

---

### Task 8 : `rig.adopt` (Ranger dans un projet)

**Files :**
- Modify : `packages/ledge/src/daemon/server.ts` (cas `rig.adopt`, et réémission des rigs après `projects.set`), le calcul de `projectId` du miroir (lot 2, `openrig/mirror.ts`, qui lit `opts.projects()`)
- Test : `packages/ledge/test/openrig-adopt.test.ts`

**Interfaces :**
- Produces :
  ```ts
  export function adoptRig(projects: Projects, projectId: string, rigId: string): Projects | { refused: 'unknown project' };
  //   retire rigId de tout autre projet, l'ajoute à projectId ; aucun fichier déplacé
  export function rigProjectId(rig: Pick<Rig, 'id' | 'cwd' | 'machine'>, projects: Projects): string | null;
  //   le projet qui liste rig.id dans `rigs`, sinon celui dont un dépôt contient rig.cwd sur cette machine (règle du lot 2), sinon null
  ```

Comportement : `rig.adopt { rid, machine, rigId, projectId }` → `writeProjects` puis diffusion de `projects`. Le miroir recalcule `projectId` (et donc « dans {projet} » sur la plaque) ; `offProject` reste tel quel. Rien ne bouge sur le disque : le test vérifie que le dossier du rig et son contenu sont identiques avant et après. Réponse `rig.result`.

- [ ] **Step 1 : tests qui échouent**
```ts
it('adoptRig ajoute r1 à ledge et le retire de website', …);
it('rig.adopt : projects.json réécrit, rig.updated avec projectId ledge, offProject gardé', …);
it('rig.adopt : le dossier du rig est intact (même liste, mêmes mtimes)', …);
it('projet inconnu → rig.result failed', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @paradow/ledge test openrig-adopt` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter @paradow/ledge test openrig-adopt projects` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): file a rig in a project without moving anything"`

---

### Task 9 : Contexte Ledge d'un siège au démarrage

**Files :**
- Create : `packages/ledge/src/daemon/openrig/seatContext.ts`
- Modify : `packages/ledge/src/cli/hook.ts` (`runHook`, branche SessionStart)
- Test : `packages/ledge/test/hook-rig-seat.test.ts`

**Interfaces :**
- Consumes : `ALWAYS_USER` (contrat), `paths().mandate` (`mandat.md`, lot 7 ; absent avant lui).
- Produces :
  ```ts
  export function mandateSummary(text: string | null): string;
  //   null → « Ledge tranche seul : git et branches, tests et relectures, contexte et relèves, petits choix de code.
  //            Te reviennent toujours, via Ledge, à l'utilisateur : design, architecture, critique (données, sécurité, suppression, coûts). »
  //   sinon : les deux listes lues sous les titres « Ledge tranche seul » et « Te revient toujours » de mandat.md, mêmes phrases
  export function rigSeatContext(p: { seat: string; rig: string; human: string; mandate: string }): string;
  ```

Texte de `rigSeatContext`, en français, pour le siège :
- « Tu es {seat}, siège du rig {rig}. »
- « Ton humain est Ledge ({human}) : il lit tes escalades et tranche pour l'utilisateur, ou les lui remonte. »
- « Pour une décision qui ne t'appartient pas, escalade vers {human} avec le skill messaging-the-human d'OpenRig (`rig queue create --destination {human} --human-intent decision …`). »
- puis `mandate`.

Le texte ne mentionne ni `ledge task` ni `ledge send`.

Règle d'injection : sur `SessionStart`, si `openrigSeat(agent, env)` (lot 2) trouve un siège et que `LEDGE_SESSION` est absent (un siège, pas une session lancée par Ledge), le hook envoie l'appariement `session.event.openrig` comme au lot 2, puis renvoie `additionalContext` = `rigSeatContext`. Les champs :
- `seat` = `sessionName` rendu par `openrigSeat` ;
- `rig` = la partie après `@` ;
- `human` = l'adresse fixée au lot 0 (`ledge@external` par défaut).

On le fait à chaque `SessionStart` (démarrage, reprise, `/clear`), comme `identityContext`. Le hook reste borné par son délai actuel : la lecture de `mandat.md` est synchrone et locale.

- [ ] **Step 1 : tests qui échouent**
```ts
it('siège OpenRig au SessionStart : additionalContext dit l’humain, l’escalade et le mandat', async () => {
  const out = await runHookWithEnv('SessionStart', START, { OPENRIG_SESSION_NAME: 'dev-build@starter', OPENRIG_NODE_ID: 'n1' });
  const ctx = JSON.parse(out!).hookSpecificOutput.additionalContext as string;
  expect(ctx).toContain('Tu es dev-build@starter, siège du rig starter.');
  expect(ctx).toContain('ledge@external');
  expect(ctx).toMatch(/design, architecture, critique/);
  expect(ctx).not.toMatch(/ledge task|ledge send/);
});
it('session lancée par Ledge (LEDGE_SESSION) : identityContext, pas le contexte de siège', …);
it('mandateSummary lit les deux listes de mandat.md', …);
```
- [ ] **Step 2 :** Run `pnpm --filter @paradow/ledge test hook-rig-seat` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter @paradow/ledge test hook-rig-seat hook` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): tell a rig seat who its human is and how to escalate"`

---

### Task 10 : Modèle de la fenêtre de lancement (fonctions pures)

**Files :**
- Create : `apps/desktop/src/launch/rigModel.ts`
- Test : `apps/desktop/test/rig-launch-model.test.ts`

**Interfaces :**
- Consumes : `RigSpecInfo` (lot 3), `Project`, `MachineState`, `RIG_NAME`, `isPlanRequired` (logique recopiée côté client : `where.kind === 'project' && !where.copy`).
- Produces :
  ```ts
  export interface RigForm { goal: string; spec: string | null; machine: string; place: { kind: 'project'; projectId: string; repo: string | null; branch: string; copy: boolean } | { kind: 'off'; name: string; nameTouched: boolean } }
  export function rigFormDefaults(p: { projects: readonly Project[]; machines: readonly MachineState[]; wanted: { project?: string; spec?: string; goal?: string; machine?: string } }): RigForm;
  export function recommendSpec(goal: string, specs: readonly RigSpecInfo[]): { spec: string; why: 'bounded' | 'long' } | null;
  export function slugOfGoal(goal: string): string;                      // « Prototyper la reprise … WSL » → « reprise-wsl », RIG_NAME garanti, ≤ 40
  export function whereOf(f: RigForm): RigLaunchWhere | null;            // null tant qu'un champ manque
  export function missingOf(f: RigForm): ('goal' | 'spec' | 'repo' | 'branch' | 'name')[];
  export function planRequired(f: RigForm): boolean;
  export function primaryAction(f: RigForm): 'launch' | 'plan';          // 'plan' si planRequired
  export function providers(seats: readonly RigSpecSeat[]): { runtime: string; count: number }[];
  export function launchability(m: MachineState, status: OpenRigStatus | undefined): { ok: true } | { ok: false; why: 'offline' | 'absent' | 'unsupported' | 'unreachable'; install?: string };
  //   ok pour running, stopped, starting (Ledge démarre OpenRig au lancement) ; absent → install du statut (fleet.openrig(), lot 2)
  ```

Règles [P] :
- `recommendSpec` : `factory` si le but fait plus de 160 caractères ou contient un de `jours`, `durée`, `produit`, `livrer`, `plusieurs` (`why: 'long'`) ; sinon `starter` (`why: 'bounded'`). Une spec absente de la liste n'est pas recommandée (le lot 7 pourra préremplir à la place).
- Branche par défaut `feat/<spec>`, copie par défaut cochée.
- `slugOfGoal` : minuscules, sans accents, mots vides retirés (`le la les de des du un une et à au pour sur après avant`), les 2 derniers mots significatifs, joints par `-`.
- Le nom d'espace suit `slugOfGoal` tant que `nameTouched` est faux.

- [ ] **Step 1 : tests qui échouent**
```ts
it('slugOfGoal : « Prototyper la reprise des rigs après un reboot de WSL » → « reboot-wsl »', …);
it('recommandation : but court → starter (bounded) ; « produit dans la durée » → factory (long)', …);
it('vrai dépôt (copie décochée) → plan imposé, action principale « plan »', () =>
  expect(primaryAction({ ...F, place: { ...P, copy: false } })).toBe('plan'));
it('hors projet → plan facultatif ; nom invalide → missing « name »', …);
it('providers : 5 claude-code, 2 codex', …);
it('machine distante sans OpenRig : launchability → absent, avec la commande install du statut', …);
```
- [ ] **Step 2 :** Run `pnpm --filter desktop test rig-launch-model` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter desktop test rig-launch-model` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): rig launch model"`

---

### Task 11 : Fenêtre « Nouveau rig » en trois temps

**Files :**
- Replace : `apps/desktop/src/launch/RigLaunch.tsx` (l'attente du lot 3)
- Create : `apps/desktop/src/launch/RigLaunchForm.tsx`, `apps/desktop/src/launch/RigPlanView.tsx`, `apps/desktop/src/launch/useRigLaunch.ts`
- Modify : `apps/desktop/e2e/daemon.ts` (`rig.prepare` → `rig.plan` depuis `extras.plans` ou un plan calculé ; `rig.launch` → `rig.result ok` puis `pushRig` d'un rig `launching`), i18n, styles
- Test : `apps/desktop/test/rig-launch.test.tsx`, `apps/desktop/e2e/rig-launch.spec.ts`

**Interfaces :**
- Consumes : Task 10, `useRigSpecs` (lot 3), `useOpenRig` (lot 2), `client.fleet.sendTo(machine, msg)`.
- Produces :
  ```ts
  export function useRigLaunch(client: DaemonClient): {
    state: { step: 'form' } | { step: 'preparing' } | { step: 'plan'; plan: RigPlan } | { step: 'launching'; plan: RigPlan } | { step: 'error'; reason: string; back: 'form' | 'plan' };
    prepare(machine: string, spec: string, goal: string, where: RigLaunchWhere): void;   // rid → rig.plan / rig.result
    launch(plan: RigPlan): void;                                                          // rid → rig.result
    back(): void;
  };
  export function RigLaunch(p: { client: DaemonClient; projects: readonly Project[]; machines: readonly MachineState[]; wanted: Extract<Modal, { kind: 'rig-launch' }>;
    dispatch(a: NavAction): void; onClose(): void }): JSX.Element;
  ```

Comportement (maquettes `l-1`, `l-2`, `w-1`) :
1. **Nouveau rig** :
   - champ « But donné au lead » (zone de texte, focus), puis trois suggestions sous le champ ;
   - « Spec OpenRig » repliée avec « Recommandé par Ledge » et « Changer ». « Changer » déplie « Choisir pour ce rig » : cartes des specs (nom, « n sièges · {résumé} »), « Depuis le registre… » désactivé avec l'info-bulle « Bientôt », et la ligne « Ledge recommande {spec} : … » ;
   - « Fournisseurs », avec les comptes de `providers` ;
   - le bloc lieu : « Projet » (puces) et « + Nouvel espace, hors projet » ; « Machine » (puces de `machines` ; une machine dont `launchability` refuse est désactivée, avec la raison « OpenRig n'est pas installé sur {m} » et la commande `install` à copier, « OpenRig {v} non pris en charge » ou « hors ligne ») ; « Dossiers et dépôts sur {machine} » (un dépôt) ; « nouvelle branche » (champ, défaut `feat/<spec>`) ; ou, hors projet, « Espace de travail » `~/.ledge/rigs/<nom>` éditable et l'aide « Ledge le crée vide… ».
   - Pied : « {spec} ouvrira sa pièce » / « hors projet », puis « 1 table · n sièges · dans {projet} · {machine} », « Annuler », « Voir le plan » et « Lancer le rig » (Ctrl ↵). Quand `primaryAction === 'plan'`, « Lancer le rig » n'existe pas à cette étape et « Voir le plan » est le bouton principal (spec §4.6). Un champ manquant est nommé sous le pied et rien ne part.
2. **Plan du rig {spec}** :
   - « Ce qui démarre · n sièges », une ligne par siège : adresse, outil, modèle, autonomie ;
   - « Ce qui change dans {cwd} », qui liste `writes`, avec la puce « Travailler dans une copie : .worktrees/rig-{spec} ». La puce bascule `copy`, ce qui relance `prepare` ;
   - « Après le lancement » : « Je donne le but à {lead} dès que les n sièges sont prêts. Je tranche Git, tests et relèves ; je te remonte le design, l'architecture et le critique. » ;
   - pied : « n sièges · k fournisseurs », la `command`, « Retour », « Lancer le rig ».
3. **Démarrage** : sur `rig.result ok`, la fenêtre se ferme et Desktop ouvre `dispatch({ type: 'ledge', tab: 'rigs', rigs: 'live' })`, où la carte du rig en `launching` est montrée (Task 12). Un refus reste dans la fenêtre, à l'étape où il est arrivé, avec sa raison.

- [ ] **Step 1 : tests qui échouent**
```ts
it('projet + copie : « Lancer le rig » à l’étape 1 envoie rig.prepare puis rig.launch', …);
it('copie décochée : pas de « Lancer le rig » à l’étape 1, « Voir le plan » principal ; « Lancer » à l’étape 2', …);
it('hors projet : le nom suit le but, puis reste quand on l’a modifié', …);
it('nom « ../x » : « Nom invalide » sous le champ, rien envoyé', …);
it('machine distante sans OpenRig : puce désactivée avec la raison', …);
it('refus « plan already launched » : dit dans la fenêtre, à l’étape du plan', …);
```
E2E `rig-launch.spec.ts` :
```ts
test('launch a rig in three steps, then see it starting', async ({ page }) => {
  const daemon = await fakeDaemon(page, [], { projects: twoProjects, specs: [STARTER, FACTORY], openrig: RUNNING, rigs: [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Launch a rig' }).click();
  await page.getByLabel('Goal given to the lead').fill('Resume rigs after a WSL reboot');
  await page.getByRole('button', { name: 'Change' }).click(); await page.getByRole('button', { name: /^factory/ }).click();
  await page.getByRole('button', { name: 'Work in a copy' }).click(); // décochée : plan imposé
  await expect(page.getByRole('button', { name: /^Launch the rig/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'See the plan' }).click();
  await expect(page.getByRole('heading', { name: 'factory rig plan' })).toBeVisible();
  await page.getByRole('button', { name: /^Launch the rig/ }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'rig.launch')).toHaveLength(1);
  await expect(page.getByRole('tab', { name: /^Live/, selected: true })).toBeVisible();
});
test('off-project launch: workspace named after the goal', …);
```
- [ ] **Step 2 :** Run `pnpm --filter desktop test rig-launch` puis `pnpm --filter desktop e2e rig-launch` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run les mêmes commandes · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): launch a rig in three steps"`

---

### Task 12 : Actions de Rigs › En cours, « Arrêter… », lancement en cours, menu des sièges

**Files :**
- Create : `apps/desktop/src/rigs/useRigActions.ts`, `apps/desktop/src/rigs/StopRig.tsx`, `apps/desktop/src/rigs/LaunchNote.tsx`
- Modify : `apps/desktop/src/rigs/RigsLive.tsx` (actions de `RigCard`), `apps/desktop/src/atelier/RigRoom.tsx` (`extraActions`), `apps/desktop/src/shell/TopBar.tsx` (barre d'une pièce de rig isolée, maquette `w-3`), le menu de session (`apps/desktop/src/manage/useSessionMenu.ts` et son rendu) pour une session appariée, `apps/desktop/e2e/daemon.ts` (`rig.act` → `rig.result`), i18n
- Test : `apps/desktop/test/rig-actions.test.tsx`, `apps/desktop/e2e/rig-actions.spec.ts`

**Interfaces :**
- Consumes : `RigCard` et `RigRoom` (lot 3), `openSeatTerminal` (lot 3), `rig.result`.
- Produces :
  ```ts
  export function useRigActions(client: DaemonClient, notify: (text: string) => void): {
    act(machine: string, verb: RigVerb, target: { rigId?: string; seatRef?: string }): Promise<RigResult>;
    adopt(machine: string, rigId: string, projectId: string): Promise<RigResult>;
    pending: ReadonlySet<string>; // rid en vol : boutons « … » désactivés
  };
  export function StopRig(p: { rig: Rig; seat?: RigSeat; onStopRig(): void; onStopSeat(): void; onCancel(): void }): JSX.Element;
  ```

Comportement :
- **Carte d'un rig en marche** : « Table », « Terminaux » (lot 3) et « Arrêter… ». Chaque siège a un menu « … » avec « Relancer ce siège » (`restart`), « Relève » (`handover`) et « Arrêter… ».
- **« Arrêter… »** ouvre `StopRig` (`role="alertdialog"`) :
  - titre « Arrêter {rig} ? » ;
  - corps « Ses {n} sièges s'arrêtent. OpenRig garde un instantané pour le reprendre. Les fichiers restent. » ;
  - boutons « Arrêter le rig » (`down`), « Seulement ce siège » (`stop`, présent seulement depuis un siège) et « Annuler » (focus).
- **Rig arrêté** (`lifecycle === 'stopped'`) : « Reprendre » (`up`), et dans « … », « Reprendre depuis le dernier instantané » (`restore`).
- **Lancement en cours** (`rig.launch` présent et sans `goalSentAt`) :
  - en-tête « rig · démarre · … » et « {r}/{n} prêts » ;
  - « Annuler le lancement » (`down` direct, sans confirmation [P] : rien n'a encore travaillé) ;
  - pour un siège `trust`, « attend ta confiance dans le dossier » et « Ouvrir l'invite », qui ouvre le terminal du siège (`openSeatTerminal`). Ledge n'y tape rien ;
  - `LaunchNote` en pied : « Le but attend : je le donne à {lead} dès que les {n} sièges sont prêts. », plus, s'il y a des sièges `trust`, « {siège} attend ta confiance dans le dossier, je ne réponds pas à sa place. ».
- **Menu d'une session appariée** (barre latérale, Atelier, page de session) : « Terminer », « Archiver » et « Supprimer » sont remplacés par « Relancer ce siège », « Relève » et « Arrêter… » (même `StopRig`, depuis le siège).
- **Pièce de rig isolée** (filtre `rig:…`) : la barre du haut porte « Fil du rig », « Dépôts · n » (hors projet), « Ranger dans un projet… » (hors projet) et « Arrêter le rig… ». Le menu « … » de la plaque (`extraActions`) reprend « Arrêter… » et « Ranger… ».
- **Résultats** : un refus `rig.result` s'affiche en toast avec sa raison. `openrig_down` → « OpenRig ne répond pas sur {machine} ».

- [ ] **Step 1 : tests qui échouent**
```ts
it('« Arrêter… » puis « Arrêter le rig » → rig.act down r1', …);
it('depuis un siège : « Seulement ce siège » → rig.act stop dev-build@factory', …);
it('« Annuler » n’envoie rien et rend le focus', …);
it('lancement : « 4/7 prêts », « Annuler le lancement » → down, « Ouvrir l’invite » ouvre le terminal de design sans rien envoyer', …);
it('menu d’un siège : ni Terminer ni Supprimer, mais Relancer ce siège', …);
it('refus rig.result failed → toast avec la raison', …);
```
E2E `rig-actions.spec.ts` : un rig `launching` avec un siège `trust` → note et « Open the prompt » ; « Cancel the launch » → `rig.act { verb: 'down' }` reçu ; puis un rig en marche → « Stop… » › « Only this seat » depuis un siège → `rig.act { verb: 'stop', seatRef }` ; aucun `session.kill` reçu pendant tout le test.
- [ ] **Step 2 :** Run `pnpm --filter desktop test rig-actions` puis `pnpm --filter desktop e2e rig-actions` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run les mêmes commandes, plus `pnpm --filter desktop e2e manage` (le menu des sessions seules ne change pas) · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): stop, resume, restart and hand over rigs and seats"`

---

### Task 13 : Dépôts trouvés, « Ranger dans un projet… » et proposition de Ledge

**Files :**
- Create : `apps/desktop/src/rigs/RigRepos.tsx`, `apps/desktop/src/rigs/AdoptRig.tsx`, `apps/desktop/src/rigs/proposal.ts`
- Modify : `apps/desktop/src/rigs/RigsLive.tsx` (`footer` de `RigCard`), `apps/desktop/src/atelier/RigRoom.tsx` (plaque : « n dépôts · noms »), `apps/desktop/e2e/daemon.ts` (`rig.adopt` → `projects` mis à jour puis `rig.updated` avec `projectId`), i18n
- Test : `apps/desktop/test/rig-repos.test.tsx`, `apps/desktop/e2e/rig-adopt.spec.ts`

**Interfaces :**
- Consumes : `Rig.repos` (Task 7), `useRigActions.adopt` (Task 12), `Projects`.
- Produces :
  ```ts
  export function proposeProject(rig: Rig, projects: Projects): { projectId: string; why: 'only-modified' | 'name' } | null;
  export function RigRepos(p: { rig: Rig; projects: Projects; onAdopt(projectId: string): void; onChoose(): void }): JSX.Element;
  export function AdoptRig(p: { rig: Rig; projects: Projects; proposed: string | null; onAdopt(projectId: string): void; onCancel(): void }): JSX.Element;
  ```

Règles [P] de `proposeProject` :
- Un seul dépôt trouvé avec `modified > 0`, dont le nom est celui du dossier d'un dépôt d'un projet (comparaison de `basename`) → ce projet, `why: 'only-modified'`.
- Sinon, un seul projet dont un dépôt porte le nom d'un dépôt trouvé → `why: 'name'`.
- Sinon `null`.

Comportement (maquette `w-2-encours.png`) : sous la carte d'un rig hors projet, le bloc « Dépôts trouvés · n », « ce que le rig a cloné ou ouvert », et « Ranger dans un projet… ». Une puce par dépôt : « {nom} ⎇ {branche} · cloné par {siège} · {m} fichiers modifiés », « lu par {siège} », « créé par {siège} · pas encore de dépôt distant ». Si une proposition existe, la ligne de Ledge suit : « Je propose de ranger {rig} dans {projet} : c'est le seul dépôt modifié. Je ne déplace rien sans toi. » (ou « … : un de ses dépôts porte ce nom. »), avec « Ranger dans {projet} ».
- « Ranger dans un projet… » ouvre `AdoptRig` : liste des projets, celui proposé présélectionné, puis le texte « Le rig garde sa pièce et ses fichiers ; sa plaque dira « dans {projet} ». », et les boutons « Ranger » et « Annuler ».
- Après `rig.result ok`, la plaque et la carte disent « dans {projet} » ; la ligne de proposition disparaît.
- Rig hors projet sans dépôt : « Aucun dépôt trouvé pour l'instant. Je regarde toutes les 30 s. »

- [ ] **Step 1 : tests qui échouent**
```ts
it('proposeProject : seul ledge est modifié → Ledge (only-modified)', …);
it('deux dépôts modifiés → aucune proposition, « Ranger dans un projet… » reste', …);
it('puces : « cloné par build · 9 fichiers modifiés », « lu par advisor », « créé par design · pas encore de dépôt distant »', …);
it('« Ranger dans Ledge » → rig.adopt { rigId: r1, projectId: ledge }', …);
```
E2E `rig-adopt.spec.ts` : rig `factory` hors projet avec trois dépôts → la proposition s'affiche ; « File in Ledge » → `rig.adopt` reçu, puis la carte et la barre latérale montrent « in Ledge » à la place de « off project ».
- [ ] **Step 2 :** Run `pnpm --filter desktop test rig-repos` puis `pnpm --filter desktop e2e rig-adopt` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run les mêmes commandes, puis à la racine `pnpm test && pnpm typecheck` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): found repositories and filing a rig in a project"`

---

## Changements de contrat et de plan maître à signaler

1. **`RigSchema.launch?: RigLaunchInfo`** (`planId`, `goal`, `lead`, `startedAt`, `goalSentAt?`, `lateNotice?`) : les clients montrent « Le but attend… » et « Annuler le lancement » (Task 1, 6).
2. **`RefusalCodeSchema` gagne `rig_managed`.** Le plan maître met `rig_managed` dans `rig.result.code` ; or le refus de `session.kill/archive/delete/model` passe par le message `error` existant, qui porte un `RefusalCode`.
3. **`ProjectSchema.rigs: string[]`** (défaut `[]`) et le problème `duplicate_rig`. Le plan maître dit `rigs: [rigId]` sans le placer dans le schéma.
4. **`RIG_NAME`**, exporté par le contrat, pour que le client et le daemon valident le nom d'espace de la même façon.
5. **`restore`** : la route réelle est `POST /api/rigs/:rigId/restore/:snapshotId`, et non `/api/rigs/:rigId/restore` (spec §4.5). Ledge prend le dernier instantané (`GET /api/rigs/:rigId/snapshots`). Le corps de `POST /api/down` est `{ rigId, snapshot: true }`. Les routes de siège exigent `reason` et acceptent `operator`.
6. **Ajouts aux modules du lot 2** (Task 3) : `OpenRigHttp.call`, `RigExec` avec `env`, `RigCli.up` et `RigCli.send`, `Bridge.annotate` (champs Ledge `launch` et `repos` gardés à travers les relectures), et dans le faux `body`, `snapshots`, `reply` et un `fakeRigCli` scriptable. Le fil passe par `BridgeDeps.notice` : pas de dépendance dure au lot 4 ; `sendToSeat` est rendu au lot 4 pour `@siège`.
7. Nouveaux chemins sous `paths()` : `rigs` (déjà dans les Global Constraints) et **`rig-launches.json`** (à ajouter à la liste de persistance).
8. Le lot 0 doit fixer l'adresse de l'humain utilisée pour `operator` et pour `OPENRIG_SESSION_NAME` de `rig send`. `ledge@external` est la valeur par défaut, et le repli est `human-ledge@host`.

## Non couvert ici

- Exécution réelle sur une machine distante (relais des ordres, agrégation) : lot 6. Ce lot envoie à la machine choisie et désactive celles qui n'ont pas OpenRig.
- « + Préparer un dépôt (facultatif) » (maquette `w-1`) et « Depuis le registre… » : non construits. Le bouton du registre est désactivé (« Bientôt »).
- L'adaptation d'une spec aux fournisseurs (« Ledge en adapte une copie ») : non construite. On n'affiche que les comptes par outil.
- Le préremplissage de la fenêtre par le cerveau (« Lance un rig pour … ») : lot 7. La modale accepte déjà `goal` et `spec`.
