import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCHANGES_MAX, TEAM_ADDRESS, transmissions, type Rig, type ServerMessage, type Session, type Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createTeamsLive, type TeamsLive } from '../src/daemon/teamsLive.js';
import { createTasks, type Tasks } from '../src/daemon/tasks.js';
import { createLedgeEngine } from '../src/daemon/engine/ledge.js';
import { createOpenRigEngine } from '../src/daemon/engine/openrig.js';
import type { RigAggregate } from '../src/daemon/openrig/aggregate.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';

// Lot D, task 4: a live Ledge team in the common team shape (Rig, RigSeat, Exchange), whatever the client reads.

const T0 = '2026-11-01T08:00:00.000Z';
const mk = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/api', project: 'api', title: `${name} · api`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });
type RigMsg = Extract<ServerMessage, { type: 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' }>;

describe('the Ledge engine, alone', () => {
  let store: Store; let teams: TeamsLive; let engine: ReturnType<typeof createLedgeEngine>; let out: RigMsg[]; let team: Team;
  beforeEach(() => {
    store = new Store();
    store.upsert(mk('pim', 'Pim', { branch: 'feat/x' })); store.upsert(mk('nova', 'Nova', { tool: 'codex', state: 'working', model: 'gpt-5' }));
    teams = createTeamsLive({ store, now: () => T0 });
    engine = createLedgeEngine({ store, teams, now: () => T0 });
    out = []; engine.onMessage(m => { out.push(m); });
    team = teams.create({ name: 'api', project: 'api', cwd: '/w/api', roles: ['leader', 'review'] });
    teams.seat(team.id, 'leader', store.get('pim')!, 'Chef');
    teams.seat(team.id, 'review', store.get('nova')!, 'Relecteur');
  });
  afterEach(() => { engine.close(); teams.close(); });

  it('projects a team of Pim (claude, idle) and Nova (codex, working) into the exact Rig', () => {
    const rig: Rig = { id: team.id, name: 'api', machine: 'local', cwd: '/w/api', projectId: 'api', offProject: false, branch: 'feat/x',
      lifecycle: 'running', kernel: false, engine: 'ledge', repos: [], seats: [
        { ref: `leader@${team.id}`, address: '@leader', name: 'Pim', runtime: 'claude', sessionId: 'pim', state: 'idle' },
        { ref: `review@${team.id}`, address: '@review', name: 'Nova', runtime: 'codex', sessionId: 'nova', model: 'gpt-5', state: 'working' }] };
    expect(engine.teams()).toEqual([rig]);
    expect(engine.replay()).toEqual([{ type: 'rig.snapshot', machine: 'local', rigs: [rig] }]);
    expect(engine.running()).toBe(true);
    expect(engine.kind).toBe('ledge');
  });

  it('a team born of a template carries its id as the rig\'s spec (lot F: the card names the template)', () => {
    const t = teams.create({ name: 'atelier', template: 'workshop', project: 'api', cwd: '/w/api', roles: ['leader'] });
    expect(engine.teams().find(r => r.id === t.id)!.spec).toBe('workshop');
    expect(engine.teams().find(r => r.id === team.id)!.spec).toBeUndefined();
  });

  it('a free seat is stopped under its role, the team partial; waiting is attention, starting starting', () => {
    const t = teams.create({ name: 'solo', project: null, cwd: '/w/solo', roles: ['leader', { role: 'build', tool: 'codex' }] });
    store.upsert(mk('mila', 'Mila', { state: 'waiting_permission' }));
    teams.seat(t.id, 'leader', store.get('mila')!, 'Chef');
    const rig = engine.teams().find(r => r.id === t.id)!;
    expect(rig).toMatchObject({ projectId: null, offProject: true, lifecycle: 'partial' });
    expect(rig.branch).toBeUndefined();
    expect(rig.seats).toEqual([
      { ref: `leader@${t.id}`, address: '@leader', name: 'Mila', runtime: 'claude', sessionId: 'mila', state: 'attention' },
      { ref: `build@${t.id}`, address: '@build', name: 'build', runtime: 'codex', state: 'stopped' }]);
    store.upsert({ ...store.get('mila')!, state: 'starting' });
    expect(engine.teams().find(r => r.id === t.id)!.seats[0]!.state).toBe('starting');
  });

  it('Nova exits: the team turns partial and her seat stopped, told as rig.updated', () => {
    out.length = 0;
    store.upsert({ ...store.get('nova')!, state: 'exited' });
    const rig = engine.teams()[0]!;
    expect(rig.lifecycle).toBe('partial');
    expect(rig.seats[1]).toMatchObject({ name: 'Nova', state: 'stopped' });
    expect(out.at(-1)).toEqual({ type: 'rig.updated', rig });
  });

  it('a change that leaves the projection as it was is not told again', () => {
    out.length = 0;
    store.upsert({ ...store.get('pim')!, lastActivityAt: '2026-11-01T09:00:00.000Z' });
    expect(out).toEqual([]);
  });

  it('resting, the team is stopped; dissolved, it is gone and rig.removed is told', () => {
    store.upsert({ ...store.get('pim')!, state: 'exited' }); store.upsert({ ...store.get('nova')!, state: 'exited' });
    expect(teams.get(team.id)!.state).toBe('resting');
    expect(engine.teams()[0]!.lifecycle).toBe('stopped');
    expect(engine.running()).toBe(false);
    out.length = 0;
    teams.dissolve(team.id);
    expect(engine.teams()).toEqual([]);
    expect(out).toEqual([{ type: 'rig.removed', machine: 'local', rigId: team.id }]);
  });

  it('a task Pim gives to @review is a task exchange from Pim to Nova, told and kept', () => {
    const tasks: Tasks = createTasks({ store, mailbox: { notify: () => true }, teams, now: () => T0,
      onTask: (t, entry) => { const tr = transmissions(t).find(x => x.index === (entry ? t.log.lastIndexOf(entry) : -1)); if (tr && t.team) engine.recordTask(t, tr); } });
    out.length = 0;
    const r = tasks.run({ type: 'task.cmd', rid: 'g1', by: 'pim', op: 'give', to: '@review', title: 'Relire la PR' });
    expect(r.task?.team).toBe(team.id);
    const x = { id: expect.any(String), machine: 'local', rigId: team.id, from: 'Pim', to: 'Nova', kind: 'task', text: 'Relire la PR', at: T0 };
    expect(out).toEqual([{ type: 'rig.exchange', exchange: x }]);
    expect(engine.exchanges(team.id)).toEqual([x]);
    expect(engine.exchanges('team-ffff')).toEqual([]);
    tasks.close();
  });

  it('a done or refuse exchange carries the result after the title, cut at 200 characters; give and pass the title only (branch review M1)', () => {
    const tasks: Tasks = createTasks({ store, mailbox: { notify: () => true }, teams, now: () => T0,
      onTask: (t, entry) => { const tr = transmissions(t).find(x => x.index === (entry ? t.log.lastIndexOf(entry) : -1)); if (tr && t.team) engine.recordTask(t, tr); } });
    const a = tasks.run({ type: 'task.cmd', rid: 'g1', by: 'pim', op: 'give', to: '@review', title: 'Relire la PR' }).task!;
    tasks.run({ type: 'task.cmd', rid: 'd1', by: 'nova', op: 'done', task: a.id, text: 'Deux remarques, corrigées' });
    const long = 'x'.repeat(300);
    const b = tasks.run({ type: 'task.cmd', rid: 'g2', by: 'pim', op: 'give', to: '@review', title: 'Tester' }).task!;
    tasks.run({ type: 'task.cmd', rid: 'r1', by: 'nova', op: 'refuse', task: b.id, text: long });
    const texts = engine.exchanges(team.id).map(e => e.text);
    expect(texts).toEqual(['Relire la PR', 'Relire la PR — Deux remarques, corrigées', 'Tester', `Tester — ${'x'.repeat(199)}…`]);
    expect(texts[3]!.length).toBe('Tester — '.length + 200);
    tasks.close();
  });

  it('a message between two seats is a message exchange, @team goes to @team; outside the team nothing', () => {
    store.upsert(mk('otto', 'Otto'));
    engine.recordMessage(store.get('pim')!, store.get('nova')!, 'Tu peux relire ?', 'm1');
    engine.recordMessage(store.get('pim')!, '@team', 'On fusionne à 17h', 'm2');
    engine.recordMessage(store.get('pim')!, store.get('otto')!, 'Hors équipe', 'm3');
    engine.recordMessage(store.get('pim')!, store.get('nova')!, 'Tu peux relire ?', 'm1'); // the same rid again: once
    expect(engine.exchanges(team.id).map(e => ({ from: e.from, to: e.to, kind: e.kind, text: e.text }))).toEqual([
      { from: 'Pim', to: 'Nova', kind: 'message', text: 'Tu peux relire ?' },
      { from: 'Pim', to: '@team', kind: 'message', text: 'On fusionne à 17h' }]);
    expect(out.filter(m => m.type === 'rig.exchange')).toHaveLength(2);
  });

  it('keeps EXCHANGES_MAX exchanges per team, the most recent', () => {
    for (let i = 0; i < EXCHANGES_MAX + 5; i++) engine.recordMessage(store.get('pim')!, store.get('nova')!, `n°${i}`, `r${i}`);
    const kept = engine.exchanges(team.id);
    expect(kept).toHaveLength(EXCHANGES_MAX);
    expect(kept[0]!.text).toBe('n°5'); expect(kept.at(-1)!.text).toBe(`n°${EXCHANGES_MAX + 4}`);
  });
});

describe('the Ledge engine not in force (lot D final review I2)', () => {
  it('reads no team nor exchange while another engine is chosen, and finds them as they were once chosen again', () => {
    const store = new Store(); store.upsert(mk('pim', 'Pim'));
    const teams = createTeamsLive({ store, now: () => T0 });
    let on = false;
    const engine = createLedgeEngine({ store, teams, now: () => T0, active: () => on });
    const team = teams.create({ name: 'api', project: 'api', cwd: '/w/api', roles: ['leader'] });
    teams.seat(team.id, 'leader', store.get('pim')!, 'Chef');
    engine.recordMessage(store.get('pim')!, TEAM_ADDRESS, 'Pause', 'k1');
    expect(engine.teams()).toEqual([]);
    expect(engine.exchanges(team.id)).toEqual([]);
    expect(engine.replay()).toEqual([{ type: 'rig.snapshot', machine: 'local', rigs: [] }]);
    on = true;
    expect(engine.teams().map(r => r.id)).toEqual([team.id]);
    expect(engine.exchanges(team.id).map(x => x.text)).toEqual(['Pause']);
    expect(engine.exchanges(team.id, 'ec2')).toEqual([]);
    engine.close(); teams.close();
  });
});

describe('the OpenRig adapter', () => {
  it('its teams are the aggregate’s rigs as they are; only rig messages pass; its replay is the aggregate’s whole one', () => {
    const rig: Rig = { id: 'r1', name: 'starter', machine: 'local', cwd: '/w', projectId: null, offProject: true, lifecycle: 'running', kernel: false, seats: [], repos: [] };
    let fn: ((m: never) => void) | undefined;
    const aggregate = { rigs: () => [rig], exchanges: (machine: string, id: string) => (machine === 'local' && id === 'r1' ? [] : null),
      replay: () => [{ type: 'openrig.status', status: { machine: 'local', state: 'running' } }, { type: 'rig.snapshot', machine: 'local', rigs: [rig] }],
      onMessage: (f: (m: never) => void) => { fn = f; return () => {}; } } as unknown as RigAggregate;
    const e = createOpenRigEngine(aggregate);
    expect(e.kind).toBe('openrig');
    expect(e.teams()).toEqual([rig]);
    expect(e.running()).toBe(true);
    expect(e.exchanges('r1')).toEqual([]);
    expect(e.replay()).toEqual([{ type: 'openrig.status', status: { machine: 'local', state: 'running' } }, { type: 'rig.snapshot', machine: 'local', rigs: [rig] }]);
    const seen: unknown[] = []; e.onMessage(m => { seen.push(m); });
    fn!({ type: 'openrig.status', status: { machine: 'local', state: 'running' } } as never);
    fn!({ type: 'rig.removed', machine: 'local', rigId: 'r1' } as never);
    expect(seen).toEqual([{ type: 'rig.removed', machine: 'local', rigId: 'r1' }]);
  });
});

// Against the real daemon, in Ledge mode (the default: no teams-engine.json).
function fakeTmux(): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { panes.add(o.name); },
    async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

describe('the Ledge engine in the daemon', () => {
  let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let home: string | undefined;
  const role = (id: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\nlabel: ${id}\n---\nTu es ${id}.\n`); };
  async function start() {
    store = new Store();
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, agentEnv: async () => ({ ...process.env }), close: { freeMs: 100, exitMs: 100 },
      claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
  }
  async function client(): Promise<{ c: Client }> { const c = await connect({ port: srv.port }); await c.next('snapshot'); return { c }; }
  async function launch(c: Client): Promise<Team> {
    c.send({ type: 'team.launch', rid: 'l1', cwd: work, name: 'api', seats: [{ role: 'leader' }, { role: 'build' }] });
    return (await c.next('team.launched', 5000)).team;
  }
  const idle = (id: string) => store.apply(id, { name: 'Stop', at: new Date().toISOString(), source: 'hook' });

  beforeEach(() => {
    home = process.env.LEDGE_HOME;
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-engine-'));
    work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
    for (const r of ['leader', 'build']) role(r);
  });
  afterEach(async () => {
    await srv.close();
    rmSync(process.env.LEDGE_HOME!, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
    if (home === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = home;
  });

  it('a client’s snapshot carries a local rig.snapshot with the team projected', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    await c.close();
    const late = await connect({ port: srv.port });
    const snap = await late.next('rig.snapshot', 3000);
    expect(snap.machine).toBe('local');
    expect(snap.rigs).toEqual([expect.objectContaining({ id: team.id, name: 'api', engine: 'ledge', machine: 'local', kernel: false,
      seats: [expect.objectContaining({ ref: `leader@${team.id}`, address: '@leader' }), expect.objectContaining({ ref: `build@${team.id}`, address: '@build' })] })]);
    await late.close();
  });

  it('rig.act down rests the team, up resumes it', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    const ids = team.seats.map(s => s.sessionId!);
    for (const id of ids) { idle(id); store.upsert({ ...store.get(id)!, agentSessionId: `a-${id}` }); }
    c.send({ type: 'rig.act', rid: 'd1', machine: 'local', rigId: team.id, verb: 'down' });
    expect(await c.next('rig.result', 5000)).toMatchObject({ rid: 'd1', ok: true });
    await until(() => ids.every(id => store.get(id)!.state === 'exited'));
    const resting = await connect({ port: srv.port });
    expect((await resting.next('teams')).teams.find(t => t.id === team.id)!.state).toBe('resting');
    expect((await resting.next('rig.snapshot', 3000)).rigs.find(r => r.id === team.id)!.lifecycle).toBe('stopped');
    await resting.close();
    c.send({ type: 'rig.act', rid: 'u1', machine: 'local', rigId: team.id, verb: 'up' });
    expect(await c.next('rig.result', 5000)).toMatchObject({ rid: 'u1', ok: true });
    await until(() => ids.every(id => store.get(id)!.state === 'starting'));
    await c.close();
  });

  it('a seat stopped by rig.act stop; a rig.updated follows; an unknown seat is refused', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    const build = team.seats.find(s => s.role === 'build')!.sessionId!;
    idle(build);
    c.send({ type: 'rig.act', rid: 's0', machine: 'local', rigId: team.id, seatRef: `nobody@${team.id}`, verb: 'stop' });
    expect(await c.next('rig.result', 3000)).toMatchObject({ rid: 's0', ok: false });
    c.send({ type: 'rig.act', rid: 's1', machine: 'local', rigId: team.id, seatRef: `build@${team.id}`, verb: 'stop' });
    expect(await c.next('rig.result', 5000)).toMatchObject({ rid: 's1', ok: true });
    expect(store.get(build)!.state).toBe('exited');
    for (;;) { const u = await c.next('rig.updated', 3000); if (u.rig.seats.find(s => s.address === '@build')!.state === 'stopped') { expect(u.rig).toMatchObject({ id: team.id, lifecycle: 'partial', engine: 'ledge' }); break; } }
    await c.close();
  });

  it('a task given to @build and a lead’s @team are told as rig.exchange and served by rig.exchanges.request', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    const [lead, build] = ['leader', 'build'].map(r => store.get(team.seats.find(s => s.role === r)!.sessionId!)!);
    for (const s of [lead!, build!]) idle(s.id);
    c.send({ type: 'task.cmd', rid: 't1', by: lead!.id, op: 'give', to: '@build', title: 'Écrire les tests' });
    expect((await c.next('task.result')).task).toBeTruthy();
    expect((await c.next('rig.exchange', 3000)).exchange).toMatchObject({ rigId: team.id, kind: 'task', from: lead!.name, to: build!.name, text: 'Écrire les tests' });
    c.send({ type: 'session.message', rid: 'm1', from: lead!.id, to: '@team', text: 'Pause' });
    expect((await c.next('message.ack')).outcome).not.toBe('refused'); // queued behind the task's pointer, maybe
    expect((await c.next('rig.exchange', 3000)).exchange).toMatchObject({ kind: 'message', from: lead!.name, to: '@team', text: 'Pause' });
    c.send({ type: 'session.message', rid: 'm2', from: build!.id, to: '@leader', text: 'Fait' });
    expect((await c.next('message.ack')).outcome).not.toBe('refused');
    expect((await c.next('rig.exchange', 3000)).exchange).toMatchObject({ kind: 'message', from: build!.name, to: lead!.name, text: 'Fait' });
    c.send({ type: 'rig.exchanges.request', machine: 'local', rigId: team.id });
    expect((await c.next('rig.exchanges')).items.map(x => x.text)).toEqual(['Écrire les tests', 'Pause', 'Fait']);
    c.send({ type: 'rig.exchanges.request', machine: 'local', rigId: 'starter' });
    expect((await c.next('rig.exchanges')).items).toEqual([]);
    await c.close();
  });

  it('a task given inside a Ledge team reaches Ledge’s thread as an exchanges group (branch review C1)', async () => {
    await start();
    const { c } = await client();
    c.send({ type: 'team.launch', rid: 'l1', cwd: work, name: 'api', seats: [{ role: 'leader' }, { role: 'build' }], objective: { goal: 'Ajoute un README' } });
    const team = (await c.next('team.launched', 5000)).team;
    const lead = team.seats.find(s => s.role === 'leader')!.sessionId!;
    for (const s of team.seats) idle(s.sessionId!);
    c.send({ type: 'task.cmd', rid: 't1', by: lead, op: 'give', to: '@build', title: 'Relis le README' });
    const given = (await c.next('task.result')).task!;
    let item: Extract<ServerMessage, { type: 'ledge.thread.item' }>['item'];
    do item = (await c.next('ledge.thread.item', 3000)).item; while (item.kind !== 'exchanges' || !item.exchangeIds.some(id => id.startsWith(`${given.id}:`)));
    expect(item).toMatchObject({ machine: 'local', rigId: team.id });
    c.send({ type: 'ledge.thread.request' });
    let page; do page = await c.next('ledge.thread.history', 3000); while (!page.items.length); // the snapshot's own (empty) page first
    const groups = page.items.filter(i => i.kind === 'exchanges');
    expect(groups.flatMap(g => g.kind === 'exchanges' ? g.exchangeIds : [])).toEqual(expect.arrayContaining([`${team.objectiveTask}:0`, `${given.id}:0`]));
    await c.close();
  });

  it('the user’s team.broadcast is a message exchange from Toi to @team, in the exchanges and the thread (branch review I2)', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    for (const s of team.seats) idle(s.sessionId!);
    c.send({ type: 'team.broadcast', rid: 'b1', team: team.id, text: 'On fusionne à 17h' });
    expect((await c.next('team.broadcast.result')).sent).toBe(2);
    const x = (await c.next('rig.exchange', 3000)).exchange;
    expect(x).toMatchObject({ rigId: team.id, kind: 'message', from: 'Toi', to: TEAM_ADDRESS, text: 'On fusionne à 17h' });
    let item: Extract<ServerMessage, { type: 'ledge.thread.item' }>['item'];
    do item = (await c.next('ledge.thread.item', 3000)).item; while (item.kind !== 'exchanges' || !item.exchangeIds.includes(x.id));
    c.send({ type: 'rig.exchanges.request', machine: 'local', rigId: team.id });
    expect((await c.next('rig.exchanges')).items.map(e => [e.from, e.to, e.text])).toEqual([['Toi', TEAM_ADDRESS, 'On fusionne à 17h']]);
    c.send({ type: 'team.broadcast', rid: 'b2', team: 'team-ffff', text: 'Personne' }); // refused: no exchange
    expect((await c.next('team.broadcast.result')).reason).toBeTruthy();
    await expect(c.next('rig.exchange', 300)).rejects.toThrow('timeout');
    await c.close();
  });

  it('a refused message is no exchange', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    const build = team.seats.find(s => s.role === 'build')!.sessionId!;
    c.send({ type: 'session.message', rid: 'm1', from: build, to: '@team', text: 'Salut' }); // only the lead speaks to @team
    expect((await c.next('message.ack')).outcome).toBe('refused');
    c.send({ type: 'session.message', rid: 'm2', from: build, to: '@nobody', text: 'Salut' });
    expect((await c.next('message.ack')).outcome).toBe('refused');
    await expect(c.next('rig.exchange', 300)).rejects.toThrow('timeout');
    c.send({ type: 'rig.exchanges.request', machine: 'local', rigId: team.id });
    expect((await c.next('rig.exchanges')).items).toEqual([]);
    await c.close();
  });

  it('rig.act restart starts a fresh session in the seat; handover asks its brief; a seat is needed', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    const build = team.seats.find(s => s.role === 'build')!.sessionId!;
    idle(build);
    c.send({ type: 'rig.act', rid: 'n1', machine: 'local', rigId: team.id, verb: 'restart' });
    expect(await c.next('rig.result', 3000)).toEqual({ type: 'rig.result', rid: 'n1', ok: false, code: 'invalid', reason: 'il faut un siège (seatRef)' });
    c.send({ type: 'rig.act', rid: 'h1', machine: 'local', rigId: team.id, seatRef: `build@${team.id}`, verb: 'handover' });
    expect(await c.next('rig.result', 3000)).toEqual({ type: 'rig.result', rid: 'h1', ok: true });
    expect(store.get(build)!.handover?.state).toBe('briefing');
    c.send({ type: 'rig.act', rid: 'h2', machine: 'local', rigId: team.id, seatRef: `build@${team.id}`, verb: 'handover' });
    expect(await c.next('rig.result', 3000)).toMatchObject({ rid: 'h2', ok: false, code: 'failed', reason: expect.stringContaining('déjà en cours') });
    const lead = team.seats.find(s => s.role === 'leader')!.sessionId!;
    idle(lead);
    c.send({ type: 'rig.act', rid: 'r1', machine: 'local', rigId: team.id, seatRef: `leader@${team.id}`, verb: 'restart' });
    expect(await c.next('rig.result', 5000)).toEqual({ type: 'rig.result', rid: 'r1', ok: true });
    expect(store.get(lead)!.state).toBe('exited');
    const now = await connect({ port: srv.port });
    const seat = (await now.next('teams')).teams.find(t => t.id === team.id)!.seats.find(s => s.role === 'leader')!;
    expect(seat.sessionId).not.toBe(lead);
    expect(store.get(seat.sessionId!)!.state).not.toBe('exited');
    await now.close(); await c.close();
  });

  it('an unknown team is invalid; a team named on another machine is not served here', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    c.send({ type: 'rig.act', rid: 'a1', machine: 'local', rigId: 'team-ffff', verb: 'down' });
    expect(await c.next('rig.result', 3000)).toEqual({ type: 'rig.result', rid: 'a1', ok: false, code: 'invalid', reason: 'aucune équipe team-ffff' });
    c.send({ type: 'rig.act', rid: 'a2', machine: 'ec2', rigId: team.id, verb: 'down' });
    expect(await c.next('rig.result', 3000)).toMatchObject({ rid: 'a2', ok: false, code: 'invalid' });
    expect(team.seats.every(s => store.get(s.sessionId!)!.state !== 'exited')).toBe(true);
    c.send({ type: 'rig.exchanges.request', machine: 'ec2', rigId: team.id });
    expect(await c.next('error', 3000)).toMatchObject({ request: 'rig.exchanges.request', code: 'invalid' });
    await c.close();
  });

  it('a stop while the seat is already closing reads that close: ok, not busy', async () => {
    await start();
    const { c } = await client();
    const team = await launch(c);
    const build = team.seats.find(s => s.role === 'build')!.sessionId!;
    idle(build);
    c.send({ type: 'rig.act', rid: 's1', machine: 'local', rigId: team.id, seatRef: `build@${team.id}`, verb: 'stop' });
    c.send({ type: 'rig.act', rid: 's2', machine: 'local', rigId: team.id, seatRef: `build@${team.id}`, verb: 'down' });
    const got = [await c.next('rig.result', 5000), await c.next('rig.result', 5000)];
    expect(got.map(r => [r.rid, r.ok]).sort()).toEqual([['s1', true], ['s2', true]]);
    expect(store.get(build)!.state).toBe('exited');
    await c.close();
  });
});

// Ledge ↔ OpenRig: the fronts never see the rigs of the engine not chosen.
describe('the switch of engine', () => {
  let srv: Awaited<ReturnType<typeof startServer>> | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null; let dir: string; let store: Store; let home: string | undefined;
  beforeEach(() => { home = process.env.LEDGE_HOME; });
  afterEach(async () => {
    await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; rmSync(dir, { recursive: true, force: true });
    if (home === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = home;
  });

  it('under Ledge the local snapshot is Ledge’s teams; switched to OpenRig, they are cleared and never told again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ledge-switch-')); process.env.LEDGE_HOME = dir;
    mkdirSync(join(dir, 'roles'), { recursive: true }); writeFileSync(join(dir, 'roles', 'leader.md'), '---\nlabel: Lead\n---\nTu es leader.\n');
    fake = await createFakeOpenRig();
    fake.rigs.push({ rigId: 'starter', name: 'starter', status: 'stopped', nodes: [] }); // OpenRig's own, stopped: the switch is allowed
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as never, home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    store = new Store();
    srv = await startServer({ store, tmux: fakeTmux(), port: 0, home: dir, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))], openrig: bridge });
    await bridge.start(); await until(() => bridge!.status().state === 'running');
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'team.launch', rid: 'l', cwd: dir, name: 'api', seats: [{ role: 'leader' }] });
    const team = (await c.next('team.launched', 5000)).team;
    const lead = team.seats[0]!.sessionId!;
    store.upsert({ ...store.get(lead)!, state: 'exited' }); // resting: the switch is allowed
    // A late client: the aggregate's empty local snapshot, then Ledge's (its snapshot burst ends with Ledge's thread).
    const late = await connect({ port: srv.port }); await late.next('ledge.thread.history', 3000);
    expect(await late.next('rig.snapshot')).toEqual({ type: 'rig.snapshot', machine: 'local', rigs: [] });
    expect((await late.next('rig.snapshot')).rigs).toEqual([expect.objectContaining({ id: team.id, lifecycle: 'stopped', engine: 'ledge' })]);
    c.send({ type: 'teams.engine.set', rid: 'a', engine: 'openrig' });
    expect((await c.next('teams.engine.result')).ok).toBe(true);
    // At once the local machine has no rig left, until the bridge's own snapshot brings OpenRig's back (never Ledge's).
    expect(await late.next('rig.snapshot', 3000)).toEqual({ type: 'rig.snapshot', machine: 'local', rigs: [] });
    expect((await late.next('rig.snapshot', 3000)).rigs.map(r => r.id)).toEqual(['starter']);
    await late.close();
    c.send({ type: 'team.dissolve', team: team.id });
    for (;;) { const u = await c.next('team.updated', 3000); if (u.team.id === team.id && u.team.state === 'dissolved') break; }
    await expect(c.next('rig.removed', 400)).rejects.toThrow('timeout');
    const openrigClient = await connect({ port: srv.port }); await openrigClient.next('snapshot');
    for (;;) { const m = await openrigClient.next('rig.snapshot', 400).catch(() => null); if (!m) break; expect(m.rigs.some(r => r.engine === 'ledge')).toBe(false); }
    await openrigClient.close(); await c.close();
  });
});
