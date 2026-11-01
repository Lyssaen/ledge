import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { runGuard } from '../src/daemon/actions.js';
import { until } from './helpers.js';
import { sessionKey } from '../src/auth.js';

// `action.run` (#93): a registry action outside the chat, resolved and applied as a generic card's row.
function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let c: Client;
const role = (id: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\nlabel: ${id}\n---\nTu es ${id}.\n`); };
let n = 0;
/** Run as the user, or as session `by` with the key its environment holds (`key` to send another). */
async function run(action: string, args: Record<string, unknown>, extra: { by?: string; key?: string | null; confirmed?: true } = {}) {
  const rid = `r${++n}`;
  const { key, ...rest } = extra;
  const k = key === undefined ? (extra.by ? sessionKey(extra.by) : undefined) : key ?? undefined;
  c.send({ type: 'action.run', rid, action, args, ...rest, ...(k ? { key: k } : {}) } as never);
  const r = await c.next('action.result', 5000);
  expect(r.rid).toBe(rid);
  return r;
}
async function team(): Promise<Team> {
  c.send({ type: 'team.launch', rid: 'launch', cwd: work, name: 'api', seats: [{ role: 'lead' }, { role: 'build' }] });
  return (await c.next('team.launched', 5000)).team;
}

beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-run-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  role('lead'); role('build');
  store = new Store();
  srv = await startServer({ store, tmux: fakeTmux(), port: 0, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
  c = await connect({ port: srv.port }); await c.next('snapshot');
});
afterEach(async () => { await c.close(); await srv.close(); });

describe('action.run', () => {
  it('a reversible action by name: resolved to ids, applied, answered with its row', async () => {
    const t = await team();
    const build = t.seats[1]!.sessionId!;
    const r = await run('team.leave', { team: 'api', session: store.get(build)!.name });
    expect(r).toMatchObject({ action: 'team.leave', row: { action: 'team.leave', args: { team: t.id, session: build }, risk: 'reversible' } });
    expect(r.reason).toBeUndefined();
    expect(await run('team.leave', { team: t.id, session: build })).toMatchObject({ code: 'refused', reason: expect.stringContaining('is not in api') });
  });

  it('a destructive action: asked again without confirmed, refused to a session, done for the user who confirmed', async () => {
    const t = await team();
    const lead = t.seats[0]!.sessionId!;
    expect(await run('team.dissolve', { team: 'api' })).toMatchObject({ code: 'confirm_required', row: { args: { team: t.id }, risk: 'destructive' } });
    expect(await run('team.dissolve', { team: 'api' }, { by: lead, confirmed: true })).toMatchObject({ code: 'agent', reason: expect.stringContaining('@leader') });
    const done = await run('team.dissolve', { team: t.id }, { confirmed: true });
    expect(done.reason).toBeUndefined();
    expect(await run('team.resume', { team: t.id })).toMatchObject({ code: 'refused', reason: 'team api is dissolved' });
  });

  it('task.answer: the user answers a decision a session put to it, confirmed; never a session, not even the @leader asking', async () => {
    const t = await team();
    const lead = t.seats[0]!.sessionId!;
    c.send({ type: 'task.cmd', rid: 'ask', by: lead, op: 'give', to: 'ledge', title: 'Fusionner ?', text: 'oui / non' });
    const d = (await c.next('task.result', 3000)).task!;
    expect(await run('task.answer', { task: d.id, answer: 'oui' })).toMatchObject({ code: 'confirm_required', row: { risk: 'destructive', detail: 'oui' } });
    expect(await run('task.answer', { task: d.id, answer: 'oui' }, { by: lead, confirmed: true })).toMatchObject({ code: 'agent' });
    expect((await run('task.answer', { task: d.id, answer: 'Oui, fusionne' }, { confirmed: true })).reason).toBeUndefined();
    c.send({ type: 'task.cmd', rid: 'show', by: 'ledge', op: 'show', task: d.id });
    expect((await c.next('task.result', 3000)).task).toMatchObject({ state: 'done', result: 'Oui, fusionne' });
    expect(await run('task.answer', { task: d.id, answer: 'non' }, { confirmed: true })).toMatchObject({ code: 'refused', reason: `task ${d.id} is closed` });
  });
  it('refuses what is not possible now, bad args, and an action the CLI does not run', async () => {
    expect(await run('team.resume', { team: 'zz' })).toMatchObject({ code: 'refused', reason: 'unknown team zz' });
    expect(await run('team.join', { team: 'zz' })).toMatchObject({ code: 'refused', reason: expect.stringContaining('session') });
    expect(await run('session.launch', { cwd: work })).toMatchObject({ code: 'refused', reason: 'session.launch is not run from the CLI' });
  });

  it('team.save answers the template it wrote; a handler refusal is the result\'s reason', async () => {
    await team();
    const r = await run('team.save', { team: 'api', name: 'atelier' });
    expect(r.path).toBe(join(process.env.LEDGE_HOME!, 'teams', 'atelier.yaml'));
    expect(existsSync(r.path!)).toBe(true);
  });

  it('session.close: the @leader closes a session of its team; a session closes itself, answered before its close', async () => {
    role('leader');
    c.send({ type: 'team.launch', rid: 'launch', cwd: work, name: 'api', seats: [{ role: 'leader' }, { role: 'build' }] });
    const t = (await c.next('team.launched', 5000)).team;
    const [lead, build] = t.seats.map(s => s.sessionId!);
    const r = await run('session.close', { session: store.get(build!)!.name }, { by: lead! });
    expect(r).toMatchObject({ row: { action: 'session.close', args: { session: build }, risk: 'reversible' } });
    expect(r.reason).toBeUndefined();
    expect(store.get(build!)!.state).toBe('exited');
    const self = await run('session.close', { session: lead! }, { by: lead! });
    expect(self.reason).toBeUndefined();
    await until(() => store.get(lead!)!.state === 'exited');
  });

  it('a session is who its key says: a by with a wrong key, or none, is refused before anything', async () => {
    const t = await team();
    const [lead, build] = t.seats.map(s => s.sessionId!);
    expect(await run('team.leave', { team: t.id, session: build! }, { by: build!, key: sessionKey(lead!) })).toMatchObject({ code: 'identity', reason: expect.stringContaining('ne correspond pas') });
    // No key at all: a session launched before Ledge gave keys, told to be resumed rather than suspected.
    expect(await run('team.leave', { team: t.id, session: build! }, { by: build!, key: null })).toMatchObject({ code: 'identity', reason: expect.stringContaining('pas de clé') });
    expect(t.seats.length).toBe(2);
    expect(await run('team.leave', { team: t.id, session: build! }, { by: build! })).not.toHaveProperty('reason');
  });

  it('refuses an agent what the rule does not give it, with the reason', async () => {
    const t = await team();
    const [lead, build] = t.seats.map(s => s.sessionId!);
    expect(await run('session.close', { session: build! }, { by: lead! })).toMatchObject({ code: 'agent', reason: expect.stringContaining('utilisateur') });
    expect(store.get(build!)!.state).not.toBe('exited');
  });
});

describe('runGuard (#93 (a), decided by the user on 2026-10-26: option 4)', () => {
  const T0 = '2026-10-26T10:00:00.000Z';
  const team = (id: string, seats: Array<[string, string]>, state: 'active' | 'dissolved' = 'active') =>
    ({ id, name: id, project: null, machine: 'local', cwd: '/w', state, seats: seats.map(([role, sessionId]) => ({ role, sessionId })), createdAt: T0, updatedAt: T0 });
  // `lead` leads team-a1 (ann, bob); `cid` sits in team-b2 (dan); `eve` is in no team.
  const ctx = { sessions: [], tasks: [], findRole: () => undefined, teams: [
    team('team-a1', [['leader', 'lead'], ['dev-back', 'ann'], ['dev-front', 'bob']]),
    team('team-b2', [['leader', 'dan'], ['dev-back', 'cid']]),
    team('team-c3', [['leader', 'lead'], ['dev-back', 'gus']], 'dissolved')
  ] };
  const dissolve = (t: string) => ({ action: 'team.dissolve' as const, args: { team: t }, summary: 'Dissoudre', risk: 'destructive' as const, team: t });
  const leave = (t: string, s: string) => ({ action: 'team.leave' as const, args: { team: t, session: s }, summary: 'Retirer', risk: 'reversible' as const, team: t, session: s });
  const close = (s: string) => ({ action: 'session.close' as const, args: { session: s }, summary: 'Fermer', risk: 'reversible' as const, session: s });
  const cancel = { action: 'task.cancel' as const, args: { task: 't123456' }, summary: 'Annuler', risk: 'destructive' as const };
  const cancelIn = (t: string) => ({ ...cancel, team: t });
  const resume = { action: 'team.resume' as const, args: { team: 'team-a1' }, summary: 'Reprendre', risk: 'reversible' as const, team: 'team-a1' };

  it('lets the user run anything', () => {
    for (const row of [dissolve('team-a1'), leave('team-b2', 'cid'), close('eve'), cancel, resume]) expect(runGuard(row, undefined, ctx)).toBeNull();
  });
  it('lets a team\'s @leader dissolve it, take a member out of it and close one of its sessions', () => {
    expect(runGuard(dissolve('team-a1'), 'lead', ctx)).toBeNull();
    expect(runGuard(leave('team-a1', 'ann'), 'lead', ctx)).toBeNull();
    expect(runGuard(close('bob'), 'lead', ctx)).toBeNull();
    expect(runGuard(cancelIn('team-a1'), 'lead', ctx)).toBeNull();
  });
  it('never on another team, nor on a team it led that is dissolved', () => {
    expect(runGuard(dissolve('team-b2'), 'lead', ctx)).toMatch(/@leader/);
    expect(runGuard(leave('team-b2', 'cid'), 'lead', ctx)).toMatch(/@leader/);
    expect(runGuard(close('cid'), 'lead', ctx)).toMatch(/@leader/);
    expect(runGuard(close('gus'), 'lead', ctx)).toMatch(/@leader/);
    expect(runGuard(cancelIn('team-b2'), 'lead', ctx)).toMatch(/@leader/);
    expect(runGuard(cancelIn('team-c3'), 'lead', ctx)).toMatch(/@leader/);
  });
  it('lets any session close itself and leave its team, and nothing else', () => {
    expect(runGuard(close('eve'), 'eve', ctx)).toBeNull();
    expect(runGuard(leave('team-a1', 'ann'), 'ann', ctx)).toBeNull();
    expect(runGuard(close('bob'), 'ann', ctx)).toMatch(/utilisateur/);
    expect(runGuard(leave('team-a1', 'bob'), 'ann', ctx)).toMatch(/utilisateur/);
    expect(runGuard(dissolve('team-a1'), 'ann', ctx)).toMatch(/utilisateur/);
    expect(runGuard(cancel, 'lead', ctx)).toMatch(/utilisateur/);
    expect(runGuard(cancelIn('team-a1'), 'ann', ctx)).toMatch(/utilisateur/);
    expect(runGuard(resume, 'lead', ctx)).toMatch(/utilisateur/);
  });
});
