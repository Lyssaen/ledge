# Ledge mobile, lot 6c : « Demander à Ledge » depuis le téléphone — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Révision du 2026-10-20 (avant exécution)** : le plan a été recalé sur le code réel de 6a/6b après la vérification préalable. Changements : `sw.ts` dans la Task 1 ; registre d'émetteurs et liste de tous les fils dans la Task 2 ; dépendances de la gateway explicites ; ancienne Task 4 coupée en 4 (relais multi-fils) et 5 (lancement) ; ops chat jamais persistées ; cartes trop longues jamais montrées ; corps de push générique ; historique borné ; chemins de test à plat. Le plan compte 9 tâches.

**Goal:** Le téléphone a son propre fil de chat avec Ledge. On y pose une question sur ses agents et ses repos, on suit la réponse en direct, et on agit sur ses cartes : envoyer une consigne à un agent, ou lancer une session (après vérification de l'appareil).

**Architecture:**
- **Daemon, un fil par interlocuteur :**
  - le chat du PC reste le fil `desktop` (`chat.json`) ;
  - chaque appareil a son fil `device:<id>`, un `createChat` dont le `home` est `<home>/mobile/chat/<id>` : son fichier du jour, son contexte et ses sessions OMP vivent donc dessous ;
  - un compteur partagé borne les questions simultanées, tous fils confondus.
- **Gateway :** elle route les messages `chat.*` du téléphone vers le fil de cet appareil. Ce qu'émet ce fil ne part que vers cet appareil, après projection (sans dossiers, textes coupés). Rien ne passe par `broadcast`.
- **Actions des cartes :** envoyer une consigne réutilise `relay.ts`, rendu multi-fils ; lancer une session réutilise le corps de `session.launch`, sorti dans `chat/launch.ts`. Le lancement exige une assertion WebAuthn (`purpose: 'launch'`, lot 6a).
- **Téléphone :** un troisième onglet « Demander à Ledge » (route `#/chat`), un écran conforme à `Chat.dc.html`, et la notification « Ledge a répondu » (lot 6b) quand l'app n'est pas visible.

**Tech Stack:** TypeScript, zod 3, React 19, vitest 4, Playwright 1.64.1. Réutilise `@ledge/ui/reply/parse` et `apps/mobile/src/ui/ReplyView.tsx` pour la réponse.

**Spec:** `docs/superpowers/specs/2026-10-16-ledge-relay-design.md` (l. 17, 50, 84-86). Autres références :
- le chat du PC : `packages/ledge/src/chat/service.ts`, `packages/ledge/src/daemon/relay.ts`, `packages/ledge/src/daemon/server.ts` (les numéros de ligne dérivent : chercher `createChat(`, `chat.queuedRelays()`, `case 'session.launch'`, `case 'chat.relay'`, `createMobileGateway(`, `createNotifier(`) ;
- la spec des cartes : `docs/superpowers/specs/2026-10-12-*` (relay §4, sessions §5) ;
- lot 6a (`challenges.ts`, `confirm.prepare`, `RiskConfirm.tsx`, les opérations) et lot 6b (`createNotifier`, `PushPayloadSchema`, `presence`, `sw.ts`) ;
- maquette : `docs/mockups/ledge-mobile/source/Chat.dc.html` (écran 7).

## Global Constraints

- **Un fil par appareil, jamais partagé :** un téléphone ne voit ni le fil du PC ni celui d'un autre appareil, et le PC ne voit pas ceux des téléphones. Le retrait d'un appareil (révocation ou `device.forget`) annule sa question en cours et supprime `<home>/mobile/chat/<id>/`.
- **Charge :** une question à la fois par fil (le refus existant `ONE_AT_A_TIME`). Au plus **3 questions en même temps**, tous fils confondus (PC compris). Au-delà, `chat.error { code: 'busy' }`. Le délai de 180 s et la reprise de session restent ceux de `createChat`.
- **Outil :** le fil d'un appareil utilise l'outil du fichier du jour du PC (`<home>/chat.json`, champ `tool`, quel que soit son `day`), et `claude` sinon. Le téléphone ne choisit pas l'outil.
- **Projection vers le téléphone** (`toPhoneTurn`) :
  - ni `cwd`, ni `path`, ni `projectProposal`, ni `machineId`/`machineName`/`choices` (le routage multi-machines reste au PC) ;
  - `answer` coupée à `THREAD_TEXT_MAX` (8 192), avec `cut: true` ;
  - **une carte n'est jamais coupée** : une proposition dont le prompt, ou une consigne dont le texte, dépasse `TOOL_TEXT_MAX` (2 048) n'est pas projetée, et la gateway refuse d'agir dessus (`rejected invalid`). Le téléphone ne confirme jamais un texte différent de celui que le PC exécute ;
  - une erreur devient un code (`'busy' | 'timeout' | 'cancelled' | 'failed'`), jamais un message libre.
- **Historique borné :** le `chat.history` envoyé au téléphone garde les tours les plus récents dont le JSON tient dans `CHAT_HISTORY_BUDGET = 393_216` octets (60 % de `PLAIN_MAX`).
- **Flux en direct :** le téléphone reçoit `chat.delta` avec **le texte entier** jusque-là (pas un incrément), au plus un toutes les 250 ms par question, avec la clé de coalescence `chat.live:<qid>` de l'outbox. Une perte en route ne laisse pas de trou.
- **Propriété des `qid` :** `chat.cancel`, `chat.relay`, `chat.launch` et `confirm.prepare { purpose: 'launch' }` ne visent qu'un tour du fil de l'appareil qui les envoie. Un autre `qid` → `rejected unknown_session` (opérations), `error invalid` (`confirm.prepare`), ou rien (annulation).
- **Risque :** `chat.relay` est une écriture sans vérification de l'appareil (comme `session.reply` sans dialogue OMP). `chat.launch` exige l'assertion (`purpose: 'launch'`, `subject` = `qid`), sauf pour un appareil sans credential, qui reçoit `rejected confirm_required`.
- **Opérations volatiles :** `chat.relay` et `chat.launch` ne sont jamais écrites dans le stockage du téléphone (comme `push.*`, lot 6b) : après un rechargement, rien ne repart sans un nouveau geste.
- **Notification :** `{ v: 1, kind: 'chat', title: 'Ledge a répondu', body: 'Touchez pour lire la réponse.', url: '/#/chat', tag: 'chat' }` ; en cas d'erreur, le corps est le texte du code (Task 7). Jamais le texte de la réponse. Urgence `normal`.
- **Textes :** ceux de `Chat.dc.html` mot pour mot ; ceux que la maquette ne dessine pas sont dans la Task 7. Onglet : `nav.chat = 'Demander à Ledge'`.
- **Compatibilité :** `snapshot.device.chat?: true` annonce le chat. Sans lui, le téléphone n'affiche pas le troisième onglet. `PHONE_PROTOCOL` reste 1.
- **Tests du daemon à plat :** `packages/ledge/test/<nom>.test.ts` (pas de dossier `test/mobile/`). Lancer les fichiers nommés, jamais un motif qui ne trouve rien.
- **Imports :** relatifs sans extension dans `apps/mobile`, en `.js` dans les paquets NodeNext.

## Review Focus

1. **Le téléphone perd le réseau au milieu d'une réponse, puis revient 40 s plus tard.** Attendu : la question a continué sur le PC. Au `ready`, le téléphone redemande `chat.history`, et voit la réponse finie (ou le texte en cours, puis la fin). Pas de bulle orpheline « en cours » (Tasks 3 et 6).
2. **Deux téléphones et le PC posent une question en même temps, puis un quatrième interlocuteur.** Attendu : les trois premiers reçoivent leur réponse, chacun dans son fil. Le quatrième reçoit `busy` et le texte `chat.busy`. Son champ reste rempli pour réessayer (Tasks 2, 6 et 7).
3. **Un téléphone envoie `chat.launch` avec le `qid` d'un tour du PC** (deviné ou rejoué). Attendu : `rejected unknown_session`, et rien n'est lancé (Task 5).
4. **La réponse cite un agent qui a quitté la liste entre-temps.** Attendu : son nom reste du texte simple, sans lien mort vers `#/thread/<sid>` (Task 8).
5. **Un tour propose une session dans un dossier trop large** (la racine, un dossier personnel). Attendu : la carte ne montre que le nom du projet, jamais le chemin ; depuis le téléphone, le lancement est refusé (`tooWide`) et la carte passe en échec. Le PC garde son comportement actuel (Tasks 3 et 5).

---

### Task 1: protocole du chat du téléphone

**Files:**
- Modify : `packages/protocol/src/{phone.ts,push.ts}`, `apps/mobile/src/sw/sw.ts` (validation à la main du `kind`)
- Test : `packages/protocol/test/phone.test.ts`, `apps/mobile/test/sw/sw.test.ts`

**Interfaces:**
- Produces, dans `phone.ts`, tous les objets en `.strict()` (re-appliqué après `pick`) :
  - `PhoneChatStepSchema = ChatStepSchema.pick({ kind: true, id: true, name: true }).strict()` ;
  - `PhoneChatProposalSchema = { project: z.string().max(80), tool: ToolSchema, prompt: z.string().max(TOOL_TEXT_MAX).optional(), launchedId: z.string().optional(), failed: z.literal(true).optional() }` ;
  - `PhoneChatRelaySchema = { id, name, tool, text: z.string().max(TOOL_TEXT_MAX), status: z.enum(['queued', 'sent']).optional(), sentAt: z.string().datetime().optional(), failed: z.literal(true).optional() }` ;
  - `ChatErrorCodeSchema = z.enum(['busy', 'timeout', 'cancelled', 'failed'])` ;
  - `PhoneChatTurnSchema = { qid: OperationIdSchema, question: z.string().max(MESSAGE_MAX), askedAt, steps: z.array(PhoneChatStepSchema).max(50), answer: z.string().max(THREAD_TEXT_MAX).optional(), answeredAt?, error: ChatErrorCodeSchema.optional(), proposals: z.array(PhoneChatProposalSchema).max(MAX_PROPOSALS).optional(), relay: PhoneChatRelaySchema.optional(), cut: z.literal(true).optional() }` ;
  - `CHAT_HISTORY_BUDGET = 393_216`.
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
- `ConfirmPurposeSchema` devient `['register', 'decide', 'launch']` (il sert aussi à `confirm.challenge.purpose` : les types du téléphone suivent). `confirm.prepare` gagne `qid: OperationIdSchema.optional()` ; un `launch` sans `qid` est refusé par la gateway (Task 5).
- `snapshot.device` gagne `chat: z.literal(true).optional()`.
- `PushPayloadSchema.kind` gagne `'chat'` (lot 6b), et la validation à la main de `sw.ts` aussi : le test de dérive de `sw.test.ts` (commit 8961aaa) doit rester vert et couvrir `'chat'`.

- [ ] **Step 1 : tests qui échouent.**
  - un tour avec un `cwd` dans une proposition, ou un `path` dans un pas → refusé ;
  - `chat.ask` avec un `qid` qui n'est pas un uuid → refusé ;
  - `chat.launch` avec `rows: [8]` → refusé ;
  - `confirm.prepare { purpose: 'launch', qid }` passe ;
  - un snapshot du lot 6b passe sans `chat` ;
  - un `PushPayload` `kind: 'chat'` passe, et le service worker l'accepte (affiche la notification).
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/protocol test` et `pnpm --filter @ledge/mobile test` → PASS ; `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(protocol): the phone's own chat thread`.

### Task 2: un chat par fil dans le daemon

**Files:**
- Create : `packages/ledge/src/chat/threads.ts`
- Modify : `packages/ledge/src/chat/service.ts`, `packages/ledge/src/daemon/server.ts` (là où `createChat(` est appelé)
- Test : `packages/ledge/test/chat-threads.test.ts`, `packages/ledge/test/chat-service.test.ts`

**Interfaces:**
- `ChatDeps` gagne `slots?: { take(): boolean; give(): void }`. `ask` le prend juste après le contrôle `busy` ; refusé → `chat.error { qid, message: TOO_MANY }`, avec `export const TOO_MANY = 'too many questions at once: try again in a moment'`. **Tout ce qui suit `take()` est dans un `try/finally` qui appelle `give()`** : une exception ou une annulation ne fuit jamais une place.
- `Chat` gagne `idle(): Promise<void>`, qui se résout quand aucune question ne tourne (tout de suite s'il n'y en a pas).
- Pas de nouveau champ `dir` : `home` ne sert dans `service.ts` qu'au fichier du jour, au contexte et aux sessions OMP. Un fil d'appareil est donc `createChat({ ...deps, home: <home>/mobile/chat/<id> })`.
- Produces, dans `threads.ts` :
  - `type ChatThreadId = 'desktop' | `device:${string}`` ;
  - `createSlots(max = 3)` ;
  - `createChatThreads(deps: Omit<ChatDeps, 'slots'> & { max?: number })`, qui rend :
    - `desktop: Chat` (avec `home` inchangé) ;
    - `device(id: string): Chat`, créé au premier appel ;
    - `all(): Array<[ChatThreadId, Chat]>`, le PC d'abord ;
    - `setEmitter(thread: ChatThreadId, emit: (m: ChatMessage) => void): void` et `emitterOf(thread): ((m: ChatMessage) => void) | undefined` : le fil `desktop` reçoit `broadcast` de `server.ts`, un fil d'appareil reçoit l'émetteur du téléphone (Task 3). C'est par là que le relais (Task 4) parle au bon interlocuteur ;
    - `deviceTool(): Promise<Tool>` : lit le `tool` de `<home>/chat.json`, `'claude'` s'il manque ou si le fichier est illisible ;
    - `drop(id: string): Promise<void>` : marque le fil retiré (un `ask` ultérieur sur cet id recrée un fil neuf), annule sa question, **attend `idle()`**, oublie l'émetteur, puis supprime le dossier. Le dossier ne doit pas réapparaître après ;
    - `owner(qid: string): ChatThreadId | undefined`, d'après l'historique de chaque fil.
- `server.ts` crée `threads`, garde `const chat = threads.desktop` et appelle `threads.setEmitter('desktop', broadcast)` : rien d'autre ne change côté PC dans cette tâche.

- [ ] **Step 1 : tests qui échouent**, avec un `spawn` simulé comme dans `chat-service.test.ts`.
  - deux fils posent chacun une question en même temps → deux réponses, deux historiques séparés ;
  - un fil pose deux questions → la seconde a `ONE_AT_A_TIME` ;
  - quatre fils en même temps avec `max: 3` → le quatrième reçoit `TOO_MANY`, et une question après la fin d'une des trois passe ;
  - une question qui échoue (processus en erreur) rend sa place ;
  - le fichier du jour d'un appareil est sous `mobile/chat/<id>/chat.json`, et celui du PC reste `chat.json` ;
  - `deviceTool()` rend `codex` quand `chat.json` dit `codex`, `claude` sans fichier ;
  - `drop` pendant une question → le processus est tué, `drop` ne se résout qu'après la fin de la question, et le dossier n'existe plus ensuite ;
  - `owner(qid)` rend le bon fil, et `undefined` pour un `qid` inconnu ;
  - `emitterOf('desktop')` rend l'émetteur posé.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/chat-threads.test.ts test/chat-service.test.ts` → PASS ; `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(chat): one chat per thread, with a shared cap on running questions`.

### Task 3: la gateway route le chat du téléphone

**Files:**
- Create : `packages/ledge/src/mobile/chat.ts`
- Modify : `packages/ledge/src/mobile/gateway.ts`, `packages/ledge/src/daemon/server.ts` (câblage)
- Test : `packages/ledge/test/mobile-chat.test.ts` (nouveau), `packages/ledge/test/mobile-gateway.test.ts`

**Interfaces:**
- Consumes : `createChatThreads` (Task 2), schémas de Task 1.
- Produces, dans `mobile/chat.ts` :
  - `toPhoneTurn(t: ChatTurn): PhoneChatTurn`, la projection des Global Constraints :
    - l'erreur se traduit ainsi : `ONE_AT_A_TIME` ou `TOO_MANY` → `busy` ; `'cancelled'` → `cancelled` ; un message de délai dépassé → `timeout` ; le reste → `failed` ;
    - `ChatProposal.error` présent → `failed: true` ; `launchedId` repris ;
    - une proposition au prompt trop long, ou une consigne au texte trop long, n'est pas projetée (Global Constraints) ;
  - `toPhoneHistory(turns: ChatTurn[]): PhoneChatTurn[]` : les 50 derniers tours projetés, puis les plus anciens retirés tant que le JSON dépasse `CHAT_HISTORY_BUDGET` ;
  - `phoneEmitter(send: (m: PhoneServerMessage, key?: string) => void, chat: Pick<Chat, 'history'>, opts?: { now?: () => number; throttleMs?: number; onEnd?: (end: { qid: string; code?: ChatErrorCode }) => void })` → `(m: ChatMessage) => void`, qui traduit un message du `Chat` :
    - `chat.history` → `toPhoneHistory` ;
    - `chat.step` → le pas réduit ;
    - `chat.delta` → accumulé par `qid`, et envoyé en texte entier au plus toutes les `throttleMs` (250) ms, clé `chat.live:<qid>` ;
    - `chat.done` → le dernier texte en `chat.delta`, puis `chat.done` avec le tour pris dans `chat.history()` et projeté ; puis `onEnd({ qid })` ;
    - `chat.error` → le code ; puis `onEnd({ qid, code })` ;
    - tout autre message (ex. `chat.relay` du relais) → `chat.done` avec le tour à jour, s'il a un `qid` connu.
- La gateway gagne deux deps optionnelles :
  - `chats?: Pick<ChatThreads, 'device' | 'deviceTool' | 'owner' | 'drop' | 'setEmitter'>` ;
  - `onChatEnd?: (deviceId: string, end: { qid: string; code?: ChatErrorCode }) => void` (câblé en Task 7).
- Elle crée l'émetteur d'un appareil une fois (au premier `chat.*`), l'enregistre par `chats.setEmitter('device:' + id, e)`, et l'envoi passe par son `push` interne vers cet appareil seulement.
- Lectures (`chat.*` n'ont pas d'`op`) :
  - `chat.ask` → `device(id).ask(qid, text, emitter, await deviceTool())` ;
  - `chat.cancel` → seulement si `owner(qid) === 'device:' + id` ;
  - `chat.reset` ;
  - `chat.history` → `toPhoneHistory`, vers cet appareil seulement ;
  - `snapshot.device.chat = true` quand la dep `chats` est présente.
- **Retrait :** la gateway appelle `chats.drop(id)` là où elle oublie un appareil (`forget`, `pruneRevoked`), et aussi pour tout fil d'appareil dont l'appareil n'est plus approuvé à un changement de la liste des appareils (même s'il n'est pas connecté). `service.ts` n'est pas modifié.
- Vérifier, dans le test de l'émetteur, que 180 s de deltas à 4 par seconde (texte de 8 192) ne déclenchent pas le débordement de l'outbox (`outbox.ts`, `onOverflow`) ; sinon, augmenter `throttleMs` pour le chat et le noter dans le rapport.

- [ ] **Step 1 : tests qui échouent.**
  - **`toPhoneTurn` :** un tour avec `proposals[0].cwd`, un pas `{ kind: 'git', path }` et un `projectProposal` → aucun chemin dans le JSON obtenu ; une réponse de 20 000 caractères → 8 192 et `cut: true` ; une consigne de 3 000 caractères → pas de `relay` ;
  - **`toPhoneHistory` :** 50 tours de 30 Ko → moins de 50 tours, JSON ≤ `CHAT_HISTORY_BUDGET`, les plus récents gardés ;
  - **émetteur :** 10 deltas en 100 ms → un seul `chat.delta`, avec le texte entier ; la fin envoie le dernier texte avant `chat.done` (dont le `turn` vient de `history()`) ; `onEnd` est appelé une fois ;
  - **gateway :**
    - le téléphone A pose une question → seul A reçoit les messages, ni B ni les clients locaux ;
    - `chat.cancel` de B sur le `qid` de A → rien n'est annulé ;
    - `chat.history` après un `ready` → les tours de A seulement ;
    - la révocation de A (connecté ou non) → `drop('A')` est appelé.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/mobile-chat.test.ts test/mobile-gateway.test.ts` → PASS ; `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): the phone talks to its own chat thread`.

### Task 4: le relais des consignes sur tous les fils

**Files:**
- Modify : `packages/ledge/src/daemon/{relay.ts,server.ts}`
- Test : `packages/ledge/test/relay.test.ts`, `packages/ledge/test/chat-threads.test.ts`

**Interfaces:**
- `RelayDeps.chat` et `RelayDeps.broadcast` sont remplacés par `threads: Pick<ChatThreads, 'all' | 'owner' | 'emitterOf'>`. Chaque usage de `d.chat` / `d.broadcast` dans `relay.ts` (`request`, `kick`, le gestionnaire `store.onChange`, `markRelay`, `queuedRelays`) devient :
  - pour un `qid` : le fil `owner(qid)` et son `emitterOf(owner)` ;
  - pour une session : la file de **tous** les fils (`all()`), le plus ancien tour d'abord.
- `ChatThreads` gagne `queuedRelays(): Array<{ thread: ChatThreadId; qid: string; relay: ChatRelay }>` (tous les fils, chacun avec son émetteur pour le passage de jour). `server.ts` l'utilise aux deux endroits qui lisent aujourd'hui `chat.queuedRelays()` (la boîte aux lettres `relayQueued` et `applyModelNext`) : une consigne en file d'un téléphone bloque aussi la boîte aux lettres et le changement de modèle de cette session.
- `server.ts` : `case 'chat.relay'` (PC) inchangé dans son effet.

- [ ] **Step 1 : tests qui échouent.**
  - une consigne d'un fil d'appareil, mise en file puis envoyée → l'état `sent` part vers l'émetteur de cet appareil, et pas en `broadcast` ;
  - une consigne du PC → `broadcast` comme avant (les tests existants de `relay.test.ts` passent) ;
  - une consigne d'un téléphone en file pour la session S, puis une du PC pour S → elles partent une à la fois, dans l'ordre ;
  - `threads.queuedRelays()` voit la consigne du téléphone.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/relay.test.ts test/chat-threads.test.ts test/mobile-chat.test.ts` puis `pnpm --filter @paradow/ledge test` → PASS (échecs connus seulement) ; `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(chat): instructions queue across every chat thread`.

### Task 5: les cartes depuis le téléphone (consigne et lancement)

**Files:**
- Create : `packages/ledge/src/chat/launch.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (`case 'session.launch'`), `packages/ledge/src/mobile/{gateway.ts,operations.ts}`
- Test : `packages/ledge/test/chat-launch.test.ts` (nouveau), `packages/ledge/test/mobile-gateway.test.ts`

**Interfaces:**
- Produces : `launchFromChat(deps: { chat: Pick<Chat, 'proposal' | 'markLaunched'>; launch: (p: ChatProposal) => Promise<string>; emit: (m: ChatMessage) => void; inFlight: Set<string>; refuse?: (p: ChatProposal) => string | null }, qid: string, rows?: number[]): Promise<{ launched: string[]; failed: number }>`. C'est le corps actuel du `case 'session.launch'` avec `qid`, sorti de `server.ts`, qui l'utilise désormais ; le PC continue de passer `model`/`effort` du message dans sa fonction `launch`, et ne passe pas `refuse`. Les noms exacts de `Chat` (`proposal`, `markLaunched`) sont ceux que le corps actuel utilise.
- Depuis le téléphone, `refuse` = `tooWide` (`chat/service.ts`) appliqué au dossier de la proposition : une proposition refusée est marquée en échec sur le tour (comme une erreur de lancement), sans lancement. Le PC garde son comportement.
- Gateway, nouvelles deps :
  - `relay?: { request(qid: string): Promise<void> }` ;
  - `launchChat?: (thread: ChatThreadId, qid: string, rows?: number[]) => Promise<{ launched: string[]; failed: number }>` (câblé dans `server.ts` sur `launchFromChat` avec le fil, son émetteur et `refuse`).
- Les quatre listes d'exclusion de `PhoneOperation` (`needsAssertion`, `precheck`, `local`, `run`) et le `live(msg.id)` de tête de `precheck` sont étendus : `chat.relay` et `chat.launch` n'ont pas d'`id` et passent par leur propre branche.
- `chat.relay { op, qid }` : une écriture.
  1. `owner(qid)` doit être `device:<id>` (sinon `rejected unknown_session`).
  2. La consigne du tour doit exister et tenir dans `TOOL_TEXT_MAX` (sinon `rejected invalid`).
  3. `relay.request(qid)` → `applied` ; une exception → `failed`.
- `confirm.prepare { purpose: 'launch', qid }` : une lecture. La branche `launch` passe **avant** le repli actuel vers `register`. Sans `qid`, ou un `qid` d'un autre fil : `error invalid`. Sinon un défi lié à `{ deviceId, purpose: 'launch', subject: qid }` (`challenges.ts` accepte déjà `'launch'` : pas de changement).
- `chat.launch { op, qid, rows?, assertion? }` : une écriture.
  1. Propriétaire contrôlé, comme pour `chat.relay`.
  2. Chaque ligne visée existe et son prompt tient dans `TOOL_TEXT_MAX` (sinon `rejected invalid`).
  3. Sans credential → `rejected confirm_required`.
  4. Assertion absente → `rejected confirm_required` ; invalide (ou liée à un autre `qid`) → `rejected assertion_invalid` ; défi expiré → `rejected assertion_expired`. Écrire `launchAssertionOutcome(deviceId, qid, assertion)` à part, en extrayant de `assertionOutcome` le cœur commun (consommer le défi → `verifyAssertion` → mettre à jour le compteur du credential) au lieu de le copier.
  5. Puis `launchChat`. Au moins une session lancée → `applied` ; aucune → `failed`.
- `fingerprint(m)` (`mobile/operations.ts`) gagne `m.qid ?? null` et `m.rows ?? null`, ajoutés **à la fin** du tableau. L'assertion n'y entre pas (comme pour `session.decide` au lot 6a).

- [ ] **Step 1 : tests qui échouent.**
  - **launchFromChat :** les tests existants de `session.launch` avec `qid` passent sans changement par `server.ts` ; avec `refuse` qui refuse → `failed: 1`, aucun `launch`, la carte marquée en échec ;
  - **gateway :**
    - `chat.relay` sur un tour de l'appareil → `applied` ; sur le `qid` d'un tour du PC → `unknown_session` ;
    - `chat.launch` sans assertion → `confirm_required` ;
    - avec une assertion valide liée à ce `qid` → `applied`, et la session est lancée ;
    - avec une assertion liée à un autre `qid` → `assertion_invalid` ;
    - le `qid` d'un tour du PC → `unknown_session`, et rien n'est lancé ;
    - `confirm.prepare { purpose: 'launch' }` sans `qid` → `error invalid` ; avec → un défi `purpose: 'launch'` ;
    - une proposition dans un dossier trop large → `failed`, et le tour montre la carte en échec (`failed: true`) ;
    - le rejeu du même `op` → le même résultat, sans second lancement.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @paradow/ledge exec vitest run test/chat-launch.test.ts test/mobile-gateway.test.ts` puis `pnpm --filter @paradow/ledge test` → PASS (échecs connus seulement) ; `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): send an instruction or launch a session from a phone chat card`.

### Task 6: le store du téléphone

**Files:**
- Create : `apps/mobile/src/state/chat.ts`
- Modify : `apps/mobile/src/state/{store.ts,operations.ts}`, et là où `useMobile` / `link` exposent les réponses du store
- Test : `apps/mobile/test/state/chat.test.ts` (avec un petit assistant dans `apps/mobile/test/state/helpers.ts` pour scripter un chat)

**Interfaces:**
- Produces : `ChatState = { turns: PhoneChatTurn[]; live: { qid: string; steps: PhoneChatStep[]; text: string } | null; error: { code: ChatErrorCode | 'offline'; qid?: string; text?: string } | null }`, et dans le store :
  - `chat(): ChatState`, abonnable comme le reste du store ;
  - `ask(text: string): string`. Il crée le `qid` (uuid), ajoute le tour aussitôt (bulle de l'utilisateur), envoie `chat.ask` et rend le `qid`. Hors ligne : `error: { code: 'offline', text }`, et rien n'est envoyé ;
  - à `chat.error { code: 'busy' }`, le store **retire la bulle optimiste** de ce `qid` (le PC n'a créé aucun tour) et garde `error: { code: 'busy', qid, text }` : l'écran remet `text` dans le champ ;
  - `cancelAsk()`, `resetChat()`, `clearChatError()` ;
  - `relay(qid): Promise<ChatAction>` et `launch(qid, rows?): Promise<ChatAction>`, avec `type ChatAction = { status: 'applied' | 'failed' } | { status: 'rejected'; reason: OperationReason } | { status: 'cancelled' } | { status: 'expired' }`. Les deux écrivent une opération (le registre existant), et la promesse se résout quand cette opération atteint un état final. `launch` passe d'abord par `prepareConfirm({ purpose: 'launch', qid })` puis `getAssertion` (`link/webauthn.ts`), comme une acceptation `high` ; un appareil sans credential (`snapshot.device.confirm` faux) rend `{ status: 'rejected', reason: 'confirm_required' }` sans appel WebAuthn ; l'utilisateur qui annule rend `cancelled`. Le type de la requête de `prepareConfirm` gagne la variante `{ purpose: 'launch'; qid: string }`.
- `MobileState.device` gagne `chat?: true`.
- **`chat.relay` et `chat.launch` ne sont jamais persistés** : étendre le filtre `isPush` de `operations.ts` (lot 6b) en un filtre des opérations volatiles, appliqué à `loadOps` et `saveOps`. Elles peuvent être renvoyées dans la même page après une reconnexion (le PC déduplique sur `op`).
- Le store envoie `chat.history` après chaque `ready`, si `snapshot.device.chat` est présent. `chat.history` remplace `turns` ; un `live` dont le tour est fini dans l'historique est effacé.
- Le fil n'est pas gardé sur le téléphone : il vient du PC à chaque connexion.

- [ ] **Step 1 : tests qui échouent.**
  - `ask` → le tour apparaît avant toute réponse ;
  - `chat.delta` → `live.text` est remplacé (et non concaténé) ;
  - `chat.done` → `live` est vidé, et le tour a sa réponse ;
  - coupure, puis `ready` → `chat.history` est demandé, et le tour fini remplace la bulle en cours ;
  - `chat.error busy` → la bulle disparaît, `error` vaut `{ code: 'busy', qid, text }` avec le texte posé ;
  - `launch` sans credential → la promesse rend `confirm_required`, sans appel WebAuthn ;
  - `relay` → la promesse rend `applied` à l'`operation.result` ;
  - une opération `chat.launch` en cours n'est pas dans le stockage local.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS ; `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): chat state on the phone`.

### Task 7: l'écran « Demander à Ledge »

**Files:**
- Create : `apps/mobile/src/screens/Chat.tsx`, `apps/mobile/src/ui/chat/{Composer.tsx,TurnView.tsx}`
- Modify : `apps/mobile/src/{router.ts,App.tsx,copy.ts}`, `apps/mobile/src/ui/TabBar.tsx`, `apps/mobile/src/screens/{Inbox.tsx,Agents.tsx}` (ils rendent `TabBar` : passer `chat`)
- Test : `apps/mobile/test/screens/chat.test.tsx`, `apps/mobile/test/router.test.ts`, les tests existants d'Inbox et d'Agents

**Interfaces:**
- Route `{ name: 'chat' }` ↔ `#/chat` (ajoutée à `SIMPLE` et à l'union `Route`). La redirection de `#/chat` vers l'inbox sans `device.chat` est dans `App.tsx` (`parseRoute` reste pur).
- `TabBar` : `active?: 'inbox' | 'agents' | 'chat'` et `chat?: boolean`. Avec `chat`, 3 colonnes (`grid-cols-3`), sinon 2 comme aujourd'hui. `Inbox`, `Agents` et `Chat` passent `chat={!!device.chat}`.
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
- Les textes d'erreur sont exportés côté daemon aussi pour le corps de la notification (Task 9) : le daemon garde sa propre copie des quatre textes `busy`/`timeout`/`failed`/`cancelled`, mot pour mot.
- Pas des étapes (`steps`), libellés : `sessions` → `Lit les ${n} sessions…`, `pane` → `Regarde le terminal de ${name}…`, `reply` → `Lit la dernière réponse de ${name}…`, `git`/`repo` → `Regarde ${name}…`. Pas fini : coche verte ; pas en cours : indicateur animé (sans animation si `prefers-reduced-motion`).
- `subtitle` compte les sessions du snapshot et leurs `repo` distincts.
- Le champ grandit de 44 à 120 px ; `Entrée` sur clavier physique envoie, `Maj+Entrée` passe à la ligne.
- Sur `error.code === 'busy'`, le champ reprend `error.text`, puis `clearChatError()`.
- Entre cette tâche et la suivante, la réponse n'est pas encore rendue en Markdown : les tests de cette tâche ne la vérifient pas.

- [ ] **Step 1 : tests qui échouent.**
  - sans `snapshot.device.chat` → 2 onglets dans l'inbox et dans les agents, et `#/chat` renvoie vers l'inbox ; avec → 3 onglets ;
  - fil vide → le texte vide et les suggestions ; toucher une suggestion la pose ;
  - une question en cours → les pas, puis le bouton « Arrêter », qui envoie `chat.cancel` ;
  - `busy` → le texte `chat.busy`, et le champ garde la question ;
  - « Nouvelle conversation » est désactivé pendant une question ;
  - `subtitle(1, 1)` → « Fil du téléphone · 1 agent, 1 repo » ;
  - le routeur : `parseRoute('#/chat')` et `href({ name: 'chat' })`.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS ; `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): ask Ledge from the phone`.

### Task 8: la réponse et ses cartes

**Files:**
- Create : `apps/mobile/src/ui/chat/{Answer.tsx,RelayCard.tsx,LaunchCard.tsx}`
- Modify : `apps/mobile/src/ui/chat/TurnView.tsx`, `apps/mobile/src/copy.ts`
- Test : `apps/mobile/test/screens/chat-cards.test.tsx`

**Interfaces:**
- `Answer` : `parseReply(answer)` puis `ReplyView`, comme `Thread.tsx`. Le nom de chaque session **présente dans le snapshot** devient un lien vers `#/thread/<sid>` ; un nom absent reste du texte. La ligne « Sources : » liste les noms des pas `pane`/`reply`, liés de la même façon.
- `RelayCard`, avec `section aria-label="Consigne proposée"` :
  - en-tête « Envoyer à **{name}** · {repo} » (le `repo` de la session dans le snapshot, omis sinon), puis le texte ;
  - boutons « Ignorer » (masque la carte, côté téléphone seulement, perdu au rechargement) et « Envoyer » (`relay(qid)`) ;
  - après : `queued` → `En attente : {name} est occupé.` ; `sent` → « Envoyé à {name} · voir son fil » (lien vers le fil) ; `failed` (ou une promesse `failed`/`rejected`) → `Pas envoyé.`.
- `LaunchCard`, avec `section aria-label="Session proposée"` (hors maquette, même gabarit que `RelayCard`) :
  - en-tête `Lancer {tool} dans {project}`, puis le prompt ;
  - boutons « Ignorer » et un bouton de confirmation : libellé `copy.confirm.goApple` si `isApple()` (`screens/device.ts`), sinon `copy.confirm.go`, comme `RiskConfirm.tsx` ; il appelle `launch(qid, [row])` (le store fait l'appel WebAuthn, Task 6). Pas d'extraction de `RiskConfirm.tsx` ;
  - plusieurs propositions → une ligne par proposition, chacune avec son bouton ;
  - après : `launchedId` → `Lancée · voir son fil` ; `failed` → `Pas lancée.` ;
  - `cancelled` → `copy.confirm.cancelled`, `expired` → `copy.confirm.expired`, et la carte reste proposée ;
  - sans credential sur l'appareil (`snapshot.device.confirm` faux) : `chat.launchSetup = 'Protégez d'abord vos accords depuis Connexion.'`, avec un lien vers `#/connection`, et le bouton désactivé.

- [ ] **Step 1 : tests qui échouent.**
  - une réponse qui cite « Bix » (présent) et « Kai » (absent) → un lien pour Bix, du texte pour Kai ;
  - une carte de consigne → « Envoyer » appelle `relay` ; l'état `sent` montre « Envoyé à Nova · voir son fil » ;
  - « Ignorer » masque la carte sans rien envoyer ;
  - deux propositions → deux boutons, et le second appelle `launch(qid, [1])` ;
  - sur iPhone (user agent simulé) le bouton dit le texte de `copy.confirm.goApple` ;
  - annulation de la vérification → `confirm.cancelled`, et la carte reste proposée ;
  - sans credential → `chat.launchSetup`, lien vers `#/connection`, bouton désactivé.
- [ ] **Step 2 :** implémenter.
- [ ] **Step 3 :** `pnpm --filter @ledge/mobile test` → PASS ; `pnpm -r typecheck` → PASS.
- [ ] **Step 4 :** commit `feat(mobile): act on the chat's cards from the phone`.

### Task 9: « Ledge a répondu », de bout en bout, et feuille de route

**Files:**
- Modify : `packages/ledge/src/mobile/push/notifier.ts`, `packages/ledge/src/daemon/server.ts` (câbler `onChatEnd`)
- Create : `apps/mobile/e2e/chat.spec.ts`
- Modify : `apps/mobile/e2e/harness.ts` (le faux daemon répond au chat), `docs/superpowers/plans/2026-10-19-ledge-mobile-relay-roadmap.md`
- Test : `packages/ledge/test/mobile-push-notifier.test.ts`, `apps/mobile/e2e/chat.spec.ts`

**Interfaces:**
- Consumes : `createNotifier` et `presence` (lot 6b), `onChatEnd` (Task 3).
- `notify(p, sessionId: string | undefined, only?: string)`. Avec `only`, il n'envoie qu'à cet appareil (filtre dans la liste des cibles). L'urgence est `normal` pour `finished` et `chat`, `high` sinon.
- `server.ts` câble `onChatEnd` de la gateway sur le notifieur (créé après la gateway : une fonction liée tardivement). À la fin d'une question d'un fil d'appareil, si l'appareil n'est pas visible, la notification des Global Constraints part vers lui seul, avec `badge` calculé comme pour les autres pushes (le nombre de demandes en attente). En cas d'erreur, le corps est le texte du code (Task 7, copie daemon).
- Le faux daemon de `harness.ts` gagne un chat scripté : `chat.ask` → deux pas, deux deltas, puis `done` avec une carte de consigne (vers « Nova ») et une carte de lancement.

- [ ] **Step 1 : tests qui échouent.**
  - **notifieur :** fin d'une question d'un appareil caché → un push vers lui seul, corps sans le texte de la réponse, urgence `normal` ; appareil visible → aucun ;
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
  - le lancement sous vérification de l'appareil, refusé depuis le téléphone dans un dossier trop large ;
  - la consigne sans vérification de l'appareil (risque accepté, comme sur le PC) ; une carte trop longue n'est jamais montrée ;
  - une notification sans le texte de la réponse.
  Y noter, pour plus tard, l'historique gardé au redémarrage du daemon (les tours restent en mémoire, comme sur le PC) et une limite de fréquence par appareil.
- [ ] **Step 4 :** suite complète `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter @ledge/mobile build` et `test:e2e`. Seuls les échecs connus (tmux, charge, `update.spec.ts:106`) sont tolérés, et chacun est relancé seul pour le confirmer.
- [ ] **Step 5 :** commit `test(mobile): phone chat end to end; roadmap updated`.

## Hors de ce lot

- **Le routage multi-machines** (`chat.route`, `fleet.ts`) : le fil du téléphone interroge le PC auquel il est lié.
- **La carte « projet proposé »** (`projectProposal`) : elle ne montre que des chemins de dossiers, qui ne sortent pas du PC.
- **Le choix de l'outil depuis le téléphone.**
- **L'historique des fils gardé au redémarrage du daemon.**
- **Une limite de fréquence des questions par appareil** (le plafond de 3 et « une à la fois » bornent déjà la charge).
- **Lot 7 :** essai sur un vrai iPhone.
