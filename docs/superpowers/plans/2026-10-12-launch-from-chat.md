# Lancer une session depuis le chat Ledge — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'utilisateur demande au chat Ledge, en langage naturel, d'ouvrir une session ; le chat répond avec une carte (dossier déduit, harnais par défaut, instruction) que l'utilisateur confirme d'un clic, ce qui lance une session `launcher` ordinaire.

**Architecture:** Le harnais du chat (toujours en lecture seule) termine sa réponse par un bloc ```` ```ledge-session ```` contenant `{"cwd", "prompt"?}`. Le daemon retire ce bloc du texte, vérifie le dossier et attache au tour une `proposal` (`chat.done`, `chat.history`). L'overlay affiche une `LaunchCard` ; le clic envoie `session.launch { …, qid }`, et le daemon lance avec les champs de la proposition (pas ceux du message), puis marque le tour lancé ou en échec et diffuse `chat.history`.

**Tech Stack:** TypeScript, zod (`@ledge/protocol`, importé depuis les sources), Node 22 + ws (`packages/ledge`), React 19 + Tauri 2 (`apps/overlay`), vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-launch-from-chat-design.md` (maquette : `docs/mockups/ledge-launch-from-chat.html`). À lire avant chaque tâche avec ce plan.

Écart assumé par rapport à la spec : `extractProposal` vit dans `packages/protocol/src/proposal.ts` (et non `packages/ledge/src/chat/proposal.ts`), pour que le daemon et le masquage du streaming dans l'overlay partagent la même expression régulière. La spec cite les erreurs « déjà lancée » / « proposition introuvable » ; le daemon répond en anglais comme toutes ses erreurs : `already launched`, `unknown proposal`. `markLaunched` / `markFailed` prennent un troisième argument `emit`, comme `reset(emit)`.

## Global Constraints

- Le harnais du chat ne reçoit aucun outil nouveau : `claude -p --restricted --tools Read,Grep,Glob`, `codex exec --sandbox read-only`, `cursor-agent -p --mode ask` restent tels quels (spec §2).
- Déclenchement en langage naturel uniquement : pas de commande `/session` (spec §1).
- Pas de dossier par défaut ni de bac à sable : le dossier est toujours déduit de la phrase, sinon demandé (spec §1).
- Harnais : celui que porte déjà `chat.ask` (le harnais par défaut des réglages) (spec §1).
- Confirmation par une carte ; aucun lancement direct (spec §1).
- Les nouveaux champs du protocole sont tous facultatifs : un overlay ou un daemon plus ancien les ignore (spec §5).
- Bloc : langue `ledge-session`, JSON `{"cwd": "<chemin absolu WSL, ~ accepté>", "prompt"?: "…"}` ; `prompt` absent ou vide = session sans instruction (spec §3).
- Seul le dernier bloc compte ; tous les blocs `ledge-session` sont retirés du texte affiché ; un bloc invalide est retiré, ignoré, et logué dans `daemon.log` (spec §4).
- Après Lancer on reste dans le chat (pas de retour à la liste, pas de bandeau) ; l'onglet du terminal s'ouvre si `ledge.launch.openTab` le dit (spec §6).
- Textes FR et EN dans `apps/overlay/src/i18n/messages.ts` ; les tests de l'overlay tournent en anglais.
- Style du code : celui des fichiers voisins (lignes longues, commentaires d'une phrase en anglais au-dessus des blocs non évidents, pas de point-virgule manquant).

## Review Focus

- Deux clics rapides sur Lancer, ou deux overlays qui cliquent en même temps, avant que le premier lancement ait répondu : une seule session doit naître (garde `chatLaunches` côté daemon, Task 5).
- Le JSON arrive en morceaux pendant le streaming (`` ` ``, puis ```` `` ````, puis ```` ```ledge-se ````, puis le JSON non fermé) : aucun fragment de fence ni de JSON ne doit jamais s'afficher (Task 2 et Task 6).
- Un bloc avec `"cwd": "~/ledge/"` (tilde, slash final) ou `"prompt": "   "` : la carte montre le chemin résolu sans slash et « Aucune, session vide » (Task 4).
- Le daemon devient injoignable pendant un lancement depuis la carte : le bouton doit redevenir cliquable une fois la connexion revenue, sans rester sur « Lancement… » (Task 7).
- Un lancement depuis la carte pendant que le formulaire `+` lance (ou l'inverse) : chaque réponse `session.launched` / `error` ne doit être consommée que par celui qui l'a demandée (Task 7).

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/protocol/src/chat.ts` (modif) | `ChatProposalSchema`, `ChatTurn.proposal?` |
| `packages/protocol/src/messages.ts` (modif) | `chat.done.proposal?`, `session.launch.qid?` |
| `packages/protocol/src/proposal.ts` (nouveau) | `extractProposal`, `parseProposalBlock`, `hideProposal` (purs) |
| `packages/protocol/src/index.ts` (modif) | exporte `proposal.js` |
| `packages/ledge/src/chat/context.ts` (modif) | écrit `folders.md` |
| `packages/ledge/src/chat/claude.ts` (modif) | `PERSONA` |
| `packages/ledge/src/chat/service.ts` (modif) | proposition en fin de tour, `proposal` / `markLaunched` / `markFailed` |
| `packages/ledge/src/daemon/server.ts` (modif) | `session.launch` avec `qid` |
| `packages/ledge/test/fake-claude.mjs` (modif) | `FAKE_ANSWER`, mode `folders` |
| `apps/overlay/src/daemon/store.ts` (modif) | `chat.done` garde la proposition |
| `apps/overlay/src/surface/openTabPreference.ts` (nouveau) | `loadOpenTab` / `saveOpenTab` partagés |
| `apps/overlay/src/surface/LaunchCard.tsx` (nouveau) | la carte, trois états |
| `apps/overlay/src/surface/ChatView.tsx` (modif) | rend la carte, masque le bloc en streaming |
| `apps/overlay/src/surface/Surface.tsx` (modif) | envoie `session.launch { qid }`, onglet du terminal |
| `apps/overlay/src/surface/HelpView.tsx`, `i18n/messages.ts` (modif) | textes |
| `apps/overlay/e2e/launch-from-chat.spec.ts` (nouveau) | Playwright |
| `README.md` (modif) | §Asking Ledge, §Protocol |

Commandes : `pnpm --filter @ledge/protocol test`, `pnpm --filter ledge test`, `pnpm --filter overlay test`, `pnpm typecheck`, `pnpm build`. Un seul fichier : `pnpm --filter ledge exec vitest run test/chat-service.test.ts`.

---

### Task 1: Protocole — les champs de la proposition

**Files:**
- Modify: `packages/protocol/src/chat.ts`
- Modify: `packages/protocol/src/messages.ts:46` (`chat.done`) et `:57` (`session.launch`)
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces: `ChatProposalSchema`, `type ChatProposal = { cwd: string; project: string; prompt?: string; tool: Tool; launchedId?: string; error?: string }` ; `ChatTurn.proposal?: ChatProposal` ; `chat.done { qid, text, at, proposal?: ChatProposal }` ; `session.launch { tool, cwd, name?, prompt?, continue?, qid?: string }`.

- [ ] **Step 1: Write the failing test** — à la fin du `describe` qui contient `it('carries the chat messages')` dans `packages/protocol/test/messages.test.ts` :

```ts
  it('carries a launch proposal on a turn, on chat.done, and the card qid on session.launch', () => {
    const proposal = { cwd: '/w/ledge', project: 'ledge', prompt: 'Corrige le build', tool: 'claude' as const };
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal })).toEqual({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal });
    const launched = { ...proposal, launchedId: 'n1' };
    const h = parseServerMessage({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], answer: 'ok', answeredAt: T0, proposal: launched }] });
    expect(h.type === 'chat.history' && h.turns[0]!.proposal).toEqual(launched);
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal: { ...proposal, tool: 'vim' } })).toThrow();
    expect(() => parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0, proposal: { ...proposal, cwd: '' } })).toThrow();
    expect(parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', qid: 'q1' })).toEqual({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', qid: 'q1' });
    // Older messages stay valid.
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0 })).not.toHaveProperty('proposal');
    expect(parseClientMessage({ type: 'session.launch', tool: 'claude', cwd: '/w' })).not.toHaveProperty('qid');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ledge/protocol test`
Expected: FAIL — `proposal` est retiré par zod (`toEqual` échoue) et `qid` aussi.

- [ ] **Step 3: Implement** — dans `packages/protocol/src/chat.ts`, ajouter l'import et le schéma au-dessus de `ChatTurnSchema`, puis le champ :

```ts
import { z } from 'zod';
import { ToolSchema } from './session.js';
```

```ts
/** A session the chat proposes to start (spec 2026-10-12 §5): the folder as the daemon resolved it, the question's harness;
 *  `launchedId` once the card started it, `error` when the last launch failed. */
export const ChatProposalSchema = z.object({
  cwd: z.string().min(1), project: z.string(), prompt: z.string().optional(), tool: ToolSchema,
  launchedId: z.string().optional(), error: z.string().optional()
});
export type ChatProposal = z.infer<typeof ChatProposalSchema>;
```

Dans `ChatTurnSchema`, après `error: z.string().optional()` : `, proposal: ChatProposalSchema.optional()`.

Dans `packages/protocol/src/messages.ts` : importer `ChatProposalSchema` à côté de `ChatStepSchema` (même import depuis `./chat.js`), puis

```ts
  z.object({ type: z.literal('chat.done'), qid: z.string(), text: z.string(), at: z.string().datetime(), proposal: ChatProposalSchema.optional() }),
```

et pour `session.launch`, compléter le commentaire et le schéma :

```ts
  /** The overlay starts a session: `cwd` is a WSL path (`~` allowed), `name` a preferred bot name (the daemon picks a
   *  free one otherwise), `prompt` the agent's first instruction, `continue` resumes the folder's last conversation.
   *  With `qid` it is the chat card of that turn: the daemon launches the turn's proposal and ignores the other fields. */
  z.object({ type: z.literal('session.launch'), tool: ToolSchema, cwd: z.string().min(1), name: z.string().optional(), prompt: z.string().optional(), continue: z.boolean().optional(), qid: z.string().min(1).optional() }),
```

`session.ts` n'importe pas `chat.ts` : pas de cycle.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ledge/protocol test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/chat.ts packages/protocol/src/messages.ts packages/protocol/test/messages.test.ts
git commit -m "feat(protocol): a chat turn can carry a session proposal"
```

---

### Task 2: Protocole — lire et masquer le bloc `ledge-session`

**Files:**
- Create: `packages/protocol/src/proposal.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/proposal.test.ts`

**Interfaces:**
- Produces:
  - `extractProposal(answer: string): { text: string; raw: string | null }` — `raw` : le contenu du dernier bloc (trimé), `null` sans bloc ; `text` : la réponse sans aucun bloc (inchangée s'il n'y en a pas).
  - `parseProposalBlock(raw: string): ProposalBlock | null` avec `type ProposalBlock = { cwd: string; prompt?: string }`.
  - `hideProposal(text: string): string` — pour le texte en streaming : blocs retirés (fermés ou non) et fence en cours de frappe retenue en fin de texte.

- [ ] **Step 1: Write the failing test** — `packages/protocol/test/proposal.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { extractProposal, parseProposalBlock, hideProposal } from '../src/proposal.js';

const block = (json: string) => '```ledge-session\n' + json + '\n```';

describe('extractProposal', () => {
  it('leaves an answer without a block untouched', () => {
    const a = 'Deux compagnons travaillent.\n\n```bash\nls\n```\n';
    expect(extractProposal(a)).toEqual({ text: a, raw: null });
  });
  it('takes the block out and returns its JSON', () => {
    expect(extractProposal('Je te propose ça.\n\n' + block('{"cwd": "/w/ledge"}'))).toEqual({ text: 'Je te propose ça.', raw: '{"cwd": "/w/ledge"}' });
  });
  it('keeps the text after the block', () => {
    expect(extractProposal('Avant.\n' + block('{"cwd": "/a"}') + '\nAprès.')).toEqual({ text: 'Avant.\n\nAprès.', raw: '{"cwd": "/a"}' });
  });
  it('removes every block and keeps the last one', () => {
    expect(extractProposal('A\n' + block('{"cwd": "/a"}') + '\n\nB\n' + block('{"cwd": "/b"}'))).toEqual({ text: 'A\n\nB', raw: '{"cwd": "/b"}' });
  });
  it('takes an unclosed block to the end of the answer', () => {
    expect(extractProposal('A\n```ledge-session\n{"cwd":')).toEqual({ text: 'A', raw: '{"cwd":' });
  });
});

describe('parseProposalBlock', () => {
  it('reads cwd and the optional prompt', () => {
    expect(parseProposalBlock('{"cwd": "~/ledge", "prompt": "Corrige le build"}')).toEqual({ cwd: '~/ledge', prompt: 'Corrige le build' });
    expect(parseProposalBlock('{"cwd": "/w/ledge"}')).toEqual({ cwd: '/w/ledge' });
  });
  it('refuses bad JSON, a missing or empty cwd, and anything that is not an object', () => {
    for (const raw of ['{"cwd":', '{"prompt": "x"}', '{"cwd": "  "}', '{"cwd": 3}', '["/w"]', 'null', '']) expect(parseProposalBlock(raw)).toBeNull();
  });
});

describe('hideProposal', () => {
  it('never shows a fence being typed nor the JSON that follows', () => {
    const steps = ['Je lance.\n`', 'Je lance.\n``', 'Je lance.\n```', 'Je lance.\n```ledge-se', 'Je lance.\n```ledge-session\n{"cwd": "/w', 'Je lance.\n' + block('{"cwd": "/w"}')];
    for (const s of steps) expect(hideProposal(s)).toBe('Je lance.');
  });
  it('shows ordinary text and other code blocks', () => {
    expect(hideProposal('Deux ')).toBe('Deux ');
    expect(hideProposal('Lance :\n```bash')).toBe('Lance :\n```bash');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ledge/protocol test`
Expected: FAIL — `Cannot find module '../src/proposal.js'`.

- [ ] **Step 3: Implement** — `packages/protocol/src/proposal.ts` :

```ts
import { z } from 'zod';

/** What the chat harness writes in its ```ledge-session block (spec 2026-10-12 §3); the daemon resolves `cwd`. */
export const ProposalBlockSchema = z.object({ cwd: z.string().trim().min(1), prompt: z.string().optional() });
export type ProposalBlock = z.infer<typeof ProposalBlockSchema>;

const FENCE = '```ledge-session';
/** A block from its fence to the closing fence, or to the end of the text when it is not closed (yet). */
const BLOCK = /```ledge-session[ \t]*\n?([\s\S]*?)(?:```|$)/g;

/** The answer without its proposal blocks, and the content of the last one (null when there is none). */
export function extractProposal(answer: string): { text: string; raw: string | null } {
  const found: string[] = [];
  const text = answer.replace(BLOCK, (_m, body: string) => { found.push(body.trim()); return ''; });
  return found.length === 0 ? { text: answer, raw: null } : { text: text.replace(/\n{3,}/g, '\n\n').trim(), raw: found.at(-1)! };
}

/** The block's JSON as a proposal, or null when it is not an object with a non-empty `cwd`. */
export function parseProposalBlock(raw: string): ProposalBlock | null {
  try { const r = ProposalBlockSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

/** A streamed answer as it may be shown: no block, and no fence still being typed at the end (`` ` `` … ```` ```ledge-se ````). */
export function hideProposal(text: string): string {
  const shown = text.replace(BLOCK, '');
  const lineStart = shown.lastIndexOf('\n') + 1;
  const tail = shown.slice(lineStart);
  // Trailing space is kept unless a block was taken out: deltas often end mid-sentence ("Deux ").
  return tail && FENCE.startsWith(tail) ? shown.slice(0, lineStart).trimEnd() : text === shown ? text : shown.trimEnd();
}
```

Dans `packages/protocol/src/index.ts`, ajouter `export * from './proposal.js';` après `./names.js`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @ledge/protocol test`
Expected: PASS (les 9 cas).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/proposal.ts packages/protocol/src/index.ts packages/protocol/test/proposal.test.ts
git commit -m "feat(protocol): read and hide the chat's ledge-session block"
```

---

### Task 3: Daemon — `folders.md` et le persona

**Files:**
- Modify: `packages/ledge/src/chat/context.ts`
- Modify: `packages/ledge/src/chat/claude.ts:5-8` (`PERSONA`)
- Test: `packages/ledge/test/chat-context.test.ts`, `packages/ledge/test/chat-claude.test.ts`

**Interfaces:**
- Consumes: `Recent = { cwd: string; project: string; lastAt: string }` de `@ledge/protocol` (ce que renvoie `store.recents()`, déjà triée du plus récent au plus ancien, 12 au plus).
- Produces: `ContextInput.recents?: Recent[]` ; `writeContext` écrit toujours `folders.md` (aucune étape `ChatStep` associée : `stepFor` renvoie `null` pour ce fichier).

- [ ] **Step 1: Write the failing tests**

Dans `packages/ledge/test/chat-context.test.ts`, dans `describe('writeContext')` (ajouter `readFileSync` à l'import `node:fs` s'il manque) :

```ts
  it('writes folders.md from the recent folders, most recent first, and no step for it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const recents = [{ cwd: '/w/ledge', project: 'ledge', lastAt: '2026-10-12T09:00:00.000Z' }, { cwd: '/w/api', project: 'api', lastAt: '2026-10-11T09:00:00.000Z' }];
    const ctx = await writeContext(dir, { sessions: [], recents, now: T0, capture: async () => null, git: async () => null });
    const md = readFileSync(join(dir, 'folders.md'), 'utf8');
    expect(md).toContain('- ledge: /w/ledge (last used 2026-10-12T09:00:00.000Z)');
    expect(md.indexOf('/w/ledge')).toBeLessThan(md.indexOf('/w/api'));
    expect(stepFor(join(dir, 'folders.md'), ctx)).toBeNull();
    const empty = mkdtempSync(join(tmpdir(), 'ctx-'));
    await writeContext(empty, { sessions: [], now: T0, capture: async () => null, git: async () => null });
    expect(readFileSync(join(empty, 'folders.md'), 'utf8')).toContain('(none yet)');
  });
```

(Si `mkdtempSync`, `tmpdir`, `join` ne sont pas déjà importés dans ce fichier, les ajouter comme dans `chat-service.test.ts`.)

Dans `packages/ledge/test/chat-claude.test.ts`, à côté du test qui vérifie `--append-system-prompt` :

```ts
  it('the persona allows a proposal block only, and names folders.md', () => {
    expect(PERSONA).toContain('```ledge-session');
    expect(PERSONA).toContain('folders.md');
    expect(PERSONA).toContain('Tu n\'agis jamais toi-même');
    expect(PERSONA).not.toContain('Tu ne proposes jamais d\'agir');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ledge exec vitest run test/chat-context.test.ts test/chat-claude.test.ts`
Expected: FAIL — `ENOENT … folders.md` et le persona ne contient pas `ledge-session`.

- [ ] **Step 3: Implement**

`context.ts` : importer `Recent` (`import type { ChatStep, Recent, Session } from '@ledge/protocol';`), étendre l'entrée, et écrire le fichier juste après `sessions.md` :

```ts
export interface ContextInput { sessions: Session[]; recents?: Recent[]; capture: (s: Session) => Promise<string[] | null>; git: (cwd: string) => Promise<string | null>; now: string }
```

```ts
  // The folders a session can be proposed in (spec 2026-10-12 §4), beside the sessions' own folders in sessions.md.
  const recents = input.recents ?? [];
  await writeFile(join(dir, 'folders.md'), ['# Recent folders', '', 'The folders the user started sessions in, most recent first.', '',
    ...(recents.length ? recents.map(r => `- ${r.project}: ${r.cwd} (last used ${r.lastAt})`) : ['- (none yet)']), ''].join('\n'));
```

Mettre à jour le commentaire JSDoc de `writeContext` : « `sessions.md` names every session …; `folders.md` lists the recent folders; … ».

`claude.ts` — `PERSONA` devient (seules la phrase « Tes sources » et la dernière phrase changent) :

```ts
export const PERSONA = `Tu es Ledge, le compagnon qui veille sur les sessions d'agents (Claude Code, Codex, Cursor Agent) de l'utilisateur. Tu lis, tu ne touches à rien : pas de commande, pas d'écriture, jamais d'instruction envoyée à une session.
Tes sources : le dossier courant contient sessions.md (toutes les sessions, leur état et le nom de leurs fichiers), pane-<id>.txt (les dernières lignes du terminal d'une session), reply-<id>.md (sa dernière réponse), git-<id>.txt (status, log et diff --stat de son dossier) et folders.md (les dossiers récents où l'utilisateur a lancé des sessions). Les dépôts eux-mêmes sont lisibles (Read, Grep, Glob) pour aller plus loin.
Commence toujours par lire sessions.md. Ne lis que ce que la question demande.
Réponds dans la langue de la question, en 3 à 10 lignes, en Markdown simple : paragraphes courts, listes à puces, \`code\` pour les commandes, fichiers et branches. Nomme chaque bot par son prénom en gras (**Nova**) la première fois. Dis d'où vient chaque fait et de quand il date quand cela compte. Si une information manque, dis-le au lieu de supposer. Tu n'agis jamais toi-même ; tu peux lui dire quel bot ouvrir. Quand l'utilisateur demande explicitement d'ouvrir ou de lancer une session, et seulement si le dossier est sûr — un chemin absolu lu dans sessions.md ou folders.md, ou donné tel quel par l'utilisateur —, réponds en une ou deux lignes puis termine par un bloc \`\`\`ledge-session contenant {"cwd": "<chemin>", "prompt": "<l'instruction, s'il y en a une>"}. Si plusieurs dossiers conviennent ou aucun, ne mets pas de bloc : cite les candidats et demande lequel.`;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter ledge exec vitest run test/chat-context.test.ts test/chat-claude.test.ts test/chat-codex.test.ts test/chat-cursor.test.ts`
Expected: PASS (si un des fichiers `chat-codex`/`chat-cursor` n'existe pas, l'enlever de la commande ; s'ils comparent le persona à un littéral, ils doivent importer `PERSONA`, pas le recopier).

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/chat/context.ts packages/ledge/src/chat/claude.ts packages/ledge/test/chat-context.test.ts packages/ledge/test/chat-claude.test.ts
git commit -m "feat(chat): Ledge reads the recent folders and may end with a session proposal"
```

---

### Task 4: Daemon — la proposition dans le tour

**Files:**
- Modify: `packages/ledge/src/chat/service.ts`
- Modify: `packages/ledge/test/fake-claude.mjs`
- Modify: `packages/ledge/src/daemon/server.ts:74` (passer `userHome`)
- Test: `packages/ledge/test/chat-service.test.ts`

**Interfaces:**
- Consumes: `extractProposal`, `parseProposalBlock`, `type ChatProposal` (Tasks 1-2) ; `resolveFolder(input, home?)` de `../daemon/folders.js` ; `ContextInput.recents` (Task 3).
- Produces (sur `Chat`) :
  - `proposal(qid: string): ChatProposal | undefined`
  - `markLaunched(qid: string, id: string, emit: (m: ChatMessage) => void): void` — pose `launchedId`, retire `error`, émet `chat.history`.
  - `markFailed(qid: string, message: string, emit: (m: ChatMessage) => void): void` — pose `error`, émet `chat.history`.
  - Les deux ne font rien (et n'émettent rien) si le tour ou sa proposition n'existe pas.
  - `ChatDeps.userHome?: string` — la maison où `~` se résout (celle de `resolveFolder` dans le serveur) ; défaut `os.homedir()`.

- [ ] **Step 1: Extend the fake harness** — dans `packages/ledge/test/fake-claude.mjs`, branche Claude (le `else` final) : remplacer la ligne `say({ type: 'result', … })` par

```js
  // FAKE_ANSWER replaces the final text (a proposal block, say); `folders` answers with the folders.md Ledge was given.
  const answer = mode === 'folders' ? readFileSync(process.cwd() + '/folders.md', 'utf8') : env.FAKE_ANSWER ?? 'Deux compagnons travaillent. Question : ' + q.trim();
  say({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: sid });
```

et ajouter en tête `import { readFileSync } from 'node:fs';`.

- [ ] **Step 2: Write the failing tests** — dans `packages/ledge/test/chat-service.test.ts`, après les tests qui utilisent `setup()` (ajouter `mkdirSync` à l'import `node:fs` et `basename` via `import { basename, join } from 'node:path';`) :

```ts
  const fence = (json: string) => 'Je te propose cette session.\n\n```ledge-session\n' + json + '\n```';

  it('gives Ledge the recent folders in folders.md', async () => {
    const { chat, store } = setup({ env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'folders' }) });
    store.touchRecent('/w/ledge', 'ledge', '2026-10-11T09:00:00.000Z');
    await chat.ask('q1', 'x', () => {});
    expect(chat.history()[0]!.answer).toContain('- ledge: /w/ledge');
  });

  it('a valid block becomes the turn proposal, joined to chat.done, and leaves the text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(`{"cwd": "${dir}/", "prompt": " Corrige le build "}`) }) });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'ouvre une session pour corriger le build', m => out.push(m));
    const proposal = { cwd: dir, project: basename(dir), tool: 'claude', prompt: 'Corrige le build' };
    expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je te propose cette session.', at: expect.any(String), proposal });
    expect(chat.history()[0]).toMatchObject({ answer: 'Je te propose cette session.', proposal });
    expect(chat.proposal('q1')).toEqual(proposal);
  });

  it('a ~ path resolves against the user home, a blank prompt means an empty session', async () => {
    const userHome = mkdtempSync(join(tmpdir(), 'home-')); mkdirSync(join(userHome, 'ledge'));
    const { chat } = setup({ userHome, env: async () => ({ ...process.env, FAKE_ANSWER: fence('{"cwd": "~/ledge/", "prompt": "   "}') }) });
    await chat.ask('q1', 'x', () => {});
    expect(chat.proposal('q1')).toEqual({ cwd: join(userHome, 'ledge'), project: 'ledge', tool: 'claude' });
  });

  it('no card for a missing folder, a file, or a bad block; the text is shown without the block', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'f-')), 'a.txt'); writeFileSync(file, 'x');
    for (const json of ['{"cwd": "/nope/ledge-missing"}', `{"cwd": "${file}"}`, '{"cwd":', '{"prompt": "x"}']) {
      const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(json) }) });
      const out: ServerMessage[] = [];
      await chat.ask('q1', 'x', m => out.push(m));
      const done = out.find(m => m.type === 'chat.done');
      expect(done).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je te propose cette session.', at: expect.any(String) });
      expect(chat.proposal('q1')).toBeUndefined();
    }
  });

  it('markLaunched and markFailed update the proposal and tell every client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(`{"cwd": "${dir}"}`) }) });
    await chat.ask('q1', 'x', () => {});
    const out: ServerMessage[] = [];
    chat.markFailed('q1', 'no such folder: /w', m => out.push(m));
    expect(out.at(-1)).toMatchObject({ type: 'chat.history', turns: [{ qid: 'q1', proposal: { cwd: dir, error: 'no such folder: /w' } }] });
    chat.markLaunched('q1', 'n1', m => out.push(m));
    expect(chat.proposal('q1')).toEqual({ cwd: dir, project: basename(dir), tool: 'claude', launchedId: 'n1' });
    expect(out).toHaveLength(2);
    chat.markLaunched('nope', 'n2', m => out.push(m)); chat.markFailed('nope', 'x', m => out.push(m));
    expect(out).toHaveLength(2);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter ledge exec vitest run test/chat-service.test.ts`
Expected: FAIL — `chat.proposal is not a function`, `folders.md` absent, le texte garde le bloc.

- [ ] **Step 4: Implement** — dans `packages/ledge/src/chat/service.ts` :

Imports :

```ts
import { basename, dirname, join } from 'node:path';
import { extractProposal, parseProposalBlock, type ChatProposal, type ChatTurn, type ServerMessage, type Session, type Tool } from '@ledge/protocol';
import { resolveFolder } from '../daemon/folders.js';
```

(`ChatTurn`, `ServerMessage`, `Session`, `Tool` passent de l'import `type` actuel à cet import mixte ; supprimer l'ancien.)

Interface et deps :

```ts
export interface Chat {
  ask(qid: string, text: string, emit: (m: ChatMessage) => void, tool?: Tool): Promise<void>; cancel(qid: string): void; reset(emit: (m: ChatMessage) => void): Promise<void>; history(): ChatTurn[];
  /** The turn's session proposal (spec 2026-10-12 §4), if the turn is still in the day's history. */
  proposal(qid: string): ChatProposal | undefined;
  /** The card's launch went through (`launchedId`) or failed (`error`); every client gets the new history. */
  markLaunched(qid: string, id: string, emit: (m: ChatMessage) => void): void; markFailed(qid: string, message: string, emit: (m: ChatMessage) => void): void;
}
```

Dans `ChatDeps`, après `home: string;` : `/** Where a proposal's `~` resolves (the user's home, as for session.launch). */ userHome?: string;`

Dans `run()`, `writeContext(contextDir, { sessions: deps.store.all(), recents: deps.store.recents(), now: now(), capture, git: … })`.

Remplacer les deux lignes de fin de `run()` (`turn.answer = answer; …` et `emit({ type: 'chat.done', … })`) par :

```ts
    // The proposal block never reaches the reader: the card stands for it (spec 2026-10-12 §3-4).
    const { text, raw } = extractProposal(answer);
    const proposal = raw === null ? undefined : await proposalFrom(raw, tool, turn.qid);
    turn.answer = text; turn.answeredAt = now();
    if (proposal) turn.proposal = proposal;
    emit({ type: 'chat.done', qid: turn.qid, text, at: turn.answeredAt, ...(proposal ? { proposal } : {}) });
    return { ok: true };
```

Ajouter, dans `createChat`, avant `attempt` :

```ts
  /** A block as a card: its folder must exist now; a bad block or a missing folder gives no card and a log line. */
  async function proposalFrom(raw: string, tool: Tool, qid: string): Promise<ChatProposal | undefined> {
    const block = parseProposalBlock(raw);
    if (!block) { log(`chat ${qid}: proposal ignored, invalid block: ${raw.slice(0, 200)}`); return undefined; }
    try {
      const cwd = await resolveFolder(block.cwd, deps.userHome);
      const prompt = block.prompt?.trim();
      return { cwd, project: basename(cwd), tool, ...(prompt ? { prompt } : {}) };
    } catch (e) { log(`chat ${qid}: proposal ignored: ${(e as Error).message}`); return undefined; }
  }
  const turnOf = (qid: string) => turns.find(t => t.qid === qid);
```

Et dans l'objet renvoyé, après `history: () => turns,` :

```ts
    proposal: qid => turnOf(qid)?.proposal,
    markLaunched(qid, id, emit) {
      const t = turnOf(qid); if (!t?.proposal) return;
      const { error: _cleared, ...rest } = t.proposal; t.proposal = { ...rest, launchedId: id };
      emit({ type: 'chat.history', turns });
    },
    markFailed(qid, message, emit) {
      const t = turnOf(qid); if (!t?.proposal) return;
      t.proposal = { ...t.proposal, error: message };
      emit({ type: 'chat.history', turns });
    },
```

(Si le lint refuse `_cleared`, utiliser `const next = { ...t.proposal, launchedId: id }; delete next.error; t.proposal = next;`.)

Dans `packages/ledge/src/daemon/server.ts:74`, passer la maison de l'utilisateur :

```ts
  const chat = opts.chat ?? createChat({ store, tmux, home: paths().dir, userHome: opts.home, env: agentEnv, bin: opts.claudeBin, now });
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter ledge test`
Expected: PASS (les tests existants aussi : sans `FAKE_ANSWER`, la réponse reste `Deux compagnons travaillent. Question : …`).

- [ ] **Step 6: Commit**

```bash
git add packages/ledge/src/chat/service.ts packages/ledge/src/daemon/server.ts packages/ledge/test/fake-claude.mjs packages/ledge/test/chat-service.test.ts
git commit -m "feat(chat): an answer's ledge-session block becomes the turn's proposal"
```

---

### Task 5: Daemon — `session.launch` depuis une carte

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts:213-223`
- Test: `packages/ledge/test/server.test.ts` (nouveau `describe('launch from a chat card')` à côté de `describe('launch from the overlay')`)

**Interfaces:**
- Consumes: `Chat.proposal`, `Chat.markLaunched`, `Chat.markFailed` (Task 4) ; `session.launch.qid` (Task 1).
- Produces: sur `session.launch { qid }` : `error { message: 'unknown proposal' }` si le tour n'a pas de proposition ; `error { message: 'already launched' }` si elle a un `launchedId` ou si un lancement de ce `qid` est en cours ; sinon lancement avec `tool`, `cwd`, `prompt` de la proposition, `session.launched { id }` au demandeur puis `markLaunched(qid, id, broadcast)` ; en cas d'échec `markFailed(qid, message, broadcast)` puis `error { message }` au demandeur (sans `id`).

- [ ] **Step 1: Write the failing tests** — dans `packages/ledge/test/server.test.ts`, importer `type Chat` (`import type { Chat } from '../src/chat/service.js';`) et `type ChatProposal` depuis `@ledge/protocol`, puis :

```ts
describe('launch from a chat card', () => {
  const home = () => process.env.LEDGE_HOME!;
  /** A chat holding one proposal for `q1`; the marks are recorded and broadcast as a history, like the real one. */
  function stubChat(initial: ChatProposal | undefined) {
    let proposal = initial; const marks: string[][] = [];
    const chat: Chat = {
      async ask() {}, cancel() {}, async reset() {}, history: () => [],
      proposal: qid => (qid === 'q1' ? proposal : undefined),
      markLaunched(qid, id, emit) { marks.push(['launched', qid, id]); proposal = { ...proposal!, launchedId: id }; emit({ type: 'chat.history', turns: [] }); },
      markFailed(qid, message, emit) { marks.push(['failed', qid, message]); proposal = { ...proposal!, error: message }; emit({ type: 'chat.history', turns: [] }); }
    };
    return { chat, marks };
  }
  const start = (chat: Chat) => startServer({ store, tmux, port: 0, home: home(), chat, agentEnv: async () => ({ ...process.env, PATH: '/login/bin:/usr/bin' }) });

  it('launches the proposal\'s own fields, marks the turn for everyone, and refuses a second launch, even a simultaneous one', async () => {
    mkdirSync(join(home(), 'ledge'));
    const { chat, marks } = stubChat({ cwd: join(home(), 'ledge'), project: 'ledge', tool: 'claude', prompt: 'Corrige le build' });
    const srv2 = await start(chat);
    const c = await connect({ port: srv2.port }); await c.next('snapshot'); await c.next('chat.history');
    const other = await connect({ port: srv2.port }); await other.next('snapshot'); await other.next('chat.history');
    // The message's fields are ignored: only the qid names the card.
    c.send({ type: 'session.launch', tool: 'codex', cwd: '/elsewhere', prompt: 'autre chose', qid: 'q1' });
    c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'ledge'), qid: 'q1' });
    const launched = await c.next('session.launched');
    expect(await c.next('error')).toEqual({ type: 'error', message: 'already launched' });
    expect(tmux.created).toHaveLength(1);
    expect(tmux.created[0]!.cwd).toBe(join(home(), 'ledge'));
    expect(JSON.stringify(tmux.created[0]!.command)).toContain('Corrige le build');
    expect(JSON.stringify(tmux.created[0]!.command)).not.toContain('autre chose');
    expect(store.get(launched.id)).toMatchObject({ tool: 'claude', project: 'ledge', source: 'launcher' });
    expect(marks).toEqual([['launched', 'q1', launched.id]]);
    await other.next('chat.history');
    c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'ledge'), qid: 'q1' });
    expect(await c.next('error')).toEqual({ type: 'error', message: 'already launched' });
    expect(tmux.created).toHaveLength(1);
    c.close(); other.close(); await srv2.close();
  });

  it('refuses an unknown proposal without spawning', async () => {
    const srv2 = await start(stubChat(undefined).chat);
    const c = await connect({ port: srv2.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'claude', cwd: '/w', qid: 'q1' });
    expect(await c.next('error')).toEqual({ type: 'error', message: 'unknown proposal' });
    expect(tmux.created).toHaveLength(0);
    c.close(); await srv2.close();
  });

  it('marks a failed launch, then lets the card retry', async () => {
    const { chat, marks } = stubChat({ cwd: join(home(), 'gone'), project: 'gone', tool: 'claude' });
    const srv2 = await start(chat);
    const c = await connect({ port: srv2.port }); await c.next('snapshot');
    c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'gone'), qid: 'q1' });
    expect(await c.next('error')).toEqual({ type: 'error', message: `no such folder: ${join(home(), 'gone')}` });
    expect(marks).toEqual([['failed', 'q1', `no such folder: ${join(home(), 'gone')}`]]);
    mkdirSync(join(home(), 'gone'));
    c.send({ type: 'session.launch', tool: 'claude', cwd: join(home(), 'gone'), qid: 'q1' });
    const launched = await c.next('session.launched');
    expect(marks.at(-1)).toEqual(['launched', 'q1', launched.id]);
    c.close(); await srv2.close();
  });
});
```

(Le `connect` de `../src/client.js` reçoit tout : `c.next('chat.history')` attend la première `chat.history` envoyée après le snapshot. Si `next` ignore les messages non attendus au lieu de les mettre en file, retirer les `await …next('chat.history')` après connexion.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter ledge exec vitest run test/server.test.ts -t "chat card"`
Expected: FAIL — la session est lancée dans `/elsewhere` (inexistant → `error no such folder`), aucun `already launched`.

- [ ] **Step 3: Implement** — dans `startServer`, à côté des autres états (`previews`, `titles`) :

```ts
  /** The chat cards being launched: a second click, or another overlay, is refused until the first one has answered. */
  const chatLaunches = new Set<string>();
  /** Spawns the agent as `ledge <tool>` would and records it; throws the reason (bad folder, tmux). */
  async function launch(req: { tool: Tool; cwd: string; name?: string; prompt?: string; continue?: boolean }): Promise<Session> {
    const cwd = await resolveFolder(req.cwd, opts.home);
    const live = store.all();
    const env = await agentEnv();
    const session = await spawnSession({ tool: req.tool, args: launchArgs(req), name: req.name, cwd, tmux, now, env, taken: { names: live.filter(s => s.state !== 'exited').map(s => s.name), ids: live.map(s => s.id) } });
    store.upsert(session);
    store.touchRecent(session.cwd, session.project, session.startedAt);
    log(`launched ${session.name} (${session.tool}) in ${session.cwd} as ${session.id}`);
    return session;
  }
```

(À placer là où `agentEnv`, `tmux`, `now` sont déjà définis — juste avant `handle`. Le corps est celui de l'ancien `case`, déplacé.)

Le `case` devient :

```ts
      case 'session.launch': {
        // Any failure (bad folder, tmux) reaches the requester as an `error` without id, through the caller's catch.
        if (msg.qid === undefined) return send(ws, { type: 'session.launched', id: (await launch(msg)).id });
        // A chat card (spec 2026-10-12 §4): the proposal's own fields, never the message's.
        const qid = msg.qid; const p = chat.proposal(qid);
        if (!p) return send(ws, { type: 'error', message: 'unknown proposal' });
        if (p.launchedId || chatLaunches.has(qid)) return send(ws, { type: 'error', message: 'already launched' });
        chatLaunches.add(qid);
        try {
          const session = await launch({ tool: p.tool, cwd: p.cwd, prompt: p.prompt });
          send(ws, { type: 'session.launched', id: session.id });
          chat.markLaunched(qid, session.id, broadcast);
        } catch (e) { chat.markFailed(qid, (e as Error).message, broadcast); throw e; }
        finally { chatLaunches.delete(qid); }
        return;
      }
```

`Tool` et `Session` sont déjà importés en `type` depuis `@ledge/protocol` (ligne 4).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter ledge test && pnpm typecheck`
Expected: PASS, y compris `describe('launch from the overlay')` inchangé.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/daemon/server.ts packages/ledge/test/server.test.ts
git commit -m "feat(daemon): session.launch with a qid starts the chat card's proposal once"
```

---

### Task 6: Overlay — la carte dans le chat

**Files:**
- Modify: `apps/overlay/src/daemon/store.ts:40` (`chat.done`)
- Create: `apps/overlay/src/surface/openTabPreference.ts`
- Modify: `apps/overlay/src/surface/LaunchView.tsx:22-24`
- Create: `apps/overlay/src/surface/LaunchCard.tsx`
- Modify: `apps/overlay/src/surface/ChatView.tsx`
- Modify: `apps/overlay/src/i18n/messages.ts` (blocs `chat` FR et EN)
- Test: `apps/overlay/test/chat.test.tsx`, `apps/overlay/test/daemon.test.ts`

**Interfaces:**
- Consumes: `ChatProposal`, `hideProposal` (Tasks 1-2) ; `toolName(t: Tool)` de `../format` ; `Button`, `Icon`, `ICONS.rocket`.
- Produces:
  - `loadOpenTab(): boolean` / `saveOpenTab(on: boolean): void` (clé `ledge.launch.openTab`, défaut `true`).
  - `LaunchCard(props: { proposal: ChatProposal; session?: Session; busy: boolean; disabled: boolean; onLaunch: () => void; onOpenSession: (id: string) => void; onTerminal: (id: string) => void })`.
  - `ChatViewProps` gagne `launchingQid?: string | null; onLaunchProposal?: (qid: string) => void; onTerminal?: (id: string) => void`.
  - `t.chat.card` (FR et EN) : `label, folder, tool, byDefault(tool), prompt, noPrompt, launch, launching, retry, orRephrase, orFolder, failed(why), started, startedUnknown, terminal`.

- [ ] **Step 1: Write the failing tests**

Dans `apps/overlay/test/chat.test.tsx`, dans `describe('<ChatView>')` :

```ts
  const proposal = { cwd: '/home/u/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the overlay build' };
  const answered = (p: ChatTurn['proposal']): ChatTurn[] => [{ qid: 'q1', question: 'open a session in ledge', askedAt: T0, steps: [], answer: 'Here is the session I would start.', answeredAt: T0, proposal: p }];
  it('shows a proposal card under the answer; Launch names the turn', () => {
    const onLaunchProposal = vi.fn();
    render(<ChatView {...base} turns={answered(proposal)} live={null} onLaunchProposal={onLaunchProposal} />);
    const card = screen.getByRole('region', { name: 'Proposed session' });
    expect(card).toHaveTextContent('ledge'); expect(card).toHaveTextContent('/home/u/ledge');
    expect(card).toHaveTextContent('Claude Code · default'); expect(card).toHaveTextContent('Fix the overlay build');
    fireEvent.click(within(card).getByRole('button', { name: /Start the session/ }));
    expect(onLaunchProposal).toHaveBeenCalledWith('q1');
  });
  it('a card without instruction says so; Launch is disabled while launching or offline', () => {
    const { rerender } = render(<ChatView {...base} turns={answered({ ...proposal, prompt: undefined })} live={null} launchingQid="q1" />);
    const card = () => screen.getByRole('region', { name: 'Proposed session' });
    expect(card()).toHaveTextContent('None, empty session');
    expect(within(card()).getByRole('button', { name: /Starting…/ })).toBeDisabled();
    rerender(<ChatView {...base} turns={answered(proposal)} live={null} offline="Ledge is unreachable" />);
    expect(within(card()).getByRole('button', { name: /Start the session/ })).toBeDisabled();
  });
  it('a launched card names the companion as a link and offers its terminal', () => {
    const onOpenSession = vi.fn(), onTerminal = vi.fn();
    render(<ChatView {...base} turns={answered({ ...proposal, launchedId: 'a' })} live={null} onOpenSession={onOpenSession} onTerminal={onTerminal} />);
    const card = screen.getByRole('region', { name: 'Proposed session' });
    expect(card).toHaveTextContent('Nova has started');
    expect(within(card).queryByRole('button', { name: /Start the session/ })).toBeNull();
    fireEvent.click(within(card).getByRole('link', { name: 'Nova' })); expect(onOpenSession).toHaveBeenCalledWith('a');
    fireEvent.click(within(card).getByRole('button', { name: 'Terminal' })); expect(onTerminal).toHaveBeenCalledWith('a');
  });
  it('a failed card shows the reason and offers a retry', () => {
    const onLaunchProposal = vi.fn();
    render(<ChatView {...base} turns={answered({ ...proposal, error: 'no such folder: /home/u/ledge' })} live={null} onLaunchProposal={onLaunchProposal} />);
    const card = screen.getByRole('region', { name: 'Proposed session' });
    expect(within(card).getByRole('alert')).toHaveTextContent('Could not start: no such folder: /home/u/ledge');
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' })); expect(onLaunchProposal).toHaveBeenCalledWith('q1');
  });
  it('never shows the proposal block while the answer streams', () => {
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [{ kind: 'sessions' }] }];
    const { rerender } = render(<ChatView {...base} turns={turns} live={{ qid: 'q1', text: 'I would start it.\n``' }} />);
    expect(screen.queryByText(/``/)).toBeNull();
    rerender(<ChatView {...base} turns={turns} live={{ qid: 'q1', text: 'I would start it.\n```ledge-session\n{"cwd": "/home' }} />);
    expect(screen.getByText('I would start it.')).toBeInTheDocument();
    expect(screen.queryByText(/cwd/)).toBeNull(); expect(screen.queryByText(/ledge-session/)).toBeNull();
  });
```

Dans `apps/overlay/test/daemon.test.ts`, à côté des tests du store sur le chat (chercher `chat.done`) :

```ts
  it('keeps the proposal a chat.done carries', () => {
    daemonStore.reset();
    daemonStore.beginTurn({ qid: 'q1', question: 'x', askedAt: '2026-10-12T10:00:00.000Z', steps: [] });
    const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const };
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'ok', at: '2026-10-12T10:00:05.000Z', proposal });
    expect(daemonStore.getState().chat[0]).toMatchObject({ answer: 'ok', proposal });
  });
```

(Adapter `daemonStore.getState()` au nom de l'accesseur réel du store, visible dans les tests voisins de `daemon.test.ts`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter overlay exec vitest run test/chat.test.tsx test/daemon.test.ts`
Expected: FAIL — pas de région « Proposed session », `` `` `` visible, `proposal` perdu par le store.

- [ ] **Step 3: Implement**

`apps/overlay/src/daemon/store.ts:40` :

```ts
        : m.type === 'chat.done' ? { ...t, answer: m.text, answeredAt: m.at, ...(m.proposal ? { proposal: m.proposal } : {}) }
```

`apps/overlay/src/surface/openTabPreference.ts` :

```ts
/** The launch form's "Open the terminal tab" switch, remembered; the chat card follows it too (spec 2026-10-12 §6). */
const OPEN_TAB_KEY = 'ledge.launch.openTab';
export const loadOpenTab = () => { try { return localStorage.getItem(OPEN_TAB_KEY) !== '0'; } catch { return true; } };
export const saveOpenTab = (on: boolean) => { try { localStorage.setItem(OPEN_TAB_KEY, on ? '1' : '0'); } catch { /* in-memory only */ } };
```

Dans `LaunchView.tsx`, supprimer les lignes 22-24 et ajouter `import { loadOpenTab, saveOpenTab } from './openTabPreference';`.

`i18n/messages.ts`, dans `chat` FR (après `stopped`) :

```ts
    card: {
      label: 'Session proposée', folder: 'Dossier', tool: 'Harnais', byDefault: (tool: string) => `${tool} · par défaut`, prompt: 'Instruction', noPrompt: 'Aucune, session vide',
      launch: 'Lancer la session', launching: 'Lancement…', retry: 'Réessayer', orRephrase: 'ou reformule ta demande', orFolder: 'ou donne-moi un autre dossier',
      failed: (why: string) => `Échec du lancement : ${why}`, started: 'a démarré', startedUnknown: 'Session démarrée', terminal: 'Terminal'
    },
```

et EN :

```ts
    card: {
      label: 'Proposed session', folder: 'Folder', tool: 'Harness', byDefault: (tool: string) => `${tool} · default`, prompt: 'Instruction', noPrompt: 'None, empty session',
      launch: 'Start the session', launching: 'Starting…', retry: 'Retry', orRephrase: 'or rephrase your request', orFolder: 'or give me another folder',
      failed: (why: string) => `Could not start: ${why}`, started: 'has started', startedUnknown: 'Session started', terminal: 'Terminal'
    },
```

`apps/overlay/src/surface/LaunchCard.tsx` (états et textes de la maquette `docs/mockups/ledge-launch-from-chat.html`, états 01, 03, 04) :

```tsx
import type { ChatProposal, Session } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { toolName } from '../format';
import { useI18n } from '../i18n/lang';

export interface LaunchCardProps {
  proposal: ChatProposal;
  /** The launched session, once `launchedId` names one the overlay knows. */
  session?: Session;
  busy: boolean; disabled: boolean;
  onLaunch: () => void; onOpenSession: (id: string) => void; onTerminal: (id: string) => void;
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11.5, color: 'var(--muted-foreground)', overflowWrap: 'anywhere' };

/** The session the chat proposes (spec 2026-10-12 §6): proposed, launched, or failed with a retry. Launching is the user's click. */
export function LaunchCard(p: LaunchCardProps) {
  const { t } = useI18n(); const c = t.chat.card; const pr = p.proposal;
  const state = pr.launchedId !== undefined ? 'launched' : pr.error !== undefined ? 'failed' : 'proposed';
  return (
    <section data-launch-card={state} aria-label={c.label} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      {state === 'launched' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {p.session ? <><a href={`ledge://session/${pr.launchedId}`} onClick={e => { e.preventDefault(); p.onOpenSession(pr.launchedId!); }} style={{ fontWeight: 600, color: 'inherit' }}>{p.session.name}</a> {c.started}</> : c.startedUnknown}
          </span>
          <Button variant="outline" size="sm" onClick={() => p.onTerminal(pr.launchedId!)} style={{ height: 26, padding: '0 10px', fontSize: 12 }}>{c.terminal}</Button>
        </div>
      ) : (
        <>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', padding: '10px 12px' }}>
            <dt style={muted}>{c.folder}</dt><dd style={{ margin: 0, minWidth: 0 }}><strong>{pr.project}</strong> <span style={mono}>{pr.cwd}</span></dd>
            <dt style={muted}>{c.tool}</dt><dd style={{ margin: 0 }}>{c.byDefault(toolName(pr.tool))}</dd>
            <dt style={muted}>{c.prompt}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{pr.prompt ?? <span style={muted}>{c.noPrompt}</span>}</dd>
          </dl>
          {state === 'failed' && <div role="alert" style={{ padding: '6px 12px', color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 12%, transparent)' }}>{c.failed(pr.error!)}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
            <Button variant="primary" size="sm" disabled={p.busy || p.disabled} onClick={p.onLaunch} style={{ height: 28, padding: '0 10px', gap: 6, fontSize: 12 }}>
              {state === 'proposed' && <Icon size={12} {...ICONS.rocket} />}{p.busy ? c.launching : state === 'failed' ? c.retry : c.launch}
            </Button>
            <span style={{ ...muted, fontSize: 12 }}>{state === 'failed' ? c.orFolder : c.orRephrase}</span>
          </div>
        </>
      )}
    </section>
  );
}
```

`ChatView.tsx` :
- imports : `import { hideProposal } from '@ledge/protocol';` (avec les types existants) et `import { LaunchCard } from './LaunchCard';` ;
- `ChatViewProps` : après `onDocument?` ajouter
  ```ts
  /** The chat card being launched (its turn's qid) and the card's actions (spec 2026-10-12 §6). */
  launchingQid?: string | null; onLaunchProposal?: (qid: string) => void; onTerminal?: (id: string) => void;
  ```
- remplacer la ligne qui rend `<Answer text={turn.answer || live!.text} … />` par :
  ```tsx
                    {(() => {
                      // While it streams, a proposal block (closed or not) is held back: the card shows it once the turn is done.
                      const text = turn.answer || (turn.answeredAt === undefined && live?.qid === turn.qid ? hideProposal(live.text) : '');
                      return text && <Answer text={text} sessions={p.sessions} onOpen={p.onOpenSession} onDocument={p.onDocument} />;
                    })()}
                    {turn.answeredAt !== undefined && turn.proposal && (
                      <LaunchCard proposal={turn.proposal} session={p.sessions.find(s => s.id === turn.proposal!.launchedId)} busy={p.launchingQid === turn.qid}
                        disabled={!!p.offline || (!!p.launchingQid && p.launchingQid !== turn.qid)}
                        onLaunch={() => p.onLaunchProposal?.(turn.qid)} onOpenSession={p.onOpenSession} onTerminal={id => p.onTerminal?.(id)} />
                    )}
  ```
  (La carte est entre la réponse et le bloc `data-sources`, comme dans la maquette.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter overlay test && pnpm typecheck`
Expected: PASS (y compris `launch.test.tsx` après le déplacement de `loadOpenTab`, et `i18n.test.tsx` qui vérifie que FR et EN ont les mêmes clés).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/daemon/store.ts apps/overlay/src/surface/openTabPreference.ts apps/overlay/src/surface/LaunchView.tsx apps/overlay/src/surface/LaunchCard.tsx apps/overlay/src/surface/ChatView.tsx apps/overlay/src/i18n/messages.ts apps/overlay/test/chat.test.tsx apps/overlay/test/daemon.test.ts
git commit -m "feat(overlay): the chat shows a session card to start"
```

---

### Task 7: Overlay — lancer depuis la carte, et l'aide

**Files:**
- Modify: `apps/overlay/src/surface/Surface.tsx:364-398` (états et effets du lancement), `:519` (après `focusTab`), `:591` (`<ChatView …>`)
- Modify: `apps/overlay/src/surface/HelpView.tsx`, `apps/overlay/src/i18n/messages.ts` (`help.chat` FR et EN)
- Test: `apps/overlay/test/launch-from-chat.test.tsx` (nouveau)

**Interfaces:**
- Consumes: `loadOpenTab` (Task 6) ; `ChatViewProps.launchingQid / onLaunchProposal / onTerminal` (Task 6) ; `session.launch.qid` (Task 1).
- Produces: `Surface` envoie `{ type: 'session.launch', tool, cwd, prompt?, qid }` avec les champs de la proposition ; reste en mode `chat` ; sur `session.launched` d'un lancement de carte, ouvre l'onglet si `loadOpenTab()` ; un `error` sans id ou une perte de connexion libère le bouton ; un lancement de carte et un lancement du formulaire s'excluent.

- [ ] **Step 1: Write the failing test** — `apps/overlay/test/launch-from-chat.test.tsx` (même harnais que `final-review.test.tsx`) :

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { ChatProposal, ClientMessage, Session } from '@ledge/protocol';
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
const proposal: ChatProposal = { cwd: '/home/u/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix the build' };
const juno: Session = fakeSession('n1', { name: 'Juno', project: 'ledge', cwd: '/home/u/ledge', title: 'Juno · ledge', state: 'starting' });

/** Opens the list, asks Ledge, and answers the turn with a proposal: the chat shows its card. */
function askAndPropose(): string {
  render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a')] }); });
  act(() => { fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); });
  act(() => { vi.advanceTimersByTime(400); });
  const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
  fireEvent.change(input, { target: { value: 'open a session in ledge to fix the build' } }); fireEvent.keyDown(input, { key: 'Enter' });
  const ask = sent.find(m => m.type === 'chat.ask') as Extract<ClientMessage, { type: 'chat.ask' }>;
  apply({ type: 'chat.done', qid: ask.qid, text: 'Here is the session I would start.', at: new Date().toISOString(), proposal });
  return ask.qid;
}
const card = () => screen.getByRole('region', { name: 'Proposed session' });

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent = []; localStorage.clear(); bridge.focusTerminal.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('launching from a chat card', () => {
  it('sends the proposal with its qid, stays in the chat, and opens the terminal tab by default', () => {
    const qid = askAndPropose();
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    expect(sent.filter(m => m.type === 'session.launch')).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/home/u/ledge', prompt: 'Fix the build', qid }]);
    expect(within(card()).getByRole('button', { name: /Starting…/ })).toBeDisabled();
    fireEvent.click(within(card()).getByRole('button', { name: /Starting…/ }));
    expect(sent.filter(m => m.type === 'session.launch')).toHaveLength(1);
    apply({ type: 'session.updated', session: juno }); apply({ type: 'session.launched', id: 'n1' });
    expect(mode()).toBe('chat');
    expect(bridge.focusTerminal).toHaveBeenCalledWith('Juno · ledge');
  });
  it('does not open the tab when the form\'s switch is off', () => {
    localStorage.setItem('ledge.launch.openTab', '0');
    askAndPropose();
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    apply({ type: 'session.updated', session: juno }); apply({ type: 'session.launched', id: 'n1' });
    expect(bridge.focusTerminal).not.toHaveBeenCalled();
  });
  it('a refused launch frees the button; a lost connection does too', () => {
    askAndPropose();
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    apply({ type: 'error', message: 'no such folder: /home/u/ledge' });
    expect(within(card()).getByRole('button', { name: /Start the session/ })).toBeEnabled();
    fireEvent.click(within(card()).getByRole('button', { name: /Start the session/ }));
    act(() => { daemonStore.setStatus('unreachable'); });
    act(() => { daemonStore.setStatus('open'); });
    expect(within(card()).getByRole('button', { name: /Start the session/ })).toBeEnabled();
  });
});
```

(Si `Ctrl Alt L` n'ouvre pas la liste dans ce harnais, reprendre l'ouverture utilisée par `final-review.test.tsx` — `shortcut()` puis `tick(…)` — et les durées qu'il utilise.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter overlay exec vitest run test/launch-from-chat.test.tsx`
Expected: FAIL — le clic sur « Start the session » n'envoie rien (`onLaunchProposal` non branché).

- [ ] **Step 3: Implement** — dans `Surface.tsx` :

Import : `import { loadOpenTab } from './openTabPreference';`.

Après `const [launchFailure, setLaunchFailure] = …` :

```ts
  // A chat card's launch (spec 2026-10-12 §6): the turn's qid while the daemon answers. The card's own state
  // (launched, failed) comes back with chat.history; the chat stays open.
  const [chatLaunching, setChatLaunching] = useState<string | null>(null);
```

Dans `launch` (le formulaire), la garde devient `if (launching || chatLaunching || status === 'unreachable') return;`.

Après le `useEffect` du statut `unreachable` existant :

```ts
  const launchProposal = (qid: string) => {
    const p = chat.find(x => x.qid === qid)?.proposal;
    if (!p || p.launchedId || launching || chatLaunching || status === 'unreachable') return;
    setChatLaunching(qid);
    send({ type: 'session.launch', tool: p.tool, cwd: p.cwd, ...(p.prompt ? { prompt: p.prompt } : {}), qid });
  };
  useEffect(() => {
    if (!lastLaunched || !chatLaunching) return;
    setChatLaunching(null);
    if (loadOpenTab()) openTab(lastLaunched.id);
  }, [lastLaunched?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (chatLaunching && lastError && !lastError.id) setChatLaunching(null); }, [lastError?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (status === 'unreachable' && chatLaunching) setChatLaunching(null); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
```

L'effet `lastLaunched` du formulaire garde son `if (!lastLaunched || !launching) return;` : comme les deux lancements s'excluent, chaque réponse n'a qu'un destinataire.

Sur `<ChatView …>` (ligne ~591), ajouter : `launchingQid={chatLaunching} onLaunchProposal={launchProposal} onTerminal={focusTab}`. `focusTab` est défini plus haut (ligne ~519) ; `launchProposal` doit être défini avant `content` — le placer comme indiqué ci-dessus suffit.

Aide — `messages.ts`, bloc `help` FR : `chat: 'Au chat, « ouvre une session dans ledge pour corriger le build » propose une carte : le clic sur Lancer démarre la session.'` ; EN : `chat: 'Ask the chat "open a session in ledge to fix the build": it proposes a card, and Start the session starts it.'`. `HelpView.tsx`, sous le `<span>{t.help.tab}</span>` :

```tsx
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.help.chat}</span>
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter overlay test && pnpm typecheck`
Expected: PASS (dont `surface.test.tsx` et `launch.test.tsx` inchangés ; si un test d'aide compare la hauteur mesurée ou un snapshot de `HelpView`, mettre à jour la valeur attendue et le dire dans le commit).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/surface/Surface.tsx apps/overlay/src/surface/HelpView.tsx apps/overlay/src/i18n/messages.ts apps/overlay/test/launch-from-chat.test.tsx
git commit -m "feat(overlay): start the chat card's session and stay in the chat"
```

---

### Task 8: Playwright — la carte de bout en bout

**Files:**
- Create: `apps/overlay/e2e/launch-from-chat.spec.ts`

**Interfaces:**
- Consumes: `fakeDaemon` (`emit`, `launched`, `refuse`, `received`), `ready`, `openList`, `layer`, `expectMode`, `received` de `./fixtures` et `./scenarios` (comme `e2e/document-reader.spec.ts`).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, layer, expectMode, ready, received } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openList } from './scenarios';

/* The chat proposes a session, the user starts it from the card (spec 2026-10-12). */
const proposal = { cwd: '/home/u/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix the overlay build' };

async function askForSession(page: Parameters<typeof fakeDaemon>[0]) {
  const d = await fakeDaemon(page, [session('otto')]);
  await ready(page, 1);
  await openList(page);
  await layer(page, 'list').getByRole('textbox', { name: 'Ask Ledge' }).fill('open a session in ledge to fix the overlay build');
  await page.keyboard.press('Enter');
  await expectMode(page, 'chat');
  const ask = await received(d.received, 'chat.ask');
  const turn = { qid: ask.qid, question: ask.text, askedAt: new Date().toISOString(), steps: [], answer: 'Here is the session I would start.', answeredAt: new Date().toISOString() };
  d.emit({ type: 'chat.done', qid: ask.qid, text: turn.answer, at: turn.answeredAt, proposal });
  return { d, ask, turn };
}

test('a proposal shows a card; Start sends its qid; the card turns into the started companion', async ({ page }) => {
  const { d, ask, turn } = await askForSession(page);
  const card = layer(page, 'chat').getByRole('region', { name: 'Proposed session' });
  await expect(card).toContainText('/home/u/ledge');
  await expect(card).toContainText('Claude Code · default');
  await card.getByRole('button', { name: /Start the session/ }).click();
  expect(await received(d.received, 'session.launch')).toEqual({ type: 'session.launch', tool: 'claude', cwd: '/home/u/ledge', prompt: 'Fix the overlay build', qid: ask.qid });
  d.launched(session('n1', { name: 'Juno', project: 'ledge', cwd: '/home/u/ledge', title: 'Juno · ledge', state: 'starting' }));
  d.emit({ type: 'chat.history', turns: [{ ...turn, proposal: { ...proposal, launchedId: 'n1' } }] });
  await expect(card).toContainText('Juno has started');
  await expect(card.getByRole('button', { name: 'Terminal' })).toBeVisible();
  await expectMode(page, 'chat');
});

test('a failed launch shows the reason; Retry sends it again', async ({ page }) => {
  const { d, ask, turn } = await askForSession(page);
  const card = layer(page, 'chat').getByRole('region', { name: 'Proposed session' });
  await card.getByRole('button', { name: /Start the session/ }).click();
  await received(d.received, 'session.launch');
  d.refuse('no such folder: /home/u/ledge');
  d.emit({ type: 'chat.history', turns: [{ ...turn, proposal: { ...proposal, error: 'no such folder: /home/u/ledge' } }] });
  await expect(card.getByRole('alert')).toHaveText('Could not start: no such folder: /home/u/ledge');
  await card.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'session.launch' && m.qid === ask.qid).length).toBe(2);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter overlay exec playwright test e2e/launch-from-chat.spec.ts`
Expected: PASS. (Voir dans `docs/superpowers/plans/2026-10-12-island.md` la note sur la config Playwright si la commande ne trouve pas le serveur de dev ; utiliser la même commande que la CI ou le script `e2e` de `apps/overlay/package.json`.)

- [ ] **Step 3: Run the whole e2e suite** — pour vérifier que le déplacement de `loadOpenTab` et l'aide n'ont rien cassé (`launch.spec.ts`, `screenshots.spec.ts`, `visual.spec.ts`).

Run: `pnpm --filter overlay exec playwright test`
Expected: PASS ; si une capture de l'aide change à cause de la nouvelle ligne, la régénérer (`--update-snapshots` sur ce seul spec) et le dire dans le commit.

- [ ] **Step 4: Commit**

```bash
git add apps/overlay/e2e/launch-from-chat.spec.ts
git commit -m "test(e2e): start a session from the chat card, and retry a failed one"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md` (§Asking Ledge ~ligne 190, tableau §Protocol lignes ~221 et ~240, tableau des composants ligne ~106)

- [ ] **Step 1: Write** — dans §Asking Ledge, après le paragraphe « Bot names in the answer are links… » remplacer « Ledge never sends an instruction to a pane from the chat. » par :

```markdown
Ledge never sends an instruction to a pane from the chat, and never starts anything by itself. Asked to open or start a session ("open a session in ledge to fix the build"), it answers with a card when the folder is certain — an absolute path from `sessions.md`, from `folders.md` (the recent folders, written beside the other context files) or typed by the user — and asks which folder otherwise. The harness ends its answer with a ```` ```ledge-session ```` block holding `{"cwd", "prompt"?}`; the daemon takes the block out of the text, checks the folder, and attaches a `proposal` to the turn. The card's "Start the session" sends `session.launch { qid }`: the daemon launches the proposal's own folder, harness (the question's) and instruction, once, and marks the card started or failed for every client. The terminal tab opens as the launch form's switch says.
```

Tableau §Protocol : ligne `chat.done` → ``| `chat.done { qid, text, at, proposal? }` | The finished answer; `proposal` the session card, if any. |`` ; ligne `session.launch` : ajouter `qid?` dans la signature et, à la fin de la description, « With `qid`, it starts that chat turn's proposal (the other fields are ignored), refused once started. ». Ligne `chat.history` : mentionner que les tours portent leur `proposal` (`launchedId`, `error`).

Tableau des composants (`daemon/server.ts`) : après « answers `session.launched`. », ajouter « With a chat card's `qid`, it launches the proposal once and marks the turn. ».

- [ ] **Step 2: Check** — `pnpm build` (aucune erreur), puis relire le rendu Markdown des passages modifiés (`sed -n '188,206p' README.md`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: starting a session from the Ledge chat"
```

---

### Task 10: Vérification avec les vrais harnais

Le risque principal de la spec (§8) : chaque modèle respecte-t-il le format ? Les tests couvrent le parsing, pas ce comportement. Cette tâche ne change pas de code sauf si le persona doit être ajusté.

**Files:**
- Create (scratch, non commité): `$SCRATCH/try-chat.ts` où `$SCRATCH` est le dossier scratchpad de la session (ou `mktemp -d`)

- [ ] **Step 1: Write the probe** — un script qui appelle `createChat` directement, avec un store temporaire contenant deux dossiers récents réels, pour chaque harnais installé :

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '/home/gch/development/github.com/Paradow-dev/ledge/packages/ledge/src/daemon/store.js';
import { createChat } from '/home/gch/development/github.com/Paradow-dev/ledge/packages/ledge/src/chat/service.js';

const home = mkdtempSync(join(tmpdir(), 'ledge-try-'));
const store = new Store({ journalPath: join(home, 'j.json') });
store.touchRecent('/home/gch/development/github.com/Paradow-dev/ledge', 'ledge', new Date().toISOString());
store.touchRecent('/home/gch/development/github.com/Paradow-dev/ledge-site', 'ledge-site', new Date(Date.now() - 3600_000).toISOString());
const questions = ['ouvre une session dans ledge pour corriger le build de l\'overlay', 'lance une session dans le projet ledge', 'ouvre une session', 'où en sont les autres ?'];
for (const tool of (process.argv[2] ?? 'claude,codex,cursor').split(',') as Array<'claude' | 'codex' | 'cursor'>) {
  const chat = createChat({ store, tmux: { capture: async () => null }, home: join(home, tool), env: async () => process.env, timeoutMs: 180_000 });
  for (const [i, q] of questions.entries()) {
    await chat.reset(() => {});
    await chat.ask(`q${i}`, q, m => { if (m.type === 'chat.done') console.log(JSON.stringify({ tool, q, text: m.text, proposal: m.proposal ?? null })); if (m.type === 'chat.error') console.log(JSON.stringify({ tool, q, error: m.message })); }, tool);
  }
}
```

(Remplacer `ledge-site` par un second dossier réel proche, pour que « lance une session dans le projet ledge » soit potentiellement ambigu ; s'il n'en existe pas, utiliser un dossier dont le nom contient aussi « ledge ».)

- [ ] **Step 2: Run it** — `pnpm exec tsx $SCRATCH/try-chat.ts claude`, puis `codex`, puis `cursor` (chaque appel coûte un tour de modèle ; un harnais absent du PATH donne un `chat.error` « could not start » : le noter et passer).

Attendu, pour chaque harnais :
- question 1 → `proposal.cwd` = le dossier ledge, `prompt` ≈ « corriger le build de l'overlay », texte d'une ou deux lignes sans bloc ;
- question 2 → soit une carte sur ledge, soit une question citant les candidats — jamais une carte sur `ledge-site` ;
- question 3 → pas de carte, une question « dans quel dossier ? » avec des candidats ;
- question 4 → pas de carte.

- [ ] **Step 3: Report** — consigner les résultats (un tableau harnais × question : carte / question / texte) dans le message de fin d'exécution. Si un harnais rate le format (bloc dans une autre langue de fence, JSON hors bloc, carte pour une question ordinaire), ajuster la phrase du persona dans `claude.ts` (une seule source pour les trois), relancer les tests de la Task 3 et ce script, puis :

```bash
git add packages/ledge/src/chat/claude.ts
git commit -m "fix(chat): tighten the session proposal rule after trying the three harnesses"
```

---

## Ordre et dépendances

1 → 2 → 3 → 4 → 5 (daemon), puis 6 → 7 → 8 (overlay ; 6 dépend de 1-2 seulement), 9 après 5 et 7, 10 en dernier. Les Tasks 3 et 6 peuvent avancer en parallèle une fois la Task 2 faite.
