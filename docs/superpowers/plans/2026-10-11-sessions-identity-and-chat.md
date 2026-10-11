# Sessions Identity and Ledge Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every session row shows what it works on (topic) and where (repository, branch), and the user can ask Ledge questions about the running sessions and their repositories from a chat view backed by `claude -p --restricted`.

**Architecture:** The daemon (`packages/ledge`) learns a session's topic from three sources (user rename, Claude Code's pane title, first prompt) through two new session events and keeps the repository/branch of each session fresh through a small git probe in the poller. A chat module in the daemon writes a read-only context folder, spawns `claude -p --restricted` once per question, maps its stream-json output to protocol messages, and keeps one conversation per day. The overlay (`apps/overlay`) groups rows by repository, shows topic and branch, adds a separator in the handle, a rename field in the session header, an ask field under the list and a `chat` mode with its view.

**Tech Stack:** TypeScript (strict), Node 22, pnpm workspaces, zod schemas in `@ledge/protocol`, `ws`, tmux, React 19 overlay, vitest + @testing-library/react. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-11-sessions-identity-and-chat-design.md`

## Global Constraints

- Claude Code CLI ≥ 2.1.296 on the WSL side (flags `--restricted`, `--add-dir`, `--session-id`, `--include-partial-messages` verified on that version); git ≥ 2.31 (`rev-parse --path-format=absolute`).
- No new runtime dependency in any package. Daemon log and error strings are English; every user-visible overlay string goes through `apps/overlay/src/i18n/messages.ts` in both `fr` and `en` (the `en` object is typed as the shape of `fr`: a missing key is a type error).
- Ledge never types into a session from the chat: the chat process has no Bash and no write tool (`--restricted --tools Read,Grep,Glob`).
- `title` keeps its contract (the terminal tab title) and is always `${name} · ${topic ?? project}`.
- Topic: one line, 80 characters max, computed by `cleanTopic` from `@ledge/protocol`; the hook truncates raw prompts to 500 characters before sending.
- Every view change or element appearing in the overlay is animated with the existing `transition()` helpers (grow/shrink/fade); no new easing.
- Rows stay 58 px, group headers 28 px, the list 380 px wide, the chat 420 px wide.
- Run tests with `pnpm --filter ledge test`, `pnpm --filter @ledge/protocol test`, `pnpm --filter overlay test`; typecheck with `pnpm typecheck` from the root. Commit after every task with the repository's style (`feat(scope): …`, `test(scope): …`) and end commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A session whose `cwd` is a subfolder of the repository (the agent was started in `packages/ledge`): `gitInfo` must still report the repository root and `worktree: false` (Task 5 tests it with a nested cwd).
2. A pane title that changes mid-session (Claude Code renames the conversation after `/clear`): the poller must emit a new `PaneTitle` and the user's own rename must survive it (Task 2 and Task 4).
3. The chat's day session file names a Claude session that no longer exists (transcript deleted, `claude` upgraded): the first `--resume` fails, the service must retry once with a fresh id and still answer (Task 12).
4. Two overlay windows or a reconnect while a question runs: `chat.history` after the snapshot must carry the in-flight turn without answer, and the view must show it as thinking, not as an error (Tasks 12 and 13).
5. Keyboard mode: `/` must focus the ask field only in the list, never while typing elsewhere, and Escape inside the rename field must not close the session view (Tasks 8 and 14).

---

## Part A — Telling sessions apart

### Task 1: Protocol fields, topic helpers and the rename message

**Files:**
- Create: `packages/protocol/src/topic.ts`
- Modify: `packages/protocol/src/session.ts`, `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/topic.test.ts`, `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces: `cleanTopic(text: string): string`, `sessionTitle(s: { name: string; project: string; topic?: string }): string`, `TOPIC_MAX = 80`, `TopicSource = 'user' | 'pane' | 'prompt'`; `Session` fields `topic?`, `topicSource?`, `repo?`, `repoPath?`, `branch?`, `worktree?`; session event names `PaneTitle`, `Renamed`; client message `{ type: 'session.rename', id, topic }`.

- [ ] **Step 1: Write the failing tests**

`packages/protocol/test/topic.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cleanTopic, sessionTitle, TOPIC_MAX } from '../src/topic.js';

describe('cleanTopic', () => {
  it('keeps the first non-empty line, flattened', () => {
    expect(cleanTopic('\n\n  Ajoute   un README\npuis commite')).toBe('Ajoute un README');
  });
  it('cuts at TOPIC_MAX with an ellipsis', () => {
    const long = 'a'.repeat(100);
    expect(cleanTopic(long)).toHaveLength(TOPIC_MAX);
    expect(cleanTopic(long).endsWith('…')).toBe(true);
  });
  it('is empty for blank text', () => { expect(cleanTopic('  \n ')).toBe(''); });
});

describe('sessionTitle', () => {
  it('is name · topic, or name · project without a topic', () => {
    expect(sessionTitle({ name: 'Otto', project: 'ledge', topic: 'Hooks Codex' })).toBe('Otto · Hooks Codex');
    expect(sessionTitle({ name: 'Otto', project: 'ledge' })).toBe('Otto · ledge');
    expect(sessionTitle({ name: 'Otto', project: 'ledge', topic: '' })).toBe('Otto · ledge');
  });
});
```

Add to `packages/protocol/test/messages.test.ts` (inside `describe('protocol')`):
```ts
  it('accepts a session with topic and repository fields', () => {
    const s = { ...full, topic: 'Hooks Codex', topicSource: 'pane', repo: 'harness-assistant', repoPath: '/w/harness-assistant', branch: 'worktree-codex', worktree: true };
    expect(SessionSchema.parse(s).worktree).toBe(true);
  });
  it('accepts the new session events and the rename message', () => {
    expect(SessionEventSchema.parse({ name: 'PaneTitle', at: T0, source: 'pane', text: 'add-readme' }).name).toBe('PaneTitle');
    expect(SessionEventSchema.parse({ name: 'Renamed', at: T0, source: 'daemon', text: 'Mon sujet' }).name).toBe('Renamed');
    expect(parseClientMessage({ type: 'session.rename', id: 'a', topic: 'Mon sujet' }).type).toBe('session.rename');
  });
```
Use the file's existing full-session fixture and timestamp constant (read the top of the file: it builds a complete session for `accepts a full session`; name them `full` and `T0` if they are not already).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ledge/protocol test`
Expected: FAIL (`topic.js` not found; `PaneTitle` rejected by the enum; `session.rename` not a valid discriminator).

- [ ] **Step 3: Implement**

`packages/protocol/src/topic.ts`:
```ts
/** The longest topic a session carries: one line of a list row. */
export const TOPIC_MAX = 80;

/** A topic from free text: the first non-empty line, whitespace collapsed, cut to TOPIC_MAX with an ellipsis. */
export function cleanTopic(text: string): string {
  const line = text.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0) ?? '';
  const flat = line.replace(/\s+/g, ' ');
  return flat.length > TOPIC_MAX ? `${flat.slice(0, TOPIC_MAX - 1).trimEnd()}…` : flat;
}

/** The session's title, also the terminal tab's: the bot's name and what it works on (its folder until it has a topic). */
export function sessionTitle(s: { name: string; project: string; topic?: string }): string {
  return `${s.name} · ${s.topic || s.project}`;
}
```

In `packages/protocol/src/session.ts`, before `SessionSchema`:
```ts
/** Where a session's topic came from: the user's own words win over the pane's conversation title, which wins over the first prompt. */
export const TopicSourceSchema = z.enum(['user', 'pane', 'prompt']);
export type TopicSource = z.infer<typeof TopicSourceSchema>;
```
and inside `SessionSchema`, after `title: z.string(),`:
```ts
  /** One line saying what the session is about (spec 2026-10-11 §3). */
  topic: z.string().optional(),
  topicSource: TopicSourceSchema.optional(),
  /** The repository (its main worktree's folder name and absolute path), the checked-out branch, and whether `cwd` is a linked worktree (§4). */
  repo: z.string().optional(),
  repoPath: z.string().optional(),
  branch: z.string().optional(),
  worktree: z.boolean().optional(),
```

In `packages/protocol/src/messages.ts`, add `'PaneTitle', 'Renamed'` to the `name` enum of `SessionEventSchema`, and to `ClientMessageSchema` after `session.dismiss`:
```ts
  /** The user names the session's topic from the overlay; an empty topic hands back to the automatic sources. */
  z.object({ type: z.literal('session.rename'), id: z.string(), topic: z.string() }),
```

In `packages/protocol/src/index.ts`, add `export * from './topic.js';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ledge/protocol test && pnpm typecheck`
Expected: protocol PASS. `pnpm typecheck` FAILS in `packages/ledge/src/daemon/state.ts` ("Not all code paths return a value" or a non-exhaustive switch on the new event names): that is Task 2's starting point, acceptable here.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): sessions carry a topic and their repository; PaneTitle, Renamed and session.rename"
```

### Task 2: The reducer learns topics

**Files:**
- Modify: `packages/ledge/src/daemon/state.ts`
- Test: `packages/ledge/test/state.test.ts`

**Interfaces:**
- Consumes: `cleanTopic`, `sessionTitle`, `TopicSource` from `@ledge/protocol`.
- Produces: `reduce` handles `PaneTitle`, `Renamed`, and `UserPromptSubmit.text`; `title` is recomputed whenever `topic` changes.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ledge/test/state.test.ts` (reuse its `mk`/session fixture; `at` is any ISO string):
```ts
describe('topics', () => {
  const at = '2026-10-11T10:00:00.000Z';
  it('takes the first prompt as topic, never a later one', () => {
    let s = reduce(mk('a'), { name: 'UserPromptSubmit', at, source: 'hook', text: 'Ajoute un README\nIl manque.' });
    expect(s.topic).toBe('Ajoute un README'); expect(s.topicSource).toBe('prompt'); expect(s.title).toBe('Otto · Ajoute un README');
    s = reduce(s, { name: 'UserPromptSubmit', at, source: 'hook', text: 'Autre chose' });
    expect(s.topic).toBe('Ajoute un README');
  });
  it('a pane title replaces a prompt topic, not a user one', () => {
    let s = reduce(mk('a'), { name: 'UserPromptSubmit', at, source: 'hook', text: 'premier prompt' });
    s = reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'add-readme-file' });
    expect(s.topic).toBe('add-readme-file'); expect(s.topicSource).toBe('pane');
    s = reduce(s, { name: 'Renamed', at, source: 'daemon', text: 'Mon sujet' });
    s = reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'other-title' });
    expect(s.topic).toBe('Mon sujet'); expect(s.topicSource).toBe('user'); expect(s.title).toBe('Otto · Mon sujet');
  });
  it('an empty rename hands back to the automatic sources', () => {
    let s = reduce(mk('a'), { name: 'Renamed', at, source: 'daemon', text: 'Mon sujet' });
    s = reduce(s, { name: 'Renamed', at, source: 'daemon', text: '  ' });
    expect(s.topic).toBeUndefined(); expect(s.topicSource).toBeUndefined(); expect(s.title).toBe('Otto · harness-assistant');
    s = reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'again' });
    expect(s.topic).toBe('again');
  });
  it('titles touch neither activity nor the hook clock, and an unchanged title is a no-op', () => {
    const base = mk('a');
    const s = reduce(base, { name: 'PaneTitle', at, source: 'pane', text: 'x' });
    expect(s.lastActivityAt).toBe(base.lastActivityAt); expect(s.lastHookAt).toBe(base.lastHookAt);
    expect(reduce(s, { name: 'PaneTitle', at, source: 'pane', text: 'x' })).toBe(s);
  });
});
```
Check `mk('a')` in that file yields `project: 'harness-assistant'`; if it is another folder name, adjust the expected `Otto · <project>` string, not the code.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test -- state`
Expected: FAIL (type errors on the new names, `topic` undefined).

- [ ] **Step 3: Implement**

In `packages/ledge/src/daemon/state.ts`, import `cleanTopic, sessionTitle, type TopicSource` from `@ledge/protocol` and add above `reduce`:
```ts
/** The session with a (possibly empty) topic from `source`, its title following; identical when nothing changes. */
function withTopic(s: Session, text: string, source: TopicSource | undefined): Session {
  const topic = cleanTopic(text) || undefined;
  if (topic === s.topic && (topic ? source : undefined) === s.topicSource) return s;
  const { topic: _t, topicSource: _ts, ...rest } = s;
  const next: Session = topic ? { ...rest, topic, topicSource: source } : rest;
  return { ...next, title: sessionTitle(next) };
}
```
In `reduce`, add two cases to the main `switch (ev.name)` (next to `PaneChanged`):
```ts
    case 'PaneTitle': return s.topicSource === 'user' ? s : withTopic(s, ev.text ?? '', 'pane');
    case 'Renamed': return withTopic(s, ev.text ?? '', ev.text?.trim() ? 'user' : undefined);
```
In the last case group (`SessionStart / UserPromptSubmit / …`), as its first line:
```ts
      if (ev.name === 'UserPromptSubmit' && ev.text && !s.topic) s = withTopic(s, ev.text, 'prompt');
```
(The later `prompted === s` identity check still works: `s` is now the topic-bearing session.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test -- state && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/daemon/state.ts packages/ledge/test/state.test.ts
git commit -m "feat(daemon): a session's topic from its first prompt, its pane title or the user, title following"
```

### Task 3: Hooks carry the prompt and ignore Ledge's own chat

**Files:**
- Modify: `packages/ledge/src/cli/hook.ts`
- Test: `packages/ledge/test/hook.test.ts`

**Interfaces:**
- Produces: `UserPromptSubmit` events with `text` (≤ 500 chars) for Claude Code, Codex and Cursor Agent; `runHook` returns at once when `process.env.LEDGE_CHAT === '1'`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ledge/test/hook.test.ts`:
```ts
describe('prompts and the chat marker', () => {
  const at = '2026-10-11T10:00:00.000Z';
  it('UserPromptSubmit carries the prompt, cut to 500 characters', () => {
    const m = mapClaudeHook('UserPromptSubmit', { session_id: 's', prompt: 'x'.repeat(600) }, at);
    expect(m?.event.name).toBe('UserPromptSubmit'); expect(m?.event.text).toHaveLength(500);
    expect(mapClaudeHook('UserPromptSubmit', { session_id: 's' }, at)?.event.text).toBeUndefined();
  });
  it('Cursor beforeSubmitPrompt carries the prompt too', () => {
    const m = mapCursorHook('beforeSubmitPrompt', { session_id: 's', prompt: 'Corrige le test' }, at, {});
    expect(m?.event).toMatchObject({ name: 'UserPromptSubmit', text: 'Corrige le test' });
  });
});
```
Import `mapCursorHook` from `../src/cli/hook.js` if the file does not already. The chat marker gets its own file, `packages/ledge/test/hook-chat.test.ts`, so the daemon client can be mocked without touching the other hook tests:
```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/client.js', () => ({ connect: vi.fn(async () => { throw new Error('no daemon in this test'); }) }));
import { connect } from '../src/client.js';
import { runHook } from '../src/cli/hook.js';

describe('runHook under LEDGE_CHAT', () => {
  it('never reaches the daemon for Ledge\'s own chat, and does otherwise', async () => {
    const payload = JSON.stringify({ session_id: 's', prompt: 'hi' });
    const before = process.env.LEDGE_CHAT; process.env.LEDGE_CHAT = '1';
    try { await runHook('UserPromptSubmit', payload, { port: 1, timeoutMs: 50 }); expect(connect).not.toHaveBeenCalled(); }
    finally { if (before === undefined) delete process.env.LEDGE_CHAT; else process.env.LEDGE_CHAT = before; }
    delete process.env.LEDGE_CHAT;
    await runHook('UserPromptSubmit', payload, { port: 1, timeoutMs: 50 }); expect(connect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test -- hook`
Expected: the prompt tests FAIL (`text` undefined); the marker test FAILS (`connect` called once under `LEDGE_CHAT=1`).

- [ ] **Step 3: Implement**

In `packages/ledge/src/cli/hook.ts`:
```ts
/** The longest first prompt sent as a topic candidate; the reducer cuts it to one line of TOPIC_MAX. */
const PROMPT_MAX = 500;
const promptText = (p: Payload) => { const t = str(p.prompt)?.trim(); return t ? { text: t.slice(0, PROMPT_MAX) } : {}; };
```
Replace `case 'UserPromptSubmit': return { name: 'UserPromptSubmit', ...base };` in `mapEvent` with:
```ts
    case 'UserPromptSubmit': return { name: 'UserPromptSubmit', ...base, ...promptText(p) };
```
and in `mapCursorEvent`, `case 'beforeSubmitPrompt': return { name: 'UserPromptSubmit', ...base, ...promptText(p) };`.

In `runHook`, right after `const label = …`:
```ts
  // Ledge's own chat runs Claude Code headless: its hooks (if any ran) must never make a session.
  if (process.env.LEDGE_CHAT === '1') { log(`hook ${label} ignored: Ledge chat`); return; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test -- hook`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/cli/hook.ts packages/ledge/test/hook.test.ts packages/ledge/test/hook-chat.test.ts
git commit -m "feat(hooks): the first prompt travels with UserPromptSubmit; hooks stay silent for Ledge's own chat"
```

### Task 4: Claude Code's pane title

**Files:**
- Modify: `packages/ledge/src/adapters/types.ts`, `packages/ledge/src/adapters/claude.ts`, `packages/ledge/src/daemon/poller.ts`
- Test: `packages/ledge/test/adapters-claude.test.ts`, `packages/ledge/test/poller.test.ts`

**Interfaces:**
- Produces: `Adapter.paneTitle?(pane: string): string | null`; `claudeAdapter.paneTitle`; the poller emits `{ name: 'PaneTitle', source: 'pane', text }` once per distinct title per session.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ledge/test/adapters-claude.test.ts`:
```ts
describe('claude adapter: pane title', () => {
  const box = (top: string) => `● Done.\n\n${top}\n❯ \n${'─'.repeat(40)}\n  ⏸ manual mode on · ? for shortcuts`;
  it('reads the conversation title from the input box top rule', () => {
    expect(claudeAdapter.paneTitle!(box(`${'─'.repeat(28)} add-readme-file ─`))).toBe('add-readme-file');
    expect(claudeAdapter.paneTitle!(box(`${'─'.repeat(20)} Fix the flaky test ────`))).toBe('Fix the flaky test');
  });
  it('is null on an untitled box, a dialog or plain output', () => {
    expect(claudeAdapter.paneTitle!(box('─'.repeat(40)))).toBeNull();
    expect(claudeAdapter.paneTitle!(fx('claude2-permission-bash'))).toBeNull();
    expect(claudeAdapter.paneTitle!('just text\nmore text')).toBeNull();
  });
});
```
Append to `packages/ledge/test/poller.test.ts` a test built like its neighbours (a `Store`, a fake tmux whose `capture` returns a pane, `startPoller({ … intervalMs: 1_000_000 })` and manual `await poller.tick()`):
```ts
  it('emits PaneTitle once per title', async () => {
    const titled = (t: string) => `● Done.\n\n${'─'.repeat(28)} ${t} ─\n❯ \n${'─'.repeat(40)}\n  ⏸ manual mode on`;
    const panes: Record<string, string[]> = { 'ledge-a': [titled('first'), titled('first'), titled('second')] };
    const store = new Store(); store.upsert(mk('a'));
    const tmux = fakeTmux(panes);
    const p = startPoller({ store, tmux, intervalMs: 1_000_000 });
    await p.tick(); expect(store.get('a')?.topic).toBe('first');
    const after = store.get('a');
    await p.tick(); expect(store.get('a')).toBe(after); // same title, same pane: nothing emitted
    await p.tick(); expect(store.get('a')?.topic).toBe('second');
    p.stop();
  });
```
Use the file's existing `mk` and fake tmux helper (if its fake `capture` returns successive queued panes, pass them as above; otherwise mirror the file's own pattern).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test -- adapters-claude poller`
Expected: FAIL (`paneTitle` is not a function; topic undefined).

- [ ] **Step 3: Implement**

`packages/ledge/src/adapters/types.ts`, inside `Adapter`:
```ts
  /** The conversation's title the tool shows in its chrome (Claude Code: on the input box's top rule), or null before it has one. Optional. */
  paneTitle?(pane: string): string | null;
```
`packages/ledge/src/adapters/claude.ts`, next to `isInputTop`:
```ts
const TITLE_RULE = /^─{10,} (\S.*?) ─+$/;
/** `───── add-readme-file ─`: the title Claude Code writes on the input box's top rule once the conversation has one. */
function paneTitle(pane: string): string | null {
  const lines = pane.split('\n').map(l => l.replace(/\s+$/, ''));
  const box = inputBox(lines);
  const m = box ? TITLE_RULE.exec(lines[box.top]!.trim()) : null;
  return m ? m[1]! : null;
}
```
and add `paneTitle,` to the `claudeAdapter` object.

`packages/ledge/src/daemon/poller.ts`: add `const titles = new Map<string, string>();` next to `matches`, include `titles.delete(id)` in `forget`, and in `pollOne` right after `if (!adapter) return;`:
```ts
    const title = adapter.paneTitle?.(pane) ?? null;
    if (title && title !== titles.get(s.id)) { titles.set(s.id, title); store.apply(s.id, { name: 'PaneTitle', at: now(), source: 'pane', text: title }); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test -- adapters-claude poller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/adapters packages/ledge/src/daemon/poller.ts packages/ledge/test
git commit -m "feat(daemon): Claude Code's conversation title becomes the session's topic"
```

### Task 5: Repository and branch of a session

**Files:**
- Create: `packages/ledge/src/daemon/git.ts`
- Modify: `packages/ledge/src/daemon/store.ts`, `packages/ledge/src/daemon/poller.ts`
- Test: `packages/ledge/test/git.test.ts`, `packages/ledge/test/store.test.ts`, `packages/ledge/test/poller.test.ts`

**Interfaces:**
- Produces: `gitInfo(cwd, exec?): Promise<GitInfo | null>` with `GitInfo = { repo; repoPath; branch; worktree }`; `gitSummary(cwd, exec?): Promise<string | null>` (used by the chat in Task 10); `Store.patch(id, fields)`; poller option `gitInfo?`.

- [ ] **Step 1: Write the failing tests**

`packages/ledge/test/git.test.ts` (real git in a temp dir; `git` is available on the WSL side):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitInfo, gitSummary } from '../src/daemon/git.js';

let root: string; let main: string; let linked: string;
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ledge-git-')); main = join(root, 'repo'); linked = join(root, 'wt-feature');
  mkdirSync(main); git(main, 'init', '-q', '-b', 'main'); git(main, 'config', 'user.email', 't@t'); git(main, 'config', 'user.name', 't');
  writeFileSync(join(main, 'a.txt'), 'a'); git(main, 'add', '.'); git(main, 'commit', '-q', '-m', 'first');
  mkdirSync(join(main, 'sub')); git(main, 'worktree', 'add', '-q', '-b', 'worktree-feature', linked);
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('gitInfo', () => {
  it('reads the main worktree, from its root or a subfolder', async () => {
    expect(await gitInfo(main)).toEqual({ repo: 'repo', repoPath: main, branch: 'main', worktree: false });
    expect(await gitInfo(join(main, 'sub'))).toMatchObject({ repo: 'repo', repoPath: main, worktree: false });
  });
  it('reads a linked worktree back to its repository', async () => {
    expect(await gitInfo(linked)).toEqual({ repo: 'repo', repoPath: main, branch: 'worktree-feature', worktree: true });
  });
  it('shows the short sha on a detached head', async () => {
    git(linked, 'checkout', '-q', '--detach');
    expect((await gitInfo(linked))?.branch).toMatch(/^[0-9a-f]{7,}$/);
    git(linked, 'checkout', '-q', 'worktree-feature');
  });
  it('is null outside a repository and when git fails', async () => {
    expect(await gitInfo(root)).toBeNull();
    expect(await gitInfo(main, async () => ({ code: 1, stdout: '' }))).toBeNull();
  });
});

describe('gitSummary', () => {
  it('joins status, log and diff stat, null outside a repository', async () => {
    writeFileSync(join(main, 'a.txt'), 'changed');
    const s = await gitSummary(main);
    expect(s).toContain('## main'); expect(s).toContain('first'); expect(s).toContain('a.txt');
    expect(await gitSummary(root)).toBeNull();
  });
});
```
Append to `packages/ledge/test/store.test.ts`:
```ts
  it('patch sets repository fields and is silent when nothing changes', () => {
    const store = new Store({ journalPath: join(dir, 'j.json') }); store.upsert(mk('a'));
    const seen: string[] = []; store.onChange(c => seen.push(c.type));
    store.patch('a', { repo: 'r', repoPath: '/r', branch: 'main', worktree: false });
    expect(store.get('a')).toMatchObject({ repo: 'r', branch: 'main' }); expect(seen).toEqual(['updated']);
    store.patch('a', { repo: 'r', repoPath: '/r', branch: 'main', worktree: false }); expect(seen).toEqual(['updated']);
    store.patch('zz', { branch: 'x' }); expect(seen).toEqual(['updated']);
  });
```
(Adapt `dir`/`mk` to the file's fixtures.) Append to `packages/ledge/test/poller.test.ts`:
```ts
  it('refreshes repository fields on first sight and on the dead check, hook-only sessions included', async () => {
    const store = new Store(); store.upsert(mk('a')); store.upsert(mk('h', { tmuxSession: null, source: 'hook_only', cwd: '/h' }));
    const calls: string[] = [];
    const p = startPoller({ store, tmux: fakeTmux({ 'ledge-a': ['x'] }), intervalMs: 1_000_000, deadCheckMs: 1_000_000, gitInfo: async cwd => { calls.push(cwd); return { repo: 'r', repoPath: cwd, branch: 'main', worktree: false }; } });
    await p.tick();
    expect(calls.sort()).toEqual(['/h', mk('a').cwd].sort()); expect(store.get('h')?.branch).toBe('main');
    await p.tick(); expect(calls).toHaveLength(2); // no dead check yet: no refresh
    p.stop();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test -- git store poller`
Expected: FAIL (module not found, `patch` not a function, `gitInfo` option unknown).

- [ ] **Step 3: Implement**

`packages/ledge/src/daemon/git.ts`:
```ts
import { execFile } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

export interface GitInfo { repo: string; repoPath: string; branch: string; worktree: boolean }
/** Runs `file args` in `cwd`; a missing binary or a non-zero exit is a non-zero `code`, never a throw. */
export type Exec = (file: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string }>;
export const execGit: Exec = (file, args, cwd) => new Promise(res => {
  execFile(file, args, { cwd, timeout: 3000, maxBuffer: 1024 * 1024 }, (err, stdout) => res({ code: err ? 1 : 0, stdout: String(stdout) }));
});

/**
 * The repository a folder belongs to: its main worktree (name and absolute path), the checked-out branch (the short sha
 * on a detached head) and whether the folder is a linked worktree. Null outside a repository, before the first commit,
 * or without git.
 */
export async function gitInfo(cwd: string, exec: Exec = execGit): Promise<GitInfo | null> {
  const r = await exec('git', ['rev-parse', '--path-format=absolute', '--abbrev-ref', 'HEAD', '--short', 'HEAD', '--show-toplevel', '--git-common-dir'], cwd);
  if (r.code !== 0) return null;
  const [abbrev = '', short = '', toplevel = '', common = ''] = r.stdout.split('\n').map(l => l.trim());
  if (!toplevel || !common) return null;
  const worktree = resolve(common) !== resolve(toplevel, '.git');
  const repoPath = worktree ? dirname(resolve(common)) : resolve(toplevel);
  return { repo: basename(repoPath), repoPath, branch: abbrev === 'HEAD' ? short : abbrev, worktree };
}

/** What a reader needs to know about the folder's work: status with the branch line, the last commits, the uncommitted diff stat. */
export async function gitSummary(cwd: string, exec: Exec = execGit): Promise<string | null> {
  const status = await exec('git', ['status', '--short', '--branch'], cwd);
  if (status.code !== 0) return null;
  const log = await exec('git', ['log', '--oneline', '-10'], cwd);
  const diff = await exec('git', ['diff', '--stat'], cwd);
  return [`# git status --short --branch`, status.stdout.trimEnd(), '', '# git log --oneline -10', log.stdout.trimEnd(), '', '# git diff --stat', diff.stdout.trimEnd() || '(clean)'].join('\n');
}
```
`packages/ledge/src/daemon/store.ts`, after `touchRecent`:
```ts
  /** Facts no event carries (the session's repository): the changed fields only, nothing emitted when they are equal. */
  patch(id: string, fields: Partial<Pick<Session, 'repo' | 'repoPath' | 'branch' | 'worktree'>>): void {
    const cur = this.sessions.get(id); if (!cur) return;
    if ((Object.keys(fields) as Array<keyof typeof fields>).every(k => cur[k] === fields[k])) return;
    this.upsert({ ...cur, ...fields });
  }
```
`packages/ledge/src/daemon/poller.ts`: import `{ gitInfo as defaultGitInfo }` from `./git.js`; add `gitInfo?: typeof defaultGitInfo` to the options, `const git = opts.gitInfo ?? defaultGitInfo;` and `const gitSeen = new Set<string>();` (cleared in `forget`). In `pollOne`, after the `exited` block and **before** `if (!s.tmuxSession) return;`:
```ts
    // The repository can change under the agent (checkout, new worktree): first sight, then every dead check.
    if ((deadCheck || !gitSeen.has(s.id)) && s.cwd) { gitSeen.add(s.id); const g = await git(s.cwd); if (g) store.patch(s.id, g); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test -- git store poller && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/daemon packages/ledge/test
git commit -m "feat(daemon): each session knows its repository, branch and worktree"
```

### Task 6: Rename from the overlay, and the terminal tab follows the title

**Files:**
- Modify: `packages/ledge/src/daemon/server.ts`, `packages/ledge/src/tmux.ts`, `packages/ledge/src/paths.ts`
- Test: `packages/ledge/test/server.test.ts`, `packages/ledge/test/paths.test.ts`, `packages/ledge/test/tmux.test.ts`

**Interfaces:**
- Produces: `Tmux.setOption(name, option, value)`; `TMUX_CONF` with `set-titles`; `ensureLedgeDir` upgrades an old conf; the server handles `session.rename` and sets `@ledge_title` on every title change.

- [ ] **Step 1: Write the failing tests**

In `packages/ledge/test/server.test.ts`, extend `fakeTmux` with `async setOption(n, o, v) { sent.push(['option', n, o, v]); }` and add:
```ts
  it('renames a session and tells tmux the new tab title', async () => {
    store.upsert(mk('a'));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.rename', id: 'a', topic: 'Hooks Codex' });
    const m = await c.next('session.updated');
    expect(m.session).toMatchObject({ topic: 'Hooks Codex', topicSource: 'user', title: 'Otto · Hooks Codex' });
    expect(tmux.sent).toContainEqual(['option', 'ledge-a', '@ledge_title', 'Otto · Hooks Codex']);
    c.send({ type: 'session.rename', id: 'zz', topic: 'x' });
    expect((await c.next('error')).id).toBe('zz');
    await c.close();
  });
```
Append to `packages/ledge/test/paths.test.ts`:
```ts
  it('writes set-titles into a conf that predates it', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
    await mkdir(paths().dir, { recursive: true }); await writeFile(paths().tmuxConf, 'set -g status off\n');
    await ensureLedgeDir();
    const conf = await readFile(paths().tmuxConf, 'utf8');
    expect(conf).toContain('set -g set-titles on'); expect(conf).toContain('set-titles-string "#{@ledge_title}"');
    await ensureLedgeDir(); expect((await readFile(paths().tmuxConf, 'utf8')).match(/set-titles on/g)).toHaveLength(1);
  });
```
Append to `packages/ledge/test/tmux.test.ts` (it spins a real test server through `helpers.ts`): after creating a session with `newSession`, `await tmux.setOption('name', '@ledge_title', 'Otto · x')` then assert `run(['-L', socket, 'show-option', '-v', '-t', '=name', '@ledge_title'])` prints `Otto · x`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test -- server paths tmux`
Expected: FAIL (`setOption` missing, conf unchanged, `session.rename` unhandled).

- [ ] **Step 3: Implement**

`packages/ledge/src/tmux.ts`: add to the interface `setOption(name: string, option: string, value: string): Promise<void>;` and to `realTmux`:
```ts
    async setOption(name, option, value) {
      const r = await t(['set-option', '-t', `=${name}`, option, value]);
      if (r.code !== 0) throw new Error(`tmux set-option failed: ${r.stderr.trim()}`);
    },
```
`packages/ledge/src/paths.ts`:
```ts
/** The terminal tab shows the session's title (the daemon sets @ledge_title on each tmux session). */
export const TITLE_LINES = `set -g set-titles on
set -g set-titles-string "#{@ledge_title}"
`;
export const TMUX_CONF = `set -g status off
set -g mouse on
set -g default-terminal "tmux-256color"
set -sg escape-time 10
set -g history-limit 20000
set -g remain-on-exit off
${TITLE_LINES}`;
```
and in `ensureLedgeDir`, replace the try/catch with:
```ts
  let conf: string | null = null;
  try { conf = await readFile(p.tmuxConf, 'utf8'); } catch { /* none yet */ }
  if (conf === null) await writeFile(p.tmuxConf, TMUX_CONF);
  else if (!conf.includes('set-titles')) await writeFile(p.tmuxConf, `${conf.trimEnd()}\n${TITLE_LINES}`);
```
(import `readFile` from `node:fs/promises`; drop the now-unused `access`).

`packages/ledge/src/daemon/server.ts`: in the `store.onChange` subscription, before the broadcast:
```ts
    if (c.type === 'updated' && c.session.tmuxSession && titles.get(c.session.id) !== c.session.title) {
      titles.set(c.session.id, c.session.title);
      tmux.setOption(c.session.tmuxSession, '@ledge_title', c.session.title).catch(e => log(`tab title not set for ${c.session.id}: ${(e as Error).message}`));
    }
    if (c.type === 'removed') titles.delete(c.id);
```
with `const titles = new Map<string, string>();` beside `previews`. Add the handler in `handle`:
```ts
      case 'session.rename': {
        if (!store.get(msg.id)) return send(ws, { type: 'error', id: msg.id, message: 'unknown session' });
        store.apply(msg.id, { name: 'Renamed', at: now(), source: 'daemon', text: msg.topic });
        return;
      }
```
Every other test double of `Tmux` in `packages/ledge/test` (poller, daemon, launch tests) needs `setOption` too: add a no-op `async setOption() {}` where TypeScript complains.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge
git commit -m "feat(daemon): session.rename, and the terminal tab follows the session title through tmux"
```

### Task 7: The list groups by repository and shows topic and branch

**Files:**
- Create: `apps/overlay/src/surface/groups.ts`, `apps/overlay/src/ui/BranchChip.tsx`
- Modify: `apps/overlay/src/surface/SessionList.tsx`, `apps/overlay/src/surface/geometry.ts`, `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/ui/icons.tsx`, `apps/overlay/src/i18n/messages.ts`
- Test: `apps/overlay/test/groups.test.ts`, `apps/overlay/test/list.test.tsx`, `apps/overlay/test/geometry.test.ts`

**Interfaces:**
- Produces: `groupSessions(sessions): SessionGroup[]`, `headersBefore(groups, id): number`, `tildePath(p)`; `GROUP_H = 28` exported from `SessionList.tsx`; `SIZES.groupH`; `LayoutInput.groups?: number`; `<BranchChip session />`; i18n `list.noTopic`, `list.groupCount(n)`, `list.rowTitle(tool, cwd)`.

- [ ] **Step 1: Write the failing tests**

`apps/overlay/test/groups.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { groupSessions, headersBefore, tildePath } from '../src/surface/groups';
import { fakeSession } from './mockDaemon';

const a = fakeSession('a', { repo: 'ledge', repoPath: '/home/u/ledge', cwd: '/home/u/ledge', branch: 'main' });
const b = fakeSession('b', { repo: 'ledge', repoPath: '/home/u/ledge', cwd: '/home/u/ledge/.claude/worktrees/x', branch: 'worktree-x', worktree: true });
const c = fakeSession('c', { project: 'notes', cwd: '/home/u/notes' });

describe('groupSessions', () => {
  it('groups by repository path in first-seen order, folders without a repository on their own', () => {
    const g = groupSessions([a, c, b]);
    expect(g.map(x => [x.label, x.sessions.map(s => s.id)])).toEqual([['ledge', ['a', 'b']], ['notes', ['c']]]);
    expect(g[0]!.path).toBe('/home/u/ledge');
  });
  it('counts the headers above a row', () => {
    const g = groupSessions([a, c, b]);
    expect(headersBefore(g, 'a')).toBe(1); expect(headersBefore(g, 'b')).toBe(1); expect(headersBefore(g, 'c')).toBe(2); expect(headersBefore(g, 'zz')).toBe(0);
  });
  it('shortens the home folder', () => { expect(tildePath('/home/u/ledge')).toBe('~/ledge'); expect(tildePath('/srv/x')).toBe('/srv/x'); });
});
```
In `apps/overlay/test/list.test.tsx`, give the fixture sessions `topic`/`branch` data and replace the assertion on the secondary line:
```ts
const sessions = [
  fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' }, topic: 'Mascotte et tray', branch: 'main', repo: 'harness-assistant', repoPath: '/w/harness-assistant' }),
  fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', cwd: '/w/speos-api', startedAt: '2026-10-09T18:01:00.000Z', branch: 'worktree-codex', worktree: true, repo: 'speos-api', repoPath: '/w/speos-api' }),
  …
];
```
and in the first test:
```ts
    // Line 1 is the topic (or the placeholder), line 2 the name, the branch chip and the age; the badge sits on line 2.
    expect(within(rows[0]!).getByText('Mascotte et tray')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('No topic yet')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('codex')).toHaveAttribute('title', 'worktree worktree-codex');
    expect(within(rows[1]!).getByText(/^Pim$/)).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('title', 'Codex · /w/speos-api');
    // One header per repository, with its count.
    expect(screen.getByText('harness-assistant')).toBeInTheDocument(); expect(screen.getByText('1 bot')).toBeInTheDocument();
```
(The tests render in English: check `setup.ts` sets `en`; otherwise use the French strings.) Append to `apps/overlay/test/geometry.test.ts`:
```ts
  it('adds a header height per group to the list', () => {
    const bots = [{ id: 'a', pending: false }, { id: 'b', pending: false }];
    const one = layout({ bots, mode: 'list', screenH: 1000, groups: 1 });
    const two = layout({ bots, mode: 'list', screenH: 1000, groups: 2 });
    expect(two.h - one.h).toBe(SIZES.groupH);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter overlay test -- groups list geometry`
Expected: FAIL (module missing, old row text, `groups` ignored).

- [ ] **Step 3: Implement**

`apps/overlay/src/surface/groups.ts`:
```ts
import type { Session } from '@ledge/protocol';

export interface SessionGroup { key: string; label: string; path: string; sessions: Session[] }

/** Sessions by repository, in the order their first session appears; a folder outside any repository is its own group. */
export function groupSessions(sessions: Session[]): SessionGroup[] {
  const out: SessionGroup[] = []; const by = new Map<string, SessionGroup>();
  for (const s of sessions) {
    const key = s.repoPath ?? s.cwd; let g = by.get(key);
    if (!g) { g = { key, label: s.repo ?? s.project, path: key, sessions: [] }; by.set(key, g); out.push(g); }
    g.sessions.push(s);
  }
  return out;
}

/** How many group headers sit above the row of `id` (0 when the id is not listed). */
export function headersBefore(groups: SessionGroup[], id: string | null): number {
  let n = 0;
  for (const g of groups) { n++; if (g.sessions.some(s => s.id === id)) return n; }
  return 0;
}

/** `/home/<user>/x` and `/Users/<user>/x` as `~/x`. */
export const tildePath = (p: string): string => p.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~');
```
`apps/overlay/src/ui/icons.tsx`: add `branch: { d: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'] },` to `ICONS`.

`apps/overlay/src/ui/BranchChip.tsx`:
```tsx
import type { Session } from '@ledge/protocol';
import { Icon, ICONS } from './icons';

/** The checked-out branch as a mono chip; a linked worktree drops its `worktree-` prefix and gets a dashed border. */
export function BranchChip({ session: s }: { session: Session }) {
  if (!s.branch) return null;
  const label = s.worktree ? s.branch.replace(/^worktree-/, '') : s.branch;
  return (
    <span data-branch className="mono" title={`${s.worktree ? 'worktree' : 'branch'} ${s.branch}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 28, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, lineHeight: '14px', fontWeight: 500, padding: '2px 6px', borderRadius: 'var(--radius-sm)', color: 'var(--sidebar-foreground)', background: s.worktree ? 'transparent' : 'var(--secondary)', border: s.worktree ? '1px dashed var(--input)' : '1px solid transparent' }}>
      <Icon size={10} {...ICONS.branch} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </span>
  );
}
```
`apps/overlay/src/i18n/messages.ts`: in `fr.list` add `noTopic: 'Sans sujet encore', groupCount: (n: number) => `${n} ${plural(n, 'bot', 'bots')}`, rowTitle: (tool: string, cwd: string) => `${tool} · ${cwd}`,` and in `en.list` `noTopic: 'No topic yet', groupCount: (n: number) => `${n} ${plural(n, 'bot', 'bots')}`, rowTitle: (tool: string, cwd: string) => `${tool} · ${cwd}`,`.

`apps/overlay/src/surface/geometry.ts`: add `groupH: 28` to `SIZES`, `groups?: number` to `LayoutInput`, and change `rowsH` to `const rowsH = n === 0 ? SIZES.emptyH : 16 + n * SIZES.rowH + (input.groups ?? 0) * SIZES.groupH + (input.listExtraH ?? 0);`.

`apps/overlay/src/surface/SessionList.tsx`: export `const GROUP_H = SIZES.groupH;`, import `groupSessions, tildePath` and `BranchChip`, `toolName` stays. Replace the `{sessions.map((s, i) => …)}` block by a flat render over groups while keeping the running index `i` for numbering and cascade:
```tsx
        {(() => { let i = -1; return groupSessions(sessions).map(g => (
          <div key={g.key} data-group-of={g.key} style={{ display: 'contents' }}>
            <div data-group style={{ display: 'flex', alignItems: 'baseline', gap: 8, height: GROUP_H, flexShrink: 0, boxSizing: 'border-box', padding: '10px 17px 0', fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', opacity: visible ? 1 : 0, transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay + 20 : 0]]) }}>
              <span style={{ fontWeight: 600, color: 'var(--sidebar-foreground)', flexShrink: 0 }}>{g.label}</span>
              <span className="mono" style={{ fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tildePath(g.path)}</span>
              <span style={{ flexGrow: 1 }} />
              <span style={{ flexShrink: 0 }}>{t.list.groupCount(g.sessions.length)}</span>
            </div>
            {g.sessions.map(s => { i++; return renderRow(s, i); })}
          </div>
        )); })()}
```
where `renderRow = (s: Session, i: number) => (…)` is a plain function declared inside `SessionList` (not a nested component, which would remount every row on each render and break the cascade and focus) holding the existing row JSX unchanged (`hi`, `delay`, `focused`, `actions`, `bg`, `st`, `readOnly` computed exactly as today), with the row button's content replaced by:
```tsx
              {numbered && i < 9 && <Kbd accent={hi}>{i + 1}</Kbd>}
              <Bot … (unchanged) />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}>
                <span data-topic style={{ fontSize: 14, lineHeight: '18px', fontWeight: s.topic ? 600 : 500, color: s.topic ? undefined : 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.topic ?? t.list.noTopic}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
                  <span style={{ flexShrink: 0 }}>{s.name}</span>
                  {s.branch && <><span aria-hidden="true">·</span><BranchChip session={s} /></>}
                  <span aria-hidden="true">·</span><span style={{ flexShrink: 0 }}>{relativeTime(s.startedAt, now, t)}</span>
                  <span style={{ flexGrow: 1 }} />
                  {readOnly ? <Badge state="readonly" tone={st} /> : <Badge state={st} />}
                </span>
              </span>
```
and the row button gets `title={t.list.rowTitle(toolName(s.tool), s.cwd)}`. Remove the old trailing `<Badge>`.

`apps/overlay/src/surface/Surface.tsx`: pass `groups: groupSessions(sessions).length` into the `scaledLayout` call, and add `headersBefore(groupSessions(sessions), focused?.id ?? null) * SIZES.groupH` to the `rowTop` formula used by the coachmark (`const rowTop = geo.top + (SIZES.headerH + 8 + headers * SIZES.groupH + Math.max(0, focusIndex) * SIZES.rowH) * ps;`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test -- groups list geometry keyboard surface && pnpm typecheck`
Expected: PASS (fix any surface/keyboard test that asserted the old row text).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): the list groups sessions by repository and shows each one's topic and branch"
```

### Task 8: Handle separator, tooltip topic, renamable session header

**Files:**
- Modify: `apps/overlay/src/surface/Handle.tsx`, `apps/overlay/src/surface/geometry.ts`, `apps/overlay/src/surface/SessionView.tsx`, `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/i18n/messages.ts`
- Test: `apps/overlay/test/handle.test.tsx`, `apps/overlay/test/geometry.test.ts`, `apps/overlay/test/session.test.tsx`

**Interfaces:**
- Produces: `SIZES.separatorH = 1`; `SessionViewProps.onRename?: (topic: string) => void`; i18n `session.rename`, `session.topicPlaceholder`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/overlay/test/handle.test.tsx` (use the file's bot/slot fixtures):
```ts
  it('draws a separator between Ledge and the bots, hidden without bots', () => {
    const { rerender } = render(<Handle bots={bots} slots={slots} big={20} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-separator]')).toHaveStyle({ opacity: '1' });
    rerender(<Handle bots={[]} slots={[]} big={20} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-separator]')).toHaveStyle({ opacity: '0' });
  });
```
Append to `apps/overlay/test/geometry.test.ts`:
```ts
  it('the first slot sits under the resident, a gap, the separator and a gap', () => {
    const l = layout({ bots: [{ id: 'a', pending: false }], mode: 'handle', screenH: 1000 });
    const { small, gap } = slotSizes(1);
    expect(l.slots[0]!.center).toBe(l.handle.top + 8 + SIZES.residentH + gap + SIZES.separatorH + gap + small / 2);
    expect(l.handle.h).toBe(16 + SIZES.residentH + gap + SIZES.separatorH + gap + small);
  });
```
Append to `apps/overlay/test/session.test.tsx` (use its `fakeSession`/render helper):
```ts
  it('shows the topic and branch in the header and renames in place', () => {
    const onRename = vi.fn();
    const s = fakeSession('a', { topic: 'Hooks Codex', branch: 'worktree-codex', worktree: true });
    render(<SessionView session={s} preview={[]} visible reading={false} draft="" onDraft={() => {}} onBack={() => {}} onClose={() => {}} onDecide={() => {}} onReply={() => {}} onInterrupt={() => {}} onKill={() => {}} onFocus={() => {}} onToggleReading={() => {}} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hooks Codex' }));
    const input = screen.getByRole('textbox', { name: 'Rename the session' });
    fireEvent.change(input, { target: { value: 'Codex approvals' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('Codex approvals');
    expect(screen.getByText('codex')).toHaveAttribute('title', 'worktree worktree-codex');
  });
  it('Escape in the rename field cancels without closing the view', () => {
    const onClose = vi.fn(); const onRename = vi.fn();
    render(<SessionView session={fakeSession('a', { topic: 'T' })} preview={[]} visible reading={false} draft="" onDraft={() => {}} onBack={() => {}} onClose={onClose} onDecide={() => {}} onReply={() => {}} onInterrupt={() => {}} onKill={() => {}} onFocus={() => {}} onToggleReading={() => {}} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: 'T' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename the session' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'T' })).toBeInTheDocument(); expect(onRename).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter overlay test -- handle geometry session`
Expected: FAIL.

- [ ] **Step 3: Implement**

`geometry.ts`: add `separatorH: 1` to `SIZES`; in `layout`, `const sep = n ? 2 * gap + SIZES.separatorH : 0;`, `const handleH = 16 + SIZES.residentH + sep + bots.reduce(…) + Math.max(0, n - 1) * gap;` and `let y = handleTop + 8 + SIZES.residentH + sep;`.

`Handle.tsx`: right after the resident `<button>`:
```tsx
      <span data-separator aria-hidden="true" style={{ display: 'block', width: 12, height: 1, flexShrink: 0, background: 'var(--sidebar-border)', opacity: bots.length ? 1 : 0, marginTop: bots.length ? 0 : -gap - 1, transition: transition([['opacity', 'fadeIn', 0], ['margin-top', 'grow', 0]]) }} />
```

`messages.ts`: `fr.session` gets `rename: 'Renommer la session', topicPlaceholder: 'Le sujet de cette session',`; `en.session` gets `rename: 'Rename the session', topicPlaceholder: 'What this session is about',`.

`SessionView.tsx`: add `onRename?: (topic: string) => void;` to `SessionViewProps`, import `BranchChip`, and replace the two header `<span>`s (name · project, tool · age) with `<TopicLine session={s} t={t} now={p.now} onRename={p.onRename} />`, defined in the file:
```tsx
/** The header's first line is the topic (the user may rename it in place), the second the name, branch, tool and age. */
function TopicLine({ session: s, t, now, onRename }: { session: Session; t: Messages; now?: number; onRename?: (topic: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown = s.topic ?? `${s.name} · ${s.project}`;
  const commit = () => { if (editing !== null && editing.trim() !== (s.topic ?? '')) onRename?.(editing.trim()); setEditing(null); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0, paddingLeft: 4 }}>
      {editing === null
        ? <button type="button" data-topic disabled={!onRename} title={onRename ? t.session.rename : undefined} onClick={() => setEditing(s.topic ?? '')}
            style={{ all: 'unset', display: 'block', cursor: onRename ? 'text' : 'default', fontSize: 14, lineHeight: '18px', fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: s.topic ? undefined : 'var(--muted-foreground)' }}>{shown}</button>
        : <input autoFocus data-topic-input aria-label={t.session.rename} className="ledge-field" value={editing} placeholder={t.session.topicPlaceholder} onChange={e => setEditing(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }}
            style={{ height: 22, boxSizing: 'border-box', padding: '0 6px', fontSize: 14, fontWeight: 650, background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-sm)' }} />}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
        <span>{s.name}</span>
        {s.branch && <><span aria-hidden="true">·</span><BranchChip session={s} /></>}
        <span aria-hidden="true">·</span><span>{toolName(s.tool)}</span>
        <span aria-hidden="true">·</span><span>{relativeTime(s.startedAt, now, t)}</span>
      </span>
    </div>
  );
}
```
Escape: `useKeyboard` treats a focused input as "choosing" and still handles Escape by `onClose`; the React `stopPropagation` above stops the native event before the `window` listener, so the view stays open. Add a `focusWithin`-safe guard: nothing else needed.

`Surface.tsx`: where `<SessionView … />` is rendered, add `onRename={topic => send({ type: 'session.rename', id: shown.id, topic })}`; where `HandleBot.tip` is built from `rowHint(s, t)`, prepend the topic: `tip: s.topic ? `${s.topic} · ${rowHint(s, t)}` : rowHint(s, t)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test && pnpm typecheck`
Expected: PASS (update any snapshot-like assertion on the handle height in `surface.test.tsx` / `shoulders.test.tsx` by the separator's `2 × gap + 1`).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): Ledge sits apart in the handle, the tooltip and the session header carry the topic, renamable in place"
```

---

## Part B — Talking to Ledge

### Task 9: Chat protocol

**Files:**
- Create: `packages/protocol/src/chat.ts`
- Modify: `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/messages.test.ts`

**Interfaces:**
- Produces: `ChatStepSchema`/`ChatStep` `{ kind: 'sessions' | 'pane' | 'reply' | 'git' | 'repo'; id?; name?; path? }`, `ChatTurnSchema`/`ChatTurn` `{ qid; question; askedAt; steps; answer?; answeredAt?; error? }`; client `chat.ask { qid, text }`, `chat.cancel { qid }`; server `chat.step { qid, step }`, `chat.delta { qid, text }`, `chat.done { qid, text, at }`, `chat.error { qid, message }`, `chat.history { turns }`.

- [ ] **Step 1: Write the failing test**

```ts
  it('carries the chat messages', () => {
    expect(parseClientMessage({ type: 'chat.ask', qid: 'q1', text: 'Où en sont les autres ?' }).type).toBe('chat.ask');
    expect(() => parseClientMessage({ type: 'chat.ask', qid: 'q1', text: '' })).toThrow();
    expect(parseServerMessage({ type: 'chat.step', qid: 'q1', step: { kind: 'pane', id: 'a', name: 'Nova' } }).type).toBe('chat.step');
    expect(parseServerMessage({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', askedAt: T0, steps: [] }] }).type).toBe('chat.history');
    expect(parseServerMessage({ type: 'chat.done', qid: 'q1', text: 'ok', at: T0 }).type).toBe('chat.done');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ledge/protocol test`
Expected: FAIL (invalid discriminator).

- [ ] **Step 3: Implement**

`packages/protocol/src/chat.ts`:
```ts
import { z } from 'zod';

/** What Ledge consulted while answering: a context file (a session's pane, reply or git summary, the sessions list) or a repository file. */
export const ChatStepSchema = z.object({
  kind: z.enum(['sessions', 'pane', 'reply', 'git', 'repo']),
  id: z.string().optional(), name: z.string().optional(), path: z.string().optional()
});
export type ChatStep = z.infer<typeof ChatStepSchema>;

/** One question to Ledge and its answer; `error` set when it could not answer, both absent while it is still reading. */
export const ChatTurnSchema = z.object({
  qid: z.string().min(1), question: z.string(), askedAt: z.string().datetime(),
  steps: z.array(ChatStepSchema), answer: z.string().optional(), answeredAt: z.string().datetime().optional(), error: z.string().optional()
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;
```
`messages.ts`: import `ChatStepSchema, ChatTurnSchema`; add to `ServerMessageSchema`:
```ts
  /** The chat (spec 2026-10-11 §5): what Ledge reads, its words as they come, the final text, or why it stopped; the day's turns after each snapshot. */
  z.object({ type: z.literal('chat.step'), qid: z.string(), step: ChatStepSchema }),
  z.object({ type: z.literal('chat.delta'), qid: z.string(), text: z.string() }),
  z.object({ type: z.literal('chat.done'), qid: z.string(), text: z.string(), at: z.string().datetime() }),
  z.object({ type: z.literal('chat.error'), qid: z.string(), message: z.string() }),
  z.object({ type: z.literal('chat.history'), turns: z.array(ChatTurnSchema) }),
```
and to `ClientMessageSchema`:
```ts
  z.object({ type: z.literal('chat.ask'), qid: z.string().min(1), text: z.string().min(1) }),
  z.object({ type: z.literal('chat.cancel'), qid: z.string().min(1) }),
```
`index.ts`: `export * from './chat.js';`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ledge/protocol test && pnpm typecheck`
Expected: PASS (the overlay's `daemonStore.apply` switch may need no change yet: unknown types fall through).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): chat messages and turns"
```

### Task 10: The context folder Ledge reads

**Files:**
- Create: `packages/ledge/src/chat/context.ts`
- Test: `packages/ledge/test/chat-context.test.ts`

**Interfaces:**
- Consumes: `gitSummary` (Task 5).
- Produces: `writeContext(dir, input): Promise<Context>` with `ContextInput = { sessions: Session[]; capture(s): Promise<string[] | null>; git(cwd): Promise<string | null>; now: string }`, `Context = { dir; steps: Map<string, ChatStep>; repoPaths: string[] }`; `stepFor(path, ctx): ChatStep | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@ledge/protocol';
import { writeContext, stepFor } from '../src/chat/context.js';

const T0 = '2026-10-11T10:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

describe('writeContext', () => {
  it('writes sessions.md and one file per source, and maps them to steps', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledge-chat-')), 'context');
    const sessions = [
      mk('a', { topic: 'Hooks', repo: 'ledge', repoPath: '/w/ledge', branch: 'main', pending: { kind: 'permission', text: 'git push', source: 'hook' }, lastReply: { text: 'Fini.', at: T0 } }),
      mk('b', { name: 'Nova', tool: 'codex', tmuxSession: null, source: 'hook_only', cwd: '/w/other' })
    ];
    const ctx = await writeContext(dir, { sessions, now: T0, capture: async s => (s.tmuxSession ? ['line 1', 'line 2'] : null), git: async cwd => (cwd === '/w/ledge' ? '## main' : null) });
    const md = readFileSync(join(dir, 'sessions.md'), 'utf8');
    expect(md).toContain('## Otto (claude) — working'); expect(md).toContain('pending permission: git push'); expect(md).toContain('pane-a.txt'); expect(md).toContain('reply-a.md'); expect(md).toContain('git-a.txt');
    expect(md).toContain('## Nova (codex)'); expect(existsSync(join(dir, 'pane-b.txt'))).toBe(false);
    expect(readFileSync(join(dir, 'pane-a.txt'), 'utf8')).toBe('line 1\nline 2');
    expect(ctx.repoPaths).toEqual(['/w/ledge', '/w/other']);
    expect(stepFor(join(dir, 'pane-a.txt'), ctx)).toEqual({ kind: 'pane', id: 'a', name: 'Otto' });
    expect(stepFor(join(dir, 'sessions.md'), ctx)).toEqual({ kind: 'sessions' });
    expect(stepFor('/w/ledge/src/x.ts', ctx)).toEqual({ kind: 'repo', name: 'ledge', path: 'src/x.ts' });
    expect(stepFor('/elsewhere/y', ctx)).toEqual({ kind: 'repo', path: '/elsewhere/y' });
  });
  it('starts from an empty folder each time', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledge-chat-')), 'context');
    await writeContext(dir, { sessions: [mk('a', { lastReply: { text: 'x', at: T0 } })], now: T0, capture: async () => null, git: async () => null });
    await writeContext(dir, { sessions: [], now: T0, capture: async () => null, git: async () => null });
    expect(existsSync(join(dir, 'reply-a.md'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ledge test -- chat-context`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/ledge/src/chat/context.ts`:
```ts
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { ChatStep, Session } from '@ledge/protocol';

export interface ContextInput { sessions: Session[]; capture: (s: Session) => Promise<string[] | null>; git: (cwd: string) => Promise<string | null>; now: string }
export interface Context { dir: string; steps: Map<string, ChatStep>; repoPaths: string[] }

const STATE: Record<Session['state'], string> = {
  starting: 'starting', working: 'working', waiting_permission: "waiting for the user's approval", waiting_input: 'asking the user a question',
  idle: 'idle, waiting for instructions', error: 'in error', exited: 'exited'
};

/**
 * The folder Ledge reads before answering (spec 2026-10-11 §5.3): `sessions.md` names every session and the files that
 * describe it; `pane-<id>.txt`, `reply-<id>.md` and `git-<id>.txt` exist only where there is something to read.
 */
export async function writeContext(dir: string, input: ContextInput): Promise<Context> {
  await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  const steps = new Map<string, ChatStep>();
  const lines = [`# Ledge sessions at ${input.now}`, '', 'Each session below lists the files that describe it, in this folder.', ''];
  for (const s of input.sessions) {
    lines.push(`## ${s.name} (${s.tool}) — ${STATE[s.state]}`, `- id: ${s.id}`, `- topic: ${s.topic ?? '(none yet)'}`, `- folder: ${s.cwd}`,
      `- repository: ${s.repo ?? s.project}${s.branch ? `, branch ${s.branch}${s.worktree ? ' (linked worktree)' : ''}` : ''}`, `- started: ${s.startedAt}, last activity: ${s.lastActivityAt}`);
    if (s.pending) lines.push(`- pending ${s.pending.kind}: ${s.pending.text}`);
    const live = s.helpers.filter(h => h.state !== 'exited');
    if (live.length) lines.push(`- subagents: ${live.map(h => h.task || h.kind).join('; ')}`);
    const pane = await input.capture(s);
    if (pane) { const f = `pane-${s.id}.txt`; await writeFile(join(dir, f), pane.join('\n')); steps.set(f, { kind: 'pane', id: s.id, name: s.name }); lines.push(`- terminal, last lines: ${f}`); }
    if (s.lastReply) { const f = `reply-${s.id}.md`; await writeFile(join(dir, f), s.lastReply.text); steps.set(f, { kind: 'reply', id: s.id, name: s.name }); lines.push(`- last reply (${s.lastReply.at}): ${f}`); }
    const g = await input.git(s.cwd);
    if (g) { const f = `git-${s.id}.txt`; await writeFile(join(dir, f), g); steps.set(f, { kind: 'git', id: s.id, name: s.name }); lines.push(`- git status, log and diff stat: ${f}`); }
    lines.push('');
  }
  await writeFile(join(dir, 'sessions.md'), lines.join('\n')); steps.set('sessions.md', { kind: 'sessions' });
  const repoPaths = [...new Set(input.sessions.map(s => s.repoPath ?? s.cwd).filter(Boolean))];
  return { dir, steps, repoPaths };
}

/** The step a file read stands for: a context file by name, a repository file by repository, anything else by its path. */
export function stepFor(path: string, ctx: Context): ChatStep | null {
  const abs = resolve(path);
  if (abs.startsWith(`${resolve(ctx.dir)}/`)) return ctx.steps.get(basename(abs)) ?? null;
  const repo = ctx.repoPaths.find(r => abs.startsWith(`${resolve(r)}/`));
  return repo ? { kind: 'repo', name: basename(repo), path: abs.slice(resolve(repo).length + 1) } : { kind: 'repo', path: abs };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ledge test -- chat-context`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/chat/context.ts packages/ledge/test/chat-context.test.ts
git commit -m "feat(chat): the read-only context folder Ledge consults before answering"
```

### Task 11: Running `claude -p` and reading its stream

**Files:**
- Create: `packages/ledge/src/chat/claude.ts`, `packages/ledge/test/fake-claude.mjs`
- Test: `packages/ledge/test/chat-claude.test.ts`

**Interfaces:**
- Produces: `PERSONA: string`; `RunOptions = { question; cwd; addDirs; sessionId; resume; env; bin?: string[]; maxTurns? }`; `claudeArgs(o): string[]`; `ClaudeEvent = { type: 'init'; sessionId } | { type: 'tool'; tool; path? } | { type: 'delta'; text } | { type: 'result'; text; isError }`; `parseLine(line): ClaudeEvent[]`; `runClaude(o, onEvent, spawnImpl?): { done: Promise<{ code: number | null; stderr: string }>; kill(): void }`.

- [ ] **Step 1: Write the fake and the failing tests**

`packages/ledge/test/fake-claude.mjs` (a scripted stand-in for `claude -p --output-format stream-json`; `FAKE_CLAUDE_MODE` = `ok` | `fail` | `slow`):
```js
#!/usr/bin/env node
import { stdin, stdout, stderr, env, argv, exit } from 'node:process';
let q = ''; stdin.setEncoding('utf8'); for await (const c of stdin) q += c;
const say = o => stdout.write(JSON.stringify(o) + '\n');
const sid = argv.includes('--session-id') ? argv[argv.indexOf('--session-id') + 1] : argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1] : 'none';
const mode = env.FAKE_CLAUDE_MODE ?? 'ok';
if (mode === 'fail') { stderr.write('No conversation found with session ID: ' + sid + '\n'); exit(1); }
say({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd() });
say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: process.cwd() + '/sessions.md' } }] } });
say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: process.cwd() + '/pane-a.txt' } }] } });
if (mode === 'slow') await new Promise(r => setTimeout(r, 5000));
for (const t of ['Deux ', 'compagnons ', 'travaillent.']) say({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } });
say({ type: 'result', subtype: 'success', is_error: false, result: 'Deux compagnons travaillent. Question : ' + q.trim(), session_id: sid });
```
`packages/ledge/test/chat-claude.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { claudeArgs, parseLine, runClaude, PERSONA } from '../src/chat/claude.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const opts = (extra = {}) => ({ question: 'Où en sont les autres ?', cwd: process.cwd(), addDirs: ['/w/ledge'], sessionId: '11111111-1111-4111-8111-111111111111', resume: false, env: { ...process.env }, bin: [process.execPath, FAKE], ...extra });

describe('claudeArgs', () => {
  it('runs headless, restricted, read-only, streaming, with the day session', () => {
    const a = claudeArgs(opts());
    expect(a.slice(0, 2)).toEqual(['-p', '--restricted']);
    expect(a).toContain('--tools'); expect(a[a.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
    for (const f of ['--permission-mode', '--output-format', '--verbose', '--include-partial-messages', '--max-turns', '--append-system-prompt', '--add-dir', '--session-id']) expect(a).toContain(f);
    expect(a[a.indexOf('--append-system-prompt') + 1]).toBe(PERSONA);
    expect(a).not.toContain('--resume'); expect(a).not.toContain('Bash');
    expect(claudeArgs(opts({ resume: true }))).toContain('--resume');
  });
});

describe('parseLine', () => {
  it('maps init, tool use, text deltas and the result; ignores the rest', () => {
    expect(parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'S' }))).toEqual([{ type: 'init', sessionId: 'S' }]);
    expect(parseLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hm' }, { type: 'tool_use', name: 'Grep', input: { path: '/w' } }, { type: 'tool_use', name: 'Read', input: { file_path: '/f' } }] } })))
      .toEqual([{ type: 'tool', tool: 'Grep', path: '/w' }, { type: 'tool', tool: 'Read', path: '/f' }]);
    expect(parseLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } }))).toEqual([{ type: 'delta', text: 'a' }]);
    expect(parseLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: '' }))).toEqual([{ type: 'result', text: '', isError: true }]);
    expect(parseLine('not json')).toEqual([]); expect(parseLine(JSON.stringify({ type: 'user' }))).toEqual([]);
  });
});

describe('runClaude', () => {
  it('feeds the question on stdin and streams events until the result', async () => {
    const events: unknown[] = [];
    const h = runClaude(opts(), e => events.push(e));
    const r = await h.done;
    expect(r.code).toBe(0);
    expect(events[0]).toEqual({ type: 'init', sessionId: '11111111-1111-4111-8111-111111111111' });
    expect(events.filter((e: any) => e.type === 'tool')).toHaveLength(2);
    expect(events.filter((e: any) => e.type === 'delta').map((e: any) => e.text).join('')).toBe('Deux compagnons travaillent.');
    expect(events.at(-1)).toMatchObject({ type: 'result', isError: false, text: expect.stringContaining('Où en sont les autres ?') });
  });
  it('reports a failure with its stderr, and a kill', async () => {
    const r = await runClaude(opts({ env: { ...process.env, FAKE_CLAUDE_MODE: 'fail' } }), () => {}).done;
    expect(r.code).toBe(1); expect(r.stderr).toContain('No conversation found');
    const h = runClaude(opts({ env: { ...process.env, FAKE_CLAUDE_MODE: 'slow' } }), () => {}); setTimeout(() => h.kill(), 200);
    expect((await h.done).code).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test -- chat-claude`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/ledge/src/chat/claude.ts`:
```ts
import { spawn as nodeSpawn } from 'node:child_process';

/** Who Ledge is when it answers (spec 2026-10-11 §5.4). */
export const PERSONA = `Tu es Ledge, le compagnon qui veille sur les sessions d'agents (Claude Code, Codex, Cursor Agent) de l'utilisateur. Tu lis, tu ne touches à rien : pas de commande, pas d'écriture, jamais d'instruction envoyée à une session.
Tes sources : le dossier courant contient sessions.md (toutes les sessions, leur état et le nom de leurs fichiers), pane-<id>.txt (les dernières lignes du terminal d'une session), reply-<id>.md (sa dernière réponse) et git-<id>.txt (status, log et diff --stat de son dossier). Les dépôts eux-mêmes sont lisibles (Read, Grep, Glob) pour aller plus loin.
Commence toujours par lire sessions.md. Ne lis que ce que la question demande.
Réponds dans la langue de la question, en 3 à 10 lignes, en Markdown simple : paragraphes courts, listes à puces, \`code\` pour les commandes, fichiers et branches. Nomme chaque bot par son prénom en gras (**Nova**) la première fois. Dis d'où vient chaque fait et de quand il date quand cela compte. Si une information manque, dis-le au lieu de supposer. Tu ne proposes jamais d'agir à la place de l'utilisateur ; tu peux lui dire quel bot ouvrir.`;

export interface RunOptions {
  question: string; cwd: string; addDirs: string[]; sessionId: string; resume: boolean; env: NodeJS.ProcessEnv;
  /** The executable and its leading arguments (`['claude']` by default; tests pass `[node, fake-claude.mjs]`). */
  bin?: string[]; maxTurns?: number;
}

/** `claude -p` headless, restricted to reading (spec §5.2); the question goes on stdin, never in argv. */
export function claudeArgs(o: RunOptions): string[] {
  return ['-p', '--restricted', '--tools', 'Read,Grep,Glob', '--permission-mode', 'dontAsk', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--max-turns', String(o.maxTurns ?? 16), '--append-system-prompt', PERSONA, ...o.addDirs.flatMap(d => ['--add-dir', d]), ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId])];
}

export type ClaudeEvent = { type: 'init'; sessionId: string } | { type: 'tool'; tool: string; path?: string } | { type: 'delta'; text: string } | { type: 'result'; text: string; isError: boolean };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** One stream-json line as Ledge events (a message can hold several tool uses); nothing for the lines Ledge does not use. */
export function parseLine(line: string): ClaudeEvent[] {
  let m: Json; try { m = obj(JSON.parse(line)); } catch { return []; }
  if (m.type === 'system' && m.subtype === 'init' && str(m.session_id)) return [{ type: 'init', sessionId: str(m.session_id)! }];
  if (m.type === 'stream_event') {
    const ev = obj(m.event); const d = obj(ev.delta);
    return ev.type === 'content_block_delta' && d.type === 'text_delta' && str(d.text) !== undefined ? [{ type: 'delta', text: str(d.text)! }] : [];
  }
  if (m.type === 'assistant') {
    const content = obj(m.message).content;
    return (Array.isArray(content) ? content : []).map(obj).filter(b => b.type === 'tool_use').map(b => { const i = obj(b.input); const path = str(i.file_path) ?? str(i.path); return { type: 'tool' as const, tool: String(b.name ?? ''), ...(path ? { path } : {}) }; });
  }
  if (m.type === 'result') return [{ type: 'result', text: str(m.result) ?? '', isError: m.is_error === true || (m.subtype !== undefined && m.subtype !== 'success') }];
  return [];
}

export interface RunHandle { done: Promise<{ code: number | null; stderr: string }>; kill(): void }

/** Spawns Claude Code and feeds every stream line to `onEvent`; `done` resolves with the exit code and the tail of stderr. */
export function runClaude(o: RunOptions, onEvent: (e: ClaudeEvent) => void, spawnImpl: typeof nodeSpawn = nodeSpawn): RunHandle {
  const [file = 'claude', ...pre] = o.bin ?? ['claude'];
  const child = spawnImpl(file, [...pre, ...claudeArgs(o)], { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; let stderr = '';
  const feed = (line: string) => { for (const e of parseLine(line)) onEvent(e); };
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { feed(buf.slice(0, i)); buf = buf.slice(i + 1); } });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (c: string) => { stderr = (stderr + c).slice(-2000); });
  const done = new Promise<{ code: number | null; stderr: string }>(res => {
    child.on('error', e => { stderr = `${stderr}${e.message}`.slice(-2000); res({ code: null, stderr }); });
    child.on('close', code => { if (buf.trim()) feed(buf); res({ code, stderr }); });
  });
  child.stdin!.on('error', () => { /* the child exited before reading: close reports it */ });
  child.stdin!.end(o.question);
  return { done, kill: () => { child.kill('SIGTERM'); } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test -- chat-claude`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge/src/chat/claude.ts packages/ledge/test/fake-claude.mjs packages/ledge/test/chat-claude.test.ts
git commit -m "feat(chat): run claude -p restricted and read its stream-json"
```

### Task 12: The chat service and the server wiring

**Files:**
- Create: `packages/ledge/src/chat/service.ts`
- Modify: `packages/ledge/src/daemon/server.ts`
- Test: `packages/ledge/test/server.test.ts`

**Interfaces:**
- Consumes: `writeContext`, `stepFor` (Task 10), `runClaude` (Task 11), `gitSummary` (Task 5).
- Produces: `createChat(deps): Chat` with `Chat = { ask(qid, text, emit): Promise<void>; cancel(qid): void; history(): ChatTurn[] }`, `ChatDeps = { store; tmux; home; env(): Promise<NodeJS.ProcessEnv>; now?; bin?; spawn?; timeoutMs?; uuid?; today?(): string }`; `startServer` options `chat?: Chat`, `claudeBin?: string[]`.

- [ ] **Step 1: Write the failing tests**

In `packages/ledge/test/server.test.ts`, start the server with `claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))]` (in `beforeEach`), and add:
```ts
describe('chat', () => {
  it('answers a question with steps, deltas and a result, then serves it in the history', async () => {
    store.upsert(mk('a', { topic: 'Hooks' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    expect((await c.next('chat.history')).turns).toEqual([]);
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Où en sont les autres ?' });
    const step = await c.next('chat.step'); expect(step.step).toEqual({ kind: 'sessions' });
    expect((await c.next('chat.step')).step).toEqual({ kind: 'pane', id: 'a', name: 'Otto' });
    expect((await c.next('chat.delta')).text).toBe('Deux ');
    const done = await c.next('chat.done', 5000); expect(done.text).toContain('Question : Où en sont les autres ?');
    await c.close();
    const c2 = await connect({ port: srv.port }); await c2.next('snapshot');
    const h = await c2.next('chat.history'); expect(h.turns).toHaveLength(1); expect(h.turns[0]).toMatchObject({ qid: 'q1', answer: done.text, steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'a', name: 'Otto' }] });
    await c2.close();
  });
  it('refuses a second question while one runs, and retries once with a fresh day session', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'chat.ask', qid: 'q1', text: 'a' }); c.send({ type: 'chat.ask', qid: 'q2', text: 'b' });
    const err = await c.next('chat.error'); expect(err.qid).toBe('q2');
    await c.next('chat.done', 5000);
    await c.close();
  });
});
```
and a unit test on the service's retry (file `packages/ledge/test/chat-service.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createChat } from '../src/chat/service.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmux = { async capture() { return null; } } as any;
describe('chat service', () => {
  it('resumes the day session, and starts a new one when the resume fails', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
    let calls = 0;
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', uuid: () => '33333333-3333-4333-8333-333333333333',
      env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: calls++ === 0 ? 'fail' : 'ok' }), bin: [process.execPath, FAKE] });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(m));
    expect(out.at(-1)?.type).toBe('chat.done');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toEqual({ day: '2026-10-11', sessionId: '33333333-3333-4333-8333-333333333333' });
  });
  it('a new day forgets yesterday\'s turns and session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-10', sessionId: '22222222-2222-4222-8222-222222222222' }));
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', uuid: () => '44444444-4444-4444-8444-444444444444', env: async () => ({ ...process.env }), bin: [process.execPath, FAKE] });
    await chat.ask('q1', 'x', () => {});
    expect(chat.history()).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8')).sessionId).toBe('44444444-4444-4444-8444-444444444444');
  });
});
```
Note: `FAKE_CLAUDE_MODE=fail` must only apply to the first spawn: the `env()` dependency is called per attempt, which the implementation below guarantees.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ledge test -- server chat-service`
Expected: FAIL (module missing, `chat.ask` unhandled, no `chat.history`).

- [ ] **Step 3: Implement**

`packages/ledge/src/chat/service.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChatTurn, ServerMessage, Session } from '@ledge/protocol';
import type { Store } from '../daemon/store.js';
import type { Tmux } from '../tmux.js';
import { gitSummary } from '../daemon/git.js';
import { writeContext, stepFor } from './context.js';
import { runClaude, type RunHandle } from './claude.js';
import { log } from '../log.js';

export type ChatMessage = Extract<ServerMessage, { type: 'chat.step' | 'chat.delta' | 'chat.done' | 'chat.error' }>;
export interface Chat { ask(qid: string, text: string, emit: (m: ChatMessage) => void): Promise<void>; cancel(qid: string): void; history(): ChatTurn[] }
export interface ChatDeps {
  store: Store; tmux: Pick<Tmux, 'capture'>; home: string;
  /** The environment the chat process runs in (the login shell's PATH, like a launched agent). */
  env: () => Promise<NodeJS.ProcessEnv>;
  now?: () => string; today?: () => string; uuid?: () => string; bin?: string[]; spawn?: typeof nodeSpawn; timeoutMs?: number;
}

export const ONE_AT_A_TIME = 'one question at a time: wait for the answer';
/** How many of the day's turns are kept for a client that connects later. */
const HISTORY_MAX = 50;
/** The lines of a terminal Ledge gets to read. */
const PANE_LINES = 40;

const sameStep = (a: ChatTurn['steps'][number], b: ChatTurn['steps'][number]) => a.kind === b.kind && a.id === b.id && a.path === b.path;

/** One conversation with Ledge per day, run by `claude -p` (spec 2026-10-11 §5). */
export function createChat(deps: ChatDeps): Chat {
  const now = deps.now ?? (() => new Date().toISOString());
  const today = deps.today ?? (() => now().slice(0, 10));
  const uuid = deps.uuid ?? randomUUID;
  const dayFile = join(deps.home, 'chat.json');
  let turns: ChatTurn[] = []; let turnsDay = '';
  let current: { qid: string; handle: RunHandle; cancelled: boolean } | null = null;

  /** A new day starts an empty history; the day file decides the Claude session separately. */
  function rollDay(): void { const day = today(); if (turnsDay !== day) { turns = []; turnsDay = day; } }

  /** Today's Claude session: resumed from the day file when it names today, else a fresh id written there (`fresh` forces one). */
  async function daySession(fresh: boolean): Promise<{ sessionId: string; resume: boolean }> {
    const day = today();
    if (!fresh) {
      try { const saved = JSON.parse(await readFile(dayFile, 'utf8')) as { day?: string; sessionId?: string }; if (saved.day === day && saved.sessionId) return { sessionId: saved.sessionId, resume: true }; } catch { /* none yet */ }
    }
    const sessionId = uuid();
    await mkdir(dirname(dayFile), { recursive: true }); await writeFile(dayFile, JSON.stringify({ day, sessionId }));
    return { sessionId, resume: false };
  }

  const capture = async (s: Session) => { if (!s.tmuxSession) return null; const p = await deps.tmux.capture(s.tmuxSession, PANE_LINES); return p === null ? null : p.split('\n'); };

  async function attempt(turn: ChatTurn, emit: (m: ChatMessage) => void, fresh: boolean): Promise<{ ok: true } | { ok: false; message: string; resumed: boolean }> {
    const ctx = await writeContext(join(deps.home, 'chat', 'context'), { sessions: deps.store.all(), now: now(), capture, git: cwd => gitSummary(cwd) });
    const { sessionId, resume } = await daySession(fresh);
    const env = { ...(await deps.env()), LEDGE_CHAT: '1' }; delete env.LEDGE_SESSION; delete env.LEDGE_NAME;
    let answer = ''; let resultError: string | null = null;
    const handle = runClaude({ question: turn.question, cwd: ctx.dir, addDirs: ctx.repoPaths, sessionId, resume, env, bin: deps.bin }, e => {
      if (e.type === 'tool') { const step = e.path ? stepFor(e.path, ctx) : null; if (step && !turn.steps.some(s => sameStep(s, step))) { turn.steps.push(step); emit({ type: 'chat.step', qid: turn.qid, step }); } }
      else if (e.type === 'delta') { answer += e.text; emit({ type: 'chat.delta', qid: turn.qid, text: e.text }); }
      else if (e.type === 'result') { if (e.text) answer = e.text; if (e.isError) resultError = e.text || 'Claude Code reported an error'; }
    }, deps.spawn);
    current = { qid: turn.qid, handle, cancelled: false };
    const timer = setTimeout(() => { log(`chat ${turn.qid}: timed out`); handle.kill(); }, deps.timeoutMs ?? 180_000);
    const r = await handle.done; clearTimeout(timer);
    const cancelled = current.cancelled; current = null;
    if (cancelled) return { ok: false, message: 'cancelled', resumed: false };
    if (r.code !== 0) return { ok: false, message: r.code === null ? `Claude Code could not start: ${r.stderr.trim() || 'not found in PATH'}` : r.stderr.trim() || `Claude Code exited with code ${r.code}`, resumed: resume };
    if (resultError) return { ok: false, message: resultError, resumed: false };
    turn.answer = answer; turn.answeredAt = now();
    emit({ type: 'chat.done', qid: turn.qid, text: answer, at: turn.answeredAt });
    return { ok: true };
  }

  return {
    history: () => turns,
    cancel(qid) { if (current?.qid === qid) { current.cancelled = true; current.handle.kill(); } },
    async ask(qid, text, emit) {
      if (current) return emit({ type: 'chat.error', qid, message: ONE_AT_A_TIME });
      const turn: ChatTurn = { qid, question: text, askedAt: now(), steps: [] };
      rollDay();
      turns = [...turns, turn].slice(-HISTORY_MAX);
      let r = await attempt(turn, emit, false);
      // A day session whose transcript is gone (or a CLI that forgot it): once more, from a fresh conversation.
      if (!r.ok && r.resumed) { log(`chat ${qid}: resume failed (${r.message}), starting a new day session`); turn.steps.length = 0; r = await attempt(turn, emit, true); }
      if (!r.ok) { turn.error = r.message; emit({ type: 'chat.error', qid, message: r.message }); }
    }
  };
}
```
`packages/ledge/src/daemon/server.ts`: import `createChat, type Chat` from `../chat/service.js` and `paths` from `../paths.js`; add `chat?: Chat; claudeBin?: string[]` to the options; after `agentPath` is defined:
```ts
  const chat = opts.chat ?? createChat({ store, tmux, home: paths().dir, env: async () => ({ ...process.env, PATH: await agentPath() }), bin: opts.claudeBin, now });
```
In `sendSnapshot`, after the previews: `send(ws, { type: 'chat.history', turns: chat.history() });`. In `handle`:
```ts
      case 'chat.ask': return chat.ask(msg.qid, msg.text, broadcast);
      case 'chat.cancel': return chat.cancel(msg.qid);
```
(`broadcast` already has the right shape: `(m: ServerMessage) => void`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ledge test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledge
git commit -m "feat(daemon): ask Ledge: one claude -p conversation a day over a read-only context, streamed to the overlay"
```

### Task 13: Overlay store and surface machine for the chat

**Files:**
- Modify: `apps/overlay/src/daemon/store.ts`, `apps/overlay/src/surface/machine.ts`, `apps/overlay/src/surface/geometry.ts`
- Test: `apps/overlay/test/daemon.test.ts` (or `changes.test.ts`, where `daemonStore.apply` is tested), `apps/overlay/test/machine.test.ts`, `apps/overlay/test/geometry.test.ts`

**Interfaces:**
- Produces: `DaemonState.chat: ChatTurn[]`, `DaemonState.chatLive: { qid: string; text: string } | null`, `daemonStore.beginTurn(turn: ChatTurn)`; `Mode` gains `'chat'`; `SurfaceEvent` gains `{ type: 'chat' }`; `SIZES.chatH = 560`; `layout` sizes `chat` at `SIZES.sessionW` and the measured `detailH`.

- [ ] **Step 1: Write the failing tests**

In the overlay test that drives `daemonStore.apply`:
```ts
  it('keeps the chat turns and the live answer', () => {
    daemonStore.reset();
    daemonStore.apply({ type: 'chat.history', turns: [{ qid: 'q0', question: 'hier', askedAt: T0, steps: [], answer: 'ok', answeredAt: T0 }] });
    daemonStore.beginTurn({ qid: 'q1', question: 'Où en sont les autres ?', askedAt: T0, steps: [] });
    daemonStore.apply({ type: 'chat.step', qid: 'q1', step: { kind: 'sessions' } });
    daemonStore.apply({ type: 'chat.delta', qid: 'q1', text: 'Deux ' }); daemonStore.apply({ type: 'chat.delta', qid: 'q1', text: 'bots.' });
    expect(daemonStore.getState().chatLive).toEqual({ qid: 'q1', text: 'Deux bots.' });
    daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'Deux bots travaillent.', at: T0 });
    const s = daemonStore.getState();
    expect(s.chatLive).toBeNull(); expect(s.chat.map(t => t.qid)).toEqual(['q0', 'q1']); expect(s.chat[1]).toMatchObject({ answer: 'Deux bots travaillent.', steps: [{ kind: 'sessions' }] });
    daemonStore.apply({ type: 'chat.error', qid: 'q1', message: 'boom' }); expect(daemonStore.getState().chat[1]?.error).toBe('boom');
  });
```
`machine.test.ts`:
```ts
  it('opens the chat over the list and goes back to it', () => {
    let r = transition({ ...initialSurface(), mode: 'list', openedBy: 'mouse' }, { type: 'chat' });
    expect(r.state.mode).toBe('chat');
    r = transition(r.state, { type: 'back' }); expect(r.state.mode).toBe('list');
    expect(transition(initialSurface(), { type: 'chat' }).state.mode).toBe('handle');
  });
```
`geometry.test.ts`:
```ts
  it('sizes the chat like a session, by its measured height', () => {
    const l = layout({ bots: [], mode: 'chat', screenH: 1000, detailH: 500 });
    expect(l.w).toBe(SIZES.sessionW); expect(l.h).toBe(500);
    expect(layout({ bots: [], mode: 'chat', screenH: 1000 }).h).toBe(SIZES.chatH);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter overlay test -- daemon changes machine geometry`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/overlay/src/daemon/store.ts`: import `ChatTurn`; add to `DaemonState`:
```ts
  /** The day's conversation with Ledge, oldest first, and the answer being streamed (null between questions). */
  chat: ChatTurn[]; chatLive: { qid: string; text: string } | null;
```
(`empty()` gets `chat: [], chatLive: null`). Add to `daemonStore`:
```ts
  /** The overlay lists its own question at once; the daemon's events fill it in. */
  beginTurn(turn: ChatTurn) { state = { ...state, chat: [...state.chat.filter(t => t.qid !== turn.qid), turn], chatLive: null }; emit(); },
```
and at the top of `apply`, before the `error` line:
```ts
    if (m.type === 'chat.history') { state = { ...state, chat: m.turns, chatLive: null }; emit(); return; }
    if (m.type === 'chat.step' || m.type === 'chat.delta' || m.type === 'chat.done' || m.type === 'chat.error') {
      const chat = state.chat.map(t => t.qid !== m.qid ? t
        : m.type === 'chat.step' ? { ...t, steps: [...t.steps, m.step] }
        : m.type === 'chat.done' ? { ...t, answer: m.text, answeredAt: m.at }
        : m.type === 'chat.error' ? { ...t, error: m.message } : t);
      const chatLive = m.type === 'chat.delta' ? { qid: m.qid, text: (state.chatLive?.qid === m.qid ? state.chatLive.text : '') + m.text } : m.type === 'chat.step' ? state.chatLive : null;
      state = { ...state, chat, chatLive }; emit(); return;
    }
```
`geometry.ts`: `Mode` adds `'chat'`; `SIZES` adds `chatH: 560`; in `layout`, before the settings/help/launch branch:
```ts
  if (mode === 'chat') {
    const h = Math.min(maxH, input.detailH ?? SIZES.chatH);
    return { top: clamp(Math.round(centerY - h / 2), SIZES.margin, screenH - SIZES.margin - h), w: SIZES.sessionW, h, slots, handle, hotZones };
  }
```
`machine.ts`: add `| { type: 'chat' }` to `SurfaceEvent`; `detail` and `listMayFold` include `'chat'`; the `case 'settings': case 'help': case 'launch':` line becomes `case 'settings': case 'help': case 'launch': case 'chat':`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test -- daemon changes machine geometry && pnpm typecheck`
Expected: PASS (`Surface.tsx` may need `'chat'` added to its local `detail` boolean to compile: do it now, the view comes in Task 14).

- [ ] **Step 5: Commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): chat turns in the daemon store, a chat mode in the surface machine"
```

### Task 14: Ask field, chat view and wiring

**Files:**
- Create: `apps/overlay/src/surface/ChatView.tsx`, `apps/overlay/src/surface/AskField.tsx`
- Modify: `apps/overlay/src/surface/SessionList.tsx`, `apps/overlay/src/surface/ReplyCard.tsx`, `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/keyboard/useKeyboard.ts`, `apps/overlay/src/i18n/messages.ts`
- Test: `apps/overlay/test/chat.test.tsx`, `apps/overlay/test/list.test.tsx`, `apps/overlay/test/keyboard.test.tsx`, `apps/overlay/test/i18n.test.tsx`

**Interfaces:**
- Consumes: `DaemonState.chat`/`chatLive`, `daemonStore.beginTurn`, `{ type: 'chat' }` (Task 13), `ResidentMascot` gestures (`pulse`), `inline` from `ReplyCard`.
- Produces: `<AskField onAsk onTyping disabled placeholder />` (`data-ask` on its input); `SessionList` props `onAsk?`, `onTyping?`; `ChatView` props below; `inline(text, depth?, onLink?)`; `KeyboardOptions.onAsk?: () => void` (the `/` key in the list); i18n `chat.*`.

- [ ] **Step 1: Write the failing tests**

`apps/overlay/test/chat.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChatTurn } from '@ledge/protocol';
import { ChatView } from '../src/surface/ChatView';
import { AskField } from '../src/surface/AskField';
import { fakeSession } from './mockDaemon';

const T0 = '2026-10-11T10:00:00.000Z';
const sessions = [fakeSession('a', { name: 'Nova', repoPath: '/w/ledge' }), fakeSession('b', { name: 'Pim', repoPath: '/w/other' })];
const base = { sessions, visible: true, offline: null, onAsk: () => {}, onCancel: () => {}, onBack: () => {}, onClose: () => {}, onOpenSession: () => {} };

describe('<AskField>', () => {
  it('sends a non-empty question on Enter and reports typing', () => {
    const onAsk = vi.fn(), onTyping = vi.fn();
    render(<AskField onAsk={onAsk} onTyping={onTyping} />);
    const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
    fireEvent.focus(input); expect(onTyping).toHaveBeenCalledWith(true);
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onAsk).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' Où en sont les autres ? ' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('Où en sont les autres ?'); expect(input).toHaveValue('');
  });
});

describe('<ChatView>', () => {
  it('shows the suggestions when empty, and asks one on click', () => {
    const onAsk = vi.fn();
    render(<ChatView {...base} turns={[]} live={null} onAsk={onAsk} />);
    expect(screen.getByText('Sees 2 sessions · 2 repositories · read only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'How are the others doing?' }));
    expect(onAsk).toHaveBeenCalledWith('How are the others doing?');
  });
  it('shows a running turn with its steps, the live text and a stop button', () => {
    const onCancel = vi.fn();
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'a', name: 'Nova' }] }];
    render(<ChatView {...base} turns={turns} live={{ qid: 'q1', text: 'Deux ' }} onCancel={onCancel} />);
    expect(screen.getByText('Reads the sessions')).toBeInTheDocument(); expect(screen.getByText("Reads Nova's terminal")).toBeInTheDocument();
    expect(screen.getByText('Deux')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' })); expect(onCancel).toHaveBeenCalledWith('q1');
    expect(screen.getByRole('textbox', { name: 'Ask Ledge' })).toBeDisabled();
  });
  it('renders the answer, links bot names to their session, and lists the sources', () => {
    const onOpen = vi.fn();
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [{ kind: 'sessions' }, { kind: 'git', id: 'b', name: 'Pim' }], answer: '**Nova** attend votre accord.\n\n- `git push` en attente\n- rien d\'autre', answeredAt: T0 }];
    render(<ChatView {...base} turns={turns} live={null} onOpenSession={onOpen} now={Date.parse(T0) + 10_000} />);
    fireEvent.click(screen.getByRole('link', { name: 'Nova' })); expect(onOpen).toHaveBeenCalledWith('a');
    expect(screen.getByText('git push')).toBeInTheDocument();
    const sources = screen.getByText('Sources').parentElement!;
    expect(within(sources).getByText('the sessions')).toBeInTheDocument(); expect(within(sources).getByText("git in Pim's folder")).toBeInTheDocument(); expect(within(sources).getByText(/ago$/)).toBeInTheDocument();
  });
  it('shows an error under the question and reopens the field; offline disables it with the reason', () => {
    const turns: ChatTurn[] = [{ qid: 'q1', question: 'x', askedAt: T0, steps: [], error: 'boom' }];
    const { rerender } = render(<ChatView {...base} turns={turns} live={null} />);
    expect(screen.getByText('Ledge could not answer: boom')).toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Ask Ledge' })).toBeEnabled();
    rerender(<ChatView {...base} turns={[]} live={null} offline="Offline" />);
    expect(screen.getByRole('textbox', { name: 'Ask Ledge' })).toBeDisabled(); expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});
```
Append to `apps/overlay/test/list.test.tsx`:
```tsx
  it('carries the ask field above the footer', () => {
    const onAsk = vi.fn();
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} onAsk={onAsk} />);
    const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
    fireEvent.change(input, { target: { value: 'hello' } }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('hello');
  });
```
Append to `apps/overlay/test/keyboard.test.tsx` (use its harness that renders a hook host and fires `keydown` on `window`):
```tsx
  it('/ focuses the ask field in the list only', () => {
    const onAsk = vi.fn();
    renderKeyboard({ mode: 'list', onAsk }); fireEvent.keyDown(window, { key: '/' }); expect(onAsk).toHaveBeenCalledTimes(1);
    renderKeyboard({ mode: 'session', onAsk }); fireEvent.keyDown(window, { key: '/' }); expect(onAsk).toHaveBeenCalledTimes(1);
  });
```
(`i18n.test.tsx` already compares `fr` and `en` shapes through the type: adding keys to only one side fails `pnpm typecheck`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter overlay test -- chat list keyboard`
Expected: FAIL (modules missing, no field, `/` unhandled).

- [ ] **Step 3: Implement**

`messages.ts`, in `fr`:
```ts
  chat: {
    title: 'Ledge', subtitle: (n: number, repos: number) => `Voit ${n} ${plural(n, 'session', 'sessions')} · ${repos} ${plural(repos, 'dépôt', 'dépôts')} · lecture seule`,
    ask: 'Demander à Ledge', askPlaceholder: 'Demander à Ledge…', send: 'Envoyer', stop: 'Arrêter', back: 'Retour aux sessions', close: 'Fermer',
    emptyTitle: 'Demandez-moi des nouvelles.', emptyHint: (n: number) => `Je vois ${n === 0 ? 'aucune session' : `${n} ${plural(n, 'session', 'sessions')}`}, les terminaux et les dépôts. Je lis, je ne touche à rien.`,
    chips: ['Où en sont les autres ?', 'Qu’est-ce qui attend ma décision ?', 'Quelles branches peuvent être fusionnées ?'],
    thinking: 'Ledge cherche…',
    step: { sessions: 'Relit les sessions', pane: (name: string) => `Lit le terminal de ${name}`, reply: (name: string) => `Lit la dernière réponse de ${name}`, git: (name: string) => `git dans le dossier de ${name}`, repo: (path: string) => `Lit ${path}` },
    source: { sessions: 'les sessions', pane: (name: string) => `le terminal de ${name}`, reply: (name: string) => `la dernière réponse de ${name}`, git: (name: string) => `git dans le dossier de ${name}`, repo: (path: string) => path },
    sources: 'Sources', sourcesNone: 'aucune lecture', ago: (when: string) => `il y a ${when}`,
    error: (why: string) => `Ledge n’a pas pu répondre : ${why}`
  },
```
and in `en`:
```ts
  chat: {
    title: 'Ledge', subtitle: (n: number, repos: number) => `Sees ${n} ${plural(n, 'session', 'sessions')} · ${repos} ${plural(repos, 'repository', 'repositories')} · read only`,
    ask: 'Ask Ledge', askPlaceholder: 'Ask Ledge…', send: 'Send', stop: 'Stop', back: 'Back to sessions', close: 'Close',
    emptyTitle: 'Ask me how things are going.', emptyHint: (n: number) => `I see ${n === 0 ? 'no session' : `${n} ${plural(n, 'session', 'sessions')}`}, the terminals and the repositories. I read, I touch nothing.`,
    chips: ['How are the others doing?', 'What is waiting for my decision?', 'Which branches can be merged?'],
    thinking: 'Ledge is looking…',
    step: { sessions: 'Reads the sessions', pane: (name: string) => `Reads ${name}'s terminal`, reply: (name: string) => `Reads ${name}'s last reply`, git: (name: string) => `git in ${name}'s folder`, repo: (path: string) => `Reads ${path}` },
    source: { sessions: 'the sessions', pane: (name: string) => `${name}'s terminal`, reply: (name: string) => `${name}'s last reply`, git: (name: string) => `git in ${name}'s folder`, repo: (path: string) => path },
    sources: 'Sources', sourcesNone: 'nothing read', ago: (when: string) => `${when} ago`,
    error: (why: string) => `Ledge could not answer: ${why}`
  },
```

`ReplyCard.tsx`: make `inline` accept an optional link handler and recognise `ledge://` links. Change the `TOKEN` link group to `\[(?<ltext>[^\]\n]+)\]\((?<lurl>(?:https?|ledge):\/\/[^\s)]+)\)`, the signature to `export function inline(text: string, depth = 0, onLink?: (url: string) => boolean): ReactNode[]`, pass `onLink` down in the recursive `inline(g.ltext!, depth + 1, onLink)` call, and in the `lurl` branch call `onClick={e => { e.preventDefault(); if (!onLink?.(url)) openUrl(url); }}`.

`apps/overlay/src/surface/AskField.tsx`:
```tsx
import { useState } from 'react';
import { ResidentMascot } from '../bots/ResidentMascot';
import { Kbd } from '../ui/Kbd';
import { useI18n } from '../i18n/lang';

/** "Ask Ledge…" at the foot of the list: Enter on a non-empty question sends it and clears the field (spec 2026-10-11 §5.5). */
export function AskField({ onAsk, onTyping, disabled = false, theme = 'dark', reducedMotion }: { onAsk: (text: string) => void; onTyping?: (on: boolean) => void; disabled?: boolean; theme?: 'dark' | 'light'; reducedMotion?: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const submit = () => { const q = text.trim(); if (!q) return; onAsk(q); setText(''); onTyping?.(false); };
  return (
    <div data-ask-field style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, margin: '0 12px 10px', padding: '0 10px', boxSizing: 'border-box', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', background: 'var(--well)', opacity: disabled ? 0.5 : 1 }}>
      <ResidentMascot size={18} theme={theme} reducedMotion={reducedMotion} paused={disabled} />
      <input data-ask type="text" aria-label={t.chat.ask} placeholder={t.chat.askPlaceholder} value={text} disabled={disabled}
        onChange={e => { setText(e.target.value); onTyping?.(e.target.value.length > 0); }} onFocus={() => onTyping?.(true)} onBlur={() => onTyping?.(text.length > 0)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } }}
        style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'var(--sidebar-foreground)', fontSize: 13, outline: 'none' }} />
      <Kbd>/</Kbd>
    </div>
  );
}
```
`SessionList.tsx`: add props `onAsk?: (text: string) => void; onTyping?: (on: boolean) => void; askDisabled?: boolean;` and render `{onAsk && <AskField onAsk={onAsk} onTyping={onTyping} disabled={askDisabled} theme={theme} reducedMotion={reducedMotion} />}` between the scroll area and the footer. The list's measured height grows by `ASK_H = 46` (36 + 10 margin) when `onAsk` is set: export `ASK_H` and add `askH?: number` to `LayoutInput` in `geometry.ts` (`+ (input.askH ?? 0)` in the list's `h`), passed from `Surface`.

`apps/overlay/src/surface/ChatView.tsx`:
```tsx
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { ChatStep, ChatTurn, Session } from '@ledge/protocol';
import { ResidentMascot } from '../bots/ResidentMascot';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { relativeTime } from '../format';
import { transition } from '../motion';
import { useI18n, type Messages } from '../i18n/lang';
import { inline } from './ReplyCard';
import { groupSessions } from './groups';

export const CHAT_HEADER_H = 56;
export interface ChatViewProps {
  turns: ChatTurn[]; live: { qid: string; text: string } | null; sessions: Session[]; visible: boolean; enterDelay?: number;
  /** Null when questions may be sent; otherwise why not (offline). */
  offline: string | null;
  onAsk: (text: string) => void; onCancel: (qid: string) => void; onBack: () => void; onClose: () => void; onOpenSession: (id: string) => void;
  theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean; now?: number; contentRef?: Ref<HTMLDivElement>;
}

const stepLabel = (s: ChatStep, t: Messages) => s.kind === 'sessions' ? t.chat.step.sessions : s.kind === 'repo' ? t.chat.step.repo(s.path ?? '') : t.chat.step[s.kind](s.name ?? '');
const sourceLabel = (s: ChatStep, t: Messages) => s.kind === 'sessions' ? t.chat.source.sessions : s.kind === 'repo' ? t.chat.source.repo(s.name ?? s.path ?? '') : t.chat.source[s.kind](s.name ?? '');

/** `**Nova**` for a known bot becomes a `ledge://session/<id>` link that opens its session. */
function linkBots(text: string, sessions: Session[]): string {
  return sessions.reduce((acc, s) => acc.replaceAll(`**${s.name}**`, `[${s.name}](ledge://session/${s.id})`), text);
}

/** Simple Markdown: paragraphs, bullet lists, `###` headings; inline marks through the reply renderer. */
function Answer({ text, sessions, onOpen }: { text: string; sessions: Session[]; onOpen: (id: string) => void }) {
  const onLink = (url: string) => { const m = /^ledge:\/\/session\/(.+)$/.exec(url); if (!m) return false; onOpen(m[1]!); return true; };
  const blocks = linkBots(text, sessions).split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: '19px', minWidth: 0 }}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every(l => /^[-*] /.test(l))) return <ul key={i} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2), 0, onLink)}</li>)}</ul>;
        if (/^#{1,3} /.test(b)) return <h3 key={i} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{inline(b.replace(/^#{1,3} /, ''), 0, onLink)}</h3>;
        return <p key={i} style={{ margin: 0, overflowWrap: 'anywhere' }}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, 0, onLink)}</span>)}</p>;
      })}
    </div>
  );
}

export function ChatView(p: ChatViewProps) {
  const { t } = useI18n();
  const { turns, live, visible, enterDelay = 120 } = p;
  const running = turns.find(x => !x.answer && !x.error) ?? null;
  const busy = !!running;
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; }, [turns, live?.text]);
  useEffect(() => { if (visible && !busy) field.current?.focus({ preventScroll: true }); }, [visible, busy]);
  // The resident pulses while Ledge reads.
  const [pulse, setPulse] = useState(0);
  useEffect(() => { if (!busy || p.reducedMotion) return; const id = setInterval(() => setPulse(k => k + 1), 1400); return () => clearInterval(id); }, [busy, p.reducedMotion]);
  const submit = (q: string) => { const v = q.trim(); if (!v || busy || p.offline) return; p.onAsk(v); setText(''); };
  const repos = groupSessions(p.sessions).length;
  const mascot = (size: number) => <ResidentMascot size={size} theme={p.theme} paused={!visible} frozen={p.frozen} reducedMotion={p.reducedMotion} gestureKey={busy ? pulse : undefined} gestureKind="pulse" />;
  return (
    <div data-layer="chat" data-delay={enterDelay} inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: CHAT_HEADER_H, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <Button variant="ghost" size="icon" aria-label={t.chat.back} title={t.chat.back} data-initial-focus onClick={p.onBack}><Icon {...ICONS.chevronLeft} /></Button>
        {mascot(28)}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
          <span data-brand style={{ fontSize: 14, lineHeight: '18px', fontWeight: 650 }}>{t.chat.title}<span style={{ color: 'var(--sidebar-primary)' }}>.</span></span>
          <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.chat.subtitle(p.sessions.length, repos)}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label={t.chat.close} title={t.chat.close} onClick={p.onClose}><Icon {...ICONS.close} /></Button>
      </div>
      <div ref={thread} data-scroll className="ledge-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div ref={p.contentRef} data-chat-content style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px 10px' }}>
          {turns.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, padding: '18px 16px 8px', color: 'var(--muted-foreground)', fontSize: 12.5, lineHeight: '18px' }}>
              {mascot(44)}<strong style={{ color: 'var(--sidebar-foreground)', fontSize: 14 }}>{t.chat.emptyTitle}</strong><span>{t.chat.emptyHint(p.sessions.length)}</span>
            </div>
          )}
          {turns.map(turn => (
            <div key={turn.qid} data-turn style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}><span style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: '12px 12px 4px 12px', background: 'var(--secondary)', fontSize: 13, lineHeight: '19px', overflowWrap: 'anywhere' }}>{turn.question}</span></div>
              {turn.error && <span data-chat-error role="alert" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--destructive)' }}>{t.chat.error(turn.error)}</span>}
              {!turn.error && (turn.answer || turn.steps.length > 0 || live?.qid === turn.qid || running?.qid === turn.qid) && (
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10, alignItems: 'start' }}>
                  {mascot(24)}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                    {!turn.answer && (
                      <div data-steps style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
                        {turn.steps.length === 0 && <span>{t.chat.thinking}</span>}
                        {turn.steps.map((s, i) => <span key={i} style={{ color: i === turn.steps.length - 1 ? 'var(--sidebar-foreground)' : undefined }}>{i < turn.steps.length - 1 ? '✓ ' : ''}{stepLabel(s, t)}</span>)}
                      </div>
                    )}
                    {(turn.answer || (live?.qid === turn.qid && live.text)) && <Answer text={turn.answer ?? live!.text} sessions={p.sessions} onOpen={p.onOpenSession} />}
                    {turn.answer && turn.answeredAt && (
                      <div data-sources style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', paddingTop: 6, borderTop: '1px solid var(--sidebar-border)', fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
                        <span style={{ fontWeight: 500 }}>{t.chat.sources}</span>
                        {turn.steps.length === 0 ? <span>{t.chat.sourcesNone}</span> : [...new Set(turn.steps.map(s => sourceLabel(s, t)))].map(l => <span key={l}>{l}</span>)}
                        <span>{t.chat.ago(relativeTime(turn.answeredAt, p.now, t))}</span>
                      </div>
                    )}
                    {!turn.answer && running?.qid === turn.qid && <div><Button variant="outline" size="sm" onClick={() => p.onCancel(turn.qid)} style={{ height: 26, padding: '0 8px' }}>{t.chat.stop}</Button></div>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {turns.length === 0 && (
        <div data-chips style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 16px 10px' }}>
          {t.chat.chips.map(c => <Button key={c} variant="outline" size="sm" disabled={busy || !!p.offline} onClick={() => submit(c)} style={{ height: 28, padding: '0 10px', borderRadius: 999, fontSize: 12 }}>{c}</Button>)}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
        {p.offline && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{p.offline}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input ref={field} data-chat-input type="text" className="ledge-field" aria-label={t.chat.ask} placeholder={t.chat.askPlaceholder} value={text} disabled={busy || !!p.offline}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(text); } else if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } }}
            style={{ flex: 1, minWidth: 0, height: 34, boxSizing: 'border-box', padding: '0 10px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 13 }} />
          <Button variant="primary" size="icon" aria-label={t.chat.send} title={t.chat.send} disabled={busy || !!p.offline || !text.trim()} onClick={() => submit(text)} style={{ width: 34, height: 34 }}><Icon {...ICONS.send} /></Button>
        </div>
      </div>
    </div>
  );
}
```
Check `ResidentMascot`'s props (`theme` may be required: pass `p.theme ?? 'dark'`), and `Button` variants `outline`/`primary`/`ghost` and sizes `sm`/`icon` exist in `ui/Button.tsx` (the list and session views already use them).

`useKeyboard.ts`: add `onAsk?: () => void;` to `KeyboardOptions` and, in the handler chain before `else if (k === 'y' || k === 'n')`: `else if (list && k === '/') c.onAsk?.();`.

`Surface.tsx` wiring:
- `const chatRef = useRef<HTMLDivElement>(null); const chatH = useMeasuredHeight(chatRef, st.mode === 'chat', ps);` and `detailH` for chat = `CHAT_HEADER_H + chatH + 60 (composer) + (chat.length === 0 ? 44 : 0) + SURFACE_CHROME_Y` when `chatH` is measured; pass it through `scaledLayout`'s `detailH` when `st.mode === 'chat'`.
- Local `detail` includes `st.mode === 'chat'`; the `onClose` of `useKeyboard` already maps to `back` for detail views; add `onAsk: () => surfaceRef.current?.querySelector<HTMLInputElement>('[data-ask]')?.focus()`.
- `const { chat, chatLive } = useDaemon()` (from the existing `useDaemon()` call); `const ask = (text: string) => { const qid = `q-${Date.now().toString(36)}`; daemonStore.beginTurn({ qid, question: text, askedAt: new Date().toISOString(), steps: [] }); send({ type: 'chat.ask', qid, text }); if (ctl.state().mode !== 'chat') dispatch({ type: 'chat' }); };`
- `<SessionList … onAsk={ask} onTyping={on => dispatch({ type: 'typing', on })} askDisabled={unreachable} />`.
- A new layer like the launch one: `<div aria-hidden={st.mode !== 'chat' || undefined} style={{ position: 'absolute', inset: 0, pointerEvents: st.mode === 'chat' ? 'auto' : 'none', transform: `translateX(${st.mode === 'chat' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}><ChatView contentRef={chatRef} turns={chat} live={chatLive} sessions={sessions} visible={st.mode === 'chat'} enterDelay={enter} offline={unreachable ? t.offline : null} onAsk={ask} onCancel={qid => send({ type: 'chat.cancel', qid })} onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} onOpenSession={openRow} theme={theme} frozen={unreachable} reducedMotion={reducedMotion} /></div>`.
- `useFocusRestore` / `frame.ts`: wherever `'launch'` is listed as a detail mode for focus or frame purposes, list `'chat'` too (grep `'launch'`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter overlay test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay
git commit -m "feat(overlay): ask Ledge from the list; a chat view with steps, live answer, sources and bot links"
```

### Task 15: Live verification on this machine

**Files:**
- Modify: `docs/tour.md` (a "Demander à Ledge" paragraph and the new row anatomy), `packages/ledge/README.md` (the chat section: command, context folder, day session file)

No code. A checklist run in WSL against the real `claude` (2.1.296) and the running daemon, results written into the commit message.

- [ ] **Step 1: Build and restart the daemon**

```bash
pnpm --filter ledge build && systemctl --user restart ledge-daemon.service && sleep 1 && ledge status
```
Expected: `ledge status` lists the sessions; each launched one now shows a branch after a few seconds (`ledge status` prints the session JSON or titles: check the `branch` field or the title).

- [ ] **Step 2: Headless auth and isolation**

```bash
mkdir -p /tmp/ledge-probe && cd /tmp/ledge-probe && printf 'Réponds "pong" et rien d autre.' | LEDGE_CHAT=1 claude -p --restricted --tools Read,Grep,Glob --permission-mode dontAsk --output-format stream-json --verbose --include-partial-messages --max-turns 2 --session-id "$(uuidgen)" | head -c 2000
```
Expected: a `system/init` line, then text deltas and a `result` with `pong`; no `ANTHROPIC_API_KEY` in the environment (`env | grep -c ANTHROPIC_API_KEY` prints 0) so the subscription credential served; the Ledge list shows **no** new session (the user's hooks did not run under `--restricted`). If a session does appear, `--restricted` is not isolating hooks on this version: report it, and keep the `LEDGE_CHAT=1` guard as the working protection.

- [ ] **Step 3: Reads inside `--add-dir`, refused outside**

```bash
printf 'Lis README.md dans le dossier ajouté et cite sa première ligne.' | LEDGE_CHAT=1 claude -p --restricted --tools Read,Grep,Glob --permission-mode dontAsk --add-dir ~/Workspace/harness-assistant --output-format json --max-turns 4
```
Expected: the answer quotes the first line of `~/Workspace/harness-assistant/README.md`. Then the same without `--add-dir`: the read is refused and the answer says it could not read. Record both.

- [ ] **Step 4: The chat from the overlay**

Open Ledge, type `Où en sont les autres ?` in the ask field. Expected: the chat view opens, steps appear within ~5 s, the answer streams, the sources line names the terminals read; a second question resumes the same conversation (the daemon log shows `--resume`); `~/.ledge/chat.json` holds today's date. Rename a session from its header: the row and the Windows Terminal tab title change within a second (the tab follows `@ledge_title`; if it does not, note it: the OSC title write at attach still names the tab at open).

- [ ] **Step 5: Document and commit**

Update `docs/tour.md` and `packages/ledge/README.md` as listed, then:
```bash
git add docs/tour.md packages/ledge/README.md
git commit -m "docs: asking Ledge, session topics and branches; live verification notes"
```
Put the verification outcomes (auth source, hooks silent or not, add-dir behaviour, tab title) in the commit body.

---

## Self-review notes

- Spec §2 (fields) → Task 1; §3 sources and priority → Tasks 2, 3, 4; §3 "where it is read" → Tasks 6 (tab), 7 (list), 8 (header, tooltip); §4 → Tasks 5, 7; §4 handle → Task 8; §5.1 → Task 9; §5.2 → Tasks 11, 12, 15; §5.3 → Task 10; §5.4 → Task 11; §5.5 → Tasks 13, 14; §6 errors → Tasks 5 (null git), 6 (unknown rename), 12 (claude missing, non-zero exit, cancel), 14 (offline, error row); §7 tests map one to one.
- Names used across tasks: `cleanTopic`/`sessionTitle` (T1→T2), `Store.patch` (T5→poller), `gitSummary` (T5→T12), `writeContext`/`stepFor` (T10→T12), `runClaude`/`claudeArgs`/`PERSONA` (T11→T12), `createChat`/`Chat`/`claudeBin` (T12→server), `beginTurn`/`chat`/`chatLive` (T13→T14), `GROUP_H`/`groups`/`askH` (T7, T14→geometry), `onRename` (T8), `onAsk`/`onTyping` (T14).
- Review Focus 1 → T5 nested-cwd test; 2 → T2 and T4 tests; 3 → T12 service test; 4 → T12 history test and T14 running-turn test; 5 → T8 Escape test and T14 `/` test.
