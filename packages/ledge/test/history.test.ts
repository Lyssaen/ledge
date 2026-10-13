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
    again.forget('s'); await again.flush();
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
});
