import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname } from 'node:path';
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
  it('never hands the model the home folder, the root or a parent of the home', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledge-chat-')), 'context');
    const repo = join(homedir(), 'w', 'repo');
    const sessions = [mk('a', { cwd: homedir() }), mk('b', { cwd: '/' }), mk('c', { cwd: dirname(homedir()) }), mk('d', { cwd: `${homedir()}/` }), mk('e', { cwd: repo })];
    const ctx = await writeContext(dir, { sessions, now: T0, capture: async () => null, git: async () => null });
    expect(ctx.repoPaths).toEqual([repo]);
  });
  it('starts from an empty folder each time', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledge-chat-')), 'context');
    await writeContext(dir, { sessions: [mk('a', { lastReply: { text: 'x', at: T0 } })], now: T0, capture: async () => null, git: async () => null });
    await writeContext(dir, { sessions: [], now: T0, capture: async () => null, git: async () => null });
    expect(existsSync(join(dir, 'reply-a.md'))).toBe(false);
  });
  it('omits a file whose source throws, is empty or is blank', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledge-chat-')), 'context');
    const sessions = [mk('a'), mk('b', { lastReply: { text: 'ok', at: T0 } }), mk('c', { lastReply: { text: '  \n', at: T0 } })];
    await writeContext(dir, { sessions, now: T0, capture: async s => { if (s.id === 'a') throw new Error('gone'); return s.id === 'c' ? [] : ['x']; }, git: async cwd => { if (cwd) throw new Error('nope'); return ''; } });
    const md = readFileSync(join(dir, 'sessions.md'), 'utf8');
    expect(existsSync(join(dir, 'pane-a.txt'))).toBe(false); expect(existsSync(join(dir, 'pane-b.txt'))).toBe(true); expect(existsSync(join(dir, 'reply-b.md'))).toBe(true);
    expect(existsSync(join(dir, 'pane-c.txt'))).toBe(false); expect(existsSync(join(dir, 'reply-c.md'))).toBe(false);
    expect(md).not.toContain('pane-a.txt'); expect(md).not.toContain('pane-c.txt'); expect(md).not.toContain('reply-c.md'); expect(md).not.toContain('git-');
  });
});
