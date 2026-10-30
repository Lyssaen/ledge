# Lot 2 : pont OpenRig en lecture, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** le daemon Ledge voit l'OpenRig de sa machine (présence, version, démarrage, inscription comme humain `ledge`), tient un miroir des rigs, sièges, noyau, escalades et échanges, apparie les sièges à ses sessions, et le diffuse à tous les clients par le contrat de protocole du plan maître. Aucune action sur un rig (lot 5), aucune réponse (lot 4).

**Architecture :**
- Un module `packages/ledge/src/daemon/openrig/` est le seul endroit qui parle à OpenRig : HTTP sur `127.0.0.1:7433`, flux SSE `/api/events`, binaire `rig`. Chaque morceau reçoit ses dépendances (`fetch`, exécution de `rig`, horloge, fichier) pour être testé contre un faux OpenRig en processus.
- `bridge.ts` orchestre : sonde de 5 s → état ; à l'état `running`, il ouvre le SSE, relit le miroir, applique les événements, et émet des `ServerMessage` que `server.ts` diffuse et rejoue après chaque `snapshot`.
- Le hook ajoute `OPENRIG_SESSION_NAME` / `OPENRIG_NODE_ID` à son `session.event` ; le serveur apparie et pose `session.rig`.
- `@ledge/fleet` range rigs, escalades, statuts et échanges par machine, comme il range les sessions.

**Tech Stack :** TypeScript ESM, zod, vitest, `node:http` (faux OpenRig), `fetch` de Node 22 (corps en flux), `ws`.

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` (§2, §3, §4.1-4.3, §4.8, §9), sous le plan maître `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md`, et la fiche de faits du lot 0 `docs/superpowers/specs/2026-10-30-openrig-facts.md`.

**Base :** `origin/main` **après la fusion du lot 1** (plus de `teams`/`role`/`roleLabel`/`team` ; `asks` existe). Les numéros de ligne ne sont pas cités : `server.ts` aura bougé avec le lot 1, on vise des symboles.

## Global Constraints

Celles du plan maître s'appliquent toutes (version minimale `0.6.14`, accès seulement par HTTP/SSE/`rig`, jamais `openrig.sqlite`, persistance sous `paths()`, commits, tests). En plus, pour ce lot :

- **Machine :** dans le daemon, le pont local porte toujours `machine: 'local'`. Seuls `@ledge/fleet` (ce lot) et l'agrégateur du lot 6 réécrivent ce champ.
- **Environnement de `rig` :** sous systemd, le `PATH` du daemon ne voit pas `rig` (fnm, npm global). Toute exécution de `rig` et la recherche du binaire passent par l'environnement `agentEnv()` déjà utilisé pour lancer les agents (`startServer`, `loginShellEnv`).
- **Port :** `http://127.0.0.1:${OPENRIG_PORT ?? 7433}`, `OPENRIG_PORT` lu dans ce même environnement.
- **Version prise en charge :** `0.6.x` avec `x ≥ 14`. Toute autre (`0.6.13`, `0.7.0`, `1.0.0`) → `unsupported`, détail « OpenRig <v> non pris en charge ». En `unsupported`, le pont ne lit **rien** d'autre que `/healthz`.
- **Démarrage :** `rig daemon start` dans les 3 cas du plan maître. Ce lot câble le cas 1 (démarrage du daemon Ledge avec des rigs connus) et expose `ensureRunning(reason)` pour les cas 2 et 3 (lot 5). Au plus un démarrage en vol ; après un échec, pas de nouvel essai automatique avant 10 min.
- **Inscription :** au plus un essai par tranche de 10 min et par machine ; l'échec laisse `human: 'failed'` et le pont continue en lecture.
- **Persistance :** `paths().openrig` = `~/.ledge/openrig.json`, `{ version: 1, machines: { [machine]: { lastEventId: number | null, rigs: string[], at: string } } }`. Écriture atomique (tmp + rename), au plus une par seconde, et à l'arrêt.
- **Échanges :** les 200 derniers par rig, en mémoire seulement.

## Review Focus

1. **OpenRig redémarre pendant que Ledge le suit** (Review Focus #1 du plan maître) : SSE coupé puis rouvert avec `Last-Event-ID`. Attendu : aucun `rig.exchange` ni nouvel `escalation.updated` en double, aucune escalade perdue (y compris une créée pendant la coupure), rigs `unreachable` pendant la coupure. → Task 10, test `resumes after an OpenRig restart`.
2. **OpenRig 0.7.0 installé** (mise à jour de l'utilisateur). Attendu : `openrig.status { state: 'unsupported' }`, aucun appel à `/api/*` ni au SSE, aucune inscription. → Task 6.
3. **Un siège Codex dont le hook tourne dans l'app-server partagé** (l'environnement est celui d'un autre siège, cf. `codexLedgeId`). Attendu : le hook n'envoie pas d'`openrig` ; l'appariement se fait par le repli `cwd` + outil, et seulement s'il est unique. → Task 11.
4. **`openrig.json` illisible, ou `lastEventId` plus vieux que le journal d'OpenRig.** Attendu : le pont repart d'un miroir neuf (`replay=0`) sans planter, et réécrit le fichier. → Task 5.
5. **Un rig supprimé pendant que Ledge était arrêté.** Attendu : à la relecture, `rig.removed` pour lui, ses sessions appariées perdent `rig`. → Task 7.

---

### Task 1 : appliquer la fiche de faits

**Files :**
- Create : `packages/ledge/src/daemon/openrig/facts.ts`
- Modify : `packages/ledge/src/paths.ts` (`paths()` gagne `openrig`)
- Test : `packages/ledge/test/openrig-facts.test.ts`

**Interfaces :**
- Consumes : la fiche `docs/superpowers/specs/2026-10-30-openrig-facts.md` (lot 0). Chaque constante porte en commentaire la section de la fiche qui la fixe. Si la fiche n'existe pas encore, on prend les replis nommés ci-dessous et on le note dans la PR.
- Produces :
  ```ts
  export const OPENRIG_MIN = '0.6.14';
  export const SUPPORTED_LINE = '0.6';                     // major.minor acceptés
  export const DEFAULT_PORT = 7433;
  export const INSTALL_COMMAND = 'npm install -g @openrig/cli@0.6.14 && rig setup';
  export type Registration = 'external' | 'host-seat';     // §4.2 : leurre Slack, ou plan B human-ledge@host
  export const REGISTRATION: Registration;                 // repli : 'external'
  export const HUMAN_ID = 'ledge';
  export const HUMAN_ADDRESS: string;                      // 'ledge@external' (repli), 'human-ledge@host' en plan B
  export const HUMAN_BINDING: string;                      // repli : 'slack:ledge-none:ledge-none:primary'
  export const OPERATOR_HUMAN_SESSIONS: readonly string[]; // repli : ['operator-human@kernel']
  export const HUMAN_GATE_TIER = 'human-gate';
  export const EVENTS: { queueCreated: 'queue.created'; queueUpdated: 'queue.updated'; queueHandedOff: 'queue.handed_off';
    sessionStatus: 'session.status_changed'; nodeLaunched: 'node.launched'; activity: 'agent.activity';
    rigCreated: 'rig.created'; rigDeleted: 'rig.deleted'; rigStopped: 'rig.stopped'; nodeAdded: 'node.added'; nodeRemoved: 'node.removed' };
  export const OUTBOX_EVENT: string | null;               // repli : null → polling GET /api/queue/outbox/list?senderSession=<ref> toutes les 5 s
  export const OPEN_QUEUE_STATES: readonly string[];       // repli : ['pending', 'in-progress', 'blocked']
  export const QUEUE_ROW: { questions: string; intent: string; evidence: string; replyTo: string; body: string }; // noms de champs d'une ligne de /api/queue/list
  export function openrigBase(env: NodeJS.ProcessEnv): string; // http://127.0.0.1:<OPENRIG_PORT|7433>
  ```

- [ ] **Step 1 : test qui échoue** — `openrig-facts.test.ts` :
  - `openrigBase({})` vaut `'http://127.0.0.1:7433'` ; `openrigBase({ OPENRIG_PORT: '7500' })` vaut `'http://127.0.0.1:7500'` ; `openrigBase({ OPENRIG_PORT: 'x' })` retombe sur 7433.
  - `HUMAN_ADDRESS` vaut `'ledge@external'` quand `REGISTRATION === 'external'`, `'human-ledge@host'` sinon.
  - `paths().openrig` finit par `/openrig.json` sous `LEDGE_HOME`.
- [ ] **Step 2 :** `pnpm --filter @paradow/ledge exec vitest run test/openrig-facts.test.ts` → FAIL (module absent).
- [ ] **Step 3 :** écrire `facts.ts` en recopiant les valeurs de la fiche (sinon les replis ci-dessus) ; ajouter `openrig: join(dir, 'openrig.json')` à `paths()`.
- [ ] **Step 4 :** même commande → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): OpenRig facts and openrig.json path"`.

### Task 2 : contrat de protocole

**Files :**
- Create : `packages/protocol/src/openrig.ts`
- Modify : `packages/protocol/src/index.ts` (`export * from './openrig.js'`), `packages/protocol/src/messages.ts` (`ServerMessageSchema`, `ClientMessageSchema`, `DaemonInfoSchema`, `SessionEventMessage`), `packages/protocol/src/session.ts` (`SessionSchema.rig`)
- Test : `packages/protocol/test/openrig.test.ts`

**Interfaces :**
- Produces : tout le bloc « Le contrat de protocole » du plan maître, **à deux renommages près** (collision d'export avec `decisions.ts` et `projects.ts`, voir « Changements de contrat » en fin de plan) : `LedgeDecisionSchema` / `LedgeDecision` et `LedgeRuleSchema` / `LedgeRule`. Chaque schéma a son type `z.infer` du même nom sans `Schema`.
- Plus :
  ```ts
  export const SessionRigSchema = z.object({ machine: z.string(), rigId: z.string(), rigName: z.string(), seat: z.string(), pod: z.string(), member: z.string() });
  // SessionSchema : rig: SessionRigSchema.optional()
  // DaemonInfoSchema : openrig: z.boolean().optional()
  // ClientMessage 'session.event' : openrig: z.object({ sessionName: z.string().min(1).max(200), nodeId: z.string().max(200).optional() }).optional()
  export const RIG_RESULT_CODES = ['rig_managed', 'already_answered', 'openrig_down', 'unsupported', 'mandate', 'unreachable', 'failed'] as const;
  export const EXCHANGES_MAX = 200;
  ```
- Tous les messages serveur et client du plan maître entrent dans les unions, même ceux que ce lot ne traite pas : un daemon de ce lot répond aux autres par l'`error` habituel (`request: <type>`), ce qui permet aux lots 3-5 de se brancher sans retoucher le protocole.

- [ ] **Step 1 : test qui échoue** — `openrig.test.ts` :
  - `EscalationSchema.parse` accepte une escalade `source: 'rig'` à 1 question / 3 options dont une `recommended`, et refuse 5 questions et une question à 1 option.
  - `ALWAYS_USER` vaut `['design', 'architecture', 'critical']`.
  - `parseServerMessage({ type: 'rig.snapshot', machine: 'local', rigs: [rig] })` passe ; idem `openrig.status`, `rig.updated`, `rig.removed`, `rig.exchange`, `rig.exchanges`, `escalation.updated`, `escalation.removed`, `rig.result` avec `code: 'unreachable'`.
  - `parseClientMessage({ type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' })` passe ; `session.event` avec `openrig: { sessionName: 'dev-build@starter' }` passe.
  - `SessionSchema.parse({ ...session, rig: { machine: 'local', rigId: 'r1', rigName: 'starter', seat: 'dev-build@starter', pod: 'dev', member: 'build' } })` garde `rig`.
  - `import * as P from '../src/index.js'` : `P.DecisionSchema` est toujours l'enum `accept|deny|always` et `P.LedgeDecisionSchema` existe (pas de collision).
- [ ] **Step 2 :** `pnpm --filter @ledge/protocol test` → FAIL.
- [ ] **Step 3 :** écrire `openrig.ts` (importe `ChatActionSchema` de `./chat.js`), brancher les unions, `DaemonInfoSchema.openrig`, `SessionSchema.rig`, `session.event.openrig`.
- [ ] **Step 4 :** `pnpm --filter @ledge/protocol test && pnpm typecheck` → PASS.
- [ ] **Step 5 :** `git commit -m "feat(protocol): OpenRig contract (rigs, escalations, exchanges, thread, brain)"`.

### Task 3 : faux OpenRig de test

**Files :**
- Create : `packages/ledge/test/fakes/openrig.ts`
- Test : `packages/ledge/test/openrig-fake.test.ts`

**Interfaces :**
- Produces :
  ```ts
  export interface FakeOpenRig {
    url: string; port: number;
    version: string | null;                          // null : /healthz sans semver (build non estampillé)
    rigs: FakeRig[];                                 // PsEntry + nodes (NodeInventoryEntry)
    queue: FakeQueueRow[]; outbox: Map<string, FakeOutboxRow[]>; humans: string[];
    kernel: { state: 'ready' | 'booting' | 'absent' };
    emit(event: { type: string } & Record<string, unknown>): number;   // ajoute au journal, renvoie seq
    stop(): Promise<void>;                           // ferme le port et coupe les flux SSE en cours (journal gardé)
    restart(): Promise<void>;                        // rouvre sur le même port, même journal
    requests: { method: string; path: string; lastEventId?: string }[];
  }
  export function createFakeOpenRig(opts?: { port?: number; version?: string | null }): Promise<FakeOpenRig>;
  export function fakeRigCli(rig: FakeOpenRig | null, opts?: { startFails?: boolean; version?: string }): RigExec; // voir Task 6
  ```
- Routes servies, mêmes formes qu'OpenRig 0.6.14 (`daemon/dist/routes/*.js`) : `GET /healthz` (`{ status: 'ok', pid, semver? }`), `GET /api/ps` (`PsEntry[]`), `GET /api/rigs/:rigId/nodes` (`NodeInventoryEntry[]`), `GET /api/kernel/status`, `GET /api/queue/list?destinationSession&state`, `GET /api/queue/outbox/list?senderSession`, `GET /api/events?replay=n` avec `Last-Event-ID`, à la sémantique exacte d'`events.js` (lignes `id: <seq>` et `data: <json>`, rejeu après l'id, `replay=0` = à partir de maintenant).

- [ ] **Step 1 : test qui échoue** — `openrig-fake.test.ts` :
  - après `emit` ×3, un `GET /api/events` avec `Last-Event-ID: 1` reçoit les seq 2 et 3 puis un 4ᵉ émis en direct ;
  - `?replay=0` ne reçoit que le 4ᵉ ;
  - `stop()` coupe un flux ouvert (le lecteur voit la fin) ; après `restart()`, `/healthz` répond sur le même port.
- [ ] **Step 2 :** `pnpm --filter @paradow/ledge exec vitest run test/openrig-fake.test.ts` → FAIL.
- [ ] **Step 3 :** écrire le faux avec `node:http`.
- [ ] **Step 4 :** même commande → PASS.
- [ ] **Step 5 :** `git commit -m "test(ledge): in-process fake OpenRig (HTTP + SSE)"`.

### Task 4 : client HTTP

**Files :**
- Create : `packages/ledge/src/daemon/openrig/wire.ts` (schémas zod `.passthrough()` des réponses OpenRig), `packages/ledge/src/daemon/openrig/http.ts`
- Test : `packages/ledge/test/openrig-http.test.ts`

**Interfaces :**
- Consumes : `openrigBase` (Task 1), le faux (Task 3).
- Produces :
  ```ts
  // wire.ts
  export const HealthSchema, PsEntrySchema, NodeEntrySchema, KernelStatusSchema, QueueRowSchema, OutboxRowSchema; // types Health, PsEntry, NodeEntry, KernelStatus, QueueRow, OutboxRow
  // http.ts
  export type Fetch = typeof fetch;
  export class OpenRigUnreachable extends Error {}           // connexion refusée / réinitialisée (ECONNREFUSED, ECONNRESET : WSL en miroir), délai
  export interface OpenRigHttp {
    health(): Promise<Health>;
    ps(): Promise<PsEntry[]>;
    nodes(rigId: string): Promise<NodeEntry[]>;
    kernel(): Promise<KernelStatus>;
    queue(q: { destinationSession?: string; state?: readonly string[] }): Promise<QueueRow[]>;
    outbox(senderSession: string): Promise<OutboxRow[]>;
  }
  export function createOpenRigHttp(opts: { base: string; fetch?: Fetch; timeoutMs?: number }): OpenRigHttp; // timeoutMs défaut 3000
  ```
- Une réponse non 2xx lève `Error` avec le statut ; une ligne qui ne passe pas son schéma est **sautée** et journalisée une fois par type (un champ nouveau d'OpenRig ne casse rien).

- [ ] **Step 1 : test qui échoue** — contre le faux : `ps()` renvoie les rigs du faux ; `queue({ destinationSession: 'ledge@external', state: OPEN_QUEUE_STATES })` envoie `?destinationSession=ledge%40external&state=pending,in-progress,blocked` (lu dans `fake.requests`) ; après `fake.stop()`, `health()` rejette `OpenRigUnreachable` ; une ligne de queue sans `qitemId` est sautée, les autres restent.
- [ ] **Step 2 :** `vitest run test/openrig-http.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter (`AbortSignal.timeout`).
- [ ] **Step 4 :** → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): OpenRig HTTP client"`.

### Task 5 : flux SSE et curseur persistant

**Files :**
- Create : `packages/ledge/src/daemon/openrig/sse.ts`, `packages/ledge/src/daemon/openrig/cursor.ts`
- Test : `packages/ledge/test/openrig-sse.test.ts`

**Interfaces :**
- Produces :
  ```ts
  // sse.ts
  export interface OpenRigEvent { seq: number; type: string; rigId?: string; [k: string]: unknown }
  export interface EventStream { close(): void }
  export function openEventStream(opts: { base: string; fetch?: Fetch; lastEventId: number | null;
    onEvent(e: OpenRigEvent): void; onOpen(): void; onEnd(error?: Error): void }): EventStream;
  // sans lastEventId : `?replay=0` ; avec : en-tête `Last-Event-ID`. Un seul essai : la reconnexion est au pont (Task 10).
  // cursor.ts
  export interface OpenRigFile { version: 1; machines: Record<string, { lastEventId: number | null; rigs: string[]; at: string }> }
  export function readOpenRigFile(file?: string): OpenRigFile;   // absent ou invalide → { version: 1, machines: {} }, journalisé
  export function createCursorWriter(opts: { file?: string; minIntervalMs?: number; now?: () => string }): {
    set(machine: string, patch: Partial<{ lastEventId: number | null; rigs: string[] }>): void; flush(): Promise<void> };
  ```
- Le parseur SSE découpe sur `\n\n`, lit `id:` et `data:` (plusieurs `data:` concaténées), ignore les commentaires `:` ; un `data` non JSON est sauté. `seq` = `Number(id)` ; un événement dont `seq` ≤ le plus grand déjà vu sur ce flux est sauté.

- [ ] **Step 1 : test qui échoue** — `openrig-sse.test.ts` :
  - contre le faux : avec `lastEventId: 2`, `onEvent` reçoit seq 3, 4 dans l'ordre, et la requête porte `Last-Event-ID: 2` ;
  - sans curseur, la requête porte `?replay=0` ;
  - `fake.stop()` → `onEnd` appelé une fois ;
  - curseur : `set('local', { lastEventId: 7 })` ×10 en 50 ms → une seule écriture avant `flush()`, le fichier contient `lastEventId: 7` ;
  - **Review Focus 4** : un `openrig.json` contenant `{"version":` (tronqué) → `readOpenRigFile` rend `{ version: 1, machines: {} }` sans lever.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter avec `fetch(...).body.getReader()` et `TextDecoder` en flux ; écriture tmp + `rename`.
- [ ] **Step 4 :** → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): OpenRig event stream and persisted cursor"`.

### Task 6 : binaire `rig`, présence et garde de version

**Files :**
- Create : `packages/ledge/src/daemon/openrig/cli.ts`, `packages/ledge/src/daemon/openrig/presence.ts`
- Test : `packages/ledge/test/openrig-presence.test.ts`

**Interfaces :**
- Consumes : `createOpenRigHttp` (Task 4), `fakeRigCli` (Task 3), constantes (Task 1).
- Produces :
  ```ts
  // cli.ts
  export type RigExec = (args: string[], opts?: { timeoutMs?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
  export function realRigExec(env: () => Promise<NodeJS.ProcessEnv>): RigExec;  // spawn('rig', args, { env }) ; ENOENT → code 127
  export interface RigCli {
    available(): Promise<boolean>;                 // `rig --version` répond
    version(): Promise<string | null>;             // `rig --version`, première ligne x.y.z
    daemonStart(): Promise<{ ok: boolean; detail?: string }>; // `rig daemon start`, délai 90 s
    humans(): Promise<string[] | null>;            // `rig gateway human list --json` → ids ; null si la commande échoue
    addHuman(): Promise<{ ok: boolean; detail?: string }>;    // `rig gateway human add ledge --display-name Ledge --binding <HUMAN_BINDING>`
  }
  export function createRigCli(exec: RigExec): RigCli;
  // presence.ts
  export function versionSupported(v: string): boolean;     // 0.6.x, x ≥ 14
  export type Probe = { state: 'absent' | 'stopped' | 'running' | 'unsupported'; version?: string; detail?: string };
  export function probeOpenRig(deps: { http: OpenRigHttp; cli: RigCli }): Promise<Probe>;
  ```
- Ordre de `probeOpenRig` : `/healthz` ; s'il répond, la version est `semver` du corps, sinon `cli.version()` (mise en cache par le pont tant que `pid` ne change pas) ; s'il ne répond pas, `cli.available()` départage `stopped` et `absent`.

- [ ] **Step 1 : test qui échoue** — `openrig-presence.test.ts` :
  - `versionSupported` : `'0.6.14'` vrai, `'0.6.20'` vrai, `'0.6.13'` faux, `'0.7.0'` faux, `'1.0.0'` faux, `'abc'` faux ;
  - faux en marche, `version: '0.6.14'` → `{ state: 'running', version: '0.6.14' }` ;
  - faux en marche sans `semver`, CLI qui dit `0.6.14` → `running`, version lue par le CLI ;
  - **Review Focus 2** : faux en `'0.7.0'` → `{ state: 'unsupported', version: '0.7.0', detail: 'OpenRig 0.7.0 non pris en charge' }` ;
  - faux arrêté, CLI présent → `stopped` ; CLI absent (exec code 127) → `absent`.
  - `createRigCli(exec).addHuman()` appelle exactement `['gateway', 'human', 'add', 'ledge', '--display-name', 'Ledge', '--binding', HUMAN_BINDING]`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): OpenRig presence probe and version gate"`.

### Task 7 : miroir des rigs, sièges et noyau

**Files :**
- Create : `packages/ledge/src/daemon/openrig/seats.ts`, `packages/ledge/src/daemon/openrig/mirror.ts`
- Test : `packages/ledge/test/openrig-mirror.test.ts`

**Interfaces :**
- Consumes : types `wire.ts`, `Rig`, `RigSeat`, `SeatState`, `projectOf` (`@ledge/protocol`).
- Produces :
  ```ts
  // seats.ts
  export function parseSessionName(name: string): { pod: string; member: string; rig: string } | null; // "{pod}-{member}@{rig}", coupé au premier '-'
  export function seatState(n: NodeEntry, activity?: string): SeatState;
  export function toSeat(n: NodeEntry, activity?: string): RigSeat;   // ref = canonicalSessionName, address = '@' + member (ou logicalId), name = member
  // mirror.ts
  export interface MirrorSnapshot { rigs: PsEntry[]; nodes: Map<string, NodeEntry[]>; kernel: KernelStatus | null }
  export interface Mirror {
    replace(s: MirrorSnapshot): { updated: Rig[]; removed: string[] };     // ids des rigs disparus
    applyEvent(e: OpenRigEvent): { updated: Rig[]; removed: string[]; refetch: string[] }; // refetch : rigIds dont relire /nodes
    setNodes(rigId: string, nodes: NodeEntry[]): Rig | null;
    markUnreachable(): Rig[];                                          // tous les rigs en lifecycle 'unreachable', gardés
    pair(rigId: string, ref: string, sessionId: string | undefined): Rig | null;
    rigs(): Rig[]; byRef(ref: string): { rig: Rig; seat: RigSeat } | null; byName(name: string): Rig | null;
  }
  export function createMirror(opts: { machine: string; projects: () => Projects; home: string }): Mirror;
  ```
- Valeurs fixées [P] :
  - `seatState` : `startupStatus` `pending` → `starting` ; `challenged` → `trust` ; `sessionStatus` `stopped`/`detached` → `stopped` ; `exited`/`crashed`/`failed` → `crashed` ; sinon `ready`, et `working` quand la dernière `agent.activity` du siège dit actif.
  - `Rig.lifecycle` : `PsEntry.status` `running|partial|stopped` tel quel, `launching` tant qu'un siège est `starting`.
  - `Rig.kernel` : vrai pour le rig nommé `kernel` (ou désigné tel par `/api/kernel/status`, selon la fiche).
  - `offProject` : `cwd` sous `<home>/.ledge/rigs/` ; `projectId` : `projectOf({ machineId: machine, cwd }, projects())` ; `repos: []` (lot 5).
  - `Rig.cwd` : `cwd` du premier siège dont le `cwd` est connu.

- [ ] **Step 1 : test qui échoue** — `openrig-mirror.test.ts` :
  - `parseSessionName('dev-build@starter')` → `{ pod: 'dev', member: 'build', rig: 'starter' }` ; `'nope'` → `null` ;
  - `replace` avec un rig `starter` de 2 sièges → un `Rig` à 2 `seats`, `ref: 'dev-build@starter'`, `address: '@build'` ;
  - `applyEvent({ type: 'session.status_changed', rigId, nodeId, status: 'exited' })` → le siège passe `crashed`, `updated` contient le rig ;
  - `applyEvent({ type: 'node.added', rigId })` → `refetch: [rigId]` ;
  - **Review Focus 5** : `replace` avec un rig `factory` absent alors que le miroir l'avait → `removed: [factoryId]` ;
  - `markUnreachable()` → chaque rig `lifecycle: 'unreachable'`, aucun retiré ;
  - un rig dont le cwd est `<home>/.ledge/rigs/x` → `offProject: true`, `projectId: null`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): OpenRig mirror of rigs, seats and kernel"`.

### Task 8 : escalades (rigs, operator, asks)

**Files :**
- Create : `packages/ledge/src/daemon/openrig/escalations.ts`, `packages/ledge/src/daemon/openrig/asks.ts`
- Test : `packages/ledge/test/openrig-escalations.test.ts`

**Interfaces :**
- Consumes : `QueueRow`, `QUEUE_ROW`, `HUMAN_ADDRESS`, `OPERATOR_HUMAN_SESSIONS`, `HUMAN_GATE_TIER` (Task 1), `Mirror.byRef` (Task 7), le type `Ask` et le service d'asks du lot 1.
- Produces :
  ```ts
  export function isHumanRow(row: QueueRow): boolean;   // destination HUMAN_ADDRESS, ou ∈ OPERATOR_HUMAN_SESSIONS, ou tier HUMAN_GATE_TIER
  export function rowToEscalation(row: QueueRow, ctx: { machine: string; rigOf(ref: string): string | undefined }): Escalation;
  export interface EscalationBook {
    replace(list: Escalation[]): { updated: Escalation[]; removed: string[] };  // updated = nouvelles ou changées seulement
    upsert(e: Escalation): Escalation | null;    // null si identique à l'existante (pas de rediffusion)
    remove(id: string): boolean; all(): Escalation[];
  }
  export function createEscalationBook(): EscalationBook;
  // asks.ts
  export function askToEscalation(ask: Ask, ctx: { machine: string; nameOf(sessionId: string): string | undefined }): Escalation; // id `ask-<ask.id>`, source 'ask'
  ```
- Règles [P] :
  - `source` : `'operator'` si la destination ∈ `OPERATOR_HUMAN_SESSIONS` ou si la source est un siège du rig noyau, sinon `'rig'`.
  - `intent` : champ `QUEUE_ROW.intent`, `'update'` quand il manque et qu'il n'y a pas de questions, sinon `'decision'`.
  - Questions : lues dans `QUEUE_ROW.questions` (format du `--human-questions-file`, fiche §questions) ; ids d'options gardés tels quels ; une ligne sans questions donne `questions: []`.
  - `state: 'pending'` ; une ligne qui quitte `OPEN_QUEUE_STATES` est retirée (`escalation.removed`). Les états `grace`/`answered` sont posés par les lots 4 et 7.
  - Une ask fermée (répondue) est retirée ; `from` = nom de la session Ledge.

- [ ] **Step 1 : test qui échoue** — `openrig-escalations.test.ts` :
  - une ligne vers `ledge@external`, source `dev-build@starter`, 1 question 3 options → `Escalation { source: 'rig', from: 'dev-build@starter', rigId, intent: 'decision', state: 'pending' }`, options dans l'ordre, `recommended` gardé ;
  - une ligne vers `operator-human@kernel` → `source: 'operator'` ;
  - une ligne de `tier: 'human-gate'` vers un autre siège → `isHumanRow` vrai ;
  - une ligne siège → siège sans tier → `isHumanRow` faux ;
  - `book.upsert(e)` deux fois avec le même contenu → le second rend `null` ;
  - `book.replace([])` après une escalade → `removed: [id]` ;
  - `askToEscalation` → `id: 'ask-a1'`, `source: 'ask'`, `from: 'Otto'`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): escalations from OpenRig human rows and ledge ask"`.

### Task 9 : échanges entre sièges

**Files :**
- Create : `packages/ledge/src/daemon/openrig/exchanges.ts`
- Test : `packages/ledge/test/openrig-exchanges.test.ts`

**Interfaces :**
- Produces :
  ```ts
  export function exchangeFromEvent(e: OpenRigEvent, ctx: { machine: string; rigOf(ref: string): string | undefined; at: string }): Exchange | null;
  // queue.created non humain → kind 'task', id `q-<qitemId>` ; queue.handed_off → 'handoff', id `h-<qitemId>` ; OUTBOX_EVENT (si la fiche en nomme un) → 'message'
  export function exchangeFromOutbox(row: OutboxRow, ctx: { machine: string; rigOf(ref: string): string | undefined }): Exchange | null; // id `o-<id>`
  export interface ExchangeLog {
    add(x: Exchange): boolean;                  // false si l'id est déjà connu (aucune rediffusion)
    list(rigId: string): Exchange[];            // ≤ EXCHANGES_MAX, du plus ancien au plus récent
    forgetRig(rigId: string): void;
  }
  export function createExchangeLog(max?: number): ExchangeLog;
  ```
- Un échange dont aucune des deux extrémités n'appartient à un rig connu est ignoré ; `rigId` est celui de l'émetteur.

- [ ] **Step 1 : test qui échoue** — `openrig-exchanges.test.ts` : `queue.created` de `dev-build@starter` vers `dev-lead@starter` → `{ kind: 'task', id: 'q-…', from, to, text: summary }` ; une ligne vers `ledge@external` → `null` (c'est une escalade) ; `add` du même id deux fois → `true` puis `false` ; 205 ajouts → `list` en garde 200, les 5 premiers partis.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): exchanges between rig seats"`.

### Task 10 : le pont (orchestration, démarrage, inscription, reprise)

**Files :**
- Create : `packages/ledge/src/daemon/openrig/bridge.ts`
- Test : `packages/ledge/test/openrig-bridge.test.ts`

**Interfaces :**
- Consumes : Tasks 1 et 4 à 9.
- Produces :
  ```ts
  export type BridgeMessage = Extract<ServerMessage, { type: 'openrig.status' | 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' | 'escalation.updated' | 'escalation.removed' }>;
  export interface BridgeDeps {
    machine?: string;                             // 'local'
    env: () => Promise<NodeJS.ProcessEnv>; fetch?: Fetch; exec?: RigExec;
    projects: () => Projects; home: string; file?: string;
    asks?: { all(): Ask[]; onChange(fn: () => void): () => void };
    sessionName: (sessionId: string) => string | undefined;
    probeMs?: number;                             // 5000
    retryMs?: number;                             // 600000 (démarrage, inscription)
    outboxMs?: number;                            // 5000, si OUTBOX_EVENT est null
    now?: () => string;
    notice?: (text: string) => void;              // « J'ai démarré OpenRig sur <machine> » ; lot 4 le branche sur le fil
  }
  export interface Bridge {
    start(): Promise<void>; stop(): Promise<void>;
    status(): OpenRigStatus; rigs(): Rig[]; escalations(): Escalation[]; exchanges(rigId: string): Exchange[];
    /** Messages à rejouer après chaque `snapshot` : openrig.status, rig.snapshot, puis un escalation.updated par escalade. */
    replay(): BridgeMessage[];
    onMessage(fn: (m: BridgeMessage) => void): () => void;
    /** Cas 2 et 3 du démarrage (lot 5) : démarre OpenRig s'il est arrêté, attend `running` (60 s), rend l'état final. */
    ensureRunning(reason: 'launch' | 'action'): Promise<OpenRigStatus>;
    pair(sessionId: string, sessionName: string): SessionRig | null;
    pairByCwd(sessionId: string, cwd: string, tool: Tool): SessionRig | null;
    unpairedRefs(): string[];
  }
  export function createBridge(deps: BridgeDeps): Bridge;
  ```
- Cycle [P] :
  1. Sonde toutes les `probeMs`. Une transition d'état émet `openrig.status`.
  2. Au premier `stopped` après `start()`, si `openrig.json` connaît des rigs pour cette machine → `daemonStart()` (cas 1), état `starting`, `notice(...)`. Échec → `error` avec le `detail` de `rig`, pas de nouvel essai avant `retryMs`.
  3. À `running` (et version prise en charge) : ouvrir le SSE (curseur du fichier), **mettre en tampon** les événements, lire `ps`, `nodes` de chaque rig, `kernel/status`, `queue` humaine ; `mirror.replace` et `book.replace` ; puis appliquer le tampon. Chaque `seq` appliqué avance le curseur.
  4. Fin du SSE ou sonde en échec : `mirror.markUnreachable()` (diffusé), état `stopped`, nouvel essai à la sonde suivante, depuis le curseur.
  5. Un `queue.created/updated/handed_off` qui touche une ligne humaine → relecture de la queue humaine (regroupée sur 200 ms) puis `book.replace`. Les autres → `exchangeFromEvent`.
  6. Inscription (si `REGISTRATION === 'external'`) : à `running`, quand au moins un rig non noyau existe et que `humans()` ne contient pas `ledge` → `addHuman()`. `human` vaut `registered`, `missing` ou `failed`.
  7. Les rigs connus (noms) et le curseur s'écrivent dans `openrig.json` par `createCursorWriter`.

- [ ] **Step 1 : tests qui échouent** — `openrig-bridge.test.ts`, avec le faux et `fakeRigCli`, `probeMs: 20` :
  - `starts with a known rig`: `openrig.json` connaît `starter`, faux arrêté → `daemonStart` appelé une fois, `notice` reçoit `"J'ai démarré OpenRig sur local"`, puis `openrig.status { state: 'running' }` et `rig.snapshot` avec `starter` ;
  - `does not start without known rigs` : fichier vide, faux arrêté → aucun `daemonStart`, état `stopped` ;
  - `registers once` : faux en marche avec un rig, `humans: []` → `addHuman` une fois, `status().human === 'registered'` ; `addHuman` en échec → `failed`, aucun nouvel essai avant `retryMs` ;
  - `escalation arrives` : `fake.queue.push(row)` puis `fake.emit({ type: 'queue.created', … destinationSession: 'ledge@external' })` → un `escalation.updated` ;
  - **`resumes after an OpenRig restart` (Review Focus 1)** :
    1. faux avec `starter` et une escalade E1, pont en marche, 3 échanges émis ;
    2. `fake.stop()` → le pont émet `rig.updated` avec `lifecycle: 'unreachable'` pour `starter` et `openrig.status { state: 'stopped' }` ;
    3. pendant la coupure, on ajoute au faux une escalade E2 (ligne + `queue.created` au journal) et un échange X4 ;
    4. `fake.restart()` → la requête SSE porte `Last-Event-ID` = dernier seq reçu avant la coupure (lu dans `fake.requests`) ;
    5. attendu : `starter` revient `running` ; E2 émise une fois ; E1 **pas** réémise (contenu inchangé) ; X4 émis une fois ; aucun id de `rig.exchange` deux fois sur toute la durée du test.
  - `unsupported reads nothing` : faux en `0.7.0` → seule `/healthz` dans `fake.requests`, aucune inscription.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter `createBridge`.
- [ ] **Step 4 :** `vitest run test/openrig-bridge.test.ts` → PASS, trois fois de suite (pas d'instabilité de minuterie).
- [ ] **Step 5 :** `git commit -m "feat(ledge): OpenRig bridge with auto start, registration and SSE resume"`.

### Task 11 : appariement des sièges aux sessions Ledge

**Files :**
- Modify : `packages/ledge/src/cli/hook.ts` (`mapHook`, `mapCursorHook`, `runHook` : champ `openrig` du `session.event`), `packages/ledge/src/daemon/store.ts` (`patch` accepte `rig`)
- Create : `packages/ledge/src/daemon/openrig/pairing.ts`
- Test : `packages/ledge/test/hook.test.ts` (cas ajoutés), `packages/ledge/test/openrig-pairing.test.ts`

**Interfaces :**
- Produces :
  ```ts
  // hook.ts
  export function openrigSeat(agent: Tool, env?: NodeJS.ProcessEnv, daemon?: () => boolean): { sessionName: string; nodeId?: string } | undefined;
  // Codex : rien sous un app-server partagé (même règle que codexLedgeId) ; sinon OPENRIG_SESSION_NAME (+ OPENRIG_NODE_ID).
  // pairing.ts
  export function pairSession(store: Store, bridge: Pick<Bridge, 'pair' | 'pairByCwd'>, msg: { id: string; cwd?: string; agent?: Tool; openrig?: { sessionName: string } }): boolean; // vrai si `session.rig` a changé
  export function unpairGone(store: Store, rigs: readonly Rig[]): string[];  // sessions dont le rig a disparu : `rig` retiré
  ```
- Règles [P] : l'appariement par nom gagne ; le repli `pairByCwd` ne vaut que pour une session `hook_only` sans `rig`, quand **un seul** siège non apparié a le même `cwd` et un `runtime` égal à l'outil. La source de vérité reste le miroir : un nom inconnu du miroir ne pose rien (on réessaie au prochain événement).

- [ ] **Step 1 : tests qui échouent** :
  - `hook.test.ts` : `openrigSeat('claude', { OPENRIG_SESSION_NAME: 'dev-build@starter', OPENRIG_NODE_ID: 'n1' })` → `{ sessionName: 'dev-build@starter', nodeId: 'n1' }` ; **Review Focus 3** : `openrigSeat('codex', { OPENRIG_SESSION_NAME: 'x' }, () => true)` → `undefined` ; sans variable → `undefined` ; `runHook` sous `OPENRIG_SESSION_NAME` envoie un `session.event` qui porte `openrig`.
  - `openrig-pairing.test.ts` (Store réel, pont factice) : un `session.event` avec `openrig` du siège `dev-build@starter` → `session.rig = { machine: 'local', rigId, rigName: 'starter', seat: 'dev-build@starter', pod: 'dev', member: 'build' }`, et `bridge.pair` reçoit l'id ; repli : deux sièges au même cwd → aucun appariement ; un seul → apparié ; `unpairGone` après la disparition de `starter` retire `rig`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter ; le hook lit l'environnement une fois par appel, sans attente réseau de plus.
- [ ] **Step 4 :** `pnpm --filter @paradow/ledge exec vitest run test/hook.test.ts test/openrig-pairing.test.ts` → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): pair OpenRig seats with Ledge sessions"`.

### Task 12 : serveur et daemon

**Files :**
- Modify : `packages/ledge/src/daemon/server.ts` (`startServer` opts `openrig?: Bridge` ; `sendSnapshot` ; `dispatch` cas `session.event` et `rig.exchanges.request` ; `close`), `packages/ledge/src/daemon/index.ts` (`startDaemon` crée, démarre et arrête le pont)
- Test : `packages/ledge/test/openrig-server.test.ts`

**Interfaces :**
- Consumes : `Bridge` (Task 10), `pairSession` / `unpairGone` (Task 11).
- Produces :
  - `sendSnapshot` : `daemon.openrig: true` dans `DaemonInfo`, puis, après les messages existants, `...bridge.replay()`. Ces messages vont aussi aux pairs distants (`/ssh/<alias>` relaie tout sauf `machines`/`projects`/`island`), ce que le lot 6 utilise.
  - `bridge.onMessage(broadcast)` ; à chaque `rig.snapshot`/`rig.removed`, `unpairGone(store, bridge.rigs())`.
  - `case 'session.event'` : après le traitement actuel, `pairSession(store, bridge, msg)`.
  - `case 'rig.exchanges.request'` : `machine === 'local'` → `reply({ type: 'rig.exchanges', machine: 'local', rigId, items: bridge.exchanges(rigId) })` ; autre machine → `error` `code: 'unreachable'` (le lot 6 route).
  - Les autres types `rig.*`, `escalation.*`, `ledge.*`, `mandate.*`, `rule.*`, `decision.*`, `category.*`, `brain.*` → `reply({ type: 'error', message: 'not supported yet', request: msg.type, code: 'unavailable' })`.
  - `startDaemon` : `createBridge({ env: agentEnv, projects, home: homedir(), asks, sessionName: id => store.get(id)?.name })`, `start()` après `startServer`, `stop()` avant `server.close()`.
  - `asks` vient du service d'asks du lot 1 (même instance que celle de `server.ts`) ; s'il n'expose pas `onChange`, on l'ajoute dans ce même commit.

- [ ] **Step 1 : test qui échoue** — `openrig-server.test.ts`, `startServer({ …, openrig: bridge })` avec un pont réel sur le faux :
  - un client WebSocket reçoit, après `snapshot` (dont `daemon.openrig === true` quand `daemon` est fourni), `openrig.status` puis `rig.snapshot` puis les `escalation.updated` ;
  - un `queue.created` humain dans le faux → le client reçoit `escalation.updated` ;
  - `rig.exchanges.request` → `rig.exchanges` avec les échanges du rig ;
  - `rig.act` → `error` `code: 'unavailable'`, `request: 'rig.act'` ;
  - un `session.event` d'un siège avec `openrig` → `session.updated` avec `rig`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** câbler `server.ts` et `index.ts`.
- [ ] **Step 4 :** `pnpm --filter @paradow/ledge test` → PASS (toute la suite : le serveur sans `openrig` se comporte comme avant).
- [ ] **Step 5 :** `git commit -m "feat(ledge): broadcast the OpenRig mirror to clients"`.

### Task 13 : `@ledge/fleet` range les rigs par machine

**Files :**
- Create : `packages/fleet/src/rigs.ts`
- Modify : `packages/fleet/src/fleet.ts` (`receive`, `add` sur chute du pair, `api.send` pour `rig.exchanges.request`), `packages/fleet/src/machines.ts` (interface `Fleet`, hooks), `packages/fleet/src/index.ts`
- Test : `packages/fleet/test/rigs-source.test.ts`

**Interfaces :**
- Produces :
  ```ts
  // rigs.ts
  export interface RigBook {
    apply(machine: string, m: Extract<ServerMessage, { type: 'openrig.status' | 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' | 'rig.exchanges' | 'escalation.updated' | 'escalation.removed' }>): boolean; // vrai si l'état visible change
    dropped(machine: string): void;     // rigs de la machine → 'unreachable', gardés ; escalades gardées
    rigs(): Rig[]; escalations(): Escalation[]; statuses(): OpenRigStatus[]; exchanges(machine: string, rigId: string): Exchange[] | null;
  }
  export function createRigBook(): RigBook;
  // Fleet (machines.ts) gagne :
  rigs(): Rig[]; escalations(): Escalation[]; openrig(): OpenRigStatus[];
  exchanges(machine: string, rigId: string): Exchange[] | null;
  requestExchanges(machine: string, rigId: string): boolean;  // false si la machine n'est pas joignable
  // hooks
  export function useRigs(client: DaemonClient): Rig[];
  export function useEscalations(client: DaemonClient): Escalation[];
  export function useOpenRig(client: DaemonClient): OpenRigStatus[];
  ```
- Règles :
  - **Réécriture de machine** : `machine` de tout message reçu d'un pair = `m.machine === 'local' ? p.config.id : m.machine` ; `seat.sessionId` qualifié par cette machine (`qualify`). De même, `session(p, s)` réécrit `s.rig.machine` quand il vaut `'local'`. Le lot 6 s'appuie sur cette règle.
  - `requestExchanges` envoie au pair de la machine `{ type: 'rig.exchanges.request', machine: 'local', rigId }`.
  - Les messages `rig.*`, `escalation.*`, `openrig.status` ne sont **pas** réémis bruts aux abonnés : ils passent par le livre et `listeners`.
  - Un `snapshot` d'un pair vide d'abord ce que le livre tenait de lui (le `rig.snapshot` qui suit le remplit).

- [ ] **Step 1 : test qui échoue** — `rigs-source.test.ts` (style `teams-source.test.ts`, pairs factices) :
  - deux machines `local` et `ec2` ; `ec2` émet `rig.snapshot { machine: 'local', rigs: [r] }` → `fleet.rigs()[0].machine === 'ec2'`, et son siège apparié `sessionId === 'ec2:ab12'` ; une session d'`ec2` avec `rig.machine: 'local'` sort du snapshot du fleet avec `rig.machine: 'ec2'` ;
  - `escalation.updated` de `local` puis `escalation.removed` → `escalations()` vide ;
  - `ec2` passe `unreachable` → son rig `lifecycle: 'unreachable'`, toujours listé ;
  - `requestExchanges('ec2', 'r1')` → le pair `ec2` reçoit `{ type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' }`, et la réponse remplit `exchanges('ec2', 'r1')`.
- [ ] **Step 2 :** `pnpm --filter @ledge/fleet test` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm --filter @ledge/fleet test && pnpm typecheck` → PASS.
- [ ] **Step 5 :** `git commit -m "feat(fleet): rigs, escalations and exchanges per machine"`.

---

## Fin de lot

- [ ] `pnpm test && pnpm typecheck` verts à la racine.
- [ ] Contrôle manuel, **avec l'accord de l'utilisateur** (il touche à son vrai OpenRig, en lecture et inscription) : daemon de dev contre l'OpenRig réel ; `openrig.status running 0.6.14`, rigs et noyau visibles par un client WebSocket ; `rig gateway human list` montre `ledge`.
- [ ] PR `feat: OpenRig read bridge (lot 2)` depuis une branche `feat/openrig-bridge` sur `origin/main`.

## Changements de contrat (à reporter au plan maître)

1. **Collision d'exports** dans `@ledge/protocol` : `DecisionSchema`/`Decision` existent déjà (`decisions.ts`, enum `accept|deny|always`) et `RuleSchema`/`Rule` aussi (`projects.ts`). Dans `openrig.ts` : `LedgeDecisionSchema`/`LedgeDecision` et `LedgeRuleSchema`/`LedgeRule`. Les lots 4, 7 et 9 doivent utiliser ces noms.
2. **Appariement par `session.event`, pas par `session.register`** : le hook n'envoie jamais `session.register` (c'est le lanceur), et un siège OpenRig n'est pas lancé par Ledge, il naît `hook_only` d'un `session.event`. Le champ ajouté est `session.event.openrig { sessionName, nodeId? }`.
3. **`SessionRigSchema`** nommé et exporté (`session.rig`), de forme `{ machine, rigId, rigName, seat, pod, member }` comme au plan maître.
4. **`RIG_RESULT_CODES` et `EXCHANGES_MAX`** exportés à côté des schémas, pour que les lots clients ne recopient pas les valeurs.
5. **Lecture des sièges** par `GET /api/rigs/:rigId/nodes` (inventaire : `canonicalSessionName`, `runtime`, `sessionStatus`, `startupStatus`, `cwd`) plutôt que par `/graph`, qui n'est pas lu dans ce lot (les arêtes ne servent qu'à l'Atelier, lot 3). Le noyau est lu par `/api/kernel/status` (la route réelle), pas `/api/kernel`.
