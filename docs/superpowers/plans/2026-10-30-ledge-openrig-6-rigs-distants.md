# Lot 6 : rigs sur machines distantes, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un rig qui tourne sur une machine distante (une EC2 de `machines.json`) se voit, se pilote et reçoit ses réponses comme un rig local. Le daemon local agrège les rigs, escalades et échanges de chaque machine, relaie vers la bonne machine les réponses et les ordres, et garde une réponse « en attente d'envoi » tant que la machine est injoignable.

**Architecture :**
- Chaque daemon Ledge a déjà son pont vers **son** OpenRig (lot 2). Rien ne change sur la machine distante, sauf l'idempotence par `rid` (Task 2).
- Le daemon local ouvre, pour chaque machine distante de `machines.json`, un `DaemonClient` de `@ledge/fleet` vers **son propre** point `/ssh/<alias>`, avec son propre jeton. Il réutilise ainsi le pont SSH, la reprise et la vérification d'alias existants. [P : une seconde connexion SSH par machine, en plus de celle de Desktop, est acceptée.]
- `aggregate.ts` fusionne le pont local et ces pairs : tout ce qui sort du daemon porte la vraie machine (`'local'` ou l'id de `machines.json`). `router.ts` envoie chaque commande `rig.*` et `escalation.answer` à sa machine ; `answerQueue.ts` garde les réponses d'une machine injoignable.
- `@ledge/fleet` prend alors rigs et escalades du seul daemon local, dès que celui-ci annonce `DaemonInfo.openrigFleet`.

**Tech Stack :** TypeScript ESM, zod, vitest, `ws`, `@ledge/fleet` (`createDaemonClient`, `createTokenSource`).

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` §4.8 (et §4.1, §4.2, §4.6 pour la machine choisie au lancement), sous le plan maître `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md` (Review Focus #4).

**Base :** `origin/main` après les lots 2, 4 et 5. Ce plan nomme leurs symboles par leur rôle (« le gestionnaire `escalation.answer` du lot 4 ») ; la Task 1 relève leurs noms exacts dans le code fusionné et les note dans la PR.

**Hors périmètre :** créer ou allumer une EC2 ; installer OpenRig à distance (Ledge donne la commande, il ne l'exécute pas) ; l'interface de la fenêtre de lancement (lot 5 : elle lit `fleet.openrig()` que ce lot remplit).

## Global Constraints

Celles du plan maître, plus :

- **OpenRig n'est jamais exposé sur le réseau.** Le daemon local ne parle qu'à des daemons Ledge, par `/ssh/<alias>` ; jamais au port 7433 d'une autre machine.
- **Machine :** un daemon nomme son propre pont `'local'`. Le daemon local réécrit `machine: 'local'` d'un pair distant en l'id de ce pair dans `machines.json`, et **ignore** tout message `rig.*`/`escalation.*`/`openrig.status` d'un pair distant dont `machine` n'est pas `'local'` (pas d'écho entre deux daemons qui se listent l'un l'autre).
- **Relais :** vers un pair distant, `machine` redevient `'local'` ; le `rid` du client est gardé tel quel.
- **Idempotence :** un daemon traite au plus une fois un même `rid` pour `escalation.answer`, `rig.act`, `rig.launch`, `rig.send`, `rig.prepare`, pendant 24 h, et rejoue le même `rig.result` (ou `rig.plan`) à une redemande.
- **File d'attente :** seules les réponses (`escalation.answer`) attendent une machine injoignable. Un ordre (`rig.act`, `rig.launch`, `rig.send`, `rig.prepare`) vers une machine injoignable est refusé tout de suite, `code: 'unreachable'`. [P : un arrêt ou un lancement qui partirait des heures plus tard surprendrait.]
- **Persistance :** la file des réponses vit dans `openrig.json`, clé `outbox` (changement de contrat n° 4).
- **Textes :** « injoignable », « en attente d'envoi », « OpenRig n'est pas installé sur <machine> », « Ledge <v> sur <machine> ne connaît pas OpenRig : mets-le à jour », en `fr.ts` avec l'anglais dans `en.ts` pour ce que les clients affichent (lot 5 les consomme).

## Review Focus

1. **L'EC2 s'éteint avec une escalade ouverte, et l'utilisateur répond pendant la coupure** (Review Focus #4 du plan maître). Attendu : l'escalade reste, marquée `answer.delivery: 'queued'` ; à la reconnexion la réponse part une fois ; si la coupure tombe entre l'envoi et l'accusé, le renvoi garde le même `rid` et OpenRig ne reçoit qu'une réponse. → Task 6.
2. **Deux daemons qui se listent l'un l'autre** (le PC liste l'EC2, l'EC2 liste le PC). Attendu : aucun rig en double ni en boucle ; chaque rig n'apparaît qu'une fois, avec sa vraie machine. → Task 3.
3. **Le daemon distant est d'une version sans OpenRig** (`DaemonInfo.openrig` absent). Attendu : `openrig.status { state: 'unsupported', detail: 'Ledge <v> sur <machine> ne connaît pas OpenRig : mets-le à jour' }`, ordres refusés `unsupported`, rien n'est envoyé. → Task 3 et Task 5.
4. **Une machine retirée de `machines.json` avec une escalade ouverte et une réponse en file.** Attendu : ses rigs et escalades partent (`rig.removed`, `escalation.removed`), la réponse en file est abandonnée et le fil le dit (`notice`). → Task 3 et Task 6.
5. **Desktop relié à la fois au daemon local et à l'EC2** (le fleet du lot 2 lit les rigs de chaque pair). Attendu : dès que le daemon local annonce `openrigFleet`, chaque rig distant n'apparaît qu'une fois. → Task 7.

---

### Task 1 : contrat et statut « non installé »

**Files :**
- Modify : `packages/protocol/src/openrig.ts`, `packages/protocol/src/messages.ts` (`DaemonInfoSchema`), `packages/ledge/src/daemon/openrig/bridge.ts` (statut `absent` avec `install`)
- Test : `packages/protocol/test/openrig.test.ts`, `packages/ledge/test/openrig-bridge.test.ts`

**Interfaces :**
- Produces (changements de contrat 1 à 3, en fin de plan) :
  ```ts
  OpenRigStateSchema = z.enum(['absent', 'stopped', 'starting', 'running', 'unsupported', 'error', 'unreachable']);
  OpenRigStatusSchema = …extend({ install: z.string().optional() });       // la commande à lancer sur la machine, si `absent`
  EscalationSchema.answer = …extend({ delivery: z.enum(['queued', 'sent']).optional() });
  DaemonInfoSchema = …extend({ openrigFleet: z.boolean().optional() });     // ce daemon relaie les rigs de ses machines distantes
  ```
- Le pont du lot 2 remplit `install: INSTALL_COMMAND` (de `facts.ts`) quand l'état est `absent`.

- [ ] **Step 1 : tests qui échouent** — `openrig.test.ts` : `OpenRigStatusSchema.parse({ machine: 'ec2', state: 'unreachable' })` passe ; une escalade `answer: { by: 'user', answers: { q1: 'a' }, at, delivery: 'queued' }` passe ; `DaemonInfoSchema.parse({ …, openrigFleet: true })` le garde. `openrig-bridge.test.ts` : CLI absent → `status()` vaut `{ state: 'absent', install: 'npm install -g @openrig/cli@0.6.14 && rig setup' }`.
- [ ] **Step 2 :** `pnpm --filter @ledge/protocol test && pnpm --filter @paradow/ledge exec vitest run test/openrig-bridge.test.ts` → FAIL.
- [ ] **Step 3 :** implémenter ; relever dans la PR les noms exacts des gestionnaires des lots 4 et 5 (`escalation.answer`, `rig.act`, `rig.prepare`, `rig.launch`, `rig.send`).
- [ ] **Step 4 :** mêmes commandes + `pnpm typecheck` → PASS.
- [ ] **Step 5 :** `git commit -m "feat(protocol): remote OpenRig states, install hint, answer delivery"`.

### Task 2 : idempotence par `rid` dans chaque daemon

**Files :**
- Create : `packages/ledge/src/daemon/openrig/ridMemo.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (les cas `escalation.answer`, `rig.act`, `rig.launch`, `rig.send`, `rig.prepare` de `dispatch` passent par la mémoire)
- Test : `packages/ledge/test/openrig-rid.test.ts`

**Interfaces :**
- Produces :
  ```ts
  export interface RidMemo {
    /** Exécute `run` une seule fois par (type, rid) ; une redemande pendant l'exécution attend la même issue, une redemande après rejoue les messages émis vers le demandeur. */
    once(type: string, rid: string, reply: Reply, run: (reply: Reply) => Promise<void>): Promise<void>;
  }
  export function createRidMemo(opts?: { ttlMs?: number; max?: number; now?: () => number }): RidMemo; // 24 h, 2000 entrées
  ```
- Seuls les messages adressés au demandeur (`reply`) sont mémorisés ; les diffusions ne sont pas rejouées.

- [ ] **Step 1 : test qui échoue** — `openrig-rid.test.ts` : deux `once('escalation.answer', 'r1', …)` (en parallèle, puis à la suite) → `run` appelé une fois, les deux `reply` reçoivent le même `rig.result` ; un autre `rid` → `run` de nouveau ; après `ttlMs` → `run` de nouveau. Contre `startServer` avec le pont du lot 2 sur le faux OpenRig : deux `escalation.answer` de même `rid` → le faux ne reçoit qu'une réponse (les appels de réponse du lot 4, HTTP dans `fake.requests` et `rig` dans `fakeRigCli`, comptés une fois), le client reçoit deux `rig.result { ok: true }`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter et envelopper les cinq cas.
- [ ] **Step 4 :** `pnpm --filter @paradow/ledge test` → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): rig commands are idempotent per rid"`.

### Task 3 : les pairs distants du daemon

**Files :**
- Create : `packages/ledge/src/daemon/openrig/remote.ts`
- Test : `packages/ledge/test/openrig-remote.test.ts`

**Interfaces :**
- Consumes : `createDaemonClient`, `createTokenSource` (`@ledge/fleet`), `readDaemonToken` (`../auth.js`), `Machines`.
- Produces :
  ```ts
  export type RemoteMessage = Extract<ServerMessage, { type: 'openrig.status' | 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' | 'rig.exchanges' | 'escalation.updated' | 'escalation.removed' | 'rig.result' | 'rig.plan' }>;
  export interface RemotePeers {
    setMachines(list: Machines): void;               // ajoute, garde ou ferme les pairs (les machines avec `ssh`)
    status(machine: string): 'open' | 'connecting' | 'unreachable' | 'unsupported';
    send(machine: string, msg: ClientMessage): boolean;   // `machine` déjà réécrit en 'local' par l'appelant ; false si pas ouvert
    onMessage(fn: (machine: string, m: RemoteMessage) => void): () => void;  // `machine` = id du pair ; contenu déjà réécrit
    onStatus(fn: (machine: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => void): () => void;
    close(): void;
  }
  export function createRemotePeers(opts: { port: number; connect?: (machine: Machine, url: string) => DaemonClient; labelOf?: (id: string) => string }): RemotePeers;
  // connect par défaut : createDaemonClient({ url: `ws://127.0.0.1:${port}/ssh/${alias}`, WebSocketImpl: ws, token: createTokenSource(lit ~/.ledge/token) })
  ```
- Règles :
  - Un pair est `open` à son `snapshot` ; si `snapshot.daemon?.openrig` n'est pas vrai → `unsupported` (aucun relais, statut de Review Focus 3).
  - Réécriture (`rewriteFromPeer(machine, m)`, exportée pour le test) : `machine` `'local'` → id du pair ; `seat.sessionId` **non** qualifié (le fleet qualifie, lot 2 Task 13) ; un message dont `machine` n'est pas `'local'` est ignoré (Review Focus 2).
  - Les `session.*`, `chat.*` et le reste du trafic du pair sont ignorés : le daemon local ne suit que les rigs.

- [ ] **Step 1 : test qui échoue** — `openrig-remote.test.ts`, `connect` factice (pairs pilotables comme dans `packages/fleet/test/teams-source.test.ts`) :
  - `setMachines([local, { id: 'ec2', label: 'ec2-build', ssh: 'ec2-build' }])` → un seul `connect`, url `ws://127.0.0.1:<port>/ssh/ec2-build` ;
  - le pair envoie `snapshot` (avec `daemon.openrig: true`) puis `rig.snapshot { machine: 'local', rigs: [r] }` → `onMessage('ec2', { …machine: 'ec2', rigs: [{ …machine: 'ec2' }] })` ;
  - **Review Focus 2** : le pair envoie `rig.updated { rig: { machine: 'pc', … } }` → rien ;
  - **Review Focus 3** : `snapshot` sans `daemon.openrig` → `status('ec2') === 'unsupported'`, aucun `onMessage` pour ses rigs ;
  - **Review Focus 4** : `setMachines([local])` → le pair est fermé, `onStatus('ec2', 'removed')`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): the daemon follows the rigs of its remote machines"`.

### Task 4 : l'agrégat et sa diffusion

**Files :**
- Create : `packages/ledge/src/daemon/openrig/aggregate.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (`sendSnapshot` rejoue `aggregate.replay()` au lieu de `bridge.replay()` ; `broadcast` branché sur `aggregate.onMessage` ; `case 'machines.set'` appelle `remote.setMachines`), `packages/ledge/src/daemon/index.ts` (crée `RemotePeers` avec le port du serveur et la liste lue)
- Test : `packages/ledge/test/openrig-aggregate.test.ts`

**Interfaces :**
- Consumes : `Bridge` (lot 2), `RemotePeers` (Task 3).
- Produces :
  ```ts
  export interface RigAggregate {
    replay(): BridgeMessage[];                      // un openrig.status par machine (distantes comprises), un rig.snapshot par machine, puis les escalades
    onMessage(fn: (m: BridgeMessage) => void): () => void;
    rigs(): Rig[]; escalations(): Escalation[]; statuses(): OpenRigStatus[];
    escalation(id: string): Escalation | undefined;
    exchanges(machine: string, rigId: string): Exchange[] | null;   // distant : dernière réponse `rig.exchanges` reçue
    /** Superpose un état local (réponse en file, lot 6 Task 6) à une escalade distante, rediffusée. */
    overlay(id: string, patch: Partial<Escalation> | null): void;
  }
  export function createRigAggregate(opts: { bridge: Bridge; remote: RemotePeers; machines: () => Machines; projects: () => Projects }): RigAggregate;
  ```
- Règles :
  - Pair distant `unreachable` → `openrig.status { machine, state: 'unreachable' }`, ses rigs `lifecycle: 'unreachable'` (gardés), ses escalades gardées telles quelles (spec §4.8 : elles attendent là-bas).
  - Pair `removed` → `rig.removed` pour chacun de ses rigs, `escalation.removed` pour chacune de ses escalades, `openrig.status` retiré.
  - Au `rig.snapshot` d'un pair qui revient : les rigs qu'il ne cite plus → `rig.removed` ; idem pour les escalades à son `snapshot` suivant (le daemon distant rejoue toutes ses escalades après chaque `snapshot`).
  - `projectId` d'un rig distant recalculé ici : `projectOf({ machineId: machine, cwd: rig.cwd }, projects())` (les projets vivent sur la machine locale).
  - `DaemonInfo.openrigFleet: true` dans le `snapshot`.

- [ ] **Step 1 : test qui échoue** — `openrig-aggregate.test.ts`, pont factice + `RemotePeers` factice :
  - `replay()` après un rig local et un rig `ec2` → deux `rig.snapshot` (`machine: 'local'` et `'ec2'`) ;
  - `ec2` passe `unreachable` → `openrig.status { machine: 'ec2', state: 'unreachable' }` et `rig.updated` `lifecycle: 'unreachable'` ; son escalade reste dans `escalations()` ;
  - `ec2` revient avec un `rig.snapshot` vide → `rig.removed` pour l'ancien rig ;
  - un projet dont une règle couvre `{ machine: 'ec2', path: '/home/ubuntu/app' }` → le rig `ec2` de ce cwd a ce `projectId` ;
  - contre `startServer` : un client reçoit `daemon.openrigFleet === true` et les deux `rig.snapshot` après le `snapshot`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter et câbler.
- [ ] **Step 4 :** `pnpm --filter @paradow/ledge test` → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): aggregate local and remote rigs in one view"`.

### Task 5 : router les commandes vers leur machine

**Files :**
- Create : `packages/ledge/src/daemon/openrig/router.ts`, `packages/ledge/src/daemon/openrig/answerQueue.ts` (types `QueuedAnswer` et `AnswerQueue` seulement, implémentés à la Task 6)
- Modify : `packages/ledge/src/daemon/server.ts` (en tête de `dispatch`, les types `rig.act`, `rig.prepare`, `rig.launch`, `rig.send`, `rig.exchanges.request`, `escalation.answer` passent par `routeRigCommand`)
- Test : `packages/ledge/test/openrig-router.test.ts`

**Interfaces :**
- Consumes : `RigAggregate` (Task 4), `RemotePeers` (Task 3), `AnswerQueue` (Task 6, injecté ; un faux ici).
- Produces :
  ```ts
  export type RigCommand = Extract<ClientMessage, { type: 'rig.act' | 'rig.prepare' | 'rig.launch' | 'rig.send' | 'rig.exchanges.request' | 'escalation.answer' }>;
  export function machineOf(msg: RigCommand, ctx: { aggregate: RigAggregate; plans: Map<string, string> }): string | null; // null : escalade ou plan inconnus
  export function createRigRouter(opts: { aggregate: RigAggregate; remote: RemotePeers; answers: AnswerQueue;
    local: (msg: RigCommand, reply: Reply) => Promise<void> }): { route(msg: RigCommand, reply: Reply): Promise<void> };
  ```
- Règles :
  - Machine : `msg.machine` (`rig.act`, `rig.prepare`, `rig.send`, `rig.exchanges.request`) ; `plans.get(planId)` (`rig.launch`) ; `aggregate.escalation(id).machine` (`escalation.answer`). `'local'` → `local(msg, reply)` (les gestionnaires des lots 4 et 5, inchangés).
  - Distante : on note `rid → reply`, on envoie `{ ...msg, machine: 'local' }` (sans `machine` pour les types qui n'en ont pas), puis le `rig.result` / `rig.plan` / `rig.exchanges` du pair, dont `rid` correspond, va au seul demandeur. Un `rig.plan` reçu → `plans.set(plan.id, machine)` et `plan.machine` réécrit.
  - Refus immédiats `rig.result { ok: false }` : pair `unreachable` → `code: 'unreachable'`, `reason: '<label> est injoignable'` (sauf `escalation.answer`, qui part dans la file) ; pair `unsupported` → `code: 'unsupported'` ; statut OpenRig de la machine `absent` (pour `rig.prepare` et `rig.launch`) → `code: 'openrig_down'`, `reason: "OpenRig n'est pas installé sur <label> : <install>"`.
  - Le garde du mandat (lot 7) s'exécute avant `route` pour les réponses `by: 'ledge'` : `route` ne le refait pas.

- [ ] **Step 1 : test qui échoue** — `openrig-router.test.ts` :
  - `rig.act { machine: 'ec2', rigId, verb: 'down' }` → le pair `ec2` reçoit `{ …, machine: 'local' }` ; son `rig.result { rid }` arrive au seul demandeur ;
  - `rig.prepare { machine: 'ec2' }` → `rig.plan` reçu avec `plan.machine === 'ec2'` ; un `rig.launch { planId }` qui suit part vers `ec2` ;
  - `ec2` injoignable : `rig.act` → `rig.result { ok: false, code: 'unreachable' }`, rien d'envoyé ; `escalation.answer` d'une escalade d'`ec2` → `answers.enqueue` appelé ;
  - statut `ec2` `absent` : `rig.prepare` → `code: 'openrig_down'`, `reason` contient `OpenRig n'est pas installé sur ec2-build` et `npm install -g @openrig/cli`;
  - `machine: 'local'` → `local` appelé, aucun pair touché ;
  - `escalation.answer` d'un id inconnu → `rig.result { ok: false, code: 'failed' }`.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter et brancher dans `dispatch`.
- [ ] **Step 4 :** `pnpm --filter @paradow/ledge test` → PASS.
- [ ] **Step 5 :** `git commit -m "feat(ledge): route rig commands and answers to their machine"`.

### Task 6 : réponses en attente d'envoi

**Files :**
- Modify : `packages/ledge/src/daemon/openrig/answerQueue.ts` (implémentation), `packages/ledge/src/daemon/openrig/cursor.ts` (`OpenRigFile.outbox`)
- Test : `packages/ledge/test/openrig-answer-queue.test.ts`

**Interfaces :**
- Produces :
  ```ts
  export interface QueuedAnswer { rid: string; machine: string; id: string; answers: Record<string, string>; by: 'user' | 'ledge'; at: string; sentAt?: string }
  export interface AnswerQueue {
    enqueue(a: QueuedAnswer, reply: Reply): void;   // répond tout de suite rig.result { rid, ok: true } ; overlay { state: 'answered', answer: { …, delivery: 'queued' } }
    pending(machine?: string): QueuedAnswer[];
    /** À l'ouverture du pair et à chaque passage de son OpenRig à `running` : renvoie chaque réponse de la machine une fois, dans l'ordre, même `rid`. */
    flush(machine: string): void;
    /** rig.result du pair pour un rid en file : ok ou already_answered → retirée, overlay retiré (l'escalade du pair fait foi) ; openrig_down → gardée ; autre → retirée, notice. */
    settle(machine: string, result: Extract<ServerMessage, { type: 'rig.result' }>): void;
    drop(machine: string): void;                      // machine retirée : abandon + notice
  }
  export function createAnswerQueue(opts: { remote: RemotePeers; aggregate: RigAggregate; file?: string; notice: (text: string) => void; now?: () => string }): AnswerQueue;
  ```
- Règles : la file est relue d'`openrig.json` au démarrage (réponses gardées à travers un redémarrage du daemon local) ; une escalade que le pair ne liste plus à son retour (fermée là-bas) fait abandonner sa réponse, avec la notice « Ma réponse à <résumé> n'est pas partie : la question a été fermée sur <machine> ». Un `flush` n'envoie qu'une fois par réponse et par connexion (`sentAt`), jamais en boucle.

- [ ] **Step 1 : tests qui échouent** — `openrig-answer-queue.test.ts` :
  - **`answers wait for an unreachable machine and go once` (Review Focus 1)**, de bout en bout : daemon « distant » = `startServer` + pont du lot 2 sur le faux OpenRig (port A) ; daemon local = `startServer` avec `RemotePeers` dont `connect` vise directement `ws://127.0.0.1:<A>` (pas de SSH) ; une escalade E sur le faux.
    1. le client local voit E avec `machine: 'ec2'` ;
    2. on coupe le daemon distant (`stop`) → `openrig.status { machine: 'ec2', state: 'unreachable' }`, E toujours là ;
    3. le client envoie `escalation.answer { rid: 'r1', id: E }` → `rig.result { rid: 'r1', ok: true }` et `escalation.updated` avec `answer.delivery: 'queued'` ; rien n'est reçu par le faux ;
    4. on relance le daemon distant → exactement un `escalation.answer` de `rid: 'r1'` lui parvient ; le faux ne reçoit qu'une réponse ; E passe `answer.delivery: 'sent'` puis disparaît à la fermeture ;
    5. variante « accusé perdu » : coupure juste après l'envoi, avant `rig.result` → au retour, renvoi avec `rid: 'r1'` ; le faux n'a toujours reçu qu'une réponse (Task 2) ; la file est vide.
  - la file survit à un redémarrage du daemon local (relue d'`openrig.json`) ;
  - **Review Focus 4** : `drop('ec2')` → file vide, `notice` appelée une fois.
- [ ] **Step 2 :** → FAIL.
- [ ] **Step 3 :** implémenter ; brancher `flush` sur `remote.onStatus('open')` et sur `openrig.status running` du pair, `settle` sur les `rig.result` du pair, `drop` sur `removed`.
- [ ] **Step 4 :** `vitest run test/openrig-answer-queue.test.ts` → PASS, trois fois de suite.
- [ ] **Step 5 :** `git commit -m "feat(ledge): answers wait for an unreachable machine and are sent once"`.

### Task 7 : `@ledge/fleet` lit l'agrégat

**Files :**
- Modify : `packages/fleet/src/fleet.ts` (`receive`, `api.send`), `packages/fleet/src/rigs.ts`
- Test : `packages/fleet/test/rigs-source.test.ts` (cas ajoutés)

**Interfaces :**
- Consumes : `RigBook` (lot 2 Task 13), `DaemonInfo.openrigFleet`.
- Produces : aucun nouveau nom. Règles :
  - Si le `snapshot` du pair `local` porte `daemon.openrigFleet`, le livre **ignore** les `rig.*`, `escalation.*` et `openrig.status` des pairs distants ; il prend tout du pair `local`, dont les messages portent déjà la vraie machine (la règle de réécriture du lot 2 les laisse tels quels, puisque `m.machine !== 'local'`).
  - Envoi : `rig.act`, `rig.prepare`, `rig.launch`, `rig.send`, `rig.exchanges.request`, `escalation.answer` vont alors au pair `local`, **sans** réécrire `machine`. Sans `openrigFleet` (vieux daemon local), on garde le routage du lot 2 : au pair de `machine`, avec `machine: 'local'`.
  - `requestExchanges` suit la même règle.

- [ ] **Step 1 : test qui échoue** — **Review Focus 5** : pairs `local` (avec `openrigFleet`) et `ec2` ; `local` émet `rig.snapshot { machine: 'ec2', rigs: [r] }` et `ec2` émet `rig.snapshot { machine: 'local', rigs: [r] }` → `fleet.rigs()` a **un** rig, `machine: 'ec2'` ; `api.send({ type: 'rig.act', rid, machine: 'ec2', … })` → reçu par le pair `local`, `machine: 'ec2'` ; le pair `ec2` ne reçoit rien. Sans `openrigFleet` : le même `rig.act` part au pair `ec2` avec `machine: 'local'`.
- [ ] **Step 2 :** `pnpm --filter @ledge/fleet test` → FAIL.
- [ ] **Step 3 :** implémenter.
- [ ] **Step 4 :** `pnpm --filter @ledge/fleet test && pnpm typecheck` → PASS.
- [ ] **Step 5 :** `git commit -m "feat(fleet): take rigs from the aggregating local daemon"`.

---

## Fin de lot

- [ ] `pnpm test && pnpm typecheck` verts à la racine.
- [ ] Parcours réel, **avec l'accord de l'utilisateur**, sur une EC2 déjà allumée et listée dans `machines.json`, avec Ledge à jour dessus :
  1. OpenRig absent sur l'EC2 → la fenêtre de lancement dit « OpenRig n'est pas installé sur ec2-build » et la commande ;
  2. une fois installé à la main : lancer `starter` hors projet sur l'EC2 depuis Desktop, le voir « sur ec2-build » ;
  3. recevoir une escalade, couper le SSH (ou arrêter l'EC2), répondre (« en attente d'envoi »), rétablir : la réponse part une fois ;
  4. arrêter le rig.
- [ ] PR `feat: rigs on remote machines (lot 6)` depuis `feat/openrig-remote` sur `origin/main`.

## Changements de contrat (à reporter au plan maître)

1. `OpenRigStateSchema` gagne `'unreachable'` : le daemon local ne joint plus le daemon Ledge de la machine (différent de `stopped`, où OpenRig lui-même est arrêté).
2. `OpenRigStatusSchema` gagne `install?: string`, rempli par le pont de chaque machine quand l'état est `absent` (lot 2 `bridge.ts`, modifié ici).
3. `EscalationSchema.answer` gagne `delivery?: 'queued' | 'sent'` (« en attente d'envoi »). `DaemonInfoSchema` gagne `openrigFleet?: boolean`.
4. `openrig.json` gagne `outbox: QueuedAnswer[]` (la Global Constraint « Persistance Ledge » du plan maître ne citait que le curseur et les rigs connus).
5. **Idempotence par `rid`** de `escalation.answer`, `rig.act`, `rig.launch`, `rig.send`, `rig.prepare` dans tout daemon (Task 2). Les lots 4 et 5 n'ont rien à changer : la mémoire enveloppe leurs gestionnaires.
6. Le lot 5 lit la liste des machines de lancement dans `fleet.openrig()` (un statut par machine, `install` compris) ; il n'a pas à sonder lui-même.
