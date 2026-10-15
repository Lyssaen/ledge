# Suivi natif des sessions — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montrer dans l'overlay, pour chaque session, le fil du tour en cours (consigne, messages, actions dépliables avec résultat et fichiers, permissions), les sous-agents cliquables ouvrant leur propre vue, et la carte de dernière réponse avec son champ de réponse intégré.

**Architecture:** Les hooks transmettent des événements enrichis (entrée, résultat, durée, identifiant d'appel, chemins de transcript) sans rien lire eux-mêmes. Le daemon réduit ces événements en un `ThreadItem[]` par session (`History`), complété par les messages de l'agent lus dans le tail des transcripts, journalisé en JSONL et diffusé élément par élément. L'overlay demande le fil quand il ouvre une session, le garde dans son store et le rend dans la vue session ; un nouveau mode `helper` affiche le fil d'un sous-agent.

**Tech Stack:** TypeScript, zod (`@ledge/protocol`), Node 22+ (`@paradow/ledge` : daemon, hooks), React 19 + Tauri 2 (overlay), vitest + Testing Library, Playwright 1.49, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-13-native-session-tracking-design.md` (maquette confirmée : `docs/mockups/ledge-native-sessions.html?reply=card`).

## Global Constraints

- **Aucun compteur** dans l'interface : pas de « n actions », « n terminés », « n questions », ni « · n » dans les kickers (spec §1, décisions). Le plan retire ceux qui existent.
- Une session `source: 'hook_only'` reste **en lecture seule** : le fil s'affiche, aucun formulaire d'envoi (spec §1).
- Tout ajout au protocole est **optionnel et additif** : un vieux daemon ou un vieux hook reste accepté par `parseClientMessage` / `parseServerMessage`.
- Le hook ne lit **aucun transcript** et reste sous `timeoutMs = 100` ; les textes sont plafonnés : `REPLY_MAX = 24_000` pour un résultat ou un rapport, `INPUT_MAX = 8_000` par chaîne d'entrée (spec §2).
- Le `snapshot` ne porte pas les fils ; l'overlay les demande par `session.thread` et les oublie à chaque snapshot (spec §5).
- Chemin de journal : `~/.ledge/history/<sessionId>.jsonl` via `paths()` (`LEDGE_HOME` respecté), 400 éléments par session en mémoire.
- Textes FR et EN dans `apps/overlay/src/i18n/messages.ts` uniquement, sous une nouvelle clé `thread`.
- Le dépôt porte un travail en cours non lié (`optionDetails` dans `hook.ts`, `state.ts`, `messages.ts` du protocole, tests overlay, etc.) : **construire par-dessus, ne rien reverter**. Les fichiers de maquette (`docs/mockups/`) ne sont pas touchés.
- Style des fichiers voisins : une ligne par idée, commentaires courts expliquant le pourquoi, tests `describe/it` avec des fixtures locales (`mk`, `ev`, `fakeSession`).
- Pas de `docker` ici ; si un script en avait besoin, le subnet serait déclaré explicitement (règle globale CLAUDE.md).

## Review Focus

1. Un `PostToolUse` qui arrive **avant** le `PreToolUse` correspondant (hooks parallèles, ou PreToolUse absent sous Cursor) : la ligne doit exister quand même, avec son résultat, pas être perdue. Test ajouté à la tâche 5.
2. Un `tool_response` qui n'est ni une chaîne ni un objet `{stdout, stderr}` (tableau de blocs de contenu, nombre, `null`) : le hook doit produire un `output` texte ou rien, jamais lever. Test ajouté à la tâche 2.
3. Un transcript Claude dont la dernière ligne est **tronquée** (écriture en cours) ou un rollout Codex avec des lignes `response_item` en double : aucun doublon ni exception, la ligne incomplète est ignorée. Test ajouté à la tâche 6.
4. Un fil de plus de 400 éléments et un journal corrompu (ligne illisible) : la mémoire est bornée et le chargement continue. Test ajouté à la tâche 5.
5. Dans l'overlay, le `session.thread` d'une session **que l'on a quittée entre-temps** ou qui n'existe plus : le store le range sans jamais rouvrir la vue ; un `session.removed` vide son fil. Test ajouté à la tâche 8.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `packages/protocol/src/thread.ts` (créer) | `ThreadItemSchema`, `FileChangeSchema`, `ToolStatusSchema` et leurs types |
| `packages/protocol/src/messages.ts` | champs enrichis de `SessionEventSchema` ; messages `session.thread` (deux sens) et `session.thread.item` |
| `packages/protocol/src/index.ts` | réexport de `thread.ts` |
| `packages/protocol/test/messages.test.ts` | validation des nouveaux messages et de la compatibilité |
| `packages/ledge/src/cli/hook.ts` | `toolOutput`, `trimInput`, `INPUT_MAX` ; événements enrichis dans `mapEvent` et `mapCursorEvent` |
| `packages/ledge/test/hook.test.ts` | mapping enrichi |
| `packages/ledge/src/daemon/store.ts` | `onEvent` |
| `packages/ledge/src/daemon/files.ts` (créer) | `filesOf(tool, input)` : fichiers d'une action |
| `packages/ledge/src/daemon/history.ts` (créer) | `History` : réduction des événements en fil, journal JSONL, `decide`, `sync` |
| `packages/ledge/src/daemon/transcript.ts` (créer) | `agentMessages(path)` : messages de l'agent dans un transcript Claude ou un rollout Codex |
| `packages/ledge/src/paths.ts` | `history` dans `paths()` |
| `packages/ledge/src/daemon/server.ts` | `history` dans `startServer`, réponse à `session.thread`, diffusion des éléments, enregistrement des décisions |
| `packages/ledge/src/daemon/index.ts` | création et chargement de `History` |
| `packages/ledge/test/{store,files,history,transcript,server}.test.ts` | tests daemon |
| `apps/overlay/src/daemon/store.ts` | `threads` dans `DaemonState` |
| `apps/overlay/src/thread/turns.ts` (créer) | `turns(items)`, `helperRows(session, items)` : regroupement pur |
| `apps/overlay/src/surface/Thread.tsx` (créer) | rendu du fil (tours, consigne, messages, actions, fichiers, permissions) |
| `apps/overlay/src/surface/HelperView.tsx` (créer) | vue d'un sous-agent |
| `apps/overlay/src/surface/SessionView.tsx` | fil sous l'arbre, arbre cliquable, suppression des compteurs, `onSend` vers la carte |
| `apps/overlay/src/surface/ReplyCard.tsx` | formulaire de réponse dans la carte, kickers sans compteur |
| `apps/overlay/src/surface/{machine,geometry}.ts`, `Surface.tsx` | mode `helper`, demande du fil, câblage |
| `apps/overlay/src/i18n/messages.ts` | clés `thread.*` FR/EN |
| `apps/overlay/test/{turns,thread,session,helper-view,reply-view,machine,daemon}.test.tsx` | tests overlay |
| `apps/overlay/e2e/thread.spec.ts` (créer), `e2e/screenshots.spec.ts`, `README.md` | bout en bout, captures, doc |

---

### Task 1 : Protocole — `ThreadItem` et messages

**Files:**
- Create: `packages/protocol/src/thread.ts`
- Modify: `packages/protocol/src/messages.ts` (`SessionEventSchema` lignes 8–24, `ServerMessageSchema`, `ClientMessageSchema`)
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces: `ThreadItem` (union discriminée par `kind` : `prompt | message | tool | permission | reply | helper`), `FileChange`, `ToolStatus`, `ToolItem` ; `SessionEvent` enrichi des champs optionnels `toolUseId`, `toolInput`, `output`, `durationMs`, `error`, `transcriptPath`, `decision` ; messages `{ type: 'session.thread', id }` (client), `{ type: 'session.thread', id, items }` et `{ type: 'session.thread.item', id, item }` (serveur).

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin de `packages/protocol/test/messages.test.ts` :

```ts
describe('native session tracking (spec 2026-10-13 §3, §5)', () => {
  const at = '2026-10-13T10:00:00.000Z';
  it('validates each thread item kind and defaults the files of an action', () => {
    const tool = ThreadItemSchema.parse({ kind: 'tool', id: 'toolu_1', at, turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'running' });
    expect(tool).toMatchObject({ kind: 'tool', files: [] });
    expect(ThreadItemSchema.parse({ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Fais le plan' }).kind).toBe('prompt');
    expect(ThreadItemSchema.parse({ kind: 'helper', id: 'h1', at, turn: 1, task: 'review task 1', agentType: 'Explore', state: 'working' }).kind).toBe('helper');
    expect(ThreadItemSchema.parse({ kind: 'permission', id: 'perm-1', at, turn: 1, tool: 'Bash', text: 'rm -rf dist', decision: 'deny' }).kind).toBe('permission');
    expect(ThreadItemSchema.parse({ kind: 'reply', id: 'r1', at, turn: 1, text: 'Terminé', helperId: 'h1' }).helperId).toBe('h1');
    expect(() => ThreadItemSchema.parse({ kind: 'tool', id: 't', at, turn: 1, tool: 'Bash', label: 'x', status: 'done' })).toThrow();
  });
  it('accepts the enriched hook event and keeps the old shape valid', () => {
    const old = { type: 'session.event', id: 's', event: { name: 'PostToolUse', at, source: 'hook', tool: 'Bash' } };
    expect(parseClientMessage(JSON.stringify(old))).toMatchObject(old);
    const rich = { ...old, event: { ...old.event, toolUseId: 'toolu_1', toolInput: { command: 'pnpm test' }, output: 'ok', durationMs: 812, transcriptPath: '/t.jsonl' } };
    expect(parseClientMessage(JSON.stringify(rich))).toMatchObject(rich);
    expect(parseClientMessage(JSON.stringify({ ...old, event: { ...old.event, durationMs: -1 } }))).toBeNull();
  });
  it('carries a thread request, a thread and a single item', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'session.thread', id: 's' }))).toEqual({ type: 'session.thread', id: 's' });
    const item = { kind: 'message', id: 'm1', at, turn: 1, text: 'Je regarde le reducer.' };
    expect(parseServerMessage(JSON.stringify({ type: 'session.thread', id: 's', items: [item] }))).toMatchObject({ type: 'session.thread', items: [item] });
    expect(parseServerMessage(JSON.stringify({ type: 'session.thread.item', id: 's', item }))).toMatchObject({ type: 'session.thread.item', item });
  });
});
```

Ajouter `ThreadItemSchema` à l'import existant depuis `'../src/index.js'`.

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @ledge/protocol test -- -t "native session tracking"`
Expected: FAIL — `ThreadItemSchema` n'est pas exporté ; `parseClientMessage` renvoie `null` pour `session.thread`.

- [ ] **Step 3 : Créer `packages/protocol/src/thread.ts`**

```ts
import { z } from 'zod';

/** Native session tracking (spec 2026-10-13 §3): what a session's thread is made of. */
export const ToolStatusSchema = z.enum(['running', 'success', 'failed', 'unknown']);
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

/** A file an action touched, read from the action's input; confirmed only once the action succeeded. */
export const FileChangeSchema = z.object({ path: z.string().min(1), change: z.enum(['add', 'edit', 'delete', 'write']), diff: z.string().optional() });
export type FileChange = z.infer<typeof FileChangeSchema>;

/** `turn` counts the prompts so far (0 before the first); `helperId` marks an item of a subagent's own thread. */
const base = { id: z.string().min(1), at: z.string().datetime(), turn: z.number().int().nonnegative(), helperId: z.string().optional() };
export const ThreadItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), ...base, text: z.string() }),
  z.object({ kind: z.literal('message'), ...base, text: z.string() }),
  /** `id` is the harness's tool_use_id when it gives one, so the result updates the same row. */
  z.object({ kind: z.literal('tool'), ...base, tool: z.string(), label: z.string(), input: z.string().optional(), output: z.string().optional(), error: z.string().optional(), status: ToolStatusSchema, durationMs: z.number().nonnegative().optional(), files: z.array(FileChangeSchema).default([]) }),
  /** `unknown`: answered in the terminal, the daemon only saw the prompt go away. */
  z.object({ kind: z.literal('permission'), ...base, tool: z.string(), text: z.string(), decision: z.enum(['accept', 'deny', 'unknown']).optional() }),
  z.object({ kind: z.literal('reply'), ...base, text: z.string() }),
  z.object({ kind: z.literal('helper'), ...base, task: z.string(), agentType: z.string().optional(), state: z.enum(['working', 'exited']) })
]);
export type ThreadItem = z.infer<typeof ThreadItemSchema>;
export type ToolItem = Extract<ThreadItem, { kind: 'tool' }>;
export type HelperItem = Extract<ThreadItem, { kind: 'helper' }>;
```

- [ ] **Step 4 : Enrichir `SessionEventSchema` et ajouter les messages**

Dans `packages/protocol/src/messages.ts`, importer `import { ThreadItemSchema } from './thread.js';` et ajouter, avant la fermeture de `SessionEventSchema` (après `interrupt`) :

```ts
  /** Native tracking (spec 2026-10-13 §2): the harness's id of the tool call, so its result lands on the same row. */
  toolUseId: z.string().optional(),
  /** The tool's input as the harness gave it, every string capped by the hook. */
  toolInput: z.record(z.string(), z.unknown()).optional(),
  /** PostToolUse: the result as text; SubagentStop: nothing (the report travels in `text`). */
  output: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  /** PostToolUseFailure: the harness's error message. */
  error: z.string().optional(),
  /** The session's transcript, or the helper's on SubagentStop; the daemon reads its tail for the agent's messages. */
  transcriptPath: z.string().optional(),
  /** Decided: what was chosen when the daemon knows it. */
  decision: z.enum(['accept', 'deny']).optional()
```

Dans `ServerMessageSchema`, après `session.preview` :

```ts
  /** A session's thread, on request (spec 2026-10-13 §5); then each created or updated item, broadcast. */
  z.object({ type: z.literal('session.thread'), id: z.string(), items: z.array(ThreadItemSchema) }),
  z.object({ type: z.literal('session.thread.item'), id: z.string(), item: ThreadItemSchema }),
```

Dans `ClientMessageSchema`, après `session.rename` :

```ts
  z.object({ type: z.literal('session.thread'), id: z.string() }),
```

Dans `packages/protocol/src/index.ts`, ajouter `export * from './thread.js';`.

- [ ] **Step 5 : Vérifier le succès**

Run: `pnpm --filter @ledge/protocol test && pnpm --filter @ledge/protocol typecheck`
Expected: PASS, tous les tests du protocole.

- [ ] **Step 6 : Commit**

```bash
git add packages/protocol/src/thread.ts packages/protocol/src/messages.ts packages/protocol/src/index.ts packages/protocol/test/messages.test.ts
git commit -m "feat(protocol): thread items and enriched hook events for native tracking"
```

### Task 2 : Hook — événements enrichis sans lecture de transcript

**Files:**
- Modify: `packages/ledge/src/cli/hook.ts` (`mapEvent` lignes 102–160, `mapCursorEvent`, `mapHook`)
- Test: `packages/ledge/test/hook.test.ts`

**Interfaces:**
- Consumes: `SessionEvent` enrichi (tâche 1).
- Produces: `export const INPUT_MAX = 8_000`, `export function toolOutput(response: unknown): string | undefined`, `export function trimInput(input: unknown): Record<string, unknown> | undefined` ; `mapEvent` renvoie `toolUseId`, `toolInput` sur `PreToolUse`/`PermissionRequest`/`PostToolUse`/`PostToolUseFailure`, `output` + `durationMs` sur `PostToolUse`, `error` sur `PostToolUseFailure`, `text` (rapport) + `transcriptPath` (agent) sur `SubagentStop`, `transcriptPath` (session) sur `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Stop`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Remplacer dans `packages/ledge/test/hook.test.ts` le test `maps PostToolUse with its tool` par :

```ts
  it('maps PostToolUse with its id, input, output and duration', () => {
    const payload = { ...common, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok', stderr: '' }, tool_use_id: 'toolu_1', duration_ms: 812 };
    expect(mapClaudeHook('PostToolUse', payload, at)?.event).toEqual({ name: 'PostToolUse', at, source: 'hook', tool: 'Bash', toolUseId: 'toolu_1', toolInput: { command: 'npm test' }, output: 'ok', durationMs: 812 });
  });
  it('turns any tool_response into text or nothing, never throws', () => {
    expect(toolOutput('plain')).toBe('plain');
    expect(toolOutput({ stdout: 'out', stderr: 'err' })).toBe('out\nerr');
    expect(toolOutput([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(toolOutput({ filePath: '/x', success: true })).toBe('{"filePath":"/x","success":true}');
    expect(toolOutput(null)).toBeUndefined();
    expect(toolOutput(42)).toBe('42');
    expect(toolOutput('x'.repeat(REPLY_MAX + 10))).toHaveLength(REPLY_MAX);
  });
  it('caps each input string and keeps the rest of the input', () => {
    const long = 'y'.repeat(INPUT_MAX + 5);
    expect(trimInput({ command: long, timeout: 5, nested: { s: long } })).toEqual({ command: long.slice(0, INPUT_MAX), timeout: 5, nested: { s: long.slice(0, INPUT_MAX) } });
    expect(trimInput('not an object')).toBeUndefined();
  });
  it('maps PostToolUseFailure with its error and PreToolUse with its id and transcript', () => {
    const fail = { ...common, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_2', error: 'exit 1', duration_ms: 40 };
    expect(mapClaudeHook('PostToolUseFailure', fail, at)?.event).toEqual({ name: 'PostToolUseFailure', at, source: 'hook', tool: 'Bash', toolUseId: 'toolu_2', toolInput: { command: 'x' }, error: 'exit 1', durationMs: 40 });
    const pre = { ...common, transcript_path: '/t/s.jsonl', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' }, tool_use_id: 'toolu_3' };
    expect(mapClaudeHook('PreToolUse', pre, at)?.event).toMatchObject({ name: 'PreToolUse', tool: 'Edit', toolUseId: 'toolu_3', toolInput: pre.tool_input, transcriptPath: '/t/s.jsonl' });
  });
  it('maps SubagentStop with the report and the helper transcript', () => {
    const payload = { ...common, hook_event_name: 'SubagentStop', agent_id: 'h1', agent_type: 'Explore', agent_transcript_path: '/t/s/subagents/agent-h1.jsonl', last_assistant_message: 'Found 3 consumers.' };
    expect(mapClaudeHook('SubagentStop', payload, at)?.event).toEqual({ name: 'SubagentStop', at, source: 'hook', helperId: 'h1', tool: 'Explore', text: 'Found 3 consumers.', transcriptPath: '/t/s/subagents/agent-h1.jsonl' });
  });
```

Ajouter `toolOutput, trimInput, INPUT_MAX` à l'import depuis `'../src/cli/hook.js'`. Le test existant `maps PostToolUseFailure with its tool` garde son attente sur `interrupt: true` ; lui ajouter `toolUseId`/`toolInput` seulement si son payload en porte.

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @paradow/ledge test -- hook`
Expected: FAIL — `toolOutput` n'existe pas ; `PostToolUse` ne porte que `tool`.

- [ ] **Step 3 : Implémenter**

Dans `packages/ledge/src/cli/hook.ts`, après `REPLY_MAX` :

```ts
/** Each string of a tool input is capped: a Write carries a whole file, the daemon only shows a diff of it. */
export const INPUT_MAX = 8_000;

/** The tool's input, strings capped, or nothing when the harness gave no object. */
export function trimInput(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const trim = (v: unknown): unknown => typeof v === 'string' ? v.slice(0, INPUT_MAX)
    : Array.isArray(v) ? v.map(trim)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, trim(x)])) : v;
  return trim(input) as Record<string, unknown>;
}

/** A tool_response as text: a string as is, `{stdout, stderr}` joined, content blocks' texts, anything else as JSON. */
export function toolOutput(response: unknown): string | undefined {
  if (response === null || response === undefined) return undefined;
  let text: string;
  if (typeof response === 'string') text = response;
  else if (Array.isArray(response)) text = response.map(b => str((b as Payload)?.text) ?? '').filter(Boolean).join('\n');
  else if (typeof response === 'object' && ('stdout' in response || 'stderr' in response)) {
    const r = response as Payload;
    text = [str(r.stdout), str(r.stderr)].filter(Boolean).join('\n');
  } else {
    try { text = JSON.stringify(response); } catch { text = String(response); }
  }
  return text.slice(0, REPLY_MAX);
}
```

Dans `mapEvent`, remplacer la construction de `base` et les cas concernés :

```ts
  const base = { at, source: 'hook' as const, ...(agentId ? { helperId: agentId } : {}) };
  const toolUseId = str(p.tool_use_id) || undefined;
  const toolInput = trimInput(p.tool_input);
  const call = { ...(toolUseId ? { toolUseId } : {}), ...(toolInput ? { toolInput } : {}) };
  const transcript = str(p.transcript_path) ? { transcriptPath: str(p.transcript_path)! } : {};
  const duration = typeof p.duration_ms === 'number' && p.duration_ms >= 0 ? { durationMs: p.duration_ms } : {};
```

```ts
    case 'SubagentStart':
    case 'SubagentStop': {
      if (!agentId) return null;
      const type = str(p.agent_type) || undefined;
      const task = eventName === 'SubagentStart' ? (str(p.description) || str(p.prompt))?.split('\n')[0] : undefined;
      // SubagentStop: the helper's report and its own transcript, which the daemon reads for its messages.
      const report = eventName === 'SubagentStop' ? lastReply(p) : undefined;
      const agentTranscript = eventName === 'SubagentStop' && str(p.agent_transcript_path) ? { transcriptPath: str(p.agent_transcript_path)! } : {};
      return { name: eventName, ...base, ...(type ? { tool: type } : {}), ...(task ? { text: task } : {}), ...(report ? { text: report } : {}), ...agentTranscript };
    }
    case 'PostToolUse': {
      const output = toolOutput(p.tool_response);
      return { name: 'PostToolUse', ...base, tool, ...call, ...(output !== undefined ? { output } : {}), ...duration };
    }
    case 'PostToolUseFailure': {
      const error = str(p.error) || undefined;
      return { name: 'PostToolUseFailure', ...base, tool, ...call, ...(error ? { error } : {}), ...duration, ...(p.is_interrupt === true ? { interrupt: true } : {}) };
    }
```

`UserPromptSubmit`, `Stop` : ajouter `...transcript` au retour. `PermissionRequest` : `return { name: 'PermissionRequest', ...base, tool, text: describeTool(tool, p.tool_input), ...call, ...transcript };`. Les deux retours de `PreToolUse` : ajouter `...call, ...transcript`.

Dans `mapCursorEvent`, le `postToolUse` et le `postToolUseFailure` existants ajoutent `...(trimInput(p.tool_input) ? { toolInput: trimInput(p.tool_input) } : {})` (Cursor ne donne ni `tool_use_id`, ni résultat, ni durée : rien d'autre).

- [ ] **Step 4 : Vérifier le succès et le budget**

Run: `pnpm --filter @paradow/ledge test -- hook && pnpm --filter @paradow/ledge typecheck`
Expected: PASS. Le test existant `runHook` (timeout 100 ms) passe toujours.

- [ ] **Step 5 : Commit**

```bash
git add packages/ledge/src/cli/hook.ts packages/ledge/test/hook.test.ts
git commit -m "feat(hook): carry tool input, output, duration, ids and transcript paths"
```

### Task 3 : Store — notifier chaque événement appliqué

**Files:**
- Modify: `packages/ledge/src/daemon/store.ts` (`apply` lignes 69–77, à côté de `onChange`)
- Modify: `packages/ledge/src/daemon/server.ts` (`case 'session.event'` lignes 266–276)
- Test: `packages/ledge/test/store.test.ts`, `packages/ledge/test/server.test.ts`

**Interfaces:**
- Produces: `Store.onEvent(listener: (id: string, event: SessionEvent) => void): () => void`, appelé à chaque `apply`, **même quand le reducer rend le même objet** (un `Decided` qui ne change rien d'un état doit quand même atteindre l'historique).

- [ ] **Step 1 : Tests qui échouent**

Dans `packages/ledge/test/store.test.ts`, dans `describe('Store')` :

```ts
  it('tells event listeners about every applied event, even one the reducer ignores', () => {
    const s = new Store(); const seen: string[] = [];
    s.onEvent((id, ev) => seen.push(`${id}:${ev.name}`));
    s.upsert(mk('a'));
    s.apply('a', { name: 'Stop', at: '2026-10-09T18:01:00.000Z', source: 'hook' });
    s.apply('a', { name: 'Decided', at: '2026-10-09T18:02:00.000Z', source: 'daemon' }); // nothing pending: same object
    s.apply('zz', { name: 'Stop', at: '2026-10-09T18:03:00.000Z', source: 'hook' }); // unknown session: nothing
    expect(seen).toEqual(['a:Stop', 'a:Decided']);
  });
```

Dans `packages/ledge/test/server.test.ts`, à côté du test existant sur la création d'une session `hook_only` par `session.event` :

```ts
  it('routes the first event of a hook-only session through the store, so event listeners see it', async () => {
    const store = new Store(); const seen: string[] = [];
    store.onEvent((id, ev) => seen.push(`${id}:${ev.name}`));
    const server = await startServer({ store, tmux: fakeTmux({}), port: 0 });
    const c = await connect({ port: server.port, host: '127.0.0.1', timeoutMs: 2000 });
    await c.next('snapshot', 2000);
    c.send({ type: 'session.event', id: 'h1', cwd: '/w/x', event: { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'Fais le plan' } });
    await c.next('session.updated', 2000);
    expect(seen).toEqual(['h1:UserPromptSubmit']);
    expect(store.get('h1')?.source).toBe('hook_only');
    c.close(); await server.close();
  });
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @paradow/ledge test -- store server`
Expected: FAIL — `s.onEvent is not a function`.

- [ ] **Step 3 : Implémenter**

`packages/ledge/src/daemon/store.ts` :

```ts
  private eventListeners = new Set<(id: string, event: SessionEvent) => void>();

  /** Every event applied to a known session, before the reducer decides whether it changes anything. */
  onEvent(listener: (id: string, event: SessionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  apply(id: string, event: SessionEvent): Session | undefined {
    const cur = this.sessions.get(id);
    if (!cur) return undefined;
    for (const l of this.eventListeners) { try { l(id, event); } catch (e) { log(`event listener failed: ${(e as Error).message}`); } }
    const next = reduce(cur, event);
    if (next === cur) return cur;
    this.sessions.set(id, next);
    this.emit({ type: 'updated', session: next });
    return next;
  }
```

`packages/ledge/src/daemon/server.ts`, dans `case 'session.event'`, remplacer `store.upsert(reduce(base, msg.event));` par :

```ts
          store.upsert(base);
          store.apply(msg.id, msg.event); // through apply, so the history sees the session's first event too
```

Si `reduce` n'est plus utilisé dans `server.ts`, retirer son import.

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @paradow/ledge test -- store server`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/ledge/src/daemon/store.ts packages/ledge/src/daemon/server.ts packages/ledge/test/store.test.ts packages/ledge/test/server.test.ts
git commit -m "feat(daemon): store notifies every applied event"
```

### Task 4 : Daemon — les fichiers d'une action (`filesOf`)

**Files:**
- Create: `packages/ledge/src/daemon/files.ts`
- Test: `packages/ledge/test/files.test.ts`

**Interfaces:**
- Consumes: `FileChange` (tâche 1).
- Produces: `export function filesOf(tool: string | undefined, input: Record<string, unknown> | undefined): FileChange[]` ; `export const DIFF_LINES = 80`.

- [ ] **Step 1 : Test qui échoue**

Créer `packages/ledge/test/files.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { filesOf, DIFF_LINES } from '../src/daemon/files.js';

describe('filesOf', () => {
  it('reads a Claude Edit as a diff of the old and new strings', () => {
    expect(filesOf('Edit', { file_path: '/w/a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;\nexport { a };' }))
      .toEqual([{ path: '/w/a.ts', change: 'edit', diff: '- const a = 1;\n+ const a = 2;\n+ export { a };' }]);
  });
  it('reads a Write as added lines, capped, and a MultiEdit as one file', () => {
    const content = Array.from({ length: DIFF_LINES + 5 }, (_, i) => `l${i}`).join('\n');
    const [w] = filesOf('Write', { file_path: '/w/new.ts', content });
    expect(w).toMatchObject({ path: '/w/new.ts', change: 'write' });
    expect(w!.diff!.split('\n')).toHaveLength(DIFF_LINES + 1);
    expect(w!.diff!.endsWith('…')).toBe(true);
    expect(filesOf('MultiEdit', { file_path: '/w/b.ts', edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: 'q' }] }))
      .toEqual([{ path: '/w/b.ts', change: 'edit', diff: '- x\n+ y\n- p\n+ q' }]);
    expect(filesOf('NotebookEdit', { notebook_path: '/w/n.ipynb' })).toEqual([{ path: '/w/n.ipynb', change: 'edit' }]);
  });
  it('reads a Codex apply_patch, one file per header', () => {
    const patch = '*** Begin Patch\n*** Add File: src/new.ts\n+export const x = 1;\n*** Update File: src/old.ts\n@@\n-a\n+b\n*** Delete File: src/gone.ts\n*** End Patch';
    expect(filesOf('apply_patch', { patch })).toEqual([
      { path: 'src/new.ts', change: 'add', diff: '+export const x = 1;' },
      { path: 'src/old.ts', change: 'edit', diff: '@@\n-a\n+b' },
      { path: 'src/gone.ts', change: 'delete' }
    ]);
    expect(filesOf('shell', { command: ['apply_patch', patch] })).toHaveLength(3);
  });
  it('gives nothing for a tool without files or without input', () => {
    expect(filesOf('Bash', { command: 'ls' })).toEqual([]);
    expect(filesOf('Write', undefined)).toEqual([]);
    expect(filesOf(undefined, { file_path: '/x' })).toEqual([]);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @paradow/ledge test -- files`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter `packages/ledge/src/daemon/files.ts`**

```ts
import type { FileChange } from '@ledge/protocol';

/** Native tracking (spec 2026-10-13 §3): the files an action touched, read from its input alone. */
export const DIFF_LINES = 80;

const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
const cap = (lines: string[]): string => lines.length > DIFF_LINES ? [...lines.slice(0, DIFF_LINES), '…'].join('\n') : lines.join('\n');
const edit = (oldS: string, newS: string): string[] => [...oldS.split('\n').map(l => `- ${l}`), ...newS.split('\n').map(l => `+ ${l}`)];

/** Codex's patch format: one `*** Add/Update/Delete File:` header per file, its hunk lines until the next header. */
function fromPatch(patch: string): FileChange[] {
  const out: FileChange[] = [];
  let cur: { file: FileChange; lines: string[] } | null = null;
  const flush = () => { if (cur) { if (cur.lines.length) cur.file.diff = cap(cur.lines); out.push(cur.file); cur = null; } };
  for (const line of patch.split('\n')) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (m) { flush(); cur = { file: { path: m[2]!.trim(), change: m[1] === 'Add' ? 'add' : m[1] === 'Update' ? 'edit' : 'delete' }, lines: [] }; continue; }
    if (/^\*\*\* (Begin|End) Patch/.test(line) || /^\*\*\* Move to:/.test(line)) continue;
    if (cur && cur.file.change !== 'delete') cur.lines.push(line);
  }
  flush();
  return out;
}

export function filesOf(tool: string | undefined, input: Record<string, unknown> | undefined): FileChange[] {
  if (!tool || !input) return [];
  const path = str(input.file_path) ?? str(input.notebook_path);
  switch (tool) {
    case 'Write': return path ? [{ path, change: 'write', ...(str(input.content) !== undefined ? { diff: cap(str(input.content)!.split('\n').map(l => `+ ${l}`)) } : {}) }] : [];
    case 'Edit': return path ? [{ path, change: 'edit', diff: cap(edit(str(input.old_string) ?? '', str(input.new_string) ?? '')) }] : [];
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits as Array<Record<string, unknown>> : [];
      return path ? [{ path, change: 'edit', diff: cap(edits.flatMap(e => edit(str(e.old_string) ?? '', str(e.new_string) ?? ''))) }] : [];
    }
    case 'NotebookEdit': return path ? [{ path, change: 'edit' }] : [];
    case 'apply_patch': return fromPatch(str(input.patch) ?? str(input.input) ?? '');
    case 'shell': case 'Bash': {
      // Codex may run apply_patch through its shell: `command` is then ['apply_patch', '<patch>'].
      const cmd = Array.isArray(input.command) ? input.command.map(String) : [];
      return cmd[0] === 'apply_patch' && cmd[1] ? fromPatch(cmd[1]) : [];
    }
    default: return [];
  }
}
```

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @paradow/ledge test -- files`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add packages/ledge/src/daemon/files.ts packages/ledge/test/files.test.ts
git commit -m "feat(daemon): read the files an action touched from its input"
```

### Task 5 : Daemon — `History`, le fil d'une session et son journal

**Files:**
- Create: `packages/ledge/src/daemon/history.ts`
- Modify: `packages/ledge/src/paths.ts` (`paths()`)
- Test: `packages/ledge/test/history.test.ts`

**Interfaces:**
- Consumes: `filesOf` (tâche 4), `SessionEvent` enrichi (tâche 1), `paths()`.
- Produces: `paths().history` (`<dir>/history`) ; `export const MAX_ITEMS = 400` ; `class History { constructor(opts?: { dir?: string }); load(): Promise<void>; items(id: string): ThreadItem[]; record(id: string, event: SessionEvent): ThreadItem | undefined; decide(id: string, decision: 'accept' | 'deny'): ThreadItem | undefined; forget(id: string): void; onItem(l: (id: string, item: ThreadItem) => void): () => void; flush(): Promise<void> }`. La méthode `sync` (messages des transcripts) arrive à la tâche 6.

- [ ] **Step 1 : Tests qui échouent**

Créer `packages/ledge/test/history.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '@ledge/protocol';
import { History, MAX_ITEMS } from '../src/daemon/history.js';
import { paths } from '../src/paths.js';

const T0 = '2026-10-13T10:00:00.000Z';
const later = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const ev = (name: SessionEvent['name'], extra: Partial<SessionEvent> = {}, s = 0): SessionEvent => ({ name, at: later(s), source: 'hook', ...extra });
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-')); process.env.LEDGE_HOME = dir; });

describe('History', () => {
  it('journals under the ledge home', () => { expect(paths().history).toBe(join(dir, 'history')); });

  it('builds the turn: prompt, running action, its result on the same row, the reply', () => {
    const h = new History(); const seen: string[] = []; h.onItem((id, it) => seen.push(`${id}:${it.kind}:${it.id}`));
    h.record('s', ev('UserPromptSubmit', { text: 'Lance les tests' }));
    h.record('s', ev('PreToolUse', { tool: 'Bash', text: 'Bash · pnpm test', toolUseId: 'toolu_1', toolInput: { command: 'pnpm test' } }, 1));
    expect(h.items('s')[1]).toMatchObject({ kind: 'tool', id: 'toolu_1', status: 'running', label: 'Bash · pnpm test', input: 'pnpm test', turn: 1 });
    h.record('s', ev('PostToolUse', { tool: 'Bash', toolUseId: 'toolu_1', output: '12 passed', durationMs: 812 }, 3));
    expect(h.items('s')).toHaveLength(2);
    expect(h.items('s')[1]).toMatchObject({ status: 'success', output: '12 passed', durationMs: 812 });
    h.record('s', ev('Stop', { text: 'Tout passe.' }, 4));
    expect(h.items('s').map(i => i.kind)).toEqual(['prompt', 'tool', 'reply']);
    expect(seen).toEqual(['s:prompt:prompt-1', 's:tool:toolu_1', 's:tool:toolu_1', 's:reply:reply-1']);
    expect(h.items('s')[0]).toMatchObject({ kind: 'prompt', text: 'Lance les tests', turn: 1 });
  });

  it('keeps a result whose call was never seen, and matches a result without id to the last running call of that tool', () => {
    const h = new History();
    h.record('s', ev('PostToolUse', { tool: 'Read', toolUseId: 'toolu_9', output: 'file…' }));
    expect(h.items('s')[0]).toMatchObject({ kind: 'tool', id: 'toolu_9', status: 'success', label: 'Read' });
    h.record('s', ev('PreToolUse', { tool: 'Shell', text: 'Shell · ls', toolInput: { command: 'ls' } }, 1));
    h.record('s', ev('PreToolUse', { tool: 'Shell', text: 'Shell · pwd', toolInput: { command: 'pwd' } }, 2));
    h.record('s', ev('PostToolUseFailure', { tool: 'Shell', error: 'exit 2' }, 3));
    const tools = h.items('s').filter(i => i.kind === 'tool');
    expect(tools.map(t => t.kind === 'tool' && t.status)).toEqual(['success', 'running', 'failed']);
    expect(tools[2]).toMatchObject({ error: 'exit 2' });
  });

  it('attaches files to the action and a permission gets its decision', () => {
    const h = new History();
    h.record('s', ev('PreToolUse', { tool: 'Edit', text: 'Edit · a.ts', toolUseId: 'toolu_2', toolInput: { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' } }));
    expect(h.items('s')[0]).toMatchObject({ kind: 'tool', files: [{ path: '/w/a.ts', change: 'edit', diff: '- a\n+ b' }] });
    h.record('s', ev('PermissionRequest', { tool: 'Bash', text: 'rm -rf dist' }, 1));
    h.record('s', ev('PermissionRequest', { tool: 'Bash', text: 'rm -rf dist' }, 1)); // Notification + hook: one row
    expect(h.items('s').filter(i => i.kind === 'permission')).toHaveLength(1);
    h.record('s', ev('Decided', { source: 'daemon' }, 2));
    expect(h.items('s')[1]).toMatchObject({ kind: 'permission', decision: 'unknown' });
    h.decide('s', 'deny');
    expect(h.items('s')[1]).toMatchObject({ decision: 'deny' });
  });

  it('follows a helper: its row, its own actions, its report', () => {
    const h = new History();
    h.record('s', ev('UserPromptSubmit', { text: 'Revois le reducer' }));
    h.record('s', ev('SubagentStart', { helperId: 'h1', tool: 'Explore', text: 'find reducer consumers' }, 1));
    h.record('s', ev('PreToolUse', { helperId: 'h1', tool: 'Grep', text: 'Grep · reduce(', toolUseId: 'toolu_5' }, 2));
    h.record('s', ev('SubagentStop', { helperId: 'h1', tool: 'Explore', text: '3 consumers found.' }, 3));
    const items = h.items('s');
    expect(items.map(i => `${i.kind}${i.helperId ? '@' + i.helperId : ''}`)).toEqual(['prompt', 'helper', 'tool@h1', 'reply@h1']);
    expect(items[1]).toMatchObject({ kind: 'helper', id: 'h1', task: 'find reducer consumers', agentType: 'Explore', state: 'exited', turn: 1 });
    expect(items[3]).toMatchObject({ id: 'report-h1', text: '3 consumers found.' });
    // A Claude helper whose task only arrives with the meta file: the row takes it.
    h.record('s', ev('SubagentStart', { helperId: 'h2', tool: 'general-purpose', task: 'review task 1' }, 4));
    expect(h.items('s')[4]).toMatchObject({ kind: 'helper', task: 'review task 1' });
  });

  it('ignores pane and daemon noise', () => {
    const h = new History();
    for (const name of ['PaneChanged', 'PaneIdle', 'PaneTitle', 'Renamed', 'SessionStart', 'Notification'] as const) h.record('s', ev(name, { text: 'x' }));
    expect(h.items('s')).toEqual([]);
  });

  it('persists one line per change, reloads with the last line winning, caps the memory and survives a bad line', async () => {
    const h = new History();
    h.record('s', ev('PreToolUse', { tool: 'Bash', text: 'Bash · ls', toolUseId: 'toolu_1' }));
    h.record('s', ev('PostToolUse', { tool: 'Bash', toolUseId: 'toolu_1', output: 'a b' }, 1));
    for (let i = 0; i < MAX_ITEMS + 20; i++) h.record('s', ev('PreToolUse', { tool: 'Read', text: `Read · ${i}`, toolUseId: `r${i}` }, 2 + i));
    await h.flush();
    const lines = readFileSync(join(dir, 'history', 's.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(MAX_ITEMS + 22);
    expect(h.items('s')).toHaveLength(MAX_ITEMS);
    expect(h.items('s')[0]).toMatchObject({ id: 'r20' });
    writeFileSync(join(dir, 'history', 's.jsonl'), lines.join('\n') + '\n{not json\n');
    const again = new History(); await again.load();
    expect(again.items('s')).toHaveLength(MAX_ITEMS);
    expect(again.items('s').at(-1)).toMatchObject({ id: `r${MAX_ITEMS + 19}` });
    again.forget('s');
    expect(again.items('s')).toEqual([]);
    expect(() => readFileSync(join(dir, 'history', 's.jsonl'))).toThrow();
  });

  it('numbers the turns after a reload', async () => {
    mkdirSync(join(dir, 'history'), { recursive: true });
    writeFileSync(join(dir, 'history', 'z.jsonl'), JSON.stringify({ kind: 'prompt', id: 'prompt-3', at: T0, turn: 3, text: 'x' }) + '\n');
    const h = new History(); await h.load();
    h.record('z', ev('UserPromptSubmit', { text: 'y' }, 1));
    expect(h.items('z').at(-1)).toMatchObject({ id: 'prompt-4', turn: 4 });
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @paradow/ledge test -- history`
Expected: FAIL — module introuvable ; `paths().history` est `undefined`.

- [ ] **Step 3 : `paths()`**

Dans `packages/ledge/src/paths.ts`, ajouter à l'objet rendu par `paths()` : `history: join(dir, 'history')` (même construction que `journal`).

- [ ] **Step 4 : Implémenter `packages/ledge/src/daemon/history.ts`**

```ts
import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEvent, ThreadItem, ToolItem } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';
import { filesOf } from './files.js';

/** Native tracking (spec 2026-10-13 §3–4): one thread per session, reduced from the events the store applies. */
export const MAX_ITEMS = 400;
type Listener = (id: string, item: ThreadItem) => void;

const str = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined;
/** What an action's row shows when unfolded: the command, or the input as JSON. */
function inputText(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const cmd = input.command;
  if (typeof cmd === 'string') return cmd;
  if (Array.isArray(cmd)) return cmd.map(String).join(' ');
  const text = JSON.stringify(input, null, 2);
  return text === '{}' ? undefined : text;
}

export class History {
  private threads = new Map<string, ThreadItem[]>();
  private turns = new Map<string, number>();
  private listeners = new Set<Listener>();
  private writes: Promise<void> = Promise.resolve();
  private readonly dir: string;
  constructor(opts: { dir?: string } = {}) { this.dir = opts.dir ?? paths().history; }

  items(id: string): ThreadItem[] { return this.threads.get(id) ?? []; }
  onItem(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  /** Waits for the journal writes issued so far (tests, shutdown). */
  flush(): Promise<void> { return this.writes; }

  /** Reads every `<id>.jsonl`: one item per line, the last line of an id wins, a bad line is skipped. */
  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      const byId = new Map<string, ThreadItem>();
      for (const line of (await readFile(join(this.dir, name), 'utf8')).split('\n')) {
        if (!line.trim()) continue;
        try { const it = JSON.parse(line) as ThreadItem; byId.delete(it.id); byId.set(it.id, it); } catch { /* a partial or corrupt line: skip it */ }
      }
      const items = [...byId.values()].slice(-MAX_ITEMS);
      this.threads.set(id, items);
      this.turns.set(id, items.reduce((n, it) => Math.max(n, it.turn), 0));
    }
  }

  forget(id: string): void {
    this.threads.delete(id); this.turns.delete(id);
    this.writes = this.writes.then(() => rm(join(this.dir, `${id}.jsonl`), { force: true })).catch(e => log(`history not removed for ${id}: ${(e as Error).message}`));
  }

  /** The user's own decision, sent from the overlay: it lands on the last permission still undecided or only seen to vanish. */
  decide(id: string, decision: 'accept' | 'deny'): ThreadItem | undefined {
    const perm = [...this.items(id)].reverse().find(i => i.kind === 'permission' && (i.decision === undefined || i.decision === 'unknown'));
    return perm && perm.kind === 'permission' ? this.put(id, { ...perm, decision }) : undefined;
  }

  record(id: string, ev: SessionEvent): ThreadItem | undefined {
    const turn = this.turns.get(id) ?? 0;
    const common = { at: ev.at, turn, ...(ev.helperId ? { helperId: ev.helperId } : {}) };
    switch (ev.name) {
      case 'UserPromptSubmit': {
        if (!ev.text) return undefined;
        this.turns.set(id, turn + 1);
        return this.put(id, { kind: 'prompt', id: `prompt-${turn + 1}`, at: ev.at, turn: turn + 1, text: ev.text });
      }
      case 'PreToolUse': {
        if (!ev.tool) return undefined;
        const existing = ev.toolUseId && this.items(id).find(i => i.id === ev.toolUseId);
        if (existing) return existing; // the result came first (parallel hooks): keep what it said
        const input = inputText(ev.toolInput);
        return this.put(id, { kind: 'tool', id: ev.toolUseId ?? `tool-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, label: ev.text ?? ev.tool, ...(input ? { input } : {}), status: 'running', files: filesOf(ev.tool, ev.toolInput) });
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        if (!ev.tool) return undefined;
        const failed = ev.name === 'PostToolUseFailure';
        const row = this.callFor(id, ev);
        const base: ToolItem = row ?? { kind: 'tool', id: ev.toolUseId ?? `tool-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, label: ev.text ?? ev.tool, status: 'running', files: filesOf(ev.tool, ev.toolInput) };
        const error = failed ? ev.error ?? (ev.interrupt ? 'interrupted' : 'failed') : undefined;
        return this.put(id, { ...base, status: failed ? 'failed' : 'success', ...(ev.output !== undefined ? { output: ev.output } : {}), ...(error ? { error } : {}), ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}) });
      }
      case 'PermissionRequest': {
        if (!ev.tool || !ev.text) return undefined;
        const last = [...this.items(id)].reverse().find(i => i.kind === 'permission');
        if (last && last.kind === 'permission' && last.decision === undefined && last.text === ev.text) return last;
        return this.put(id, { kind: 'permission', id: `perm-${ev.at}-${this.items(id).length}`, ...common, tool: ev.tool, text: ev.text });
      }
      case 'Decided': {
        const perm = [...this.items(id)].reverse().find(i => i.kind === 'permission' && i.decision === undefined);
        return perm && perm.kind === 'permission' ? this.put(id, { ...perm, decision: ev.decision ?? 'unknown' }) : undefined;
      }
      case 'Stop': return ev.text ? this.put(id, { kind: 'reply', id: `reply-${turn}`, at: ev.at, turn, text: ev.text }) : undefined;
      case 'SubagentStart': {
        if (!ev.helperId) return undefined;
        const task = ev.text ?? ev.task ?? '';
        const prev = this.items(id).find(i => i.id === ev.helperId);
        if (prev) return prev;
        return this.put(id, { kind: 'helper', id: ev.helperId, at: ev.at, turn, task, ...(ev.tool ? { agentType: ev.tool } : {}), state: 'working' });
      }
      case 'SubagentStop': {
        if (!ev.helperId) return undefined;
        const prev = this.items(id).find(i => i.id === ev.helperId);
        const row = prev && prev.kind === 'helper' ? prev : { kind: 'helper' as const, id: ev.helperId, at: ev.at, turn, task: ev.task ?? '', ...(ev.tool ? { agentType: ev.tool } : {}), state: 'working' as const };
        this.put(id, { ...row, state: 'exited' });
        return ev.text ? this.put(id, { kind: 'reply', id: `report-${ev.helperId}`, at: ev.at, turn, helperId: ev.helperId, text: ev.text }) : undefined;
      }
      default: return undefined;
    }
  }

  /** The row a result belongs to: by id, else the last running call of that tool in the same thread (Cursor gives no id). */
  private callFor(id: string, ev: SessionEvent): ToolItem | undefined {
    const items = this.items(id);
    if (ev.toolUseId) { const hit = items.find(i => i.id === ev.toolUseId); if (hit?.kind === 'tool') return hit; }
    return [...items].reverse().find((i): i is ToolItem => i.kind === 'tool' && i.tool === ev.tool && i.status === 'running' && i.helperId === ev.helperId);
  }

  private put(id: string, item: ThreadItem): ThreadItem {
    const items = [...this.items(id)];
    const at = items.findIndex(i => i.id === item.id);
    if (at >= 0) items[at] = item; else items.push(item);
    this.threads.set(id, items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items);
    for (const l of this.listeners) { try { l(id, item); } catch (e) { log(`history listener failed: ${(e as Error).message}`); } }
    const line = JSON.stringify(item) + '\n';
    this.writes = this.writes.then(() => mkdir(this.dir, { recursive: true })).then(() => appendFile(join(this.dir, `${id}.jsonl`), line)).catch(e => log(`history not written for ${id}: ${(e as Error).message}`));
    return item;
  }
}
```

- [ ] **Step 5 : Vérifier le succès**

Run: `pnpm --filter @paradow/ledge test -- history && pnpm --filter @paradow/ledge typecheck`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add packages/ledge/src/daemon/history.ts packages/ledge/src/paths.ts packages/ledge/test/history.test.ts
git commit -m "feat(daemon): session history reduced from hook events, journaled as JSONL"
```

### Task 6 : Daemon — les messages de l'agent depuis le tail du transcript

**Files:**
- Create: `packages/ledge/src/daemon/transcript.ts`
- Modify: `packages/ledge/src/daemon/history.ts` (ajout de `sync` et `SYNC_MS`)
- Test: `packages/ledge/test/transcript.test.ts`, `packages/ledge/test/history.test.ts`

**Interfaces:**
- Produces: `export type AgentText = { id: string; at: string; text: string }`, `export const TAIL_BYTES = 512 * 1024`, `export function tailLines(path: string, bytes?: number): string[]`, `export function agentMessages(path: string, bytes?: number): AgentText[]` ; `History.sync(id: string, path: string, opts?: { helperId?: string; force?: boolean; now?: number }): ThreadItem[]`, `export const SYNC_MS = 1000`.

- [ ] **Step 1 : Tests qui échouent**

Créer `packages/ledge/test/transcript.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentMessages, tailLines, TAIL_BYTES } from '../src/daemon/transcript.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-')); });
const claude = (uuid: string, ts: string, content: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ uuid, timestamp: ts, type: 'assistant', message: { role: 'assistant', content }, ...extra });
const codex = (id: string, ts: string, type: string, text: string, kind = 'event_msg') => JSON.stringify({ timestamp: ts, type: kind, payload: { type: 'item_completed', thread_id: 't', turn_id: 'u', item: { type, id, content: [{ type: 'Text', text }] } } });

describe('transcript tail', () => {
  it('returns whole lines only, dropping a cut first line and an unfinished last one', () => {
    const p = join(dir, 't.jsonl');
    writeFileSync(p, 'first line that is cut\n{"a":1}\n{"b":2}\n{"c":');
    expect(tailLines(p, 24)).toEqual(['{"a":1}', '{"b":2}']);
    expect(tailLines(join(dir, 'missing.jsonl'))).toEqual([]);
    expect(TAIL_BYTES).toBe(512 * 1024);
  });
});

describe('agentMessages', () => {
  it('reads a Claude transcript: text blocks of assistant entries, not thinking, tool use or sidechains', () => {
    const p = join(dir, 'c.jsonl');
    writeFileSync(p, [
      JSON.stringify({ uuid: 'u0', timestamp: '2026-10-13T10:00:00.000Z', type: 'user', message: { role: 'user', content: 'Fais le plan' } }),
      claude('u1', '2026-10-13T10:00:01.000Z', [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Je regarde le reducer. ' }]),
      claude('u2', '2026-10-13T10:00:02.000Z', [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }]),
      claude('u3', '2026-10-13T10:00:03.000Z', [{ type: 'text', text: 'Side' }], { isSidechain: true }),
      claude('u4', '2026-10-13T10:00:04.000Z', [{ type: 'text', text: 'Trois consommateurs.' }])
    ].join('\n') + '\n');
    expect(agentMessages(p)).toEqual([
      { id: 'u1', at: '2026-10-13T10:00:01.000Z', text: 'Je regarde le reducer.' },
      { id: 'u4', at: '2026-10-13T10:00:04.000Z', text: 'Trois consommateurs.' }
    ]);
  });
  it('reads a Codex rollout: completed AgentMessage items once, response_item copies ignored', () => {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, [
      JSON.stringify({ timestamp: '2026-10-13T10:00:00.000Z', type: 'session_meta', payload: { id: 'x', cwd: '/w' } }),
      codex('i1', '2026-10-13T10:00:01.000Z', 'AgentMessage', 'Je lance les tests.'),
      codex('i1', '2026-10-13T10:00:01.000Z', 'AgentMessage', 'Je lance les tests.', 'response_item'),
      codex('i2', '2026-10-13T10:00:02.000Z', 'CommandExecution', 'pnpm test'),
      codex('i3', '2026-10-13T10:00:03.000Z', 'Reasoning', '…'),
      '{"truncated":'
    ].join('\n'));
    expect(agentMessages(p)).toEqual([{ id: 'i1', at: '2026-10-13T10:00:01.000Z', text: 'Je lance les tests.' }]);
  });
});
```

Ajouter à `packages/ledge/test/history.test.ts` (importer `SYNC_MS` et `writeFileSync` est déjà importé) :

```ts
  it('syncs the agent messages of the current turn once a second, forced at the end of a turn, and the helper ones under its id', () => {
    const p = join(dir, 'c.jsonl');
    const line = (uuid: string, ts: string, text: string) => JSON.stringify({ uuid, timestamp: ts, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
    writeFileSync(p, [line('u0', later(-5), 'Vieux tour'), line('u1', later(1), 'Je regarde.')].join('\n') + '\n');
    const h = new History();
    expect(h.sync('s', p, { now: 1000 })).toEqual([]); // no prompt known yet: nothing to anchor the turn on
    h.record('s', ev('UserPromptSubmit', { text: 'Fais le plan' }));
    expect(h.sync('s', p, { now: 2000 }).map(i => i.id)).toEqual(['msg-u1']);
    expect(h.items('s')[1]).toMatchObject({ kind: 'message', text: 'Je regarde.', turn: 1, at: later(1) });
    writeFileSync(p, line('u2', later(2), 'Puis je corrige.') + '\n', { flag: 'a' });
    expect(h.sync('s', p, { now: 2000 + SYNC_MS - 1 })).toEqual([]); // throttled
    expect(h.sync('s', p, { now: 2000 + SYNC_MS - 1, force: true }).map(i => i.id)).toEqual(['msg-u2']);
    expect(h.sync('s', p, { now: 5000 })).toEqual([]); // nothing new
    const hp = join(dir, 'agent-h1.jsonl');
    writeFileSync(hp, line('a1', later(3), 'Je cherche les appels.') + '\n');
    h.record('s', ev('SubagentStart', { helperId: 'h1', tool: 'Explore', text: 'find consumers' }, 3));
    expect(h.sync('s', hp, { helperId: 'h1', force: true })[0]).toMatchObject({ kind: 'message', id: 'msg-a1', helperId: 'h1' });
  });
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @paradow/ledge test -- transcript history`
Expected: FAIL — module `transcript` introuvable ; `h.sync is not a function`.

- [ ] **Step 3 : Implémenter `packages/ledge/src/daemon/transcript.ts`**

```ts
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** Native tracking (spec 2026-10-13 §2, §4): the agent's own messages, read from the tail of what the harness writes. */
export type AgentText = { id: string; at: string; text: string };
export const TAIL_BYTES = 512 * 1024;

/** The last `bytes` of a JSONL file as whole lines: a line cut by the window, or still being written, is dropped. */
export function tailLines(path: string, bytes = TAIL_BYTES): string[] {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return []; }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (start > 0) lines.shift();
    if (!text.endsWith('\n')) lines.pop();
    return lines.filter(l => l.trim());
  } finally { closeSync(fd); }
}

type Block = { type?: string; text?: string };
const texts = (blocks: unknown, kind: string): string =>
  (Array.isArray(blocks) ? blocks as Block[] : []).filter(b => b?.type === kind && typeof b.text === 'string').map(b => b.text!.trim()).filter(Boolean).join('\n\n');

export function agentMessages(path: string, bytes = TAIL_BYTES): AgentText[] {
  const out: AgentText[] = [];
  for (const line of tailLines(path, bytes)) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const at = typeof e.timestamp === 'string' ? e.timestamp : undefined;
    if (!at) continue;
    // Claude Code: an assistant entry's text blocks. Thinking and tool_use are not messages; sidechains belong to helpers.
    if (e.type === 'assistant' && e.isSidechain !== true) {
      const text = texts((e.message as { content?: unknown } | undefined)?.content, 'text');
      if (text && typeof e.uuid === 'string') out.push({ id: e.uuid, at, text });
      continue;
    }
    // Codex: a completed AgentMessage item. The response_item lines repeat it and are skipped.
    if (e.type === 'event_msg') {
      const p = e.payload as { type?: string; item?: { type?: string; id?: string; content?: unknown } } | undefined;
      const item = p?.type === 'item_completed' ? p.item : undefined;
      if (item?.type !== 'AgentMessage' || typeof item.id !== 'string') continue;
      const text = texts(item.content, 'Text');
      if (text) out.push({ id: item.id, at, text });
    }
  }
  return out;
}
```

- [ ] **Step 4 : Ajouter `sync` à `History`**

Dans `packages/ledge/src/daemon/history.ts` : importer `agentMessages`, exporter `export const SYNC_MS = 1000;`, ajouter le champ `private synced = new Map<string, number>();` et la méthode :

```ts
  /** Inserts the agent's messages the transcript holds and the thread lacks, from the current turn's prompt on (or the
   *  helper's start). At most once a second per thread unless forced (end of a turn). */
  sync(id: string, path: string, opts: { helperId?: string; force?: boolean; now?: number } = {}): ThreadItem[] {
    const key = `${id}/${opts.helperId ?? ''}`; const now = opts.now ?? Date.now();
    if (!opts.force && now - (this.synced.get(key) ?? 0) < SYNC_MS) return [];
    this.synced.set(key, now);
    const items = this.items(id);
    const since = opts.helperId ? items.find(i => i.id === opts.helperId)?.at : [...items].reverse().find(i => i.kind === 'prompt')?.at;
    if (!since) return []; // a daemon that joined mid-turn: the old tail would flood the thread
    const have = new Set(items.map(i => i.id));
    const turn = this.turns.get(id) ?? 0;
    const added: ThreadItem[] = [];
    for (const m of agentMessages(path)) {
      if (m.at < since || have.has(`msg-${m.id}`)) continue;
      added.push(this.put(id, { kind: 'message', id: `msg-${m.id}`, at: m.at, turn, text: m.text, ...(opts.helperId ? { helperId: opts.helperId } : {}) }));
    }
    return added;
  }
```

- [ ] **Step 5 : Vérifier le succès**

Run: `pnpm --filter @paradow/ledge test -- transcript history && pnpm --filter @paradow/ledge typecheck`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add packages/ledge/src/daemon/transcript.ts packages/ledge/src/daemon/history.ts packages/ledge/test/transcript.test.ts packages/ledge/test/history.test.ts
git commit -m "feat(daemon): agent messages from the transcript tail, synced into the thread"
```

### Task 7 : Serveur — répondre `session.thread`, diffuser les éléments, brancher l'historique

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts` (`startServer` ligne 69, `store.onChange` ligne 95, `case 'session.event'`, `case 'session.decide'`, `handle`)
- Modify: `packages/ledge/src/daemon/index.ts` (`startDaemon`, lignes 14–32)
- Test: `packages/ledge/test/server.test.ts`

**Interfaces:**
- Consumes: `History` (tâches 5–6), `Store.onEvent` (tâche 3), messages `session.thread` / `session.thread.item` (tâche 1).
- Produces: `startServer({ …, history?: History })` ; `startDaemon` crée `new History()`, l'appelle `load()` et attend `flush()` à l'arrêt.

- [ ] **Step 1 : Tests qui échouent**

Dans `packages/ledge/test/server.test.ts`, importer `History` depuis `'../src/daemon/history.js'` et ajouter :

```ts
describe('session thread (spec 2026-10-13 §5)', () => {
  it('answers a thread request, broadcasts each item, syncs the transcript, records the decision and forgets a removed session', async () => {
    const store = new Store(); const history = new History({ dir: join(dir, 'history') });
    const transcript = join(dir, 'c.jsonl');
    writeFileSync(transcript, JSON.stringify({ uuid: 'u1', timestamp: '2026-10-09T18:00:30.000Z', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Je lance les tests.' }] } }) + '\n');
    store.upsert(mk('a'));
    const server = await startServer({ store, tmux: fakeTmux({ 'ledge-a': ['Do you want to proceed?'] }), port: 0, history });
    const c = await connect({ port: server.port, host: '127.0.0.1', timeoutMs: 2000 });
    await c.next('snapshot', 2000);
    c.send({ type: 'session.thread', id: 'a' });
    expect(await c.next('session.thread', 2000)).toEqual({ type: 'session.thread', id: 'a', items: [] });
    c.send({ type: 'session.event', id: 'a', event: { name: 'UserPromptSubmit', at: T0, source: 'hook', text: 'Lance les tests', transcriptPath: transcript } });
    expect(await c.next('session.thread.item', 2000)).toMatchObject({ id: 'a', item: { kind: 'prompt', text: 'Lance les tests' } });
    c.send({ type: 'session.event', id: 'a', event: { name: 'PreToolUse', at: '2026-10-09T18:01:00.000Z', source: 'hook', tool: 'Bash', text: 'Bash · pnpm test', toolUseId: 'toolu_1', transcriptPath: transcript } });
    expect(await c.next('session.thread.item', 2000)).toMatchObject({ item: { kind: 'message', id: 'msg-u1' } }); // synced before the row
    expect(await c.next('session.thread.item', 2000)).toMatchObject({ item: { kind: 'tool', id: 'toolu_1', status: 'running' } });
    c.send({ type: 'session.event', id: 'a', event: { name: 'PermissionRequest', at: '2026-10-09T18:02:00.000Z', source: 'hook', tool: 'Bash', text: 'pnpm test' } });
    expect(await c.next('session.thread.item', 2000)).toMatchObject({ item: { kind: 'permission', text: 'pnpm test' } });
    await c.next('session.updated', 2000);
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    await until(() => history.items('a').some(i => i.kind === 'permission' && i.decision === 'accept'), 2000);
    store.remove('a');
    await until(() => history.items('a').length === 0, 1000);
    c.close(); await server.close();
  });
  it('answers an unknown session with an empty thread and works without a history', async () => {
    const store = new Store();
    const server = await startServer({ store, tmux: fakeTmux({}), port: 0 });
    const c = await connect({ port: server.port, host: '127.0.0.1', timeoutMs: 2000 });
    await c.next('snapshot', 2000);
    c.send({ type: 'session.thread', id: 'nope' });
    expect(await c.next('session.thread', 2000)).toEqual({ type: 'session.thread', id: 'nope', items: [] });
    c.close(); await server.close();
  });
});
```

`until` vient de `./helpers.js` (déjà présent dans le dossier de tests) ; `dir` est le `mkdtemp` du `beforeEach` du fichier.

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter @paradow/ledge test -- server`
Expected: FAIL — `history` n'est pas une option connue ; aucun message `session.thread` ne revient.

- [ ] **Step 3 : Implémenter**

`packages/ledge/src/daemon/server.ts` :

- Importer `import type { History } from './history.js';` et ajouter `history?: History` aux options de `startServer`.
- Après la définition de `broadcast` :

```ts
  const history = opts.history;
  const unsubscribeHistory = history ? [
    history.onItem((id, item) => broadcast({ type: 'session.thread.item', id, item })),
    store.onEvent((id, ev) => history.record(id, ev)),
    store.onChange(c => { if (c.type === 'removed') history.forget(c.id); })
  ] : [];
```

  et dans `close()`, appeler chaque fonction de `unsubscribeHistory` à côté de `unsubscribe()`.

- Dans `case 'session.event'`, avant la création ou l'application :

```ts
        const ev = msg.event;
        // The agent's text precedes the action it announces: sync the parent's transcript before the row lands.
        const ownTurn = !ev.helperId && (ev.name === 'PreToolUse' || ev.name === 'PermissionRequest' || ev.name === 'Stop');
        const helperEnd = ev.name === 'SubagentStop' && !!ev.helperId;
        if (history && ev.transcriptPath && (ownTurn || helperEnd)) {
          try { history.sync(msg.id, ev.transcriptPath, { helperId: helperEnd ? ev.helperId : undefined, force: ev.name === 'Stop' || helperEnd }); }
          catch (e) { log(`transcript not read for ${msg.id}: ${(e as Error).message}`); }
        }
```

- Nouveau cas, à côté de `session.rename` :

```ts
      case 'session.thread':
        return send(ws, { type: 'session.thread', id: msg.id, items: history?.items(msg.id) ?? [] });
```

- Dans `case 'session.decide'`, juste après l'`await` de la décision réussie (avant son `return`) : `history?.decide(msg.id, msg.decision);`.

`packages/ledge/src/daemon/index.ts` :

```ts
  const history = new History();
  await history.load();
  const server = await startServer({ store, tmux, port: opts.port, daemon, updater, history });
```

  et dans `stop`, après `await store.save()` : `await history.flush();`. Importer `History` depuis `'./history.js'`.

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter @paradow/ledge test && pnpm --filter @paradow/ledge typecheck`
Expected: PASS, toute la suite du paquet.

- [ ] **Step 5 : Commit**

```bash
git add packages/ledge/src/daemon/server.ts packages/ledge/src/daemon/index.ts packages/ledge/test/server.test.ts
git commit -m "feat(daemon): serve and broadcast session threads"
```

### Task 8 : Overlay — les fils dans le store, demandés à l'ouverture

**Files:**
- Modify: `apps/overlay/src/daemon/store.ts` (`DaemonState`, `empty()`, `apply`)
- Modify: `apps/overlay/src/surface/Surface.tsx` (près de `const send`, ligne 540)
- Test: `apps/overlay/test/daemon.test.ts`

**Interfaces:**
- Consumes: messages `session.thread`, `session.thread.item` (tâche 1).
- Produces: `DaemonState.threads: Map<string, ThreadItem[]>` — présent seulement pour les sessions dont le fil a été reçu ; un `session.thread.item` d'une session sans fil chargé est ignoré (le fil complet viendra à l'ouverture). Un `snapshot` vide la carte ; `session.removed` retire le fil. `Surface` envoie `{ type: 'session.thread', id }` quand une session s'ouvre sans fil chargé.

- [ ] **Step 1 : Test qui échoue**

Dans `apps/overlay/test/daemon.test.ts` :

```ts
  it('keeps a session thread, updates its items in place, ignores items of a thread it never loaded, forgets removed ones', () => {
    daemonStore.reset();
    const at = '2026-10-13T10:00:00.000Z';
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a'), fakeSession('b')] });
    daemonStore.apply({ type: 'session.thread.item', id: 'b', item: { kind: 'prompt', id: 'p1', at, turn: 1, text: 'x' } });
    expect(daemonStore.getState().threads.has('b')).toBe(false);
    daemonStore.apply({ type: 'session.thread', id: 'a', items: [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Lance les tests' }, { kind: 'tool', id: 'toolu_1', at, turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'running', files: [] }] });
    daemonStore.apply({ type: 'session.thread.item', id: 'a', item: { kind: 'tool', id: 'toolu_1', at, turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'success', output: 'ok', files: [] } });
    daemonStore.apply({ type: 'session.thread.item', id: 'a', item: { kind: 'reply', id: 'r1', at, turn: 1, text: 'Fini' } });
    const thread = daemonStore.getState().threads.get('a')!;
    expect(thread.map(i => i.id)).toEqual(['p1', 'toolu_1', 'r1']);
    expect(thread[1]).toMatchObject({ status: 'success', output: 'ok' });
    // A thread for a session that vanished meanwhile is kept harmlessly until its removal arrives.
    daemonStore.apply({ type: 'session.thread', id: 'gone', items: [] });
    daemonStore.apply({ type: 'session.removed', id: 'gone' });
    daemonStore.apply({ type: 'session.removed', id: 'a' });
    expect(daemonStore.getState().threads.size).toBe(0);
    daemonStore.apply({ type: 'session.thread', id: 'b', items: [] });
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('b')] });
    expect(daemonStore.getState().threads.size).toBe(0);
  });
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter overlay test -- daemon`
Expected: FAIL — `threads` est `undefined`.

- [ ] **Step 3 : Implémenter**

`apps/overlay/src/daemon/store.ts` : importer `ThreadItem` depuis `@ledge/protocol` ; ajouter `threads: Map<string, ThreadItem[]>;` à `DaemonState` avec le commentaire `/** Native tracking: the threads received so far, by session (asked for when a session opens). */`, `threads: new Map()` dans `empty()`, puis dans `apply` :

```ts
      case 'snapshot': /* existing code */ threads = new Map(); break;
      case 'session.removed': byId.delete(m.id); previews.delete(m.id); threads.delete(m.id); break;
      case 'session.thread': threads.set(m.id, m.items); break;
      case 'session.thread.item': {
        const cur = threads.get(m.id);
        if (!cur) break;
        const at = cur.findIndex(i => i.id === m.item.id);
        threads.set(m.id, at >= 0 ? cur.map((i, k) => (k === at ? m.item : i)) : [...cur, m.item]);
        break;
      }
```

(`threads` suit le même schéma de copie que `previews` dans cette fonction : copier la `Map` avant de la modifier, puis la remettre dans le nouvel état.)

`apps/overlay/src/surface/Surface.tsx` : lire `threads` depuis `useDaemon()` et, après `const send`, ajouter :

```tsx
  // The thread is not in the snapshot: ask for it when a session opens (or after a reconnection emptied the threads).
  const threadWanted = (st.mode === 'session' || st.mode === 'helper') ? st.selectedId : null;
  useEffect(() => {
    if (threadWanted && !threads.has(threadWanted) && status === 'open') send({ type: 'session.thread', id: threadWanted });
  }, [threadWanted, threads, status]);
```

(`st.mode === 'helper'` n'existe qu'à partir de la tâche 12 : ici, écrire seulement `st.mode === 'session'` et élargir en tâche 12.)

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter overlay test -- daemon && pnpm --filter overlay typecheck`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/overlay/src/daemon/store.ts apps/overlay/src/surface/Surface.tsx apps/overlay/test/daemon.test.ts
git commit -m "feat(overlay): keep session threads in the daemon store"
```

### Task 9 : Overlay — regroupement par tour (`turns.ts`) et textes FR/EN

**Files:**
- Create: `apps/overlay/src/thread/turns.ts`
- Modify: `apps/overlay/src/i18n/messages.ts` (`fr` et `en`)
- Test: `apps/overlay/test/turns.test.ts`

**Interfaces:**
- Produces: `export type Turn = { n: number; prompt?: Extract<ThreadItem, { kind: 'prompt' }>; reply?: Extract<ThreadItem, { kind: 'reply' }>; items: ThreadItem[] }` ; `export function turns(items: ThreadItem[]): Turn[]` (fil principal seulement, tours croissants, éléments triés par `at`, stable) ; `export function helperThread(items: ThreadItem[], helperId: string): { helper?: HelperItem; items: ThreadItem[]; report?: Extract<ThreadItem, { kind: 'reply' }> }` ; `export type HelperRow = { id: string; kind: string; task: string; state: Helper['state'] }` ; `export function helperRows(session: Session, items?: ThreadItem[]): HelperRow[]` ; `t.thread.*` (voir step 3).

- [ ] **Step 1 : Test qui échoue**

Créer `apps/overlay/test/turns.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import type { ThreadItem } from '@ledge/protocol';
import { turns, helperThread, helperRows } from '../src/thread/turns';
import { fakeSession } from './mockDaemon';

const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Lance les tests' },
  { kind: 'tool', id: 'toolu_1', at: at(2), turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'success', files: [] },
  { kind: 'message', id: 'msg-u1', at: at(1), turn: 1, text: 'Je lance les tests.' }, // synced after the row, said before it
  { kind: 'reply', id: 'reply-1', at: at(3), turn: 1, text: 'Tout passe.' },
  { kind: 'prompt', id: 'prompt-2', at: at(10), turn: 2, text: 'Revois le reducer' },
  { kind: 'helper', id: 'h1', at: at(11), turn: 2, task: 'find consumers', agentType: 'Explore', state: 'exited' },
  { kind: 'tool', id: 'toolu_5', at: at(12), turn: 2, helperId: 'h1', tool: 'Grep', label: 'Grep · reduce(', status: 'success', files: [] },
  { kind: 'message', id: 'msg-a1', at: at(11.5), turn: 2, helperId: 'h1', text: 'Je cherche.' },
  { kind: 'reply', id: 'report-h1', at: at(13), turn: 2, helperId: 'h1', text: '3 consumers.' },
  { kind: 'helper', id: 'h2', at: at(14), turn: 2, task: 'review task 1', agentType: 'general-purpose', state: 'working' }
];

describe('turns', () => {
  it('groups the main thread by turn, sorted by time, keeping helper items out', () => {
    const ts = turns(items);
    expect(ts.map(t => t.n)).toEqual([1, 2]);
    expect(ts[0]!.prompt?.text).toBe('Lance les tests');
    expect(ts[0]!.reply?.text).toBe('Tout passe.');
    expect(ts[0]!.items.map(i => i.id)).toEqual(['prompt-1', 'msg-u1', 'toolu_1', 'reply-1']);
    expect(ts[1]!.items.map(i => i.id)).toEqual(['prompt-2', 'h1', 'h2']);
    expect(turns([])).toEqual([]);
  });
  it('isolates a helper thread with its report', () => {
    const h = helperThread(items, 'h1');
    expect(h.helper?.task).toBe('find consumers');
    expect(h.items.map(i => i.id)).toEqual(['msg-a1', 'toolu_5']);
    expect(h.report?.text).toBe('3 consumers.');
    expect(helperThread(items, 'zz')).toEqual({ items: [] });
  });
  it('lists the current turn helpers, finished ones included, with the live state when the session knows it', () => {
    const s = fakeSession('a', { helpers: [{ id: 'h2', kind: 'general-purpose', task: 'review task 1', state: 'waiting_permission' }] });
    expect(helperRows(s, items)).toEqual([
      { id: 'h1', kind: 'Explore', task: 'find consumers', state: 'exited' },
      { id: 'h2', kind: 'general-purpose', task: 'review task 1', state: 'waiting_permission' }
    ]);
    // Without a thread: today's live helpers (exited and idle left out).
    const live = fakeSession('b', { helpers: [{ id: 'x', kind: 'Explore', task: 'a', state: 'exited' }, { id: 'y', kind: 'Explore', task: 'b', state: 'working' }] });
    expect(helperRows(live).map(r => r.id)).toEqual(['y']);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter overlay test -- turns`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter `apps/overlay/src/thread/turns.ts` et les textes**

```ts
import type { Helper, Session, ThreadItem, HelperItem } from '@ledge/protocol';
import { liveHelpers } from '../bots/poseFor';

type Prompt = Extract<ThreadItem, { kind: 'prompt' }>;
type Reply = Extract<ThreadItem, { kind: 'reply' }>;
export type Turn = { n: number; prompt?: Prompt; reply?: Reply; items: ThreadItem[] };
export type HelperRow = { id: string; kind: string; task: string; state: Helper['state'] };

const byTime = (a: ThreadItem, b: ThreadItem) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/** The main thread by turn (spec 2026-10-13 §6). Items are sorted by time: a synced message lands after the row it announced. */
export function turns(items: ThreadItem[]): Turn[] {
  const map = new Map<number, Turn>();
  for (const it of items) {
    if (it.helperId) continue;
    const t = map.get(it.turn) ?? { n: it.turn, items: [] };
    t.items.push(it);
    if (it.kind === 'prompt') t.prompt = it;
    if (it.kind === 'reply') t.reply = it;
    map.set(it.turn, t);
  }
  return [...map.values()].sort((a, b) => a.n - b.n).map(t => ({ ...t, items: [...t.items].sort(byTime) }));
}

/** A helper's own thread: its row, what it said and did (sorted by time), its report. */
export function helperThread(items: ThreadItem[], helperId: string): { helper?: HelperItem; items: ThreadItem[]; report?: Reply } {
  const helper = items.find((i): i is HelperItem => i.kind === 'helper' && i.id === helperId);
  const own = items.filter(i => i.helperId === helperId);
  const report = own.find((i): i is Reply => i.kind === 'reply');
  return { ...(helper ? { helper } : {}), items: own.filter(i => i.kind !== 'reply').sort(byTime), ...(report ? { report } : {}) };
}

/** The rows under the title: the current turn's helpers, finished ones kept (their thread stays readable); live state
 *  from the session when it has it. Without a thread, today's live helpers. */
export function helperRows(session: Session, items?: ThreadItem[]): HelperRow[] {
  if (!items) return liveHelpers(session).map(h => ({ id: h.id, kind: h.kind, task: h.task, state: h.state }));
  const last = turns(items).at(-1);
  if (!last) return [];
  return last.items.filter((i): i is HelperItem => i.kind === 'helper').map(h => {
    const live = session.helpers.find(x => x.id === h.id);
    return { id: h.id, kind: h.agentType ?? live?.kind ?? '', task: h.task || live?.task || '', state: live?.state ?? h.state };
  });
}
```

Dans `apps/overlay/src/i18n/messages.ts`, ajouter à `fr` (et son miroir dans `en`) :

```ts
  thread: {
    you: 'Vous', previousTurn: 'Tour précédent', noTime: 'Horodatage indisponible', loading: 'Le fil arrive…',
    empty: 'Le fil se remplit au prochain événement de l’agent.',
    command: 'Commande', params: 'Paramètres', result: 'Résultat', error: 'Erreur',
    noResult: 'Aucun résultat dans cette source. La réussite de cet appel est inconnue.',
    running: 'En cours', failed: 'Échec', received: 'Résultat reçu', waiting: 'En attente du résultat', unknownState: 'État inconnu', noDuration: 'Durée indisponible',
    file: { confirmed: 'Modification confirmée', writing: 'Écriture en cours', unconfirmed: 'Écriture non confirmée', add: 'ajouté', edit: 'modifié', delete: 'supprimé', write: 'écrit' },
    permission: 'Permission demandée', decided: { accept: 'Autorisée', deny: 'Refusée', unknown: 'Répondue dans le terminal' }, undecided: 'En attente de votre décision',
    cursorNote: 'Cette source ne transmet ni résultats ni messages intermédiaires.',
    helperOpen: 'Ouvrir la discussion', helperDone: 'Terminé', helperWorking: 'Au travail',
    backTo: 'Discussion principale', delegatedBy: 'Délégué par', instruction: 'Consigne', report: 'Rapport final', helperWaiting: 'attend son rapport…'
  },
```

```ts
  thread: {
    you: 'You', previousTurn: 'Previous turn', noTime: 'No timestamp', loading: 'Loading the thread…',
    empty: 'The thread fills up with the agent’s next event.',
    command: 'Command', params: 'Parameters', result: 'Result', error: 'Error',
    noResult: 'No result in this source. Whether this call succeeded is unknown.',
    running: 'Running', failed: 'Failed', received: 'Result received', waiting: 'Waiting for the result', unknownState: 'Unknown state', noDuration: 'Duration unavailable',
    file: { confirmed: 'Change confirmed', writing: 'Being written', unconfirmed: 'Write not confirmed', add: 'added', edit: 'edited', delete: 'deleted', write: 'written' },
    permission: 'Permission requested', decided: { accept: 'Allowed', deny: 'Denied', unknown: 'Answered in the terminal' }, undecided: 'Waiting for your decision',
    cursorNote: 'This source sends neither results nor intermediate messages.',
    helperOpen: 'Open the discussion', helperDone: 'Done', helperWorking: 'Working',
    backTo: 'Main discussion', delegatedBy: 'Delegated by', instruction: 'Instruction', report: 'Final report', helperWaiting: 'is waiting for its report…'
  },
```

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter overlay test -- turns && pnpm --filter overlay typecheck`
Expected: PASS (le typecheck garantit que `en` porte les mêmes clés que `fr`).

- [ ] **Step 5 : Commit**

```bash
git add apps/overlay/src/thread/turns.ts apps/overlay/src/i18n/messages.ts apps/overlay/test/turns.test.ts
git commit -m "feat(overlay): group a session thread by turn, thread copy in FR and EN"
```

### Task 10 : Overlay — le composant `Thread`

**Files:**
- Create: `apps/overlay/src/surface/Thread.tsx`
- Test: `apps/overlay/test/thread.test.tsx`

**Interfaces:**
- Consumes: `turns`, `Turn` (tâche 9), `duration`, `relativeTime` de `../format`, `Bot` de `../bots/Bot`, `botState`/`poseFor` de `../bots/poseFor`, `t.thread.*`.
- Produces: `export function Thread({ session, items, t, theme, paused, frozen, reducedMotion, now, hideCurrentReply = true }: ThreadProps)` ; `export function ActionRow({ item, t }: { item: ToolItem; t: Messages })` (réutilisé par la vue sous-agent) ; marqueurs DOM : `[data-thread]`, `[data-previous-turn]`, `[data-prompt]`, `[data-message]`, `[data-action][data-status=…]`, `[data-action-output]`, `[data-file][data-confirmed=…]`, `[data-permission][data-decision=…]`, `[data-source-note]`.

- [ ] **Step 1 : Test qui échoue**

Créer `apps/overlay/test/thread.test.tsx` :

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { Thread } from '../src/surface/Thread';
import { messagesFor } from '../src/i18n/messages';
import { fakeSession } from './mockDaemon';

const t = messagesFor('en');
const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Old ask' },
  { kind: 'reply', id: 'reply-1', at: at(1), turn: 1, text: 'Old answer' },
  { kind: 'prompt', id: 'prompt-2', at: at(10), turn: 2, text: 'Run the tests' },
  { kind: 'message', id: 'msg-1', at: at(11), turn: 2, text: 'Running them now.' },
  { kind: 'tool', id: 'toolu_1', at: at(12), turn: 2, tool: 'Bash', label: 'Bash · pnpm test', input: 'pnpm test', output: '12 passed', status: 'success', durationMs: 812, files: [] },
  { kind: 'tool', id: 'toolu_2', at: at(13), turn: 2, tool: 'Edit', label: 'Edit · a.ts', status: 'running', files: [{ path: '/w/a.ts', change: 'edit', diff: '- a\n+ b' }] },
  { kind: 'tool', id: 'toolu_3', at: at(14), turn: 2, tool: 'Bash', label: 'Bash · rm', status: 'failed', error: 'exit 1', files: [] },
  { kind: 'tool', id: 'toolu_4', at: at(15), turn: 2, tool: 'Read', label: 'Read · b.ts', status: 'success', files: [] },
  { kind: 'permission', id: 'perm-1', at: at(16), turn: 2, tool: 'Bash', text: 'rm -rf dist', decision: 'deny' },
  { kind: 'reply', id: 'reply-2', at: at(17), turn: 2, text: 'Done.' }
];

describe('<Thread>', () => {
  it('folds the previous turn, shows the current one in order and leaves the current reply to the card', () => {
    const { container } = render(<Thread session={fakeSession('a')} items={items} t={t} theme="dark" paused />);
    const prev = container.querySelector('[data-previous-turn]')!;
    expect(prev).toHaveTextContent('Previous turn');
    expect(prev).toHaveTextContent('Old answer');
    expect(prev).not.toHaveAttribute('open');
    const kinds = [...container.querySelectorAll('[data-thread] > [data-item]')].map(e => e.getAttribute('data-item'));
    expect(kinds).toEqual(['previous-turn', 'prompt', 'message', 'action', 'action', 'action', 'action', 'permission']);
    expect(container.querySelector('[data-prompt]')).toHaveTextContent('You');
    expect(container.querySelector('[data-prompt]')).toHaveTextContent('Run the tests');
    expect(container.querySelector('[data-message]')).toHaveTextContent('Running them now.');
    expect(container).not.toHaveTextContent('Done.');
    expect(container.textContent).not.toMatch(/\b[2-9] (actions|files|questions)\b/); // no counters, anywhere
  });
  it('unfolds an action with its command, result, state and duration; says what is missing', () => {
    const { container } = render(<Thread session={fakeSession('a')} items={items} t={t} theme="dark" paused />);
    const [ok, running, failed, silent] = [...container.querySelectorAll('[data-action]')];
    expect(ok).toHaveAttribute('data-status', 'success');
    fireEvent.click(ok!.querySelector('summary')!);
    expect(ok).toHaveTextContent('Command');
    expect(ok!.querySelector('[data-action-output]')).toHaveTextContent('12 passed');
    expect(ok).toHaveTextContent('Result received');
    expect(ok).toHaveTextContent('0.8 s');
    expect(running).toHaveAttribute('data-status', 'running');
    expect(running).toHaveTextContent('Running');
    const file = running!.querySelector('[data-file]')!;
    expect(file).toHaveAttribute('data-confirmed', 'false');
    expect(file).toHaveTextContent('/w/a.ts');
    expect(file).toHaveTextContent('Being written');
    fireEvent.click(file.querySelector('summary')!);
    expect(file).toHaveTextContent('- a');
    expect(failed).toHaveAttribute('data-status', 'failed');
    fireEvent.click(failed!.querySelector('summary')!);
    expect(failed).toHaveTextContent('Error');
    expect(failed).toHaveTextContent('exit 1');
    fireEvent.click(silent!.querySelector('summary')!);
    expect(silent).toHaveTextContent('No result in this source.');
    expect(silent).toHaveTextContent('Duration unavailable');
    expect(container.querySelector('[data-permission]')).toHaveAttribute('data-decision', 'deny');
    expect(container.querySelector('[data-permission]')).toHaveTextContent('Denied');
  });
  it('tells what a Cursor session cannot show and what an empty thread waits for', () => {
    const { container, rerender } = render(<Thread session={fakeSession('c', { tool: 'cursor' })} items={items.slice(2, 3)} t={t} theme="dark" paused />);
    expect(container.querySelector('[data-source-note]')).toHaveTextContent('neither results nor intermediate messages');
    rerender(<Thread session={fakeSession('a')} items={[]} t={t} theme="dark" paused />);
    expect(screen.getByText('The thread fills up with the agent’s next event.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter overlay test -- thread`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter `apps/overlay/src/surface/Thread.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { Session, ThreadItem, ToolItem, FileChange } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import { duration, relativeTime } from '../format';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { turns, type Turn } from '../thread/turns';

export interface ThreadProps {
  session: Session; items: ThreadItem[]; t: Messages; theme: 'dark' | 'light';
  paused: boolean; frozen?: boolean; reducedMotion?: boolean; now?: number;
  /** The main view shows the current reply as the card below the thread; the helper view shows it as its report. */
  hideCurrentReply?: boolean;
}

const mono = { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } as const;
const pre = { ...mono, margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: '17px', whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', maxHeight: 220, overflow: 'auto' };
const muted = { fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' } as const;
const label = { fontSize: 10, lineHeight: '14px', letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'var(--muted-foreground)', margin: '8px 0 4px' };

const STATUS_MARK: Record<ToolItem['status'], { mark: string; color: string }> = {
  success: { mark: '✓', color: 'var(--success, var(--sidebar-primary))' }, failed: { mark: '!', color: 'var(--destructive)' },
  running: { mark: '◌', color: 'var(--warning)' }, unknown: { mark: '·', color: 'var(--muted-foreground)' }
};

function FileRow({ file, status, t }: { file: FileChange; status: ToolItem['status']; t: Messages }) {
  const confirmed = status === 'success';
  const state = confirmed ? t.thread.file.confirmed : status === 'running' ? t.thread.file.writing : t.thread.file.unconfirmed;
  return (
    <details data-file data-confirmed={confirmed ? 'true' : 'false'} style={{ margin: '0 0 0 25px' }}>
      <summary style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer', listStyle: 'none' }}>
        <span aria-hidden style={{ color: confirmed ? 'var(--success, var(--sidebar-primary))' : 'var(--muted-foreground)', fontSize: 13 }}>{confirmed ? '✓' : '·'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ ...mono, display: 'block', fontSize: 11, lineHeight: '16px', fontWeight: 500, overflowWrap: 'anywhere' }}>{file.path}</strong>
          <small style={{ ...muted, display: 'block', fontSize: 10 }}>{t.thread.file[file.change]} · {state}</small>
        </span>
      </summary>
      {file.diff && <pre className="ledge-scroll" style={{ ...pre, marginBottom: 8 }}>{file.diff}</pre>}
    </details>
  );
}

/** One action: its row folded, its input and result unfolded. Missing data is said, never guessed (spec §1). */
export function ActionRow({ item, t }: { item: ToolItem; t: Messages }) {
  const { mark, color } = STATUS_MARK[item.status];
  const isCommand = /^(bash|shell|command|exec)/i.test(item.tool);
  const bottom = item.status === 'running' ? t.thread.waiting : item.status === 'failed' ? t.thread.failed : item.status === 'success' ? t.thread.received : t.thread.unknownState;
  return (
    <article data-item="action" data-action data-status={item.status} style={{ borderBottom: '1px solid var(--border)' }}>
      <details>
        <summary style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 1px', cursor: 'pointer', listStyle: 'none' }}>
          <span aria-hidden style={{ color, width: 14, textAlign: 'center', fontSize: 12 }}>{mark}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 12, lineHeight: '16px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</strong>
          </span>
          {item.status === 'running' && <span style={{ ...muted, fontSize: 10 }}>{t.thread.running}</span>}
          {item.status === 'failed' && <span style={{ ...muted, fontSize: 10, color: 'var(--destructive)' }}>{t.thread.failed}</span>}
          <span aria-hidden style={{ ...muted, fontSize: 10 }}>›</span>
        </summary>
        <div style={{ padding: '0 0 10px 23px' }}>
          {item.input && <><div style={label}>{isCommand ? t.thread.command : t.thread.params}</div><pre className="ledge-scroll" style={pre}>{item.input}</pre></>}
          {item.error
            ? <><div style={label}>{t.thread.error}</div><pre data-action-output className="ledge-scroll" style={{ ...pre, borderColor: 'color-mix(in srgb, var(--destructive) 40%, transparent)' }}>{item.error}</pre></>
            : item.output !== undefined
              ? <><div style={label}>{t.thread.result}</div><pre data-action-output className="ledge-scroll" style={pre}>{item.output}</pre></>
              : item.status !== 'running' && <p style={{ ...muted, margin: '8px 0 0' }}>{t.thread.noResult}</p>}
          <p style={{ ...muted, margin: '8px 0 0', fontSize: 10 }}>{bottom} · {item.durationMs !== undefined ? duration(item.durationMs, t) : t.thread.noDuration}</p>
        </div>
      </details>
      {item.files.map(f => <FileRow key={f.path} file={f} status={item.status} t={t} />)}
    </article>
  );
}

function Item({ item, session, t, theme, paused, frozen, reducedMotion }: { item: ThreadItem } & Omit<ThreadProps, 'items' | 'hideCurrentReply' | 'now'>) {
  switch (item.kind) {
    case 'prompt': return (
      <div data-item="prompt" data-prompt style={{ margin: '0 0 0 18px', padding: '10px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <span style={{ ...muted, display: 'block', fontSize: 10, marginBottom: 4 }}>{t.thread.you}</span>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{item.text}</p>
      </div>);
    case 'message': return (
      <div data-item="message" data-message style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '14px 0 10px' }}>
        <Bot seed={`${session.id}:msg`} tool={session.tool} state={botState(session)} pose={poseFor(session.id, session.state)} size={20} theme={theme} paused={paused} frozen={frozen} reducedMotion={reducedMotion} />
        <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 13, lineHeight: '20px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}><strong style={{ fontWeight: 600 }}>{session.name}</strong> {item.text}</p>
      </div>);
    case 'tool': return <ActionRow item={item} t={t} />;
    case 'permission': return (
      <div data-item="permission" data-permission data-decision={item.decision ?? 'pending'} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ ...muted, display: 'block', fontSize: 10 }}>{t.thread.permission} · {item.decision ? t.thread.decided[item.decision] : t.thread.undecided}</span>
        <pre className="ledge-scroll" style={{ ...pre, marginTop: 6 }}>{item.text}</pre>
      </div>);
    default: return null; // helper rows live under the title; the current reply is the card
  }
}

function PreviousTurn({ turn, t, now }: { turn: Turn; t: Messages; now?: number }) {
  return (
    <details data-item="previous-turn" data-previous-turn style={{ marginBottom: 14 }}>
      <summary style={{ ...muted, display: 'flex', justifyContent: 'space-between', cursor: 'pointer', listStyle: 'none' }}>
        <span>{t.thread.previousTurn}</span><span>{turn.prompt ? relativeTime(turn.prompt.at, now, t) : t.thread.noTime}</span>
      </summary>
      <div style={{ borderLeft: '1px solid var(--border)', padding: '8px 0 0 11px', marginTop: 8, fontSize: 12, lineHeight: '19px' }}>
        {turn.prompt && <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><span style={muted}>{t.thread.you} · </span>{turn.prompt.text}</p>}
        {turn.reply && <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.reply.text}</p>}
      </div>
    </details>
  );
}

/** Spec 2026-10-13 §6: previous turns folded, then the current turn as stacked rows. No counters anywhere. */
export function Thread(p: ThreadProps) {
  const { items, t, session, hideCurrentReply = true } = p;
  const all = turns(items);
  if (all.length === 0) return <p data-thread data-empty style={{ ...muted, margin: '12px 0 0' }}>{t.thread.empty}</p>;
  const current = all[all.length - 1]!;
  const rows: ReactNode[] = all.slice(0, -1).map(turn => <PreviousTurn key={turn.n} turn={turn} t={t} now={p.now} />);
  for (const it of current.items) {
    if (hideCurrentReply && it.kind === 'reply') continue;
    rows.push(<Item key={it.id} item={it} session={session} t={t} theme={p.theme} paused={p.paused} frozen={p.frozen} reducedMotion={p.reducedMotion} />);
  }
  return (
    <div data-thread style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
      {rows}
      {session.tool === 'cursor' && <p data-source-note style={{ ...muted, margin: '10px 0 0' }}>{t.thread.cursorNote}</p>}
    </div>
  );
}
```

Si `duration(812, t)` ne rend pas `0.8 s` dans ce dépôt, aligner l'attente du test sur ce que `format.ts` rend déjà (ne pas changer `format.ts`).

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter overlay test -- thread && pnpm --filter overlay typecheck`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add apps/overlay/src/surface/Thread.tsx apps/overlay/test/thread.test.tsx
git commit -m "feat(overlay): thread component with turns, actions, files and permissions"
```

### Task 11 : Overlay — le fil dans la vue session, l'arbre cliquable, plus de compteurs

**Files:**
- Modify: `apps/overlay/src/surface/SessionView.tsx` (`HelpersTree` lignes 69–90, `SessionViewProps`, le bloc `data-session-content` ligne ~174, la ligne « meta » sous le titre avec `doneCount`/`questionCount`)
- Modify: `apps/overlay/src/i18n/messages.ts` (retirer `reply.doneCount`, `reply.questionCount` dans `fr` et `en`)
- Test: `apps/overlay/test/session.test.tsx`

**Interfaces:**
- Consumes: `Thread` (tâche 10), `helperRows`, `HelperRow` (tâche 9).
- Produces: `SessionViewProps` gagne `thread?: ThreadItem[]` et `onOpenHelper?: (id: string) => void` ; les lignes de l'arbre deviennent `<button data-helper data-helper-id={id}>` avec `aria-label="<task> · <t.thread.helperOpen>"` ; `onSend` est passé à `ReplyCard` (défini en tâche 13 — ici, ne pas encore le passer).

- [ ] **Step 1 : Tests qui échouent**

Dans `apps/overlay/test/session.test.tsx`, modifier le test existant `lists the live helpers under the title…` : les lignes `[data-helper]` sont désormais des boutons — ajouter après `expect(rows).toHaveLength(2);` :

```ts
    expect(rows[0]!.tagName).toBe('BUTTON');
```

et ajouter les tests :

```tsx
  it('renders the thread under the helpers and opens a helper on click, finished ones included', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
    const thread = [
      { kind: 'prompt' as const, id: 'prompt-1', at: at(0), turn: 1, text: 'Review the reducer' },
      { kind: 'helper' as const, id: 'h1', at: at(1), turn: 1, task: 'find consumers', agentType: 'Explore', state: 'exited' as const },
      { kind: 'tool' as const, id: 'toolu_1', at: at(2), turn: 1, tool: 'Bash', label: 'Bash · pnpm test', status: 'success' as const, files: [] }
    ];
    const onOpenHelper = vi.fn();
    const { container } = render(<SessionView {...base} session={fakeSession('a', { state: 'working', helpers: [] })} thread={thread} onOpenHelper={onOpenHelper} />);
    expect(container.querySelector('[data-prompt]')).toHaveTextContent('Review the reducer');
    expect(container.querySelector('[data-action]')).toHaveTextContent('Bash · pnpm test');
    const row = screen.getByRole('button', { name: 'find consumers · Open the discussion' });
    expect(row).toHaveTextContent('Explore · Done');
    fireEvent.click(row);
    expect(onOpenHelper).toHaveBeenCalledWith('h1');
    // The thread comes before the reply card and the ask fold.
    const order = [...container.querySelectorAll('[data-helpers], [data-thread], [data-reply-card], [data-ask]')].map(e => e.getAttributeNames().find(n => n.startsWith('data-'))!);
    expect(order.indexOf('data-helpers')).toBeLessThan(order.indexOf('data-thread'));
  });
  it('shows no counters under the title once a reply arrived', () => {
    const reply = { text: '## Done\n- [x] a\n- [x] b\n\n## Questions\n1. Which one?\n   - A\n   - B', at: '2026-10-09T18:05:00.000Z' };
    const { container } = render(<SessionView {...base} session={fakeSession('a', { state: 'idle', lastReply: reply })} thread={[]} />);
    expect(container.textContent).not.toMatch(/\d+ (done|question)/);
    expect(container.querySelector('[data-thread][data-empty]')).toBeInTheDocument();
  });
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter overlay test -- session`
Expected: FAIL — `rows[0].tagName` est `LI` ; `thread` est une prop inconnue (typecheck) ; le bouton n'existe pas.

- [ ] **Step 3 : Implémenter**

Dans `SessionView.tsx` :

- Importer `Thread` depuis `./Thread`, `helperRows` et `HelperRow` depuis `../thread/turns`, `ThreadItem` depuis `@ledge/protocol`.
- `SessionViewProps` : ajouter

```ts
  /** Native tracking (spec 2026-10-13 §6): the session's thread once received; undefined while it is on its way. */
  thread?: ThreadItem[];
  onOpenHelper?: (id: string) => void;
```

- Remplacer `HelpersTree` :

```tsx
/** Spec 2026-10-13 §6: the current turn's helpers under the title, 20 px bots in a tree whose last branch ends in └; each
 *  row opens the helper's own thread. */
function HelpersTree({ parent, helpers, t, theme, paused, frozen, reducedMotion, onOpen }: { parent: Session; helpers: HelperRow[]; t: Messages; theme: 'dark' | 'light'; paused: boolean; frozen?: boolean; reducedMotion?: boolean; onOpen?: (id: string) => void }) {
  return (
    <ul data-helpers aria-label={t.session.helpers} style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {helpers.map((h, i) => {
        const st = HELPER_STATE[h.state]; const seed = `${parent.id}:${h.id}`; const last = i === helpers.length - 1;
        const stateLabel = h.state === 'exited' ? t.thread.helperDone : t.botLabel[st];
        return (
          <li key={h.id} style={{ minWidth: 0 }}>
            <button type="button" data-helper data-helper-id={h.id} data-last={last ? 'true' : undefined} aria-label={`${h.task} · ${t.thread.helperOpen}`} onClick={() => onOpen?.(h.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, padding: 0, background: 'none', border: 0, textAlign: 'left', font: 'inherit', fontSize: 12, lineHeight: '16px', color: 'var(--sidebar-foreground)', cursor: 'pointer', borderRadius: 4 }}>
              <span aria-hidden className="mono" style={{ width: 14, flexShrink: 0, color: 'var(--muted-foreground)' }}>{last ? '└' : '├'}</span>
              <Bot seed={seed} tool={parent.tool} state={st} pose={poseFor(seed, h.state)} size={20} theme={theme} paused={paused} frozen={frozen} reducedMotion={reducedMotion} />
              <span data-helper-task style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.task}</span>
              <span style={{ flexShrink: 0, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{h.kind} · {stateLabel}</span>
              <span aria-hidden style={{ flexShrink: 0, color: 'var(--muted-foreground)', fontSize: 14 }}>›</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

  (garder les props `Bot` telles que la version actuelle les passe : `pose`, `askKey`, etc.)

- Dans `SessionView`, remplacer `const helpers = liveHelpers(s)` (ou l'équivalent) par `const helpers = helperRows(s, p.thread);` et passer `onOpen={p.onOpenHelper}` à `HelpersTree`. Si `liveHelpers` servait aussi à `botState`/au titre, garder cet usage-là.
- Sous `HelpersTree`, avant la carte de réponse : `{p.thread !== undefined && <Thread session={s} items={p.thread} t={t} theme={p.theme ?? 'dark'} paused={!visible} frozen={p.frozen} reducedMotion={p.reducedMotion} now={p.now} />}` et, quand `p.thread === undefined`, `<p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '12px 0 0' }}>{t.thread.loading}</p>`.
- Supprimer la ligne « meta » qui rend `t.reply.doneCount`/`t.reply.questionCount` (garder l'heure de la réponse si elle est rendue au même endroit : `relativeTime(reply.at, …)` seul). Retirer `doneCount` et `questionCount` de `fr.reply` et `en.reply`.

- [ ] **Step 4 : Vérifier le succès**

Run: `pnpm --filter overlay test -- session reply-view && pnpm --filter overlay typecheck`
Expected: PASS. Si un test existant de `reply-view.test.tsx` attend « 2 done » ou « 1 question », le retirer : c'est le compteur que la spec supprime.

- [ ] **Step 5 : Commit**

```bash
git add apps/overlay/src/surface/SessionView.tsx apps/overlay/src/i18n/messages.ts apps/overlay/test/session.test.tsx apps/overlay/test/reply-view.test.tsx
git commit -m "feat(overlay): session thread under the helpers, clickable helper rows, no counters"
```

### Task 12 : Overlay — le mode `helper` et la vue sous-agent

**Files:**
- Modify: `apps/overlay/src/surface/geometry.ts` (`Mode` ligne 9, `layout` lignes 60–75, `LayoutInput`)
- Modify: `apps/overlay/src/surface/machine.ts` (`SurfaceState`, `SurfaceEvent` lignes 41–44, `detail` ligne 68, `case 'back'` ligne 215, `initialSurface`)
- Create: `apps/overlay/src/surface/HelperView.tsx`
- Modify: `apps/overlay/src/surface/Surface.tsx` (`detail` ligne 528, mesures lignes 340–362, rendu des couches lignes 680–690, effet de la tâche 8)
- Test: `apps/overlay/test/machine.test.ts`, `apps/overlay/test/helper-view.test.tsx`

**Interfaces:**
- Consumes: `helperThread` (tâche 9), `Thread`, `ActionRow` (tâche 10), `DetailHeader` (`./DetailHeader`, existant : `{ title, onBack, onClose, backLabel? }`).
- Produces: `Mode` gagne `'helper'` ; `SurfaceState.helperId: string | null` ; événement `{ type: 'openHelper'; id: string }` (depuis `session` seulement) ; `back` depuis `helper` revient à `session` sans toucher `selectedId` ; `LayoutInput.helperH?: number` ; `export function HelperView({ session, helperId, items, visible, onBack, onClose, theme, contentRef, enterDelay, paused, frozen, reducedMotion, now }: HelperViewProps)` ; `data-layer="helper"`, `[data-back]`, `[data-helper-task]`, `[data-report]`.

- [ ] **Step 1 : Tests qui échouent**

Dans `apps/overlay/test/machine.test.ts` :

```ts
  it('opens a helper from a session and comes back to the same session', () => {
    const { s } = run([{ type: 'rowClick', id: 'a' }, { type: 'openHelper', id: 'h1' }]);
    expect(s).toMatchObject({ mode: 'helper', selectedId: 'a', helperId: 'h1' });
    const back = run([{ type: 'back' }], s).s;
    expect(back).toMatchObject({ mode: 'session', selectedId: 'a', helperId: null });
    expect(run([{ type: 'openHelper', id: 'h1' }], run([{ type: 'homeClick' }]).s).s.mode).toBe('list'); // only from a session
    const closed = run([{ type: 'close' }], s).s;
    expect(closed.mode).not.toBe('helper');
    expect(closed.helperId).toBeNull();
    const removed = run([{ type: 'removed', id: 'a', remaining: [] }], s).s;
    expect(removed.mode).toBe('list');
  });
```

Créer `apps/overlay/test/helper-view.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { HelperView } from '../src/surface/HelperView';
import { fakeSession } from './mockDaemon';

const at = (s: number) => new Date(Date.UTC(2026, 9, 13, 10, 0, s)).toISOString();
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Review the reducer' },
  { kind: 'helper', id: 'h1', at: at(1), turn: 1, task: 'find consumers', agentType: 'Explore', state: 'exited' },
  { kind: 'message', id: 'msg-a1', at: at(2), turn: 1, helperId: 'h1', text: 'Searching the callers.' },
  { kind: 'tool', id: 'toolu_5', at: at(3), turn: 1, helperId: 'h1', tool: 'Grep', label: 'Grep · reduce(', output: 'state.ts:12', status: 'success', files: [] },
  { kind: 'reply', id: 'report-h1', at: at(4), turn: 1, helperId: 'h1', text: 'Three consumers, all in the daemon.' },
  { kind: 'helper', id: 'h2', at: at(5), turn: 1, task: 'review task 1', state: 'working' }
];

describe('<HelperView>', () => {
  it('shows the back row, who delegated, the task, the helper thread and the final report', () => {
    const onBack = vi.fn();
    const { container } = render(<HelperView session={fakeSession('a')} helperId="h1" items={items} visible onBack={onBack} onClose={() => {}} theme="dark" paused />);
    expect(container.querySelector('[data-back]')).toHaveTextContent('Otto · Main discussion');
    expect(container).toHaveTextContent('Delegated by Otto');
    expect(container).toHaveTextContent('Done');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('find consumers');
    expect(container).toHaveTextContent('Instruction');
    expect(container).toHaveTextContent('Review the reducer');
    expect(container.querySelector('[data-message]')).toHaveTextContent('Searching the callers.');
    expect(container.querySelector('[data-action]')).toHaveTextContent('Grep · reduce(');
    expect(container.querySelector('[data-report]')).toHaveTextContent('Final report');
    expect(container.querySelector('[data-report]')).toHaveTextContent('Three consumers, all in the daemon.');
    fireEvent.click(container.querySelector('[data-back]')!);
    expect(onBack).toHaveBeenCalled();
  });
  it('says a working helper is still waiting for its report, and survives an unknown helper', () => {
    const { container, rerender } = render(<HelperView session={fakeSession('a')} helperId="h2" items={items} visible onBack={() => {}} onClose={() => {}} theme="dark" paused />);
    expect(container).toHaveTextContent('Working');
    expect(container).toHaveTextContent('is waiting for its report…');
    expect(container.querySelector('[data-report]')).toBeNull();
    rerender(<HelperView session={fakeSession('a')} helperId="nope" items={items} visible onBack={() => {}} onClose={() => {}} theme="dark" paused />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm --filter overlay test -- machine helper-view`
Expected: FAIL — `openHelper` inconnu ; module `HelperView` introuvable.

- [ ] **Step 3 : Géométrie et machine**

`geometry.ts` : `export type Mode = 'handle' | 'bubble' | 'list' | 'session' | 'helper' | 'settings' | 'help' | 'launch' | 'chat' | 'reader';` ; dans `LayoutInput`, ajouter `/** Measured height of the open helper view. */ helperH?: number;` ; dans `layout`, avant la ligne finale (`return view(input.reading ? …`) :

```ts
  if (mode === 'helper') return view(SIZES.sessionW, input.helperH ?? 480);
```

`machine.ts` :
- `SurfaceState` : `helperId: string | null;` (`null` dans `initialSurface()`), avec le commentaire `/** The helper whose thread the helper view shows (spec 2026-10-13 §6). */`.
- `SurfaceEvent` : ajouter `| { type: 'openHelper'; id: string }`.
- `detail` : `const detail = (m: Mode) => m === 'session' || m === 'helper' || m === 'settings' || m === 'help' || m === 'launch' || m === 'chat';`
- Nouveau cas dans `transition` :

```ts
    case 'openHelper':
      return s.mode === 'session' && s.selectedId ? { state: { ...s, mode: 'helper', helperId: e.id }, effects: [] } : same(s);
```

- `case 'back'` : avant le `return detail(s.mode) ? …`, ajouter `if (s.mode === 'helper') return { state: { ...s, mode: 'session', helperId: null }, effects: [] };`.
- Partout où la machine quitte le mode `session` vers `list`/`handle` (`close`, `removed` de la session sélectionnée, `rowClick` d'une autre session, `homeClick`), mettre `helperId: null` : la façon la plus sûre est de le faire dans la fonction qui construit l'état « fermé »/« liste » déjà utilisée par ces cas (suivre `selectedId: null` : chaque endroit qui le pose met aussi `helperId: null`). Traiter `s.mode === 'helper'` comme `s.mode === 'session'` dans les cas qui testent `mode === 'session'` (`removed`, `ask`/`queue`, `reading`).

- [ ] **Step 4 : `HelperView.tsx`**

```tsx
import type { Ref } from 'react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { transition } from '../motion';
import { helperThread } from '../thread/turns';
import { Thread } from './Thread';

export interface HelperViewProps {
  session: Session; helperId: string; items: ThreadItem[]; visible: boolean;
  onBack: () => void; onClose: () => void; theme: 'dark' | 'light';
  contentRef?: Ref<HTMLDivElement>; enterDelay?: number; paused: boolean; frozen?: boolean; reducedMotion?: boolean; now?: number;
}

const muted = { fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' } as const;

/** Spec 2026-10-13 §6: a helper's own thread. The session view stays mounted behind it, so going back keeps its scroll. */
export function HelperView({ session, helperId, items, visible, onBack, onClose, theme, contentRef, enterDelay = 120, paused, frozen, reducedMotion, now }: HelperViewProps) {
  const { t } = useI18n();
  const { helper, items: own, report } = helperThread(items, helperId);
  const live = session.helpers.find(h => h.id === helperId);
  const working = (live?.state ?? helper?.state) !== 'exited';
  const prompt = [...items].reverse().find(i => i.kind === 'prompt' && !i.helperId && i.turn === (helper?.turn ?? -1));
  const helperSession: Session = { ...session, helpers: [] };
  return (
    <div data-layer="helper" data-delay={enterDelay} inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', 'fade', enterDelay]]) }}>
      <div style={{ padding: '12px 17px 10px', borderBottom: '1px solid var(--border)' }}>
        <button type="button" data-back data-initial-focus onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0, background: 'none', border: 0, font: 'inherit', fontSize: 12, color: 'var(--sidebar-foreground)', cursor: 'pointer', textAlign: 'left' }}>
          <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>←</span>
          <span>{session.name} · {t.thread.backTo}</span>
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
          <span style={muted}>{t.thread.delegatedBy} {session.name}{helper?.agentType ? ` · ${helper.agentType}` : ''}</span>
          <span style={{ ...muted, color: working ? 'var(--warning)' : 'var(--success, var(--sidebar-primary))' }}>{working ? t.thread.helperWorking : t.thread.helperDone}</span>
        </div>
        <h2 data-helper-task style={{ margin: '6px 0 0', fontSize: 14, lineHeight: '20px', fontWeight: 500, overflowWrap: 'anywhere' }}>{helper?.task || live?.task || ''}</h2>
        <button type="button" aria-label={t.session.close} onClick={onClose} style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 0, color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>
      <div className="ledge-scroll" style={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }}>
        <div ref={contentRef} style={{ padding: '8px 17px 16px' }}>
          {prompt && <div style={{ padding: '8px 0 10px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ ...muted, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>{t.thread.instruction}</span>
            <p style={{ ...muted, margin: '4px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prompt.text}</p>
          </div>}
          <Thread session={helperSession} items={own.map(i => ({ ...i, helperId: undefined }))} t={t} theme={theme} paused={paused} frozen={frozen} reducedMotion={reducedMotion} now={now} />
          {report
            ? <article data-report style={{ marginTop: 12, borderLeft: '2px solid var(--success, var(--sidebar-primary))', padding: '2px 0 2px 10px' }}>
                <span style={{ ...muted, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--success, var(--sidebar-primary))' }}>{t.thread.report}</span>
                <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report.text}</p>
              </article>
            : working && <p style={{ ...muted, margin: '12px 0 0' }}>{helper?.agentType ?? session.name} {t.thread.helperWaiting}</p>}
        </div>
      </div>
    </div>
  );
}
```

(`Thread` filtre les éléments portant un `helperId` à travers `turns()` : on les lui passe donc sans `helperId`, comme un fil principal d'un seul tour. Le `turn` conservé est celui du parent, ce qui suffit à `turns()` pour n'en faire qu'un groupe.)

- [ ] **Step 5 : `Surface.tsx`**

- `const detail` (ligne 528) : ajouter `|| st.mode === 'helper'`.
- Mesure : `const helperRef = useRef<HTMLDivElement>(null); const helperContentH = useMeasuredHeight(helperRef, st.mode === 'helper', ps); const helperH = helperContentH ? SESSION_HEADER_H + helperContentH + SURFACE_CHROME_Y : 480;` et passer `helperH` dans l'objet `LayoutInput` donné à `layout(...)`.
- Étendre l'effet de la tâche 8 à `st.mode === 'helper'`.
- Dans le rendu des couches, à côté de `<SessionView …>` : passer `thread={threads.get(shown.id)}` et `onOpenHelper={id => dispatch({ type: 'openHelper', id })}` à `SessionView`, et ajouter :

```tsx
            {shown && st.helperId && <HelperView contentRef={helperRef} session={shown} helperId={st.helperId} items={threads.get(shown.id) ?? []} visible={st.mode === 'helper'} enterDelay={enter} theme={theme} paused={st.mode !== 'helper'} frozen={frozen} reducedMotion={reducedMotion}
              onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} />}
```

  (importer `HelperView` ; `theme`, `frozen`, `reducedMotion` sont les mêmes valeurs que celles passées à `SessionView` à cet endroit.)
- La couche session reste montée et visible derrière (`visible={st.mode === 'session'}` inchangé) : sa position de lecture est conservée au retour. `useKeyboard` : Échap appelle `onClose`, que `Surface` traduit en `back` quand `detail` est vrai — rien à changer puisque `detail` inclut `helper`.

- [ ] **Step 6 : Vérifier le succès**

Run: `pnpm --filter overlay test && pnpm --filter overlay typecheck`
Expected: PASS, toute la suite overlay (les tests de géométrie existants ne couvrent que les modes connus ; aucun ne doit casser).

- [ ] **Step 7 : Commit**

```bash
git add apps/overlay/src/surface/geometry.ts apps/overlay/src/surface/machine.ts apps/overlay/src/surface/HelperView.tsx apps/overlay/src/surface/Surface.tsx apps/overlay/test/machine.test.ts apps/overlay/test/helper-view.test.tsx
git commit -m "feat(overlay): helper view with its own thread and report"
```
