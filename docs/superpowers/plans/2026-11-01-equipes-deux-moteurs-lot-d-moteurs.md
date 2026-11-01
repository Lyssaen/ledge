# Lot D : couche « équipes » commune et réglage du moteur — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** un seul réglage, `teams.engine: 'ledge' | 'openrig'`, choisit le moteur d'équipes. Les clients reçoivent la même forme commune quel que soit le moteur, et le moteur non choisi est vraiment coupé.

**Architecture :**
- **La forme commune** reprend les messages `rig.*` de la branche : `RigSchema`, `rig.snapshot`, `rig.updated`, `rig.removed`, `rig.exchange` et `rig.exchanges`. `RigSchema` gagne un champ optionnel `engine`. Le moteur Ledge projette ses équipes vivantes dans cette forme : une équipe devient un `Rig`, un siège devient un `RigSeat`, et une transmission de tâche ou un message entre sièges devient un `Exchange`.
- **Le daemon** porte un contrat `TeamEngine`, implémenté par le moteur Ledge (nouveau) et par un adaptateur sur l'agrégat OpenRig existant.
- **Le réglage** vit dans `~/.ledge/teams-engine.json`, sur le modèle du réglage de l'île : un fichier, un message serveur, un message client et un setter de fleet.
- **Changer de moteur** est refusé tant qu'une équipe du moteur actif tourne. OpenRig n'est proposé que s'il est présent.
- **Mode Ledge** : le pont OpenRig ne fait que sonder.
- **Mode OpenRig** : `team.*` et `task.cmd` sont refusés par le daemon.
- `who`, `send`, `read` et `ask` restent disponibles dans les deux modes.

**Tech Stack :** TypeScript ESM, zod, vitest, React (Desktop), pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-11-01-equipes-deux-moteurs-design.md` (§6.1, §6.3, §6.4). Plan maître, lot D.

## Global Constraints

- Branche `feat/teams-two-engines`. On ne pousse pas. On ne touche ni `ledge-open-rig` ni `main`.
- **Compatibilité du fil :**
  - le protocole ne gagne que des champs optionnels ou de nouveaux types de message ;
  - les trames figées de `packages/protocol/test/fixtures/ledge-0.32/` passent toujours.
- **Moteur OpenRig** : il reste tel qu'il est sur la branche (spec §6.3). Seule sa sortie passe par la couche commune. On ne change ni ses textes ni son comportement en mode OpenRig.
- Pas de renommage du code « rig ». Les textes visibles « Équipes » viennent au lot F.
- **Ledge par défaut.** Le réglage est porté par le daemon local et appliqué à ce qu'il agrège.
- Textes en français, avec l'anglais à côté dans `apps/desktop/src/i18n/{fr,en}.ts`.
- **Chaque tâche finit verte :**
  - `pnpm typecheck` ;
  - les paquets touchés, lancés un par un (`TERM=xterm pnpm --filter <pkg> test`).
- **Échecs connus et antérieurs**, à ne pas compter :
  - `brain-remote-integration` (un ou deux tests) ;
  - `chat-service` « keeps only the last 50 turns ».
- Un commit par tâche, en Conventional Commits, terminé par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` avec des chemins explicites.

## Review Focus

1. **Changer de moteur pendant qu'une équipe tourne**, en Ledge comme en OpenRig. On attend un refus avec la raison, et le réglage inchangé, sur le disque comme sur les clients. Le test est à la tâche 2.
2. **Choisir OpenRig alors qu'il est absent partout.** On attend un refus, et dans Desktop le choix grisé avec la raison. Les tests sont aux tâches 2 et 5.
3. **Un rig lancé à la main (`rig up`) en mode Ledge.** Il n'apparaît pas et ne bloque pas le changement de moteur. Le test est à la tâche 3.
4. **Une équipe Ledge au repos quand on passe en OpenRig.** Le changement est permis : au repos, l'équipe ne tourne pas. Elle reste listée dans `teams`, `ledge team resume` est refusé avec la raison du moteur, et `ledge team dissolve` reste permis pour faire le ménage. Le test est à la tâche 3.
5. **Le chat en mode OpenRig.** Il ne propose plus `team.launch` ni `task.give`. En mode Ledge, il ne propose plus les actions de rig. Le test est à la tâche 3.

---

### Task 1 : protocole, le réglage du moteur et le moteur d'un rig

**Files :**
- Modify : `packages/protocol/src/openrig.ts`, `packages/protocol/src/messages.ts`
- Create : `packages/protocol/src/engine.ts` (exporté par `index.ts`)
- Test : `packages/protocol/test/engine.test.ts`

**Interfaces :**
- Produces :
  - `TeamsEngineSchema = z.enum(['ledge', 'openrig'])` et `type TeamsEngine` ; `DEFAULT_TEAMS_ENGINE: TeamsEngine = 'ledge'` ;
  - serveur : `TeamsEngineStateSchema = z.object({ type: z.literal('teams.engine'), engine: TeamsEngineSchema, openrigAvailable: z.boolean(), running: z.boolean() })` ;
  - client : `TeamsEngineSetSchema = z.object({ type: z.literal('teams.engine.set'), rid: z.string().min(1).max(100), engine: TeamsEngineSchema })` ;
  - serveur : `TeamsEngineResultSchema = z.object({ type: z.literal('teams.engine.result'), rid: z.string(), ok: z.boolean(), reason: z.string().optional() })` ;
  - `RigSchema` gagne `engine: TeamsEngineSchema.optional()`. Une équipe projetée porte `'ledge'`. Un rig OpenRig n'en porte pas : absent veut dire OpenRig.

- [ ] **Step 1 : tests.**
  - Les trois messages passent.
  - `teams.engine.set` avec `engine: 'x'` est refusé.
  - Un `Rig` avec `engine: 'ledge'` passe ; sans `engine`, il est inchangé.
  - Les trames figées 0.32 restent égales à elles-mêmes après analyse.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.** Ajouter les messages aux unions. Si un `switch` exhaustif du daemon l'exige, ajouter un cas provisoire qui répond `teams.engine.result { ok: false, reason: 'pas encore' }`. La tâche 2 le remplace.
- [ ] **Step 4 : GREEN.** Lancer `@ledge/protocol`, puis `pnpm typecheck`.
- [ ] **Step 5 : commit** — `feat(protocol): the teams engine setting, and which engine a rig comes from`

### Task 2 : le daemon, le réglage et la règle de changement

**Files :**
- Create : `packages/ledge/src/daemon/engine/setting.ts`
- Modify : `packages/ledge/src/paths.ts` (`teamsEngine`), `packages/ledge/src/daemon/server.ts` (lecture au démarrage, envoi dans le snapshot, cas `teams.engine.set`)
- Test : `packages/ledge/test/teams-engine-setting.test.ts`

**Interfaces :**
- Consumes : la tâche 1 ; `teams.all()` et `isTeamLive` ; l'agrégat OpenRig (`aggregate.statuses()` et `aggregate.rigs()`, ou à défaut `bridge.status()` et `bridge.rigs()`).
- Produces :
  - **`readTeamsEngine(path: string): TeamsEngine`** renvoie `'ledge'` quand le fichier manque ou est invalide. **`writeTeamsEngine(path: string, e: TeamsEngine): void`** écrit dans un fichier temporaire, puis le renomme, comme `writeIsland`.
  - **`engineRunning(engine, d: { teams: Team[]; rigs: Rig[] }): boolean`** :
    - `'ledge'` : au moins une équipe `active` ;
    - `'openrig'` : au moins un rig `!kernel` dont `lifecycle` est `running`, `partial` ou `launching`.
  - **`openrigAvailable(statuses: OpenRigStatus[]): boolean`** est vrai si au moins un état est autre que `absent`.
  - **`switchRefusal(from, to, d: { teams; rigs; statuses }): string | null`** renvoie `null` si `from === to`. Sinon, il refuse avec ces textes exacts :
    - pour `to === 'openrig'` sans OpenRig disponible : `OpenRig n'est installé sur aucune machine : installe-le (npm i -g @openrig/cli) avant de le choisir` ;
    - quand `engineRunning(from)` est vrai, avec `from === 'ledge'` : `une équipe Ledge tourne : mets-la au repos ou dissous-la avant de changer de moteur` ;
    - quand `engineRunning(from)` est vrai, avec `from === 'openrig'` : `un rig OpenRig tourne : arrête-le avant de changer de moteur`.
  - **Dans `server.ts` :**
    - `let teamsEngine = readTeamsEngine(paths().teamsEngine)` ;
    - `engineMsg()` produit `{ type: 'teams.engine', engine, openrigAvailable, running }`. Il est envoyé dans le snapshot et diffusé à chaque changement de l'un des trois champs : après un `teams.engine.set`, un changement d'équipe, un `openrig.status` ou un `rig.*`. Un message n'est diffusé que si sa valeur change.
    - Le cas `teams.engine.set` répond `teams.engine.result`. Sur `ok`, il écrit le fichier, met à jour la variable, diffuse `engineMsg()`, puis appelle `engines.apply(teamsEngine)`, que la tâche 3 branche. Dans cette tâche, `engines.apply` n'est qu'un point d'appel vide, avec un commentaire.

- [ ] **Step 1 : tests.**
  - Fonctions pures :
    - `readTeamsEngine` d'un fichier absent ou corrompu renvoie `'ledge'`.
    - `switchRefusal` couvre chaque texte exact. Une équipe `resting` n'empêche pas de passer à `'openrig'` (Review Focus 4). Un rig `kernel` en `running` n'empêche pas de passer à `'ledge'`.
  - Contre un vrai daemon (`startDaemon`) :
    - **Le snapshot** porte `teams.engine { engine: 'ledge' }`.
    - **Review Focus 2** : `teams.engine.set openrig` sans OpenRig donne `ok: false` avec la raison, et le fichier n'est pas écrit.
    - **Review Focus 1** : avec une équipe `active`, la demande est refusée.
    - **OpenRig présent** : avec un faux pont dont le statut est `running`, `set openrig` donne `ok: true`. Le fichier contient `openrig`, et un `teams.engine { engine: 'openrig' }` est diffusé.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN**, sur `@paradow/ledge` en entier.
- [ ] **Step 5 : commit** — `feat(ledge): the teams engine setting, refused while a team of the active engine runs or when OpenRig is absent`

### Task 3 : la coupure réelle du moteur non choisi

**Files :**
- Modify : `packages/ledge/src/daemon/openrig/bridge.ts` (`setProbeOnly`), `packages/ledge/src/daemon/openrig/aggregate.ts` (rien de reflété en mode Ledge), `packages/ledge/src/daemon/server.ts` (gardes et `engines.apply`), `packages/ledge/src/chat/persona.ts` ou l'endroit qui liste les actions du chat (filtre par moteur)
- Create : `packages/ledge/src/daemon/engine/guard.ts`
- Test : `packages/ledge/test/teams-engine-cut.test.ts`, plus des cas dans les tests existants du pont (`packages/ledge/test/openrig-bridge*.test.ts`, ou le fichier qui teste `createBridge`)

**Interfaces :**
- Consumes : `teamsEngine` et `engines.apply` (tâche 2).
- Produces :
  - **`bridge.setProbeOnly(on: boolean): void`.** En mode sonde, le pont continue de sonder `/healthz`, `rig --version` et `cli.available()` toutes les 5 s. Il met à jour `status()` et émet `openrig.status`. En revanche :
    - il ne démarre jamais OpenRig (`startOpenRig`) ;
    - il ne s'enregistre pas comme humain ;
    - il n'ouvre ni le flux SSE ni le sondage de l'outbox ;
    - il ne reflète pas les asks.

    `rigs()` renvoie `[]`, et `ensureRunning` lève une erreur dont le message est `ENGINE_LEDGE` (ci-dessous). `escalations()` ne garde que les escalades qui viennent de Ledge lui-même, c'est-à-dire celles du livre des asks (`askBook`, `source: 'ask'`) et, après le lot E, celles du livre des décisions. Les escalades venues d'OpenRig (`rigBook`) sont vides. Les asks et les décisions de Ledge doivent marcher dans les deux modes. Quitter le mode sonde reprend le comportement complet au tour suivant, sans redémarrer le daemon.
  - **L'agrégat** n'émet, en mode Ledge, ni `rig.snapshot` des rigs OpenRig (local et distants), ni les `escalation.*` venues d'OpenRig (celles des asks restent), ni `rig.exchange`. Il émet seulement `openrig.status`. Au passage en mode Ledge, il émet un `rig.snapshot` vide par machine pour vider les clients. Le moteur Ledge les remplit à la tâche 4.
  - **Dans `daemon/engine/guard.ts`, `engineRefusal(engine: TeamsEngine, msg: ClientMessage): string | null`**, avec ces textes exacts :
    - `ENGINE_LEDGE = "le moteur d'équipes est Ledge : les rigs OpenRig sont coupés (Réglages › Équipes)"`, renvoyé en mode Ledge pour `rig.act`, `rig.prepare`, `rig.launch`, `rig.adopt`, `rig.send` et `escalation.answer`, sauf la règle de la tâche 4 pour les équipes Ledge projetées ;
    - `ENGINE_OPENRIG = "le moteur d'équipes est OpenRig : ledge team et ledge task sont coupés (Réglages › Équipes)"`, renvoyé en mode OpenRig pour `team.launch`, `team.join`, `team.resume`, `team.compose`, `team.seat`, `team.save`, `task.cmd`, et pour `action.run` d'une action dont l'id commence par `team.` ou `task.`. Font exception `team.dissolve`, `team.leave`, et `action.run` de `team.dissolve` ou `team.leave`, toujours permis.
  - **Dans `server.ts`, `dispatch`** consulte `engineRefusal` avant de router. Il répond avec la forme de refus de chaque message : `rig.result { ok: false, code: 'unsupported', reason }`, `team.failed`, `task.result { reason }`, le `refuse(reason)` des `team.*`, et `action.result` refusé selon sa forme existante.
  - **`engines.apply(e)`** appelle `bridge.setProbeOnly(e === 'ledge')` et le mode de l'agrégat. Au démarrage, le daemon l'appelle avec la valeur lue, avant `bridge.start()`.
  - **Le chat** : la liste des actions proposées au modèle exclut `team.launch` et `task.give` en mode OpenRig, et toute action de rig (`rigLaunch` et les actions `rig.*` du registre) en mode Ledge.

- [ ] **Step 1 : tests.**
  - **Pont** : `setProbeOnly(true)`, puis un tour de sonde avec OpenRig présent et des rigs connus au démarrage. On attend `status().state` à jour, aucun appel à `cli.daemonStart`, aucun `register`, aucune connexion SSE, `rigs()` vide, et `ensureRunning` qui rejette avec `ENGINE_LEDGE`. Ensuite, `setProbeOnly(false)` : au tour suivant, `register` est appelé.
  - **Review Focus 3** : en mode Ledge, un rig non kernel `running` vu par le pont n'apparaît dans aucun `rig.snapshot` envoyé aux clients, et il ne bloque pas le passage à OpenRig. Seul compte `engineRunning('ledge')`, c'est-à-dire les équipes Ledge actives.
  - **Review Focus 4** : en mode OpenRig, avec une équipe Ledge `resting` :
    - `team.resume` est refusé avec `ENGINE_OPENRIG` ;
    - `team.dissolve` passe ;
    - `task.cmd list` est refusé ;
    - `session.message` et `ask.create` passent.
  - **Mode Ledge** : `rig.act` est refusé avec `ENGINE_LEDGE` et `code: 'unsupported'`.
  - **Review Focus 5** : la liste d'actions écrite pour le chat ne contient ni `team.launch` ni `task.give` en mode OpenRig, et aucune action de rig en mode Ledge.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN**, sur `@paradow/ledge` en entier. Les tests OpenRig existants tournent en mode OpenRig : leurs fixtures doivent poser `teams-engine.json` à `openrig`, ou appeler `engines.apply('openrig')`. Ne pas affaiblir leurs assertions.
- [ ] **Step 5 : commit** — `feat(ledge): the engine not chosen is really off: OpenRig only probed in Ledge mode, ledge team and task refused in OpenRig mode`

### Task 4 : le moteur Ledge dans la forme commune

**Files :**
- Create : `packages/ledge/src/daemon/engine/types.ts` (`TeamEngine`), `packages/ledge/src/daemon/engine/ledge.ts` (`createLedgeEngine`), `packages/ledge/src/daemon/engine/openrig.ts` (adaptateur sur l'agrégat)
- Modify : `packages/ledge/src/daemon/server.ts` (diffusion des projections, `rig.exchanges.request`, `rig.act` sur une équipe Ledge)
- Test : `packages/ledge/test/ledge-engine.test.ts`

**Interfaces :**
- Consumes : `teamsLive` (`all`, `onChange`), `store`, `tasks` (`onTask` ; transmissions avec `team`), les envois de la mailbox entre sièges, et les broadcasts du lot C s'ils sont là. Sinon, seulement les tâches et les messages.
- Produces :
  - Dans `engine/types.ts` :
    ```ts
    export interface TeamEngine {
      readonly kind: TeamsEngine;
      teams(): Rig[];                     // the common shape, engine set for Ledge teams
      exchanges(teamId: string): Exchange[];
      running(): boolean;
      onMessage(fn: (m: Extract<ServerMessage, { type: 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' }>) => void): () => void;
      replay(): ServerMessage[];
    }
    ```
  - **`createLedgeEngine(d: { store: Store; teams: TeamsLive; now?: () => string }): TeamEngine & { recordTask(t: Task, tr: TaskTransmission): void; recordMessage(from: Session, to: Session, text: string): void }`.**
    - **Projection d'une équipe non dissoute :**
      - `{ id: team.id, name, machine: 'local', cwd, projectId: team.project, offProject: team.project === null, kernel: false, engine: 'ledge', repos: [], ...(branche du dossier si elle est connue de la session du lead) }` ;
      - `lifecycle` : `active` donne `running` si tous les sièges ont une session vivante, `partial` sinon ; `resting` donne `stopped`.
    - **Projection d'un siège :**
      - `{ ref: \`${role}@${team.id}\`, address: \`@${role}\`, name: <nom de la session, ou le rôle si le siège est libre>, runtime: <outil de la session ou du siège>, sessionId?, model? }` ;
      - `state` vient de l'état de la session : `starting` donne `starting` ; `idle` donne `idle` ; `working` donne `working` ; `waiting_permission` et `waiting_input` donnent `attention` ; `exited` ou un siège libre donnent `stopped`.
    - **Les échanges** sont gardés en mémoire, `EXCHANGES_MAX` par équipe au plus :
      - une transmission de tâche d'une équipe donne `{ kind: 'task', from: fromName, to: toName, text: title }` ;
      - un message entre deux sièges d'une même équipe donne `{ kind: 'message' }` ;
      - un `@team` donne `to: '@team'`.

      Chaque échange est émis en `rig.exchange`.
  - **Le moteur actif** diffuse ses messages aux clients :
    - en mode Ledge, `rig.snapshot { machine: 'local', rigs: ledge.teams() }` au snapshot client, puis `rig.updated` à chaque changement d'équipe ou de session de siège ;
    - `rig.exchanges.request` d'un `rigId` en `team-…` est servi par le moteur Ledge.
  - **`rig.act`** en mode Ledge, sur un `rigId` en `team-…`, est traduit vers les actions d'équipe et n'est pas refusé par la garde de la tâche 3 :

    | `verb` | action d'équipe |
    |---|---|
    | `up`, `restore` | `team.resume` |
    | `down` | mettre l'équipe au repos : fermer ses sessions sans la dissoudre, avec le chemin qui produit `resting` dans `teamsLive` |
    | `restart` avec `seatRef` | `team.seat { action: 'restart' }` |
    | `stop` avec `seatRef` | fermeture de la session du siège |
    | `handover` avec `seatRef` | `session.handover` de la session du siège |

    La réponse est `rig.result { ok, reason? }`.
  - **L'adaptateur OpenRig** (`engine/openrig.ts`) enveloppe l'agrégat dans `TeamEngine`. Ses `teams()` correspondent aux rigs de l'agrégat, sans changement de forme.

- [ ] **Step 1 : tests.**
  - **Projection :**
    - Une équipe `leader` (Pim, claude, idle) et `review` (Nova, codex, working) donne un `Rig` exact : sièges, `ref`, `address`, `state` et `lifecycle: 'running'`.
    - Si Nova sort, `lifecycle` passe à `partial` et le siège à `stopped`.
    - Au repos, l'équipe a `lifecycle: 'stopped'`.
    - Dissoute, elle est absente et un `rig.removed` est émis.
  - **Échanges :** une tâche donnée par Pim à `@review` donne un `rig.exchange { kind: 'task', from: 'Pim', to: 'Nova' }`, et `exchanges(teamId)` la rend.
  - **Contre un vrai daemon en mode Ledge :**
    - Le snapshot client porte un `rig.snapshot` local avec l'équipe projetée.
    - `rig.act { verb: 'down' }` sur elle donne `rig.result ok`, puis une équipe `resting`.
    - `rig.act { verb: 'up' }` la reprend.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN**, sur `@paradow/ledge` en entier.
- [ ] **Step 5 : commit** — `feat(ledge): Ledge teams in the common team shape, so every client reads one form whatever the engine`

### Task 5 : fleet et Desktop, Réglages › Équipes

**Files :**
- Modify : `packages/fleet/src/fleet.ts` (stocker `teams.engine` du daemon local, `setTeamsEngine`), `packages/fleet/src/machines.ts` (`useTeamsEngine`)
- Modify : `apps/desktop/src/nav/state.ts` (section `teams`), `apps/desktop/src/settings/SettingsPage.tsx` (`SECTIONS`, `SECTION_ICONS`, `SectionBody`), `apps/desktop/src/i18n/{fr,en}.ts`
- Create : `apps/desktop/src/settings/Teams.tsx`
- Test : `packages/fleet/test/teams-engine.test.ts`, `apps/desktop/test/settings-teams.test.tsx`

**Interfaces :**
- Consumes : la tâche 1.
- Produces :
  - **`fleet.teamsEngine(): { engine: TeamsEngine; openrigAvailable: boolean; running: boolean } | null`**, alimenté par le message `teams.engine` du daemon local uniquement.
  - **`fleet.setTeamsEngine(e: TeamsEngine): Promise<{ ok: boolean; reason?: string }>`** envoie `teams.engine.set` et attend le `teams.engine.result` de même `rid`. Il lève `DaemonOffline` ou `DaemonOutdated` comme `setIsland`, quand le daemon ne connaît pas le message, c'est-à-dire quand le snapshot ne porte pas de `teams.engine`.
  - **`useTeamsEngine(client)`**.
  - **Réglages › Équipes** affiche « Moteur d'équipes » avec deux choix, Ledge et OpenRig :
    - OpenRig est grisé quand `!openrigAvailable`, avec le texte `settings.teams.openrigAbsent`.
    - Les deux choix sont grisés quand `running`, avec `settings.teams.running`.
    - Un refus du daemon s'affiche tel quel.
- Textes i18n, avec leurs valeurs exactes :

| clé | fr | en |
|---|---|---|
| `settings.sections.teams` | Équipes | Teams |
| `settings.teams.engine` | Moteur d'équipes | Team engine |
| `settings.teams.ledge` | Ledge | Ledge |
| `settings.teams.openrig` | OpenRig | OpenRig |
| `settings.teams.ledgeHint` | Les équipes de Ledge : sièges, tâches et lead, sans rien d'autre à installer | Ledge's own teams: seats, tasks and a lead, nothing else to install |
| `settings.teams.openrigHint` | Les rigs d'OpenRig, menés par son opérateur | OpenRig's rigs, run by its operator |
| `settings.teams.openrigAbsent` | OpenRig n'est installé sur aucune machine | OpenRig is not installed on any machine |
| `settings.teams.running` | Une équipe tourne : arrête-la pour changer de moteur | A team is running: stop it to change engines |

- [ ] **Step 1 : tests.**
  - **Fleet :**
    - `teams.engine` du daemon local alimente `teamsEngine()`, celui d'une machine distante est ignoré ;
    - `setTeamsEngine` se résout sur le `teams.engine.result` de même `rid` ;
    - sans `teams.engine` dans le snapshot, il lève `DaemonOutdated`.
  - **Desktop :**
    - la section existe et liste les deux choix ;
    - **Review Focus 2** : OpenRig est grisé avec le texte quand il est absent ;
    - les choix sont grisés pendant `running` ;
    - un clic sur OpenRig appelle `setTeamsEngine('openrig')`, et un refus s'affiche.
- [ ] **Step 2 : RED.**
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : GREEN.** Lancer `pnpm typecheck`, puis `@ledge/fleet` et `desktop`.
- [ ] **Step 5 : commit** — `feat(fleet,desktop): Settings › Teams chooses the team engine`
