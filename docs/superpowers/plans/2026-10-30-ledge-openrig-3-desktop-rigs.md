# Lot 3 : Desktop, barre latérale, Atelier et onglet Rigs — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** montrer les rigs OpenRig dans Desktop : Ledge en ligne de messagerie en tête de la barre latérale, Projets réduits aux sessions seules, section Rigs avec ses sièges et le noyau, Atelier « une pièce = une table » pour projets, rigs et noyau, et l'onglet Rigs de l'écran Ledge en lecture (En cours · Specs · Agents).

**Architecture :**
- Tout part du miroir du lot 2 dans `@ledge/fleet` (rigs, escalades, échanges par machine). Desktop n'ajoute que des fonctions pures (`apps/desktop/src/rigs/model.ts`, `shell/sidebar/model.ts`, `atelier/layout.ts`) et des composants qui les affichent.
- Un seul ajout au daemon : la liste des specs (`rig.specs`), lue dans la bibliothèque d'OpenRig par le pont. Le lot 2 ne la fournit pas.
- Ce lot n'agit sur rien : les boutons qui agissent (Arrêter…, Annuler le lancement, Ranger) arrivent au lot 5. Le « + » de la section Rigs ouvre une fenêtre d'attente que le lot 5 remplace.

**Tech Stack :** TypeScript, React 19, zod, vitest (+ Testing Library), playwright (faux daemon `apps/desktop/e2e/daemon.ts`), paquet `yaml` 2.x (nouveau, `packages/ledge`).

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` (§4.3, §8.1, §8.2 Rigs, §8.3). Plan maître : `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md` (contrat de protocole et Global Constraints, qui font foi). Maquettes : `docs/mockups/ledge-openrig/shots/` (`s1a.png`, `c-A.png`, `new-home.png`, `new-atelier-factory.png`, `w-3-piece.png`, `p-rigs-live.png`, `p-rigs-spec.png`).

## Global Constraints

Celles du plan maître s'appliquent toutes. En particulier :
- OpenRig n'est lu que par `http://127.0.0.1:7433` et le binaire `rig`, jamais par `~/.openrig/openrig.sqlite`.
- Textes en français d'abord (`apps/desktop/src/i18n/fr.ts`), anglais à côté (`en.ts`), libellés des maquettes mot pour mot : « Ledge. », « Rigs », « Noyau OpenRig », « noyau », « hors projet », « dans <projet> », « sur <machine> », « rig · n », « n/m au travail », « Table », « Terminaux », « En cours », « Specs », « Agents », « Lancer ce rig… », « Bibliothèque », « Registre », « au repos », « Santé ».
- Onglet Rigs : sous-onglets `En cours · Specs · Agents` (spec §8.2).
- Commits : `feat(desktop): …`, `feat(ledge): …`, `feat(protocol): …`, `feat(fleet): …`, un par tâche, suivis de `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests : `pnpm --filter desktop test`, `pnpm --filter desktop e2e`, `pnpm --filter @paradow/ledge test`, `pnpm test && pnpm typecheck` verts en fin de lot. Aucun test ne démarre un vrai OpenRig : faux de `packages/ledge/test/fakes/openrig.ts`.

## Hypothèses sur les lots 1, 2 et 4

Ce plan part de `origin/main` après les lots 1 et 2. Si un nom diffère dans leur code, on suit leur code et on ne renomme rien ici.

- **Lot 1** : plus de `Team`, `Task`, `Role`, `TeamsApi`, `useTeamsApi`, `RoleChooser`, `TeamLaunch`, ligne d'équipe ni table d'équipe. `sceneOf` n'a plus de paramètre `teams`, `AtelierTable.kind` vaut `'common'` seul, `ProjectGroup.teams` n'existe plus, `Session.role/team` non plus.
- **Lot 2** (plan `2026-10-30-ledge-openrig-2-pont-lecture.md`, consommé tel quel) :
  - `@ledge/protocol` exporte `Rig`, `RigSeat`, `RigRepo`, `Escalation`, `Exchange`, `OpenRigStatus` (état `absent | stopped | starting | running | unsupported | error | unreachable`, `install?`), `SessionRigSchema` ; `Session.rig?: SessionRig` (`{ machine, rigId, rigName, seat, pod, member }`), machine réécrite par la flotte ; `seat.sessionId` qualifié par sa machine.
  - `@ledge/fleet` : `useRigs(client): Rig[]` (toutes machines, noyau compris, `kernel: true`), `useEscalations(client): Escalation[]`, `useOpenRig(client): OpenRigStatus[]` (un par machine) ; `Fleet.exchanges(machine, rigId): Exchange[] | null` et `Fleet.requestExchanges(machine, rigId): boolean` (les échanges se demandent par rig, `EXCHANGES_MAX` = 200).
  - Daemon : `OpenRigHttp` (`packages/ledge/src/daemon/openrig/http.ts`, méthodes nommées `health`, `ps`, `nodes`, `kernel`, `queue`, `outbox`) ; le pont `Bridge` (`status()`, `ensureRunning`) ; le faux `createFakeOpenRig(opts)` (vrai port local, `requests`) de `packages/ledge/test/fakes/openrig.ts`.
- **Lot 4** (en parallèle) possède l'écran Ledge : `HomeTab = 'conversation' | 'rigs' | 'mandat'`, la coquille d'onglets et le contenu d'« À toi ». Il rend `<RigsTab …/>` (Task 8) quand `tab === 'rigs'`. Si le lot 4 n'est pas fusionné quand ce lot l'est, la Task 8 branche `RigsTab` dans `chat/LedgeHome.tsx` en ajoutant `'rigs'` à `HomeTab`, et le lot 4 reprend ce branchement.

## Review Focus

1. **Un siège sans session appariée** (le rig démarre, l'invite de confiance bloque le hook, ou la session appariée a disparu). Attendu : le siège est dessiné (barre latérale, table, carte), avec son état, sans lien vers une page de session morte et sans erreur console. Test : Task 3 (`seatSession`) et Task 7 (siège fantôme non cliquable).
2. **Une session marquée `rig` dont le rig n'est pas (encore) dans le miroir** (miroir en retard, machine coupée). Attendu : elle reste dans Projets tant que son rig est inconnu, elle ne disparaît jamais des deux listes. Test : Task 4 (`isStandalone`).
3. **Deux machines avec un rig du même nom ou du même id.** Attendu : clés, filtres d'Atelier et lignes de la barre latérale qualifiés par la machine, aucune collision React, la plaque dit « sur <machine> ». Test : Task 3 (`rigKey`, `rigFilter`).
4. **Le rig ouvert dans l'Atelier disparaît** (`rig.removed`) pendant qu'on regarde sa pièce. Attendu : l'Atelier revient à « tout », sans écran vide ni erreur. Test : Task 6 (`reconcile`).
5. **OpenRig absent, arrêté ou non pris en charge.** Attendu : la section Rigs reste visible avec une invitation, l'onglet Rigs dit l'état (« OpenRig 0.7 non pris en charge »), Projets et l'Atelier marchent comme avant. Test : Task 5 et Task 8.

---

### Task 1 : Contrat et daemon `rig.specs` (liste des specs)

**Files :**
- Modify : `packages/protocol/src/openrig.ts` (schémas de spec), `packages/protocol/src/messages.ts` (deux messages)
- Create : `packages/ledge/src/daemon/openrig/specs.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (cas `rig.specs.request`), `packages/ledge/package.json` (dépendance `yaml` ^2)
- Modify : `packages/ledge/test/fakes/openrig.ts` (option `specs`)
- Test : `packages/ledge/test/openrig-specs.test.ts`, `packages/protocol/test/openrig.test.ts` (ou le fichier de test du contrat créé au lot 2)

**Interfaces :**
- Consumes : `OpenRigHttp` et `Bridge.status()` (lot 2) ; `GET /api/specs/library?kind=rig` (tableau d'entrées `{ id, kind, name, sourceType: 'builtin'|'user_file', sourcePath, … }`) et `GET /api/specs/library/:id` (`{ entry, yaml }`), vérifiés dans `@openrig/cli` 0.6.14 (`daemon/dist/routes/spec-library.js`).
- Produces :
  ```ts
  export const RigSpecSeatSchema = z.object({ address: z.string(), member: z.string(), pod: z.string(), runtime: z.string(),
    model: z.string().optional(), effort: z.string().optional(), profile: z.string().optional() });
  export const RigSpecInfoSchema = z.object({ id: z.string(), name: z.string(), summary: z.string().optional(),
    source: z.enum(['builtin', 'library', 'registry']), path: z.string().optional(), seats: z.array(RigSpecSeatSchema) });
  // client : { type: 'rig.specs.request', requestId: string, machineId?: string }
  // serveur : { type: 'rig.specs', requestId: string, machine: string, specs: RigSpecInfo[], error?: 'openrig_down' | 'unsupported' | 'failed' }
  // http.ts (lot 2) gagne deux méthodes :
  specs(): Promise<SpecEntry[]>;                       // GET /api/specs/library?kind=rig
  spec(id: string): Promise<{ entry: SpecEntry; yaml: string }>; // GET /api/specs/library/:id
  export async function listSpecs(http: OpenRigHttp): Promise<RigSpecInfo[]>;   // specs.ts
  export function specSeats(yaml: string): RigSpecSeat[];                         // specs.ts, réutilisé au lot 5
  ```

- [ ] **Step 1 : tests qui échouent**

`packages/ledge/test/openrig-specs.test.ts` :
```ts
it('specSeats lit les membres de chaque pod, adresse @member', () => {
  const seats = specSeats(STARTER_YAML); // copie de daemon/specs/rigs/launch/starter/rig.yaml (0.6.14) en fixture
  expect(seats).toEqual([
    { address: '@build', member: 'build', pod: 'dev', runtime: 'claude-code', profile: 'default' },
    { address: '@review', member: 'review', pod: 'dev', runtime: 'codex', model: 'gpt-6-astra', profile: 'default' }]);
});
it('specSeats refuse un YAML illisible par une liste vide, sans jeter', () => { expect(specSeats(':\n- [')).toEqual([]); });
it('listSpecs : builtin → source builtin, user_file → library, sièges lus du yaml', async () => {
  const rig = await createFakeOpenRig(); rig.specs = [{ id: 'b:starter', name: 'starter', sourceType: 'builtin', yaml: STARTER_YAML },
                                    { id: 'u:mine', name: 'mine', sourceType: 'user_file', yaml: MINE_YAML }];
  const specs = await listSpecs(createOpenRigHttp({ base: rig.url }));
  expect(specs.map(s => [s.name, s.source, s.seats.length])).toEqual([['starter', 'builtin', 2], ['mine', 'library', 1]]);
  expect(rig.requests.map(r => r.path)).toContain('/api/specs/library?kind=rig');
});
it('server : rig.specs.request répond rig.specs avec le requestId, error openrig_down quand OpenRig est arrêté', …);
```
Test du contrat : `RigSpecInfoSchema.parse` accepte `{ id, name, source: 'registry', seats: [] }` et refuse `source: 'other'`.

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @paradow/ledge test openrig-specs` · Expected : FAIL, `specSeats` introuvable.

- [ ] **Step 3 : implémenter**

- Schémas et messages dans le contrat ; `ClientMessageSchema`/`ServerMessageSchema` les incluent.
- `specSeats(yaml)` : `parse` du paquet `yaml`, puis `pods[].members[]` → `{ address: '@' + id, member: id, pod: pod.id, runtime, model?, effort?, profile? }` ; toute erreur → `[]`.
- `listSpecs` : une requête de liste, puis `GET /api/specs/library/:id` par entrée (en parallèle, 8 au plus). Une entrée qui échoue garde `seats: []`. `sourceType` `builtin` → `builtin`, sinon `library`. Le registre (`registry`) n'est pas interrogé dans ce lot (pas de réseau) : le schéma le prévoit, la liste ne le contient pas.
- `server.ts` : `rig.specs.request` → `listSpecs` si `bridge.status().state === 'running'` ; sinon `error: 'openrig_down'` (`unsupported` pour une version refusée). Le routage par `machineId` suit `models.list`.
- Faux OpenRig : champ `specs: { id, name, sourceType, yaml }[]` (vide par défaut) sur `FakeOpenRig`, qui sert les deux routes.

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm --filter @paradow/ledge test openrig-specs && pnpm --filter @ledge/protocol test` · Expected : PASS.

- [ ] **Step 5 : commit**

`git commit -m "feat(ledge): list OpenRig specs for the Rigs tab"` (protocole, daemon, faux, tests, `pnpm-lock.yaml`).

---

### Task 2 : `@ledge/fleet`, specs par machine et terminal d'un siège

**Files :**
- Create : `packages/fleet/src/specs.ts`
- Modify : `packages/fleet/src/machines.ts` (`seatTerminalCommand`), `packages/fleet/src/fleet.ts` (`seatTerminal`), `packages/fleet/src/index.ts`
- Test : `packages/fleet/test/specs.test.ts`, `packages/fleet/test/machines.test.ts`

**Interfaces :**
- Consumes : `rig.specs.request` / `rig.specs` (Task 1).
- Produces :
  ```ts
  export interface RigSpecsState { status: 'idle' | 'loading' | 'ready'; specs: readonly RigSpecInfo[]; error?: string }
  export function useRigSpecs(client: DaemonClient, machine: string | null): RigSpecsState;
  export function seatTerminalCommand(machine: MachineState, tmux: string): string[] | null;
  // Fleet : seatTerminal(machine: string, ref: string): string[] | null
  ```

- [ ] **Step 1 : tests qui échouent**

```ts
it('seatTerminalCommand local : tmux attach-session -t <ref>', () =>
  expect(seatTerminalCommand(LOCAL, 'dev-build@starter')).toEqual(['tmux', 'attach-session', '-t', 'dev-build@starter']));
it('seatTerminalCommand distant : enveloppé dans ssh -t, ref citée', () =>
  expect(seatTerminalCommand({ ...EC2, ssh: 'ec2-build' }, 'dev-build@starter')).toEqual(['ssh', '-t', '--', 'ec2-build', "tmux attach-session -t 'dev-build@starter'"]));
it('useRigSpecs : une requête par machine, réponse gardée, erreur non gardée (redemandée)', …);
```

- [ ] **Step 2 :** Run `pnpm --filter @ledge/fleet test` · Expected : FAIL.
- [ ] **Step 3 :** implémenter sur le modèle de `useModels` (`models.ts`) et de `terminalCommand` (même `quote`, même garde `wslArg`).
- [ ] **Step 4 :** Run `pnpm --filter @ledge/fleet test` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(fleet): rig specs per machine and a seat's terminal command"`

---

### Task 3 : Modèle des rigs (fonctions pures)

**Files :**
- Create : `apps/desktop/src/rigs/model.ts`
- Test : `apps/desktop/test/rigs-model.test.ts`

**Interfaces :**
- Consumes : `Rig`, `RigSeat`, `Session`, `Projects`, `PROJECT_COLORS` (`@ledge/protocol`).
- Produces :
  ```ts
  export const rigKey: (r: Pick<Rig, 'machine' | 'id'>) => string;            // `${machine}/${id}`
  export const rigFilter: (r: Pick<Rig, 'machine' | 'id'>) => string;         // `rig:${machine}/${id}` (filtre de l'Atelier)
  export const kernelFilter: (machine: string) => string;                    // `kernel:${machine}`
  export function parseRigFilter(f: string): { kind: 'rig'; machine: string; rigId: string } | { kind: 'kernel'; machine: string } | null;
  export function rigColor(r: Pick<Rig, 'name'>): ProjectColor;             // hachage stable du nom dans PROJECT_COLORS
  export const SEAT_PLACEHOLDER = 'seat:';
  export function seatSession(seat: RigSeat, rig: Rig, byId: ReadonlyMap<string, Session>): Session; // appariée, sinon fantôme
  export const isSeatPlaceholder: (id: string) => boolean;
  export function kernelSplit(rig: Rig): { shown: RigSeat[]; hidden: RigSeat[] }; // hidden : advisor et terminal humain
  export function workingCount(rig: Rig): number;   // sièges 'working'
  export function readyCount(rig: Rig): number;     // 'ready' | 'working' | 'idle'
  export type RigPlace = { kind: 'project'; name: string } | { kind: 'off'; cwd: string } | { kind: 'none' };
  export function rigPlace(rig: Rig, projects: Projects | null): RigPlace;
  export const SEAT_ORDER: readonly SeatState[]; // working, trust, starting, ready, idle, crashed, unreachable, stopped
  export function allSeats(rigs: readonly Rig[]): { rig: Rig; seat: RigSeat }[]; // hors noyau, triés par SEAT_ORDER puis nom
  export function seatAt(rigs: readonly Rig[], machine: string, rigId: string, who: string): RigSeat | undefined; // ref, adresse ou nom
  ```

Règles fixées ici :
- **Siège fantôme** (`seatSession` sans session appariée) : `id = 'seat:' + rigKey(rig) + '/' + seat.ref`, `name = seat.name`, `tool` déduit du runtime (`claude-code` → `claude`, `codex` → `codex`, sinon `claude`), `source: 'hook_only'`, `cwd = rig.cwd`, `state` : `working` → `working`, `trust`/`starting` → `starting`, `ready`/`idle` → `idle`, `crashed` → `error`, `stopped` → `exited`, `unreachable` → `offline: true`.
- **Noyau** : `hidden` = sièges dont `name` commence par `advisor` ou dont `runtime === 'terminal'` (spec §8.1 : « +2 », « +1 » sans le terminal humain).
- **Couleur** : somme des codes de caractères du nom modulo le nombre de couleurs ; même nom, même couleur sur toutes les machines.

- [ ] **Step 1 : tests qui échouent** (extraits)
```ts
it('rigKey et rigFilter qualifient par machine : deux « factory » ne se confondent pas', () => {
  expect(rigKey({ machine: 'local', id: 'r1' })).not.toBe(rigKey({ machine: 'ec2-build', id: 'r1' }));
  expect(parseRigFilter(rigFilter({ machine: 'ec2-build', id: 'r1' }))).toEqual({ kind: 'rig', machine: 'ec2-build', rigId: 'r1' });
  expect(parseRigFilter('ledge')).toBeNull();
});
it('seatSession : la session appariée quand elle existe, sinon un fantôme seat:… non lancé par Ledge', () => {
  const s = seatSession({ ...SEAT, sessionId: undefined, state: 'trust' }, RIG, new Map());
  expect(isSeatPlaceholder(s.id)).toBe(true);
  expect(s).toMatchObject({ name: 'design', source: 'hook_only', state: 'starting' });
});
it('kernelSplit range advisor et le terminal humain', () =>
  expect(kernelSplit(KERNEL).hidden.map(s => s.name)).toEqual(['advisor', 'human']));
it('rigPlace : dans <projet> si projectId, hors projet si offProject, rien sinon', …);
it('allSeats exclut le noyau et trie au travail d’abord', …);
```
- [ ] **Step 2 :** Run `pnpm --filter desktop test rigs-model` · Expected : FAIL.
- [ ] **Step 3 :** implémenter les signatures ci-dessus.
- [ ] **Step 4 :** Run `pnpm --filter desktop test rigs-model` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): rigs model"`

---

### Task 4 : Modèle de la barre latérale (sessions seules, section Rigs, ligne Ledge)

**Files :**
- Modify : `apps/desktop/src/shell/sidebar/model.ts`
- Test : `apps/desktop/test/sidebar-model.test.ts` (nouveau, ou le test existant du modèle s'il y en a un)

**Interfaces :**
- Consumes : Task 3 (`rigKey`, `kernelSplit`, `workingCount`, `rigPlace`, `seatSession`).
- Produces :
  ```ts
  export function isStandalone(s: Session, rigs: readonly Rig[]): boolean; // !s.rig, ou rig inconnu du miroir
  export function treeModel(sessions, projects, projectIdOf, rigs?: readonly Rig[]): ProjectGroup[]; // filtre isStandalone
  export interface RigRow { key: string; rig: Rig; place: RigPlace; seats: Session[]; working: number; waiting: number; remote: boolean }
  export interface KernelRow { key: string; rig: Rig; shown: Session[]; hiddenCount: number }
  export function rigsModel(rigs: readonly Rig[], byId: ReadonlyMap<string, Session>, projects: Projects | null): { rigs: RigRow[]; kernels: KernelRow[] };
  export interface LedgeLine { preview: { kind: 'decision'; count: number; rig?: string } | { kind: 'grace'; rig?: string } | { kind: 'said'; text: string } | { kind: 'calm'; rigs: number }; at?: string; unread: number }
  export function ledgeLine(escalations: readonly Escalation[], rigs: readonly Rig[], said?: { text: string; at: string }): LedgeLine;
  ```

Règles :
- `rigsModel` : rigs hors noyau triés par nom ; sièges actifs = `state` ∉ {`stopped`} dans l'ordre du rig ; `waiting` = sièges dont la session est `waiting_permission`/`waiting_input` ; `remote` = `machine !== 'local'`. Un noyau par machine, toujours après les rigs.
- `ledgeLine` [P] : `unread` = escalades `intent: 'decision'` en état `pending` ou `grace`. Aperçu, dans l'ordre : une ou plusieurs décisions `pending` → `decision` (rig de la plus ancienne) ; sinon une en `grace` → `grace` ; sinon `said` (dernier message de Ledge, fourni par le lot 4) ; sinon `calm` avec le nombre de rigs. `at` = `createdAt` de l'escalade ou `said.at`.

- [ ] **Step 1 : tests qui échouent**
```ts
it('Projets : une session appariée à un rig connu sort de Projets', () => {
  const groups = treeModel([otto, { ...build, rig: R('local', 'r1') }], twoProjects, pid, [rig('local', 'r1')]);
  expect(groups.flatMap(g => g.branches.flatMap(b => b.sessions)).map(s => s.id)).toEqual(['otto']);
});
it('Projets : une session appariée à un rig inconnu y reste', () => {
  expect(isStandalone({ ...build, rig: R('local', 'gone') }, [rig('local', 'r1')])).toBe(true);
});
it('rigsModel : noyau à part, « +2 », factory avant starter', () => {
  const m = rigsModel([STARTER, KERNEL, FACTORY], byId, twoProjects);
  expect(m.rigs.map(r => r.rig.name)).toEqual(['factory', 'starter']);
  expect(m.kernels[0]).toMatchObject({ hiddenCount: 2 });
});
it('ledgeLine : une décision qui attend → « decision », unread 1, rig factory', () =>
  expect(ledgeLine([ESC_PENDING_FACTORY], [FACTORY])).toMatchObject({ preview: { kind: 'decision', count: 1, rig: 'factory' }, unread: 1 }));
it('ledgeLine : rien en attente → message de Ledge, sinon calme', …);
```
- [ ] **Step 2 :** Run `pnpm --filter desktop test sidebar-model` · Expected : FAIL.
- [ ] **Step 3 :** implémenter ; `treeModel` garde sa signature, le quatrième paramètre remplace celui des équipes retiré au lot 1.
- [ ] **Step 4 :** Run `pnpm --filter desktop test sidebar-model` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): sidebar model for standalone sessions, rigs and Ledge's line"`

---

### Task 5 : Barre latérale, ligne Ledge 1a, section Rigs, noyau ; faux daemon e2e

**Files :**
- Create : `apps/desktop/src/shell/sidebar/LedgeLine.tsx`, `apps/desktop/src/shell/sidebar/RigsSection.tsx`, `apps/desktop/src/launch/RigLaunch.tsx` (fenêtre d'attente, remplacée au lot 5)
- Modify : `apps/desktop/src/shell/sidebar/Sidebar.tsx`, `apps/desktop/src/nav/state.ts` (modale `rig-launch`), `apps/desktop/src/App.tsx` (rendu de la modale, données rigs), `apps/desktop/src/styles/shell.css`, `apps/desktop/src/i18n/{fr,en}.ts`
- Modify : `apps/desktop/e2e/daemon.ts` (extras `rigs`, `escalations`, `openrig`, `specs`, `exchanges`)
- Test : `apps/desktop/test/sidebar-rigs.test.tsx`, `apps/desktop/e2e/rigs.spec.ts`

**Interfaces :**
- Consumes : Task 4 (`rigsModel`, `ledgeLine`, `treeModel`), Task 3 (`rigColor`, `rigFilter`, `kernelFilter`), `useRigs`, `useEscalations`, `useOpenRig` (lot 2).
- Produces :
  ```ts
  // nav/state.ts
  | { kind: 'rig-launch'; project?: string; spec?: string; goal?: string; machine?: string }   // Modal
  export function LedgeLine(p: { line: LedgeLine; on: boolean; paused: boolean; onOpen(): void }): JSX.Element;
  export function RigsSection(p: { model: ReturnType<typeof rigsModel>; openrig: readonly OpenRigStatus[]; current: string | null;
    onOpenSeat(s: Session): void; onRoom(filter: string): void; onLaunch(): void; onMenu(id: string, e: MouseEvent): void; paused: boolean; dense: boolean }): JSX.Element;
  // e2e/daemon.ts, fakeDaemon extras : rigs?: Rig[]; escalations?: Escalation[]; openrig?: OpenRigStatus; specs?: RigSpecInfo[]; exchanges?: Record<string, Exchange[]>
  //   → envoyés après le snapshot : openrig.status, rig.snapshot (par machine), escalation.updated ; rig.specs.request → rig.specs ;
  //   rig.exchanges.request → rig.exchanges. Retour : pushRig(rig), removeRig(machine, id), exchange(e).
  ```

Comportement :
- **Ligne Ledge 1a** (maquette `s1a.png`) : bouton unique (avatar `ResidentMascot`, « Ledge. », heure `HH:MM` de `line.at`, aperçu sur une ligne, pastille rouge `unread` quand > 0). Clic → `dispatch({ type: 'ledge', tab: 'conversation' })`. Le champ « Demander à Ledge… » et l'état `ask` de `Sidebar` disparaissent, avec la prop `onAsk`. La touche `/` garde son effet actuel (`nav/useKeys.ts` : `dispatch({ type: 'ledge' })`, saisie active par `chatFocus`).
- Textes de l'aperçu (fr) : `decision` « Une décision t'attend · {rig} » / « {n} décisions t'attendent » ; `grace` « Ledge s'en occupe… · {rig} » ; `calm` « J'orchestre {n} rigs » (0 : « Rien ne t'attend »).
- **Projets** : `treeModel(…, rigs)`, rien d'autre ne change.
- **Rigs** (après Projets, avant Archives) : titre « Rigs » et « + » (`aria-label` « Lancer un rig ») qui ouvre `{ kind: 'rig-launch' }`. Une ligne par rig : pastille `rigColor`, nom, « rig · n » (n = sièges actifs), « hors projet » si `place.kind === 'off'`, « · {machine} » si distant, pastilles « • n » au travail (bleu) et en attente (rouge) comme les projets. Dépliée par défaut ; ses sièges sont des lignes de session (même composant que l'arbre, même menu, même clic), un fantôme n'ouvre rien et n'a pas de menu. Double-clic ou Entrée sur la ligne de rig → `dispatch({ type: 'home', project: rigFilter(rig) })`.
- **Noyau OpenRig** : dernière ligne de la section, repliée par défaut, « noyau » en étiquette ; dépliée : `shown` (operator, queue) puis une ligne « +2 » qui, cliquée, montre les cachés.
- **OpenRig absent ou arrêté** (aucun rig, statut local `absent|stopped|error|unsupported`) : la section garde son titre et son « + », avec une ligne d'invitation : « OpenRig n'est pas installé » (et la commande `install` en texte copiable quand le statut la porte) / « OpenRig est arrêté » / « OpenRig {v} non pris en charge ». Une machine distante `unreachable` met ses rigs en « injoignable » sans les retirer.
- **Mode rail** (< 850 px) : les lignes de siège et le noyau se cachent comme les branches ; la ligne de rig garde sa pastille (même règle que les projets dans `sidebar.spec.ts`).
- **`RigLaunch.tsx` (attente)** : une `Modal` titrée « Nouveau rig », texte « Le lancement d'un rig arrive bientôt. », bouton « Fermer ». Le lot 5 remplace ce fichier.

- [ ] **Step 1 : tests qui échouent**

Vitest `sidebar-rigs.test.tsx` (rendu de `Sidebar` avec des rigs factices) :
```ts
it('la ligne Ledge ouvre l’écran Ledge et ne contient plus de champ', async () => {
  render(<SidebarHarness rigs={[FACTORY]} escalations={[ESC_PENDING_FACTORY]} />);
  expect(screen.queryByPlaceholderText('Demander à Ledge…')).toBeNull();
  const line = screen.getByRole('button', { name: /Ledge\..*Une décision t’attend · factory/ });
  expect(within(line).getByText('1')).toBeVisible();
  await user.click(line);
  expect(dispatched).toContainEqual({ type: 'ledge', tab: 'conversation' });
});
it('Projets ne liste pas build (siège de factory) ; Rigs le liste sous factory', …);
it('Noyau OpenRig replié, puis operator · queue et « +2 »', …);
it('sans OpenRig : « OpenRig n’est pas installé » sous Rigs', …);
it('un siège fantôme n’a ni menu ni lien', …);
```
E2E `e2e/rigs.spec.ts` (anglais, comme toute la suite) :
```ts
test('sidebar: Ledge line, standalone projects, rigs and kernel', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto, buildSeat, orchLead], { projects: twoProjects, rigs: [FACTORY, KERNEL], escalations: [ESC], openrig: RUNNING });
  await page.goto('/'); await openAtelier(page);
  await expect(page.getByRole('tree').getByRole('button', { name: /^build/ })).toHaveCount(1); // sous Rigs, pas sous Projects
  await expect(page.locator('section[aria-label="Projects"]').getByText('build')).toHaveCount(0);
  await page.keyboard.press('/');
  await expect(page.locator('section.ledge-home')).toBeVisible();
  await page.getByRole('button', { name: 'Launch a rig' }).click();
  await expect(page.getByRole('dialog', { name: 'New rig' })).toBeVisible();
});
```
- [ ] **Step 2 :** Run `pnpm --filter desktop test sidebar-rigs` puis `pnpm --filter desktop e2e rigs` · Expected : FAIL.
- [ ] **Step 3 :** implémenter (composants branchés sur `useRigs`/`useEscalations`/`useOpenRig`, modale, i18n fr/en, styles dans le design system existant, extension de `fakeDaemon`).
- [ ] **Step 4 :** Run les deux commandes, puis `pnpm --filter desktop e2e sidebar` (l'ancien test d'équipes a été retiré au lot 1 ; le premier test doit rester vert) · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): sidebar Ledge line, Rigs section and OpenRig kernel"`

---

### Task 6 : Scène de l'Atelier (pièces projet, rig, noyau) et navigation

**Files :**
- Modify : `apps/desktop/src/atelier/layout.ts`, `apps/desktop/src/nav/state.ts` (`reconcile`), `apps/desktop/src/shell/TopBar.tsx` (nom du filtre), `apps/desktop/src/App.tsx` (passe `rigs` à `reconcile`)
- Test : `apps/desktop/test/atelier-layout.test.ts`, `apps/desktop/test/nav-state.test.ts`

**Interfaces :**
- Consumes : Task 3 (`parseRigFilter`, `seatSession`, `kernelSplit`, `rigPlace`), Task 4 (`isStandalone`).
- Produces :
  ```ts
  export interface AtelierTable { key: string; kind: 'common' | 'rig' | 'kernel'; mains: Session[]; hidden?: number }
  export type AtelierRoom =
    | { kind: 'project'; key: string; project: Project; tables: AtelierTable[] }
    | { kind: 'rig'; key: string; rig: Rig; place: RigPlace; tables: [AtelierTable] }
    | { kind: 'kernel'; key: string; rig: Rig; tables: [AtelierTable] };
  export function sceneOf(order: readonly Session[], projects: Projects | null, projectIdOf: (s: Session) => string | null,
    filter: ProjectFilter, rigs?: readonly Rig[], byId?: ReadonlyMap<string, Session>): AtelierScene;
  export function reconcile(s: NavState, sessions: readonly Session[], projects: Projects | null, rigs?: readonly Rig[]): NavState;
  ```

Règles :
- Pièces projet : sessions seules seulement (`isStandalone`), une table, comme après le lot 1.
- Une pièce par rig hors noyau, triée par nom, après les projets ; une table, `mains` = `seatSession` de chaque siège non `stopped`, dans l'ordre du rig.
- Une pièce noyau par machine, en dernier ; `mains` = `kernelSplit(rig).shown`, `hidden` = nombre de cachés.
- Filtre : `'all'` montre tout ; un id de projet ne montre que ce projet ; `rig:…` ne montre que ce rig ; `kernel:…` que ce noyau ; `'none'` que « Sans projet ».
- `walkOrder` parcourt aussi les tables de rig et de noyau, fantômes exclus.
- `reconcile` : un filtre `rig:`/`kernel:` est connu tant que le rig (ou un noyau sur cette machine) est dans `rigs`, sinon il revient à `'all'`.
- `TopBar` : pour un filtre de rig, la puce montre la pastille `rigColor` et le nom du rig ; pour le noyau, « Noyau OpenRig ».

- [ ] **Step 1 : tests qui échouent**
```ts
it('une pièce par projet (sessions seules), une par rig, le noyau en dernier', () => {
  const scene = sceneOf(order, twoProjects, pid, 'all', [FACTORY, KERNEL], byId);
  expect(scene.rooms.map(r => r.kind)).toEqual(['project', 'project', 'rig', 'kernel']);
  expect(scene.rooms[2]!.tables[0]!.mains.map(s => s.name)).toEqual(['orch-lead', 'build', 'review-a', 'review-b', 'qa', 'design']);
  expect(scene.rooms[3]!.tables[0]).toMatchObject({ kind: 'kernel', hidden: 2 });
});
it('filtre rig:local/r1 : seule la pièce factory', …);
it('reconcile : rig retiré → filtre « all »', () => {
  const s = reconcile(navOn('rig:local/r1'), sessions, twoProjects, []);
  expect(s.place).toMatchObject({ kind: 'overview', project: 'all' });
});
it('walkOrder saute les fantômes', …);
```
- [ ] **Step 2 :** Run `pnpm --filter desktop test atelier-layout nav-state` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run `pnpm --filter desktop test atelier-layout nav-state` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): atelier scene with rig and kernel rooms"`

---

### Task 7 : Atelier, pièce de rig, plaque, échanges, bureau de Ledge

**Files :**
- Create : `apps/desktop/src/atelier/RigRoom.tsx`
- Create : `apps/desktop/src/rigs/useRigExchanges.ts`
- Modify : `apps/desktop/src/atelier/Atelier.tsx`, `apps/desktop/src/atelier/ProjectTable.tsx` (fantômes, table de rig), `apps/desktop/src/atelier/MessageLayer.tsx`, `apps/desktop/src/atelier/LedgeDesk.tsx`, `apps/desktop/src/rigs/model.ts` (`exchangeArcs`), `apps/desktop/src/rigs/terminal.ts` (nouveau), `apps/desktop/src/styles/*.css`, i18n
- Test : `apps/desktop/test/atelier-rigs.test.tsx`, `apps/desktop/test/rigs-model.test.ts` (ajout), `apps/desktop/e2e/rigs.spec.ts` (ajout)

**Interfaces :**
- Consumes : Task 6 (`AtelierRoom`), Task 2 (`fleet.seatTerminal`), `Fleet.exchanges` / `Fleet.requestExchanges` (lot 2).
- Produces :
  ```ts
  export function RigRoom(p: { room: Extract<AtelierRoom, { kind: 'rig' | 'kernel' }>; width: number; dispatch: (a: NavAction) => void;
    onTerminal(seat: RigSeat): void; children: ReactNode; extraActions?: ReactNode }): JSX.Element; // extraActions : lot 5 (Arrêter…, Ranger)
  export interface Arc { id: string; fromId: string; toId: string; text: string; at: string; kind: Exchange['kind'] }
  export function exchangeArcs(exchanges: readonly Exchange[], rig: Rig, byId: ReadonlyMap<string, Session>, now: number, ms?: number): Arc[]; // ms = BUBBLE_MS
  export async function openSeatTerminal(client: DaemonClient, rig: Rig, seat: RigSeat, byId: ReadonlyMap<string, Session>): Promise<boolean>; // rigs/terminal.ts
  // MessageLayer gagne la prop arcs?: readonly Arc[]
  export function useRigExchanges(client: DaemonClient, rigs: readonly Rig[]): ReadonlyMap<string, Exchange[]>; // rigs/useRigExchanges.ts : requestExchanges une fois par rig affiché, relu par fleet.subscribe
  ```

Comportement (maquettes `new-atelier-factory.png`, `w-3-piece.png`) :
- **Plaque de rig** sur le mur du fond : pastille `rigColor`, nom, « rig · n sièges », lieu (« dans {projet} », « hors projet · {cwd abrégé ~} », rien), « sur {machine} » si distant, « n au travail », puis « … ». Le menu « … » contient « Terminaux » (sous-menu : un élément par siège → `openSeatTerminal`) et « Fil du rig » (→ `dispatch({ type: 'ledge', tab: 'conversation' })`) ; `extraActions` est rendu en fin de menu.
- **Plaque du noyau** : « Noyau OpenRig », « la mécanique · operator et queue », et une puce « +2 » à côté de la table (texte `+{hidden}`).
- **Fantômes** : dessinés comme un siège (nom, état), sans `data-agent` cliquable, sans menu ni glisser. `openSeatTerminal` : la session appariée passe par `openSessionTerminal`, sinon `openTerminal('{rig} · {siège}', fleet.seatTerminal(machine, ref))`.
- **Échanges** : `exchangeArcs` résout `from`/`to` par `seatAt` (ref, adresse `@x` ou nom) puis `seatSession(...).id`, ne garde que les échanges de moins de `BUBBLE_MS` et dont les deux bouts sont sur la table. `MessageLayer` dessine ces arcs comme ses messages actuels (bulle 5 s, ligne pointillée, enveloppe ; `task`/`handoff` en ticket). La source `session.lastMessage` reste pour les sessions seules.
- **Bureau de Ledge** : la bulle dit « J'orchestre {n} rigs · {d} décision pour toi » (`d` = `ledgeLine(...).unread`), « Je veille sur {n} agents » sans rig, comme aujourd'hui.

- [ ] **Step 1 : tests qui échouent**
```ts
it('exchangeArcs : build → review-a par adresse, gardé 5 s puis oublié', () => {
  const arcs = exchangeArcs([{ ...EX, from: 'dev-build@factory', to: '@review-a', at: iso(T) }], FACTORY, byId, T + 1000);
  expect(arcs).toEqual([expect.objectContaining({ fromId: 'build', toId: 'reviewa' })]);
  expect(exchangeArcs([...], FACTORY, byId, T + 6000)).toEqual([]);
});
it('plaque : « factory · rig · 6 sièges · dans Ledge · 4 au travail »', …);
it('plaque distante : « sur ec2-build »', …);
it('le siège fantôme design n’ouvre pas de page de session et n’a pas de menu', …);
it('« … › Terminaux › build » ouvre le terminal du siège', …);
```
E2E (ajout à `rigs.spec.ts`) : clic sur la ligne factory (double-clic) → la puce « factory » s'affiche dans la barre du haut, la pièce de factory est la seule ; `daemon.exchange(...)` → une bulle « Candidat prêt » apparaît sur la table puis disparaît ; `daemon.removeRig('local', 'r1')` → l'Atelier revient à toutes les pièces sans erreur console.
- [ ] **Step 2 :** Run `pnpm --filter desktop test atelier-rigs rigs-model` puis `pnpm --filter desktop e2e rigs` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run les mêmes commandes, plus `pnpm --filter desktop e2e atelier` · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): rig and kernel rooms in the atelier, exchanges between seats"`

---

### Task 8 : Onglet Rigs de l'écran Ledge (En cours · Specs · Agents), en lecture

**Files :**
- Create : `apps/desktop/src/rigs/RigsTab.tsx`, `apps/desktop/src/rigs/RigCard.tsx`, `apps/desktop/src/rigs/RigsLive.tsx`, `apps/desktop/src/rigs/RigsSpecs.tsx`, `apps/desktop/src/rigs/RigsAgents.tsx`
- Modify : `apps/desktop/src/nav/state.ts` (sous-onglet), l'écran Ledge du lot 4 (ou `chat/LedgeHome.tsx`, voir Hypothèses), i18n, styles
- Test : `apps/desktop/test/rigs-tab.test.tsx`, `apps/desktop/e2e/rigs.spec.ts` (ajout)

**Interfaces :**
- Consumes : Task 2 (`useRigSpecs`), Task 3 (`allSeats`, `workingCount`, `readyCount`, `rigPlace`, `kernelSplit`, `rigFilter`), Task 7 (`openSeatTerminal`), `useRigs`, `useOpenRig` (lot 2).
- Produces :
  ```ts
  export type RigsSub = 'live' | 'specs' | 'agents';
  // nav : la place home gagne rigs?: RigsSub ; NavAction 'ledge' gagne rigs?: RigsSub et spec?: string (spec choisie dans Specs)
  export function RigsTab(p: { nav: NavState; dispatch: (a: NavAction) => void; client: DaemonClient; sessions: readonly Session[]; projects: Projects | null }): JSX.Element;
  export function RigCard(p: { rig: Rig; place: RigPlace; byId: ReadonlyMap<string, Session>; onTable(): void; onTerminal(seat: RigSeat): void;
    actions?: ReactNode; seatAction?: (seat: RigSeat) => ReactNode; footer?: ReactNode }): JSX.Element; // actions/seatAction/footer : lot 5
  ```

Comportement (maquettes `p-rigs-live.png`, `p-rigs-spec.png`) :
- Sous-onglets en `role="tablist"` : « En cours · n » (rigs + noyaux), « Specs · n », « Agents · n » (sièges hors noyau).
- **En cours** : une `RigCard` par rig, noyaux en dernier.
  - En-tête : drapeau `rigColor`, nom, « rig · n sièges · {lieu} · ⎇ {branche} · spec {spec} » (chaque morceau absent est omis), « sur {machine} » si distant ; barre de progression et « {w}/{n} au travail » (`workingCount`) ; pendant `lifecycle === 'launching'`, « {r}/{n} prêts » (`readyCount`) ; boutons « Table » (→ `dispatch({ type: 'home', project: rigFilter(rig) })`) et « Terminaux » (menu de sièges).
  - Lignes de siège : adresse, nom, état (« Au travail », « Disponible » pour `ready|idle`, « démarre… », « attend ta confiance dans le dossier », « arrêté », « en panne », « injoignable »), « · {runtime lisible} · {modèle} · contexte {p} % ». Clic sur un siège apparié → `dispatch({ type: 'open', id })`.
  - Noyau : « Noyau OpenRig · la mécanique · operator et queue · toujours allumé », « au repos » quand aucun siège ne travaille, bouton « Santé » qui déplie l'état OpenRig de la machine (version, humain inscrit ou non). Advisor et terminal humain cachés derrière « +2 ».
  - OpenRig absent/arrêté/refusé : un bandeau avec le même texte que la barre latérale ; aucune carte.
- **Specs** : à gauche, groupes « Bibliothèque · ~/.openrig/specs » (`builtin` et `library`) et « Registre · openrig.dev/rigs » (vide dans ce lot : « Rien de lu depuis le registre »), chaque spec avec ses adresses de sièges en puces et « n sièges » ; à droite, la spec choisie : nom, « Spec OpenRig · n sièges · {source} », tableau Siège · Rôle (pod) · Outil · modèle · effort · Autonomie (profil), « Fichier » (`path`, « Copier »), « Rigs nés » (rigs du miroir dont `spec` vaut ce nom, avec leur état), et « Lancer ce rig… » → `{ kind: 'rig-launch', spec: name }`. Machine : la locale ; une liste déroulante de machines quand plusieurs ont OpenRig.
- **Agents** : tableau à plat de `allSeats(rigs)` : adresse, nom, rig (pastille), état, outil · modèle, contexte. Clic → session appariée.
- Lecture seule : aucun message `rig.act` n'est envoyé par ce lot (vérifié en e2e).

- [ ] **Step 1 : tests qui échouent**
```ts
it('En cours : factory 4/6 au travail, starter 1/2, noyau au repos en dernier', …);
it('Table navigue vers la pièce du rig', async () => { …; expect(dispatched).toContainEqual({ type: 'home', project: 'rig:local/r1' }); });
it('lancement en cours : « 4/7 prêts » et « attend ta confiance dans le dossier »', …);
it('Specs : factory sélectionnée, 7 lignes de siège, « Lancer ce rig… » ouvre rig-launch avec spec factory', …);
it('Agents : 8 sièges triés au travail d’abord, sans operator ni queue', …);
it('OpenRig non pris en charge : bandeau « OpenRig 0.7.0 non pris en charge », aucune carte', …);
```
E2E : depuis l'écran Ledge, onglet « Rigs » puis « Specs » → la spec du faux daemon s'affiche ; « Agents » → les sièges ; à la fin, `daemon.received.filter(m => m.type.startsWith('rig.act'))` est vide.
- [ ] **Step 2 :** Run `pnpm --filter desktop test rigs-tab` puis `pnpm --filter desktop e2e rigs` · Expected : FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** Run les mêmes commandes · Expected : PASS. Puis `pnpm test && pnpm typecheck` à la racine · Expected : PASS.
- [ ] **Step 5 :** `git commit -m "feat(desktop): Rigs tab, live rigs, specs and agents"`

---

## Changements de contrat signalés au plan maître

1. **`rig.specs`** (Task 1) : `RigSpecSeatSchema`, `RigSpecInfoSchema`, client `rig.specs.request { requestId, machineId? }`, serveur `rig.specs { requestId, machine, specs, error? }`. Le contrat du plan maître ne liste pas les specs.
2. Dépendance `yaml` ^2 ajoutée à `packages/ledge` (lecture des specs).
3. `OpenRigHttp` (lot 2) gagne `specs()` et `spec(id)` ; `FakeOpenRig` gagne le champ `specs`.
4. `Modal` de Desktop gagne `{ kind: 'rig-launch', project?, spec?, goal?, machine? }` ; la place `home` gagne `rigs?: 'live' | 'specs' | 'agents'`. Ce sont des types Desktop, pas du protocole, mais le lot 4 (coquille) et le lot 5 (fenêtre) les partagent.

## Non couvert ici

- Toute action (Arrêter…, Annuler le lancement, Ouvrir l'invite, Ranger, dépôts trouvés) : lot 5.
- Le contenu d'« À toi », la conversation et le rail : lot 4.
- La lecture du registre `openrig.dev/rigs` : aucune route locale ne la donne en 0.6.14 ; à reprendre si le lot 0 en trouve une.
