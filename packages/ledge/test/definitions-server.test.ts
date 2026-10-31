import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Projects, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { writeProjects } from '../src/daemon/projects.js';
import { definitionHash } from '../src/daemon/definitions.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

const T0 = '2026-10-28T08:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: `S${id}`, tool: 'claude', cwd: '/w', project: 'p', title: id,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let home: string; let repo1: string; let repo2: string; let sent: [string, string][]; let last: Map<string, string>;
function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); },
    async sendText(n, text) { sent.push([n, text]); last.set(n, text); }, async sendKeys() {}, async capture(n) { return last.get(n) ?? ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}
async function start() {
  store = new Store();
  const projects: Projects = { projects: [
    { id: 'p1', name: 'Un', color: 'blue', description: '', repos: [{ machine: 'local', path: repo1 }] },
    { id: 'p2', name: 'Deux', color: 'green', description: '', repos: [{ machine: 'srv', path: '/srv/x' }] },
    { id: 'p3', name: 'Trois', color: 'red', description: '', repos: [{ machine: 'srv', path: '/srv/y' }, { machine: 'local', path: repo2 }] }
  ], rules: [] };
  const projectsFile = join(home, 'projects.json');
  writeProjects(projects, projectsFile);
  srv = await startServer({ store, tmux: fakeTmux(), port: 0, projectsFile });
}
async function client(): Promise<Client> { const c = await connect({ port: srv.port }); await c.next('snapshot'); return c; }
const draft = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: 'Dev', prompt: 'Tu codes.', ...extra });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ledge-defs-'));
  process.env.LEDGE_HOME = join(home, 'ledge');
  repo1 = join(home, 'repo1'); repo2 = join(home, 'repo2');
  for (const d of [repo1, repo2, join(home, 'other')]) mkdirSync(d, { recursive: true });
  sent = []; last = new Map();
});
afterEach(async () => { await srv.close(); });

describe('definitions over the protocol', () => {
  it('role.write to home creates the file and shows in the next listing under the home scope', async () => {
    await start();
    const c = await client();
    c.send({ type: 'role.write', rid: 'w1', scope: 'home', role: draft('dev'), base: null });
    const r = await c.next('definition.result');
    expect(r).toMatchObject({ rid: 'w1', id: 'dev', hash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(r.code).toBeUndefined();
    const file = join(process.env.LEDGE_HOME!, 'roles', 'dev.md');
    expect(r.hash).toBe(definitionHash(readFileSync(file, 'utf8')));
    c.send({ type: 'definitions.list', requestId: 'l1' });
    const l = await c.next('definitions.listing');
    expect(l.requestId).toBe('l1');
    expect(l.scopes.map(s => [s.scope, s.project])).toEqual([['home', null], ['repo', 'p1'], ['repo', 'p3']]);
    expect(l.scopes[0]!.roles).toMatchObject([{ id: 'dev', label: 'Dev', prompt: 'Tu codes.', hash: r.hash }]);
    expect(l.scopes[1]!.roles).toEqual([]);
    await c.close();
  });

  it('role.write to a repo scope writes under the local repo of the project; a project with no local repo is unknown_project', async () => {
    await start();
    const c = await client();
    c.send({ type: 'role.write', rid: 'w1', scope: 'repo', project: 'p1', role: draft('dev'), base: null });
    expect((await c.next('definition.result')).code).toBeUndefined();
    expect(existsSync(join(repo1, '.ledge', 'roles', 'dev.md'))).toBe(true);
    c.send({ type: 'role.write', rid: 'w2', scope: 'repo', project: 'p2', role: draft('dev'), base: null });
    expect(await c.next('definition.result')).toMatchObject({ rid: 'w2', code: 'unknown_project' });
    c.send({ type: 'role.write', rid: 'w3', scope: 'repo', project: 'nope', role: draft('dev'), base: null });
    expect(await c.next('definition.result')).toMatchObject({ rid: 'w3', code: 'unknown_project' });
    c.send({ type: 'template.write', rid: 'w4', scope: 'repo', project: 'p2', name: 'Eq', seats: [{ role: 'dev' }], base: null });
    expect(await c.next('definition.result')).toMatchObject({ rid: 'w4', code: 'unknown_project' });
    c.send({ type: 'role.delete', rid: 'w5', scope: 'repo', project: 'p2', id: 'dev', base: '0123456789abcdef' });
    expect(await c.next('definition.result')).toMatchObject({ rid: 'w5', code: 'unknown_project' });
    // p3 has a remote repo first: its folder is the first local one.
    c.send({ type: 'role.write', rid: 'w6', scope: 'repo', project: 'p3', role: draft('dev'), base: null });
    expect((await c.next('definition.result')).code).toBeUndefined();
    expect(existsSync(join(repo2, '.ledge', 'roles', 'dev.md'))).toBe(true);
    await c.close();
  });

  it('a changed value of an existing file answers changed, a value that cannot be quoted answers invalid, a stale delete leaves the file', async () => {
    await start();
    const c = await client();
    c.send({ type: 'role.write', rid: 'a', scope: 'home', role: draft('dev'), base: null });
    const { hash } = await c.next('definition.result');
    c.send({ type: 'role.write', rid: 'b', scope: 'home', role: draft('dev'), base: null });
    expect(await c.next('definition.result')).toMatchObject({ rid: 'b', code: 'exists' });
    c.send({ type: 'role.write', rid: 'c', scope: 'home', role: draft('dev', { label: 'a\nb' }), base: hash! });
    expect(await c.next('definition.result')).toMatchObject({ rid: 'c', code: 'invalid' });
    c.send({ type: 'role.delete', rid: 'd', scope: 'home', id: 'dev', base: '0123456789abcdef' });
    expect(await c.next('definition.result')).toMatchObject({ rid: 'd', code: 'changed' });
    expect(existsSync(join(process.env.LEDGE_HOME!, 'roles', 'dev.md'))).toBe(true);
    c.send({ type: 'role.delete', rid: 'e', scope: 'home', id: 'dev', base: hash! });
    expect((await c.next('definition.result')).code).toBeUndefined();
    expect(existsSync(join(process.env.LEDGE_HOME!, 'roles', 'dev.md'))).toBe(false);
    c.send({ type: 'role.delete', rid: 'f', scope: 'home', id: 'dev', base: hash! });
    expect(await c.next('definition.result')).toMatchObject({ rid: 'f', code: 'missing' });
    await c.close();
  });

  it('a prompt change reaches the running seats whose role resolves to the file, once, with the full prompt', async () => {
    await start();
    mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true });
    writeFileSync(join(process.env.LEDGE_HOME!, 'roles', 'dev.md'), '---\nlabel: Home\n---\nHome dev.\n');
    store.upsert(mk('in', { role: 'dev', cwd: repo1 }));
    store.upsert(mk('out', { role: 'dev', cwd: join(home, 'other') }));
    store.upsert(mk('gone', { role: 'dev', cwd: repo1, state: 'exited' }));
    const c = await client();
    // Creating the repo role shadows the home one for the session in repo1: it switches to this file.
    c.send({ type: 'role.write', rid: 'w1', scope: 'repo', project: 'p1', role: draft('dev', { prompt: 'Premier prompt.' }), base: null });
    const first = await c.next('definition.result');
    await until(() => sent.length >= 1);
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toBe('ledge-in');
    expect(sent[0]![1]).toContain('@dev, Dev');
    expect(sent[0]![1]).toContain('Premier prompt.');
    // Typed into it, the session works; it is free again for the next notice.
    await until(() => store.get('in')!.state === 'working');
    store.upsert({ ...store.get('in')!, state: 'idle' });
    // Changing only the model sends nothing; changing the prompt sends the new one.
    c.send({ type: 'role.write', rid: 'w2', scope: 'repo', project: 'p1', role: draft('dev', { prompt: 'Premier prompt.', model: 'opus' }), base: first.hash! });
    const second = await c.next('definition.result');
    await new Promise(r => setTimeout(r, 300));
    expect(sent).toHaveLength(1);
    c.send({ type: 'role.write', rid: 'w3', scope: 'repo', project: 'p1', role: draft('dev', { prompt: 'Nouveau prompt complet.', model: 'opus' }), base: second.hash! });
    await c.next('definition.result');
    await until(() => sent.length >= 2);
    expect(sent[1]![0]).toBe('ledge-in');
    expect(sent[1]![1]).toContain('Nouveau prompt complet.');
    expect(sent[1]![1]).toMatch(/^<ledge-notice role="dev">Ta consigne de rôle a changé \(@dev, Dev\)\. La voici en entier ; elle remplace la précédente :/);
    expect(sent.filter(s => s[0] !== 'ledge-in')).toEqual([]);
    await c.close();
  });

  it('an autonomy change is told to the seats whose autonomy differs: it only holds for a new session of the role (issue #147)', async () => {
    await start();
    mkdirSync(join(repo1, '.ledge', 'roles'), { recursive: true });
    writeFileSync(join(repo1, '.ledge', 'roles', 'dev.md'), '---\nlabel: Dev\n---\nTu codes.\n');
    const hash = definitionHash(readFileSync(join(repo1, '.ledge', 'roles', 'dev.md'), 'utf8'));
    store.upsert(mk('asks', { role: 'dev', cwd: repo1 }));
    store.upsert(mk('auto', { role: 'dev', cwd: repo1, autonomy: 'auto' }));
    const c = await client();
    // Only the autonomy changes: no prompt to send again, but the seat launched with another autonomy is told it keeps it.
    c.send({ type: 'role.write', rid: 'w1', scope: 'repo', project: 'p1', role: draft('dev', { autonomy: 'auto' }), base: hash });
    const first = await c.next('definition.result');
    await until(() => sent.length >= 1);
    await new Promise(r => setTimeout(r, 300));
    expect(sent.map(s => s[0])).toEqual(['ledge-asks']);
    expect(sent[0]![1]).toMatch(/^<ledge-notice role="dev">L'autonomie de ton rôle a changé \(@dev, Dev\) : autonome\./);
    expect(sent[0]![1]).toContain('cette session garde « demande »');
    expect(sent[0]![1]).not.toContain('Tu codes.');
    // Prompt and autonomy at once: the prompt notice carries the autonomy line, for the seat it concerns only.
    await until(() => store.get('asks')!.state === 'working');
    store.upsert({ ...store.get('asks')!, state: 'idle' });
    c.send({ type: 'role.write', rid: 'w2', scope: 'repo', project: 'p1', role: draft('dev', { prompt: 'Tu codes vite.', autonomy: 'edits' }), base: first.hash! });
    await c.next('definition.result');
    await until(() => sent.length >= 3);
    const byPane = new Map(sent.slice(1).map(([n, t]) => [n, t]));
    expect(byPane.get('ledge-asks')).toContain('Tu codes vite.');
    expect(byPane.get('ledge-asks')).toContain('cette session garde « demande »');
    expect(byPane.get('ledge-auto')).toContain('cette session garde « autonome »');
    await c.close();
  });

  it('a role whose label is its id is told as (@id), with no comma', async () => {
    await start();
    store.upsert(mk('in', { role: 'dev', cwd: repo1 }));
    const c = await client();
    c.send({ type: 'role.write', rid: 'w1', scope: 'repo', project: 'p1', role: draft('dev', { label: 'dev', prompt: 'Sans label.' }), base: null });
    await c.next('definition.result');
    await until(() => sent.length >= 1);
    expect(sent[0]![1]).toContain('(@dev). La voici');
    await c.close();
  });

  it('template.write with no id names the file after the name; a second create with it answers exists; a stale delete answers changed', async () => {
    await start();
    const c = await client();
    c.send({ type: 'template.write', rid: 't1', scope: 'home', name: 'Revue MR', seats: [{ role: 'dev' }, { role: 'lead' }], base: null });
    const r = await c.next('definition.result');
    expect(r).toMatchObject({ rid: 't1', id: 'revue-mr', hash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    const file = join(process.env.LEDGE_HOME!, 'teams', 'revue-mr.yaml');
    expect(existsSync(file)).toBe(true);
    c.send({ type: 'template.write', rid: 't2', scope: 'home', name: 'Revue MR', seats: [{ role: 'dev' }], base: null });
    expect(await c.next('definition.result')).toMatchObject({ rid: 't2', code: 'exists' });
    c.send({ type: 'template.delete', rid: 't3', scope: 'home', id: 'revue-mr', base: '0123456789abcdef' });
    expect(await c.next('definition.result')).toMatchObject({ rid: 't3', code: 'changed' });
    expect(existsSync(file)).toBe(true);
    c.send({ type: 'definitions.list' });
    expect((await c.next('definitions.listing')).scopes[0]!.templates).toMatchObject([{ id: 'revue-mr', name: 'Revue MR', hash: r.hash }]);
    // Renaming keeps the id: the write names it.
    c.send({ type: 'template.write', rid: 't4', scope: 'home', id: 'revue-mr', name: 'Revue des MR', seats: [{ role: 'dev' }], base: r.hash! });
    expect(await c.next('definition.result')).toMatchObject({ rid: 't4', id: 'revue-mr' });
    expect(readFileSync(file, 'utf8')).toContain('Revue des MR');
    c.send({ type: 'template.delete', rid: 't5', scope: 'home', id: 'revue-mr', base: definitionHash(readFileSync(file, 'utf8')) });
    expect((await c.next('definition.result')).code).toBeUndefined();
    expect(existsSync(file)).toBe(false);
    await c.close();
  });

  it('an edit of a .yml template stays in its file', async () => {
    await start();
    mkdirSync(join(process.env.LEDGE_HOME!, 'teams'), { recursive: true });
    const file = join(process.env.LEDGE_HOME!, 'teams', 'old.yml');
    const text = 'name: Old\nseats:\n  - { role: dev }\n';
    writeFileSync(file, text);
    const c = await client();
    c.send({ type: 'template.write', rid: 't1', scope: 'home', id: 'old', name: 'Old 2', seats: [{ role: 'dev' }], base: definitionHash(text) });
    expect((await c.next('definition.result')).code).toBeUndefined();
    expect(readFileSync(file, 'utf8')).toContain('Old 2');
    expect(existsSync(join(process.env.LEDGE_HOME!, 'teams', 'old.yaml'))).toBe(false);
    await c.close();
  });
});
