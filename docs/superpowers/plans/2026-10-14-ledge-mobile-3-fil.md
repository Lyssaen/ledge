# Ledge mobile — lot 3 : fil, agents et terminal — plan d'implémentation

> **Pour les agents d'exécution :** SOUS-SKILL REQUIS : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour réaliser ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** suivre chaque session dans un fil persistant (prompts, réponses, décisions et leur source), retrouver les agents par dépôt avec le non-lu par appareil, écrire à un agent disponible et voir que le terminal a pris le message, consulter le terminal en lecture seule et l'interrompre.

**Architecture :** `HistoryStore` écrit `~/.ledge/history/<id>.jsonl` (200 tours au plus). Le tour d'un événement est calculé et numéroté avant `store.apply`, pour que le non-lu projeté soit juste dès la diffusion. Le non-lu est calculé par appareil dans `toRemote()`, à partir du dernier tour de réponse lu. La consigne et l'interruption distantes passent par le registre d'opérations du lot 2.

**Pile technique :** voir le [plan directeur](2026-10-14-ledge-mobile.md). Aucune nouvelle dépendance.

**Spec :** §1 (succès 2), §1.1, §2 (Fil, Terminal, Agents), §2.1, §6 (historique), §9.3, §10 (fil après redémarrage, brouillon conservé).

**Prérequis :** lots 1 et 2 terminés.

## Global Constraints

Celles du [plan directeur](2026-10-14-ledge-mobile.md#global-constraints), plus :
- « Agent au travail ou attendant une décision : désactiver la saisie libre […]. Aucune consigne n'est mise en attente pour plus tard. »
- « Le statut « Pris par le terminal » confirme la prise en compte de la consigne, pas son exécution complète. L'interruption du terminal n'annule pas les effets des actions déjà exécutées. »
- « Une suggestion textuelle ne crée pas une permission implicite. » « Les réponses rapides remplissent le brouillon sans l'envoyer. »

## Review Focus

Les lignes 1 et 2 du [plan directeur](2026-10-14-ledge-mobile.md#review-focus) valent aussi pour la consigne et l'interruption (tâche 3). En plus, pour ce lot :
- **Identifiant de session hostile dans un nom de fichier** (session `hook_only` nommée par l'agent) : l'historique ne sort jamais de `~/.ledge/history`. → Tâche 2, test `an id with a slash never escapes the history folder`.
- **Double interruption de Cursor Agent** (deux Ctrl-C quittent l'agent) : le même `operationId` n'envoie les touches qu'une fois. → Tâche 3, test `interrupt twice with the same operationId sends the keys once`.

---

### Task 1: Protocole du fil

**Fichiers :**
- Créer : `packages/protocol/src/history.ts`
- Modifier : `packages/protocol/src/session.ts` (`unread?: boolean`), `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`
- Test : `packages/protocol/test/history.test.ts`

**Interfaces :**
- Produit : `TurnSchema = z.object({ seq: z.number().int().positive(), at: z.string().datetime(), kind: z.enum(['prompt', 'reply', 'decision', 'answer', 'resolved', 'interrupt']), text: z.string().max(24_000).optional(), decision: z.enum(['accept', 'deny']).optional(), source: z.enum(['pc', 'phone']).optional(), pendingId: z.string().optional() })`.
- Produit (`ClientMessage`) : `session.history { id }`, `session.read { id, seq: int ≥ 0 }` ; `session.interrupt` + `operationId?`.
- Produit (`ServerMessage`) : `session.turns { id, turns: Turn[] }`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('a decision turn carries its source', () => expect(TurnSchema.parse({ seq: 3, at: T, kind: 'decision', decision: 'accept', source: 'phone', pendingId: 'p2-x' }).source).toBe('phone'));
it('session.interrupt without operationId still parses (overlay)', () => expect(parseClientMessage({ type: 'session.interrupt', id: 'a' }).type).toBe('session.interrupt'));
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @ledge/protocol exec vitest run test/history.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @ledge/protocol test && pnpm -r typecheck`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): session history turns, read marks and interrupt operations"
```

### Task 2: Historique des tours

**Fichiers :**
- Créer : `packages/ledge/src/daemon/history.ts`
- Modifier : `packages/ledge/src/cli/hook.ts` (`PROMPT_MAX = 4_000`), `packages/ledge/src/daemon/index.ts` (élague, au démarrage, les fichiers des sessions absentes du journal)
- Test : `packages/ledge/test/history.test.ts`, `packages/ledge/test/hook.test.ts`

**Interfaces :**
- Produit : `HISTORY_MAX = 200` ; `turnFromEvent(ev: SessionEvent, before: Session | undefined, after: Session | undefined): Omit<Turn, 'seq' | 'at'> | null`. Règles : `UserPromptSubmit` avec texte → `prompt` ; `Stop` avec texte → `reply` ; la demande de `before` disparaît de `after` sur un événement qui n'est ni `SessionEnd` ni `PaneGone` → `resolved { pendingId, source: 'pc' }`. Sinon `null`.
- Produit : `class HistoryStore { constructor(o?: { dir?: string; max?: number }); next(id: string, turn: Omit<Turn, 'seq'>): Turn; read(id: string): Promise<Turn[]>; lastSeq(id: string): number; lastReplySeq(id: string): number; remove(id: string): Promise<void>; prune(keep: ReadonlySet<string>): Promise<void>; flush(): Promise<void> }`.
  - `next` numérote et met à jour les compteurs en mémoire de façon synchrone, puis met l'ajout en file. `lastSeq` et `lastReplySeq` relisent le fichier au premier accès après un redémarrage.
  - Au-delà de `max × 1,25` lignes, le fichier est réécrit de façon atomique avec ses `max` dernières lignes ; `read` renvoie au plus `max` tours.
  - Nom de fichier : `id` s'il correspond à `/^[\w.-]{1,128}$/`, sinon `sha256(id)`. Dossier en 0700, fichiers en 0600.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('maps a prompt, a reply and a request resolved in the terminal', () => { /* … */ });
it('a Decided event is not a resolved turn', () => { /* … */ });
it('keeps the last 200 turns in order', async () => { /* 260 turns → read gives seq 61..260 */ });
it('survives a restart: a new store reads the same turns and continues the numbering', async () => { /* … */ });
it('remove deletes the file; prune keeps only live sessions', async () => { /* … */ });
it('an id with a slash never escapes the history folder', async () => { /* id '../../x' → file inside dir */ });
// hook.test.ts
it('keeps a long prompt up to 4000 characters', () => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/history.test.ts test/hook.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS. Le budget de 100 ms de `hook.test.ts` est toujours respecté.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge
git commit -m "feat(daemon): persistent per-session history of prompts, replies and decisions"
```

### Task 3: Fil, non-lu, consigne et interruption côté daemon

**Fichiers :**
- Modifier : `packages/ledge/src/daemon/server.ts`, `packages/ledge/src/daemon/decisions.ts`, `packages/ledge/src/daemon/devices.ts` (`read: Record<string, number>` par appareil, `setRead(deviceId, sessionId, seq)`), `packages/ledge/src/daemon/remote/project.ts`, `packages/ledge/src/daemon/remote/rights.ts`
- Test : `packages/ledge/test/thread.test.ts`, `packages/ledge/test/remote-project.test.ts`

**Interfaces :**
- Consomme : `HistoryStore`, `turnFromEvent`, `OperationRegistry`, `Peer`.
- Câblage de `session.event` : `const after = reduce(before, ev)`, puis `history.next(id, turn)` si `turnFromEvent` renvoie un tour, puis `store.apply(id, ev)`. Le reducer est pur, donc `store.apply` produit le même `after`.
- Décisions et réponses appliquées par `decisions.ts` : un tour `decision` ou `answer` (avec le libellé de l'option), `source` = `'phone'` pour un pair distant, `'pc'` pour un pair local, et `pendingId`. Une interruption appliquée donne un tour `interrupt`.
- `store.onChange` `removed` → `history.remove(id)`.
- `session.history { id }` → `session.turns { id, turns }` (session inconnue → `error { id }`). `session.read { id, seq }` (distant) → `devices.setRead`, puis le `session.updated` projeté renvoyé à ce pair seulement.
- `toRemote(msg, view)` : `view` devient `{ deviceId: string; unread(sessionId: string): boolean }`. Les sessions projetées portent `unread = history.lastReplySeq(id) > (device.read[id] ?? 0)`. `session.turns` est transmis.
- Consigne distante (`runMessage`) : `session.reply` sans `pendingId`, avec `operationId`, `text` de 1 à 4 000 caractères. Elle n'est acceptée que si `state === 'idle'` et sans `pending`, sinon `rejected/agent_busy` sans rien taper ni mettre en file. Elle passe par l'injection existante (`replyPlan`, sans prompt requis). Le daemon retient `{ text, at }` 30 s : le `UserPromptSubmit` suivant au même texte devient un tour `prompt` avec `source: 'phone'`.
- Interruption distante (`runInterrupt`) : `operationId` requis ; acceptée seulement si `state === 'working'`, sinon `agent_busy`. Les touches `interruptKeys()` partent une seule fois par `operationId` ; `applied` dès l'envoi des touches, puisque l'effet n'est pas vérifiable.
- `MOBILE_COMMANDS` + `session.history`, `session.read`, `session.interrupt`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('the thread shows prompts, replies and decisions in order after a daemon restart', async () => { /* events + remote decision; stop; new daemon on same LEDGE_HOME; session.history */ });
it('a phone decision is recorded from the phone, an overlay decision from the PC', async () => { /* … */ });
it('unread is per device: reading on one phone leaves the other unread', async () => { /* two devices, Stop with text, session.read from d1 */ });
it('a message to an idle agent is typed once and its prompt is tagged phone', async () => { /* … */ });
it('a message to a working agent is refused as agent_busy and nothing is typed or queued', async () => { /* … then agent goes idle: still nothing typed */ });
it('interrupt twice with the same operationId sends the keys once', async () => { /* … */ });
it('dismissing a session deletes its history', async () => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter @paradow/ledge exec vitest run test/thread.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier**

Exécuter : `pnpm --filter @paradow/ledge test`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add packages/ledge
git commit -m "feat(daemon): session threads, per-device unread, remote messages and interrupts"
```

### Task 4: Onglet Agents

Référence visuelle : `Agents.html` (`renderAgents`).

**Fichiers :**
- Créer : `apps/mobile/src/model/agents.ts`, `apps/mobile/src/screens/Agents.tsx`
- Modifier : `apps/mobile/src/ui/TabBar.tsx` (onglet « Agents »), `apps/mobile/src/router.ts` (`{ name: 'agents' }`, `{ name: 'thread'; sessionId }`, `{ name: 'terminal'; sessionId }`), `apps/mobile/src/screens/Inbox.tsx` (l'état vide renvoie aux agents)
- Test : `apps/mobile/test/agents.test.ts`, `apps/mobile/e2e/agents.spec.ts`

**Interfaces :**
- Consomme : `groupSessions` (`@ledge/client`).
- Produit : `interface AgentRow { sessionId: string; task: string; botName: string; tool: Tool; branch?: string; worktree?: boolean; last: string; status: { tone: 'attention' | 'info' | 'ok' | 'muted' | 'danger'; label: string }; unread: boolean; pending?: InboxItem }` ; `agentsOf(sessions: Session[]): Array<{ label: string; rows: AgentRow[] }>`.
- Statuts : demande en attente → `attention`, avec le badge de type (« Autorisation », « Question », « Impact élevé ») ; `working` → `info` « Au travail » ; `idle` → `ok` « Disponible » ; `exited` → `muted` « Terminée » ; `error` → `danger` « Erreur ».
- `last` : titre de la demande en attente, sinon première ligne de `lastReply.text`, sinon « Travaille sur les dernières modifications. » si `working`.
- Le titre de tâche (`topic ?? project`) précède « Bot · branche ». « ● Non lu » est en bleu. Aucun bouton de lancement. Sous-titre : « N sessions · M projets sur ce PC » ; hors ligne : « Dernier état connu · connexion perdue ».

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('groups by repository and puts the task title before the bot name', () => { /* … */ });
it('two sessions of the same repository keep distinct titles and branches', () => { /* … */ });
it('labels every state with text, not only colour', () => { /* … */ });
// e2e at 320, 390 and 430
test('agents list fits the width; unread dot shows; a row opens its thread', async ({ page }) => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec vitest run test/agents.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier, puis comparer à `Agents.html` à 390 px**

Exécuter : `pnpm --filter mobile test && pnpm --filter mobile exec playwright test e2e/agents.spec.ts`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): agents tab grouped by repository with unread marks"
```

### Task 5: Fil d'un agent

Référence visuelle : `Thread.html` et les scénarios `send-failure` et `agent=otto` (`renderThread`).

**Fichiers :**
- Créer : `apps/mobile/src/model/thread.ts`, `apps/mobile/src/screens/Thread.tsx`, `apps/mobile/src/ui/ReplyView.tsx`, `apps/mobile/src/state/drafts.ts`
- Modifier : `apps/mobile/src/screens/RequestDetail.tsx` et `apps/mobile/src/screens/Result.tsx` (lien « Voir le fil de <Bot> » ; « Elle apparaît maintenant dans le fil de cette session. »), `apps/mobile/src/state/store.ts` (`turns` par session, `session.history` à l'ouverture d'un fil et après chaque reconnexion)
- Test : `apps/mobile/test/thread.test.ts`, `apps/mobile/e2e/thread.spec.ts`

**Interfaces :**
- Consomme : `parseReply` (`@ledge/client`), `opsReducer`, `newOperationId`, `requestsOf`.
- Produit : `type ThreadItem = { kind: 'me'; text: string; at: string; delivery?: 'sending' | 'taken' | 'uncertain' } | { kind: 'agent'; doc: ReplyDoc; at: string } | { kind: 'event'; label: string; at: string } | { kind: 'awaiting'; item: InboxItem }` ; `threadItems(turns: Turn[], session: Session, ops: Record<string, OpState>): ThreadItem[]`.
  - Libellés d'événement : « Accord pris en compte · depuis le téléphone », « Refus pris en compte · depuis le PC », « Réponse prise en compte · <option> », « Traitée dans le terminal », « Interruption transmise ».
  - Une demande en attente donne une carte `awaiting`, « Décision attendue · dans « À traiter » », qui ouvre le même `pendingId` que l'inbox.
  - La section `next` du `ReplyDoc` s'affiche comme « Suggestion pour la suite », sans action.
- Produit : `composerState(session: Session, link: Link, sending: boolean): { enabled: boolean; placeholder: string; status: { tone: 'ok' | 'info' | 'attention' | 'muted'; label: string } }`. Libellés : « Disponible pour votre consigne » / « Écrire à <Bot>… » ; « Au travail · consultez le terminal » / « L'agent travaille… » ; « En attente d'une décision » / « Traitez la demande ci-dessus » ; « Connexion perdue · dernier état connu » / « Reconnectez-vous pour écrire ».
- Produit : `QUICK_REPLIES = ['Montre le diff', 'Lance les tests', 'Explique les changements']` (affichées seulement si le composer est actif ; un appui remplit le brouillon sans l'envoyer) ; `loadDraft(sessionId)`, `saveDraft(sessionId, text)` (`ledge.mobile.draft.<id>`).
- Envoi : « Envoi au PC… », puis « Pris par le terminal · à l'instant » et le statut « Consigne reçue · l'agent reprend » ; le brouillon est vidé seulement à `applied`. Échec, refus ou réception incertaine : « Message non envoyé » (ou « Réception non confirmée »), brouillon conservé, bouton « Reconnecter ». Aucun renvoi automatique : après reconnexion, l'utilisateur renvoie lui-même.
- Lecture : à l'ouverture, puis à chaque nouveau tour visible, `session.read { id, seq: dernier seq }`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it('orders prompts, replies and decision events; a pending request becomes an awaiting card', () => { /* … */ });
it('a suggestion in the reply is never an action', () => { /* next section → agent doc, no awaiting */ });
it('the composer is disabled while working, awaiting a decision or offline', () => { /* … */ });
// e2e
test('quick reply fills the draft without sending', async ({ page }) => { /* no session.reply sent */ });
test('send to an idle agent: taken by the terminal, draft cleared', async ({ page }) => { /* … */ });
test('send failure keeps the draft; after reconnect the user sends it explicitly', async ({ page }) => { /* exactly one reply after the explicit tap */ });
test('the awaiting card opens the same request as the inbox; free input stays disabled', async ({ page }) => { /* … */ });
test('opening the thread clears the unread mark', async ({ page }) => { /* session.read sent */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec vitest run test/thread.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier, puis comparer à `Thread.html` à 390 px**

Exécuter : `pnpm --filter mobile test && pnpm --filter mobile exec playwright test e2e/thread.spec.ts`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): agent thread with explicit delivery and kept drafts"
```

### Task 6: Terminal en lecture seule

Référence visuelle : `Terminal.html` (`renderTerminal`).

**Fichiers :**
- Créer : `apps/mobile/src/screens/Terminal.tsx`
- Modifier : `apps/mobile/src/screens/Thread.tsx` (bouton terminal dans l'en-tête)
- Test : `apps/mobile/e2e/terminal.spec.ts`

**Interfaces :**
- Consomme : `previews[sessionId]`, `opsReducer`, `newOperationId`.
- Lignes de `session.preview` dans un `<pre>` qui conserve les lignes, avec défilement horizontal propre au bloc (`tabindex="0"`, `aria-label` « Sortie du terminal, défilement horizontal »). Taille du texte de 11 à 20 px (A− et A+), mémorisée dans `ledge.mobile.terminalSize`.
- État : « Lecture seule · en direct », « en attente » (demande en attente) ou « dernier état connu » (hors ligne).
- « Interrompre <Bot> » n'est actif que si `state === 'working'` et en ligne. Il envoie `session.interrupt { id, operationId }`, puis affiche « Interruption transmise » à `applied`. Indication permanente : « Interrompre n'annule pas les actions déjà effectuées. » Le retour ramène au fil de la même session.

- [ ] **Étape 1 : écrire les tests e2e qui échouent**

```ts
test('long lines scroll inside the terminal, never the page, at 320 px', async ({ page }) => { /* … */ });
test('text size changes between 11 and 20 px and is remembered', async ({ page }) => { /* … */ });
test('interrupt is disabled while waiting or offline; one tap sends one interrupt', async ({ page }) => { /* … */ });
```

- [ ] **Étape 2 : vérifier l'échec**

Exécuter : `pnpm --filter mobile exec playwright test e2e/terminal.spec.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : implémenter**

- [ ] **Étape 4 : vérifier, puis comparer à `Terminal.html` à 390 px**

Exécuter : `pnpm --filter mobile test:e2e`
Attendu : PASS.

- [ ] **Étape 5 : commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): read-only terminal with explicit interrupt"
```

### Task 7: Documentation et validation du lot 3

**Fichiers :**
- Modifier : `README.md` (Protocol : `session.history`, `session.turns`, `session.read` ; Files : `history/`), `docs/mobile.md`, `docs/spikes/2026-10-14-ledge-mobile-feasibility.md` (R7)

- [ ] **Étape 1 : rédiger la documentation**

- [ ] **Étape 2 : passer toute la suite**

Exécuter : `pnpm -r typecheck && pnpm -r test && pnpm --filter overlay test:e2e && pnpm --filter mobile test:e2e`
Attendu : PASS.

- [ ] **Étape 3 : valider sur l'iPhone (R7 du plan directeur)**

Attendu : condition cochée dans le rapport, ou échec accepté explicitement par l'utilisateur.

- [ ] **Étape 4 : commit**

```bash
git add README.md docs/mobile.md docs/spikes/2026-10-14-ledge-mobile-feasibility.md
git commit -m "docs(mobile): threads, agents and terminal"
```
