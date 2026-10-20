# Ledge mobile, lot 4 : ce que le téléphone peut lire et faire — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un appareil lié au lot 3 lit les sessions, leurs fils et leur terminal, décide une demande, répond à une question ou à l'agent, et interrompt une session. Le daemon n'accepte du téléphone que ce qu'une liste blanche autorise et ne lui envoie qu'une projection, elle aussi en liste blanche.

**Architecture:**
- **Protocole, `packages/protocol/src/phone.ts` :** les messages téléphone ↔ PC ont leurs propres schémas (`PhoneClientMessageSchema`, `PhoneServerMessageSchema`). La liste blanche est le schéma lui-même : un type qui n'y figure pas est refusé, et un champ qui n'y figure pas n'est jamais envoyé.
- **Daemon, `packages/ledge/src/mobile/` :**
  - `gateway.ts` est branché sur `MobileService.onMessage`. Il lit le JSON reçu et le valide. Il répond lui-même aux lectures. Les écritures passent par `operations.ts`, puis par le même `handle` que les fronts locaux ;
  - `project.ts` projette les sessions, les demandes et le fil pour le téléphone ;
  - `risk.ts` classe chaque demande en risque `low` ou `high` ;
  - `operations.ts` rend les écritures idempotentes ;
  - `outbox.ts` tient la file sortante sous la limite de débit du relais ;
  - `pad.ts` bourre chaque message jusqu'à un palier de taille.
- **`daemon/server.ts` :** `handle(ws, msg)` devient `handle(msg, reply)`. Chaque refus porte un `code`. Chaque message diffusé aux fronts locaux passe aussi par `gateway.forward`, qui ne laisse passer que ce qu'il connaît.
- **Reports du lot 3 :** les erreurs `mobile.*` n'ont plus d'`id`, et le desktop les affiche. Un service mobile qui n'a pas démarré se montre « indisponible », et non plus « daemon trop ancien ».

**Tech Stack:** TypeScript strict (NodeNext), Node ≥ 22, zod 3, ws 8, `@ledge/seal`, vitest 4. Desktop : React 19.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md`. Autres références :
- feuille de route : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md` ;
- lot 3 : `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-lot3-daemon-link.md` ;
- l'archive `883656f` (`origin/ledge-mobile`), à lire avec `git show 883656f:<chemin>`. Ses fichiers se portent, ils ne se recopient pas : leur modèle de décision (`pendingId`, `pendingVersion`) est remplacé par `pendingKey` et `expect`.

## Global Constraints

- **Droits :** « Un appareil approuvé a tous les droits : lire, approuver, écrire. » Il n'a cependant que les commandes de la liste blanche (Task 1). Jusqu'au lot 6 (WebAuthn), une demande `high` ne s'accepte pas depuis le téléphone (`confirm_required`). La refuser reste toujours possible.
- **Fonctions :** « boîte de réception, détail et décision, questions (dont réponse libre), fil par agent, terminal en lecture avec interruption, envoi de message ». Ici, « envoi de message » est `session.reply` : un texte tapé dans la ligne de saisie de l'agent.
- **Historique :** « L'historique des conversations reste servi depuis `~/.ledge/history` […] ; pas de second magasin dans ce dossier. » Les marques de lecture vivent en mémoire.
- **Hors ligne :** « File d'attente côté serveur quand le PC est hors ligne » est un non-objectif. Le daemon ne garde rien pour un appareil déconnecté : à sa reconnexion, l'appareil redemande un snapshot.
- **Logs :** le daemon ne logue jamais le contenu d'un message du téléphone ou vers lui. Il peut loguer un type, une taille en octets, un code, l'empreinte d'un appareil.
- **Fermé par défaut :** en entrée, un message que `PhoneClientMessageSchema` refuse ne déclenche rien et reçoit `error { code: 'invalid' }`. En sortie, `forward` ignore tout type qu'il ne connaît pas, et chaque projection construit ses objets champ par champ, sans spread d'un objet du daemon.
- **Limites, exportées par `phone.ts` :**
  - `PAD_TIERS = [1_024, 4_096, 16_384, 65_536, 262_144, 655_360]` et `PLAIN_MAX = 655_360`, en octets UTF-8 du JSON ;
  - `THREAD_ITEMS_MAX = 200`, `THREAD_BUDGET = 524_288`, `THREAD_TEXT_MAX = 8_192`, `TOOL_TEXT_MAX = 2_048` ;
  - `PENDING_BODY_MAX = 65_536` ;
  - le texte d'une réponse va de 1 à `MESSAGE_MAX` (20 000) caractères.
- **Relais :** sa limite par socket est de 300 trames ou 8 MiB par 10 s (`apps/relay/src/hub.ts:35`), et `SEALED_MAX = 1_048_576` (`packages/protocol/src/relay.ts:5`). La file sortante s'en tient à 200 trames et 4 MiB par 10 s, pour tous les appareils ensemble.
- **Imports :** relatifs en `.js`. Aucune nouvelle dépendance.
- **Interface :** les nouveaux textes du desktop, en français et en anglais, vont dans `apps/desktop/src/i18n/`.

## Reporté

| Origine | Point | Tâche |
| --- | --- | --- |
| feuille de route | bourrer les messages scellés par paliers de taille, avant de figer le format | Task 5 (`pad.ts`), et la décision est inscrite dans la feuille de route par Task 8 |
| revue du lot 3 | l'erreur serveur d'un `mobile.*` porte un `id` que la flotte prend pour un id de session | Task 2 |
| revue du lot 3 | le desktop n'affiche pas les refus `mobile.*` | Task 3 |
| revue du lot 3 | « daemon trop ancien » s'affiche quand le service mobile n'a pas démarré | Task 3 (`unavailable`) |

## Review Focus

1. **La demande change entre l'affichage sur le téléphone et la décision**, par exemple une nouvelle demande sur la même session. Attendu : `operation.result { status: 'rejected', reason: 'stale' }`, et rien n'est tapé dans le terminal (Task 8).
2. **Le relais coupe juste après une décision appliquée, et le téléphone renvoie la même opération.** Attendu : le même `applied`, sans seconde frappe. Le même `op` avec un autre contenu, ou venant d'un autre appareil, reçoit `conflict` (Tasks 6 et 8).
3. **Une rafale :** 100 sessions qui changent chaque seconde, avec le terminal d'une session ouvert. Attendu : jamais plus de 200 trames ni de 4 MiB par 10 s, donc jamais de fermeture 4008. C'est le dernier état de chaque session qui arrive (Task 5).
4. **Le téléphone envoie un type réservé aux fronts locaux** (`session.message`, `session.launch`, `chat.ask`, `mobile.device.revoke`, `update.daemon`), ou un JSON invalide. Attendu : `error { code: 'invalid' }`, rien n'est fait, et le log ne contient ni le texte ni les champs (Task 8).
5. **Une demande Bash dont la commande ne se lit pas** (format de pane inconnu, texte vide). Attendu : `high` / `unknown`, donc l'acceptation du téléphone est refusée (`confirm_required`) mais le refus passe (Tasks 4 et 8).

---

### Task 1: le protocole du téléphone

**Files:**
- Create: `packages/protocol/src/phone.ts` (exporté par `index.ts`)
- Modify: `packages/protocol/src/messages.ts` (codes de refus), `packages/protocol/src/mobile.ts` (`unavailable`)
- Test: `packages/protocol/test/phone.test.ts`, `packages/protocol/test/mobile.test.ts`

**Interfaces:**
- Produces, dans `messages.ts` :
  - `RefusalCodeSchema = z.enum(['stale', 'read_only', 'no_prompt', 'not_taken', 'busy', 'unknown_session', 'nothing_to_decide', 'not_offered', 'free_text', 'note_not_typed', 'unavailable', 'invalid'])` et le type `RefusalCode`. Le champ `code` de `error` reste `z.string().optional()` : un front plus ancien l'ignore.
- Produces, dans `mobile.ts` : `MobileLinkStateSchema` gagne `{ state: 'unavailable', error: string }`, où `error` fait au plus 200 caractères.
- Produces, dans `phone.ts` :
  - les limites des Global Constraints, et `PHONE_PROTOCOL = 1` ;
  - `RiskSchema = z.enum(['low', 'high'])`, plus `RiskReasonSchema`, dont la liste est celle de l'archive (`git show 883656f:packages/protocol/src/operations.ts`) ;
  - `OperationIdSchema = z.string().uuid()` et `OperationStatusSchema = z.enum(['received', 'applied', 'rejected', 'failed'])` ;
  - `OperationReasonSchema = z.enum([...RefusalCodeSchema.options, 'untypable', 'confirm_required', 'conflict'])` ;
  - `UNTYPABLE`, `CapabilitiesSchema { freeTextAnswer: boolean }` et `CapabilitiesByToolSchema`, repris de `883656f:packages/protocol/src/capabilities.ts`, avec la vérification de compilation `Same<…>` ;
  - `PhonePendingSchema = PendingSchema.extend({ key: z.string().max(64), risk: RiskSchema, riskReason: RiskReasonSchema, cut: z.literal(true).optional() })` ;
  - `PhoneSessionSchema = SessionSchema.pick({ id, name, tool, project, title, topic, repo, branch, worktree, state, helpers, lastReply, startedAt, lastActivityAt }).extend({ pending: PhonePendingSchema.optional(), unread: z.boolean() })`. Sont donc exclus, entre autres : `cwd`, `repoPath`, `workdir`, `tmuxSession`, `lastMessage`, `machineId`.
- `PhoneClientMessageSchema`, en union discriminée sur `type`. `id` est un id de session de 1 à 100 caractères, et `op` un `OperationIdSchema` :
  - `snapshot.request {}` ;
  - `session.thread { id }` ;
  - `session.watch { id: string | null }` : la session dont le téléphone affiche le terminal ;
  - `session.read { id, at }`, où `at` est une date ISO ;
  - `session.decide { op, id, decision: DecisionSchema, note?, expect }`. `note` suit la règle de `messages.ts` (trim, 1 à `NOTE_MAX`). `expect` est **obligatoire**, `key` compris : `PendingSchema.pick({ kind, text }).extend({ key: z.string().min(1).max(64) })` ;
  - `session.reply { op, id, text }`, où `text` va de 1 à `MESSAGE_MAX` ;
  - `session.interrupt { op, id }`.
- `PhoneServerMessageSchema` :
  - `snapshot { protocol: 1, sessions: PhoneSession[], capabilities: CapabilitiesByTool, daemon: { version } }` ;
  - `session.updated { session: PhoneSession }`, `session.removed { id }`, `session.preview { id, lines }` ;
  - `session.thread { id, items: ThreadItem[], cut: string[], more: boolean }`. `cut` liste les id des éléments raccourcis, et `more` dit que des éléments plus anciens ont été laissés ;
  - `session.thread.item { id, item: ThreadItem, cut?: true }` ;
  - `operation.result { op, status, reason? }` ;
  - `error { code: z.enum(['invalid', 'unknown_session', 'too_large']), request?: string }`, où `request` fait au plus 40 caractères. L'erreur ne porte jamais de texte libre.

- [ ] **Step 1: Write the failing tests**
  - Chacune des sept variantes client valides passe.
  - `session.decide` sans `expect`, ou dont `expect` n'a pas de `key`, lève.
  - `session.decide` avec `op: 'x'` lève.
  - `session.reply` de 20 001 caractères lève.
  - `{ type: 'session.message', … }`, `{ type: 'chat.ask', … }`, `{ type: 'mobile.signout' }` et `{ type: 'session.launch', … }` lèvent tous.
  - Une session complète du daemon passe par `PhoneSessionSchema.parse({ ...s, unread: false })` sans `cwd` ni `tmuxSession` dans le résultat. Cela vérifie que `pick` retire les champs.
  - `UNTYPABLE` détecte `\n`, `\x1b`, `‮`, `​`, et laisse passer `é`, un emoji ZWJ et `‍`.
  - `mobile.test.ts` : `{ state: 'unavailable', error: 'x' }` passe, et une `error` de 201 caractères lève.
- [ ] **Step 2:** `pnpm --filter @ledge/protocol test`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `pnpm --filter @ledge/protocol test` et `pnpm -r typecheck`. Attendu : PASS. Si `unavailable` casse un `switch` exhaustif du desktop, c'est attendu : la branche vient en Task 3. Mettre en attendant un `case 'unavailable':` minimal, qui reprend la branche `off`.
- [ ] **Step 5:** Commit `feat(protocol): the phone's own messages, refusal codes, and an unavailable mobile link`.

### Task 2: `handle` prend une fonction de réponse, et chaque refus porte un code

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts`, `packages/ledge/src/adapters/types.ts` (si `STALE` y vit)
- Test: `packages/ledge/test/server.test.ts`

**Interfaces:**
- Consumes: `RefusalCode` (Task 1).
- Produces, internes à `server.ts` et utilisés par Task 8 :
  - `type Reply = (m: ServerMessage) => void` ;
  - `handle(msg: ClientMessage, reply: Reply): Promise<void>`. La promesse se règle une fois l'action appliquée ou refusée. Pour `session.decide`, `session.reply` et `session.interrupt`, il n'y a donc plus de frappe lancée sans attente ;
  - `class Refusal extends Error { constructor(message: string, readonly code: RefusalCode) }`. Elle remplace `new Error(STALE)`, `new Error(NOT_TAKEN)`, `new Error(NO_PROMPT)`, `'a decision is already in progress'` (`busy`), `unknown session` (`unknown_session`), etc. `NoteNotTyped` devient une `Refusal` de code `note_not_typed`. **Les textes ne changent pas** : le desktop les affiche tels quels ;
  - `replyTo` rend `Refusal | null` au lieu de `string | null` ;
  - le `catch` de `ws.on('message')` envoie `{ type: 'error', message, request: msg.type, code }`. Le `code` est `e.code` pour une `Refusal`, `invalid` pour un message que le schéma refuse, et il est absent sinon. **L'`id` n'est mis que pour un type `session.*`.** Un `mobile.*` n'en porte plus.

- [ ] **Step 1: Write the failing tests** (`server.test.ts`, sur le harnais existant)
  - `session.decide` dont `expect.key` ne correspond pas ⇒ `error { code: 'stale', request: 'session.decide', id: <session> }`, et le message reste le texte actuel.
  - `session.reply` sur une session `hook_only` ⇒ `code: 'read_only'`.
  - `session.decide` sur une session sans demande ⇒ `code: 'nothing_to_decide'`.
  - `session.decide` vers un id inconnu ⇒ `code: 'unknown_session'`.
  - Une note que le terminal n'a pas prise ⇒ `code: 'note_not_typed'`. Le test existant de `NOTE_NOT_TYPED` garde son assertion sur le texte et ajoute le code.
  - `mobile.pairing.approve { id: 'p1' }` pour une liaison inconnue ⇒ l'erreur n'a pas de propriété `id`, et `request === 'mobile.pairing.approve'`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test server`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter. `handle` ne lit plus `ws`. `sendSnapshot`, `chat.*` et ce qui répond à un seul client reçoivent `reply`. Les ensembles `localClients` et `remoteClients` ne changent pas.
- [ ] **Step 4:** `pnpm --filter @paradow/ledge test` (hors les 2 tests tmux connus) et `pnpm -r typecheck`. Attendu : PASS.
- [ ] **Step 5:** Commit `refactor(daemon): handle answers through a reply function; every refusal carries a code`.

### Task 3: un service mobile absent se dit « indisponible », et le desktop montre les refus `mobile.*`

**Files:**
- Modify: `packages/ledge/src/daemon/index.ts`, `packages/ledge/src/daemon/server.ts`, `packages/fleet/src/fleet.ts`, `apps/desktop/src/settings/Mobile.tsx`, `apps/desktop/src/settings/PairingDialog.tsx`, `apps/desktop/src/i18n/*`
- Test: `packages/ledge/test/server.test.ts`, `packages/fleet/test/mobile-source.test.ts`, `apps/desktop/test/settings-mobile.test.tsx`, `apps/desktop/test/pairing-dialog.test.tsx`

**Interfaces:**
- Consumes: `RefusalCode` et `MobileLinkState` `unavailable` (Task 1), le `catch` de Task 2.
- Produces :
  - `startServer({ …, mobileUnavailable?: string })`. Quand `mobile` est absent et `mobileUnavailable` présent, le snapshot porte `daemon.mobile` avec un `MobileState` complet : `link: { state: 'unavailable', error }`, et le reste à l'état « désactivé ». Ce même état part dans le message `mobile`. Une commande `mobile.*` reçoit alors `error { code: 'unavailable' }` ;
  - `daemon/index.ts` passe `mobileUnavailable: (e as Error).message.slice(0, 200)` quand `createMobileService()` lève ;
  - fleet : la dernière erreur `mobile.*` de chaque machine est gardée dans l'état que lit la section Accès mobile, sous la forme `mobileError?: { request: string; message: string; code?: string }`. Elle s'efface au `sendMobile` suivant et à chaque nouveau message `mobile`. Une erreur sans `id` n'est plus rapportée à une session ;
  - desktop :
    - `unavailable` affiche « L'accès mobile n'a pas démarré sur ce PC : <error> » (en : "Mobile access did not start on this PC: <error>") au lieu de « daemon trop ancien » ;
    - `mobileError` s'affiche sous l'en-tête de la section, dans un `role="alert"` ;
    - `PairingDialog` applique la même règle que `Mobile.tsx:48`.

- [ ] **Step 1: Write the failing tests**
  - server : `startServer({ mobileUnavailable: 'EACCES' })` ⇒ snapshot `daemon.mobile.link` vaut `{ state: 'unavailable', error: 'EACCES' }`, et `mobile.signin` ⇒ `error { code: 'unavailable' }`, sans `id`.
  - fleet : une `error { request: 'mobile.pairing.approve', message: 'gone' }` ⇒ `mobileError` est rempli, et aucune session ne reçoit d'erreur. `sendMobile` sur l'état `unavailable` ne lève pas `DaemonOutdated`.
  - desktop : l'état `unavailable` ⇒ le texte « n'a pas démarré » s'affiche et « trop ancien » est absent. Un `mobileError` ⇒ `role="alert"` contient `gone`. Un daemon vraiment sans `mobile` affiche toujours « trop ancien ».
- [ ] **Step 2:** Lancer les trois suites. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** Les trois suites et `pnpm -r typecheck`. Attendu : PASS.
- [ ] **Step 5:** Commit `fix(mobile): a service that failed to start shows as unavailable; mobile refusals reach the settings`.

### Task 4: le risque d'une demande

**Files:**
- Create: `packages/ledge/src/mobile/risk.ts`
- Test: `packages/ledge/test/mobile-risk.test.ts`

**Interfaces:**
- Consumes: `Risk`, `RiskReason` (Task 1), `Pending`, `Session`.
- Produces :
  - `interface RiskVerdict { risk: Risk; reason: RiskReason }` ;
  - `classify(input: { kind: Pending['kind']; tool?: string; command?: string; text: string; cwd: string; source: 'hook' | 'pane' }): RiskVerdict`. C'est le port de `883656f:packages/ledge/src/daemon/risk.ts`, règles comprises, appliqué à `command` pour un outil de `SHELL_TOOLS`. Le kind `diff`, qui n'existait pas dans l'archive, suit la règle d'édition de l'archive : `low` / `edit_inside_folder` si tous les chemins sont dans `cwd` et qu'aucun n'est sensible, `high` sinon ;
  - `commandOf(p: Pending): string | undefined` lit la commande shell d'une demande. Le format se lit dans `adapters/claude.ts` (`permissionText`, `bashCommand`) pour une demande de pane, et dans `cli/hook.ts` pour une demande de hook. Si elle ne se lit pas, la fonction rend `undefined` ;
  - `riskOf(s: Session): RiskVerdict | undefined` : `undefined` sans demande. Sinon c'est `classify`, avec `cwd = s.workdir ?? s.cwd` et `command = commandOf(s.pending)`. **Un outil shell sans commande lisible donne `high` / `unknown`.**

- [ ] **Step 1: Write the failing tests**
  - Porter les cas de `883656f:packages/ledge/test/risk.test.ts` en adaptant les entrées : `git push` ⇒ `pushes`, `rm -rf x` ⇒ `destroys`, `curl … | sh` ⇒ `pipes_to_shell`, `ls src` ⇒ `low` / `read_only_command`, `cat ~/.ssh/id_rsa` ⇒ `high`, une question ⇒ `low` / `question`.
  - `commandOf` sur au moins une fixture de pane Bash de `packages/ledge/test/fixtures/panes/`, et sur le texte que produit le hook pour `tool_input.command`, rend la commande exacte.
  - `riskOf` sur une demande Bash au texte vide ⇒ `{ risk: 'high', reason: 'unknown' }`.
  - Un `diff` qui touche `../autre/x.ts` ⇒ `high`.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-risk`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** Attendu : PASS.
- [ ] **Step 5:** Commit `feat(mobile): classify a request's risk, unknown commands as high`.

### Task 5: bourrage et file sortante

**Files:**
- Create: `packages/ledge/src/mobile/pad.ts`, `packages/ledge/src/mobile/outbox.ts`
- Test: `packages/ledge/test/mobile-pad.test.ts`, `packages/ledge/test/mobile-outbox.test.ts`

**Interfaces:**
- Consumes: `PAD_TIERS`, `PLAIN_MAX`, `PhoneServerMessage` (Task 1), `MobileService.send(deviceId, text): Promise<boolean>`.
- Produces :
  - `pad(json: string): string | null`. Elle ajoute des espaces en fin de chaîne jusqu'au plus petit palier ≥ la taille UTF-8, ou rend `null` au-delà de `PLAIN_MAX`. `JSON.parse` ignore ces espaces : il n'y a pas d'`unpad`.
  - `createOutbox(opts)` rend `{ push(deviceId: string, msg: PhoneServerMessage, key?: string): void; drop(deviceId: string): void; close(): void }`. Les options :
    - `send(deviceId, text): Promise<boolean>` ;
    - `onGone(deviceId)` : appelé quand `send` rend `false`. La file de l'appareil est alors vidée ;
    - `onOverflow(deviceId)` : appelé quand la file d'un appareil dépasse 300 messages ou 8 MiB. Elle est vidée d'abord, et la passerelle y répond par un snapshot neuf ;
    - `log(line)` ;
    - `now?: () => number` et `frames = 200`, `bytes = 4 * 1_048_576`, `windowMs = 10_000`, pour les tests.
  - Coût d'un message pour le budget : `Math.ceil(padded.length * 4 / 3) + 256`, qui couvre le base64 et l'enveloppe.
  - Fenêtre glissante commune à tous les appareils, servis à tour de rôle. Un `push` avec une `key` déjà en file remplace ce message à sa place. Les clés sont `session.updated:<id>`, `session.preview:<id>` et `snapshot`.
  - Un message que `pad` refuse n'est pas envoyé : le log dit `phone message too large: <type> <bytes> bytes`, et l'appareil reçoit `error { code: 'too_large', request: <type> }`.

- [ ] **Step 1: Write the failing tests**
  - pad :
    - `pad('{}')` fait 1 024 octets et `JSON.parse` le relit ;
    - un JSON de 1 025 octets passe à 4 096 ;
    - un texte de 1 000 `é` (2 000 octets) passe à 4 096 ;
    - 655 361 octets ⇒ `null` ;
    - un JSON de `PLAIN_MAX` scellé par `@ledge/seal` donne une trame `msg` que `SealedFrameSchema` du relais accepte sous `SEALED_MAX`.
  - outbox, horloge factice :
    - 250 `push` distincts ⇒ 200 envoyés tout de suite, les 50 autres après 10 s ;
    - pendant un blocage, 50 `session.updated:s1` successifs ⇒ un seul envoi, celui du dernier contenu ;
    - deux appareils servis à tour de rôle ;
    - 301 messages en file ⇒ `onOverflow` une seule fois, et la file vidée ;
    - `send` rend `false` ⇒ `onGone`, et plus rien n'est envoyé à cet appareil ;
    - un message de 700 000 octets ⇒ non envoyé, et la ligne de log ne contient pas son texte.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-pad mobile-outbox`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** Attendu : PASS.
- [ ] **Step 5:** Commit `feat(mobile): pad phone messages to size tiers; rate-bounded outbox with coalescing`.

### Task 6: les opérations idempotentes

**Files:**
- Create: `packages/ledge/src/mobile/operations.ts`
- Test: `packages/ledge/test/mobile-operations.test.ts`

**Interfaces:**
- Consumes: `OperationStatus`, `OperationReason`, `PhoneClientMessage` (Task 1).
- Produces. C'est le port de `883656f:packages/ledge/src/daemon/operations.ts` et de son test :
  - `type PhoneOperation = Extract<PhoneClientMessage, { op: string }>` ;
  - `fingerprint(m: PhoneOperation): string` vaut `JSON.stringify([type, id, decision ?? null, note ?? null, text ?? null, expect?.key ?? null])` ;
  - `class OperationRegistry`, construit avec `{ now?: () => number; ttlMs = 86_400_000; max = 500 }` :
    - `begin(owner: string, op: string, fp: string): { kind: 'fresh' | 'replay'; record: OperationRecord } | { kind: 'conflict' }`. Le même `op` avec une autre empreinte, ou venant d'un autre `owner`, donne `conflict` ;
    - `finish(op: string, status: OperationStatus, reason?: OperationReason): void` ;
    - `get(op: string): OperationRecord | undefined`.
  - `interface OperationRecord { op: string; owner: string; fingerprint: string; status: OperationStatus; reason?: OperationReason; at: number }`. Un record vit en `received` jusqu'à `finish`.
  - Les records expirent au-delà de 24 h. Au-delà de 500, le plus ancien record terminé part en premier.

- [ ] **Step 1: Write the failing tests**
  - `begin` deux fois avec la même empreinte ⇒ `fresh`, puis `replay` avec `status: 'received'` ; après `finish(op, 'applied')`, `replay` rend `applied`.
  - Une autre empreinte ⇒ `conflict`. Un autre owner ⇒ `conflict`.
  - Après 24 h et 1 ms ⇒ `fresh` de nouveau.
  - 501 opérations terminées ⇒ la première est oubliée. 500 opérations en `received` plus une ⇒ aucune n'est oubliée, et c'est la nouvelle qui reçoit `conflict`, car la registry est pleine.
  - Même décision, `expect.key` différente ⇒ empreintes différentes.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-operations`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** Attendu : PASS.
- [ ] **Step 5:** Commit `feat(mobile): idempotent phone operations keyed by a uuid and the request's key`.

### Task 7: la projection pour le téléphone

**Files:**
- Create: `packages/ledge/src/mobile/project.ts`
- Test: `packages/ledge/test/mobile-project.test.ts`

**Interfaces:**
- Consumes: `riskOf` (Task 4), `pendingKey`, `adapterFor(tool).freeText`, les schémas et limites de Task 1.
- Produces :
  - `toPhoneSession(s: Session, readAt: string): PhoneSession`. Elle construit l'objet champ par champ :
    - `pending` = les champs de `PendingSchema`, plus `key: pendingKey(s.pending)`, `risk` et `riskReason` (`riskOf`). `body` est coupé à `PENDING_BODY_MAX`, avec `cut: true` ;
    - `unread = !!s.lastReply && s.lastReply.at > readAt`.
  - `toPhoneItem(item: ThreadItem): { item: ThreadItem; cut: boolean }` :
    - les champs texte sont coupés à `THREAD_TEXT_MAX` ;
    - pour un `tool`, `input`, `output` et `error` sont coupés à `TOOL_TEXT_MAX`, et `files` garde `path`, `from` et `change`, sans `diff`.
  - `toPhoneThread(items: ThreadItem[]): { items: ThreadItem[]; cut: string[]; more: boolean }` : les plus récents d'abord, au plus `THREAD_ITEMS_MAX` éléments et `THREAD_BUDGET` octets de JSON, rendus dans l'ordre chronologique.
  - `capabilities(): CapabilitiesByTool` : `freeTextAnswer = !!adapterFor(tool).freeText` pour chaque outil.

- [ ] **Step 1: Write the failing tests**
  - Une session complète, avec un champ en plus `secret: 'x'` passé par cast ⇒ les clés du résultat sont incluses dans la liste blanche de Task 1. `cwd`, `tmuxSession` et `secret` sont absents. `PhoneSessionSchema.parse` passe.
  - `pending.key === pendingKey(s.pending)`, et une demande Bash `git push` ⇒ `risk: 'high'`, `riskReason: 'pushes'`.
  - Un `body` de 100 000 caractères ⇒ 65 536 caractères et `cut: true`.
  - `unread` : `lastReply.at` après `readAt` ⇒ `true` ; avant ⇒ `false` ; sans `lastReply` ⇒ `false`.
  - 1 000 éléments ⇒ au plus 200, `more: true`, ordre chronologique, JSON ≤ `THREAD_BUDGET`.
  - Un `tool` avec 10 000 caractères d'`output` et un `diff` ⇒ `output` coupé à 2 048, `diff` absent, et son id dans `cut`.
  - `capabilities()` passe `CapabilitiesByToolSchema`, et `claude.freeTextAnswer` reflète l'adapter.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-project`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** Attendu : PASS.
- [ ] **Step 5:** Commit `feat(mobile): whitelist projection of sessions, requests and threads for the phone`.

### Task 8: la passerelle du téléphone

**Files:**
- Create: `packages/ledge/src/mobile/gateway.ts`
- Modify: `packages/ledge/src/daemon/server.ts` (création et `forward`), `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md` (décision sur le bourrage)
- Test: `packages/ledge/test/mobile-gateway.test.ts` (un faux `MobileService`), `packages/ledge/test/mobile-phone-e2e.test.ts` (`startTestRelay`, `fakeDevice`, `createMobileService` et `startServer` avec un faux tmux, comme dans `server.test.ts`)

**Interfaces:**
- Consumes: tout ce qui précède, et `handle(msg, reply)` (Task 2).
- Produces :
  - `createPhoneGateway(deps)` rend `{ forward(m: ServerMessage): void; stop(): void }`. Ses dépendances :
    - `mobile: Pick<MobileService, 'send' | 'onMessage' | 'state' | 'onChange'>` ;
    - `sessions: () => Session[]` et `session: (id) => Session | undefined` ;
    - `thread: (id) => ThreadItem[] | undefined` ;
    - `preview: (id) => string[] | undefined` ;
    - `dispatch: (msg: ClientMessage, reply: (m: ServerMessage) => void) => Promise<void>` ;
    - `version: string`, `log`, `now?: () => string` et `outbox?` (les options de Task 5).
  - `startServer` crée la passerelle quand `mobile` est fourni. Chaque message envoyé à `localClients` passe aussi par `gateway.forward`. `close()` appelle `stop()`.
- **Entrée** (un texte d'un appareil approuvé) :
  1. `JSON.parse`, puis `PhoneClientMessageSchema.safeParse`. En cas d'échec : `error { code: 'invalid', request }`, où `request` est `type` s'il s'agit d'une chaîne de 40 caractères au plus. Le log ne dit que `phone message refused: <request|?>`.
  2. Lectures :
     - `snapshot.request` abonne l'appareil, puis met en file `snapshot` (clé `snapshot`) ;
     - `session.thread` répond `toPhoneThread`, ou `unknown_session` ;
     - `session.watch` fixe la session regardée et envoie tout de suite son `preview` ;
     - `session.read` garde, par appareil et par session, la date la plus récente, puis renvoie `session.updated` à cet appareil seulement.
  3. Écritures. On calcule d'abord `registry.begin(deviceId, op, fingerprint(msg))` :
     - `conflict` ⇒ `rejected` / `conflict` ;
     - `replay` ⇒ le statut gardé ;
     - `fresh` ⇒ `received` tout de suite, puis les contrôles propres au téléphone, dans cet ordre :
       - session inconnue ⇒ `unknown_session` ;
       - `decide` dont `expect.key` n'est pas la clé courante ⇒ `stale` ;
       - `decide` `accept` ou `always` sur une demande `high` ⇒ `confirm_required` ;
       - `reply` dont `UNTYPABLE` trouve un caractère ⇒ `untypable`.
     - Ensuite, `dispatch` du message local équivalent :
       - `{ type: 'session.decide', id, decision, note, expect }` ;
       - `{ type: 'session.reply', id, text }` ;
       - `{ type: 'session.interrupt', id }`.
     - Le résultat : une `error` reçue par `reply` pour ce `request` donne `rejected` avec son `code`, sauf `not_taken` qui donne `failed`. Un code inconnu donne `rejected` / `invalid`. Sans erreur, c'est `applied`. Une exception donne `failed`, et le log ne nomme que le type et `e.name`.
     - Puis `registry.finish` et `operation.result`, à l'appareil demandeur seulement.
- **Sortie** (`forward`), avec un `switch` dont le `default` ignore :
  - `session.updated` ⇒ `toPhoneSession` par appareil abonné, avec ses marques de lecture. Sans marque, la date de référence est le démarrage de la passerelle. Clé `session.updated:<id>` ;
  - `session.removed` ⇒ à tous les abonnés ;
  - `session.preview` et `session.thread.item` ⇒ aux appareils qui regardent cette session (clé `session.preview:<id>` pour le premier).
- **Abonnés :**
  - un appareil est retiré sur `onGone`, et quand il disparaît de `mobile.state().devices` (`onChange`) ;
  - `onOverflow` ⇒ un nouveau `snapshot`.
  - Rien n'est gardé pour un appareil retiré.

- [ ] **Step 1: Write the failing tests**
  - `mobile-gateway.test.ts` :
    - un JSON invalide, puis `session.message`, `chat.ask`, `mobile.device.revoke`, `update.daemon` et `session.launch` ⇒ chacun reçoit `error { code: 'invalid' }`, `dispatch` n'est jamais appelé, et aucune ligne de log ne contient le texte envoyé ;
    - un appareil non abonné ne reçoit aucun `session.updated` ;
    - après `snapshot.request`, un `forward` de `session.updated` arrive projeté, sans `cwd` ;
    - un `forward` de `chat.delta`, de `mobile`, de `machines` ou de `recents` n'envoie rien ;
    - `session.preview` n'arrive qu'à l'appareil qui regarde cette session ;
    - `decide` avec une mauvaise `expect.key` ⇒ `received`, puis `rejected` / `stale`, et `dispatch` n'est pas appelé ;
    - `decide` `accept` sur `git push` ⇒ `confirm_required` ; `deny` sur la même demande ⇒ `dispatch`, puis `applied` ;
    - une `error { code: 'not_taken' }` de `dispatch` ⇒ `failed` / `not_taken` ;
    - le même `op` envoyé deux fois ⇒ `dispatch` est appelé une fois, et la seconde réponse est `applied` ;
    - le même `op` avec un autre texte ⇒ `conflict` ;
    - `reply` qui contient `\x1b[2J` ⇒ `untypable` ;
    - `session.read` ⇒ `unread` passe à `false` pour cet appareil, et reste `true` pour un autre ;
    - un appareil révoqué (`onChange`) ⇒ plus aucun envoi ;
    - le texte de chaque `send` a une longueur en octets qui figure dans `PAD_TIERS`.
  - `mobile-phone-e2e.test.ts`, avec un vrai relais, un faux appareil lié et le vrai daemon :
    - `snapshot.request` ⇒ le premier texte reçu passe `PhoneServerMessageSchema`, c'est un `snapshot` dont les sessions n'ont pas de `tmuxSession` ;
    - `session.decide` `accept` sur une demande `low`, avec la bonne clé ⇒ `received`, puis `applied`, et le faux tmux a reçu les touches. Le même message renvoyé ⇒ `applied`, sans nouvelle touche.
- [ ] **Step 2:** `pnpm --filter @paradow/ledge test mobile-gateway mobile-phone-e2e`. Attendu : FAIL.
- [ ] **Step 3:** Implémenter et brancher dans `startServer`.
- [ ] **Step 4:** Suite complète : `pnpm -r test` (échecs connus : 2 tests tmux de ledge, et les instabilités de charge d'overlay, de desktop et de fleet), `pnpm -r typecheck`, `pnpm --filter desktop build`. Attendu : PASS hors ces échecs connus.
- [ ] **Step 5:** Dans la feuille de route, remplacer le point « Lot 4 » de « Reporté par la revue du lot 1 » par la décision prise : paliers `PAD_TIERS` sur le JSON clair, bourrage par espaces, `PLAIN_MAX` sous `SEALED_MAX` après base64.
- [ ] **Step 6:** Commit `feat(mobile): the phone gateway — whitelisted reads and idempotent writes over the sealed channel`.

---

## Hors de ce lot

- **WebAuthn :** la confirmation des demandes `high` (`challenges.ts`, enregistrement de la clé à la liaison), au lot 6. Jusque-là, `confirm_required`.
- **Web Push,** au lot 6.
- **Le chat Ledge du téléphone,** fil séparé (`chat.*` dans la liste blanche), au lot 6.
- **Lancer une session ou envoyer un message à un autre agent** depuis le téléphone (`session.launch`, `session.message`, `session.relay`) : pas dans la liste blanche. Le lot 6 les ajoute avec le chat, sous la même politique de risque.
- **La PWA,** qui consomme ces messages, au lot 5. Les schémas de `phone.ts` et le faux appareil en sont la référence.
- **Persistance :** les marques de lecture et la registry d'opérations ne survivent pas à un redémarrage du daemon. Après un redémarrage, une décision rejouée tombe sur `stale` grâce à `expect.key`. Une réponse rejouée, en revanche, serait tapée une seconde fois. Le risque est accepté pour ce lot, parce qu'il faut un redémarrage pile entre l'envoi et l'accusé.
