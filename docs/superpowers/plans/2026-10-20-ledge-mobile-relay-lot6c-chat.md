# Ledge mobile, lot 6c : « Demander à Ledge » depuis le téléphone — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le téléphone a son propre fil de chat avec Ledge. On y pose une question sur ses agents et ses repos, on suit la réponse en direct, et on agit sur ses cartes : envoyer une consigne à un agent, ou lancer une session (après vérification de l'appareil).

**Architecture:**
- **Daemon, un fil par interlocuteur :**
  - le chat du PC reste le fil `desktop` (`chat.json`) ;
  - chaque appareil a son fil `device:<id>` : son fichier du jour et son dossier de contexte sont sous `<home>/mobile/chat/<id>/`.
  - `createChat` reste l'unité : une instance par fil, avec un compteur partagé qui borne les questions simultanées.
- **Gateway :** elle route les messages `chat.*` du téléphone vers le fil de cet appareil. Ce qu'émet ce fil ne part que vers cet appareil, après projection (sans dossiers, textes coupés). Rien ne passe par `broadcast`.
- **Actions des cartes :** envoyer une consigne réutilise `relay.ts` ; lancer une session réutilise le chemin `session.launch` avec `qid`. Les deux sont rattachés au fil qui porte le `qid`. Le lancement exige une assertion WebAuthn (`purpose: 'launch'`, lot 6a).
- **Téléphone :** un troisième onglet « Demander à Ledge » (route `#/chat`), un écran conforme à `Chat.dc.html`, et la notification « Ledge a répondu » (lot 6b) quand l'app n'est pas visible.

**Tech Stack:** TypeScript, zod 3, React 19, vitest 4, Playwright 1.64.1. Réutilise `@ledge/ui/reply/parse` et `apps/mobile/src/ui/ReplyView.tsx` pour la réponse.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md` (l. 17, 50, 84-86). Autres références :
- le chat du PC : `packages/ledge/src/chat/service.ts`, `packages/ledge/src/daemon/relay.ts`, `packages/ledge/src/daemon/server.ts` (l. 160, 261, 546, 647-667, 825-838) ;
- la spec des cartes : `docs/superpowers/specs/2026-10-12-*` (relay §4, sessions §5) ;
- lot 6a (`challenges.ts`, `confirm.prepare`, la carte de confirmation, les opérations) et lot 6b (`createNotifier`, `PushPayloadSchema`, `presence`) ;
- maquette : `docs/mockups/ledge-mobile/source/Chat.dc.html` (écran 7).

## Global Constraints

- **Un fil par appareil, jamais partagé :** un téléphone ne voit ni le fil du PC ni celui d'un autre appareil, et le PC ne voit pas ceux des téléphones. Le retrait d'un appareil (révocation ou `device.forget`) annule sa question en cours et supprime `<home>/mobile/chat/<id>/`.
- **Charge :** une question à la fois par fil (le refus existant `ONE_AT_A_TIME`). Au plus **3 questions en même temps**, tous fils confondus (PC compris). Au-delà, `chat.error { code: 'busy' }`. Le délai de 180 s et la reprise de session restent ceux de `createChat`.
- **Outil :** le fil d'un appareil utilise l'outil du fichier du jour du PC (`chat.json`, champ `tool`), et `claude` sinon. Le téléphone ne choisit pas l'outil.
- **Projection vers le téléphone** (`toPhoneTurn`) :
  - ni `cwd`, ni `path`, ni `projectProposal`, ni `machineId`/`machineName`/`choices` (le routage multi-machines reste au PC) ;
  - `answer` coupée à `THREAD_TEXT_MAX` (8 192), avec `cut: true` ;
  - prompts de carte et texte de consigne coupés à `TOOL_TEXT_MAX` (2 048) ;
  - une erreur devient un code (`'busy' | 'timeout' | 'cancelled' | 'failed'`), jamais un message libre.
- **Flux en direct :** le téléphone reçoit `chat.delta` avec **le texte entier** jusque-là (pas un incrément), au plus un toutes les 250 ms par question, avec la clé de coalescence `chat.live:<qid>` de l'outbox. Une perte en route ne laisse pas de trou.
- **Propriété des `qid` :** `chat.cancel`, `chat.relay` et `chat.launch` ne visent qu'un tour du fil de l'appareil qui les envoie. Un autre `qid` → `rejected unknown_session` (opérations), ou rien (annulation).
- **Risque :** `chat.relay` est une écriture sans vérification de l'appareil (comme `session.reply`). `chat.launch` exige l'assertion (`purpose: 'launch'`, `subject` = `qid`), sauf pour un appareil sans credential, qui reçoit `rejected confirm_required`.
- **Textes :** ceux de `Chat.dc.html` mot pour mot ; ceux que la maquette ne dessine pas sont dans la Task 6. Onglet : `nav.chat = 'Demander à Ledge'`.
- **Compatibilité :** `snapshot.device.chat?: true` annonce le chat. Sans lui, le téléphone n'affiche pas le troisième onglet. `PHONE_PROTOCOL` reste 1.
- **Imports :** relatifs sans extension dans `apps/mobile`, en `.js` dans les paquets NodeNext.

## Review Focus

1. **Le téléphone perd le réseau au milieu d'une réponse, puis revient 40 s plus tard.** Attendu : la question a continué sur le PC. Au `ready`, le téléphone redemande `chat.history`, et voit la réponse finie (ou le texte en cours, puis la fin). Pas de bulle orpheline « en cours » (Tasks 3 et 5).
2. **Deux téléphones et le PC posent une question en même temps, puis un quatrième interlocuteur.** Attendu : les trois premiers reçoivent leur réponse, chacun dans son fil. Le quatrième reçoit `busy` et le texte `chat.busy`. Son champ reste rempli pour réessayer (Tasks 2 et 6).
3. **Un téléphone envoie `chat.launch` avec le `qid` d'un tour du PC** (deviné ou rejoué). Attendu : `rejected unknown_session`, et rien n'est lancé (Task 4).
4. **La réponse cite un agent qui a quitté la liste entre-temps.** Attendu : son nom reste du texte simple, sans lien mort vers `#/thread/<sid>` (Task 7).
5. **Un tour propose une session dont le dossier est hors des projets du PC.** Attendu : la carte de lancement ne montre que le nom du projet, jamais le chemin. Le lancement suit les mêmes règles que sur le PC (`tooWide` refusé) (Tasks 1 et 4).

---

### Task 1: protocole du chat du téléphone

**Files:**
- Modify : `packages/protocol/src/{phone.ts,push.ts}`
- Test : `packages/protocol/test/phone.test.ts`

**Interfaces:**
- Produces, dans `phone.ts` :
  - `PhoneChatStepSchema = ChatStepSchema.pick({ kind: true, id: true, name: true })` ;
  - `PhoneChatProposalSchema = { project: z.string().max(80), tool: ToolSchema, prompt: z.string().max(TOOL_TEXT_MAX).optional(), launchedId: z.string().optional(), failed: z.literal(true).optional() }` ;
  - `PhoneChatRelaySchema = { id, name, tool, text: z.string().max(TOOL_TEXT_MAX), status: z.enum(['queued', 'sent']).optional(), sentAt: z.string().datetime().optional(), failed: z.literal(true).optional() }` ;
  - `ChatErrorCodeSchema = z.enum(['busy', 'timeout', 'cancelled', 'failed'])` ;
  - `PhoneChatTurnSchema = { qid: OperationIdSchema, question: z.string().max(MESSAGE_MAX), askedAt, steps: z.array(PhoneChatStepSchema).max(50), answer: z.string().max(THREAD_TEXT_MAX).optional(), answeredAt?, error: ChatErrorCodeSchema.optional(), proposals: z.array(PhoneChatProposalSchema).max(MAX_PROPOSALS).optional(), relay: PhoneChatRelaySchema.optional(), cut: z.literal(true).optional() }`.
- Le client gagne :
  - `{ type: 'chat.ask', qid: OperationIdSchema, text: z.string().trim().min(1).max(MESSAGE_MAX) }` ;
  - `{ type: 'chat.cancel', qid }` ;
  - `{ type: 'chat.reset' }` ;
  - `{ type: 'chat.history' }` ;
  - `{ type: 'chat.relay', op, qid }` ;
  - `{ type: 'chat.launch', op, qid, rows: z.array(z.number().int().min(0).max(MAX_PROPOSALS - 1)).min(1).max(MAX_PROPOSALS).optional(), assertion: AssertionSchema.optional() }`.
- Le serveur gagne :
  - `{ type: 'chat.history', turns: z.array(PhoneChatTurnSchema).max(50) }` ;
  - `{ type: 'chat.step', qid, step: PhoneChatStepSchema }` ;
  - `{ type: 'chat.delta', qid, text: z.string().max(THREAD_TEXT_MAX) }`, le texte entier jusque-là ;
  - `{ type: 'chat.done', qid, turn: PhoneChatTurnSchema }` ;
  - `{ type: 'chat.error', qid, code: ChatErrorCodeSchema }`.
- `ConfirmPurposeSchema` devient `['register', 'decide', 'launch']`. `confirm.prepare` gagne `qid: OperationIdSchema.optional()` ; un `launch` sans `qid` est refusé par la gateway (Task 4).
- `snapshot.device` gagne `chat: z.literal(true).optional()`.
- `PushPayloadSchema.kind` gagne `'chat'` (lot 6b).

- [ ] **Step 1 : tests qui échouent.**
  - un tour avec un `cwd` dans une proposition, ou un `path` dans un pas → refusé (les objets de tour sont `.strict()`) ;
  - `chat.ask` avec un `qid` qui n'est pas un uuid → refusé ;
  - `chat.launch` avec `rows: [8]` → refusé ;
  - `confirm.prepare { purpose: 'launch', qid }` passe ;
  - un snapshot du lot 6b passe sans `chat` ;
  - un `PushPayload` `kind: 'chat'` passe.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/protocol test` → PASS.
- [ ] **Step 4 :** commit `feat(protocol): the phone's own chat thread`.

### Task 2: un chat par fil dans le daemon

**Files:**
- Create : `packages/ledge/src/chat/threads.ts`
- Modify : `packages/ledge/src/chat/service.ts`, `packages/ledge/src/daemon/server.ts` (l. 160)
- Test : `packages/ledge/test/chat-threads.test.ts`, `packages/ledge/test/chat-service.test.ts`

**Interfaces:**
- `ChatDeps` gagne :
  - `dir?: string` : le dossier du fichier du jour (`<dir>/chat.json`) et du contexte (`<dir>/chat/context`). Par défaut `home`, ce qui garde les chemins actuels du PC ;
  - `slots?: { take(): boolean; give(): void }`. `ask` le prend juste après le contrôle `busy`. Refusé → `chat.error { qid, message: TOO_MANY }`, avec `export const TOO_MANY = 'too many questions at once: try again in a moment'`. Il est rendu dans le `finally`.
- Produces, dans `threads.ts` :
  - `type ChatThreadId = 'desktop' | `device:${string}`` ;
  - `createSlots(max = 3)` ;
  - `createChatThreads(deps: Omit<ChatDeps, 'dir' | 'slots'> & { max?: number })`, qui rend :
    - `desktop: Chat` ;
    - `device(id: string): Chat`, créé au premier appel, avec `dir = <home>/mobile/chat/<id>` ;
    - `deviceTool(): Promise<Tool>` : lit le `tool` de `<home>/chat.json`, `'claude'` sinon ;
    - `drop(id: string): Promise<void>` : annule la question en cours du fil, l'oublie, et supprime son dossier ;
    - `owner(qid: string): ChatThreadId | undefined`, d'après l'historique de chaque fil.
- `server.ts` crée `threads` et garde `const chat = threads.desktop` : rien d'autre ne change côté PC.

- [ ] **Step 1 : tests qui échouent**, avec un `spawn` simulé comme dans `chat-service.test.ts`.
  - deux fils posent chacun une question en même temps → deux réponses, deux historiques séparés ;
  - un fil pose deux questions → la seconde a `ONE_AT_A_TIME` ;
  - quatre fils en même temps avec `max: 3` → le quatrième reçoit `TOO_MANY`, et une question après la fin d'une des trois passe ;
  - le fichier du jour d'un appareil est sous `mobile/chat/<id>/chat.json`, et celui du PC reste `chat.json` ;
  - `deviceTool()` rend `codex` quand `chat.json` dit `codex` ;
  - `drop` pendant une question → le processus est tué, et le dossier n'existe plus ;
  - `owner(qid)` rend le bon fil, et `undefined` pour un `qid` inconnu.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/chat-threads.test.ts test/chat-service.test.ts` → PASS.
- [ ] **Step 4 :** commit `feat(chat): one chat per thread, with a shared cap on running questions`.

### Task 3: la gateway route le chat du téléphone

**Files:**
- Create : `packages/ledge/src/mobile/chat.ts`
- Modify : `packages/ledge/src/mobile/{gateway.ts,service.ts}`, `packages/ledge/src/daemon/server.ts` (câblage)
- Test : `packages/ledge/test/mobile/{chat,gateway}.test.ts`

**Interfaces:**
- Consumes : `createChatThreads` (Task 2), schémas de Task 1.
- Produces, dans `mobile/chat.ts` :
  - `toPhoneTurn(t: ChatTurn): PhoneChatTurn`, la projection des Global Constraints. L'erreur se traduit ainsi : `ONE_AT_A_TIME` ou `TOO_MANY` → `busy` ; `'cancelled'` → `cancelled` ; un message de délai dépassé → `timeout` ; le reste → `failed` ;
  - `phoneEmitter(deviceId, push, opts?: { now?: () => number; throttleMs?: number })` → `(m: ChatMessage) => void`, qui traduit un message du `Chat` en message téléphone :
    - `chat.history` → la projection ;
    - `chat.step` → le pas réduit ;
    - `chat.delta` → accumulé par `qid`, et envoyé en texte entier au plus toutes les 250 ms (clé `chat.live:<qid>`) ;
    - `chat.done` → le dernier texte, puis `chat.done` avec le tour projeté ;
    - `chat.error` → le code.
- La gateway gagne la dep `chats: { device(id): Chat; deviceTool(): Promise<Tool>; owner(qid): ChatThreadId | undefined; drop(id): Promise<void> }` :
  - `chat.ask` (lecture) → `device(id).ask(qid, text, phoneEmitter(id, push), await deviceTool())` ;
  - `chat.cancel` (lecture) → seulement si `owner(qid) === 'device:' + id` ;
  - `chat.reset` (lecture) ;
  - `chat.history` (lecture) → `chat.history` projeté, vers cet appareil seulement ;
  - `snapshot.device.chat = true` quand la dep est présente.
- Le service appelle `chats.drop(id)` à la révocation et à `device.forget` (lot 6a).

- [ ] **Step 1 : tests qui échouent.**
  - **`toPhoneTurn` :** un tour avec `proposals[0].cwd`, un pas `{ kind: 'git', path }` et un `projectProposal` → aucun chemin dans le JSON obtenu ; une réponse de 20 000 caractères → 8 192 et `cut: true` ;
  - **émetteur :** 10 deltas en 100 ms → un seul `chat.delta`, avec le texte entier ; la fin envoie le dernier texte avant `chat.done` ;
  - **gateway :**
    - le téléphone A pose une question → seul A reçoit les messages, ni B ni les clients locaux ;
    - `chat.cancel` de B sur le `qid` de A → rien n'est annulé ;
    - `chat.history` après un `ready` → les tours de A seulement ;
    - la révocation de A → `drop('A')` est appelé.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** vitest `test/mobile` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): the phone talks to its own chat thread`.

### Task 4: les cartes depuis le téléphone (consigne et lancement)

**Files:**
- Modify : `packages/ledge/src/daemon/{relay.ts,server.ts}` (l. 647-667, 825-827), `packages/ledge/src/mobile/{gateway.ts,challenges.ts}`
- Create : `packages/ledge/src/chat/launch.ts`
- Test : `packages/ledge/test/{relay,chat-launch}.test.ts`, `packages/ledge/test/mobile/gateway.test.ts`

**Interfaces:**
- `RelayDeps.chat` devient `chatOf: (qid: string) => Chat | undefined` (le fil propriétaire via `owner`). Les files d'attente parcourent tous les fils. Un `markRelay` émet vers l'émetteur de ce fil : `broadcast` pour `desktop`, `phoneEmitter` pour un appareil. `createChatThreads` garde l'émetteur de chaque fil (`emitterOf(thread)`).
- Produces : `launchFromChat(deps: { chat: Chat; launch: (p: ChatProposal) => Promise<string>; emit; inFlight: Set<string> }, qid: string, rows?: number[]): Promise<{ launched: string[]; failed: number }>`. C'est le corps actuel de `session.launch` avec `qid` (l. 647-667), sorti de `server.ts`, qui l'utilise désormais.
- Gateway :
  - `chat.relay { op, qid }` : une écriture. `owner(qid)` doit être le fil de l'appareil (sinon `rejected unknown_session`). `relay.request(qid)` → `applied` ; une exception → `failed` ;
  - `confirm.prepare { purpose: 'launch', qid }` : une lecture. Sans `qid`, ou un `qid` d'un autre fil : `error invalid`. Sinon un défi lié à `{ deviceId, purpose: 'launch', subject: qid }` ;
  - `chat.launch { op, qid, rows?, assertion? }` : une écriture.
    1. Propriétaire contrôlé, comme pour `chat.relay`.
    2. Sans credential → `rejected confirm_required`.
    3. Assertion absente → `rejected confirm_required` ; invalide → `rejected assertion_invalid` ; défi expiré → `rejected assertion_expired`.
    4. Puis `launchFromChat`. Au moins une session lancée → `applied` ; aucune → `failed`.
  - `fingerprint(m)` (operations.ts, lot 6a) gagne `m.qid ?? null` et `m.rows ?? null`. L'assertion n'y entre pas (comme pour `session.decide` au lot 6a).

- [ ] **Step 1 : tests qui échouent.**
  - **relay :** une consigne d'un fil d'appareil, mise en file puis envoyée → l'état `sent` part vers cet appareil, et pas en `broadcast` ;
  - **launchFromChat :** les tests existants de `session.launch` avec `qid` passent sans changement par `server.ts` ;
  - **gateway :**
    - `chat.launch` sans assertion → `confirm_required` ;
    - avec une assertion valide liée à ce `qid` → `applied`, et la session est lancée ;
    - avec une assertion liée à un autre `qid` → `assertion_invalid` ;
    - le `qid` d'un tour du PC → `unknown_session`, et rien n'est lancé ;
    - une proposition dont le dossier est trop large (`tooWide`) → `failed`, et le tour montre la carte en échec (`failed: true`) ;
    - le rejeu du même `op` → le même résultat, sans second lancement.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): send an instruction or launch a session from a phone chat card`.

### Task 5: le store du téléphone

**Files:**
- Create : `apps/mobile/src/state/chat.ts`
- Modify : `apps/mobile/src/state/store.ts`, `apps/mobile/test/fakePc.ts`
- Test : `apps/mobile/test/state/chat.test.ts`

**Interfaces:**
- Produces : `ChatState = { turns: PhoneChatTurn[]; live: { qid: string; steps: PhoneChatStep[]; text: string } | null; error: ChatErrorCode | 'offline' | null }`, et dans le store :
  - `chat(): ChatState`, abonnable comme le reste du store ;
  - `ask(text: string): string`. Il crée le `qid` (uuid), ajoute le tour aussitôt (bulle de l'utilisateur), envoie `chat.ask` et rend le `qid`. Hors ligne : `error: 'offline'`, et rien n'est envoyé ;
  - `cancelAsk()`, `resetChat()` ;
  - `relay(qid): Promise<OperationResult>` et `launch(qid, rows?): Promise<OperationResult | 'cancelled'>`. `launch` passe par `prepareConfirm({ purpose: 'launch', qid })` puis `getAssertion` (lot 6a), comme une acceptation `high`. Le type de la requête de `prepareConfirm` gagne la variante `{ purpose: 'launch'; qid: string }`.
- Le store envoie `chat.history` après chaque `ready`, si `snapshot.device.chat` est présent. `chat.history` remplace `turns` ; un `live` dont le tour est fini dans l'historique est effacé.
- Le fil n'est pas gardé sur le téléphone : il vient du PC à chaque connexion.
- Le faux PC gagne un chat scripté : `chat.ask` → deux pas, deux deltas, puis `done` avec une carte de consigne et une carte de lancement.

- [ ] **Step 1 : tests qui échouent.**
  - `ask` → le tour apparaît avant toute réponse ;
  - `chat.delta` → `live.text` est remplacé (et non concaténé) ;
  - `chat.done` → `live` est vidé, et le tour a sa réponse ;
  - coupure, puis `ready` → `chat.history` est demandé, et le tour fini remplace la bulle en cours ;
  - `chat.error busy` → `error: 'busy'`, et le texte de la question est rendu à l'appelant pour le champ ;
  - `launch` sans credential → la promesse rend `confirm_required`, sans appel WebAuthn.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): chat state on the phone`.

### Task 6: l'écran « Demander à Ledge »

**Files:**
- Create : `apps/mobile/src/screens/Chat.tsx`, `apps/mobile/src/ui/chat/{Composer.tsx,TurnView.tsx}`
- Modify : `apps/mobile/src/{router.ts,App.tsx,copy.ts}`, `apps/mobile/src/ui/TabBar.tsx`
- Test : `apps/mobile/test/screens/chat.test.tsx`, `apps/mobile/test/router.test.ts`

**Interfaces:**
- Route `{ name: 'chat' }` ↔ `#/chat` (ajoutée à `SIMPLE`).
- `TabBar` : `active?: 'inbox' | 'agents' | 'chat'` et `chat?: boolean`. Avec `chat`, 3 colonnes (`grid-cols-3`), sinon 2 comme aujourd'hui.
- Textes (`copy.chat`), mot pour mot de `Chat.dc.html` :
  - `title: 'Ledge'` ; `subtitle: (agents: number, repos: number) => `Fil du téléphone · ${agents} agents, ${repos} repos`` (singuliers « 1 agent », « 1 repo ») ;
  - `reset: 'Nouvelle conversation'` ;
  - `empty: 'Posez une question sur vos agents et vos repos. Ce fil est propre à ce téléphone.'` ;
  - `suggestions` : `'Qui attend quelque chose de moi ?'`, `'Où en est Bix sur le badge d'attente ?'`, `'Qu'est-ce qui a changé dans harness-assistant aujourd'hui ?'`. La deuxième et la troisième prennent le nom d'une session et d'un repo réels du snapshot, et sont omises s'il n'y en a pas ;
  - `stop: 'Arrêter'` ; `sources: 'Sources : '` ;
  - `field: 'Question pour Ledge'` ; `placeholder: 'Demander à Ledge…'` ; `send: 'Envoyer la question'`.
- Textes hors maquette :
  - `busy: 'Ledge répond déjà à d'autres questions. Réessayez dans un instant.'` ;
  - `timeout: 'Ledge n'a pas répondu à temps.'` ;
  - `failed: 'Ledge n'a pas pu répondre.'` ;
  - `cancelled: 'Question arrêtée.'` ;
  - `offline: 'Hors ligne : la question partira quand le PC sera joignable.'` (le bouton d'envoi est alors désactivé ; rien n'est mis en file) ;
  - `cut: 'Réponse coupée : la suite est sur le PC.'`.
- Pas des étapes (`steps`), libellés : `sessions` → `Lit les ${n} sessions…`, `pane` → `Regarde le terminal de ${name}…`, `reply` → `Lit la dernière réponse de ${name}…`, `git`/`repo` → `Regarde ${name}…`. Pas fini : coche verte ; pas en cours : indicateur animé (sans animation si `prefers-reduced-motion`).
- `subtitle` compte les sessions du snapshot et leurs `repo` distincts.
- Le champ grandit de 44 à 120 px ; `Entrée` sur clavier physique envoie, `Maj+Entrée` passe à la ligne.

- [ ] **Step 1 : tests qui échouent.**
  - sans `snapshot.device.chat` → 2 onglets, et `#/chat` renvoie vers l'inbox ;
  - fil vide → le texte vide et les suggestions ; toucher une suggestion la pose ;
  - une question en cours → les pas, puis le bouton « Arrêter », qui envoie `chat.cancel` ;
  - `busy` → le texte `chat.busy`, et le champ garde la question ;
  - « Nouvelle conversation » est désactivé pendant une question ;
  - `subtitle(1, 1)` → « Fil du téléphone · 1 agent, 1 repo » ;
  - le routeur : `parseRoute('#/chat')` et `href({ name: 'chat' })`.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): ask Ledge from the phone`.

### Task 7: la réponse et ses cartes

**Files:**
- Create : `apps/mobile/src/ui/chat/{Answer.tsx,RelayCard.tsx,LaunchCard.tsx}`
- Modify : `apps/mobile/src/ui/chat/TurnView.tsx`, `apps/mobile/src/copy.ts`
- Test : `apps/mobile/test/screens/chat-cards.test.tsx`

**Interfaces:**
- `Answer` : `parseReply(answer)` puis `ReplyView`, comme `Thread.tsx`. Le nom de chaque session **présente dans le snapshot** devient un lien vers `#/thread/<sid>` ; un nom absent reste du texte. La ligne « Sources : » liste les noms des pas `pane`/`reply`, liés de la même façon.
- `RelayCard`, avec `section aria-label="Consigne proposée"` :
  - en-tête « Envoyer à **{name}** · {repo} » (le `repo` de la session dans le snapshot, omis sinon), puis le texte ;
  - boutons « Ignorer » (masque la carte, côté téléphone seulement) et « Envoyer » (`relay(qid)`) ;
  - après : `queued` → `En attente : {name} est occupé.` ; `sent` → « Envoyé à {name} · voir son fil » (lien vers le fil) ; `failed` → `Pas envoyé.`.
- `LaunchCard`, avec `section aria-label="Session proposée"` (hors maquette, même gabarit que `RelayCard`) :
  - en-tête `Lancer {tool} dans {project}`, puis le prompt ;
  - boutons « Ignorer » et le bouton de confirmation du lot 6a (`Autoriser avec Face ID` sur iPhone/iPad, sinon `Confirmer avec mon appareil`), qui appelle `launch(qid, [row])` ;
  - plusieurs propositions → une ligne par proposition, chacune avec son bouton ;
  - après : `launchedId` → `Lancée · voir son fil` ; `failed` → `Pas lancée.` ;
  - les textes `confirm.*` du lot 6a pour l'annulation et l'expiration ;
  - sans credential sur l'appareil (`snapshot.device.confirm` faux) : `chat.launchSetup = 'Protégez d'abord vos accords depuis Connexion.'`, avec un lien vers `#/connection`, et le bouton désactivé.

- [ ] **Step 1 : tests qui échouent.**
  - une réponse qui cite « Bix » (présent) et « Kai » (absent) → un lien pour Bix, du texte pour Kai ;
  - une carte de consigne → « Envoyer » appelle `relay` ; l'état `sent` montre « Envoyé à Nova · voir son fil » ;
  - « Ignorer » masque la carte sans rien envoyer ;
  - deux propositions → deux boutons, et le second appelle `launch(qid, [1])` ;
  - sur iPhone (user agent simulé) le bouton dit « Autoriser avec Face ID » ;
  - annulation de la vérification → `confirm.cancelled`, et la carte reste proposée.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): act on the chat's cards from the phone`.

### Task 8: « Ledge a répondu », de bout en bout, et feuille de route

**Files:**
- Modify : `packages/ledge/src/mobile/{chat.ts,push/notifier.ts}`
- Create : `apps/mobile/e2e/chat.spec.ts`
- Modify : `apps/mobile/e2e/harness.ts` (le faux daemon répond au chat), `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md`
- Test : `packages/ledge/test/mobile/push-notifier.test.ts`, `apps/mobile/e2e/chat.spec.ts`

**Interfaces:**
- Consumes : `createNotifier` et `presence` (lot 6b).
- `notify` gagne une cible : `notify(p, sessionId, only?: string)`. Avec `only`, il n'envoie qu'à cet appareil.
- À la fin d'une question d'un fil d'appareil (`chat.done` ou `chat.error`), si l'appareil n'est pas visible : `{ v: 1, kind: 'chat', title: 'Ledge a répondu', body: <réponse coupée à 120>, url: '/#/chat', badge, tag: 'chat' }`, envoyé seulement à cet appareil. En cas d'erreur, le corps est le texte du code.

- [ ] **Step 1 : tests qui échouent.**
  - **notifieur :** fin d'une question d'un appareil caché → un push vers lui seul ; appareil visible → aucun ;
  - **`chat.spec.ts` (Chromium) :**
    1. ouvrir l'onglet « Demander à Ledge », poser une suggestion → les pas, puis la réponse ;
    2. « Envoyer » sur la carte de consigne → « Envoyé à Nova · voir son fil » ;
    3. lancer la session proposée avec l'authentificateur virtuel du lot 6a → « Lancée · voir son fil » ;
    4. couper la connexion pendant une réponse, la rétablir → la réponse finie s'affiche, sans bulle en cours.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** feuille de route : le lot 6c est inscrit comme fait, avec ses décisions :
  - un fil par appareil ;
  - au plus 3 questions en même temps ;
  - le flux en texte entier ;
  - le lancement sous vérification de l'appareil.
  Y noter, pour plus tard, l'historique gardé au redémarrage du daemon (les tours restent en mémoire, comme sur le PC).
- [ ] **Step 4 :** suite complète `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter @ledge/mobile build` et `test:e2e`. Les échecs connus restent ceux du lot 5.
- [ ] **Step 5 :** commit `test(mobile): phone chat end to end; roadmap updated`.

## Hors de ce lot

- **Le routage multi-machines** (`chat.route`, `fleet.ts`) : le fil du téléphone interroge le PC auquel il est lié.
- **La carte « projet proposé »** (`projectProposal`) : elle ne montre que des chemins de dossiers, qui ne sortent pas du PC.
- **Le choix de l'outil depuis le téléphone.**
- **L'historique des fils gardé au redémarrage du daemon.**
- **Lot 7 :** essai sur un vrai iPhone.
