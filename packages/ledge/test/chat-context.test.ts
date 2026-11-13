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
  it('writes rigs.md from OpenRig as last read (each rig, its seats by role, the kernel), only where OpenRig is installed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const seat = (logicalId: string) => ({ logicalId, session: `${logicalId}@r`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
    await writeContext(dir, { sessions: [], now: T0, capture: async () => null, git: async () => null, rigs: { installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: T0,
      rigs: [{ id: 'r1', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 3, running: 3, attention: 1, uptime: null, snapshot: null, nodes: [seat('dev.back'), seat('dev.back-2'), seat('dev.front')] }] } });
    const md = readFileSync(join(dir, 'rigs.md'), 'utf8');
    expect(md).toContain('- OpenRig 0.7.10, daemon running, kernel ready');
    expect(md).toContain('## ledge-dev — running');
    expect(md).toContain('- role dev.back: 2 seats (dev.back, dev.back-2)');
    expect(md).toContain('- role dev.front: 1 seat (dev.front)');
    const none = mkdtempSync(join(tmpdir(), 'ctx-'));
    await writeContext(none, { sessions: [], now: T0, capture: async () => null, git: async () => null, rigs: { installed: false, daemon: { state: 'unknown' }, kernel: { state: 'unknown' }, rigs: [], at: T0 } });
    expect(existsSync(join(none, 'rigs.md'))).toBe(false);
  });

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

describe('writeContext: tasks', () => {
  it('writes tasks.md: the open tasks and those closed today, and no roles.md nor teams.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const now = new Date().toISOString();
    const task = (id: string, extra: object) => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'a', ownerName: 'Otto', state: 'open' as const, at: T0, updatedAt: now, log: [], ...extra });
    await writeContext(dir, {
      sessions: [mk('a')], now, capture: async () => null, git: async () => null,
      tasks: [task('t000001', { state: 'done', result: 'fait' }), task('t000002', {}), task('t000003', { state: 'done', updatedAt: '2020-01-01T00:00:00.000Z' })]
    });
    expect(existsSync(join(dir, 'roles.md'))).toBe(false);
    expect(existsSync(join(dir, 'teams.md'))).toBe(false);
    const tasks = readFileSync(join(dir, 'tasks.md'), 'utf8');
    expect(tasks).toContain('t000001 « Tâche t000001 » — giver Ledge, owner Otto, done: fait');
    expect(tasks).toContain('t000002');
    expect(tasks).not.toContain('t000003');
  });
});

describe('writeContext: what the actions need', () => {
  it('« closed today » is the context\'s day, not the clock\'s; a task\'s detail follows it on one line, cut past 1 000 characters', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const task = (id: string, extra: object) => ({ id, title: `Tâche ${id}`, giver: 'a', giverName: 'Otto', owner: 'ledge', ownerName: 'Ledge', state: 'open' as const, at: T0, updatedAt: T0, log: [], ...extra });
    await writeContext(dir, {
      sessions: [], now: T0, capture: async () => null, git: async () => null,
      tasks: [task('t1', { text: 'Fusionner feat/roles ?\nA) oui\nB) non — je recommande A' }), task('t2', { state: 'done', text: 'x'.repeat(1500) }), task('t3', { state: 'done', updatedAt: '2026-10-10T23:59:00.000Z' })]
    });
    const md = readFileSync(join(dir, 'tasks.md'), 'utf8');
    expect(md).toContain('  - detail: Fusionner feat/roles ? A) oui B) non — je recommande A');
    expect(md).toContain(`  - detail: ${'x'.repeat(1000)}… (cut: \`ledge task show t2\` has the rest)`);
    expect(md).not.toContain('x'.repeat(1001));
    expect(md).not.toContain('t3');
  });

  it('sessions.md says the model, the effort, the machine and the queued instructions when there are some', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    await writeContext(dir, { sessions: [mk('a', { model: 'claude-opus-5-5', effort: 'high', machineName: 'PC', offline: true, queue: [{ text: 'x', mode: 'follow_up' }] }), mk('b', { effort: 'low' })], now: T0, capture: async () => null, git: async () => null });
    const md = readFileSync(join(dir, 'sessions.md'), 'utf8');
    expect(md).toContain('- model: claude-opus-5-5, effort high');
    expect(md).toContain("- model: the agent's default, effort low");
    expect(md).toContain('- machine: PC (unreachable: last known state)');
    expect(md).toContain('- queued instructions: 1 (sent once it is free)');
  });

  it('archived sessions are listed apart, with no terminal, reply nor git, and their folder is not readable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const ctx = await writeContext(dir, { sessions: [mk('a', { cwd: '/w/old', archivedAt: T0, lastReply: { text: 'old', at: T0 } })], now: T0, capture: async () => ['x'], git: async () => 'g' });
    const md = readFileSync(join(dir, 'sessions.md'), 'utf8');
    expect(md).not.toContain('## Otto');
    expect(md).toContain(`- Otto (claude), id a, folder /w/old, archived ${T0}`);
    for (const f of ['pane-a.txt', 'reply-a.md', 'git-a.txt']) expect(existsSync(join(dir, f))).toBe(false);
    expect(ctx.repoPaths).toEqual([]);
  });

  it('the projects\' repositories on this machine are readable even with no session, when they exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const repo = mkdtempSync(join(tmpdir(), 'repo-'));
    const projects: Projects = { projects: [{ id: 'p', name: 'P', color: 'blue', description: '', repos: [{ machine: 'local', path: repo }, { machine: 'local', path: '/nowhere/gone' }, { machine: 'devbox', path: '/srv/p' }] }], rules: [] };
    const ctx = await writeContext(dir, { sessions: [], projects, now: T0, capture: async () => null, git: async () => null });
    expect(ctx.repoPaths).toEqual([repo]);
  });

  it('folders.md leaves out the folders under the temporary directory (an agent\'s scratchpad)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    const recents = [{ cwd: join(tmpdir(), 'claude-1000', 'scratchpad', 'test-multi'), project: 'test-multi', lastAt: T0 }, { cwd: '/tmp/x', project: 'x', lastAt: T0 }, { cwd: '/w/ledge', project: 'ledge', lastAt: T0 }];
    await writeContext(dir, { sessions: [], recents, now: T0, capture: async () => null, git: async () => null });
    const md = readFileSync(join(dir, 'folders.md'), 'utf8');
    expect(md).toContain('- ledge: /w/ledge'); expect(md).not.toContain('test-multi'); expect(md).not.toContain('/tmp/x');
  });

  describe('what the operator adds', () => {
    const base = { now: T0, capture: async () => null, git: async () => null };
    const ask = { id: 'qitem-1', kind: 'decision' as const, alert: false, priority: 'urgent' as const, from: { seat: 'dev.back', rig: 'ledge-dev', role: 'dev.back' }, summary: 'Merge the lot?', body: 'Lot 3 is green.', bodyTruncated: false, detail: null, evidenceRef: null,
      questions: [{ id: 'q1', question: 'Go?', options: [{ id: 'yes', label: 'Yes', recommended: true }, { id: 'no', label: 'No', recommended: false }], answer: null }], createdAt: T0, updatedAt: T0 };
    const event = (id: number, extra: Record<string, unknown> = {}) => ({ id, at: `2026-10-11T0${id}:05:00.000Z`, machine: 'local', kind: 'session.finished' as const, subjectKind: 'session', subjectId: 's1', subjectName: 'Otto', urgency: 'grouped' as const, payload: { text: 'Finished the lot' }, settledAt: null, ...extra });

    it('attentes.md lists a rig ask with its qitem id and options', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
      const pending = { kind: 'permission' as const, text: 'Run rm -rf build?', source: 'hook' as const, options: ['Allow', 'Deny'] };
      await writeContext(dir, { ...base, sessions: [mk('s1', { pending })], asks: [ask] });
      const md = readFileSync(join(dir, 'attentes.md'), 'utf8');
      expect(md).toContain('- s1 — Otto, pending permission: Run rm -rf build?');
      expect(md).toContain('options: Allow; Deny');
      expect(md).toContain('- qitem-1 — decision from dev.back (rig ledge-dev), urgent: Merge the lot?');
      expect(md).toContain('Lot 3 is green.');
      expect(md).toContain('q1 « Go? »: yes = Yes (recommended); no = No');
    });

    it('attentes.md lists the open tasks Ledge owns and a brain proposal', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
      const task = { id: 't1', title: 'Note stack ?', text: 'oui — add\nnon — skip', giver: 's1', giverName: 'Otto', owner: 'ledge', ownerName: 'ledge', state: 'open' as const, at: T0, updatedAt: T0, log: [], brain: { kind: 'add' as const, note: 'stack', fact: 'Uses pnpm' } };
      const other = { ...task, id: 't2', owner: 's2', ownerName: 'Nova', brain: undefined };
      await writeContext(dir, { ...base, sessions: [], tasks: [task, other] });
      const md = readFileSync(join(dir, 'attentes.md'), 'utf8');
      expect(md).toContain('- t1 « Note stack ? » — from Otto');
      expect(md).toContain('oui — add non — skip');
      expect(md).toContain('brain proposal: add to note stack: Uses pnpm');
      expect(md).not.toContain('t2');
    });

    it('attentes.md says nothing waits when empty', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
      await writeContext(dir, { ...base, sessions: [mk('s1')] });
      expect(readFileSync(join(dir, 'attentes.md'), 'utf8')).toContain('Nothing waits for the user.');
    });

    it('journal.md lists events in order with the reply file of a finished session', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
      const s = mk('s1', { lastReply: { text: 'All done.', at: T0 } });
      await writeContext(dir, { ...base, sessions: [s], journal: [event(1), event(2, { kind: 'session.error', subjectId: 'gone', subjectName: 'Nova', payload: { text: 'Crashed' } })] });
      const md = readFileSync(join(dir, 'journal.md'), 'utf8');
      expect(md).toContain('01:05 session.finished Otto — Finished the lot reply: reply-s1.md');
      expect(md).toContain('02:05 session.error Nova — Crashed');
      expect(md.indexOf('Otto')).toBeLessThan(md.indexOf('Nova'));
      expect(md).not.toMatch(/Crashed.*reply:/);
      const none = mkdtempSync(join(tmpdir(), 'ctx-'));
      await writeContext(none, { ...base, sessions: [] });
      expect(existsSync(join(none, 'journal.md'))).toBe(false);
    });

    it('rigs.md lists an unreachable seat, the queue rows, what a seat does and an open goal', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
      const seat = (logicalId: string, sessionStatus = 'running') => ({ logicalId, session: `${logicalId}@r`, runtime: 'claude-code', model: null, sessionStatus, lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
      const goal = { goalId: 'g1', qitemId: 'qi-9', text: 'Ship the lot', folder: null, sentAt: T0, to: 'max', state: 'running' as const, proposal: null, question: null, trail: [], current: null };
      await writeContext(dir, { ...base, sessions: [mk('s1', { name: 'dev.front', topic: 'Fixing the header' })], goals: [goal, { ...goal, goalId: 'g2', state: 'done' as const }],
        queue: new Map([['ledge-dev', [{ id: 'qi-3', from: 'dev.back', to: 'dev.front', summary: 'Review please', state: 'pending' }]]]),
        rigs: { installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: T0,
          rigs: [{ id: 'r1', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 2, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [seat('dev.front'), seat('dev.back', 'detached')] }] } });
      const md = readFileSync(join(dir, 'rigs.md'), 'utf8');
      expect(md).toContain('- unreachable: dev.back (detached)');
      expect(md).toContain('- dev.front: working, Fixing the header');
      expect(md).toContain('- qi-3 dev.back → dev.front (pending): Review please');
      expect(md).toContain('- g1 (running): Ship the lot');
      expect(md).not.toContain('g2');
    });
  });
});
