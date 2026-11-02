import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';
import WebSocket from 'ws';
import { ACTIONS, parseServerMessage, type ClientMessage, type ServerMessage, type Session, type Team } from '@ledge/protocol';
import { engineRefusal, ENGINE_LEDGE, ENGINE_OPENRIG } from '../src/daemon/engine/guard.js';
import { writeTeamsEngine } from '../src/daemon/engine/setting.js';
import { actionsFor, buildPersona } from '../src/chat/persona.js';
import { createChat } from '../src/chat/service.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { teamsJournal } from '../src/daemon/teamsLive.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { paths } from '../src/paths.js';
import { authHeaders, until } from './helpers.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const T = '2026-11-01T10:00:00.000Z';

describe('engineRefusal (the engine not chosen is off)', () => {
  const rigCmds: ClientMessage[] = [
    { type: 'rig.act', rid: 'a', machine: 'local', rigId: 'r1', verb: 'down' },
    { type: 'rig.prepare', rid: 'b', machine: 'local', spec: 'factory', goal: 'x', where: { kind: 'off-project', name: 'x' } },
    { type: 'rig.launch', rid: 'c', planId: 'p1' },
    { type: 'rig.adopt', rid: 'd', machine: 'local', rigId: 'r1', projectId: 'app' },
    { type: 'rig.send', rid: 'e', machine: 'local', seatRef: 'dev@r1', text: 'hi' },
    { type: 'escalation.answer', rid: 'f', id: 'q-123', answers: {}, by: 'user' }
  ];
  const teamCmds: ClientMessage[] = [
    { type: 'team.launch', rid: 'a', cwd: '/w' },
    { type: 'team.join', team: 'team-abcd', session: 's1', role: 'dev' },
    { type: 'team.resume', team: 'team-abcd' },
    { type: 'team.compose', rid: 'b', team: 'team-abcd', seats: [] },
    { type: 'team.seat', rid: 'c', team: 'team-abcd', role: 'dev', action: 'start' },
    { type: 'team.save', rid: 'd', name: 'api', seats: [] },
    { type: 'task.cmd', rid: 'e', by: 's1', op: 'list' },
    { type: 'action.run', rid: 'f', action: 'team.launch', args: {} },
    { type: 'action.run', rid: 'g', action: 'task.give', args: {} },
    { type: 'action.run', rid: 'h', action: 'task.cancel', args: {} }
  ];

  it('says the exact texts', () => {
    expect(ENGINE_LEDGE).toBe("le moteur d'équipes est Ledge : les rigs OpenRig sont coupés (Réglages › Équipes)");
    expect(ENGINE_OPENRIG).toBe("le moteur d'équipes est OpenRig : ledge team et ledge task sont coupés (Réglages › Équipes)");
  });
  it('Ledge mode refuses the OpenRig commands, and lets ledge team and task through', () => {
    for (const m of rigCmds) expect(engineRefusal('ledge', m), m.type).toBe(ENGINE_LEDGE);
    for (const m of teamCmds) expect(engineRefusal('ledge', m), m.type).toBeNull();
  });
  it('Ledge mode lets an answer to a Ledge ask, and a projected Ledge team (team-…), through', () => {
    expect(engineRefusal('ledge', { type: 'escalation.answer', rid: 'a', id: 'ask-a000001', answers: {}, by: 'user' })).toBeNull();
    expect(engineRefusal('ledge', { type: 'rig.act', rid: 'a', machine: 'local', rigId: 'team-abcd', verb: 'down' })).toBeNull();
    expect(engineRefusal('ledge', { type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' })).toBeNull();
  });
  it('OpenRig mode refuses ledge team and task, but never dissolve nor leave', () => {
    for (const m of teamCmds) expect(engineRefusal('openrig', m), m.type).toBe(ENGINE_OPENRIG);
    for (const m of rigCmds) expect(engineRefusal('openrig', m), m.type).toBeNull();
    const always: ClientMessage[] = [
      { type: 'team.dissolve', team: 'team-abcd' }, { type: 'team.leave', team: 'team-abcd', session: 's1' },
      { type: 'action.run', rid: 'a', action: 'team.dissolve', args: {} }, { type: 'action.run', rid: 'b', action: 'team.leave', args: {} },
      { type: 'action.run', rid: 'c', action: 'session.close', args: {} }
    ];
    for (const m of always) expect(engineRefusal('openrig', m), JSON.stringify(m)).toBeNull();
  });
});

describe('the chat\'s action list follows the engine (Review Focus 5)', () => {
  const ids = (e: 'ledge' | 'openrig') => actionsFor(e).map(a => a.id);
  it('OpenRig mode: no team.launch nor task.give (nor any team or task action the daemon refuses)', () => {
    expect(ids('openrig')).not.toContain('team.launch'); expect(ids('openrig')).not.toContain('task.give');
    expect(ids('openrig')).toContain('team.dissolve'); expect(ids('openrig')).toContain('team.leave');
    expect(ids('openrig')).toContain('session.launch');
  });
  it('Ledge mode: no rig action, ledge team and task kept', () => {
    expect(ids('ledge').filter(id => id.startsWith('rig'))).toEqual([]);
    expect(ids('ledge')).toEqual(ACTIONS.map(a => a.id).filter(id => !id.startsWith('rig')));
    expect(ids('ledge')).toContain('team.launch'); expect(ids('ledge')).toContain('task.give');
  });

  const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
  it.each(['ledge', 'openrig'] as const)('%s: the persona and ledge.md the chat gets list only that engine\'s actions', async engine => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-cut-chat-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
    let persona = ''; let guide = '';
    const spawn = ((file: string, a: string[], o: object) => {
      persona = a[a.indexOf('--append-system-prompt') + 1] ?? '';
      const f = join(home, 'chat', 'context', 'ledge.md'); guide = existsSync(f) ? readFileSync(f, 'utf8') : '';
      return nodeSpawn(file, a, o as never);
    }) as unknown as typeof nodeSpawn;
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux: { async capture() { return null; } } as never, home, today: () => '2026-10-11',
      env: async () => ({ ...process.env }), bin: [process.execPath, FAKE], spawn, engine: () => engine });
    await chat.ask('q1', 'x', () => {});
    expect(persona).toBe(buildPersona('claude', actionsFor(engine)));
    const block = (id: string) => `{"action":"${id}"`;
    if (engine === 'openrig') {
      for (const id of ['team.launch', 'task.give']) { expect(persona).not.toContain(block(id)); expect(guide).not.toContain(`\`${id}\``); }
      expect(persona).toContain(block('team.dissolve'));
    } else {
      expect(persona).not.toMatch(/"action":"rig\./); expect(persona).not.toContain('rigLaunch'); expect(guide).not.toMatch(/`rig\./);
      expect(persona).toContain(block('team.launch')); expect(guide).toContain('`task.give`');
    }
    rmSync(home, { recursive: true, force: true });
  });
});

describe('a card the engine does not run is not made (fix round 1)', () => {
  const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
  const act = (action: string, args: object) => '```ledge-action\n' + JSON.stringify({ action, args }) + '\n```';
  it('OpenRig mode: a team.resume or task.give the model writes anyway gets no card, and the answer says why', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-cut-card-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
    const answer = 'Je reprends.\n\n' + act('team.resume', { team: 'team-abcd' }) + '\n' + act('task.give', { to: 's1', title: 'Tests' });
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux: { async capture() { return null; } } as never, home, today: () => '2026-10-11',
      env: async () => ({ ...process.env, FAKE_ANSWER: answer }), bin: [process.execPath, FAKE], engine: () => 'openrig',
      teams: () => [{ id: 'team-abcd', name: 'api', project: null, machine: 'local', cwd: '/w', state: 'resting', seats: [], createdAt: T, updatedAt: T }] });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(m));
    const done = out.find(m => m.type === 'chat.done') as Extract<ServerMessage, { type: 'chat.done' }>;
    expect(done.actions).toBeUndefined(); expect(done.tasks).toBeUndefined();
    expect(done.text).toContain("coupées par le moteur d'équipes : team.resume, task.give");
    rmSync(home, { recursive: true, force: true });
  });
});

const panes = new Set<string>();
const noTmux: Tmux = { async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
  async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n] };
const mkS = (id: string, name: string): Session => ({ id, name, tool: 'claude', cwd: '/w', project: 'w', title: `${name} · w`, tmuxSession: `ledge-${name}`, state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, source: 'launcher' });
const factory = (): FakeRig => ({ rigId: 'r1', name: 'factory', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@factory', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });

describe('the daemon with the engine not chosen off', () => {
  let dir: string; let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null; let store: Store;
  const sockets: WebSocket[] = [];
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-cut-')); process.env.LEDGE_HOME = dir; panes.clear(); });
  afterEach(async () => { for (const s of sockets.splice(0)) s.terminate(); await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; rmSync(dir, { recursive: true, force: true }); });

  async function boot(o: { engine?: 'ledge' | 'openrig'; rigs?: FakeRig[]; teams?: Team[]; answer?: string } = {}) {
    if (o.engine) writeTeamsEngine(paths().teamsEngine, o.engine);
    fake = await createFakeOpenRig(); for (const r of o.rigs ?? []) fake.rigs.push(r);
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as never, home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    if (o.teams) writeFileSync(paths().teams, JSON.stringify(o.teams));
    store = new Store();
    srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env, ...(o.answer ? { FAKE_ANSWER: o.answer } : {}) }),
      claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))], ...(o.teams ? { teams: teamsJournal(paths().teams) } : {}), openrig: bridge });
    await bridge.start(); await until(() => bridge!.status().state === 'running');
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() }); sockets.push(ws);
    const got: ServerMessage[] = [];
    ws.on('message', d => { try { got.push(parseServerMessage(JSON.parse(String(d)))); } catch { /* not ours */ } });
    await new Promise(r => ws.once('open', r));
    await until(() => got.some(m => m.type === 'teams.engine'));
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    const answer = async <K extends ServerMessage['type']>(type: K, pred: (m: Extract<ServerMessage, { type: K }>) => boolean = () => true) => {
      await until(() => got.some(m => m.type === type && pred(m as never)));
      return got.find(m => m.type === type && pred(m as never)) as Extract<ServerMessage, { type: K }>;
    };
    return { got, send, answer };
  }

  it('Ledge mode: OpenRig is only probed, its running rig reaches no client and does not block the switch (Review Focus 3)', async () => {
    const c = await boot({ rigs: [factory()] });
    await sleep(150); // several probe turns
    expect(bridge!.status().state).toBe('running');
    expect(fake!.requests.some(r => r.path === '/api/events')).toBe(false);
    expect(bridge!.rigs()).toEqual([]);
    const snaps = c.got.filter((m): m is Extract<ServerMessage, { type: 'rig.snapshot' }> => m.type === 'rig.snapshot');
    expect(snaps.flatMap(s => s.rigs)).toEqual([]);
    expect(c.got.some(m => m.type === 'rig.updated')).toBe(false);
    c.send({ type: 'teams.engine.set', rid: 's', engine: 'openrig' });
    expect((await c.answer('teams.engine.result')).ok).toBe(true);
    // Leaving the probe: the full bridge comes back, without restarting the daemon.
    await c.answer('rig.snapshot', m => m.rigs.some(r => r.name === 'factory'));
  });

  it('Ledge mode: rig.act is refused with ENGINE_LEDGE; a Ledge team id (team-…) reaches the Ledge engine', async () => {
    const c = await boot();
    c.send({ type: 'rig.act', rid: 'a1', machine: 'local', rigId: 'r1', verb: 'down' });
    expect(await c.answer('rig.result', m => m.rid === 'a1')).toEqual({ type: 'rig.result', rid: 'a1', ok: false, code: 'unsupported', reason: ENGINE_LEDGE });
    c.send({ type: 'rig.act', rid: 'a2', machine: 'local', rigId: 'team-abcd', verb: 'down' });
    expect(await c.answer('rig.result', m => m.rid === 'a2')).toEqual({ type: 'rig.result', rid: 'a2', ok: false, code: 'failed', reason: 'aucune équipe team-abcd' });
    c.send({ type: 'rig.exchanges.request', machine: 'local', rigId: 'team-abcd' });
    expect(await c.answer('rig.exchanges')).toEqual({ type: 'rig.exchanges', machine: 'local', rigId: 'team-abcd', items: [] });
  });

  it('OpenRig mode with a resting Ledge team: resume and task refused, dissolve, messages and asks pass (Review Focus 4)', async () => {
    const team: Team = { id: 'team-abcd', name: 'api', project: null, machine: 'local', cwd: '/w', state: 'resting', seats: [{ role: 'leader', sessionId: null }], createdAt: T, updatedAt: T, restingAt: T };
    const c = await boot({ engine: 'openrig', teams: [team] });
    store.upsert(mkS('s1', 'Nova')); store.upsert(mkS('s2', 'Bix'));
    c.send({ type: 'team.resume', team: 'team-abcd' });
    expect(await c.answer('error', m => m.request === 'team.resume')).toMatchObject({ message: ENGINE_OPENRIG });
    c.send({ type: 'task.cmd', rid: 't1', by: 's1', op: 'list' });
    expect(await c.answer('task.result', m => m.rid === 't1')).toEqual({ type: 'task.result', rid: 't1', reason: ENGINE_OPENRIG });
    c.send({ type: 'team.launch', rid: 'l1', cwd: dir });
    expect(await c.answer('team.failed', m => m.rid === 'l1')).toEqual({ type: 'team.failed', rid: 'l1', reason: ENGINE_OPENRIG });
    c.send({ type: 'action.run', rid: 'x1', action: 'task.give', args: {} });
    expect(await c.answer('action.result', m => m.rid === 'x1')).toEqual({ type: 'action.result', rid: 'x1', action: 'task.give', reason: ENGINE_OPENRIG, code: 'refused' });
    c.send({ type: 'session.message', rid: 'm1', from: 's1', to: 's2', text: 'salut' });
    expect((await c.answer('message.ack', m => m.rid === 'm1')).reason).not.toBe(ENGINE_OPENRIG);
    c.send({ type: 'ask.create', rid: 'k1', by: 's1', question: 'On fusionne ?', options: 'oui / non' });
    expect(await c.answer('ask.result', m => m.rid === 'k1')).toMatchObject({ ask: { question: 'On fusionne ?' } });
    c.send({ type: 'team.dissolve', team: 'team-abcd' });
    await c.answer('team.updated', m => m.team.id === 'team-abcd' && m.team.state === 'dissolved');
    expect(c.got.some(m => m.type === 'error' && m.message === ENGINE_OPENRIG && m.request === 'team.dissolve')).toBe(false);
  });

  it('a chat card made under Ledge, applied after the switch to OpenRig, is refused by the engine (fix round 1)', async () => {
    const team: Team = { id: 'team-abcd', name: 'api', project: null, machine: 'local', cwd: '/w', state: 'resting', seats: [{ role: 'leader', sessionId: null }], createdAt: T, updatedAt: T, restingAt: T };
    const c = await boot({ teams: [team], answer: 'Je reprends.\n\n```ledge-action\n{"action":"team.resume","args":{"team":"team-abcd"}}\n```' });
    c.send({ type: 'chat.ask', qid: 'q1', text: 'reprends api' });
    expect((await c.answer('chat.done', m => m.qid === 'q1')).actions?.map(a => a.action)).toEqual(['team.resume']);
    c.send({ type: 'teams.engine.set', rid: 's', engine: 'openrig' });
    expect((await c.answer('teams.engine.result')).ok).toBe(true);
    c.send({ type: 'chat.act', rid: 'r1', qid: 'q1' });
    expect(await c.answer('chat.acted', m => m.rid === 'r1')).toMatchObject({ done: [], failed: [{ row: 0, message: ENGINE_OPENRIG }] });
  });

  it('Ledge mode: rig.specs.request lists no OpenRig spec and says why (fix round 1)', async () => {
    const c = await boot();
    c.send({ type: 'rig.specs.request', requestId: 'p1' });
    expect(await c.answer('rig.specs', m => m.requestId === 'p1')).toEqual({ type: 'rig.specs', requestId: 'p1', machine: 'local', specs: [], error: 'failed', reason: ENGINE_LEDGE });
    expect(fake!.requests.some(r => r.path.startsWith('/api/specs'))).toBe(false);
  });

  it('OpenRig mode: the bridge is whole (registers, mirrors the rigs)', async () => {
    const c = await boot({ engine: 'openrig', rigs: [factory()] });
    await c.answer('rig.snapshot', m => m.rigs.some(r => r.name === 'factory'));
    await until(() => bridge!.status().human === 'registered');
  });
});

describe('teams.engine follows the teams (Task 2 review)', () => {
  let dir: string; let srv: ServerHandle | null = null;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledge-cut-eng-')); process.env.LEDGE_HOME = dir; panes.clear();
    mkdirSync(join(dir, 'roles'), { recursive: true }); writeFileSync(join(dir, 'roles', 'leader.md'), '---\nlabel: Lead\n---\nTu es leader.\n');
  });
  afterEach(async () => { await srv?.close(); srv = null; rmSync(dir, { recursive: true, force: true }); });

  it('launching a team broadcasts teams.engine running: true, once; the team changes that follow broadcast no second one', async () => {
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }),
      claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
    const got: ServerMessage[] = [];
    ws.on('message', d => { try { got.push(parseServerMessage(JSON.parse(String(d)))); } catch { /* not ours */ } });
    await new Promise(r => ws.once('open', r));
    await until(() => got.some(m => m.type === 'teams.engine'));
    const from = got.length;
    ws.send(JSON.stringify({ type: 'team.launch', rid: 'l', cwd: dir, name: 'api', seats: [{ role: 'leader' }] }));
    await until(() => got.some(m => m.type === 'team.launched'));
    await sleep(150);
    const after = got.slice(from);
    expect(after.filter(m => m.type === 'team.updated').length).toBeGreaterThan(1);
    expect(after.filter(m => m.type === 'teams.engine')).toEqual([{ type: 'teams.engine', engine: 'ledge', openrigAvailable: false, running: true }]);
    ws.terminate();
  });
});
