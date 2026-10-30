# Ledge × OpenRig, lot 1 : retrait des équipes, arrivée de `ledge ask` (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** retirer de Ledge les équipes, les rôles et les tâches (`ledge team`, `--role`, `ledge task`, cartes et écrans associés) sur toutes les surfaces, et les remplacer, pour les sessions seules, par `ledge ask` : une décision adressée à l'utilisateur, visible dans « À toi » et répondue par `ledge decide` ou depuis Desktop.

**Architecture :**
- On ajoute d'abord `ledge ask`, à côté de l'existant (tâche 1). On retire ensuite les surfaces, de la plus haute à la plus basse : les cartes du chat, Desktop, le TUI, puis le mobile. Le daemon et le CLI viennent après, et le protocole en dernier.
- Ainsi chaque tâche compile et reste verte : une surface cesse d'utiliser un type avant que le protocole ne le supprime.
- Les asks ont leur propre petit schéma dans `packages/protocol/src/asks.ts`. Le lot 2 le projettera dans `EscalationSchema` (`source: 'ask'`) ; ce lot ne crée pas `Escalation`.

**Tech Stack :** TypeScript ESM, zod, vitest (+ ink-testing-library pour le TUI, Testing Library pour Desktop et mobile), playwright (`apps/desktop/e2e`), pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-10-30-ledge-openrig-orchestrator-design.md` §7 (et §1 objectif 6). Plan maître : `docs/superpowers/plans/2026-10-30-ledge-openrig-orchestrator.md`. Ses Global Constraints s'appliquent, en particulier « La transition » et « Persistance Ledge » (`asks.json`).

## Global Constraints

Celles du plan maître, plus :

- **Restent tels quels :** `ledge who`, `ledge send` et `ledge read`, la mailbox, `daemon/handover.ts` (on lui retire seulement les tâches et les équipes), `Session.autonomy`, `AutonomySchema`, `autonomyArgs`, `ompApprovalFor` (`session.launch` porte encore `autonomy`), la catégorie de son `team` (« Un bot arrive ou part », sans lien avec les équipes), et les `<task-notification>` de Claude (`session/markers.ts`, `TaskRow` de `Thread.tsx`), qui ne sont pas des tâches Ledge.
- **Données anciennes :** `tasks.json`, `teams-live.json` et `~/.ledge/teams/` (ainsi que `~/.ledge/roles/` et les `.ledge/{roles,teams}` des dépôts) ne sont ni lus ni effacés. Au démarrage, le daemon écrit une ligne de journal par fichier ou dossier présent, exactement : `ignored <chemin>: Ledge teams, roles and tasks were removed (2026-10-30-ledge-openrig-orchestrator-design §7)`.
- **Les champs persistés disparus** (`role`, `roleLabel` et `team` de `sessions.json`, `team` et `tasks` des tours de `chat.json`, `task`, `team` et `taskOp` des notices de l'historique) sont ignorés à la lecture. Les schémas zod sont non stricts : ils les retirent sans échouer. Un test le prouve pour chaque fichier (tâche 6b).
- **`ledge ask`, mot pour mot :**
  - usage `ledge ask "<question>" "<options, ta recommandation>"` ;
  - id `a` suivi de 6 caractères hexadécimaux ;
  - réponse de la commande : `décision <id> posée à l'utilisateur : sa réponse te réveillera` ;
  - hors d'une session lancée par Ledge : `ledge ask ne marche que dans une session lancée par Ledge`, code 1.
- **`ledge decide`, mot pour mot :**
  - la liste se lit `<id>  de <nom>  <question>`, puis les options en retrait de 4 espaces ;
  - liste vide : `aucune décision en attente` ;
  - après une réponse : `réponse envoyée à <nom>` ;
  - refusé depuis une session (`LEDGE_SESSION` ou la variable de hook Codex) : `refusé : ledge decide est la réponse de l'utilisateur, pas celle d'une session`.
- **Réveil :** la réponse arrive à la session par la mailbox, sous la forme `<ledge-answer id="<id>">Réponse de l'utilisateur à « <question> » : <texte></ledge-answer>` (texte passé par `ledgeBody`).
- **Desktop :** textes en français dans `i18n/fr.ts`, avec l'anglais à côté dans `en.ts`. Une carte d'ask dans « À toi » montre « Décision · de <nom> », la question, les options, un champ « Ta réponse… » et un bouton « Répondre ».
- **Vérification avant fusion :** `ledge team list`, lancé avec le `ledge` installé (celui d'avant ce lot), ne montre aucune équipe `active` ni `resting`. Sinon, on ne fusionne pas et on le signale à l'utilisateur.
- Chaque tâche finit verte : `pnpm typecheck` à la racine, et les tests des paquets qu'elle touche (`pnpm --filter <pkg> test`). Un commit par tâche, en Conventional Commits avec scope de paquet.

## Review Focus

1. **Une session ancienne reprise après la mise à jour** porte encore `role`, `roleLabel` et `team` dans `sessions.json`, et ses notices `task` dans son historique. Attendu : le daemon démarre, la session reprend sans `--permission-mode` tiré d'un rôle, et son fil s'affiche ; les notices d'une ancienne `<ledge-task>` restent du texte lisible. Tests : tâche 6b (`store`, `history`).
2. **Un client plus ancien parle à un daemon de ce lot** : une Desktop d'une autre machine envoie `task.cmd` ou `roles.list`, ou un téléphone en cache envoie `teams.catalog`. Attendu : une `error` `invalid` nommée (`request`), jamais un crash ni une connexion coupée. Côté fleet, un daemon distant plus ancien qui envoie encore `teams` ou `task.updated` est ignoré sans erreur. Tests : tâche 6b (`server`), tâche 6a (`fleet`).
3. **La session qui a posé un ask se termine avant la réponse.** Attendu : l'ask passe `dropped` et quitte « À toi » ; une réponse tardive par `ledge decide` est refusée avec `cette session s'est terminée avant ta réponse`. Test : tâche 1.
4. **Deux réponses au même ask**, depuis Desktop et `ledge decide`. Attendu : la première gagne ; la seconde reçoit `ask.result` avec `code: 'closed'` et la raison `déjà répondue`. Un seul `<ledge-answer>` part. Test : tâche 1.
5. **Une session Codex lance `ledge ask` dans son bac à sable** (le daemon n'y est pas joignable). Attendu : le hook Codex l'intercepte comme `ledge send`, et la sortie de la commande revient comme raison du refus. Test : tâche 1 (`hook`).

---

### Task 1 : `ledge ask`, ses données, `ledge decide` rebranché

**Files :**
- Create : `packages/protocol/src/asks.ts` (export par `packages/protocol/src/index.ts`) ; `packages/ledge/src/daemon/asks.ts` ; `packages/ledge/src/cli/ask.ts`
- Modify :
  - `packages/protocol/src/messages.ts` : messages client et serveur, et `DaemonInfoSchema.asks` ;
  - `packages/ledge/src/paths.ts` : `asks: join(dir, 'asks.json')` ;
  - `packages/ledge/src/daemon/server.ts` : création de `createAsks`, cas `ask.create` et `ask.answer`, `asks` envoyé après le snapshot, `ask.updated` diffusé, `daemon.asks: true` ;
  - `packages/ledge/src/daemon/index.ts` : journal et `flush` ;
  - `packages/ledge/src/daemon/crossSession.ts` : `formatLedgeAnswer`, `ledgeAnswer` ;
  - `packages/ledge/src/daemon/history.ts` : une `<ledge-answer>` devient une notice `other`, sans prompt ;
  - `packages/ledge/src/cli/decide.ts` : réécrit sur les asks ;
  - `packages/ledge/src/cli/index.ts` : `case 'ask'` et ligne d'USAGE ;
  - `packages/ledge/src/cli/send.ts` : `parseLedgeCommand` reconnaît `ask` ;
  - `packages/ledge/src/cli/hook.ts` : `runLedgeCommand` route `ask`, et `identityContext` remplace le paragraphe sur les tâches ;
  - `packages/fleet/src/fleet.ts`, `packages/fleet/src/machines.ts` (`useAsks`), `packages/fleet/src/index.ts`.
- Test :
  - Create : `packages/protocol/test/asks.test.ts`, `packages/ledge/test/asks.test.ts`, `packages/ledge/test/ask-cli.test.ts`, `packages/fleet/test/asks-source.test.ts` ;
  - Modify : `packages/ledge/test/hook.test.ts`, `packages/ledge/test/send.test.ts`, `packages/ledge/test/history.test.ts`.

**Interfaces :**
- Consumes : `Mailbox.notify(target, text, rid)` (`daemon/mailbox.ts:33`), `jsonJournal` (`daemon/journal.ts`), `ledgeBody` (`daemon/crossSession.ts:45`), `connect` (`client.ts`), `CODEX_HOOK_VAR` (`spawn.ts`).
- Produces (`packages/protocol/src/asks.ts`) :

```ts
export const ASK_QUESTION_MAX = 2000; export const ASK_OPTIONS_MAX = 4000; export const ASK_ANSWER_MAX = 4000;
export const AskIdSchema = z.string().regex(/^a[0-9a-f]{6}$/);
/** A decision a lone session asks the user (`ledge ask`). Lot 2 maps it into `Escalation`:
 *  id `ask-<id>`, source 'ask', from = fromName, intent 'decision', summary = question, detail = options,
 *  questions = [], state open→pending | answered→answered | dropped→closed, answer → { by: 'user', answers: { text } }. */
export const AskSchema = z.object({ id: AskIdSchema, from: z.string().min(1), fromName: z.string(),
  question: z.string().min(1).max(ASK_QUESTION_MAX), options: z.string().max(ASK_OPTIONS_MAX), at: z.string().datetime(),
  state: z.enum(['open', 'answered', 'dropped']), answer: z.object({ text: z.string().min(1).max(ASK_ANSWER_MAX), at: z.string().datetime() }).optional(),
  closedAt: z.string().datetime().optional() });
export type Ask = z.infer<typeof AskSchema>;
export const AskRefusalSchema = z.enum(['unknown', 'closed', 'dropped', 'not_session', 'invalid']);
// client
export const AskCreateSchema = z.object({ type: z.literal('ask.create'), rid: z.string().min(1).max(100), by: z.string().min(1),
  question: AskSchema.shape.question, options: AskSchema.shape.options });
export const AskAnswerSchema = z.object({ type: z.literal('ask.answer'), rid: z.string().min(1).max(100), id: AskIdSchema,
  text: z.string().trim().min(1).max(ASK_ANSWER_MAX), machineId: z.string().optional() });
// server
export const AsksMessageSchema = z.object({ type: z.literal('asks'), asks: z.array(AskSchema) });
export const AskUpdatedSchema = z.object({ type: z.literal('ask.updated'), ask: AskSchema });
export const AskResultSchema = z.object({ type: z.literal('ask.result'), rid: z.string(), ask: AskSchema.optional(),
  code: AskRefusalSchema.optional(), reason: z.string().optional() });
export const askShown = (a: Pick<Ask, 'state'>): boolean => a.state === 'open';
```

- Produces (`packages/ledge/src/daemon/asks.ts`) :
  - `createAsks(d: { store: Pick<Store, 'get' | 'all' | 'onChange'>; mailbox: Pick<Mailbox, 'notify'>; now?: () => string; journal?: AsksJournal; onAsk?(a: Ask): void }): Asks` ;
  - `interface Asks { create(by: string, question: string, options: string): Ask | { code: AskRefusal; reason: string }; answer(id: string, text: string): Ask | { code: AskRefusal; reason: string }; all(): Ask[]; close(): void }` ;
  - `asksJournal(path: string): AsksJournal & { flush(): Promise<void> }`, avec `type AsksJournal = Journal<Ask[]>`. On garde les asks fermés 7 jours, 200 au plus, comme `tasks.ts` (`CLOSED_TTL_MS`, `CLOSED_MAX`).
- Produces (`packages/ledge/src/cli/ask.ts`) : `ASK_USAGE`, `askArgs(args: string[]): { question: string; options: string } | undefined`, `askOnClient(client: Client, args: string[], by: string, ms: number): Promise<{ line: string; code: number }>`, `runAsk(args, opts?: { port?: number; env?: NodeJS.ProcessEnv; timeoutMs?: number })`.
- Produces (`crossSession.ts`) : `formatLedgeAnswer(a: { id: string; question: string; text: string }): string`, `ledgeAnswer(text: string): { id: string; text: string } | undefined`.
- Produces (fleet) :
  - `type FleetAsk = Ask & { machine: string }` ;
  - `fleet.asks(): FleetAsk[]`, avec les asks de chaque machine, ouverts seulement, triés par `at` ;
  - `fleet.answerAsk(machine: string, id: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }>`, qui envoie `ask.answer` au daemon de `machine` et attend `ask.result` 4 s ;
  - `useAsks(client: DaemonClient): FleetAsk[]`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// packages/protocol/test/asks.test.ts
it('AskIdSchema takes a + 6 hex only', () => { expect(AskIdSchema.safeParse('a1b2c3d').success).toBe(false); expect(AskIdSchema.safeParse('a1b2c3').success).toBe(true); expect(AskIdSchema.safeParse('t1b2c3').success).toBe(false); });
it('ask.create and ask.answer are client messages, asks / ask.updated / ask.result server messages', () => {
  expect(ClientMessageSchema.safeParse({ type: 'ask.answer', rid: 'r', id: 'a1b2c3', text: 'B' }).success).toBe(true);
  expect(ClientMessageSchema.safeParse({ type: 'ask.answer', rid: 'r', id: 'a1b2c3', text: '  ' }).success).toBe(false);
  expect(ServerMessageSchema.safeParse({ type: 'ask.result', rid: 'r', code: 'closed', reason: 'déjà répondue' }).success).toBe(true);
});

// packages/ledge/test/asks.test.ts (store et mailbox factices, comme tasks.test.ts)
it('create: an open ask from a live launcher session, id a+6 hex, fromName its name', ...);          // state 'open', from 's1', fromName 'Nova'
it('create: refused for an unknown or exited session with code not_session', ...);
it('answer: closes it, records text and time, and notifies the asker once with a <ledge-answer>', () => {
  // expect(notify).toHaveBeenCalledWith('s1', '<ledge-answer id="a…">Réponse de l\'utilisateur à « Quelle base ? » : B</ledge-answer>', `ask:${id}`)
});
it('answer twice: the second is refused with code closed and reason « déjà répondue », and notifies nothing', ...);
it('the asker exits before the answer: the ask drops, and a later answer is refused with « cette session s\'est terminée avant ta réponse »', ...);
it('answer: unknown id refused with code unknown', ...);
it('journal: asks outlive the daemon; closed ones older than 7 days are dropped on save', ...);
it('emits onAsk on every change', ...);

// packages/ledge/test/ask-cli.test.ts (faux daemon de test, comme team-cli.test.ts)
it('askArgs: exactly a non-empty question and an options string', () => { expect(askArgs(['Q ?', 'A, B (je recommande B)'])).toEqual({ question: 'Q ?', options: 'A, B (je recommande B)' }); expect(askArgs(['Q ?'])).toBeUndefined(); expect(askArgs(['', 'x'])).toBeUndefined(); });
it('runAsk outside a Ledge session: « ledge ask ne marche que dans une session lancée par Ledge », code 1', ...);
it('runAsk: « décision <id> posée à l\'utilisateur : sa réponse te réveillera »', ...);
it('runDecide lists open asks: « <id>  de <nom>  <question> » then the options indented by 4', ...);
it('runDecide with none: « aucune décision en attente »', ...);
it('runDecide <id> "<réponse>": « réponse envoyée à <nom> »; a refusal prints « refusé : <raison> », code 1', ...);
it('runDecide from a session env (LEDGE_SESSION or the Codex hook var) is refused before connecting', ...);

// packages/ledge/test/send.test.ts
it('parseLedgeCommand reads a lone ledge ask', () => expect(parseLedgeCommand('ledge ask "Q ?" "A ou B"')).toEqual({ cmd: 'ask', args: ['Q ?', 'A ou B'] }));
// packages/ledge/test/hook.test.ts
it('a Codex PreToolUse running `ledge ask` is run by the hook and denied with its output', ...);
it('identityContext names ledge ask and no longer ledge task give ledge', () => {
  const t = identityContext(identity); expect(t).toContain('ledge ask "<question>" "<options, ta recommandation>"'); expect(t).toContain('<ledge-answer>'); expect(t).not.toMatch(/ledge task give ledge/);
});
// packages/ledge/test/history.test.ts
it('a <ledge-answer> prompt becomes an `other` notice, not a user prompt', ...);
// packages/fleet/test/asks-source.test.ts
it('keeps the open asks of every machine with their machine, and drops answered ones on ask.updated', ...);
it('answerAsk routes ask.answer to the ask\'s machine without machineId and resolves on its ask.result', ...);
it('answerAsk resolves { ok: false, reason } on a refusal, and « hors ligne » when the machine is not connected', ...);
it('an older daemon that never sends asks leaves asks() empty', ...);
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @ledge/protocol test -- asks && pnpm --filter @paradow/ledge test -- asks ask-cli send hook history && pnpm --filter @ledge/fleet test -- asks-source`
Expected : FAIL (modules et exports absents). Noms de paquets : `@ledge/protocol`, `@paradow/ledge`, `@ledge/fleet`, `@ledge/ui`, `desktop`, `overlay`, `@ledge/mobile`.

- [ ] **Step 3 : implémenter les signatures des Interfaces**

- Serveur :
  - `ask.create` : le `by` doit être une session vivante lancée par Ledge, avec la même règle que `tasks.ts:40`, sinon `not_session`. Réponse : `ask.result { rid, ask }`, ou `{ rid, code, reason }`.
  - `ask.answer` répond par `ask.result`. Tout changement diffuse `ask.updated` aux fronts locaux.
  - Après le snapshot, l'envoi `{ type: 'asks', asks: asks.all().filter(askShown) }` se fait à côté de celui de `teams`.
- Hook :
  - Codex : `runLedgeCommand` gagne une branche `cmd.cmd === 'ask'`, qui appelle `askOnClient`.
  - Texte d'identité : la phrase sur `ledge task give` (`hook.ts:396`) devient « Un message sert à prévenir. Une décision qui revient à l'utilisateur se pose avec `ledge ask "<question>" "<options, ta recommandation>"` : sa réponse te réveille (une `<ledge-answer>`), inutile d'attendre la fin pour la poser. »
  - Dans la ligne Codex (`hook.ts:394`), la liste des commandes exécutées par Ledge devient `ledge send`, `ledge read`, `ledge ask` et `ledge who`.
  - Le paragraphe des tâches tenues (`tasksContext`) reste jusqu'à la tâche 6a.
- Fleet : les asks se suivent pour chaque machine, en dehors du chemin local seul des tâches (`fleet.ts:220`). Les `from` restent tels quels, car l'ask porte sa `machine`.

- [ ] **Step 4 : lancer, constater le succès, puis typecheck**

Run : la commande du Step 2, puis `pnpm typecheck`
Expected : PASS ; typecheck sans erreur.

- [ ] **Step 5 : commit**

```bash
git add packages/protocol packages/ledge packages/fleet
git commit -m "feat(ledge): ledge ask, a decision for the user, answered by ledge decide"
```

### Task 2 : le chat ne propose plus d'équipe ni de tâche

**Files :**
- Modify :
  - protocole : `packages/protocol/src/actions.ts` (retirer `team.launch`, `task.give`, `team.join`, `team.leave`, `team.resume`, `team.dissolve`, `team.save`, `task.cancel`, `task.pass`, les cartes `'team' | 'task'`, `TeamRef`, `TaskRef`, et les entrées `team`/`task` de la table carte→action, `actions.ts:179`) ;
  - `packages/protocol/src/proposal.ts` (retirer `TeamBlockSchema`, `TaskBlockSchema`, `parseTeamBlock`, `parseTaskBlock`, les clôtures ```` ```ledge-team ```` et ```` ```ledge-task ````, et `'team' | 'task'` de `BlockKind`) ;
  - `packages/protocol/src/chat.ts` (retirer `ChatTeamSeatSchema`, `ChatTeamProposalSchema`, `ChatTaskProposalSchema`, `ChatTasksSchema`, `team`/`tasks` de `ChatTurnSchema`, `team` de l'action, et les codes de refus `member`, `not_member`, `unknown_role`, `not_resting`, `dissolved`, `no_seat`, `holder`) ;
  - `packages/protocol/src/messages.ts` (`chat.done` sans `team`/`tasks`) ;
  - `packages/protocol/src/phone.ts` (`PhoneChatTeamSchema`, `PhoneChatTaskSchema`, `team`/`tasks` du tour, et les messages téléphone `chat.team` et `chat.task`) ;
  - daemon : `packages/ledge/src/chat/{service,context,persona,act}.ts` (plus de `teamFrom`, `tasksFrom`, `markTeam`, `markTask`, `followTask` ni `writeTeamsContext` ; plus de `roles.md`, `teams.md` ni `tasks.md` ; la persona ne cite plus « l'équipe ») ;
  - `packages/ledge/src/daemon/actions.ts` (`resolveAction` sans les branches `team.*`/`task.*`, et le contexte sans `teams`, `tasks`, `findRole` ni `templateExists`) ;
  - `packages/ledge/src/daemon/server.ts` (lignes 196, 311, 838-880 : `cardThreads…followTask`, `team.saved`/`task.result` comme échecs de ligne, contexte de `resolveAction`) ;
  - `packages/ledge/src/mobile/{gateway,chat,project}.ts` (`chatTeam`, `chatTask`, projection des cartes) ;
  - UI partagée : `packages/ui/src/chat/{ChatView,copy,actionCopy,actionWords,actionRow,ActionCard}.tsx|ts` ;
  - Desktop : `apps/desktop/src/chat/ChatPanel.tsx`, et `apps/desktop/src/i18n/{fr,en}.ts` (`chat.team`, `chat.task`, les libellés d'action `team.*`/`task.*`) ;
  - TUI : `packages/ledge/src/tui/model/chat.ts`, `packages/ledge/src/tui/model/actionCard.ts`, `packages/ledge/src/tui/screens/Ask.tsx`, `packages/ledge/src/tui/i18n/{fr,en}.ts` ;
  - mobile : `apps/mobile/src/ui/chat/TurnView.tsx`, `apps/mobile/src/state/store.ts` (`launchTeam`, `giveTask`) et `apps/mobile/src/state/operations.ts` (`chat.team`, `chat.task`).
- Delete : `packages/ui/src/chat/TeamCard.tsx`, `packages/ui/src/chat/TaskCard.tsx`, `apps/desktop/src/chat/useTeamCards.ts`, `apps/mobile/src/ui/chat/TeamCard.tsx`, `apps/mobile/src/ui/chat/TaskCard.tsx`.
- Test :
  - Modify : `packages/protocol/test/{actions,proposal,messages,phone}.test.ts`, `packages/ledge/test/{chat-context,chat-act,chat-persona,daemon-actions,tui-action-card,mobile-gateway}.test.ts`, `packages/ui/test/{action-card,chat-action-card}.test.tsx`, `packages/ui/test/chat-copy-fixture.ts`, `apps/desktop/test/{chat,action-card}.test.tsx`, `apps/overlay/test/act-from-chat.test.tsx` (sa ligne `team.dissolve` devient `session.close`), `apps/mobile/test/screens/chat-cards.test.tsx`, `apps/mobile/test/state/chat.test.ts` ;
  - Delete : rien.

**Interfaces :**
- Consumes : rien de la tâche 1.
- Produces :
  - `ActionId` ne contient plus aucun `team.*` ni `task.*` ;
  - `BlockKind = 'session' | 'relay' | 'project' | 'close' | 'action'` ;
  - `ChatTurn` n'a plus `team` ni `tasks` ;
  - `ChatViewProps` n'a plus `onLaunchTeam`, `onSaveTeam`, `onOpenTeam`, `onGiveTask`, `teamBusy` ni `taskBusy` ;
  - `ChatCopy.chat` n'a plus `team` ni `task`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// packages/protocol/test/actions.test.ts
it('the registry holds no team or task action', () => expect(ACTIONS.map(a => a.id).filter(id => /^(team|task)\./.test(id))).toEqual([]));
// packages/protocol/test/proposal.test.ts
it('a ```ledge-team or ```ledge-task block is plain text, not a card', () => {
  expect(extractProposal('```ledge-team\n{"cwd":"/x","template":"a"}\n```').kind ?? null).toBeNull();
});
// packages/protocol/test/messages.test.ts
it('a chat.done with an old team or tasks field parses, without them', () => {
  const r = ServerMessageSchema.parse({ type: 'chat.done', qid: 'q', text: 't', at: NOW, team: { name: 'x' }, tasks: [{ to: 'a', title: 'b' }] });
  expect(r).not.toHaveProperty('team'); expect(r).not.toHaveProperty('tasks');
});
// packages/ledge/test/chat-context.test.ts
it('writes no roles.md, teams.md or tasks.md', async () => { /* writeContext(...) ; readdir(dir) */ expect(files).not.toContain('teams.md'); expect(files).not.toContain('roles.md'); expect(files).not.toContain('tasks.md'); });
// packages/ledge/test/chat-persona.test.ts
it('the persona speaks of no team', () => expect(buildPersona('claude')).not.toMatch(/teams\.md|tasks\.md|équipe/));
// packages/ui/test/chat-action-card.test.tsx
it('ChatView draws no team or task card for an old turn that carries one', ...); // render a turn with { team, tasks } cast: no [data-card="team"], no [data-card="task"]
```

Noms actuels : `extractProposal` (`proposal.ts:46`), `ACTIONS` (`actions.ts:50`), `buildPersona(tool)` (`persona.ts:38`).

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @ledge/protocol test -- actions proposal messages && pnpm --filter @paradow/ledge test -- chat-context chat-persona && pnpm --filter @ledge/ui test -- chat-action-card`
Expected : FAIL (les actions `team.*` existent encore, `teams.md` est écrit…).

- [ ] **Step 3 : retirer, dans l'ordre**

1. Le protocole (fichiers ci-dessus).
2. Le daemon chat et actions, puis `server.ts`.
3. `mobile/{gateway,chat,project}.ts`.
4. L'UI partagée.
5. Desktop, TUI et mobile.

Après chacune de ces étapes, `pnpm typecheck` guide la suivante. On retire les copies devenues sans clé (`actionCopy.ts:16-17,55-56`).

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm typecheck && pnpm --filter @ledge/protocol --filter @paradow/ledge --filter @ledge/ui --filter desktop --filter overlay --filter @ledge/mobile test`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git commit -am "feat(protocol): the chat no longer proposes teams or tasks"
```

### Task 3 : Desktop sans équipes, l'ask dans « À toi »

**Files :**
- Delete :
  - `apps/desktop/src/teams/Catalog.tsx` et `apps/desktop/src/teams/useTeamsApi.ts`, donc le dossier `teams/` ;
  - `apps/desktop/src/launch/TeamLaunch.tsx`, `apps/desktop/src/atelier/RoleChooser.tsx` ;
  - les tests `apps/desktop/test/{atelier-teams,seat-team,catalog-remote,launch-role-reread}.test.tsx` ;
  - le test e2e `apps/desktop/e2e/catalog.spec.ts`.
- Create : `apps/desktop/src/session/useRelief.ts` (ce qui survit de `useTeamsApi` : `handover`, `later`, `putLater`, `near`, `nearLimit`) ; `apps/desktop/src/shell/sidebar/AskCard.tsx`.
- Modify :
  - `apps/desktop/src/App.tsx` : plus de `useTeamsApi` ni de modale `TeamLaunch` ; `useRelief` et `useAsks` ;
  - `apps/desktop/src/atelier/AtelierWindow.tsx` ;
  - `apps/desktop/src/nav/state.ts` : `HomeTab = 'conversation' | 'history'`, plus de `task` dans la place `home` ni dans l'action `ledge`, plus de `team` dans la modale `launch` ;
  - `apps/desktop/src/chat/LedgeHome.tsx` : plus d'onglets Équipes ni Tâches, ni de ce qui ne servait qu'à eux (`given`, filtres `giver`/`team`) ;
  - `apps/desktop/src/shell/sidebar/{Sidebar,Tree,Attention,model}.tsx|ts` : plus de lignes d'équipe ni de `TeamGroup`, plus de `ledgeTasks` ; « À toi » reçoit `asks` ; la ligne Ledge compte `attn + asks + near` (signature `t.side.ledgeLine(n)`, sans le nombre d'équipes) ;
  - `apps/desktop/src/atelier/{Atelier,ProjectRoom,ProjectTable,layout,seats,MessageLayer}.tsx|ts` : une pièce de projet n'a qu'une table, et `.heading-team-line` disparaît ; `MessageLayer` ne dessine plus que les messages entre sessions, sans `transmissions` de tâche ; l'entrée « Nouvelle équipe ici » du menu de pièce disparaît ;
  - `apps/desktop/src/session/{SessionPage,NoticeLine,Thread}.tsx` : plus de tâche épinglée, de `⚑ équipe` ni de `@rôle` dans la méta ; `NoticeLine` sans `onOpenTask` ni kicker TÂCHE/ÉQUIPE ;
  - `apps/desktop/src/shell/TopBar.tsx` : plus de `role-pill` ;
  - `apps/desktop/src/launch/LaunchComposer.tsx` : plus de rôle (`wanted.role`, relecture, `listRoles`) ;
  - `apps/desktop/src/i18n/{fr,en}.ts` : retrait de `teamLaunch`, `home.tabs.teams`, `home.tabs.tasks`, `home.tasks`, `home.teams`, `session.seat`, `session.notice.task`/`team`, `launch.role*` et des clés d'équipe de `teams` (`teamTable`, `teamLine`, `teamMenu*`, `newTeamHere`) ; les clés de pièce gardées passent de `teams` à `rooms` ; ajout de `side.ask` ;
  - `apps/desktop/src/styles/{shell,session,sidebar,atelier}.css` : règles `.heading-team-line`, `.role-pill`, `.pinned-task`, `.st-task` (sauf `.st-near`), `.notice-team`, `.notice-task` et table d'équipe ;
  - `apps/desktop/e2e/daemon.ts` : le faux daemon n'envoie plus `teams`, `task.result` ni `roles.listing`, et envoie `asks` (vide par défaut, et une graine `?asks=1`, sur le modèle de ses autres graines) ;
  - `apps/desktop/e2e/sidebar.spec.ts`.
- Test :
  - Modify : `apps/desktop/test/{ledge-home,atelier,atelier-layout,sidebar,chat}.test.tsx|ts` ;
  - Create : `apps/desktop/test/ask-card.test.tsx` ;
  - e2e : `apps/desktop/e2e/sidebar.spec.ts`, avec le cas « un ask dans À toi, répondu ».

**Interfaces :**
- Consumes : `useAsks`, `FleetAsk`, `fleet.answerAsk` (tâche 1).
- Produces :
  - `useRelief(client: DaemonClient): { handover(id: string): Promise<string | null>; later: ReadonlyMap<string, number>; putLater(s: Session): void; near: number }` ;
  - `nearLimit(...)`, déplacé tel quel ;
  - `AskCard(p: { ask: FleetAsk; onAnswer(text: string): Promise<{ ok: true } | { ok: false; reason: string }> }): JSX.Element` ;
  - copie `side.ask` : `{ kicker: 'Décision', from: (n: string) => `de ${n}`, placeholder: 'Ta réponse…', send: 'Répondre', sending: 'Envoi…', sent: (n: string) => `Réponse envoyée à ${n}`, refused: (r: string) => `Refusé : ${r}` }`, et en anglais `{ kicker: 'Decision', from: n => `from ${n}`, placeholder: 'Your answer…', send: 'Answer', sending: 'Sending…', sent: n => `Answer sent to ${n}`, refused: r => `Refused: ${r}` }`.

- [ ] **Step 1 : écrire les tests qui échouent**

```tsx
// apps/desktop/test/ask-card.test.tsx
it('shows « Décision · de Nova », the question, the options, and sends the trimmed answer', async () => {
  const onAnswer = vi.fn().mockResolvedValue({ ok: true });
  render(<AskCard ask={{ id: 'a1b2c3', from: 's1', fromName: 'Nova', question: 'Quelle base ?', options: 'A ou B (je recommande B)', at: NOW, state: 'open', machine: 'local' }} onAnswer={onAnswer} />);
  expect(screen.getByText('Décision')).toBeVisible(); expect(screen.getByText('de Nova')).toBeVisible();
  expect(screen.getByText('A ou B (je recommande B)')).toBeVisible();
  await user.type(screen.getByPlaceholderText('Ta réponse…'), '  B  '); await user.click(screen.getByRole('button', { name: 'Répondre' }));
  expect(onAnswer).toHaveBeenCalledWith('B');
});
it('« Répondre » is disabled while the field is blank, and while sending', ...);
it('a refusal shows « Refusé : déjà répondue » and keeps the text', ...);
// apps/desktop/test/sidebar.test.tsx
it('À toi lists open asks after the waiting sessions, and the Ledge line counts them', ...);
it('the tree draws no team row; every session of a project sits under it by branch', ...);
// apps/desktop/test/ledge-home.test.tsx
it('Ledge home has two tabs: Conversation and Historique', () => expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Conversation', 'Historique']));
// apps/desktop/test/atelier.test.tsx
it('a project room has one table with all its sessions, and no .heading-team-line', ...);
it('the room menu offers « Nouvelle session ici » and no team entry', ...);
// apps/desktop/e2e/sidebar.spec.ts
test('an ask from the fake daemon shows in À toi and is answered', ...); // ?asks=1 ; type « B » ; « Répondre » ; the card leaves
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter desktop test -- ask-card sidebar ledge-home atelier`
Expected : FAIL (`AskCard` absent, l'onglet Équipes existe).

- [ ] **Step 3 : implémenter**

- Supprimer les fichiers listés. `pnpm --filter desktop typecheck` guide les retraits.
- `AskCard` réutilise les classes `st-card` de `Attention.tsx` et le `Button` du design system existant. Le champ est un `textarea` de 3 lignes, et la carte n'a pas d'autre bouton.
- `Attention` reçoit `asks: readonly FleetAsk[]` et `onAnswerAsk(ask: FleetAsk, text: string)`. Les asks se placent après les sessions en attente et avant les sessions proches de la limite.

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm typecheck && pnpm --filter desktop test && pnpm --filter desktop e2e`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git commit -am "feat(desktop): remove teams, roles and tasks; asks in À toi"
```

### Task 4 : TUI sans équipes

**Files :**
- Delete : `packages/ledge/src/tui/screens/Teams.tsx`, `packages/ledge/src/tui/model/catalog.ts`, `packages/ledge/test/tui-catalog.test.ts`.
- Modify :
  - `packages/ledge/src/tui/App.tsx` : plus d'écran `teams`, ni de `useTeams`/`useTasks` ; `useAsks` à la place ;
  - `packages/ledge/src/tui/model/overview.ts` : plus de tables d'équipe ni de `closedLedgeTasks` ; les asks ouverts entrent dans « À toi » ;
  - `packages/ledge/src/tui/screens/Overview.tsx` : plus de `x` sur une tâche close ; une ligne d'ask porte l'indice `ledge decide <id> "<réponse>"` ;
  - `packages/ledge/src/tui/screens/Launch.tsx` : plus de choix de rôle ni d'équipe ;
  - `packages/ledge/src/tui/screens/Help.tsx` : plus de touche « Équipes » ;
  - `packages/ledge/src/tui/glyphs.ts` : `team`/`common` retirés si plus utilisés ;
  - `packages/ledge/src/tui/i18n/{fr,en}.ts`.
- Test : Modify `packages/ledge/test/{tui-screens,tui-theme-screens,tui-model}.test.ts|tsx`.

**Interfaces :**
- Consumes : `useAsks`, `FleetAsk` (tâche 1).
- Produces : `overview(sessions, projects, asks: readonly FleetAsk[]): OverviewModel`, dont l'élément d'attention gagne `{ kind: 'ask'; ask: FleetAsk }` (le nom de l'union existante est gardé).

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// packages/ledge/test/tui-model.test.ts
it('overview lists an open ask in À toi as « ? Nova : Quelle base ? »', ...);
it('overview builds one table per project, no team table', ...);
// packages/ledge/test/tui-screens.test.tsx
it('no key opens a Teams screen, and Help lists none', ...);
it('an ask row shows the hint ledge decide a1b2c3 "<réponse>"', ...);
it('Launch offers no role field', ...);
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @paradow/ledge test -- tui-`
Expected : FAIL.

- [ ] **Step 3 : implémenter** (retraits guidés par `pnpm --filter @paradow/ledge typecheck`)

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm typecheck && pnpm --filter @paradow/ledge test -- tui-`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git commit -am "feat(ledge): the TUI drops teams and shows asks"
```

### Task 5 : mobile sans équipes, et sa passerelle

**Files :**
- Delete :
  - écrans `apps/mobile/src/screens/{Teams,LiveTeam,TeamEditor,RoleEditor,SeatModel,teamsEditing}.tsx` ;
  - modèles `apps/mobile/src/model/{teams,teamsOutcome,teamsPending,catalog}.ts` ;
  - `apps/mobile/src/ui/teams/` (`LePoint`, `RolePill`, `SeatMeta`) ;
  - côté daemon, `packages/ledge/src/mobile/teamsOps.ts` ;
  - `packages/protocol/src/phoneTeams.ts` (sa `canonicalJson` part dans `phone.ts`) ;
  - les tests `apps/mobile/test/screens/{live-team,role-editor,seat-model,team-editor,teams-tab,teams}.test.tsx`, `apps/mobile/test/state/teams-store.test.ts`, `apps/mobile/test/model/{teams-pending,catalog}.test.ts`, `packages/ledge/test/mobile-teams-ops.test.ts`, `packages/protocol/test/phoneTeams.test.ts`.
- Modify :
  - `packages/protocol/src/phone.ts` :
    - retirer `PhoneTeamSchema`, `PhoneTaskSchema`, les messages serveur `teams`, `tasks`, `task.updated` et `teams.catalog`/`teams.role`, et les messages client `team.resume`, `task.seen`, `teams.catalog`, `teams.role`, `role.*`, `template.*` et `team.*` ;
    - retirer `role`, `roleLabel` et `team` de `PhoneSessionSchema`, et `daemon.teams` du snapshot ;
    - retirer les buts `define` et `team` de `ConfirmPurposeSchema` et le champ `digest` de `confirm.prepare`, ainsi que `teamsPurpose` et `teamsDigest` ;
    - renommer `teamsOp` en `signedOp` (gardé pour `daemon.update` et `daemon.restart`) ;
    - retirer de `OperationReasonSchema` les codes propres aux définitions (`changed`, `exists`, `unknown_project`, `seat_failed`) ;
    - `PHONE_PROTOCOL` reste à 1, parce que les retraits sont des messages que le daemon ignore ou refuse en `invalid`.
  - `packages/protocol/src/index.ts`.
  - `packages/ledge/src/mobile/{gateway,project,operations}.ts` : plus de `teams`/`tasks` dans les dépendances, plus de `teamsAndTasks`, `phoneTeams`, `phoneTask`, `toPhoneTeam`, `toPhoneTask`, `phoneTasks`, ni du suivi de `team.updated`/`task.updated`.
  - `packages/ledge/src/daemon/server.ts` : les dépendances `teams`, `tasks`, `teamCatalog` et `projectByName` qu'il passait à la passerelle, seulement si elles ne servent plus qu'à elle.
  - `apps/mobile/src/{App.tsx,router.ts,copy.ts}`, `apps/mobile/src/ui/TabBar.tsx` (plus d'onglet Équipes), `apps/mobile/src/screens/{Inbox,Chat,Agents}.tsx` (plus de filtre « tasks », de `TaskRow` ni de `LePoint` ; la pilule de rôle disparaît), `apps/mobile/src/model/agents.ts` (`role`), `apps/mobile/src/state/{store,operations}.ts`.
- Test : Modify `apps/mobile/test/{router.test.ts,screens/agents.test.tsx,screens/chat.test.tsx,screens/gone.test.tsx,state/operations.test.ts}`, `packages/ledge/test/mobile-gateway.test.ts`, `packages/ledge/test/helpers/gateway.ts`, `packages/protocol/test/phone.test.ts`.

**Interfaces :**
- Consumes : rien des tâches précédentes.
- Produces : `PhoneClientMessageSchema` et `PhoneServerMessageSchema` sans aucun membre d'équipe, de rôle ni de tâche ; `canonicalJson` exporté par `phone.ts`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// packages/protocol/test/phone.test.ts
it('the phone whitelist holds no team, role, template or task message', () => {
  const types = PhoneClientMessageSchema.options.map(o => o.shape.type.value);
  expect(types.filter(t => /^(team|teams|role|template|task)\.|^chat\.(team|task)$/.test(t))).toEqual([]);
});
it('daemon.update still takes a passkey assertion', () => expect(PhoneClientMessageSchema.safeParse({ type: 'daemon.update', op: OP, version: '1.2.3', assertion: ASSERTION }).success).toBe(true));
// packages/ledge/test/mobile-gateway.test.ts
it('a cached phone sending teams.catalog gets { type: "error", code: "invalid", request: "teams.catalog" }', ...);
it('after a snapshot the gateway pushes no teams and no tasks', ...);
// apps/mobile/test/router.test.ts
it('#/teams and #/live/<id> fall back to the agents route', ...);
// apps/mobile/test/screens/agents.test.tsx
it('no role pill is drawn', ...);
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @ledge/protocol test -- phone && pnpm --filter @paradow/ledge test -- mobile-gateway && pnpm --filter @ledge/mobile test -- router agents`
Expected : FAIL.

- [ ] **Step 3 : implémenter** (protocole d'abord, puis la passerelle, puis l'app ; `pnpm typecheck` guide)

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm typecheck && pnpm --filter @ledge/protocol --filter @paradow/ledge --filter @ledge/mobile test`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git commit -am "feat(mobile): remove the Teams tab, role and task screens"
```

### Task 6a : daemon, CLI et fleet sans équipes ni tâches

**Files :**
- Delete :
  - `packages/ledge/src/daemon/{teams,teamsLive,tasks,roles,seat,definitions}.ts` ;
  - `packages/ledge/src/cli/{team,task}.ts` ;
  - les tests `packages/ledge/test/{teams-server,teamsLive,teams-flow,team-cli,tasks,roles,definitions,definitions-server}.test.ts`, `packages/fleet/test/teams-source.test.ts`.
- Modify :
  - `packages/ledge/src/daemon/server.ts` :
    - retirer `createTasks` et `createTeamsLive`, les cas `task.cmd`, `roles.list`, `definitions.list`, `role.write`, `role.delete`, `template.write`, `template.delete`, `team.launch`, `team.join`, `team.leave`, `team.resume`, `team.dissolve`, `team.save`, `team.compose` et `team.seat` ;
    - retirer `launchTeam`, `startSeats`, `launchSeat`, `seatModels`, les sièges sortants (`leaving`), `changeDefinition`, `ompSeat` et le `role`/`team` de `LaunchReq`, `launch`, `launchTmux` et `launchOmp` ;
    - à la reprise d'une session, ne plus recopier `role`, `roleLabel` ni `team` (`server.ts:681,708-709`) ;
    - retirer l'envoi de `teams` après le snapshot, et le `teams: true` de `daemon` ;
    - la relève automatique (`server.ts:330`) perd sa condition `cur.team` et ne garde que `cur.autonomy === 'auto'` [P] : une session seule lancée en `auto` est relevée, ce qui garde le comportement dont le cerveau aura besoin (spec §5.1) ;
    - les options `tasks?` et `teams?` de `startServer` disparaissent.
  - `packages/ledge/src/daemon/handover.ts` : dépendances sans `tasks` ni `teams`, relance sans `role`/`team`, plus de passage de tâches (`handover.ts:82-132`), bilan par défaut sans tâches.
  - `packages/ledge/src/daemon/history.ts` : plus de `recordTask`, ni de `quote` importé de `tasks.ts` (une copie locale à 3 lignes) ; la branche `ledgeTask` est retirée [P], si bien qu'une ancienne `<ledge-task>` s'affiche comme un message reçu, en texte.
  - `packages/ledge/src/daemon/crossSession.ts` : retirer `formatTeamNotice`, `formatRoleNotice`, `ledgeTeamNotice`, `formatLedgeTask` et `ledgeTask`.
  - `packages/ledge/src/daemon/documents.ts` : retirer l'exception des modèles d'équipe (`documents.ts:10-13`).
  - `packages/ledge/src/daemon/index.ts` : plus de `tasksJournal`/`teamsJournal` ; ajouter `logIgnoredTeamData(dir: string, log: (line: string) => void): void`, appelé au démarrage.
  - `packages/ledge/src/daemon/store.ts` : `patch` sans `role`, `roleLabel` ni `team`.
  - `packages/ledge/src/daemon/omp/host.ts` : plus de `appendSystemPrompt` ni de `seatEnv` de rôle.
  - `packages/ledge/src/spawn.ts` : plus de `role`/`team` ni de `LEDGE_ROLE`/`LEDGE_TEAM` ; `autonomy` reste.
  - `packages/ledge/src/paths.ts` : retirer `tasks` et `teams`.
  - `packages/ledge/src/cli/index.ts` : retirer `task` et `team` (cas et USAGE), et le `[--role <id>]` de la ligne des agents.
  - `packages/ledge/src/cli/launch.ts` : plus de `--role` ni de `roleArgs` (un `--role` restant passe à l'agent comme un argument quelconque).
  - `packages/ledge/src/cli/send.ts` : `parseLedgeCommand` sans `task`.
  - `packages/ledge/src/cli/hook.ts` : plus de `seatOf`, `tasksContext`, `held` ni de la liste `task.cmd`, plus de résolution `@rôle` dans `relayMessage` (un `@x` est résolu comme un nom) ; la phrase « ta consigne de rôle, ton équipe » de la notice devient « un changement te concerne ».
  - `packages/ledge/src/cli/{action,handover}.ts` : les commentaires qui citent `ledge task` ou les équipes.
  - `packages/fleet/src/fleet.ts`, `packages/fleet/src/machines.ts`, `packages/fleet/src/index.ts` : plus de `teams`, `tasks`, `askTasks`, `roleLists` ni `answerFailedRoles`, plus de routage `team.*`/`task.cmd`/`roles.list`, plus de `useTeams` ni de `useTasks`.
- Test :
  - Modify : `packages/ledge/test/{server,handover,hook,send,history,documents,action-run,daemon-actions,state,scan}.test.ts`, `packages/fleet/test/fleet.test.ts` ;
  - Create : `packages/ledge/test/ignored-team-data.test.ts`.

**Interfaces :**
- Consumes : rien de nouveau.
- Produces :
  - `logIgnoredTeamData(dir: string, log: (line: string) => void): void` ;
  - `createHandovers(d)` sans `tasks` ni `teams` ;
  - `launch(req: { tool: Tool; cwd: string; name?: string; prompt?: string; continue?: boolean; dirs?: string[]; model?: string; effort?: string; approval?: OmpApproval; autonomy?: Autonomy })`.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// packages/ledge/test/ignored-team-data.test.ts
it('logs one line per old team, role or task file present, and reads none', async () => {
  // dir with tasks.json, teams-live.json, teams/, roles/
  const lines: string[] = []; logIgnoredTeamData(dir, l => lines.push(l));
  expect(lines).toEqual([`ignored ${join(dir, 'tasks.json')}: Ledge teams, roles and tasks were removed (2026-10-30-ledge-openrig-orchestrator-design §7)`, /* teams-live.json, teams, roles in that order */]);
  expect(existsSync(join(dir, 'tasks.json'))).toBe(true);
});
it('logs nothing when none is present', ...);
// packages/ledge/test/server.test.ts
it('task.cmd, roles.list, definitions.list and team.launch answer { type: "error", code: "invalid", request: <type> }', ...);
it('the snapshot daemon info has no teams flag, and no teams message follows the snapshot', ...);
it('a resumed session that had role/roleLabel/team in sessions.json resumes without them and without a role autonomy', ...);
// packages/ledge/test/handover.test.ts
it('a relief launches without role or team, and the default brief lists no tasks', ...);
it('an auto session that is not in a team is relieved past the threshold', ...);
// packages/ledge/test/hook.test.ts
it('SessionStart identity has no seat or tasks block, and makes no task.cmd request', ...);
it('a Claude SendMessage to @build is resolved as a plain name (unknown → the real tool proceeds)', ...);
// packages/ledge/test/send.test.ts
it('parseLedgeCommand no longer reads ledge task', () => expect(parseLedgeCommand('ledge task list')).toBeUndefined());
// packages/fleet/test/fleet.test.ts
it('an older remote daemon sending teams or task.updated is ignored without error', ...);
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @paradow/ledge test -- ignored-team-data server handover hook send && pnpm --filter @ledge/fleet test`
Expected : FAIL.

- [ ] **Step 3 : implémenter** (supprimer les modules, puis suivre `pnpm typecheck` ; `logIgnoredTeamData` examine `tasks.json`, `teams-live.json`, `teams/` et `roles/` sous `paths().dir`, avec `existsSync`, et rien d'autre)

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm typecheck && pnpm --filter @paradow/ledge --filter @ledge/fleet test`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git commit -am "feat(ledge): remove teams, roles and tasks from the daemon and the CLI"
```

### Task 6b : le protocole sans équipes ni tâches

**Files :**
- Delete : `packages/protocol/src/{teams,tasks}.ts`, `packages/protocol/test/{teams,tasks}.test.ts`.
- Modify :
  - `packages/protocol/src/index.ts` ;
  - `packages/protocol/src/messages.ts` : retirer `TaskCmd`, `TaskResult`, `TaskUpdated`, `RolesList`/`RolesListing`, `Definitions*`, `Role*`, `Template*`, `Team*` et `scopeIssue` (le `superRefine` qui l'appliquait part avec) ; retirer `role` et `team` de `session.launch` (`messages.ts:199-200`), le champ `teams` de `DaemonInfoSchema` (`messages.ts:90`), et le `task` de `messages.ts:43` s'il ne sert qu'aux tâches Ledge (à vérifier : sinon on le garde) ;
  - `packages/protocol/src/session.ts` : retirer `role`, `roleLabel` et `team` de `SessionSchema` ; le commentaire d'`AutonomySchema` ne cite plus les rôles ;
  - `packages/protocol/src/thread.ts` : retirer `task`, `team`, `taskOp` et `outgoing` de la notice, et l'import de `TRANSMISSION_OPS` ;
  - `apps/desktop/src/state/obsolete.ts`, si une clé de stockage d'équipe y manque ;
  - tout reste signalé par `pnpm typecheck` (Desktop `NoticeLine`, mobile `agents`).
- Test : Modify `packages/protocol/test/messages.test.ts`, `packages/ledge/test/{store,history}.test.ts` (le store se teste dans `store.test.ts`).

**Interfaces :**
- Produces : `SessionSchema` sans `role`, `roleLabel` ni `team` ; `ClientMessageSchema` et `ServerMessageSchema` sans aucun membre d'équipe, de rôle ni de tâche Ledge ; `DaemonInfoSchema` sans `teams`, avec `asks` (tâche 1).

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// packages/protocol/test/messages.test.ts
it('no client or server message type is about teams, roles, templates, definitions or Ledge tasks', () => {
  const all = [...ClientMessageSchema.options, ...ServerMessageSchema.options].map(o => o.shape.type.value);
  expect(all.filter(t => /^(team|teams|role|roles|template|definition|definitions|task)\b/.test(t))).toEqual([]);
});
it('SessionSchema strips role, roleLabel and team from an old record', () => {
  const s = SessionSchema.parse({ ...SESSION, role: 'dev', roleLabel: 'Dev', team: 'team-ab12' });
  expect(s).not.toHaveProperty('role'); expect(s).not.toHaveProperty('team');
});
// packages/ledge/test/history.test.ts
it('an old history notice with task/team/taskOp loads, without them', ...);
// packages/ledge/test/store.test.ts
it('an old sessions.json with role/roleLabel/team loads', ...);
```

- [ ] **Step 2 : lancer, constater l'échec**

Run : `pnpm --filter @ledge/protocol test -- messages && pnpm --filter @paradow/ledge test -- history store`
Expected : FAIL (`team.launch` encore dans l'union, `role` gardé).

- [ ] **Step 3 : implémenter** (supprimer, puis suivre `pnpm typecheck` dans tout le dépôt)

- [ ] **Step 4 : lancer, constater le succès**

Run : `pnpm typecheck && pnpm test`
Expected : PASS sur tout le dépôt.

- [ ] **Step 5 : commit**

```bash
git commit -am "feat(protocol): remove teams, roles and Ledge tasks"
```

### Task 7 : docs, vérification de fin, contrôle avant fusion

**Files :**
- Modify :
  - `README.md` : sections `ledge task` et `ledge team` remplacées par `ledge ask` et `ledge decide` ;
  - en-tête, ligne 1 sous le titre, de `docs/superpowers/specs/{2026-10-25-roles-teams-operator-design,2026-10-25-session-tasks-design,2026-10-26-atelier-rooms-design,2026-10-26-ledge-home-design,2026-10-26-task-transmission-design,2026-10-26-teams-overview,2026-10-28-mobile-teams-design}.md` et de `docs/superpowers/plans/{2026-10-26-team-cli,2026-10-26-task-transmission,2026-10-28-mobile-teams}.md` : `> Remplacé par 2026-10-30-ledge-openrig-orchestrator-design (lot 1 : équipes, rôles et tâches retirés).` On ne modifie rien d'autre dans ces fichiers.

- [ ] **Step 1 : grep de fin**

Run : `grep -rnE "ledge task|ledge team|roleLabel|LEDGE_ROLE|LEDGE_TEAM|teamsLive|useTeamsApi|TeamCard|TaskCard" packages apps --include=*.ts --include=*.tsx --include=*.css --include=*.mjs`
Expected : aucune ligne.

- [ ] **Step 2 : tout le dépôt**

Run : `pnpm typecheck && pnpm test && pnpm --filter desktop e2e && pnpm --filter overlay e2e`
Expected : PASS.

- [ ] **Step 3 : essai réel, court**

1. Le port du daemon est fixe (`PROTOCOL_PORT`, 47831) : l'essai demande d'arrêter le daemon courant. On demande d'abord l'accord de l'utilisateur, car un redémarrage tue les sessions tmux de Ledge. Avec cet accord : `pnpm --filter @paradow/ledge build`, puis `LEDGE_HOME=<scratchpad>/ledge-home node packages/ledge/dist/cli/index.js daemon`. Sans accord, on saute ce step, on le note dans la PR, et les tests des tâches 1 et 6a font foi.
2. `ledge claude` dans un dossier jetable ; dans la session : `ledge ask "Quelle base ?" "A ou B (je recommande B)"`.
3. `ledge decide` liste l'ask, et `ledge decide <id> "B"` répond `réponse envoyée à <nom>`.
4. La session reçoit la `<ledge-answer>`.
5. Le journal du daemon contient les lignes `ignored …` si `LEDGE_HOME` contient d'anciens fichiers (en copier un dans le home jetable pour le vérifier).

- [ ] **Step 4 : contrôle avant fusion**

Run, avec le `ledge` installé et non celui de la branche : `ledge team list --json`
Expected : aucune équipe `active` ni `resting`. Sinon, on n'ouvre pas la PR à la fusion : on le dit à l'utilisateur, avec la liste.

- [ ] **Step 5 : commit**

```bash
git add README.md docs/superpowers/specs docs/superpowers/plans
git commit -m "docs: mark the team, role and task specs as replaced"
```
