# Lot 4 : le fil de Ledge et les réponses aux escalades (plan d'implémentation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une seule conversation utilisateur ↔ Ledge (`~/.ledge/ledge-thread.jsonl`), où les escalades des rigs arrivent comme des décisions dans le message, auxquelles l'utilisateur répond d'un clic depuis Desktop, l'encoche ou À toi ; la réponse part vers OpenRig une seule fois.

**Architecture :**
- Daemon : un module `ledgeThread` (persistance JSONL, pagination, regroupement des échanges) et un module `openrig/answer.ts` (réponse atomique, « la première gagne »). `ledge.say` passe par le coureur ponctuel d'aujourd'hui (`chat/service.ts`), dont les cartes d'action restent ; un `@siège` en tête part par `rig send`.
- Clients : `@ledge/fleet` tient le fil ; les composants du fil vivent dans `packages/ui/src/chat/ledge/` (Desktop et encoche, et plus tard le mobile) ; Desktop refait l'écran Ledge (onglets, rail, saisie) et À toi ; l'encoche prend l'apparence de Ledge seul et son mode `chat` devient le fil mêlé.
- Le cerveau (lot 7) n'existe pas encore : ce lot laisse les points d'accroche (`onAnswered`, routage de `ledge.say`) sans les remplir.

**Tech Stack :** TypeScript ESM, zod, vitest, React, playwright (`apps/desktop`, `apps/overlay`).

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` (§4.4, §5.1 « sans cerveau », §6, §8.1 À toi, §8.2, §8.5). **Plan maître :** `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md` : son contrat de protocole et ses Global Constraints font foi. **Fiche de faits :** `docs/superpowers/specs/2026-10-30-openrig-facts.md` (lot 0), qui fixe le chemin de réponse.

**Maquettes :** `docs/mockups/ledge-openrig/shots/` : `c-A.png` (écran Ledge, Conversation et rail), `nn-open.png` (encoche ouverte), `nn-closed-{calm,exchange,decided,foryou}.png` (encoche fermée). L'onglet « Décisions » des maquettes n'existe pas : il est fondu dans Mandat (spec §8.2, [U]).

## Ce que ce lot suppose des lots 1 et 2

Avant la tâche 1, l'exécutant lit les exports réels des lots 1 et 2 et **adapte les noms ci-dessous sans changer leur sens**. S'il manque une capacité, il l'ajoute dans le module du lot 2, dans la tâche qui en a besoin.

- `packages/ledge/src/daemon/openrig/index.ts` exporte un pont `OpenRigBridge` qui offre :
  - `escalations: { all(): Escalation[]; get(id): Escalation | undefined; patch(id, p: Partial<Escalation>): Escalation | undefined; onChange(fn: (e: Escalation, removed: boolean) => void): () => void }` ;
  - `rigs(): Rig[]` ;
  - `onExchange(fn: (x: Exchange) => void): () => void` ;
  - `status(machine): OpenRigStatus` ;
  - `cli(machine): { run(args: string[], o?: { stdin?: string }): Promise<{ code: number; stdout: string; stderr: string }> }` ;
  - `http(machine): { post(path: string, body: unknown, o?: { session?: string }): Promise<{ status: number; json: unknown }> ; get(path: string): Promise<{ status: number; json: unknown }> }`.
- Les `ledge ask` du lot 1 (`daemon/asks.ts`, `~/.ledge/asks.json`) sont présentés comme des `Escalation` de `source: 'ask'`, d'id `ask-<id>`, et `asks.answer(id: string, text: string): string | null` (null = réveil envoyé, sinon la raison) existe. Si le lot 2 ne les verse pas dans `escalations`, la tâche 3 ajoute l'adaptateur `asksAsEscalations(asks): Escalation[]`.
- Le faux `packages/ledge/test/fakes/openrig.ts` exporte `createFakeOpenRig()`, avec un pont branché sur ce faux, `pushEscalation(e)`, `pushExchange(x)`, et le journal `calls` des appels CLI et HTTP reçus.
- `@ledge/fleet` tient déjà `rigs`, `escalations` et `exchanges` (par `machine/rigId`) dans `DaemonState`.
- Noms du contrat fixés par le lot 2 : `LedgeDecision` et `LedgeRule` (et non `Decision`/`Rule`), `SessionRigSchema`, `RIG_RESULT_CODES`, `EXCHANGES_MAX` (200). L'appariement des sièges passe par `session.event.openrig`.
- Lot 6 : il ajoute `Escalation.answer.delivery?: 'queued' | 'sent'` et rend les gestionnaires idempotents par `rid` en les enveloppant. Ce lot n'ajoute rien pour cela : il garde `answers.answer` comme point d'entrée unique, que le lot 6 enveloppe.

## Global Constraints

Celles du plan maître, plus :
- Fenêtre des groupes d'échanges : **un groupe se ferme après 10 min sans échange** (`EXCHANGE_GROUP_MS = 600_000`).
- Pagination du fil : **50 éléments** par page (`THREAD_PAGE = 50`), les plus récents d'abord au branchement.
- Libellés mot pour mot : « Conversation », « Rigs », « Mandat », « À toi », « Tranché aujourd'hui », « Résumer la journée », « Mon avis : », « En parler », « Revenir dessus », « Replier », « Voir », « Seulement Ledge », « Ledge s'en occupe… », « Écrire à Ledge… (@build pour un agent d'un rig) » (Desktop), « Écrire à Ledge… (@build pour un agent) » (encoche), les suggestions « Lance un rig… », « Où en est factory ? », « Qu'as-tu tranché ? », « Qui a besoin de moi ? », et le pied « tranche dans son mandat · design, architecture et critique te reviennent ».
- Libellés des catégories (partagés avec le lot 7) : `git` « Git et branches », `tests` « Tests et relectures », `context` « Contexte et relèves », `code` « Petits choix de code », `design` « Design », `architecture` « Architecture », `critical` « Critique ».
- Le coureur ponctuel ne répond qu'à **une question à la fois** : un `ledge.say` reçu pendant une réponse attend son tour (5 au plus en attente), il n'est jamais refusé en silence.
- Toute réponse à une escalade, d'où qu'elle vienne, passe par `answers.answer(…)` (tâche 3). Aucun autre code n'appelle `rig queue` ni `mission-control` pour répondre.

## Review Focus

1. **Deux réponses à la même escalade** (Desktop et encoche dans la même seconde, ou un clic pendant qu'une réponse part encore). Attendu : un seul envoi vers OpenRig ; l'autre reçoit `rig.result { code: 'already_answered' }` et sa carte montre « Déjà répondu ». Test : tâche 3, `second answer while the first is in flight gets already_answered`.
2. **OpenRig tombe entre la ligne de réponse et la fermeture** (`approve` échoue après `rig queue create`). Attendu : l'escalade revient `pending`, la carte dit l'échec, et un nouveau clic ne crée pas une deuxième ligne de réponse : il ne refait que la fermeture. Test : tâche 3, `retry after a failed approve reuses the reply row`.
3. **`ledge-thread.jsonl` tronqué** (daemon tué au milieu d'une écriture) ou contenant une ligne illisible. Attendu : le fil se charge sans la ligne cassée, le reste est intact, et l'écriture suivante commence sur une ligne neuve. Test : tâche 2, `a torn last line is skipped and the next append starts clean`.
4. **`@siège` inconnu, ambigu ou arrêté** (`@build` dans deux rigs, rig `stopped`). Attendu : rien ne part ; Ledge répond dans le fil, avec les adresses possibles (`@build@factory`, `@build@starter`) ou l'état du rig. Test : tâche 6.
5. **Deux messages à Ledge coup sur coup** pendant que le coureur ponctuel répond encore. Attendu : le second attend et reçoit sa réponse ensuite, dans l'ordre ; au-delà de 5 en attente, une bulle de Ledge le dit. Test : tâche 5, `a say while answering waits its turn`.

---

### Task 1 : les compléments du contrat de protocole

**Files :**
- Modify : `packages/protocol/src/openrig.ts` (fichier du lot 2)
- Modify : `packages/protocol/src/messages.ts`
- Test : `packages/protocol/test/openrig-thread.test.ts`

**Interfaces :**
- Produces :
  - `LedgeThreadItemSchema` : l'élément `ledge` gagne `qid?: string` (le tour du coureur ponctuel dont les cartes suivent la bulle) et `pending?: true` (bulle « Ledge lit… » tant que le tour n'est pas fini) ; l'élément `user` gagne `qid?: string`.
  - `ledge.say { rid, text, about?: string }` : `about` = id d'escalade (« En parler »).
  - `MANDATE_CATEGORY_LABEL: Record<MandateCategory, { fr: string; en: string }>` (libellés des Global Constraints).
  - `EXCHANGE_GROUP_MS = 600_000`, `THREAD_PAGE = 50`.
  - `RIG_RESULT_CODES` gagne `'invalid'` (réponse vide ou question sans réponse). `AnswerCode` (tâche 3) est un sous-ensemble de `RIG_RESULT_CODES`, que le typage vérifie.
  - Règle d'upsert, écrite en commentaire au-dessus de `LedgeThreadItemSchema` : un `ledge.thread.item` dont l'`id` existe déjà **remplace** l'élément chez le client (groupe d'échanges qui grandit, bulle qui se termine).

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('a ledge item may name its chat turn', () => {
  expect(LedgeThreadItemSchema.parse({ kind: 'ledge', id: 'l1', at: AT, text: 'Bonjour', qid: 'q-1' }).qid).toBe('q-1');
});
test('ledge.say may be about an escalation', () => {
  expect(ClientMessageSchema.parse({ type: 'ledge.say', rid: 'r', text: 'pourquoi ?', about: 'qi-7' })).toMatchObject({ about: 'qi-7' });
});
test('invalid is a rig result code', () => { expect(RIG_RESULT_CODES).toContain('invalid'); });
test('every category has a French label', () => {
  expect(MANDATE_CATEGORY_LABEL.git.fr).toBe('Git et branches');
  expect(MANDATE_CATEGORY_LABEL.critical.fr).toBe('Critique');
});
```

- [ ] **Step 2 : lancer et voir l'échec**

Run : `pnpm --filter @ledge/protocol test -- openrig-thread`
Expected : FAIL, `qid` retiré par zod, `MANDATE_CATEGORY_LABEL` non défini.

- [ ] **Step 3 : ajouter les champs, les constantes et le commentaire d'upsert**

- [ ] **Step 4 : relancer**

Run : `pnpm --filter @ledge/protocol test && pnpm typecheck`
Expected : PASS.

- [ ] **Step 5 : commit** `feat(protocol): ledge thread item links its chat turn, say about an escalation`

---

### Task 2 : le fil de Ledge dans le daemon

**Files :**
- Create : `packages/ledge/src/daemon/ledgeThread.ts`
- Modify : `packages/ledge/src/paths.ts` (`ledgeThread: join(dir, 'ledge-thread.jsonl')`)
- Test : `packages/ledge/test/ledge-thread.test.ts`

**Interfaces :**
- Produces :
```ts
export interface LedgeThread {
  append(item: DistributiveOmit<LedgeThreadItem, 'id' | 'at'> & { id?: string; at?: string }): LedgeThreadItem;
  upsert(item: LedgeThreadItem): LedgeThreadItem;
  get(id: string): LedgeThreadItem | undefined;
  page(before?: string, size?: number): { items: LedgeThreadItem[]; before?: string };   // items du plus ancien au plus récent ; before = id du plus ancien s'il en reste
  exchange(x: Exchange): LedgeThreadItem | null;  // le groupe créé ou agrandi ; null pour kind 'ledge'
  hasEscalation(escalationId: string): boolean;
  onItem(fn: (item: LedgeThreadItem) => void): () => void;
  flush(): Promise<void>;
}
export function createLedgeThread(o: { path: string; now?: () => string; uuid?: () => string; groupMs?: number }): LedgeThread;
```

Persistance : une ligne JSON par écriture, en ajout seul ; au chargement, la **dernière ligne d'un id gagne**, l'ordre est celui de la première apparition. Le fichier est compacté au chargement quand il a plus de deux fois plus de lignes que d'ids. Écritures sérialisées par une file de promesses (comme `fileJournal` de `mailbox.ts`).

Regroupement : un échange agrandit le groupe ouvert du même `machine/rigId` si `x.at − group.to ≤ groupMs` **et** si aucun élément d'une autre sorte (`user`, `ledge`, `escalation`, `decided`, `card`) n'a été ajouté après ce groupe ; sinon un nouveau groupe commence. Les échanges `kind: 'ledge'` (ce que Ledge a envoyé lui-même) ne sont pas groupés : l'élément `user` (tâche 6) ou `decided` (lot 7) les montre déjà.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('items survive a restart, last line of an id wins', async () => { /* append l1, upsert l1 texte 'b', recharge → get('l1').text === 'b', page().items.length === 1 */ });
test('page returns the latest 50 then the older ones', async () => { /* 120 items → page().items.length 50, page().before = id du 71e ; page(before).items.length 50 ; troisième page 20, sans before */ });
test('exchanges of one rig within 10 min share a group', () => {
  // 16:36, 16:40, 16:42 → un seul item exchanges, from 16:36, to 16:42, 3 exchangeIds
});
test('a gap over 10 min, or a ledge bubble in between, starts a new group', () => { /* 16:36 puis 16:47 → 2 groupes ; 16:36, bulle, 16:37 → 2 groupes */ });
test('two rigs interleaved keep their own groups', () => { /* factory 16:36, starter 16:37, factory 16:38 → factory 2 ids, starter 1 id */ });
test('an exchange of kind ledge is not grouped', () => { expect(thread.exchange({ ...x, kind: 'ledge' })).toBeNull(); });
test('a torn last line is skipped and the next append starts clean', async () => {
  // fichier : ligne valide + '{"kind":"user","id":"u2"' sans fin de ligne → charge 1 item ; append u3 → recharge 2 items
});
test('hasEscalation is true once an escalation item exists', () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- ledge-thread` ; Expected : FAIL, module absent.
- [ ] **Step 3 : implémenter `createLedgeThread`** selon l'interface ci-dessus. Une ligne illisible est sautée et journalisée (`log`) ; un fichier qui ne finit pas par `\n` reçoit un `\n` avant la première écriture.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): ledge thread store with exchange groups and paging`

---

### Task 3 : répondre à une escalade (`openrig/answer.ts`)

**Files :**
- Create : `packages/ledge/src/daemon/openrig/answer.ts`
- Test : `packages/ledge/test/openrig-answer.test.ts`

**Interfaces :**
- Consumes : `OpenRigBridge` (section des suppositions), `asks.answer` (lot 1), la fiche de faits.
- Produces :
```ts
/** Ce que la fiche de faits du lot 0 a retenu. */
export type AnswerPath =
  | { kind: 'reply-and-approve' }   // ligne de réponse au siège, puis approve de la ligne humaine (spec §4.4)
  | { kind: 'approve-only' }        // approve porte déjà la réponse jusqu'au siège
  | { kind: 'resolve' };            // plan B : `resolve` sur la ligne bloquée sur human-ledge@host
export type AnswerCode = 'already_answered' | 'openrig_down' | 'unreachable' | 'failed' | 'invalid';
export type AnswerResult = { ok: true; escalation: Escalation } | { ok: false; code: AnswerCode; reason: string };
export interface Answers {
  answer(id: string, answers: Record<string, string>, by: 'user' | 'ledge', o?: { rule?: string }): Promise<AnswerResult>;
  /** Appelé une fois par réponse réussie (le lot 7 y branche décisions et mémoire). */
  onAnswered(fn: (e: Escalation) => void): () => void;
}
export function createAnswers(d: { bridge: OpenRigBridge; asks: { answer(id: string, text: string): string | null }; path: AnswerPath; localMachine: string; now?: () => string; journal?: { replyRow(id: string): string | undefined; setReplyRow(id: string, row: string): void } }): Answers;
export function answerBody(e: Escalation, answers: Record<string, string>): string;   // « Réponse de Ledge : <question> → <libellé> », une ligne par question ; une valeur qui n'est pas un id d'option est un texte libre, citée telle quelle
export function readAnswerPath(factsMarkdown: string): AnswerPath;                     // lit la ligne « Chemin de réponse : reply-and-approve | approve-only | resolve » de la fiche
```

Règles :
- **La première gagne, de façon atomique** : avant le premier `await`, `answer` vérifie et marque en mémoire (`inFlight: Set<string>`). Un id déjà dans `inFlight`, ou une escalade `answered`/`closed`, renvoie `already_answered`. Le daemon est mono-fil : ce test et ce marquage synchrones suffisent.
- L'escalade passe tout de suite `answered`, avec `answer: { by, answers, at, rule? }` (`bridge.escalations.patch`). En cas d'échec, elle revient à son état d'avant (`pending` ou `grace`), sans `answer`.
- **Ligne de réponse idempotente** : l'id de la ligne créée par `rig queue create … --json` est noté (`journal.setReplyRow`) avant la fermeture. Une nouvelle tentative qui trouve une ligne notée ne la recrée pas.
- Commandes, selon `path` :
  - `reply-and-approve` : `rig queue create --destination <from> --summary "Réponse de Ledge : <résumé>" --body-file <tmp> --json`, plus `--reply-to <id>` pour un `update`, puis `POST /api/mission-control/action { verb: 'approve', qitemId: id, annotation: answerBody }` ;
  - `approve-only` : seulement l'`approve` ;
  - `resolve` : la commande exacte de la fiche de faits.
- `intent: 'update'` avec `answers` vide : seulement l'`approve` (« vu »), quel que soit le chemin.
- `source: 'ask'` : `asks.answer(id sans 'ask-', answerBody)`, sans OpenRig.
- Une escalade d'une autre machine que `localMachine` renvoie `unreachable`, avec la raison « réponse à distance : lot 6 ».
- `bridge.status(machine).state !== 'running'` renvoie `openrig_down`, sans rien marquer.
- Une valeur de réponse qui n'est ni un id d'option de sa question ni un texte non vide, ou une question sans réponse, renvoie `invalid`.

- [ ] **Step 1 : écrire les tests qui échouent** (avec `createFakeOpenRig()`)

```ts
test('reply-and-approve creates the reply row then approves', async () => {
  const r = await answers.answer('qi-1', { q1: 'sqlite' }, 'user');
  expect(r.ok).toBe(true);
  expect(fake.calls.map(c => c.kind)).toEqual(['cli:queue create', 'http:/api/mission-control/action']);
  expect(fake.calls[1].body).toMatchObject({ verb: 'approve', qitemId: 'qi-1' });
  expect(bridge.escalations.get('qi-1')).toMatchObject({ state: 'answered', answer: { by: 'user', answers: { q1: 'sqlite' } } });
});
test('second answer while the first is in flight gets already_answered', async () => {
  fake.holdNext();                                   // le premier appel CLI attend
  const first = answers.answer('qi-1', { q1: 'sqlite' }, 'user');
  const second = await answers.answer('qi-1', { q1: 'json' }, 'ledge');
  expect(second).toEqual({ ok: false, code: 'already_answered', reason: expect.any(String) });
  fake.release(); expect((await first).ok).toBe(true);
  expect(fake.calls.filter(c => c.kind === 'cli:queue create')).toHaveLength(1);
});
test('an answered escalation refuses another answer', async () => { /* … already_answered */ });
test('retry after a failed approve reuses the reply row', async () => {
  fake.failNext('http:/api/mission-control/action');
  expect((await answers.answer('qi-1', { q1: 'sqlite' }, 'user'))).toMatchObject({ ok: false, code: 'failed' });
  expect(bridge.escalations.get('qi-1')?.state).toBe('pending');
  await answers.answer('qi-1', { q1: 'sqlite' }, 'user');
  expect(fake.calls.filter(c => c.kind === 'cli:queue create')).toHaveLength(1);
});
test('openrig down refuses without touching the escalation', async () => { /* status stopped → openrig_down, state pending */ });
test('an update is closed with approve only', async () => { /* intent update, {} → un seul appel approve */ });
test('an ask is answered through asks, not OpenRig', async () => { /* id ask-3 → asks.answer('3', …) ; fake.calls vide */ });
test('a remote escalation is unreachable until lot 6', async () => { /* machine 'ec2-build' → unreachable */ });
test('an empty or missing answer is invalid, free text is not', async () => { /* { q1: '' } → invalid ; {} sur une decision → invalid ; { q1: 'les deux, en lecture seule' } → ok */ });
test('readAnswerPath reads the facts sheet line', () => {
  expect(readAnswerPath('…\nChemin de réponse : resolve\n…')).toEqual({ kind: 'resolve' });
});
test('onAnswered fires once per successful answer', async () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- openrig-answer` ; Expected : FAIL, module absent.
- [ ] **Step 3 : implémenter `createAnswers`, `answerBody`, `readAnswerPath`.** Le journal des lignes de réponse vit dans `openrig.json` (lot 2), sous la clé `replyRows`. La fiche est lue une fois au démarrage du daemon. Si elle n'existe pas, `reply-and-approve` s'applique, avec une ligne au journal.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): answer escalations once, first answer wins`

---

### Task 4 : brancher le fil et les réponses dans le serveur

**Files :**
- Modify : `packages/ledge/src/daemon/server.ts` (création du fil et des réponses, nouveaux `case`, envois à la connexion)
- Test : `packages/ledge/test/ledge-thread-server.test.ts`

**Interfaces :**
- Consumes : tâches 2 et 3.
- Produces (côté fil) :
  - à chaque connexion, après le snapshot : `ledge.thread.history` = `thread.page()` ;
  - `ledge.thread.request { before }` → `ledge.thread.history` (à ce client seul) ;
  - chaque `thread.onItem` → `ledge.thread.item` à tous ;
  - une escalade nouvelle (`escalations.onChange`, id inconnu du fil, `intent` quelconque) → `thread.append({ kind: 'escalation', escalationId })` ;
  - `bridge.onExchange` → `thread.exchange(x)` ;
  - `escalation.answer { rid, id, answers, by: 'user' }` → `answers.answer(id, answers, 'user')` → `rig.result { rid, ok, code?, reason? }` (à ce client).

- [ ] **Step 1 : écrire les tests qui échouent** (serveur réel sur port libre, faux OpenRig, comme `daemon.test.ts`)

```ts
test('a new client gets the latest thread page', async () => { /* 3 items → message ledge.thread.history avec 3 items */ });
test('a new escalation appears once in the thread', async () => { /* pushEscalation deux fois (update de l'état) → un seul item escalation */ });
test('exchanges become one growing group item', async () => { /* 2 pushExchange → 2 ledge.thread.item de même id, le second avec 2 exchangeIds */ });
test('escalation.answer answers and replies rig.result', async () => { /* ok:true ; escalation.updated state answered */ });
test('two clients answering the same escalation: one ok, one already_answered', async () => {
  // deux connexions envoient escalation.answer dans la même boucle
  expect(results.map(r => r.ok).sort()).toEqual([false, true]);
  expect(results.find(r => !r.ok)).toMatchObject({ code: 'already_answered' });
});
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- ledge-thread-server` ; Expected : FAIL.
- [ ] **Step 3 : câbler dans `server.ts`** : `const thread = createLedgeThread({ path: paths().ledgeThread, now })`, et `const answers = createAnswers({ … path: readAnswerPath(…) })`. Les cas `escalation.answer` et `ledge.thread.request` sont ajoutés près des cas `chat.*`. Le relais mobile laisse déjà passer ces types (plan maître) ; il faut vérifier que `escalation.answer` n'exige pas la clé d'accès (`packages/ledge/src/mobile/` : liste des messages à clé).
- [ ] **Step 4 : relancer** `pnpm --filter @ledge/ledge test` — Expected : PASS (toute la suite).
- [ ] **Step 5 : commit** `feat(ledge): serve the ledge thread and escalation answers`

---

### Task 5 : `ledge.say` par le coureur ponctuel

**Files :**
- Create : `packages/ledge/src/daemon/ledgeSay.ts`
- Modify : `packages/ledge/src/chat/service.ts` (aucune nouvelle méthode : on utilise `ask`, qui émet `chat.*`)
- Modify : `packages/ledge/src/chat/context.ts` (écrit `rigs.md` et `escalations.md`)
- Modify : `packages/ledge/src/chat/persona.ts` (`FIXED` : cite `rigs.md` et `escalations.md` ; plus de `teams.md` ni `tasks.md`)
- Modify : `packages/ledge/src/daemon/server.ts` (cas `ledge.say`)
- Test : `packages/ledge/test/ledge-say.test.ts`, `packages/ledge/test/chat-context.test.ts`, `packages/ledge/test/chat-persona.test.ts`

**Interfaces :**
- Consumes : `Chat.ask(qid, text, emit, tool)` (`chat/service.ts`), `LedgeThread`.
- Produces :
```ts
export interface LedgeSay {
  /** Ajoute l'élément user, puis route : `@siège` en tête → tâche 6 ; sinon le répondeur courant. */
  say(rid: string, text: string, about?: string): Promise<void>;
  /** Le lot 7 remplace le répondeur quand le cerveau est actif. */
  setResponder(r: Responder | null): void;
}
export type Responder = (item: Extract<LedgeThreadItem, { kind: 'user' }>, about?: Escalation) => Promise<void>;
export function createLedgeSay(d: { thread: LedgeThread; chat: Chat; escalations: OpenRigBridge['escalations']; toSeat: (rid: string, text: string) => Promise<SeatSendResult | null>; tool: () => Tool; broadcast: (m: ServerMessage) => void; maxWaiting?: number }): LedgeSay;
```

Comportement du répondeur ponctuel (par défaut) :
- Il crée `qid = user.id`. L'élément `user` porte ce `qid`, puis un élément `ledge { qid, text: '', pending: true }` est ajouté.
- Il appelle `chat.ask(qid, question, emit, tool())`, et `emit` diffuse les `chat.*` tels quels : les clients gardent les cartes du tour par `chat.history`.
- À `chat.done`, la bulle est remplacée (`upsert`) par `{ text, qid }`, sans `pending`. À `chat.error`, le texte devient « Je n'ai pas pu répondre : <message> ».
- Avec `about`, la question est préfixée d'une ligne : `[Ledge] L'utilisateur parle de l'escalade <id> (<from>, <catégorie?>) : « <summary> ». Ses options : …`.
- File : un `say` reçu pendant un tour attend la fin du tour (`chat.idle()`). Au-delà de `maxWaiting` (5), Ledge ajoute la bulle « Je réponds encore à tes messages précédents : renvoie celui-ci dans un instant. » et n'envoie pas la question.
- `chat.reset` (bouton « + » de l'en-tête) reste, et repart sur une conversation neuve du coureur.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('say appends the user item then a pending bubble completed by chat.done', async () => {
  // faux Chat qui émet chat.delta puis chat.done 'Deux rigs tournent.'
  expect(kinds(thread)).toEqual(['user', 'ledge']);
  expect(last(thread)).toMatchObject({ kind: 'ledge', text: 'Deux rigs tournent.', qid: userId });
  expect(last(thread).pending).toBeUndefined();
});
test('a say while answering waits its turn', async () => { /* 2 say → chat.ask appelé 2 fois, dans l'ordre, le second après done du premier */ });
test('past 5 waiting, Ledge says so instead of queueing', async () => { /* … bulle exacte */ });
test('about prefixes the question with the escalation', async () => { /* question commence par "[Ledge] L'utilisateur parle de l'escalade qi-1" */ });
test('a chat error ends the bubble with the reason', async () => { /* … */ });
test('setResponder replaces the one-shot runner', async () => { /* responder custom appelé, chat.ask jamais */ });
// chat-context.test.ts
test('the context lists rigs and pending escalations', async () => { /* rigs.md contient "factory · 4/6 au travail" ; escalations.md contient l'id et le résumé */ });
// chat-persona.test.ts
test('the persona names rigs.md and escalations.md, not teams.md', () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- ledge-say chat-context chat-persona` ; Expected : FAIL.
- [ ] **Step 3 : implémenter `createLedgeSay`, les fichiers de contexte (`writeContext` reçoit `rigs` et `escalations` en plus) et le cas `ledge.say`** dans `server.ts`, qui répond `rig.result { rid, ok: true }` dès que l'élément `user` est écrit.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): ledge.say answered by the one-shot runner, cards kept`

---

### Task 6 : écrire à un siège (`@build …`)

**Files :**
- Create : `packages/ledge/src/daemon/openrig/seatSend.ts`
- Modify : `packages/ledge/src/daemon/server.ts` (cas `rig.send`, et `toSeat` passé à `createLedgeSay`)
- Test : `packages/ledge/test/openrig-seat-send.test.ts`

**Interfaces :**
- Produces :
```ts
export type SeatTarget = { ok: true; rig: Rig; seat: RigSeat } | { ok: false; reason: string; candidates?: string[] };
/** `@build` (unique parmi les rigs en marche) ou `@build@factory`. */
export function resolveSeatAddress(word: string, rigs: Rig[]): SeatTarget;
/** Le mot `@…` en tête du texte et le reste ; null si le texte ne commence pas par `@`. */
export function leadingAddress(text: string): { word: string; rest: string } | null;
export type SeatSendResult = { ok: true; to: string } | { ok: false; reason: string };
export function createSeatSend(d: { bridge: OpenRigBridge }): {
  send(machine: string, seatRef: string, text: string): Promise<SeatSendResult>;      // `rig send <seatRef> "[Ledge] <texte>"`
  fromSay(rid: string, text: string): Promise<SeatSendResult | null>;                  // null : le texte ne vise pas un siège
};
```

Règles :
- Seuls comptent les rigs `running` ou `partial`, et les sièges qui ne sont ni `stopped` ni `crashed`. Pour un siège arrêté, la raison est « @build est arrêté (factory) ».
- Une adresse ambiguë donne la raison « Plusieurs agents s'appellent @build : » suivie des `candidates` (`@build@factory`, `@build@starter`).
- La signature du message est le préfixe `[Ledge] `, à remplacer si la fiche de faits en fixe une autre.
- Un mot `@x` qui n'est l'adresse d'aucun siège : `fromSay` renvoie `null`, et le texte va à Ledge comme une question.
- Dans le fil, un envoi réussi donne l'élément `user` avec `to: '@build'`, sans bulle de Ledge. Un échec donne l'élément `user`, puis une bulle de Ledge avec la raison.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('a unique seat address resolves', () => { expect(resolveSeatAddress('@review-a', rigs)).toMatchObject({ ok: true, seat: { ref: 'dev-review-a@factory' } }); });
test('an ambiguous address lists candidates', () => {
  expect(resolveSeatAddress('@build', rigs)).toEqual({ ok: false, reason: expect.stringContaining('Plusieurs agents'), candidates: ['@build@factory', '@build@starter'] });
});
test('@build@factory picks the rig', () => { /* ok, rig factory */ });
test('a stopped seat is refused with its state', () => { /* reason "@qa est arrêté (factory)" */ });
test('send runs rig send signed Ledge', async () => {
  await seatSend.send('local', 'dev-build@factory', 'relance les tests');
  expect(fake.calls.at(-1)).toMatchObject({ kind: 'cli:send', args: ['send', 'dev-build@factory', '[Ledge] relance les tests'] });
});
test('a word that is no seat goes to Ledge', async () => { expect(await seatSend.fromSay('r', '@Otto où en es-tu ?')).toBeNull(); });
test('say "@build …" sends and adds a user item with to', async () => { /* via createLedgeSay : thread = [user{to:'@build'}], chat.ask jamais appelé */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ledge test -- openrig-seat-send` ; Expected : FAIL.
- [ ] **Step 3 : implémenter `seatSend.ts`, puis les cas `rig.send` et `toSeat`.** `rig.send` répond par `rig.result`. Une machine distante est refusée avec le code `unreachable` (lot 6).
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ledge): write to a rig seat with @seat, signed Ledge`

---

### Task 7 : le fil dans `@ledge/fleet`

**Files :**
- Modify : `packages/fleet/src/store.ts` (`ledgeThread`, `threadBefore`, `threadLoading`, et `answering: Map<id, { rid; result? }>`)
- Create : `packages/fleet/src/ledgeThread.ts`
- Modify : `packages/fleet/src/index.ts`
- Test : `packages/fleet/test/ledge-thread.test.ts`

**Interfaces :**
- Produces :
```ts
export function mergeThread(items: readonly LedgeThreadItem[], incoming: readonly LedgeThreadItem[]): LedgeThreadItem[];   // upsert par id, tri par at puis ordre d'arrivée
export function useLedgeThread(): { items: LedgeThreadItem[]; hasOlder: boolean; loadOlder(): void };
export function answerEscalation(client: DaemonClient, id: string, answers: Record<string, string>): string;   // envoie escalation.answer, note le rid dans answering, renvoie le rid
export function useAnswerState(id: string): { state: 'idle' | 'sending' | 'done' | 'refused'; code?: string; reason?: string };
export function sayToLedge(client: DaemonClient, text: string, about?: string): void;
```

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('history then items merge by id', () => { /* history [a,b] + item b' → [a,b'] */ });
test('older history is prepended and before kept', () => { /* … hasOlder false quand before absent */ });
test('rig.result already_answered marks the answer refused with its code', () => { /* useAnswerState → { state: 'refused', code: 'already_answered' } */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/fleet test -- ledge-thread` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** Le fil n'est tenu que pour le daemon local, celui du cerveau : un `ledge.thread.*` d'un daemon distant est ignoré.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(fleet): hold the ledge thread and answer states`

---

### Task 8 : les composants partagés du fil

**Files :**
- Create : `packages/ui/src/chat/ledge/copy.tsx` (`LedgeThreadCopy`, `LedgeThreadCopyProvider`, `useLedgeThreadCopy`, sur le modèle de `chat/copy.tsx` : aucun texte dans `@ledge/ui`)
- Create : `packages/ui/src/chat/ledge/threadModel.ts`
- Create : `packages/ui/src/chat/ledge/EscalationCard.tsx`, `DecidedLine.tsx`, `ExchangeGroup.tsx`, `ThreadBubbles.tsx` (`LedgeBubble`, `UserBubble`), `CategoryChip.tsx`
- Create : `packages/ui/src/styles/ledge-thread.css`, à importer là où `chat` importe ses styles
- Test : `packages/ui/test/ledge-thread-model.test.ts`, `packages/ui/test/escalation-card.test.tsx`, `packages/ui/test/exchange-group.test.tsx`

**Interfaces :**
- Produces :
```ts
// threadModel.ts (pur)
export type ThreadRow =
  | { kind: 'day'; label: string }                                     // « AUJOURD'HUI », « HIER », « 28/10 »
  | { kind: 'user'; item: …; to?: string }
  | { kind: 'ledge'; item: …; turn?: ChatTurn }                        // turn retrouvé par qid dans state.chat
  | { kind: 'escalation'; item: …; escalation?: Escalation }
  | { kind: 'decided'; item: …; decision?: LedgeDecision }
  | { kind: 'exchanges'; item: …; exchanges: Exchange[]; missing: number };
export function threadRows(items: readonly LedgeThreadItem[], ctx: { escalations: ReadonlyMap<string, Escalation>; exchanges: (machine: string, rigId: string) => readonly Exchange[]; chat: readonly ChatTurn[]; decisions?: ReadonlyMap<string, LedgeDecision>; today: string }): ThreadRow[];
/** Le fil mêlé de l'encoche : un échange par ligne, plus les messages, les bulles et les décisions ; `onlyLedge` retire les échanges. */
export type FeedLine = { at: string; kind: 'exchange'; exchange: Exchange; rigName: string } | { at: string; kind: 'user'; text: string; to?: string } | { at: string; kind: 'ledge'; text: string } | { at: string; kind: 'decided'; text: string; to: string };
export function feedLines(rows: readonly ThreadRow[], o: { onlyLedge: boolean; rigName(machine: string, rigId: string): string }): FeedLine[];
/** La décision épinglée : l'escalade `decision` en attente (`pending` ou `grace`) la plus ancienne. */
export function pinnedEscalation(escalations: readonly Escalation[]): Escalation | undefined;
export function relativeAge(at: string, now: string): string;   // « il y a 4 min »

// EscalationCard.tsx
export function EscalationCard(p: { escalation: Escalation; answer: { state: 'idle' | 'sending' | 'done' | 'refused'; code?: string }; onAnswer(answers: Record<string, string>): void; onTalk(): void; compact?: boolean }): JSX.Element;
// ExchangeGroup.tsx
export function ExchangeGroup(p: { rigName: string; exchanges: readonly Exchange[]; missing: number; from: string; to: string; defaultOpen: boolean }): JSX.Element;
```

L'`EscalationCard` d'après `c-A.png` et `nn-open.png` :
- en tête, la pastille de catégorie (ambre pour `design`, `architecture` et `critical`, neutre sinon ; sans pastille quand `category` est absent), puis `from` en mono et l'âge relatif ;
- la question en gras (`summary`, ou la question unique) ;
- « Mon avis : <advice> », seulement si `advice` existe ;
- un bouton par option, celle qui porte `recommended` en plein (rouge) ;
- avec plusieurs questions, une rangée d'options par question, et l'envoi part quand chaque question a son choix ;
- « En parler » en lien, à droite.

Les états de la carte :
- `grace` : les boutons restent actifs, avec la ligne « Ledge s'en occupe… » ;
- `answered` : boutons retirés, « Répondu par toi : <libellé> » ou « Tranché par Ledge : <libellé> » ;
- `answer.state === 'refused'` avec le code `already_answered` : « Déjà répondu » ;
- avec un autre code : la raison, et les boutons redeviennent actifs ;
- `intent: 'update'` : pas d'options, un seul bouton « Vu », qui envoie `answers` vide.

Le `ExchangeGroup` montre l'en-tête « factory · 3 échanges entre agents · 16:36 → 16:42 », avec « Replier ▾ » ou « Voir ▸ ». Le groupe le plus récent est ouvert, les autres sont repliés. Chaque ligne donne `from → to · <sorte> · hh:mm`, puis le texte. Les sortes affichées sont « tâche » (`task`), « message », « relève » (`handoff`). Les échanges manquants sont dits par « n échanges plus disponibles ».

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('threadRows inserts day separators and resolves turns by qid', () => { /* … row ledge.turn.qid === 'q-1' */ });
test('feedLines expands groups into one line per exchange and drops them with onlyLedge', () => { /* 3 échanges + 1 user → 4 lignes ; onlyLedge → 1 */ });
test('pinnedEscalation is the oldest pending decision, grace included, updates excluded', () => { /* … */ });
test('EscalationCard shows advice, recommended option first-class, and sends the option id', async () => {
  render(<Provider><EscalationCard escalation={sqlite} answer={{ state: 'idle' }} onAnswer={onAnswer} onTalk={vi.fn()} /></Provider>);
  expect(screen.getByText(/Mon avis : SQLite/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'SQLite' }));
  expect(onAnswer).toHaveBeenCalledWith({ q1: 'sqlite' });
});
test('grace shows « Ledge s\'en occupe… » and keeps the buttons', () => { /* … */ });
test('already_answered shows « Déjà répondu » without buttons', () => { /* … */ });
test('an update shows « Vu » and sends empty answers', () => { /* … */ });
test('ExchangeGroup folds and unfolds', async () => { /* « Voir » → 3 lignes visibles ; « Replier » → aucune */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/ui test -- ledge-thread-model escalation-card exchange-group` ; Expected : FAIL.
- [ ] **Step 3 : implémenter** dans le design system Lyssaën, à partir des jetons existants de `packages/ui/src/styles`. Le style ne passe que par des classes `lt-*`.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(ui): ledge thread components (decision in message, exchange groups)`

---

### Task 9 : l'écran Ledge de Desktop, onglet Conversation

**Files :**
- Modify : `apps/desktop/src/nav/state.ts` (`HomeTab = 'conversation' | 'rigs' | 'mandat'` ; `HOME_TABS` dans cet ordre ; une ancienne valeur, `teams`, `tasks` ou `history`, est lue comme `conversation`)
- Modify : `apps/desktop/src/chat/LedgeHome.tsx` (en-tête, onglets, fil, saisie)
- Create : `apps/desktop/src/chat/LedgeConversation.tsx` (le fil et la saisie), `apps/desktop/src/chat/HomePlaceholder.tsx`
- Modify : `apps/desktop/src/i18n/fr.ts`, `en.ts`, `messages.ts` (`t.home.*`, `t.ledgeThread.*`) et `apps/desktop/src/i18n/lang.tsx` (`ledgeThreadCopy(t)`)
- Test : `apps/desktop/test/ledge-home.test.tsx`, `apps/desktop/test/nav-state.test.ts`

**Interfaces :**
- Consumes : tâches 7 et 8, `useActionCards`/`useChatCards` existants (les cartes d'un tour s'affichent sous sa bulle, comme aujourd'hui), `RigsTab` du lot 3 s'il existe.
- Produces : `LedgeConversation(p: { client: DaemonClient; view: View; dispatch; focus?: number })`, `HomePlaceholder(p: { title: string; body: string })`, et `readHomeTab(saved: string | null): HomeTab` dans `nav/state.ts`.

Contenu :
- **En-tête** : « Ledge. » puis « Orchestrateur OpenRig · n rigs, n agents · n sessions seules · tranche dans son mandat ». Sans OpenRig : « n sessions seules ».
- **Onglets** : « Conversation », « Rigs · n », « Mandat ».
  - Rigs : le `RigsTab` du lot 3 s'il est livré, sinon `HomePlaceholder` (« Les rigs arrivent ici. »).
  - Mandat : `HomePlaceholder` (« Le mandat de Ledge arrive avec son cerveau. »).
- **Fil** :
  - `threadRows` rendu de haut en bas ; « Voir plus ancien » en tête quand `hasOlder` ; défilement collé en bas ;
  - les bulles de Ledge à gauche avec la mascotte, celles de l'utilisateur à droite (« Toi · 16:45 ») ;
  - l'escalade dans une bulle de Ledge sans texte, dont la carte est l'`EscalationCard`. « En parler » remplit la saisie avec « À propos de « <summary> » : », mémorise `about`, et le prochain envoi part avec `about` ;
  - le tranché par `DecidedLine` (lot 7 : ici, rendu seulement si l'élément arrive).
- **Saisie** :
  - placeholder « Écrire à Ledge… (@build pour un agent d'un rig) » ;
  - suggestions « Lance un rig… », « Où en est <premier rig> ? » (« Où en est factory ? » sur la maquette ; « Où en sont mes sessions ? » sans rig), « Qu'as-tu tranché ? », « Qui a besoin de moi ? ». Une suggestion qui finit par « … » remplit la saisie au lieu d'envoyer ;
  - `@` complète d'abord les sièges (`@build · factory`, et `@build@factory` en cas d'ambiguïté), puis les sessions seules ;
  - `#` (équipes) disparaît, et `mentionAt` ne reconnaît plus que `@` ;
  - le pied « tranche dans son mandat · design, architecture et critique te reviennent ».
- L'envoi passe par `sayToLedge`, plus jamais par `chat.ask` ; les images collées restent pour une évolution ultérieure, et le bouton d'image est retiré de cette saisie.
- `/` ouvre l'écran Ledge, saisie active : c'est déjà le cas, à vérifier.

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('tabs are Conversation · Rigs · Mandat', () => { /* getAllByRole('tab') → ['Conversation', 'Rigs · 2', 'Mandat'] */ });
test('an old saved tab falls back to conversation', () => { expect(readHomeTab('teams')).toBe('conversation'); });
test('sending a message sends ledge.say, never chat.ask', async () => { /* sent: { type: 'ledge.say', text: 'Où en est factory ?' } */ });
test('a ledge bubble shows its turn cards under it', () => { /* tour q-1 avec actions → carte générique sous la bulle */ });
test('a decision in message answers with the option id', async () => { /* clic SQLite → escalation.answer { id, answers: { q1: 'sqlite' } } */ });
test('« En parler » prefills and sends about', async () => { /* saisie préremplie ; envoi → ledge.say { about: 'qi-1' } */ });
test('@ completes seats first', async () => { /* taper '@bu' → option '@build · factory' en premier */ });
test('Mandat shows the placeholder until lot 7', () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/desktop test -- ledge-home nav-state` ; Expected : FAIL.
- [ ] **Step 3 : implémenter** ; supprimer `HistoryTab` et `LePoint` si le lot 1 ne l'a pas fait. Le rail est un emplacement vide jusqu'à la tâche 10.
- [ ] **Step 4 : relancer** `pnpm --filter @ledge/desktop test && pnpm typecheck` — Expected : PASS.
- [ ] **Step 5 : commit** `feat(desktop): Ledge screen conversation on the ledge thread`

---

### Task 10 : le rail de droite

**Files :**
- Create : `apps/desktop/src/chat/LedgeRail.tsx`
- Modify : `apps/desktop/src/chat/LedgeConversation.tsx` (rail à droite à partir de 1100 px de large ; en dessous, le rail passe sous l'en-tête, replié, en une ligne « À toi · 3 · Rigs · 2 »)
- Modify : i18n fr/en
- Test : `apps/desktop/test/ledge-rail.test.tsx`

**Interfaces :**
- Consumes : `attentionOf` (tâche 11), `rigs` du store, `decisions` du store (message du lot 7, absent ici).
- Produces : `LedgeRail(p: { view: View; client: DaemonClient; dispatch })`.

Sections, d'après `c-A.png` :
1. **« À toi · n »** :
   - une ligne par élément d'`attentionOf` : avatar, nom, résumé court ;
   - une escalade : « Voir » (fait défiler le fil jusqu'à sa carte), ou ses deux premières options en boutons quand elle n'a qu'une question ;
   - une session : « Répondre », ou « Oui » / « Non » pour une permission (`quickDecide`).
2. **« Rigs · n »** :
   - une ligne par rig : « <nom> n/m au travail », la barre d'avancement (sièges `working` sur sièges non arrêtés), et « Table » ;
   - « Table » envoie `dispatch({ type: 'home', rig: id })` si le lot 3 l'a défini, et n'est pas rendu sinon.
3. **« Tranché aujourd'hui · n »** :
   - les décisions `by: 'ledge'` du jour, avec « Revenir » (`decision.revisit`) ;
   - section masquée tant qu'il n'y en a aucune.
4. Le bouton **« Résumer la journée »** envoie `sayToLedge(client, 'Résume ma journée : ce que les rigs ont fait, ce que j\'ai tranché, ce qui m\'attend.')`.

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('À toi lists escalations and waiting sessions with their buttons', () => { /* orch-lead : SQLite / Garder le JSON ; Otto : Oui / Non */ });
test('Rigs shows n/m au travail', () => { /* factory 4/6 au travail */ });
test('Tranché aujourd\'hui is hidden without decisions', () => { /* queryByText(/Tranché aujourd'hui/) null */ });
test('« Résumer la journée » sends a ledge.say', async () => { /* … */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/desktop test -- ledge-rail` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(desktop): Ledge screen right rail`

---

### Task 11 : À toi montre les escalades

**Files :**
- Modify : `apps/desktop/src/shell/sidebar/model.ts`
- Modify : `apps/desktop/src/shell/sidebar/Attention.tsx`, `Sidebar.tsx`
- Test : `apps/desktop/test/sidebar-attention.test.ts` (nouveau, ou ajout au test du modèle existant)

**Interfaces :**
- Produces :
```ts
export type AttnItem =
  | { kind: 'question' | 'permission' | …; session: Session; helper?: …; since: string }   // inchangé
  | { kind: 'escalation'; escalation: Escalation; since: string };
export function attentionOf(sessions: readonly Session[], waits: ReadonlyMap<string, { since: string }>, escalations?: readonly Escalation[]): AttnItem[];
```

Règles :
- Sont retenues les escalades `intent: 'decision'` en `pending` ou `grace`, de toutes les machines et de toutes les sources (`rig`, `operator`, `ask`), triées par `createdAt` avec les sessions.
- La ligne montre l'avatar, `from` (le nom du siège, sans `@rig`), le nom du rig, l'âge, puis « Catégorie · résumé ».
- Une escalade à une seule question a ses options en boutons, deux au plus, la recommandée en plein ; avec plus de deux options, ou plusieurs questions, un seul bouton « Voir » ouvre l'écran Ledge sur la carte.
- En `grace`, la ligne porte « Ledge s'en occupe… ».
- Une session seule qui attend la réponse d'un `ledge ask` ne figure qu'une fois : son escalade `ask` remplace la ligne de session, quand le lot 1 en montrait une.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('pending decisions join À toi, updates and answered do not', () => { /* … */ });
test('an ask is listed once, as an escalation', () => { /* session Otto en attente + escalation ask-3 de Otto → 1 item */ });
test('a single-question escalation offers its options', () => { /* rendu Attention : boutons SQLite, JSON → escalation.answer */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/desktop test -- sidebar-attention` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.** Le lot 3 modifie aussi la barre latérale, pour la ligne Ledge 1a : ne toucher qu'à À toi.
- [ ] **Step 4 : relancer** — Expected : PASS.
- [ ] **Step 5 : commit** `feat(desktop): escalations in À toi`

---

### Task 12 : e2e Desktop du fil

**Files :**
- Modify : `apps/desktop/e2e/daemon.ts` (`extras.openrig?: { rigs?: Rig[]; escalations?: Escalation[]; exchanges?: Exchange[]; thread?: LedgeThreadItem[]; answerDelayMs?: number }`)
- Create : `apps/desktop/e2e/ledge-thread.spec.ts`

Le faux daemon :
- à la connexion, envoie `rig.snapshot`, puis un `escalation.updated` par escalade, puis `ledge.thread.history` ;
- `escalation.answer` : la première réponse est acceptée après `answerDelayMs`, et suivie de `escalation.updated` avec `answered` et `rig.result ok` ; une réponse suivante reçoit `rig.result { ok: false, code: 'already_answered' }` ;
- `ledge.say` : ajoute l'élément `user` (`ledge.thread.item`), puis joue `extras.chat` comme `chat.ask` le fait aujourd'hui, et termine la bulle de Ledge ;
- `ledge.say` avec `@build` en tête : ajoute l'élément `user` avec `to` ;
- exporte `pushExchange(x)` et `pushEscalation(e)`.

- [ ] **Step 1 : écrire les tests e2e qui échouent**
  - `answering a decision in the thread`. Ouvrir l'écran Ledge, voir la carte « Sessions : passer du fichier JSON à SQLite ? », cliquer « SQLite ». La carte dit « Répondu par toi : SQLite », et la ligne disparaît d'À toi.
  - `a second device answering first shows « Déjà répondu »`. `answerDelayMs` est réglé, et le test pousse lui-même `escalation.updated` à l'état answered `by: 'ledge'` avant `rig.result already_answered`.
  - `exchanges fold into one group`. Trois `pushExchange` donnent un en-tête « factory · 3 échanges entre agents » ; « Replier » les cache.
  - `asking Ledge streams the bubble`. On tape « Qui a besoin de moi ? » puis Entrée : la bulle de l'utilisateur apparaît à droite, puis la bulle de Ledge.
  - `@build writes to the seat`.
- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/desktop e2e -- ledge-thread` ; Expected : FAIL.
- [ ] **Step 3 : compléter le faux daemon** jusqu'au vert ; ne corriger l'application que si un vrai défaut apparaît.
- [ ] **Step 4 : relancer, et passer toute la suite e2e** (`pnpm --filter @ledge/desktop e2e`) ; les specs `chat.spec.ts` et `proposals.spec.ts` sont adaptées à `ledge.say`. Expected : PASS.
- [ ] **Step 5 : commit** `test(desktop): e2e of the ledge thread and answers`

---

### Task 13 : l'encoche fermée, Ledge seul

**Files :**
- Create : `apps/overlay/src/surface/handleLine.ts`
- Modify : `apps/overlay/src/surface/Handle.tsx` (`Filet` et `CompactIsland` rendent `LedgeLine` à la place de la rangée de bots)
- Create : `apps/overlay/src/surface/LedgeLine.tsx`
- Modify : `apps/overlay/src/i18n/messages.ts`
- Test : `apps/overlay/test/handle-line.test.ts`, `apps/overlay/test/handle.test.tsx` (adapté)

**Interfaces :**
- Produces :
```ts
export type HandleLine =
  | { kind: 'calm' }
  | { kind: 'exchange'; rigName: string; from: string; to: string; text: string }
  | { kind: 'decided'; text: string }                                               // « J'ai tranché pour build : merge, pas de rebase »
  | { kind: 'forYou'; category?: MandateCategory; summary: string; count: number }; // « Architecture · orch-lead : JSON ou SQLite ? · 1 »
export const LINE_LINGER_MS = 5000;
export function handleLine(o: { escalations: readonly Escalation[]; attention: number; lastExchange?: { x: Exchange; rigName: string; seenAt: number }; lastDecided?: { text: string; seenAt: number }; now: number }): HandleLine;
```

Priorité :
1. `forYou`, tant qu'une escalade `decision` est `pending` ou `grace`, ou qu'une session attend l'utilisateur. Le compte réunit les deux ; le résumé est celui de la plus ancienne escalade, sinon « <session> : <demande> ».
2. `decided`, pendant 5 s après son arrivée.
3. `exchange`, pendant 5 s après son arrivée.
4. `calm` : la mascotte seule.

La rangée de bots disparaît de l'encoche fermée. Les pastilles de mise à jour, le mode Ne pas déranger et le raccourci restent à leur place. Le survol et le clic ouvrent l'encoche comme aujourd'hui.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('calm when nothing happens', () => { expect(handleLine({ escalations: [], attention: 0, now })).toEqual({ kind: 'calm' }); });
test('for you wins over a fresh exchange', () => { /* … kind forYou, count 1, category architecture */ });
test('an exchange lingers 5 s then calm', () => { /* now = seenAt + 4999 → exchange ; + 5001 → calm */ });
test('a waiting session counts as for you', () => { /* attention 1, sans escalade → forYou summary "Otto : npm test" */ });
// handle.test.tsx
test('the closed notch shows Ledge alone, no bot row', () => { /* queryAllByTestId('handle-bot') vide ; pastille « Architecture » et compteur 1 */ });
```

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/overlay test -- handle-line handle` ; Expected : FAIL.
- [ ] **Step 3 : implémenter `handleLine` et `LedgeLine`** d'après les quatre maquettes `nn-closed-*`. La pastille de catégorie est `CategoryChip` (tâche 8) ; le compteur, rouge, est celui de `nn-closed-foryou`.
- [ ] **Step 4 : relancer** (toute la suite overlay) — Expected : PASS.
- [ ] **Step 5 : commit** `feat(overlay): closed notch shows Ledge alone in four states`

---

### Task 14 : l'encoche ouverte, le fil mêlé

**Files :**
- Create : `apps/overlay/src/surface/LedgeFeed.tsx`
- Modify : `apps/overlay/src/surface/ChatView.tsx` (le mode `chat` rend `LedgeFeed`), `Surface.tsx` (hauteur mesurée, non-lu sur un nouvel élément du fil au lieu d'un nouveau tour)
- Modify : `apps/overlay/src/i18n/messages.ts`
- Modify : `apps/overlay/e2e/daemon.ts` (`extras.openrig`, comme à la tâche 12 : escalades, échanges, fil, `escalation.answer`, `ledge.say`)
- Create : `apps/overlay/e2e/ledge-feed.spec.ts`
- Test : `apps/overlay/test/ledge-feed.test.tsx`

**Interfaces :**
- Consumes : `threadRows`, `feedLines`, `pinnedEscalation`, `EscalationCard` (`compact`), `answerEscalation`, `sayToLedge`.
- Produces : `LedgeFeed(p: { client: DaemonClient; onClose(): void; onSettings(): void })`.

D'après `nn-open.png` :
- **En-tête** : mascotte, « Ledge. », « Orchestre n rigs · n agents · tranche dans son mandat », puis « + » (`chat.reset`), réglages et fermer.
- **La décision épinglée** en haut, par `EscalationCard`, avec « En parler » qui remplit la saisie.
- **Le fil mêlé** :
  - une ligne par élément, avec l'heure `hh:mm` en mono ;
  - pour un échange : « from → to · rig · sorte » ;
  - pour l'utilisateur : « Toi → Ledge », ou « Toi → @build », sur fond gris ;
  - pour Ledge : « Ledge → toi », sur fond rouge sombre ;
  - pour un tranché : « Ledge → build · décision », sur fond rouge sombre.
- **Le filtre « Seulement Ledge »** : un bouton bascule sous l'en-tête, dont l'état est mémorisé en `localStorage` (`ledge.feed.onlyLedge`, lu dans un try/catch).
- **La saisie**, toujours présente : « Écrire à Ledge… (@build pour un agent) », avec envoi par `sayToLedge`.
- Les autres modes (`SessionView`, `LaunchView`, la liste…) ne changent pas.

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
test('the pending decision is pinned above the mixed feed', () => { /* carte en premier, puis lignes 16:31, 16:36… */ });
test('« Seulement Ledge » hides agent exchanges', async () => { /* 2 échanges + 2 messages → après clic, 2 lignes */ });
test('the composer is there even with an empty thread', () => { /* getByPlaceholderText('Écrire à Ledge… (@build pour un agent)') */ });
test('answering the pinned decision sends escalation.answer', async () => { /* … */ });
```
E2e (`ledge-feed.spec.ts`) :
- `open notch answers the pinned decision` : ouvrir l'encoche, cliquer « SQLite », la carte se retire et la fermée revient au calme ;
- `closed notch shows the exchange line then calm` : `pushExchange`, puis le texte « build → review-a » est visible, puis absent après 5 s (horloge playwright).

- [ ] **Step 2 : lancer et voir l'échec** — Run : `pnpm --filter @ledge/overlay test -- ledge-feed && pnpm --filter @ledge/overlay e2e -- ledge-feed` ; Expected : FAIL.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer toute la suite overlay (vitest et e2e)**, et adapter `say.spec.ts` et `launch-from-chat.spec.ts` au fil. Expected : PASS.
- [ ] **Step 5 : commit** `feat(overlay): open notch is the mixed ledge feed with « Seulement Ledge »`

---

## Fin du lot

- [ ] `pnpm test && pnpm typecheck && pnpm --filter @ledge/desktop e2e && pnpm --filter @ledge/overlay e2e`, tout vert.
- [ ] Revue de la branche entière contre les Review Focus 1 à 5 : chaque ligne a son test, et il passe.
- [ ] Pas de vrai OpenRig. Avec l'accord de l'utilisateur, un parcours sur le Desktop de dev avec le faux daemon e2e : répondre à une escalade depuis À toi, depuis le fil et depuis l'encoche.
