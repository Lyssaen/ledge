import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname } from 'node:path';
import { join } from 'node:path';
import type { Projects, Session } from '@ledge/protocol';
import { writeContext, stepFor } from '../src/chat/context.js';

const T0 = '2026-10-11T10:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

describe('writeContext', () => {
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

  const PROJECTS: Projects = {
    projects: [
      { id: 'ledge', name: 'Ledge', color: 'blue', description: 'The agent cockpit.', repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'devbox', path: '/srv/ledge' }] },
      { id: 'api', name: 'API', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/api' }] }
    ],
    rules: [{ machine: 'local', path: '/tmp/scratch', project: 'api' }]
  };

  it('writes projects.md with each project, its description, its repositories and the remembered folders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const ctx = await writeContext(dir, { sessions: [], projects: PROJECTS, now: T0, capture: async () => null, git: async () => null });
    const md = readFileSync(join(dir, 'projects.md'), 'utf8');
    expect(md).toContain('## Ledge'); expect(md).toContain('The agent cockpit.');
    expect(md).toContain('- local: /w/ledge'); expect(md).toContain('- devbox: /srv/ledge'); expect(md).toContain('## API'); expect(md).toContain('- local: /w/api');
    expect(md).toContain('Filed folders'); expect(md).toContain('- local: /tmp/scratch → API');
    expect(md.indexOf('## API')).toBeLessThan(md.indexOf('Filed folders'));
    expect(stepFor(join(dir, 'projects.md'), ctx)).toBeNull();
  });

  it('a daemon without projects nor rules (a remote one) writes no projects.md and no Project line', async () => {
    for (const projects of [undefined, { projects: [], rules: [] }]) {
      const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
      await writeContext(dir, { sessions: [mk('a')], ...(projects && { projects }), now: T0, capture: async () => null, git: async () => null });
      expect(existsSync(join(dir, 'projects.md'))).toBe(false);
      expect(readFileSync(join(dir, 'sessions.md'), 'utf8')).not.toContain('Project');
    }
  });

  it('a daemon without projects writes the very sessions.md it wrote before projects existed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    await writeContext(dir, { sessions: [mk('a')], now: T0, capture: async () => null, git: async () => null });
    expect(readFileSync(join(dir, 'sessions.md'), 'utf8')).toBe([
      `# Ledge sessions at ${T0}`, '', 'Each session below lists the files that describe it, in this folder.', '',
      '## Otto (claude) — working', '- id: a', '- topic: (none yet)', '- folder: /w/ledge', '- repository: ledge', `- started: ${T0}, last activity: ${T0}`, ''
    ].join('\n'));
  });

  it('a newline in a project’s name or description forges no heading', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const forged: Projects = { projects: [{ ...PROJECTS.projects[0]!, name: 'Ledge\n## Forged', description: 'One.\n\n## Also forged\r\nTwo.' }], rules: [] };
    await writeContext(dir, { sessions: [mk('a')], projects: forged, now: T0, capture: async () => null, git: async () => null });
    const md = readFileSync(join(dir, 'projects.md'), 'utf8');
    expect(md.split('\n').filter(l => l.startsWith('#'))).toEqual(['# Projects', '## Ledge ## Forged']);
    expect(md).toContain('One. ## Also forged Two.');
    const sessions = readFileSync(join(dir, 'sessions.md'), 'utf8');
    expect(sessions.split('\n').filter(l => l.startsWith('#'))).toEqual([`# Ledge sessions at ${T0}`, '## Otto (claude) — working']);
    expect(sessions).toContain('- Project: Ledge ## Forged');
  });

  it('gives each session its project in sessions.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const sessions = [mk('a', { cwd: '/w/ledge/src' }), mk('b', { name: 'Nova', cwd: '/w/elsewhere' }), mk('c', { name: 'Zed', cwd: '/srv/ledge', machineId: 'devbox' })];
    await writeContext(dir, { sessions, projects: PROJECTS, now: T0, capture: async () => null, git: async () => null });
    const md = readFileSync(join(dir, 'sessions.md'), 'utf8');
    const section = (name: string) => md.slice(md.indexOf(`## ${name} `)).split('\n## ')[0];
    expect(section('Otto')).toContain('- Project: Ledge'); expect(section('Nova')).toContain('- Project: no project'); expect(section('Zed')).toContain('- Project: Ledge');
  });

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
    // Only the hook-only session is marked: Ledge cannot type into it (spec 2026-10-12 relay §4).
    const nova = md.slice(md.indexOf('## Nova'));
    expect(nova).toContain('- read-only: Ledge cannot send to it');
    expect(md.slice(0, md.indexOf('## Nova'))).not.toContain('read-only');
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
