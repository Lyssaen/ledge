import { describe, it, expect } from 'vitest';
import type { Projects, Session } from '@ledge/protocol';
import { proposeFor, proposeProjects, type Proposal, type ScanOf } from '../src/proposals';

const T = '2026-10-17T10:00:00.000Z';
const session = (id: string, name: string, cwd: string, machineId?: string): Session => ({
  id, name, cwd, machineId, tool: 'claude', project: '', title: '', tmuxSession: null, state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, source: 'launcher'
});

const projects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: 'Une nouvelle façon de travailler.', repos: [{ machine: 'local', path: '/home/me/Workspace/ledge/application' }, { machine: 'dev', path: '/home/dev/ledge' }] },
    { id: 'commerce', name: 'Payment Service', color: 'green', description: '', repos: [{ machine: 'dev', path: '/home/dev/payment/api' }] }
  ],
  rules: []
};

// Breadth-first, as the daemon returns them: the model sorts them itself.
const local: ScanOf = { machine: 'local', label: 'PC local', status: 'ok', truncated: false, repos: [
  { path: '/home/me/Workspace/scratch/notes', branch: null },
  { path: '/home/me/Workspace/ledge/application', branch: 'main', remote: 'github.com/paradow/ledge' },
  { path: '/home/me/Workspace/paper/paper-fonts', branch: 'main', remote: 'github.com/paradow/paper-fonts' },
  { path: '/home/me/Workspace/paper/paper-api', branch: 'main', remote: 'github.com/paradow/paper-api' },
  { path: '/home/me/Workspace/scratch/dotfiles', branch: 'main', remote: 'github.com/me/dotfiles' }
] };
const dev: ScanOf = { machine: 'dev', label: 'Dev SSH', status: 'ok', truncated: true, repos: [
  { path: '/srv/mirrors/ledge', branch: 'main', remote: 'github.com/paradow/ledge' },
  { path: '/home/dev/ledge', branch: 'develop', remote: 'github.com/paradow/ledge' },
  { path: '/home/dev/payment/api', branch: 'main', remote: 'github.com/paradow/payment-api' },
  { path: '/home/dev/paper/paper-templates', branch: 'main', remote: 'github.com/paradow/paper-templates' },
  { path: '/home/dev/paper/paper-api', branch: 'develop', remote: 'github.com/paradow/paper-api' },
  { path: '/home/dev/ledge/vendor/lib', branch: 'main', remote: 'github.com/x/lib' }
] };
const studio: ScanOf = { machine: 'studio', label: 'Studio SSH', status: 'offline', truncated: false, repos: [{ path: '/home/s/sites/portfolio', branch: 'main', remote: 'github.com/paradow/portfolio' }] };
const old: ScanOf = { machine: 'old', label: 'Old box', status: 'outdated', truncated: false, repos: [] };

const sessions: Session[] = [
  session('dev:zed', 'Zed', '/var/log', 'dev'),
  session('local:kit', 'Kit', '/home/me/Téléchargements/'),
  session('local:otto', 'Otto', '/home/me/Workspace/ledge/application/src'),
  session('studio:ana', 'Ana', '/home/s/tmp', 'studio')
];

const input = { projects, scans: [local, dev, studio, old], sessions };
const all = proposeProjects(input);
const containing = (path: string, machine: string, list: Proposal[] = all) => list.find(p => p.repos.some(r => r.machine === machine && r.path === path));
const everyRepo = (list: Proposal[]) => list.flatMap(p => p.repos.map(r => `${r.machine}:${r.path}`));

describe('proposeProjects', () => {
  it('groups the same remote across machines', () => {
    const p = containing('/home/me/Workspace/paper/paper-api', 'local')!;
    expect(p).toBeDefined();
    expect(p.repos).toContainEqual({ machine: 'dev', path: '/home/dev/paper/paper-api', why: { kind: 'remote', remote: 'github.com/paradow/paper-api', machines: ['PC local', 'Dev SSH'] } });
    expect(p.repos).toContainEqual({ machine: 'local', path: '/home/me/Workspace/paper/paper-api', why: { kind: 'remote', remote: 'github.com/paradow/paper-api', machines: ['PC local', 'Dev SSH'] } });
  });

  it("proposes the folders of the agents without a project, one proposal per parent folder, and files them", () => {
    const kit = all.find(x => x.file.includes('local:kit'))!;
    const zed = all.find(x => x.file.includes('dev:zed'))!;
    expect(kit).not.toBe(zed);
    expect(kit.file).toEqual(['local:kit']);
    expect(kit.name).toBe('Téléchargements');
    expect(kit.repos).toEqual([{ machine: 'local', path: '/home/me/Téléchargements', why: { kind: 'agent', names: ['Kit'] } }]);
    expect(kit.summary).toEqual({ repos: 1, machines: ['PC local'], agents: ['Kit'] });
    expect(zed.file).toEqual(['dev:zed']);
    expect(zed.name).toBe('Log');
    expect(zed.repos).toEqual([{ machine: 'dev', path: '/var/log', why: { kind: 'agent', names: ['Zed'] } }]);
    expect(kit.targetId).toBeUndefined();
    expect(zed.targetId).toBeUndefined();
    expect(all.flatMap(x => x.file)).not.toContain('local:otto');
  });

  it("puts the agents' folders that share a parent together, named after the parent", () => {
    const r = proposeProjects({ ...input, sessions: [...sessions, session('local:lou', 'Lou', '/home/me/Documents')] });
    const p = r.find(x => x.file.includes('local:kit'))!;
    expect(p.file).toEqual(['local:lou', 'local:kit']);
    expect(p.name).toBe('Me');
    expect(p.repos.map(x => x.path)).toEqual(['/home/me/Documents', '/home/me/Téléchargements']);
  });

  it("an agents' proposal retargets only on its own folders", () => {
    const taken: Projects = { ...projects, projects: [...projects.projects, { id: 'logs', name: 'log', color: 'red', description: '', repos: [] }] };
    const r = proposeProjects({ ...input, projects: taken });
    expect(r.find(x => x.file.includes('dev:zed'))!.targetId).toBe('logs');
    expect(r.find(x => x.file.includes('local:kit'))!.targetId).toBeUndefined();
  });

  it('attaches an agent to the scanned repository that holds its folder', () => {
    const withAgent = proposeProjects({ ...input, sessions: [session('local:ivy', 'Ivy', '/home/me/Workspace/scratch/notes/drafts')] });
    const p = containing('/home/me/Workspace/scratch/notes', 'local', withAgent)!;
    expect(p.file).toEqual(['local:ivy']);
    expect(p.repos).toContainEqual({ machine: 'local', path: '/home/me/Workspace/scratch/notes', why: { kind: 'agent', names: ['Ivy'] } });
    expect(everyRepo(withAgent).filter(r => r.includes('drafts'))).toEqual([]);
  });

  it('never proposes a folder that holds scanned repositories, nor /', () => {
    const r = proposeProjects({ ...input, sessions: [session('local:max', 'Max', '/home/me'), session('dev:root', 'Root', '/', 'dev')] });
    expect(r.flatMap(p => p.file)).toEqual([]);
    expect(everyRepo(r)).not.toContain('local:/home/me');
  });

  it('names a common prefix', () => {
    const p = containing('/home/me/Workspace/paper/paper-fonts', 'local')!;
    expect(p.name).toBe('Paper');
    expect(p.repos).toContainEqual({ machine: 'local', path: '/home/me/Workspace/paper/paper-fonts', why: { kind: 'naming', stem: 'paper' } });
    expect(p.repos).toContainEqual({ machine: 'dev', path: '/home/dev/paper/paper-templates', why: { kind: 'naming', stem: 'paper' } });
  });

  it('groups the remaining repositories by parent folder', () => {
    const p = containing('/home/me/Workspace/scratch/dotfiles', 'local')!;
    expect(p.name).toBe('Scratch');
    expect(p.repos).toEqual([
      { machine: 'local', path: '/home/me/Workspace/scratch/dotfiles', why: { kind: 'folder', parent: '/home/me/Workspace/scratch' } },
      { machine: 'local', path: '/home/me/Workspace/scratch/notes', why: { kind: 'folder', parent: '/home/me/Workspace/scratch' } }
    ]);
  });

  it("never proposes a repository of a project, nor one under it", () => {
    const repos = everyRepo(all);
    for (const owned of ['local:/home/me/Workspace/ledge/application', 'dev:/home/dev/ledge', 'dev:/home/dev/payment/api', 'dev:/home/dev/ledge/vendor/lib']) expect(repos).not.toContain(owned);
  });

  it('a repository with the remote of a project repository is an « add to » that project', () => {
    const p = containing('/srv/mirrors/ledge', 'dev')!;
    expect(p.targetId).toBe('ledge');
    expect(p.name).toBe('Ledge');
    expect(p.color).toBe('blue');
    expect(p.description).toBe('Une nouvelle façon de travailler.');
    expect(p.summary).toEqual({ repos: 1, machines: ['Dev SSH'], target: 'Ledge', agents: [] });
    expect(p.repos).toEqual([{ machine: 'dev', path: '/srv/mirrors/ledge', why: { kind: 'remote', remote: 'github.com/paradow/ledge', machines: ['Dev SSH'] } }]);
  });

  it('a repository next to a project repository is a new proposal, not an « add to »', () => {
    const scans = [{ ...local, repos: [...local.repos, { path: '/home/me/development/ledge', branch: 'main' }, { path: '/home/me/development/a', branch: 'main' }, { path: '/home/me/development/b', branch: null }] }, dev];
    const near: Projects = { ...projects, projects: [...projects.projects, { id: 'ledge-dev', name: 'Ledge dev', color: 'pink', description: '', repos: [{ machine: 'local', path: '/home/me/development/ledge' }] }] };
    const r = proposeProjects({ ...input, projects: near, scans });
    const p = containing('/home/me/development/a', 'local', r)!;
    expect(p.targetId).toBeUndefined();
    expect(p.name).toBe('Development');
    expect(p.repos.map(x => [x.path, x.why.kind])).toEqual([['/home/me/development/a', 'folder'], ['/home/me/development/b', 'folder']]);
    // A lone repository next to a project repository is not proposed.
    const lone = proposeProjects({ ...input, scans: [{ ...local, repos: [...local.repos, { path: '/home/me/Workspace/ledge/website', branch: 'main' }] }, dev] });
    expect(containing('/home/me/Workspace/ledge/website', 'local', lone)).toBeUndefined();
  });

  it('a name already taken (case and accents aside) is an « add to » that project', () => {
    const taken: Projects = { ...projects, projects: [...projects.projects, { id: 'bac', name: 'SCRÂTCH', color: 'red', description: '', repos: [] }] };
    const p = containing('/home/me/Workspace/scratch/notes', 'local', proposeProjects({ ...input, projects: taken }))!;
    expect(p).toMatchObject({ targetId: 'bac', name: 'SCRÂTCH', color: 'red', summary: { target: 'SCRÂTCH' } });
  });

  it('puts each repository in one proposal only', () => {
    const repos = everyRepo(all);
    expect(new Set(repos).size).toBe(repos.length);
    // paper-api is both a same-remote and a paper-* candidate: the first reason wins.
    expect(all.flatMap(p => p.repos).filter(r => r.path.endsWith('/paper-api')).map(r => r.why.kind)).toEqual(['remote', 'remote']);
    expect(all.filter(p => p.name === 'Paper')).toHaveLength(1);
  });

  it('gives the first unused colour, then the next one', () => {
    expect(all.map(p => [p.name, p.color, p.targetId])).toEqual([
      ['Paper', 'amber', undefined],
      ['Ledge', 'blue', 'ledge'],
      ['Téléchargements', 'violet', undefined],
      ['Log', 'teal', undefined],
      ['Scratch', 'pink', undefined]
    ]);
    const full: Projects = { projects: (['blue', 'green', 'amber', 'violet', 'teal', 'pink', 'red', 'slate'] as const).map((color, i) => ({ id: `p${i}`, name: `P${i}`, color, description: '', repos: [] })), rules: [] };
    expect(proposeProjects({ ...input, projects: full }).map(p => p.color)[0]).toBe('blue');
  });

  it('keeps the pid stable from one call to the next, and distinct', () => {
    const again = proposeProjects({ ...input, scans: [{ ...local, repos: [...local.repos].reverse() }, dev, studio, old], sessions: [...sessions].reverse() });
    expect(again).toEqual(all);
    expect(new Set(all.map(p => p.pid)).size).toBe(all.length);
    expect(all[0]!.pid).toMatch(/^prop-[0-9a-z]+$/);
  });

  it('ignores an offline or outdated machine, its repositories and its agents', () => {
    expect(everyRepo(all).some(r => r.startsWith('studio:') || r.startsWith('old:'))).toBe(false);
    expect(all.flatMap(p => p.file)).not.toContain('studio:ana');
    expect(proposeProjects({ projects, scans: [studio, old], sessions })).toEqual([]);
  });

  it('never proposes a home kept in Git, nor a repository holding others, nor uses it to hold an agent', () => {
    const dotfiles = 'github.com/me/dotfiles';
    const box: ScanOf = { machine: 'box', label: 'Box', status: 'ok', truncated: false, repos: [{ path: '/home/box', branch: 'main', remote: dotfiles }] };
    const scans = [{ ...local, repos: [...local.repos, { path: '/home/me', branch: 'main', remote: dotfiles }] }, { ...dev, repos: [...dev.repos, { path: '/home/dev', branch: 'main', remote: dotfiles }] }, box];
    const r = proposeProjects({ ...input, scans, sessions: [...sessions, session('local:max', 'Max', '/home/me'), session('box:bo', 'Bo', '/home/box/tmp', 'box')] });
    const repos = everyRepo(r);
    for (const home of ['local:/home/me', 'dev:/home/dev', 'box:/home/box']) expect(repos).not.toContain(home);
    expect(r.find(p => p.file.includes('local:kit'))!.repos.map(x => x.path)).toEqual(['/home/me/Téléchargements']);
    expect(r.find(p => p.file.includes('box:bo'))!.repos.map(x => x.path)).toEqual(['/home/box/tmp']);
    expect(r.flatMap(p => p.file)).not.toContain('local:max');
    // A repository that holds another scanned repository, home or not.
    const nested = proposeProjects({ ...input, scans: [{ ...local, repos: [{ path: '/w/big', branch: 'main' }, { path: '/w/big/inner', branch: 'main' }] }], sessions: [session('local:ivy', 'Ivy', '/w/big/docs')] });
    expect(everyRepo(nested)).not.toContain('local:/w/big');
    expect(nested.find(p => p.file.includes('local:ivy'))!.repos.map(x => x.path)).toEqual(['/w/big/docs']);
  });

  it("attaches a loose folder to an agents' folder that holds it", () => {
    const r = proposeProjects({ ...input, sessions: [session('local:b', 'Bea', '/tmp/a/b'), session('local:a', 'Ada', '/tmp/a')] });
    expect(r.filter(p => p.file.length)).toHaveLength(1);
    expect(r[r.findIndex(p => p.file.length)]).toMatchObject({ file: ['local:a', 'local:b'], repos: [{ machine: 'local', path: '/tmp/a', why: { kind: 'agent', names: ['Ada', 'Bea'] } }] });
  });

  it('a path that only starts like a project repository is free', () => {
    const r = proposeProjects({ ...input, scans: [local, { ...dev, repos: [...dev.repos, { path: '/home/dev/ledger', branch: 'main' }] }], sessions: [session('dev:ned', 'Ned', '/home/dev/ledger/src', 'dev')] });
    expect(r.find(p => p.file.includes('dev:ned'))!.repos).toEqual([{ machine: 'dev', path: '/home/dev/ledger', why: { kind: 'agent', names: ['Ned'] } }]);
  });

  it('summarises the repositories and their machines', () => {
    expect(containing('/home/me/Workspace/paper/paper-api', 'local')!.summary).toEqual({ repos: 4, machines: ['PC local', 'Dev SSH'], agents: [] });
  });
});

describe('proposeFor', () => {
  it('with a typed name, the free repositories whose name holds one of its words', () => {
    const p = proposeFor({ name: 'Paper rendering', file: [] }, all, input)!;
    expect(p.name).toBe('Paper rendering');
    expect(p.targetId).toBeUndefined();
    expect(p.color).toBe('amber');
    expect(p.repos.map(r => `${r.machine}:${r.path}`)).toEqual([
      'local:/home/me/Workspace/paper/paper-api', 'local:/home/me/Workspace/paper/paper-fonts', 'dev:/home/dev/paper/paper-api', 'dev:/home/dev/paper/paper-templates'
    ]);
    expect(p.repos[0]!.why).toEqual({ kind: 'naming', stem: 'paper' });
  });

  it("from a project's editor, the proposal that already targets it, the project keeping its name", () => {
    const p = proposeFor({ id: 'ledge', name: 'Ledge', file: [] }, all, input)!;
    expect(p).toMatchObject({ targetId: 'ledge', name: 'Ledge', color: 'blue', summary: { target: 'Ledge' } });
    expect(p.repos).toEqual([{ machine: 'dev', path: '/srv/mirrors/ledge', why: { kind: 'remote', remote: 'github.com/paradow/ledge', machines: ['Dev SSH'] } }]);
    expect(p.pid).toBe(all.find(x => x.targetId === 'ledge')!.pid);
    expect(proposeFor({ id: 'ledge', name: 'Paper', file: [] }, all, input)).toMatchObject({ targetId: 'ledge', name: 'Ledge' });
  });

  it("from a project's editor without a proposal for it, the others go to that project", () => {
    const p = proposeFor({ id: 'commerce', name: 'Payment Service', file: [] }, all, input)!;
    expect(p).toMatchObject({ targetId: 'commerce', name: 'Payment Service', color: 'green', summary: { target: 'Payment Service' } });
    expect(p.repos.map(r => r.path)).toEqual(all[0]!.repos.map(r => r.path));
  });

  it('a new draft keeps its typed name, even when the proposal picked is an « add to »', () => {
    const rest = all.slice(1); // the Ledge « add to » first
    expect(proposeFor({ name: '', file: [] }, rest, input)).toMatchObject({ targetId: 'ledge', name: 'Ledge' });
    const p = proposeFor({ name: 'Zz', file: [] }, rest, input)!;
    expect(p.name).toBe('Zz');
    expect(p.targetId).toBeUndefined();
    expect(p.summary.target).toBeUndefined();
    expect(p.color).toBe('amber');
  });

  it('with an agent to file, the proposal that holds it', () => {
    const p = proposeFor({ name: '', file: ['dev:zed'] }, all, input)!;
    expect(p.file).toEqual(['dev:zed']);
    expect(p.name).toBe('Log');
  });

  it('else the first proposal, named as typed', () => {
    expect(proposeFor({ name: '', file: [] }, all, input)!.pid).toBe(all[0]!.pid);
    expect(proposeFor({ name: 'Zz', file: [] }, all, input)!.name).toBe('Zz');
  });

  it('null when nothing is free', () => {
    const none = { projects, scans: [], sessions: [] };
    expect(proposeFor({ name: 'paper', file: [] }, proposeProjects(none), none)).toBeNull();
    const owned: Projects = { projects: [{ id: 'all', name: 'All', color: 'blue', description: '', repos: [{ machine: 'local', path: '/home/me' }, { machine: 'dev', path: '/home/dev' }, { machine: 'dev', path: '/srv' }] }], rules: [] };
    const taken = { projects: owned, scans: [local, dev], sessions: [session('local:otto', 'Otto', '/home/me/Workspace')] };
    expect(proposeProjects(taken)).toEqual([]);
    expect(proposeFor({ name: 'paper', file: ['local:otto'] }, proposeProjects(taken), taken)).toBeNull();
  });
});
