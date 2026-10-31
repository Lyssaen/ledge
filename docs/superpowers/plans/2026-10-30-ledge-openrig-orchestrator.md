# Ledge, orchestrateur d'OpenRig : plan d'implémentation (plan maître)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** faire de Ledge l'humain et l'orchestrateur des rigs OpenRig, locaux ou distants (EC2). Ledge lit et répond aux escalades, lance et pilote les rigs, et pense en continu dans un mandat. Le système d'équipes propre à Ledge est retiré.

**Architecture :**
- Chaque daemon Ledge fait tourner un **pont** vers l'OpenRig de sa machine. Il passe par l'API HTTP et le flux SSE en `127.0.0.1:7433`, et par le CLI `rig`.
- Le daemon local agrège les machines distantes par `@ledge/fleet`, sur le pont SSH existant.
- Un **fil de Ledge** unique remplace le chat ponctuel. Un **cerveau**, session permanente de l'outil choisi, y répond et tranche par `ledge brain …`, sous un garde de mandat exécuté dans le daemon.
- Desktop, l'encoche, le TUI et le mobile consomment le même contrat de protocole, défini ici.

**Tech Stack :**
- TypeScript (ESM), zod ;
- vitest et playwright ;
- React (Desktop, encoche, mobile), ink (TUI) ;
- Tauri (Rust) ;
- OpenRig `@openrig/cli` 0.6.14, en dépendance externe : on appelle son binaire et son API, jamais son code.

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md`, cité « spec §n ».

## Les lots

Chaque lot a son plan détaillé, se livre seul (branche depuis `origin/main`, PR, tests verts) et laisse Ledge utilisable.

| Lot | Plan | Dépend de | Livre |
|---|---|---|---|
| 0 | `2026-10-30-ledge-openrig-0-sonde.md` | — | Fiche de faits OpenRig, issue d'un OpenRig jetable. Elle fixe l'inscription et la réponse (spec §4.2, §4.4) |
| 1 | `2026-10-30-ledge-openrig-1-retrait-equipes.md` | — | Plus de `ledge team`, de rôles ni de `ledge task` ; arrivée de `ledge ask` |
| 2 | `2026-10-30-ledge-openrig-2-pont-lecture.md` | 0, 1 | Pont local : présence, démarrage, inscription, miroir rigs/sièges/escalades/échanges, appariement des sièges |
| 3 | `2026-10-30-ledge-openrig-3-desktop-rigs.md` | 2 | Barre latérale 1a, sections Projets et Rigs, noyau, Atelier « une pièce = une table », onglet Rigs en lecture |
| 4 | `2026-10-30-ledge-openrig-4-fil-et-reponses.md` | 2 | Fil de Ledge, décision dans le message, réponse aux escalades, écran Ledge Conversation et rail, encoche |
| 5 | `2026-10-30-ledge-openrig-5-cycle-et-lancement.md` | 2, 3 | Actions de cycle de vie, refus `rig_managed`, lancement en 3 temps, hors projet, dépôts trouvés, Ranger |
| 6 | `2026-10-30-ledge-openrig-6-rigs-distants.md` | 2, 4, 5 | Rigs sur une machine distante (EC2) : pont par machine, agrégation, actions et réponses relayées |
| 7 | `2026-10-30-ledge-openrig-7-cerveau.md` | 4 (6 pour le distant) | Cerveau permanent, `ledge brain`, garde du mandat, mémoire, onglet Mandat, Revenir dessus, grâce de 60 s |
| 8 | `2026-10-30-ledge-openrig-8-tui.md` (Tuin, branche `docs/ledge-openrig-8-tui`, 0262f343) | 1, 2, 4, 5 | TUI selon la maquette de Tuin |
| 9 | plan de Mobi : `.worktrees/mobi-mockup/docs/superpowers/plans/2026-10-30-ledge-mobile-orchestrator.md` | 2, 4, 5 (7 pour l'avis de Ledge) | Mobile selon la maquette de Mobi ; correspondance ci-dessous |
| 10 | §Bureaux ci-dessous ; plan détaillé à écrire d'après `2026-10-31-ledge-bureaux-design.md` §5 | 2, 3, 4, 6, 7 (+ mascottes commitées) | L'Atelier devient l'étage de bureaux en pixel art |

Ordre conseillé : 0 ∥ 1, puis 2, puis 3 ∥ 4, puis 5, puis 6 ∥ 7, puis 8 ∥ 9. Le lot 10 (Bureaux) vient après les lots OpenRig (2 à 7). Il peut avancer en parallèle des lots 8 et 9.

- **Le lot 0 exige l'accord explicite de l'utilisateur** au moment de démarrer l'OpenRig jetable. Il ne touche jamais `~/.openrig`.
- Le lot 2 se branche sur la fiche de faits du lot 0. Si celle-ci retient le repli `human-ledge@host`, seul le module `openrig/answer.ts` (lot 4) change de forme ; le contrat de protocole ne bouge pas.

## Global Constraints

- **OpenRig :** version minimale `0.6.14`. Une version majeure ou mineure supérieure inconnue → état `unsupported`, affiché « OpenRig <v> non pris en charge » (spec §4.1).
- **Accès à OpenRig :** uniquement par `http://127.0.0.1:7433` (ou `OPENRIG_PORT`), le flux SSE `/api/events` et le binaire `rig`. **Jamais** de lecture de `~/.openrig/openrig.sqlite` (spec §1, non-objectifs).
- **Cycle de vie d'un siège :** il passe **uniquement par OpenRig**. Aucun `tmux kill-session` ni `kill` sur une session appariée à un rig (spec §1, anti-objectifs ; §4.5).
- **Démarrer OpenRig :** Ledge le démarre lui-même (`rig daemon start`) dans trois cas, et le dit dans le fil (spec §4.1) :
  - au démarrage du daemon Ledge, si des rigs tournaient avant ;
  - au lancement d'un rig ;
  - à une action sur un rig.
- **Inscription :** Ledge s'inscrit lui-même comme l'humain `ledge` sur chaque machine où un rig tourne, avec le leurre Slack : `rig gateway human add ledge --display-name Ledge --binding slack:ledge-decoy:file:<fichier absent>:primary --delivery-class D --actor ledge`, sans créer le fichier. Le repli `human-ledge@host` n'est pas retenu (spec §4.2). (fixé par la fiche de faits, D2, D9)
- **Le mandat :** les catégories `design`, `architecture` et `critical` ne sont **jamais** tranchées par Ledge seul. Le refus est appliqué dans le daemon (spec §5.3).
- **Le cerveau :** il attend **60 s** avant de trancher seul. La première réponse enregistrée gagne, et l'autre reçoit le code `already_answered` (spec §5.3).
- **La transition :** `ledge who`, `ledge send` et `ledge read` restent ; `ledge ask "<question>" "<options, ta recommandation>"` remplace `ledge task give ledge` (spec §7).
- **Textes d'interface :** en français d'abord (`i18n/fr.ts`), avec l'anglais à côté (`en.ts`). On reprend mot pour mot les libellés des maquettes : « À toi », « Rigs », « Noyau OpenRig », « Tranché aujourd'hui », « Revenir dessus », « Ranger dans un projet… », « Seulement Ledge », « Ledge s'en occupe… », « Écrire à Ledge… (@build pour un agent d'un rig) ».
- **Onglets de l'écran Ledge :** `Conversation · Rigs · Mandat`. Sous-onglets de Rigs : `En cours · Specs · Agents`. Sous-onglets de Mandat : `Ce que Ledge tranche · Souvenirs` (spec §8.2).
- **Persistance Ledge :** sous `paths()` (`~/.ledge` ou `$LEDGE_HOME`).
  - `openrig.json` : dernier `Last-Event-ID` par machine, et rigs connus ;
  - `ledge-thread.jsonl` ;
  - `asks.json` ;
  - `mandat.md` ;
  - `memoire/rules.json` et `memoire/decisions.jsonl` ;
  - `rigs/<nom>/` : espaces hors projet.
- **Conventions :** Conventional Commits avec scope de paquet (`feat(ledge): …`, `feat(protocol): …`, `feat(desktop): …`), suivis de la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Un commit par tâche.
- **Tests :**
  - vitest par paquet (`pnpm --filter <pkg> test`) ;
  - playwright pour Desktop (`apps/desktop`, `pnpm e2e`), avec le faux daemon `apps/desktop/e2e/daemon.ts`, et pour l'encoche (`apps/overlay`) ;
  - la racine (`pnpm test`, `pnpm typecheck`) doit rester verte à la fin de chaque lot ;
  - aucun test ne démarre un vrai OpenRig : on utilise le faux de `packages/ledge/test/fakes/openrig.ts` (lot 2).

## Le contrat de protocole (partagé par tous les lots)

Fichier nouveau : `packages/protocol/src/openrig.ts`, exporté par `index.ts`. Le lot 2 le crée entier. Les lots suivants le consomment, et ne l'étendent qu'en le signalant ici. Les noms font foi pour tous les plans de lot.

```ts
// Catégories du mandat (spec §5.3) : les 4 premières, Ledge peut les trancher seul ; les 3 dernières jamais.
export const MandateCategorySchema = z.enum(['git', 'tests', 'context', 'code', 'design', 'architecture', 'critical']);
export const ALWAYS_USER: readonly MandateCategory[] = ['design', 'architecture', 'critical'];

export const OpenRigStateSchema = z.enum(['absent', 'stopped', 'starting', 'running', 'unsupported', 'error', 'unreachable']); // unreachable : machine distante (lot 6)
export const OpenRigStatusSchema = z.object({ machine: z.string(), state: OpenRigStateSchema, version: z.string().optional(),
  human: z.enum(['registered', 'missing', 'failed']).optional(), detail: z.string().optional(),
  install: z.string().optional() }); // commande d'installation quand OpenRig est absent (lot 6)

export const SeatStateSchema = z.enum(['starting', 'trust', 'ready', 'working', 'idle', 'stopped', 'crashed', 'unreachable']);
export const RigSeatSchema = z.object({ ref: z.string(),            // nom de session OpenRig : "dev-build@starter"
  address: z.string(),                                               // "@build"
  name: z.string(), runtime: z.string(), model: z.string().optional(), state: SeatStateSchema,
  contextPct: z.number().min(0).max(100).optional(), sessionId: z.string().optional() }); // id de la session Ledge appariée

export const RigRepoSchema = z.object({ path: z.string(), name: z.string(), branch: z.string().optional(), remote: z.string().optional(),
  modified: z.number().int().min(0), by: z.string().optional(), how: z.enum(['cloned', 'opened', 'created']).optional() });

export const RigLifecycleSchema = z.enum(['launching', 'running', 'partial', 'stopped', 'unreachable']);
export const RigSchema = z.object({ id: z.string(), name: z.string(), machine: z.string(), spec: z.string().optional(),
  cwd: z.string(), projectId: z.string().nullable(), offProject: z.boolean(), branch: z.string().optional(),
  lifecycle: RigLifecycleSchema, kernel: z.boolean(), seats: z.array(RigSeatSchema), repos: z.array(RigRepoSchema) });

export const EscalationQuestionSchema = z.object({ id: z.string(), question: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string(), recommended: z.boolean().optional() })).min(2).max(4) });
export const EscalationStateSchema = z.enum(['pending', 'grace', 'answered', 'closed']);
export const EscalationSchema = z.object({ id: z.string(),          // qitemId OpenRig, ou "ask-<id>" pour `ledge ask`
  source: z.enum(['rig', 'operator', 'ask']), machine: z.string(), rigId: z.string().optional(),
  from: z.string(),                                                  // ref de siège, ou nom de session Ledge pour `ask`
  intent: z.enum(['decision', 'update']), summary: z.string(), detail: z.string().optional(), evidenceRef: z.string().optional(),
  questions: z.array(EscalationQuestionSchema).max(4), replyTo: z.string().optional(), createdAt: z.string().datetime(),
  state: EscalationStateSchema, graceUntil: z.string().datetime().optional(),
  category: MandateCategorySchema.optional(), advice: z.string().optional(),
  answer: z.object({ by: z.enum(['ledge', 'user']), answers: z.record(z.string()), at: z.string().datetime(), rule: z.string().optional(),
    delivery: z.enum(['queued', 'sent']).optional() }).optional() }); // delivery : réponse en attente d'une machine injoignable (lot 6)

export const ExchangeSchema = z.object({ id: z.string(), machine: z.string(), rigId: z.string(), from: z.string(), to: z.string(),
  kind: z.enum(['message', 'task', 'handoff', 'ledge']), text: z.string(), at: z.string().datetime() });

export const LedgeDecisionSchema = z.object({ id: z.string(), escalationId: z.string(), by: z.enum(['ledge', 'user']),
  category: MandateCategorySchema, summary: z.string(), answers: z.record(z.string()), rule: z.string().optional(),
  why: z.string().optional(), at: z.string().datetime(), revisitedBy: z.string().optional() });
export const LedgeRuleSchema = z.object({ id: z.string(), text: z.string(), category: MandateCategorySchema, since: z.string(),
  from: z.string(), appliedCount: z.number().int().min(0), status: z.enum(['active', 'proposed']) });

export const LedgeThreadItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string(), at: z.string().datetime(), text: z.string(), to: z.string().optional() }), // to = "@build"
  z.object({ kind: z.literal('ledge'), id: z.string(), at: z.string().datetime(), text: z.string() }),
  z.object({ kind: z.literal('escalation'), id: z.string(), at: z.string().datetime(), escalationId: z.string() }),
  z.object({ kind: z.literal('decided'), id: z.string(), at: z.string().datetime(), decisionId: z.string() }),
  z.object({ kind: z.literal('exchanges'), id: z.string(), at: z.string().datetime(), machine: z.string(), rigId: z.string(),
    from: z.string().datetime(), to: z.string().datetime(), exchangeIds: z.array(z.string()) }),
  z.object({ kind: z.literal('card'), id: z.string(), at: z.string().datetime(), action: ChatActionSchema }), // carte d'action existante
]);

export const BrainStatusSchema = z.object({ state: z.enum(['off', 'starting', 'on', 'down']), tool: z.string(),
  contextPct: z.number().optional(), sessionId: z.string().optional() });

export const RigLaunchWhereSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), projectId: z.string(), repo: z.string(), branch: z.string(), copy: z.boolean() }),
  z.object({ kind: z.literal('off-project'), name: z.string() }) ]);
export const RigPlanSchema = z.object({ id: z.string(), machine: z.string(), spec: z.string(), goal: z.string(), where: RigLaunchWhereSchema,
  cwd: z.string(), seats: z.array(z.object({ address: z.string(), runtime: z.string(), model: z.string().optional(), autonomy: z.string() })),
  writes: z.array(z.string()), command: z.string(), required: z.boolean() }); // required = plan imposé (vrai dépôt, spec §4.6)
export const RigVerbSchema = z.enum(['up', 'down', 'restore', 'restart', 'stop', 'handover']);
```

Messages **serveur** (ajoutés à `ServerMessageSchema` dans `messages.ts`) :
- `openrig.status { status }` ;
- `rig.snapshot { machine, rigs: Rig[] }`, `rig.updated { rig }`, `rig.removed { machine, rigId }` ;
- `rig.exchange { exchange }` et `rig.exchanges { machine, rigId, items }` (les 200 derniers, sur demande) ;
- `escalation.updated { escalation }`, `escalation.removed { id }` ;
- `ledge.thread.item { item }`, `ledge.thread.history { items, before? }` ;
- `decisions { items: LedgeDecision[] }`, `rules { items: LedgeRule[] }`, `mandate { text, path }` ;
- `brain.status { status }` ;
- `rig.plan { rid, plan }` ;
- `rig.result { rid, ok, code?, reason? }`, avec `code` ∈ `rig_managed | already_answered | openrig_down | unsupported | mandate | unreachable | failed`.

Messages **client** (ajoutés à `ClientMessageSchema`) :
- `rig.act { rid, machine, rigId?, seatRef?, verb }` ;
- `rig.prepare { rid, machine, spec, goal, where }` → `rig.plan` ;
- `rig.launch { rid, planId }` ;
- `rig.adopt { rid, machine, rigId, projectId }` ;
- `rig.send { rid, machine, seatRef, text }` ;
- `rig.exchanges.request { machine, rigId }` ;
- `escalation.answer { rid, id, answers: Record<string,string>, by: 'user' }` ;
- `ledge.say { rid, text, about? }` (`about` : lot 4), `ledge.thread.request { before? }` ;
- `mandate.update { rid, text }`, `rule.set { rid, id, status: 'active'|'rejected' }` ;
- `decision.revisit { rid, id, text? }` ;
- `category.escalate { rid, category }` (« Me le remonter désormais ») ;
- `brain.set { rid, enabled, tool? }`.

`DaemonInfoSchema` gagne `openrig: z.boolean().optional()` (lot 2) et `openrigFleet: z.boolean().optional()` (lot 6), et perd `teams` (lot 1). `SessionSchema` perd `role`, `roleLabel` et `team` (lot 1), et gagne `rig: SessionRig` en option (lot 2), avec `SessionRigSchema = { machine, rigId, rigName, seat, pod, member }` exporté.

Ajustements fixés par le lot 2 :
- **Noms** : `LedgeDecision`/`LedgeRule`, et non `Decision`/`Rule`, qui existent déjà dans `decisions.ts` et `projects.ts`.
- **Appariement** : il passe par `session.event.openrig { sessionName, nodeId? }`, envoyé par le hook. Les sièges ne sont pas lancés par Ledge, donc pas de `session.register`.
- **Exports** : `RIG_RESULT_CODES` et `EXCHANGES_MAX` (200).
- **Routes OpenRig 0.6.14** :
  - sièges : `GET /api/rigs/:rigId/nodes` ;
  - noyau : `GET /api/kernel/status` ;
  - pas d'événement pour `rig send`, d'où un sondage de `GET /api/queue/outbox/list?senderSession=<ref>` toutes les 5 s, pour chaque siège, en ne gardant que les lignes `outbox-…` (les `wake-intent-…` sont des réveils de la queue) (fixé par la fiche de faits, D11) ;
  - version : `/healthz` ne la donne que pour une build estampillée, sinon `rig --version`.
- **Un seul humain par OpenRig** (`rig gateway human add` refuse un second humain distinct). Si un autre humain que `ledge` est déjà inscrit, Ledge le remplace (`--replace` ; l'ancien record est archivé, pas effacé ; flag présent dans `--help` 0.6.14, comportement non sondé ; le refus observé en D3 dit seulement d'ôter d'abord l'humain existant par `rig gateway human remove <entityId>`) et le dit dans le fil. C'est l'application de « définir directement Ledge comme humain » (spec §4.2). `--delivery-class` est obligatoire, et la liaison suit le format `kind:connectorRef:secretsRef:role`. Le 2026-10-30, `~/.openrig/gateway/humans/` n'existait pas.
- **Où va le texte d'une réponse avec `approve`** : `reason` est stocké comme `closureTarget`, et `annotation` ne va qu'à l'audit. Ni l'un ni l'autre n'atteint le siège ; `approve` ferme la ligne et réveille le travail bloqué. La réponse passe donc par une ligne `rig queue create --source ledge@external --destination <siège>`, dont le siège ne voit que le `summary`, puis par `approve`. Un second `approve` rend 409 `qitem_already_terminal`, traduit en `already_answered`. (fixé par la fiche de faits, D5, D6, D7)
- **`/api/mission-control/action`** exige un acteur. Ledge envoie l'en-tête `X-OpenRig-Session: ledge@external` (provenance `transport:v1`, contre `claimed:v1` pour `actorSession` dans le corps) (fixé par la fiche de faits, D8). Il exige aussi un jeton s'il est configuré (`OPENRIG_AUTH_BEARER_TOKEN`, à prévoir sur une EC2). Le repli `resolve` passe par cette route HTTP, puisque `rig queue resolve` exige l'environnement d'un siège.
- **Événements SSE** : sans ligne `event:`. Le type est dans `data.type`, et `id` est le numéro de séquence.
- **Réponse libre** : la clé `text` dans `answers` (`{ text: "…" }`). Une `ask` a `questions: []`.
- **Chemin de l'operator** (`operator.human`) : non vérifié par la sonde, lancée en `--no-kernel` pour éviter un coût LLM. Le lot 2 le traite au mieux et le marque à vérifier lors du parcours réel.
- **Lot 1** ajoute `packages/protocol/src/asks.ts`, les messages `ask.*`, `DaemonInfoSchema.asks`, et retire les parties équipes du protocole téléphone (`PhoneSessionSchema.role`/`team`, `daemon.teams`, `ConfirmPurpose` `define`/`team`). `PHONE_PROTOCOL` reste à 1.
- **Ajouts des lots 4 et 7** (le lot 4 est livré dans `openrig.ts` et `messages.ts`, tâche 1) :
  - `LedgeThreadItem` : `qid?: string` sur les éléments `ledge` et `user` (le tour du coureur ponctuel dont les cartes suivent la bulle), et `pending?: true` sur `ledge` seul (bulle « Ledge lit… » tant que le tour n'est pas fini).
  - Règle d'upsert (commentaire au-dessus de `LedgeThreadItemSchema`) : un `ledge.thread.item` dont l'id existe déjà **remplace** l'ancien chez le client ; c'est ainsi qu'un groupe d'échanges grandit ou qu'une bulle se termine.
  - Les cartes d'action passent par le tour de chat référencé et par `chat.act`. L'élément `card` reste pour le TUI et le mobile.
  - `ledge.say` gagne `about?: string` = id d'escalade (« En parler »).
  - `RIG_RESULT_CODES` gagne `'invalid'` (réponse vide, ou question sans réponse). `AnswerCode` (lot 4, tâche 3) en est un sous-ensemble.
  - Nouveaux exports du lot 4 : `MANDATE_CATEGORY_LABEL: Record<MandateCategory, { fr, en }>`, `EXCHANGE_GROUP_MS` (600 000, 10 min) et `THREAD_PAGE` (50).
  - Lot 7 : `MANDATE_CATEGORY_TAGS`.
  - Ajouts du lot 7 :
    - `SessionSchema.brain?: true` ;
    - `BrainStatusSchema` gagne `enabled: boolean | null` (null = jamais demandé), `restarts?` et `reason?` ;
    - `EscalationSchema.correcting?` ;
    - `brain.cmd { rid, by, key, op, args }` → `brain.result { rid, ok, line, code? }` ;
    - `brain.set` gagne `first?: true`.
  - Le lot 2 expose `replyClaimed(machine, rowId)` ; à défaut, le lot 7 l'ajoute.
- **Ajouts des lots 3 et 5** :
  - `rig.specs.request { requestId, machineId? }` → `rig.specs { requestId, machine, specs, error? }`, avec `RigSpecSeatSchema` et `RigSpecInfoSchema` (lot 3, d'après `/api/specs/library`).
  - `RigSchema.launch?: { planId, goal, lead, startedAt, goalSentAt?, lateNotice? }` (lot 5), persisté dans `rig-launches.json`.
  - `RefusalCodeSchema` gagne `rig_managed`. Le refus de `session.kill`, `close`, `delete`, `archive` ou `model` sur un siège passe par le message `error` existant.
  - `ProjectSchema.rigs: string[]` (défaut `[]`), le problème `duplicate_rig`, et l'export `RIG_NAME`.
  - Le lot 5 étend les modules du lot 2 : `OpenRigHttp.specs()`, `spec(id)` et `call()`, `env` sur `RigExec`, `RigCli.up` et `RigCli.send`, et `Bridge.annotate`. Nouvelle dépendance : `yaml` ^2 dans `packages/ledge`.
- **Routes de cycle de vie réelles** (corrigent la spec §4.5) :
  - `POST /api/down { rigId, snapshot: true }` ;
  - reprendre = `POST /api/rigs/:rigId/restore/:snapshotId`, sur le dernier `GET /api/rigs/:rigId/snapshots` ;
  - les routes de siège exigent `reason` et acceptent `operator` ; la relève prend `source: 'fresh'`.
- **Adresse de Ledge comme expéditeur** (`OPENRIG_SESSION_NAME` de `rig send`, acteur `operator`) : `ledge@external` par défaut. Sans `OPENRIG_SESSION_NAME`, `rig send` part non signé ; l'envoi signé `ledge@external` n'a pas été observé, à vérifier au premier essai du lot 4. (fixé par la fiche de faits, D11)
- **Pré-remplir la fenêtre de lancement par le cerveau** (spec §8.4) : c'est le lot 7. `ledge brain propose rig-launch --goal … --spec … --project …` produit une carte qui ouvre la fenêtre du lot 5 pré-remplie (`rig.prepare` côté daemon).
- **Hors chantier (0.6.14)** : la liste du registre d'OpenRig (pas de route locale ; « Depuis le registre… » reste visible mais désactivé, avec « bientôt »), « Préparer un dépôt », et l'adaptation d'une spec aux fournisseurs disponibles.
- **Idempotence par `rid`** dans chaque daemon, pour `escalation.answer`, `rig.act`, `rig.launch`, `rig.send` et `rig.prepare`. Le lot 6 l'apporte en enveloppant les gestionnaires des lots 4 et 5.

- **Ajout du lot 3** (liste des specs pour l'onglet Rigs, seule addition daemon du lot) :
  - `RigSpecSeatSchema` : `{ address, member, pod, runtime, model?, effort?, profile? }` ;
  - `RigSpecInfoSchema` : `{ id, name, summary?, source: 'builtin' | 'library' | 'registry', path?, seats: RigSpecSeat[] }` (`registry` prévu, jamais listé : pas de réseau) ;
  - client `rig.specs.request { requestId, machineId? }` ; serveur `rig.specs { requestId, machine, specs, error?: 'openrig_down' | 'unsupported' | 'failed' }` ;
  - `OpenRigHttp.specs()` et `spec(id)` existent dès le lot 3 (le lot 5 les réutilise), ainsi que `listSpecs` et `specSeats(yaml)` dans `daemon/openrig/specs.ts` et `Bridge.http()`. Dépendance `yaml` ^2 ajoutée dès le lot 3.

## Correspondance mobile (`PhoneOrchestrator`, plan de Mobi)

| Besoin du téléphone | Contrat ci-dessus |
|---|---|
| rigs (sièges, état, place projet / hors projet, branche) | `rig.snapshot` / `rig.updated` → `Rig` (`projectId`, `offProject`, `branch`, `seats[].state`) |
| décisions remontées (`kind` design / architecture / critical, avis, souvenirs datés, 1 à 4 options) | `escalation.updated` → `Escalation` (`category`, `advice`, `questions[].options[].recommended`). Les souvenirs = `rules` dont la catégorie correspond |
| tranché du jour, rouvrir | `decisions` (filtre `at` = aujourd'hui, `by='ledge'`), `decision.revisit` |
| échanges par rig (200 derniers) | `rig.exchanges.request` → `rig.exchanges` |
| queue par rig | `rig.exchanges` avec `kind='task'\|'handoff'` |
| `answer(id, option)` | `escalation.answer { id, answers: { [questionId]: optionId } }` |
| `propose(goal, spec?, projet\|null)` | `rig.prepare` → `rig.plan`, affiché comme carte dans le fil |
| `launch(qid)` | `rig.launch { planId }` |
| `stop(rig)`, `restartSeat(rig, seat)` | `rig.act { verb: 'down' }`, `rig.act { seatRef, verb: 'restart' }` |
| `holdsSeat(sessionId)` | `session.rig` présent |

Le relais mobile laisse passer ces messages. La clé d'accès est exigée pour `rig.act` et `rig.launch`, les seuls actes ; elle ne l'est pas pour `rig.prepare` (qui prépare un plan sans rien lancer, et que la clé de `launch` lie) ni pour `escalation.answer` (spec §10). Le lot 9 :
- projette ces types en `Phone<Nom>` sans `cwd`, `machine` ni commande ;
- nomme un rig par une clé opaque `hash(machine, rigId)`, que la passerelle retraduit ;
- copie au plus 20 `Exchange` dans l'élément `exchanges` du fil ;
- ajoute `rig` (et `brain`) à `PhoneSessionSchema` si les lots 2 et 7 ne l'ont pas fait.

## Lot 8 : TUI (cadre ; plan détaillé de Tuin : `2026-10-30-ledge-openrig-8-tui.md`)

Le plan de Tuin ajoute deux choses au contrat :
- le message `session.preview.subscribe { id | null, color: true }`, qui renvoie `session.preview.color` au seul abonné, et `DaemonInfo.colorPreview` ;
- la remontée des modèles purs du Desktop (lots 3 et 5 : `rigs/model.ts`, `launch/rigModel.ts`, `isStandalone`) dans `@ledge/ui`, pour que le TUI les partage. Les lots 3 et 5 les écrivent directement dans `packages/ui/src/rigs/` et `packages/ui/src/launch/` ; à défaut, la tâche 1 du lot 8 les déplace.

Maquette : https://claude.ai/artifact/39cmxt4BPuZRSArkHPcowt (sources `.worktrees/tuin-tui-mockup/docs/mockups/ledge-tui-openrig/`). Ce cadre fixe ce que le TUI consomme ; Tuin, ou la session qui exécute, en écrit le plan détaillé quand les lots 2, 4 et 5 sont fusionnés.

- Écrans : 1 Ledge (accueil, « Ledge en tête », trois colonnes ; « À toi » une seule fois, sous la ligne Ledge), 2 Rig, 3 Session. L'écran Équipes est déjà retiré au lot 1. Le noyau a sa pièce, comme un rig.
- Données : le même contrat, par `@ledge/fleet`.
- Volet Terminal : aperçu en direct, en lecture seule, en couleurs. Le daemon capture avec `capture-pane -e` (`packages/ledge/src/tmux.ts:86`), seulement pour un client qui demande `color: true` dans `session.preview.subscribe`. On tape en attachant avec `a`.
- Une session OMP dessine son fil RPC comme un terminal, dans le TUI seulement.
- Tests : vitest (`packages/ledge/test/tui-*.test.ts`) avec le rendu ink-testing-library existant.

## Review Focus

Ces cas ne sont couverts par aucun parcours heureux. Chaque ligne a son test dans le lot qui possède le code.

1. **OpenRig meurt ou redémarre pendant que Ledge le suit.** Le flux SSE est coupé, puis rouvert avec `Last-Event-ID`. Attendu : aucun événement en double dans le fil, aucune escalade perdue, et les rigs passent `unreachable` le temps de la coupure. Test au lot 2, Task « reprise SSE ».
2. **Une escalade répondue deux fois** : par l'utilisateur sur le téléphone et sur Desktop, ou par l'utilisateur et le cerveau. Attendu : une seule réponse part vers OpenRig ; l'autre reçoit `already_answered`, et l'interface le montre. Tests au lot 4, Task « réponse », et au lot 7, Task « grâce ».
3. **Un geste destructif sur un siège de rig depuis une vieille surface** (`session.kill` depuis un TUI non mis à jour). Attendu : refus `rig_managed`, et le siège n'est pas touché. Test au lot 5.
4. **Une machine distante qui disparaît** (EC2 éteinte) pendant qu'une escalade de cette machine est ouverte, ou pendant qu'une réponse y part. Attendu : la réponse reste « en attente d'envoi » et repart à la reconnexion, sans double envoi. Test au lot 6.
5. **Une option d'escalade au contenu critique** (`rm -rf`, `force-push`, `drop table`, `prod`, `secret`) classée `git` ou `code` par le cerveau. Attendu : le garde la reclasse `critical` et la remonte à l'utilisateur. Test au lot 7, Task « garde ».

---

## Vérification de fin de chantier

- [ ] `pnpm -r test && pnpm typecheck` verts sur `origin/main` après le dernier lot.
- [ ] Parcours réel, avec l'accord de l'utilisateur :
  1. lancer un rig `starter` hors projet depuis Desktop ;
  2. voir ses sièges dans Rigs et dans l'Atelier ;
  3. recevoir une escalade dans le fil et dans l'encoche, et y répondre ;
  4. le cerveau tranche une escalade `git` après 60 s ;
  5. « Revenir dessus » ;
  6. « Ranger dans un projet » ;
  7. arrêter le rig.
- [ ] Même parcours sur une EC2 de la liste des machines.
- [ ] `grep -rnE "ledge task|ledge team|roleLabel|LEDGE_ROLE|LEDGE_TEAM|useTeamsApi|TeamCard|TaskCard|phoneTeams" packages apps --include=*.ts --include=*.tsx` ne renvoie rien.

## Lot 10 : les Bureaux (remplacement de l'Atelier)

Demandé par l'utilisateur le 2026-10-31, par la session Otto-3. Spec : `docs/superpowers/specs/2026-10-31-ledge-bureaux-design.md`, non commitée sur `design/approved-logo-mascots`. Elle est à verser dans `ledge-open-rig` avec ses captures `docs/mockups/ledge-bureaux/shots/`. Maquette : https://claude.ai/artifact/4wcv9chArCBAfshBpqRfUM, sources dans `~/Workspace/graphics-resources/web/ledge-bureaux/`.

**Découpage** (spec §5, une étape = une ou deux tâches) :
1. Mascottes : `LogoBot` et `LedgeSketch` deviennent les composants de `packages/ui/src/bots/`.
2. Ressources : les sprites de jour et de nuit et `offices.json` dans `apps/desktop`, ou le générateur déplacé dans `scripts/`. Les anciens sprites sont retirés.
3. Placement pur en TS (`layout`, `buildLayout`, `planRest`, `restDemand`), avec tests : first-fit, espace au milieu, repos sans déplacer de bureau, zones avant salles, nouvelle aile, salle de plus au-delà de la capacité.
4. Monde et présences (`buildWorld`, `route`, `updatePresence`, la marche) dans `usePresence`, alimenté par les sessions et les rigs du daemon.
5. Composants `Floor`, `Room`, `Seat`, `Walker`, `Bubble` et `LedgeOffice`. Ils remplacent `ProjectTable`, `Plants`, `LedgeDesk`, `Unassigned` et `MessageLayer`.
6. Vue : fusion dans `useAtelierView` (résolution d'après la largeur, zoom sous le curseur, plein écran), en gardant les raccourcis et `J`/`K`.
7. Jour et nuit sur `useTheme()`.
8. Données réelles (voir les correspondances ci-dessous).

**Dépendances, et ce que les lots OpenRig doivent lui laisser :**
- **Lot 2** : les rigs, sièges et états (`Rig`, `RigSeat`, `Session.rig`), l'état d'OpenRig par machine (`OpenRigStatus`), le noyau (`Rig.kernel`).
- **Lot 3** : le modèle de scène pur dans `@ledge/ui` (`packages/ui/src/rigs/model.ts` : pièces projet, rig et noyau, `rigPlace`, `isStandalone`), que `usePresence` réutilise. L'UI de l'Atelier du lot 3 (tables de rig) est provisoire : les Bureaux la remplacent.
- **Lot 4** : les échanges entre agents (`Exchange`, `rig.exchange`), qui alimentent les visites, et le fil de Ledge.
- **Lot 6** : un noyau par machine, donc plusieurs baies dans la salle technique.
- **Lot 7** : les demandes de Ledge aux agents (`ledge brain send`, un `Exchange` de `kind: 'ledge'`), qui alimentent les invitations dans le bureau de Ledge.
- **Prérequis hors chantier** : `LogoBot` et `LedgeSketch` (`packages/ui/src/preview/`) sont encore non commités sur `design/approved-logo-mascots`. Il faut les commiter et les verser dans `ledge-open-rig` avant l'étape 1.

**Correspondances** (spec §4, complétées par le contrat) :
- **Bureau** : un `Project` = un bureau de projet ; un `Rig` sans `kernel` = un bureau de rig ; les sessions sans projet ni rig = l'open-space.
- **Noyaux** [P, réponse proposée à la question ouverte « noyaux »] :
  - un noyau = le rig `kernel: true` d'une machine, donc une baie par machine où OpenRig tourne ;
  - son état vient de `OpenRigStatus.state` : `running` donne des voyants verts qui clignotent ; `stopped`, `error` et `unsupported` donnent du rouge ; `starting` donne de l'orange ; `unreachable` donne une baie éteinte ;
  - le nom au-dessus de la baie est celui de la machine.
- **Visites** : un `Exchange` de `kind` `message`, `task` ou `handoff` entre deux sièges ou sessions.
- **Invitations chez Ledge** : un `Exchange` de `kind: 'ledge'` (Ledge écrit à un siège), ou une escalade tranchée par Ledge dont la réponse part vers le siège.

**Avancement des bulles** (décision de l'utilisateur, 2026-10-31) : les bulles montrent **les réflexions des agents**. Ledge ne les capte pas encore. L'étape 8 doit donc ajouter une source côté daemon :
- **Claude** : les blocs `thinking` de la transcription JSONL, déjà lue par `daemon/transcript.ts`.
- **Codex** : les résumés de raisonnement de son journal.
- **OMP** : les événements de réflexion de son RPC.
- **Message** : un extrait court (une phrase, environ 80 caractères) est diffusé au plus toutes les 10 s par session, dans un message `session.thought { id, text, at }` [P pour le nom, le débit et la longueur].
- **Repli** : quand un outil ne donne pas ses réflexions (bloc vide ou caviardé), on prend le dernier message de l'agent.
- **Limite** : l'extrait n'est jamais écrit sur disque ni relayé au téléphone [P].
