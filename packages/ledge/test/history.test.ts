import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '@ledge/protocol';
import { History, MAX_ITEMS, SYNC_MS } from '../src/daemon/history.js';
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
    again.forget('s'); await again.flush();
    expect(again.items('s')).toEqual([]);
    expect(() => readFileSync(join(dir, 'history', 's.jsonl'))).toThrow();
  });

  it('loads the readable journals and skips what it cannot read: a directory, an unreadable file, other names', async () => {
    const hd = join(dir, 'history'); mkdirSync(join(hd, 'x.jsonl'), { recursive: true });
    const line = JSON.stringify({ kind: 'prompt', id: 'prompt-1', at: T0, turn: 1, text: 'ok' }) + '\n';
    writeFileSync(join(hd, 'ok.jsonl'), line);
    writeFileSync(join(hd, 'locked.jsonl'), line); chmodSync(join(hd, 'locked.jsonl'), 0o000);
    writeFileSync(join(hd, 'notes.txt'), line);
    const h = new History();
    try { await h.load(); } finally { chmodSync(join(hd, 'locked.jsonl'), 0o600); }
    expect(h.ids()).toContain('ok');
    expect(h.ids()).not.toContain('x'); expect(h.ids()).not.toContain('notes');
    expect(h.items('ok')).toMatchObject([{ id: 'prompt-1', text: 'ok' }]);
    // As root the locked file is readable all the same: only its absence of harm is asserted then.
    if (process.getuid?.() !== 0) expect(h.ids()).not.toContain('locked');
  });

  it('compacts a journal at load: one line per item kept, the thread unchanged', async () => {
    const h = new History();
    h.record('k', ev('UserPromptSubmit', { text: 'go' }));
    h.record('k', ev('PreToolUse', { tool: 'Bash', text: 'Bash · ls', toolUseId: 'toolu_1' }, 1));
    for (let i = 0; i < 50; i++) h.record('k', ev('PermissionRequest', { tool: 'Bash', text: `p${i}` }, 2 + i));
    for (let i = 0; i < 50; i++) h.record('k', ev('Decided', { source: 'daemon' }, 60 + i));
    h.record('k', ev('PostToolUse', { tool: 'Bash', toolUseId: 'toolu_1', output: 'a b' }, 200));
    await h.flush();
    const file = join(dir, 'history', 'k.jsonl');
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(103);
    const again = new History(); await again.load(); await again.flush();
    expect(again.items('k')).toEqual(h.items('k'));
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(52);
    expect(lines.map(l => JSON.parse(l))).toEqual(h.items('k'));
    // Appends after the compaction land after it.
    again.record('k', ev('Stop', { text: 'done' }, 300)); await again.flush();
    const third = new History(); await third.load();
    expect(third.items('k').at(-1)).toMatchObject({ kind: 'reply', text: 'done' });
  });

  it('numbers the turns after a reload', async () => {
    mkdirSync(join(dir, 'history'), { recursive: true });
    writeFileSync(join(dir, 'history', 'z.jsonl'), JSON.stringify({ kind: 'prompt', id: 'prompt-3', at: T0, turn: 3, text: 'x' }) + '\n');
    const h = new History(); await h.load();
    h.record('z', ev('UserPromptSubmit', { text: 'y' }, 1));
    expect(h.items('z').at(-1)).toMatchObject({ id: 'prompt-4', turn: 4 });
  });

  it('keeps the thread order when it reloads, and skips lines that are not items', async () => {
    const h = new History();
    h.record('o', ev('UserPromptSubmit', { text: 'go' }));
    h.record('o', ev('PreToolUse', { tool: 'Bash', text: 'Bash · ls', toolUseId: 'toolu_1' }, 1));
    h.record('o', ev('Stop', { text: 'done' }, 2));
    h.record('o', ev('PostToolUse', { tool: 'Bash', toolUseId: 'toolu_1', output: 'ok' }, 3));
    await h.flush();
    const file = join(dir, 'history', 'o.jsonl');
    writeFileSync(file, readFileSync(file, 'utf8') + '5\n{}\n');
    const again = new History(); await again.load();
    expect(again.items('o').map(i => i.kind)).toEqual(['prompt', 'tool', 'reply']);
    expect(again.items('o')[1]).toMatchObject({ status: 'success' });
    again.record('o', ev('UserPromptSubmit', { text: 'next' }, 4));
    expect(again.items('o').at(-1)).toMatchObject({ id: 'prompt-2' });
  });

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
    // A Claude Code helper transcript: every entry is a sidechain.
    const side = (uuid: string, ts: string, text: string) => JSON.stringify({ ...JSON.parse(line(uuid, ts, text)), isSidechain: true, agentId: 'h1' });
    writeFileSync(hp, [side('a0', later(2), 'Avant le départ.'), side('a1', later(3), 'Je cherche les appels.'), side('a2', later(4), 'Trois appels.')].join('\n') + '\n');
    h.record('s', ev('SubagentStart', { helperId: 'h1', tool: 'Explore', text: 'find consumers' }, 3));
    const mine = h.sync('s', hp, { helperId: 'h1', force: true });
    expect(mine.map(i => i.id)).toEqual(['msg-a1', 'msg-a2']); // from the helper's start on
    expect(mine.every(i => i.kind === 'message' && i.helperId === 'h1')).toBe(true);
    expect(mine[1]).toMatchObject({ text: 'Trois appels.', turn: 1 });
  });
});
