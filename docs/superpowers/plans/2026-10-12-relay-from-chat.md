# Relayer une instruction depuis le chat Ledge — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'utilisateur demande au chat Ledge « dis à Otto de lancer les tests » ; le chat répond avec une carte de relais (session, instruction) que l'utilisateur confirme d'un clic. L'instruction est tapée dans la session comme une réponse de l'overlay, tout de suite si la session est libre, sinon dès qu'elle le redevient.

**Architecture:** Le harnais du chat (toujours en lecture seule) termine sa réponse par un bloc ```` ```ledge-relay ```` contenant `{"session", "text"}`. Le daemon retire le bloc, vérifie la session dans le store et attache au tour un `relay` (`chat.done`, `chat.history`). L'overlay affiche une `RelayCard` ; le clic envoie `session.relay { qid }`. Un nouveau module `daemon/relay.ts` envoie par le chemin de `session.reply` (extrait en `replyTo`) ou met le relais en file ; il écoute `store.onChange` pour vider la file, une instruction par retour à l'état libre. L'état de la file vit dans le tour (`relay.status`), donc un reset, un nouveau jour ou un redémarrage l'emportent avec l'historique.

**Tech Stack:** TypeScript, zod (`@ledge/protocol`, importé depuis les sources), Node 22 + ws (`packages/ledge`), React 19 + Tauri 2 (`apps/overlay`), vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-relay-from-chat-design.md` (maquette : `docs/mockups/ledge-relay-from-chat.html`). À lire avant chaque tâche avec ce plan.

Écarts assumés par rapport à la spec :
- `deps.lookup(id)` est `deps.store.get(id)` : le chat a déjà le store.
- Les erreurs du daemon sont en anglais comme toutes les autres : `unknown relay`, `already sent`, `already queued`, `nothing queued`, et `<Nom> stopped before it got the instruction` pour « Otto s'est arrêté ». L'overlay les affiche préfixées de « Échec de l'envoi : » / « Could not send: ».
- `markRelay(qid, patch, emit)` prend `emit` comme `markLaunched`. Le patch **remplace** les champs d'état (`status`, `sentAt`, `error`) : `{}` remet la carte à l'état proposé, `{ error }` retire `status`.
- Quand l'envoi échoue, `request` marque le tour en erreur **et** rejette : le demandeur reçoit aussi un `error` sans id, ce qui libère son bouton même si le message est identique au précédent (Réessayer qui échoue pareil).

## Global Constraints

- Le harnais du chat ne reçoit aucun outil nouveau : `claude -p --restricted --tools Read,Grep,Glob`, `codex exec --sandbox read-only`, `cursor-agent -p --mode ask` restent tels quels (spec §2).
- Le chat n'envoie rien : il propose, le clic de l'utilisateur envoie (spec §1).
- Cible : toutes les sessions suivies, sauf `hook_only` (lecture seule) ; une session inconnue, `hook_only` ou `exited` au moment de la réponse ne donne pas de carte, seulement une ligne dans `daemon.log` (spec §4, §7).
- Bloc : langue `ledge-relay`, JSON `{"session": "<id>", "text": "<instruction>"}`, les deux obligatoires, `text` non vide après `trim` (spec §3).
- Une carte par réponse : tous les blocs `ledge-session` et `ledge-relay` sont retirés du texte, seul le dernier, toutes langues confondues, compte (spec §3).
- Session libre = `state === 'idle'` et pas de `pending`. Sinon le relais part en file, et une seule instruction part par retour à l'état libre, la plus ancienne d'abord (spec §4).
- Les champs d'un relais viennent du tour, jamais du message (spec §4).
- Les nouveaux champs du protocole sont facultatifs : un overlay ou un daemon plus ancien les ignore (spec §5).
- Après Envoyer, Annuler ou Réessayer, on reste dans le chat (spec §6).
- Textes FR et EN dans `apps/overlay/src/i18n/messages.ts` ; les tests de l'overlay tournent en anglais.
- Style du code : celui des fichiers voisins (lignes longues, commentaires d'une phrase en anglais au-dessus des blocs non évidents).

## Review Focus

- Deux clics sur Envoyer (ou deux overlays) pendant que l'instruction est tapée : la session reste `idle` le temps de l'injection, une seule frappe doit partir (gardes `busy` / `sending` de `relay.ts`, Task 5).
- Deux relais en file pour Otto, Otto redevient libre : seul le plus ancien part ; un `store.onChange` reçu pendant sa frappe (Otto encore `idle`) ne doit pas envoyer le second (Task 5).
- Un relais en file, puis « Nouvelle conversation » ou minuit : au prochain retour d'Otto à l'état libre, rien ne doit partir (Task 4 et Task 5).
- Un relais en vol pendant que le formulaire `+` lance (ou l'inverse) : chaque `error` sans id ne doit libérer que celui qui l'a demandé, donc les deux ne doivent jamais être en vol ensemble (Task 8).
- Le bloc arrive en morceaux pendant le streaming (```` ```ledge-re ````, puis le JSON non fermé) : aucun fragment ne s'affiche (Task 2).

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/protocol/src/chat.ts` (modif) | `ChatRelaySchema`, `ChatTurn.relay?` |
| `packages/protocol/src/messages.ts` (modif) | `chat.done.relay?`, `session.relay`, `session.relay.cancel` |
| `packages/protocol/src/proposal.ts` (modif) | `extractProposal` (avec `kind`), `parseRelayBlock`, `hideProposal` pour les deux langues |
| `packages/ledge/src/chat/claude.ts` (modif) | `PERSONA` |
| `packages/ledge/src/chat/context.ts` (modif) | `- read-only: Ledge cannot send to it` dans `sessions.md` |
| `packages/ledge/src/chat/service.ts` (modif) | relais en fin de tour, `relay` / `markRelay` / `queuedRelays` |
| `packages/ledge/src/daemon/relay.ts` (nouveau) | `createRelay` : envoi, file, annulation, écoute du store |
| `packages/ledge/src/daemon/server.ts` (modif) | `replyTo`, `session.relay`, `session.relay.cancel` |
| `apps/overlay/src/daemon/store.ts` (modif) | `chat.done` garde le relais |
| `apps/overlay/src/surface/RelayCard.tsx` (nouveau) | la carte, quatre états |
| `apps/overlay/src/surface/ChatView.tsx` (modif) | rend la carte de relais à la place de `LaunchCard` |
| `apps/overlay/src/surface/Surface.tsx` (modif) | envoie `session.relay` / `session.relay.cancel` |
| `apps/overlay/src/i18n/messages.ts` (modif) | textes FR/EN, aide |
| `apps/overlay/e2e/relay-from-chat.spec.ts` (nouveau) | Playwright |
| `README.md` (modif) | §Asking Ledge, §Protocol |

---

### Task 1: Protocole — schémas

**Files:**
- Modify: `packages/protocol/src/chat.ts`
- Modify: `packages/protocol/src/messages.ts:46` (`chat.done`) et la liste des `ClientMessageSchema` (après `session.reply`, ligne 63)
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces: `ChatRelaySchema`, `type ChatRelay = { id: string; name: string; tool: Tool; text: string; status?: 'queued' | 'sent'; sentAt?: string; error?: string }` ; `ChatTurn.relay?: ChatRelay` ; `chat.done.relay?: ChatRelay` ; ClientMessages `{ type: 'session.relay'; qid: string }` et `{ type: 'session.relay.cancel'; qid: string }`.

- [ ] **Step 1: Write the failing test** — dans `packages/protocol/test/messages.test.ts`, ajouter :

```ts
describe('relay from the chat (spec 2026-10-12 relay §5)', () => {
  const relay = { id: 's1', name: 'Otto', tool: 'claude', text: 'Lance les tests' };
  it('a turn and chat.done carry a relay; old messages still parse', () => {
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z', relay })).toMatchObject({ relay });
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z' })).not.toHaveProperty('relay');
    const turn = { qid: 'q1', question: 'dis à Otto', askedAt: '2026-10-12T10:00:00.000Z', steps: [], relay: { ...relay, status: 'sent', sentAt: '2026-10-12T10:01:00.000Z' } };
    expect(parseServerMessage({ type: 'chat.history', turns: [turn] })).toEqual({ type: 'chat.history', turns: [turn] });
  });
  it('rejects an unknown status and an empty text', () => {
    expect(() => parseServerMessage({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', askedAt: '2026-10-12T10:00:00.000Z', steps: [], relay: { ...relay, status: 'lost' } }] })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:00.000Z', relay: { ...relay, text: '' } })).toThrow();
  });
  it('session.relay and session.relay.cancel name the turn', () => {
    expect(parseClientMessage({ type: 'session.relay', qid: 'q1' })).toEqual({ type: 'session.relay', qid: 'q1' });
    expect(parseClientMessage({ type: 'session.relay.cancel', qid: 'q1' })).toEqual({ type: 'session.relay.cancel', qid: 'q1' });
    expect(() => parseClientMessage({ type: 'session.relay', qid: '' })).toThrow();
  });
});
```

(Importer `parseClientMessage` / `parseServerMessage` comme le font déjà les autres tests du fichier.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ledge/protocol test`
Expected: FAIL (`relay` retiré par zod, `session.relay` invalide).

- [ ] **Step 3: Write minimal implementation**

Dans `packages/protocol/src/chat.ts`, après `ChatProposalSchema` :

```ts
/** An instruction the chat proposes to send to a tracked session (spec 2026-10-12 relay §5): the session as the store named it,
 *  `status` once the card sent it or queued it, `error` when the last attempt failed. */
export const ChatRelaySchema = z.object({
  id: z.string().min(1), name: z.string(), tool: ToolSchema, text: z.string().min(1),
  status: z.enum(['queued', 'sent']).optional(), sentAt: z.string().datetime().optional(), error: z.string().optional()
});
export type ChatRelay = z.infer<typeof ChatRelaySchema>;
```

et dans `ChatTurnSchema`, après `proposal: ChatProposalSchema.optional()` : `, relay: ChatRelaySchema.optional()`.

Dans `messages.ts`, importer `ChatRelaySchema` à côté de `ChatProposalSchema`, puis :

```ts
  z.object({ type: z.literal('chat.done'), qid: z.string(), text: z.string(), at: z.string().datetime(), proposal: ChatProposalSchema.optional(), relay: ChatRelaySchema.optional() }),
```

et, après `session.reply` dans `ClientMessageSchema` :

```ts
  /** The chat card's instruction (spec 2026-10-12 relay §4): sent now if the session is free, else queued until it is. */
  z.object({ type: z.literal('session.relay'), qid: z.string().min(1) }),
  /** Takes the card's queued instruction back out of the queue. */
  z.object({ type: z.literal('session.relay.cancel'), qid: z.string().min(1) }),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ledge/protocol test && pnpm typecheck`
Expected: PASS. Si `pnpm typecheck` signale un `switch` exhaustif sur `ClientMessage` dans `server.ts`, ajouter temporairement `case 'session.relay': case 'session.relay.cancel': return send(ws, { type: 'error', message: 'not implemented' });` (remplacé en Task 6).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol packages/ledge/src/daemon/server.ts
git commit -m "feat(protocol): a chat turn's relay, session.relay and session.relay.cancel"
```

---

### Task 2: Protocole — extraction et masquage des deux blocs

**Files:**
- Modify: `packages/protocol/src/proposal.ts`
- Test: `packages/protocol/test/proposal.test.ts`

**Interfaces:**
- Consumes: rien de neuf.
- Produces: `extractProposal(answer): { text: string; kind: 'session' | 'relay' | null; raw: string | null }` (le `kind` et le `raw` du **dernier** bloc, toutes langues) ; `RelayBlockSchema`, `type RelayBlock = { session: string; text: string }` ; `parseRelayBlock(raw): RelayBlock | null` (champs trimés) ; `hideProposal(text)` masque aussi ```` ```ledge-relay ````.

- [ ] **Step 1: Write the failing test** — ajouter à `packages/protocol/test/proposal.test.ts` :

```ts
describe('relay blocks (spec 2026-10-12 relay §3)', () => {
  const relay = (json: string) => 'Je transmets à **Otto**.\n\n```ledge-relay\n' + json + '\n```';
  it('extracts a relay block and says which kind it is', () => {
    expect(extractProposal(relay('{"session": "s1", "text": "Lance les tests"}'))).toEqual({ text: 'Je transmets à **Otto**.', kind: 'relay', raw: '{"session": "s1", "text": "Lance les tests"}' });
    expect(extractProposal('Rien à faire.')).toEqual({ text: 'Rien à faire.', kind: null, raw: null });
    expect(extractProposal('A\n```ledge-session\n{"cwd": "/w"}\n```').kind).toBe('session');
  });
  it('mixed blocks: all leave the text, the last one counts whatever its language', () => {
    const answer = 'Voilà.\n```ledge-relay\n{"session": "s1", "text": "a"}\n```\n```ledge-session\n{"cwd": "/w"}\n```';
    expect(extractProposal(answer)).toEqual({ text: 'Voilà.', kind: 'session', raw: '{"cwd": "/w"}' });
    const other = 'Voilà.\n```ledge-session\n{"cwd": "/w"}\n```\n```ledge-relay\n{"session": "s1", "text": "b"}\n```';
    expect(extractProposal(other)).toMatchObject({ kind: 'relay', raw: '{"session": "s1", "text": "b"}' });
  });
  it('parseRelayBlock needs both fields and a text that is not blank', () => {
    expect(parseRelayBlock('{"session": " s1 ", "text": "  Lance les tests  "}')).toEqual({ session: 's1', text: 'Lance les tests' });
    expect(parseRelayBlock('{"session": "s1"}')).toBeNull();
    expect(parseRelayBlock('{"text": "x"}')).toBeNull();
    expect(parseRelayBlock('{"session": "s1", "text": "   "}')).toBeNull();
    expect(parseRelayBlock('not json')).toBeNull();
  });
  it('hideProposal holds back a relay block, closed or not, and a relay fence being typed', () => {
    expect(hideProposal('Je transmets.\n```ledge-relay\n{"session": "s1", "te')).toBe('Je transmets.');
    expect(hideProposal('Je transmets.\n```ledge-re')).toBe('Je transmets.');
    expect(hideProposal('Je transmets.\n```ledge-')).toBe('Je transmets.');
    expect(hideProposal(relay('{"session": "s1", "text": "x"}'))).toBe('Je transmets à **Otto**.');
    expect(hideProposal('Deux ')).toBe('Deux ');
  });
});
```

(Ajouter `parseRelayBlock` à l'import en tête du fichier.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ledge/protocol test`
Expected: FAIL (`parseRelayBlock` n'existe pas, `kind` absent).

- [ ] **Step 3: Write minimal implementation** — remplacer le haut de `proposal.ts` (constantes et `extractProposal`) et ajouter `parseRelayBlock` ; `hideProposal` change sa dernière comparaison :

```ts
/** What the chat harness writes in its ```ledge-relay block (spec 2026-10-12 relay §3); the daemon checks the session. */
export const RelayBlockSchema = z.object({ session: z.string().trim().min(1), text: z.string().trim().min(1) });
export type RelayBlock = z.infer<typeof RelayBlockSchema>;

const FENCES = ['```ledge-session', '```ledge-relay'];
/** A block from its fence to the closing fence, or to the end of the text when it is not closed (yet). */
const BLOCK = /```ledge-(session|relay)[ \t]*\n?([\s\S]*?)(?:```|$)/g;

/** The answer without its card blocks, and the language and content of the last one (null when there is none). */
export function extractProposal(answer: string): { text: string; kind: 'session' | 'relay' | null; raw: string | null } {
  const found: Array<{ kind: 'session' | 'relay'; raw: string }> = [];
  const text = answer.replace(BLOCK, (_m, kind: 'session' | 'relay', body: string) => { found.push({ kind, raw: body.trim() }); return ''; });
  const last = found.at(-1);
  return last ? { text: text.replace(/\n{3,}/g, '\n\n').trim(), kind: last.kind, raw: last.raw } : { text: answer, kind: null, raw: null };
}

/** The block's JSON as a relay, or null when it lacks a session or a non-blank text. */
export function parseRelayBlock(raw: string): RelayBlock | null {
  try { const r = RelayBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}
```

Dans `hideProposal`, remplacer `tail && FENCE.startsWith(tail)` par `tail && FENCES.some(f => f.startsWith(tail))`, et mettre à jour son commentaire (`` ```ledge-se `` / `` ```ledge-re ``). Supprimer la constante `FENCE`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @ledge/protocol test && pnpm --filter ledge exec vitest run test/chat-service.test.ts && pnpm typecheck`
Expected: PASS (le service ignore encore `kind` ; ses tests de proposition passent toujours).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): extract and hide ledge-relay blocks; the last card block wins"
```

---

### Task 3: Daemon — persona et sessions en lecture seule

**Files:**
- Modify: `packages/ledge/src/chat/claude.ts:5` et `:8` (`PERSONA`)
- Modify: `packages/ledge/src/chat/context.ts:23-24`
- Test: `packages/ledge/test/chat-claude.test.ts`, `packages/ledge/test/chat-context.test.ts`

**Interfaces:**
- Produces: `PERSONA` qui autorise le bloc ```` ```ledge-relay ```` ; `sessions.md` avec `- read-only: Ledge cannot send to it` sous chaque session `hook_only`.

- [ ] **Step 1: Write the failing tests**

Dans `chat-claude.test.ts`, après le test « the persona allows a proposal block only… » :

```ts
  it('the persona allows a relay block for one sure, writable session, and never sends anything itself', () => {
    expect(PERSONA).toContain('```ledge-relay');
    expect(PERSONA).toContain('{"session": "<id>", "text": "<l\'instruction, formulée pour l\'agent>"}');
    expect(PERSONA).toContain('tu n\'envoies jamais rien toi-même à une session');
    expect(PERSONA).toContain('pas en lecture seule');
    expect(PERSONA).not.toContain('jamais d\'instruction envoyée à une session');
  });
```

Dans `chat-context.test.ts`, dans le test « writes sessions.md and one file per source… » (Nova y est `hook_only`), ajouter :

```ts
    // Only the hook-only session is marked: Ledge cannot type into it (spec 2026-10-12 relay §4).
    const nova = md.slice(md.indexOf('## Nova'));
    expect(nova).toContain('- read-only: Ledge cannot send to it');
    expect(md.slice(0, md.indexOf('## Nova'))).not.toContain('read-only');
```

(Si Nova n'est pas la dernière session du test, borner `nova` à la section suivante avec `nova.slice(0, nova.indexOf('\n## ', 1))`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ledge exec vitest run test/chat-context.test.ts test/chat-claude.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`claude.ts`, ligne 5 : remplacer `pas d'écriture, jamais d'instruction envoyée à une session.` par `pas d'écriture, et tu n'envoies jamais rien toi-même à une session.`

Ligne 8 : après la phrase qui se termine par `cite les candidats et demande lequel.`, ajouter (dans le même littéral, les backticks échappés comme pour `ledge-session`) :

```
 Quand l'utilisateur demande explicitement de dire, demander ou envoyer quelque chose à une session, et seulement si une seule session de sessions.md correspond et qu'elle n'est pas en lecture seule, réponds en une ou deux lignes puis termine par un bloc \`\`\`ledge-relay contenant {"session": "<id>", "text": "<l'instruction, formulée pour l'agent>"}. Si plusieurs sessions conviennent ou aucune, ne mets pas de bloc : cite les candidats et demande laquelle.
```

`context.ts`, juste après le `lines.push(...)` des lignes 23-24 :

```ts
    if (s.source === 'hook_only') lines.push('- read-only: Ledge cannot send to it');
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter ledge exec vitest run test/chat-context.test.ts test/chat-claude.test.ts test/chat-codex.test.ts test/chat-cursor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/chat/claude.ts packages/ledge/src/chat/context.ts packages/ledge/test/chat-claude.test.ts packages/ledge/test/chat-context.test.ts
git commit -m "feat(chat): the persona may propose a relay; sessions.md marks read-only sessions"
```

---

### Task 4: Daemon — le relais du tour et ses méthodes

**Files:**
- Modify: `packages/ledge/src/chat/service.ts` (interface `Chat` lignes 17-23, `run()` lignes 123-129, objet renvoyé lignes 132-146)
- Modify: `packages/ledge/test/server.test.ts:539-548` (`stubChat` doit implémenter les nouvelles méthodes)
- Test: `packages/ledge/test/chat-service.test.ts`

**Interfaces:**
- Consumes: `extractProposal` (avec `kind`), `parseRelayBlock`, `ChatRelay` (Tasks 1-2).
- Produces, sur `Chat` :
  - `relay(qid: string): ChatRelay | undefined` — le relais du tour, s'il est dans l'historique du jour ;
  - `markRelay(qid: string, patch: Pick<ChatRelay, 'status' | 'sentAt' | 'error'>, emit: (m: ChatMessage) => void): void` — remplace les champs d'état par `patch`, puis émet `chat.history` ;
  - `queuedRelays(): Array<{ qid: string; relay: ChatRelay }>` — les relais `queued` du jour, du plus ancien au plus récent.

- [ ] **Step 1: Write the failing tests** — dans `chat-service.test.ts`, après les tests de proposition (ligne ~215) :

```ts
  describe('relay (spec 2026-10-12 relay §4)', () => {
    const relayFence = (json: string) => 'Je transmets à Otto.\n\n```ledge-relay\n' + json + '\n```';
    const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'codex', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge',
      tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: '2026-10-11T08:00:00.000Z', lastActivityAt: '2026-10-11T08:00:00.000Z', source: 'launcher', ...extra });
    const askWith = async (block: string, sessions: Session[], extra: Partial<Parameters<typeof createChat>[0]> = {}) => {
      const s = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: relayFence(block) }), ...extra });
      for (const x of sessions) s.store.upsert(x);
      const out: ServerMessage[] = [];
      await s.chat.ask('q1', 'dis à Otto de lancer les tests', m => out.push(m));
      return { ...s, out };
    };

    it('a block naming a tracked session becomes the turn relay, joined to chat.done, with the session\'s own name and tool', async () => {
      const { chat, out } = await askWith('{"session": "s1", "text": " Lance les tests "}', [session('s1')]);
      const relay = { id: 's1', name: 'Otto', tool: 'codex', text: 'Lance les tests' };
      expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je transmets à Otto.', at: expect.any(String), relay });
      expect(chat.history()[0]).toMatchObject({ answer: 'Je transmets à Otto.', relay });
      expect(chat.relay('q1')).toEqual(relay);
      expect(chat.history()[0]).not.toHaveProperty('proposal');
    });

    it.each([
      ['unknown', '{"session": "nope", "text": "x"}', [session('s1')]],
      ['read-only', '{"session": "s1", "text": "x"}', [session('s1', { source: 'hook_only', tmuxSession: null })]],
      ['exited', '{"session": "s1", "text": "x"}', [session('s1', { state: 'exited' })]],
      ['invalid', '{"session": "s1", "text": "   "}', [session('s1')]]
    ])('an %s session gives no card, the text stays', async (_why, block, sessions) => {
      const { chat, out } = await askWith(block, sessions);
      expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je transmets à Otto.', at: expect.any(String) });
      expect(chat.relay('q1')).toBeUndefined();
    });

    it('markRelay replaces the state fields and tells every client; queuedRelays lists the queued ones, oldest first', async () => {
      const { chat } = await askWith('{"session": "s1", "text": "a"}', [session('s1')]);
      await chat.ask('q2', 'et dis-lui aussi b', () => {});
      const emitted: ServerMessage[] = [];
      chat.markRelay('q2', { status: 'queued' }, m => emitted.push(m));
      chat.markRelay('q1', { status: 'queued' }, m => emitted.push(m));
      expect(emitted.map(m => m.type)).toEqual(['chat.history', 'chat.history']);
      expect(chat.queuedRelays().map(r => r.qid)).toEqual(['q1', 'q2']);
      chat.markRelay('q1', { error: 'Otto stopped before it got the instruction' }, () => {});
      expect(chat.relay('q1')).toEqual({ id: 's1', name: 'Otto', tool: 'codex', text: 'a', error: 'Otto stopped before it got the instruction' });
      chat.markRelay('q1', { status: 'sent', sentAt: '2026-10-11T09:00:00.000Z' }, () => {});
      expect(chat.relay('q1')).toEqual({ id: 's1', name: 'Otto', tool: 'codex', text: 'a', status: 'sent', sentAt: '2026-10-11T09:00:00.000Z' });
      chat.markRelay('q2', {}, () => {});
      expect(chat.queuedRelays()).toEqual([]);
    });

    it('a reset or a new day takes the queue away', async () => {
      let day = '2026-10-11';
      const { chat } = await askWith('{"session": "s1", "text": "a"}', [session('s1')], { today: () => day });
      chat.markRelay('q1', { status: 'queued' }, () => {});
      day = '2026-10-12';
      expect(chat.queuedRelays()).toEqual([]);
      expect(chat.relay('q1')).toBeUndefined();
    });
  });
```

Le second `ask('q2', …)` reprend la même `FAKE_ANSWER` (même session `s1`), donc `q2` porte aussi un relais. Importer `type Session` depuis `@ledge/protocol`. Si le test « reset » doit aussi couvrir `chat.reset`, ajouter `await chat.reset(() => {}); expect(chat.queuedRelays()).toEqual([]);` sur un second `askWith`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ledge exec vitest run test/chat-service.test.ts`
Expected: FAIL (`chat.relay` n'est pas une fonction).

- [ ] **Step 3: Write minimal implementation** — dans `service.ts` :

Importer `parseRelayBlock` et `type ChatRelay` depuis `@ledge/protocol`. Dans l'interface `Chat`, après `markFailed` :

```ts
  /** The turn's relay (spec 2026-10-12 relay §4), if the turn is still in the day's history. */
  relay(qid: string): ChatRelay | undefined;
  /** The card's state: queued, sent, failed, or `{}` back to proposed; every client gets the new history. */
  markRelay(qid: string, patch: Pick<ChatRelay, 'status' | 'sentAt' | 'error'>, emit: (m: ChatMessage) => void): void;
  /** Today's queued relays, oldest turn first. */
  queuedRelays(): Array<{ qid: string; relay: ChatRelay }>;
```

Après `proposalFrom` :

```ts
  /** A relay block as a card: its session must be tracked, writable and still running now; otherwise no card and a log line. */
  function relayFrom(raw: string, qid: string): ChatRelay | undefined {
    const block = parseRelayBlock(raw);
    if (!block) { log(`chat ${qid}: relay ignored, invalid block: ${raw.slice(0, 200)}`); return undefined; }
    const s = deps.store.get(block.session);
    const why = !s ? 'unknown session' : s.source === 'hook_only' ? 'read-only session' : s.state === 'exited' ? 'session has exited' : null;
    if (why) { log(`chat ${qid}: relay ignored: ${why} ${block.session}`); return undefined; }
    return { id: s!.id, name: s!.name, tool: s!.tool, text: block.text };
  }
```

Dans `run()`, remplacer les lignes 124-128 :

```ts
    const { text, kind, raw } = extractProposal(answer);
    const proposal = kind === 'session' ? await proposalFrom(raw!, tool, turn.qid) : undefined;
    const relay = kind === 'relay' ? relayFrom(raw!, turn.qid) : undefined;
    turn.answer = text; turn.answeredAt = now();
    if (proposal) turn.proposal = proposal;
    if (relay) turn.relay = relay;
    emit({ type: 'chat.done', qid: turn.qid, text, at: turn.answeredAt, ...(proposal ? { proposal } : {}), ...(relay ? { relay } : {}) });
```

Dans l'objet renvoyé, après `markFailed` :

```ts
    relay: qid => { rollDay(); return turnOf(qid)?.relay; },
    markRelay(qid, patch, emit) {
      const t = turnOf(qid); if (!t?.relay) return;
      const { id, name, tool, text } = t.relay; t.relay = { id, name, tool, text, ...patch };
      emit({ type: 'chat.history', turns });
    },
    queuedRelays() { rollDay(); return turns.flatMap(t => (t.relay?.status === 'queued' ? [{ qid: t.qid, relay: t.relay }] : [])); },
```

(`rollDay` vide `turns` au changement de jour : un relais d'hier ne part jamais. `turns` est déjà dans l'ordre des questions.)

Dans `server.test.ts`, `stubChat` gagne : `relay: () => undefined, markRelay() {}, queuedRelays: () => [],`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter ledge test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/chat/service.ts packages/ledge/test/chat-service.test.ts packages/ledge/test/server.test.ts
git commit -m "feat(chat): a relay block becomes the turn's relay; markRelay and queuedRelays"
```

---

### Task 5: Daemon — `relay.ts`, envoi, file et écoute du store

**Files:**
- Create: `packages/ledge/src/daemon/relay.ts`
- Test: `packages/ledge/test/relay.test.ts`

**Interfaces:**
- Consumes: `Chat['relay' | 'markRelay' | 'queuedRelays']`, `ChatMessage` (Task 4), `Store['get' | 'onChange']`.
- Produces:

```ts
export interface Relay { request(qid: string): Promise<void>; cancel(qid: string): void; close(): void }
export interface RelayDeps {
  chat: Pick<Chat, 'relay' | 'markRelay' | 'queuedRelays'>; store: Pick<Store, 'get' | 'onChange'>;
  /** session.reply's path: null once typed and taken, the refusal otherwise; rejects when the injection fails. */
  replyTo: (id: string, text: string) => Promise<string | null>;
  broadcast: (m: ChatMessage) => void; now?: () => string;
}
export function createRelay(d: RelayDeps): Relay;
```

`request` rejette avec `unknown relay`, `already sent`, `already queued`, `<Nom> stopped before it got the instruction` ou le message de `replyTo` ; `cancel` lève `nothing queued`.

- [ ] **Step 1: Write the failing tests** — créer `packages/ledge/test/relay.test.ts`. Le test utilise un vrai `Store` et un faux chat en mémoire, pour exercer `onChange` tel quel :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatRelay, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createRelay, type RelayDeps } from '../src/daemon/relay.js';

const T0 = '2026-10-12T08:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

/** A chat holding relays by qid, in question order, as the service does. */
function fakeChat(relays: Record<string, ChatRelay>) {
  const map = new Map(Object.entries(relays)); let histories = 0;
  const chat: RelayDeps['chat'] = {
    relay: qid => map.get(qid),
    markRelay(qid, patch) { const r = map.get(qid); if (!r) return; const { id, name, tool, text } = r; map.set(qid, { id, name, tool, text, ...patch }); },
    queuedRelays: () => [...map].filter(([, r]) => r.status === 'queued').map(([qid, relay]) => ({ qid, relay }))
  };
  return { chat, map, histories: () => histories, broadcast: () => { histories++; } };
}

let store: Store; let typed: Array<[string, string]>;
let answer: (id: string, text: string) => Promise<string | null>;
const replyTo = (id: string, text: string) => { typed.push([id, text]); return answer(id, text); };
const flush = () => new Promise(r => setTimeout(r, 0));
const otto = (text: string): ChatRelay => ({ id: 's1', name: 'Otto', tool: 'claude', text });

beforeEach(() => {
  store = new Store({ journalPath: join(mkdtempSync(join(tmpdir(), 'relay-')), 'j.json') });
  typed = []; answer = async () => null;
});

describe('createRelay (spec 2026-10-12 relay §4)', () => {
  it('a free session gets the instruction now, and the card is sent', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    const c = fakeChat({ q1: otto('Lance les tests') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast, now: () => '2026-10-12T09:00:00.000Z' });
    await relay.request('q1');
    expect(typed).toEqual([['s1', 'Lance les tests']]);
    expect(c.map.get('q1')).toMatchObject({ status: 'sent', sentAt: '2026-10-12T09:00:00.000Z' });
    relay.close();
  });

  it('two clicks while it is being typed (the session still idle) type it once', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    let release!: () => void; answer = () => new Promise(r => { release = () => r(null); });
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    const first = relay.request('q1');
    await expect(relay.request('q1')).rejects.toThrow('already sent');
    release(); await first;
    await expect(relay.request('q1')).rejects.toThrow('already sent');
    expect(typed).toHaveLength(1);
    relay.close();
  });

  it('a busy session queues it; it goes when the session is free again', async () => {
    store.upsert(mk('s1', { state: 'waiting_permission', pending: { kind: 'permission', text: 'Bash', source: 'hook' } }));
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1');
    expect(c.map.get('q1')!.status).toBe('queued');
    await expect(relay.request('q1')).rejects.toThrow('already queued');
    store.upsert(mk('s1', { state: 'working' })); await flush();
    expect(typed).toEqual([]);
    store.upsert(mk('s1', { state: 'idle' })); await flush();
    expect(typed).toEqual([['s1', 'a']]);
    expect(c.map.get('q1')!.status).toBe('sent');
    relay.close();
  });

  it('two queued for the same session go one per free turn, oldest first, even if the store changes while the first is typed', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('first'), q2: otto('second') });
    let release!: () => void; answer = () => new Promise(r => { release = () => r(null); });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1'); await relay.request('q2');
    store.upsert(mk('s1', { state: 'idle' })); await flush();
    store.upsert(mk('s1', { state: 'idle', lastActivityAt: '2026-10-12T08:01:00.000Z' })); await flush();
    expect(typed).toEqual([['s1', 'first']]);
    release(); await flush();
    expect(c.map.get('q2')!.status).toBe('queued');
    answer = async () => null;
    store.upsert(mk('s1', { state: 'working' })); store.upsert(mk('s1', { state: 'idle' })); await flush();
    expect(typed).toEqual([['s1', 'first'], ['s1', 'second']]);
    relay.close();
  });

  it('cancel puts a queued one back to proposed; nothing to cancel otherwise', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    expect(() => relay.cancel('q1')).toThrow('nothing queued');
    await relay.request('q1'); relay.cancel('q1');
    expect(c.map.get('q1')).toEqual(otto('a'));
    store.upsert(mk('s1', { state: 'idle' })); await flush();
    expect(typed).toEqual([]);
    relay.close();
  });

  it.each(['exited', 'removed'] as const)('a session %s while waiting fails its queued cards', async how => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1');
    if (how === 'exited') store.upsert(mk('s1', { state: 'exited' })); else store.remove('s1');
    await flush();
    expect(c.map.get('q1')).toEqual({ ...otto('a'), error: 'Otto stopped before it got the instruction' });
    await expect(relay.request('q1')).rejects.toThrow('Otto stopped before it got the instruction');
    expect(typed).toEqual([]);
    relay.close();
  });

  it('a failed injection fails the card and the request; Retry may send it again', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    answer = async () => { throw new Error('the agent did not take the answer'); };
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await expect(relay.request('q1')).rejects.toThrow('the agent did not take the answer');
    expect(c.map.get('q1')).toEqual({ ...otto('a'), error: 'the agent did not take the answer' });
    answer = async () => null;
    await relay.request('q1');
    expect(c.map.get('q1')!.status).toBe('sent');
    expect(c.map.get('q1')).not.toHaveProperty('error');
    relay.close();
  });

  it('an unknown qid, and a card the chat no longer has (reset, new day), are refused', async () => {
    const c = fakeChat({});
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await expect(relay.request('q9')).rejects.toThrow('unknown relay');
    relay.close();
  });
});
```

Le faux chat ne compte pas les émissions : `markRelay` du vrai service émet lui-même (Task 4). Le `broadcast` passé à `createRelay` est celui que `markRelay` reçoit en `emit`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ledge exec vitest run test/relay.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Write the implementation** — créer `packages/ledge/src/daemon/relay.ts` :

```ts
import type { ChatRelay, Session } from '@ledge/protocol';
import type { Chat, ChatMessage } from '../chat/service.js';
import type { Store } from './store.js';
import { log } from '../log.js';

export interface Relay { request(qid: string): Promise<void>; cancel(qid: string): void; close(): void }
export interface RelayDeps {
  chat: Pick<Chat, 'relay' | 'markRelay' | 'queuedRelays'>; store: Pick<Store, 'get' | 'onChange'>;
  /** session.reply's path: null once typed and taken, the refusal otherwise; rejects when the injection fails. */
  replyTo: (id: string, text: string) => Promise<string | null>;
  broadcast: (m: ChatMessage) => void; now?: () => string;
}

/** Free to take a typed instruction: its turn, nothing pending. */
const free = (s: Session | undefined): s is Session => !!s && s.state === 'idle' && !s.pending;
const stopped = (name: string) => `${name} stopped before it got the instruction`;

/**
 * The chat cards' instructions (spec 2026-10-12 relay §4): typed now into a free session, else queued in the turn and typed at the
 * session's next free moment, one per free moment, oldest first. The queue is the turns' `relay.status`: a reset or a new day empties it.
 */
export function createRelay(d: RelayDeps): Relay {
  const now = d.now ?? (() => new Date().toISOString());
  // A session stays idle while its instruction is being typed: these keep a second one, or the same one twice, from following it.
  const typing = new Set<string>(); const sending = new Set<string>();

  async function deliver(qid: string, r: ChatRelay): Promise<string | null> {
    typing.add(r.id); sending.add(qid);
    try {
      let refused: string | null;
      try { refused = await d.replyTo(r.id, r.text); } catch (e) { refused = (e as Error).message; }
      if (refused) { log(`relay ${qid} to ${r.id} failed: ${refused}`); d.chat.markRelay(qid, { error: refused }, d.broadcast); }
      else d.chat.markRelay(qid, { status: 'sent', sentAt: now() }, d.broadcast);
      return refused;
    } finally { typing.delete(r.id); sending.delete(qid); }
  }

  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'recents') return;
    const id = c.type === 'updated' ? c.session.id : c.id;
    const queued = d.chat.queuedRelays().filter(q => q.relay.id === id);
    if (queued.length === 0) return;
    const s = c.type === 'updated' ? c.session : undefined;
    if (!s || s.state === 'exited') { for (const q of queued) d.chat.markRelay(q.qid, { error: stopped(q.relay.name) }, d.broadcast); return; }
    if (free(s) && !typing.has(id)) void deliver(queued[0]!.qid, queued[0]!.relay);
  });

  return {
    async request(qid) {
      const r = d.chat.relay(qid);
      if (!r) throw new Error('unknown relay');
      if (r.status === 'sent' || sending.has(qid)) throw new Error('already sent');
      if (r.status === 'queued') throw new Error('already queued');
      const s = d.store.get(r.id);
      if (!s || s.state === 'exited') { const m = stopped(r.name); d.chat.markRelay(qid, { error: m }, d.broadcast); throw new Error(m); }
      if (free(s) && !typing.has(r.id)) { const refused = await deliver(qid, r); if (refused) throw new Error(refused); return; }
      d.chat.markRelay(qid, { status: 'queued' }, d.broadcast);
    },
    cancel(qid) {
      if (d.chat.relay(qid)?.status !== 'queued') throw new Error('nothing queued');
      d.chat.markRelay(qid, {}, d.broadcast);
    },
    close: unsubscribe
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter ledge exec vitest run test/relay.test.ts && pnpm typecheck`
Expected: PASS. Si le test « one per free turn » échoue parce que `Store.upsert` n'émet pas pour un objet identique, garder le `lastActivityAt` différent comme écrit.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/daemon/relay.ts packages/ledge/test/relay.test.ts
git commit -m "feat(daemon): relay a chat card's instruction now or at the session's next free moment"
```

---

### Task 6: Daemon — `replyTo` et câblage du serveur

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts` (cas `session.reply` lignes 274-285 ; création de `chat` ligne 74 ; `close()`)
- Test: `packages/ledge/test/server.test.ts`

**Interfaces:**
- Consumes: `createRelay` (Task 5), `Chat.relay/markRelay/queuedRelays` (Task 4).
- Produces: `replyTo(id, text): Promise<string | null>` interne à `startServer` ; cas `session.relay` / `session.relay.cancel`.

- [ ] **Step 1: Write the failing tests** — dans `server.test.ts`, nouveau `describe('relay from a chat card')` après `describe('launch from a chat card')`, avec son propre faux chat (le `stubChat` du lancement ne porte pas de relais) :

```ts
  describe('relay from a chat card', () => {
    function relayChat(relay: ChatRelay) {
      let r: ChatRelay | undefined = relay;
      const chat: Chat = {
        async ask() {}, cancel() {}, async reset() {}, history: () => [], proposal: () => undefined, markLaunched() {}, markFailed() {},
        relay: qid => (qid === 'q1' ? r : undefined),
        markRelay(_qid, patch, emit) { const { id, name, tool, text } = r!; r = { id, name, tool, text, ...patch }; emit({ type: 'chat.history', turns: [] }); },
        queuedRelays: () => (r?.status === 'queued' ? [{ qid: 'q1', relay: r }] : [])
      };
      return { chat, current: () => r };
    }

    it('types the turn\'s own text into a free session and tells every client', async () => {
      tmux = fakeTmux({ 'ledge-a': ['> '] });
      const { chat, current } = relayChat({ id: 'a', name: 'Otto', tool: 'claude', text: 'Lance les tests' });
      const srv2 = await startServer({ store, tmux, port: 0, chat });
      store.upsert(mk('a', { state: 'idle' }));
      const c = await connect({ port: srv2.port }); await c.next('snapshot'); await c.next('chat.history');
      const other = await connect({ port: srv2.port }); await other.next('snapshot'); await other.next('chat.history');
      c.send({ type: 'session.relay', qid: 'q1' });
      await other.next('chat.history', 3000);
      expect(tmux.sent).toEqual([['text', 'ledge-a', 'Lance les tests'], ['keys', 'ledge-a', 'Enter']]);
      expect(current()).toMatchObject({ status: 'sent' });
      c.close(); other.close(); await srv2.close();
    });

    it('queues for a busy session, then cancel; refusals reach the requester as errors', async () => {
      const { chat, current } = relayChat({ id: 'a', name: 'Otto', tool: 'claude', text: 'x' });
      const srv2 = await startServer({ store, tmux, port: 0, chat });
      store.upsert(mk('a', { state: 'working' }));
      const c = await connect({ port: srv2.port }); await c.next('snapshot'); await c.next('chat.history');
      c.send({ type: 'session.relay', qid: 'q1' }); await c.next('chat.history');
      expect(current()!.status).toBe('queued');
      c.send({ type: 'session.relay', qid: 'q1' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'already queued' });
      c.send({ type: 'session.relay.cancel', qid: 'q1' }); await c.next('chat.history');
      expect(current()).not.toHaveProperty('status');
      c.send({ type: 'session.relay.cancel', qid: 'q1' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'nothing queued' });
      c.send({ type: 'session.relay', qid: 'q9' });
      expect(await c.next('error')).toEqual({ type: 'error', message: 'unknown relay' });
      expect(tmux.sent).toEqual([]);
      c.close(); await srv2.close();
    });
  });
```

Importer `type ChatRelay` à côté de `ChatProposal`. Les tests existants `session.reply` (« a reply with no pending… », « refuses a reply to a %s prompt… », etc.) restent tels quels : ils vérifient que l'extraction de `replyTo` ne change rien.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ledge exec vitest run test/server.test.ts -t "relay from a chat card"`
Expected: FAIL (`not implemented`, ou message invalide).

- [ ] **Step 3: Write the implementation**

Dans `server.ts`, importer `createRelay` depuis `./relay.js`. Juste après `injectAndVerify`, ajouter `replyTo` (le corps actuel de `session.reply`, les refus renvoyés au lieu d'être envoyés) :

```ts
  /** session.reply's checks and typing (shared with the chat's relay): null once typed, the refusal otherwise; rejects when the injection fails. */
  async function replyTo(id: string, text: string): Promise<string | null> {
    const s = store.get(id); if (!s) return 'unknown session';
    if (s.source === 'hook_only') return READ_ONLY;
    // A select dialog ignores typed text and Enter would pick option 1: those take decide only.
    if (s.pending && s.pending.kind !== 'question') return `a ${s.pending.kind} prompt takes accept or deny, not a reply`;
    if (text.trim() === '') return 'empty reply';
    // The 2.x question dialog is a select: typed text then Enter would silently pick the highlighted option.
    if (s.pending?.kind === 'question' && !/^[1-9]$/.test(text.trim())) return FREE_TEXT;
    // With no pending (idle, your turn) the text goes to the input line: no prompt to check for.
    const pending = s.pending; const adapter = adapterFor(s.tool);
    await injectAndVerify(id, pane => adapter.replyPlan(text, pending, pane || undefined), !!pending);
    return null;
  }
```

Le cas `session.reply` devient :

```ts
      case 'session.reply': {
        const refused = await replyTo(msg.id, msg.text);
        if (refused) send(ws, { type: 'error', id: msg.id, message: refused });
        return;
      }
```

(Un échec d'injection rejette toujours : le `catch` de `handle` logue `session.reply failed: …` et répond `error` avec l'id, comme avant.)

Après `const chat = …` (ligne 74) et la définition de `broadcast` (ligne 87), créer le relais une fois `broadcast` disponible :

```ts
  const relay = createRelay({ chat, store, replyTo, broadcast, now });
```

Dans `handle`, à la place des cas provisoires de la Task 1 (ou à côté de `chat.ask`) :

```ts
      // A chat card's instruction (spec 2026-10-12 relay §4): a refusal reaches the requester as an `error`, the card's state everyone through chat.history.
      case 'session.relay': return relay.request(msg.qid);
      case 'session.relay.cancel': return relay.cancel(msg.qid);
```

Dans `close()`, à côté de `unsubscribe()`, appeler `relay.close()`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter ledge test && pnpm typecheck`
Expected: PASS, y compris tous les tests `session.reply` existants.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/daemon/server.ts packages/ledge/test/server.test.ts
git commit -m "feat(daemon): session.relay and session.relay.cancel; session.reply's body becomes replyTo"
```

---

### Task 7: Overlay — store et `RelayCard`

**Files:**
- Modify: `apps/overlay/src/daemon/store.ts:40`
- Create: `apps/overlay/src/surface/RelayCard.tsx`
- Modify: `apps/overlay/src/surface/ChatView.tsx` (props ligne ~22, rendu lignes ~106-110)
- Modify: `apps/overlay/src/i18n/messages.ts` (bloc `chat`, FR ligne ~175 et EN ligne ~358)
- Test: `apps/overlay/test/chat.test.tsx`, `apps/overlay/test/daemon.test.ts`

**Interfaces:**
- Consumes: `ChatRelay` (Task 1), `Bot`, `poseFor`, `botState` (`src/bots`), `toolName` (`src/format`).
- Produces:

```ts
export interface RelayCardProps {
  relay: ChatRelay;
  /** The target session as the snapshot has it; absent once it left the list. */
  session?: Session;
  busy: boolean; disabled: boolean; theme: 'dark' | 'light'; reducedMotion?: boolean;
  onSend: () => void; onCancel: () => void; onOpenSession: (id: string) => void;
}
export function RelayCard(p: RelayCardProps): JSX.Element;
```

`ChatViewProps` gagne `relayingQid?: string | null; onRelay?: (qid: string) => void; onRelayCancel?: (qid: string) => void;`. Textes : `t.chat.relay` (ci-dessous).

- [ ] **Step 1: Write the failing tests**

Dans `daemon.test.ts`, à côté du test qui vérifie que `chat.done` garde la proposition :

```ts
  it('chat.done keeps the relay', () => {
    daemonStore.apply({ type: 'chat.history', turns: [{ qid: 'q1', question: 'dis à Otto', askedAt: T0, steps: [] }] });
    const relay = { id: 's1', name: 'Otto', tool: 'claude' as const, text: 'Lance les tests' };
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, relay });
    expect(daemonStore.get().chat[0]!.relay).toEqual(relay);
  });
```

(Reprendre les noms exacts du fichier pour `T0` et l'accès à l'état, comme le test voisin sur `proposal`.)

Dans `chat.test.tsx`, nouveau `describe('the relay card')` :

```ts
describe('the relay card', () => {
  const relay: ChatRelay = { id: 'a', name: 'Otto', tool: 'claude', text: 'Run the overlay tests' };
  const withRelay = (r: ChatRelay): ChatTurn[] => [{ qid: 'q1', question: 'tell Otto to run the tests', askedAt: T0, steps: [], answer: 'I will pass it on to **Otto**.', answeredAt: T0, relay: r }];
  const otto = fakeSession('a', { name: 'Otto', project: 'ledge', branch: 'feat/x', state: 'idle' });
  const card = () => screen.getByRole('region', { name: 'Instruction to send' });

  it('proposed: the session with its state, the exact instruction, and Send', () => {
    const onRelay = vi.fn();
    render(<ChatView {...base} sessions={[otto]} turns={withRelay(relay)} live={null} onRelay={onRelay} />);
    expect(card()).toHaveTextContent('Otto');
    expect(card()).toHaveTextContent('Claude Code · ledge');
    expect(card()).toHaveTextContent('feat/x');
    expect(card()).toHaveTextContent('your turn');
    expect(card()).toHaveTextContent('Run the overlay tests');
    expect(card()).toHaveTextContent('or rephrase your request');
    fireEvent.click(within(card()).getByRole('button', { name: /Send/ }));
    expect(onRelay).toHaveBeenCalledWith('q1');
    expect(screen.queryByRole('region', { name: 'Proposed session' })).toBeNull();
  });

  it.each([
    ['working', 'working'], ['waiting_permission', 'waiting for you'], ['waiting_input', 'waiting for you'], ['exited', 'stopped']
  ] as const)('the pill follows the session: %s', (state, label) => {
    render(<ChatView {...base} sessions={[{ ...otto, state }]} turns={withRelay(relay)} live={null} />);
    expect(card()).toHaveTextContent(label);
  });

  it('a session gone from the snapshot keeps the relay\'s name and reads stopped', () => {
    render(<ChatView {...base} sessions={[]} turns={withRelay(relay)} live={null} />);
    expect(card()).toHaveTextContent('Otto');
    expect(card()).toHaveTextContent('stopped');
  });

  it('queued: Otto is working, it will go when he is done, with Cancel', () => {
    const onRelayCancel = vi.fn();
    render(<ChatView {...base} sessions={[{ ...otto, state: 'working' }]} turns={withRelay({ ...relay, status: 'queued' })} live={null} onRelayCancel={onRelayCancel} />);
    expect(card()).toHaveTextContent("Otto is working; I'll send it as soon as it's done");
    expect(within(card()).queryByRole('button', { name: /Send/ })).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: 'Cancel' }));
    expect(onRelayCancel).toHaveBeenCalledWith('q1');
  });

  it('sent: the companion, Sent to Otto with the time, the name opens the session', () => {
    const onOpenSession = vi.fn();
    render(<ChatView {...base} sessions={[otto]} turns={withRelay({ ...relay, status: 'sent', sentAt: '2026-10-12T14:32:00.000Z' })} live={null} onOpenSession={onOpenSession} />);
    expect(card()).toHaveTextContent(/Sent to Otto · \d{2}:\d{2}/);
    expect(within(card()).queryByRole('button')).toBeNull();
    fireEvent.click(within(card()).getByRole('link', { name: 'Otto' }));
    expect(onOpenSession).toHaveBeenCalledWith('a');
  });

  it('failed: the reason in an alert, and Retry', () => {
    const onRelay = vi.fn();
    render(<ChatView {...base} sessions={[]} turns={withRelay({ ...relay, error: 'Otto stopped before it got the instruction' })} live={null} onRelay={onRelay} />);
    expect(within(card()).getByRole('alert')).toHaveTextContent('Could not send: Otto stopped before it got the instruction');
    fireEvent.click(within(card()).getByRole('button', { name: 'Retry' }));
    expect(onRelay).toHaveBeenCalledWith('q1');
  });

  it('busy or offline: the buttons are disabled', () => {
    const { rerender } = render(<ChatView {...base} sessions={[otto]} turns={withRelay(relay)} live={null} relayingQid="q1" />);
    expect(within(card()).getByRole('button', { name: /Sending…/ })).toBeDisabled();
    rerender(<ChatView {...base} sessions={[otto]} turns={withRelay(relay)} live={null} offline="Ledge is unreachable" />);
    expect(within(card()).getByRole('button', { name: /Send/ })).toBeDisabled();
  });

  it('a relay block being streamed is held back', () => {
    render(<ChatView {...base} sessions={[otto]} turns={[{ qid: 'q1', question: 'x', askedAt: T0, steps: [] }]} live={{ qid: 'q1', text: 'I will pass it on.\n```ledge-relay\n{"session": "a", "te' }} />);
    expect(screen.getByText('I will pass it on.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('ledge-relay');
  });
});
```

Importer `ChatRelay` et `fakeSession` (`./mockDaemon`) si le fichier ne les importe pas encore. Si `base` n'a pas de `theme`, ajouter `theme: 'dark' as const` à `base`. Si `fakeSession` n'accepte pas `branch`, l'ajouter au `Partial<Session>` passé.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter overlay exec vitest run test/chat.test.tsx test/daemon.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`store.ts` ligne 40 : `: m.type === 'chat.done' ? { ...t, answer: m.text, answeredAt: m.at, ...(m.proposal ? { proposal: m.proposal } : {}), ...(m.relay ? { relay: m.relay } : {}) }`.

`messages.ts`, dans le bloc `chat` FR, après `card: {…}` :

```ts
    relay: {
      label: 'Instruction à envoyer', session: 'Session', instruction: 'Instruction',
      send: 'Envoyer', sending: 'Envoi…', cancel: 'Annuler', retry: 'Réessayer', orRephrase: 'ou reformule ta demande',
      queued: 'travaille, j’enverrai dès qu’il aura fini', sentTo: 'Envoyé à', failed: (why: string) => `Échec de l’envoi : ${why}`,
      pill: { yours: 'à toi', working: 'travaille', waiting: 'attend ta réponse', stopped: 'arrêtée' }
    },
```

et en EN :

```ts
    relay: {
      label: 'Instruction to send', session: 'Session', instruction: 'Instruction',
      send: 'Send', sending: 'Sending…', cancel: 'Cancel', retry: 'Retry', orRephrase: 'or rephrase your request',
      queued: "is working; I'll send it as soon as it's done", sentTo: 'Sent to', failed: (why: string) => `Could not send: ${why}`,
      pill: { yours: 'your turn', working: 'working', waiting: 'waiting for you', stopped: 'stopped' }
    },
```

(Si le fichier type les messages EN d'après le FR, garder les mêmes clés ; utiliser l'apostrophe typographique côté FR comme le reste du fichier.)

Créer `apps/overlay/src/surface/RelayCard.tsx` :

```tsx
import type { ChatRelay, Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { toolName } from '../format';
import { useI18n } from '../i18n/lang';

export interface RelayCardProps {
  relay: ChatRelay;
  /** The target session as the snapshot has it; absent once it left the list. */
  session?: Session;
  busy: boolean; disabled: boolean; theme: 'dark' | 'light'; reducedMotion?: boolean;
  onSend: () => void; onCancel: () => void; onOpenSession: (id: string) => void;
}

type Pill = 'yours' | 'working' | 'waiting' | 'stopped';
/** The session's state as the card words it: your turn, working, waiting for you, or stopped (gone, exited, error). */
export function relayPill(s: Session | undefined): Pill {
  if (!s || s.state === 'exited' || s.state === 'error') return 'stopped';
  if (s.state === 'waiting_input' || s.state === 'waiting_permission' || s.pending) return 'waiting';
  return botState(s) === 'idle' ? 'yours' : 'working';
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' };
const foot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' };
const small: React.CSSProperties = { height: 28, padding: '0 10px', gap: 6, fontSize: 12 };

/** The instruction the chat proposes to send (spec 2026-10-12 relay §6): proposed, queued, sent, or failed with a retry. Sending is the user's click. */
export function RelayCard(p: RelayCardProps) {
  const { t, lang } = useI18n(); const c = t.chat.relay; const r = p.relay; const s = p.session;
  const state = r.status === 'sent' ? 'sent' : r.status === 'queued' ? 'queued' : r.error !== undefined ? 'failed' : 'proposed';
  const pill = relayPill(s);
  const bot = (size: number) => <Bot seed={r.id} tool={r.tool} state={s ? botState(s) : 'done'} pose={poseFor(r.id, s?.state ?? 'exited')} size={size} theme={p.theme} reducedMotion={p.reducedMotion} />;
  const name = <a href={`ledge://session/${r.id}`} onClick={e => { e.preventDefault(); p.onOpenSession(r.id); }} style={{ fontWeight: 600, color: 'inherit' }}>{r.name}</a>;
  const time = r.sentAt ? new Date(r.sentAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <section data-relay-card={state} aria-label={c.label} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      {state === 'sent' ? (
        <div style={row}>{bot(20)}<span style={{ flex: 1, minWidth: 0 }}>{c.sentTo} {name} · {time}</span></div>
      ) : (
        <>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', padding: '10px 12px', alignItems: 'center' }}>
            <dt style={muted}>{c.session}</dt>
            <dd style={{ margin: 0, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              {bot(24)}
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{r.name}</strong>
                {s && <span style={{ ...muted, display: 'block', fontSize: 11.5 }}>{toolName(r.tool)} · {s.repo ?? s.project}{s.branch && <> <code>{s.branch}</code></>}</span>}
              </span>
              <span data-pill={pill} style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, border: '1px solid var(--sidebar-border)', ...muted }}>{c.pill[pill]}</span>
            </dd>
            <dt style={muted}>{c.instruction}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}><blockquote style={{ margin: 0, paddingLeft: 8, borderLeft: '2px solid var(--sidebar-border)' }}>{r.text}</blockquote></dd>
          </dl>
          {state === 'failed' && <div role="alert" style={{ padding: '6px 12px', color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 12%, transparent)' }}>{c.failed(r.error!)}</div>}
          {state === 'queued' ? (
            <div style={foot}>
              <span aria-hidden data-pulse={!p.reducedMotion || undefined} style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--primary)', animation: p.reducedMotion ? undefined : 'ledge-pulse 1.4s ease-in-out infinite' }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><strong>{r.name}</strong> {c.queued}</span>
              <Button variant="outline" size="sm" disabled={p.busy || p.disabled} onClick={p.onCancel} style={small}>{c.cancel}</Button>
            </div>
          ) : (
            <div style={foot}>
              <Button variant="primary" size="sm" disabled={p.busy || p.disabled} onClick={p.onSend} style={small}>
                {state === 'proposed' && <Icon size={12} {...ICONS.send} />}{p.busy ? c.sending : state === 'failed' ? c.retry : c.send}
              </Button>
              <span style={{ ...muted, fontSize: 12 }}>{c.orRephrase}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
```

`useI18n()` renvoie `{ lang, t }` et `ICONS.send` existe (vérifiés). Aucune animation de pulsation n'existe encore : ajouter à `apps/overlay/src/styles/base.css`, à côté de `@keyframes ledge-drain`, la ligne `@keyframes ledge-pulse { 50% { opacity: .35 } }`, et l'ajouter au `git add` du commit. `Session.repo` / `Session.branch` sont des champs facultatifs du protocole (utilisés par `chat/context.ts`).

`ChatView.tsx` : ajouter les trois props à `ChatViewProps`, importer `RelayCard`, et remplacer le rendu de la carte (lignes ~106-110) par :

```tsx
                    {turn.answeredAt !== undefined && turn.relay ? (
                      <RelayCard relay={turn.relay} session={p.sessions.find(s => s.id === turn.relay!.id)} busy={p.relayingQid === turn.qid}
                        disabled={!!p.offline || (!!p.relayingQid && p.relayingQid !== turn.qid)} theme={p.theme ?? 'dark'} reducedMotion={p.reducedMotion}
                        onSend={() => p.onRelay?.(turn.qid)} onCancel={() => p.onRelayCancel?.(turn.qid)} onOpenSession={p.onOpenSession} />
                    ) : turn.answeredAt !== undefined && turn.proposal && (
                      <LaunchCard … inchangé … />
                    )}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter overlay exec vitest run test/chat.test.tsx test/daemon.test.ts test/i18n.test.tsx && pnpm typecheck`
Expected: PASS (le test i18n vérifie en général que FR et EN ont les mêmes clés).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/styles/base.css apps/overlay/src/daemon/store.ts apps/overlay/src/surface/RelayCard.tsx apps/overlay/src/surface/ChatView.tsx apps/overlay/src/i18n/messages.ts apps/overlay/test/chat.test.tsx apps/overlay/test/daemon.test.ts
git commit -m "feat(overlay): the relay card, in its four states, under the chat's answer"
```

---

### Task 8: Overlay — Surface et aide

**Files:**
- Modify: `apps/overlay/src/surface/Surface.tsx` (après `launchProposal`, lignes ~403-423 ; garde de `launch` ligne ~384 et de `launchProposal` ligne ~405 ; `ChatView` ligne ~617)
- Modify: `apps/overlay/src/i18n/messages.ts` (`help.chat`, FR ligne ~186, EN ligne ~369)
- Test: `apps/overlay/test/relay-from-chat.test.tsx` (nouveau)

**Interfaces:**
- Consumes: `ChatViewProps.relayingQid/onRelay/onRelayCancel` (Task 7), ClientMessages `session.relay` / `session.relay.cancel` (Task 1).
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1: Write the failing test** — créer `apps/overlay/test/relay-from-chat.test.tsx`, sur le modèle de `test/launch-from-chat.test.tsx` (mêmes mocks, `client()`, `apply`, `mode()`) :

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ChatRelay, ChatTurn, ClientMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

const bridge = vi.hoisted(() => ({ focusOverlay: vi.fn(async () => {}), releaseFocus: vi.fn(async () => {}), focusTerminal: vi.fn(async (_t: string) => true) }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), ...bridge }));

let sent: ClientMessage[];
const client = (): DaemonClient => ({ connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} });
const apply = (m: Parameters<typeof daemonStore.apply>[0]) => act(() => { daemonStore.apply(m); });
const mode = () => document.querySelector('[data-surface]')!.getAttribute('data-mode');
const relay: ChatRelay = { id: 'a', name: 'Otto', tool: 'claude', text: 'Run the overlay tests' };
const relays = () => sent.filter(m => m.type === 'session.relay' || m.type === 'session.relay.cancel');

/** Opens the list, asks Ledge, and answers the turn with a relay: the chat shows its card. */
function askAndRelay(): { qid: string; turn: (r: ChatRelay) => ChatTurn } {
  render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a', { name: 'Otto', state: 'working' })] }); });
  act(() => { fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); });
  act(() => { vi.advanceTimersByTime(400); });
  fireEvent.click(screen.getByRole('button', { name: 'Open the conversation with Ledge' }));
  const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
  fireEvent.change(input, { target: { value: 'tell Otto to run the overlay tests' } }); fireEvent.keyDown(input, { key: 'Enter' });
  const ask = sent.find(m => m.type === 'chat.ask') as Extract<ClientMessage, { type: 'chat.ask' }>;
  const at = new Date().toISOString();
  apply({ type: 'chat.done', qid: ask.qid, text: 'I will pass it on to Otto.', at, relay });
  return { qid: ask.qid, turn: r => ({ qid: ask.qid, question: ask.text, askedAt: at, steps: [], answer: 'I will pass it on to Otto.', answeredAt: at, relay: r }) };
}
const card = () => screen.getByRole('region', { name: 'Instruction to send' });

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent = []; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('relaying from a chat card', () => {
  it('Send sends the qid once, stays in the chat; the queued card cancels with its qid', () => {
    const { qid, turn } = askAndRelay();
    fireEvent.click(within(card()).getByRole('button', { name: /Send/ }));
    expect(within(card()).getByRole('button', { name: /Sending…/ })).toBeDisabled();
    fireEvent.click(within(card()).getByRole('button', { name: /Sending…/ }));
    expect(relays()).toEqual([{ type: 'session.relay', qid }]);
    apply({ type: 'chat.history', turns: [turn({ ...relay, status: 'queued' })] });
    expect(mode()).toBe('chat');
    fireEvent.click(within(card()).getByRole('button', { name: 'Cancel' }));
    expect(relays()).toEqual([{ type: 'session.relay', qid }, { type: 'session.relay.cancel', qid }]);
  });

  it('a refusal with the same message as before frees Retry', () => {
    const { qid, turn } = askAndRelay();
    apply({ type: 'chat.history', turns: [turn({ ...relay, error: 'the agent did not take the answer' })] });
    fireEvent.click(within(card()).getByRole('button', { name: 'Retry' }));
    expect(within(card()).getByRole('button', { name: /Sending…/ })).toBeDisabled();
    apply({ type: 'error', message: 'the agent did not take the answer' });
    expect(within(card()).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(relays()).toEqual([{ type: 'session.relay', qid }]);
  });

  it('a lost connection frees the button; offline keeps it disabled', () => {
    askAndRelay();
    fireEvent.click(within(card()).getByRole('button', { name: /Send/ }));
    act(() => { daemonStore.setStatus('unreachable'); });
    expect(within(card()).getByRole('button', { name: /Send/ })).toBeDisabled();
    act(() => { daemonStore.setStatus('open'); });
    expect(within(card()).getByRole('button', { name: /Send/ })).toBeEnabled();
  });

  it('never in flight together with a launch: an id-less error frees only the one that asked', () => {
    askAndRelay();
    fireEvent.click(within(card()).getByRole('button', { name: /Send/ }));
    // The + form refuses to launch while a relay is in flight, so the next error can only be the relay's.
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true, altKey: true });
    expect(sent.filter(m => m.type === 'session.launch')).toEqual([]);
  });
});
```

Pour le dernier test : si Ctrl Alt N n'ouvre pas le formulaire depuis le chat, ou si le lancer demande plusieurs gestes, tester la garde directement — ouvrir le formulaire, cliquer « Start » — et vérifier qu'aucun `session.launch` ne part tant que le relais est en vol. Si `daemonStore.setStatus('unreachable')` ne fait pas passer `offline` au chat, reprendre l'helper qu'utilise `launch-from-chat.test.tsx` pour « a lost connection ».

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter overlay exec vitest run test/relay-from-chat.test.tsx`
Expected: FAIL (le bouton Send n'envoie rien).

- [ ] **Step 3: Write the implementation** — dans `Surface.tsx`, après les effets de `chatLaunching` :

```tsx
  // A chat card's relay (spec 2026-10-12 relay §6): the turn's qid while the daemon answers. The card's own state (queued, sent, failed)
  // comes back with chat.history; a refusal comes back as an id-less error, so a relay and a launch are never in flight together.
  const [relaying, setRelaying] = useState<string | null>(null);
  const relayState = (qid: string | null) => { const r = qid ? chat.find(x => x.qid === qid)?.relay : undefined; return r ? `${r.status ?? ''}|${r.sentAt ?? ''}|${r.error ?? ''}` : 'gone'; };
  const relayFrom = useRef('');
  const relayCard = (type: 'session.relay' | 'session.relay.cancel', qid: string) => {
    if (relaying || launching || chatLaunching || status === 'unreachable' || !chat.find(x => x.qid === qid)?.relay) return;
    relayFrom.current = relayState(qid); setRelaying(qid);
    send({ type, qid });
  };
  const relayingNow = relayState(relaying);
  useEffect(() => { if (relaying && relayingNow !== relayFrom.current) setRelaying(null); }, [relaying, relayingNow]);
  useEffect(() => { if (relaying && lastError && !lastError.id) setRelaying(null); }, [lastError?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status === 'unreachable' && relaying) setRelaying(null); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
```

Ajouter `|| relaying` aux gardes de `launch` (ligne ~384 : `if (launching || chatLaunching || relaying || status === 'unreachable') return;`) et de `launchProposal` (ligne ~405). `relaying` étant déclaré après ces fonctions, déplacer le bloc ci-dessus juste avant `const launch = …`, avec `chat` et `lastError` déjà en portée.

Dans le rendu de `ChatView` (ligne ~617), à côté de `launchingQid={chatLaunching}` :

```tsx
              relayingQid={relaying} onRelay={qid => relayCard('session.relay', qid)} onRelayCancel={qid => relayCard('session.relay.cancel', qid)}
```

`messages.ts`, `help.chat` :
- FR : `'Au chat, « ouvre une session dans ledge pour corriger le build » propose une carte : le clic sur Lancer démarre la session. « Dis à Otto de lancer les tests » propose une instruction : Envoyer la tape dans sa session, tout de suite ou dès qu’il a fini.'`
- EN : `'Ask the chat "open a session in ledge to fix the build": it proposes a card, and Start the session starts it. "Tell Otto to run the tests" proposes an instruction: Send types it into his session, now or as soon as he is done.'`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter overlay test && pnpm typecheck`
Expected: PASS, y compris `launch-from-chat.test.tsx` (la garde ajoutée ne le gêne pas) et le test d'aide s'il compare le texte (le mettre à jour s'il le cite).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/surface/Surface.tsx apps/overlay/src/i18n/messages.ts apps/overlay/test/relay-from-chat.test.tsx
git commit -m "feat(overlay): Send, Cancel and Retry on the relay card; the help mentions it"
```

---

### Task 9: Playwright

**Files:**
- Create: `apps/overlay/e2e/relay-from-chat.spec.ts`

**Interfaces:**
- Consumes: `fakeDaemon` (`upsert`, `emit`, `received`), `session`, `openList`, `layer`, `expectMode`, `ready`, `received` (fixtures existantes).

- [ ] **Step 1: Write the test**

```ts
import { test, expect, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openList } from './scenarios';

/* The chat proposes an instruction for Otto, the user sends it from the card (spec 2026-10-12 relay). */
const relay = { id: 'otto', name: 'Otto', tool: 'claude', text: 'Run the overlay tests' };

async function askForRelay(page: Parameters<typeof fakeDaemon>[0], ottoState: 'working' | 'idle') {
  const d = await fakeDaemon(page, [session('otto', { name: 'Otto', state: ottoState }), session('pim', { name: 'Pim' })]);
  await ready(page, 2);
  await openList(page);
  await layer(page, 'list').getByRole('textbox', { name: 'Ask Ledge' }).fill('tell Otto to run the overlay tests');
  await page.keyboard.press('Enter');
  await expectMode(page, 'chat');
  const ask = await received(d.received, 'chat.ask');
  const answeredAt = new Date().toISOString();
  const turn = { qid: ask.qid, question: ask.text, askedAt: answeredAt, steps: [], answer: 'I will pass it on to Otto.', answeredAt };
  d.emit({ type: 'chat.done', qid: ask.qid, text: turn.answer, at: answeredAt, relay });
  return { d, ask, turn };
}

test('a busy session: the card waits, then reads sent once the daemon sends it', async ({ page }) => {
  const { d, ask, turn } = await askForRelay(page, 'working');
  const card = layer(page, 'chat').getByRole('region', { name: 'Instruction to send' });
  await expect(card).toContainText('Run the overlay tests');
  await expect(card).toContainText('working');
  await card.getByRole('button', { name: /Send/ }).click();
  expect(await received(d.received, 'session.relay')).toEqual({ type: 'session.relay', qid: ask.qid });
  d.emit({ type: 'chat.history', turns: [{ ...turn, relay: { ...relay, status: 'queued' } }] });
  await expect(card).toContainText("Otto is working; I'll send it as soon as it's done");
  await expect(card.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  d.upsert(session('otto', { name: 'Otto', state: 'idle' }));
  d.emit({ type: 'chat.history', turns: [{ ...turn, relay: { ...relay, status: 'sent', sentAt: new Date().toISOString() } }] });
  await expect(card).toContainText(/Sent to Otto · \d{2}:\d{2}/);
  await expectMode(page, 'chat');
});

test('a failed send shows the reason; Retry sends it again', async ({ page }) => {
  const { d, ask, turn } = await askForRelay(page, 'idle');
  const card = layer(page, 'chat').getByRole('region', { name: 'Instruction to send' });
  await card.getByRole('button', { name: /Send/ }).click();
  await received(d.received, 'session.relay');
  d.emit({ type: 'chat.history', turns: [{ ...turn, relay: { ...relay, error: 'the agent did not take the answer' } }] });
  d.refuse('the agent did not take the answer');
  await expect(card.getByRole('alert')).toHaveText('Could not send: the agent did not take the answer');
  await card.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'session.relay' && m.qid === ask.qid).length).toBe(2);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter overlay test:e2e e2e/relay-from-chat.spec.ts e2e/launch-from-chat.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/overlay/e2e/relay-from-chat.spec.ts
git commit -m "test(e2e): relay from the chat, queued then sent; failed then Retry"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md` (§Asking Ledge ligne ~190, §Protocol ligne ~206, §Design documents ligne ~434 si les specs y sont listées)

- [ ] **Step 1: Write the docs**

§Asking Ledge, après le paragraphe sur la carte de lancement :

```markdown
Ask it to pass something on — "tell Otto to run the overlay tests" — and, when exactly one tracked session matches and Ledge can type into it, the answer ends with a card: the session, its state, and the exact instruction. **Send** types it into the session the way a reply from the overlay does. If the session is busy, the card waits ("Otto is working; I'll send it as soon as it's done", **Cancel**) and the daemon sends it the next time the session is free, one instruction per free moment, oldest first, even with the overlay closed. Sessions started outside Ledge (hook only) are read-only and never get a card. A reset, a new day or a daemon restart drops the waiting instructions with the history; nothing is sent.
```

§Protocol, dans le tableau ou la liste des messages :

```markdown
| `session.relay { qid }` | client → daemon | Sends the chat card's instruction now, or queues it until the session is free. Refusals: `unknown relay`, `already sent`, `already queued`. |
| `session.relay.cancel { qid }` | client → daemon | Takes the card's instruction back out of the queue (`nothing queued` otherwise). |
```

et mentionner `relay?` dans la ligne de `chat.done` (`{ qid, text, at, proposal?, relay? }`) et de `ChatTurn`. Ajouter la spec `2026-10-12-relay-from-chat-design.md` à §Design documents si la liste existe. Suivre le format exact des lignes voisines.

- [ ] **Step 2: Check**

Run: `pnpm test && pnpm typecheck`
Expected: PASS (filet de sécurité avant la vérification manuelle).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): relay an instruction from the chat"
```

---

### Task 11: Vérification manuelle avec les vrais harnais

Pas de code ; on note le résultat dans le compte rendu final.

- [ ] **Step 1:** Rebuild et relancer le daemon et l'overlay comme indiqué dans §Development du README.
- [ ] **Step 2:** Lancer une session Ledge (Otto) sur un dépôt de test. Pour chaque harnais du chat (réglage harnais par défaut : Claude Code, Codex, Cursor Agent) :
  - « dis à Otto de lister les fichiers du dossier » avec Otto libre → une carte ; Envoyer → l'instruction apparaît dans le terminal d'Otto, la carte passe à « Envoyé à Otto · hh:mm » ;
  - la même demande pendant qu'Otto travaille → carte « en attente » ; elle part quand Otto rend la main, et une seule à la fois si deux sont en file ;
  - une demande ambiguë (deux sessions qui pourraient convenir, ou « dis-lui » sans nom) → une question, pas de carte ;
  - une question ordinaire (« où en est Otto ? ») → pas de carte ;
  - une session `hook_only` (lancée sans Ledge) nommée explicitement → pas de carte, une explication.
- [ ] **Step 3:** Vérifier dans `daemon.log` les lignes `relay ignored` / `relay … failed` des cas refusés. Si un harnais met le prénom au lieu de l'id dans `session`, noter le cas : il faudra soit durcir le persona, soit accepter un prénom unique (décision à prendre avec l'utilisateur, hors de ce plan).

---

## Ordre et dépendances

1 → 2 → 3 → 4 → 5 → 6 (daemon), puis 7 → 8 (overlay ; 7 dépend de 1-2 seulement), 9 après 6 et 8, 10 puis 11 en dernier. La Task 3 et la Task 7 peuvent avancer en parallèle une fois la Task 2 faite.
