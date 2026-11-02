import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Machine, type OpenRigStatus, type Rig, type ServerMessage, type Session, type Team } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '@ledge/fleet';
import { openrigAvailable } from '../src/daemon/engine/setting.js';
import { writeTeamsEngine } from '../src/daemon/engine/setting.js';
import { createRemotePeers } from '../src/daemon/openrig/remote.js';
import { writeMachines } from '../src/daemon/machines.js';
import { writeBrainSettings } from '../src/daemon/brain/settings.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { teamsJournal } from '../src/daemon/teamsLive.js';
import { sessionKey } from '../src/auth.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { paths } from '../src/paths.js';
import { authHeaders, until } from './helpers.js';
import { PhoneServerMessageSchema } from '@ledge/protocol';
import { createMobileService } from '../src/mobile/service.js';
import { writeMobileConfig, writeRelaySession } from '../src/mobile/files.js';
import { startTestRelay, TEST_ACCOUNT } from './mobile-relay-harness.js';
import { fakeDevice } from './mobile-fake-device.js';

// Lot D final review: one engine for every machine (I1), one read path (I2), no stale rig pairing (I3), the graces released (M2)
// and the round trip Ledge → OpenRig → Ledge seen by one client (M5).

const T = '2026-11-02T10:00:00.000Z';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const st = (state: OpenRigStatus['state'], machine = 'local'): OpenRigStatus => ({ machine, state });

describe('openrigAvailable (M3)', () => {
  it('counts only a machine where OpenRig is: not an unreachable machine, nor a Ledge that does not know OpenRig', () => {
    expect(openrigAvailable([st('absent'), st('unreachable', 'ec2'), st('unsupported', 'mac')])).toBe(false);
    expect(openrigAvailable([st('unreachable', 'ec2')])).toBe(false);
    expect(openrigAvailable([st('unsupported', 'ec2')])).toBe(false);
    for (const s of ['running', 'stopped', 'starting', 'error'] as const) expect(openrigAvailable([st('absent'), st(s, 'ec2')]), s).toBe(true);
  });
});

/** A peer's daemon as the remote peers see it: its socket, what it sends, what it is sent. */
function fakePeer() {
  let onMsg = (_: ServerMessage) => {}, onSt = (_: DaemonStatus) => {}, status: DaemonStatus = 'connecting';
  const sent: ClientMessage[] = [];
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m); }, status: () => status,
    onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  const sets = () => sent.filter((m): m is Extract<ClientMessage, { type: 'teams.engine.set' }> => m.type === 'teams.engine.set');
  return {
    client, sent, sets,
    /** Its socket opens and its daemon says hello: the snapshot, then (a daemon of this lot) its engine. */
    hello(engine?: 'ledge' | 'openrig') {
      status = 'open'; onSt('open');
      onMsg({ type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.34.0', install: 'npm', systemd: true, openrig: true } } as ServerMessage);
      onMsg({ type: 'openrig.status', status: { machine: 'local', state: 'running' } });
      if (engine) onMsg({ type: 'teams.engine', engine, openrigAvailable: true, running: false });
    },
    emit: (m: ServerMessage) => onMsg(m)
  };
}

describe('the remote peers know each peer\'s engine (I1)', () => {
  const EC2: Machine = { id: 'ec2', label: 'ec2-build', ssh: 'ec2-build' };
  it('a peer that says its engine is asked to switch and answers; an older one is never asked', async () => {
    const p = fakePeer();
    const peers = createRemotePeers({ port: 1, connect: () => p.client });
    const told: Array<[string, string, boolean]> = [];
    peers.onTeamsEngine!((m, e, first) => told.push([m, e, first]));
    peers.setMachines([{ id: 'local', label: 'PC' }, EC2]);
    p.hello();
    expect(peers.teamsEngine!('ec2')).toBeUndefined();
    expect(await peers.setTeamsEngine!('ec2', 'openrig')).toMatchObject({ ok: false });
    expect(p.sets()).toEqual([]);
    p.emit({ type: 'teams.engine', engine: 'ledge', openrigAvailable: true, running: false });
    p.emit({ type: 'teams.engine', engine: 'ledge', openrigAvailable: true, running: true });
    expect(told).toEqual([['ec2', 'ledge', true], ['ec2', 'ledge', false]]);
    expect(peers.teamsEngine!('ec2')).toBe('ledge');
    const answer = peers.setTeamsEngine!('ec2', 'openrig');
    const [set] = p.sets();
    expect(set).toMatchObject({ type: 'teams.engine.set', engine: 'openrig' });
    p.emit({ type: 'teams.engine.result', rid: set!.rid, ok: false, reason: 'une équipe Ledge tourne' });
    expect(await answer).toEqual({ ok: false, reason: 'une équipe Ledge tourne' });
    // A new connection says its engine anew: the first one again.
    p.hello('openrig');
    expect(told.at(-1)).toEqual(['ec2', 'openrig', true]);
    peers.close();
  });
});

const panes = new Set<string>();
const noTmux: Tmux = { async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
  async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n] };
const FAKE_CLAUDE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
/** OpenRig's own rig, stopped: a switch either way is allowed. */
const factory = (): FakeRig => ({ rigId: 'r1', name: 'factory', status: 'stopped', nodes: [] });
const restingTeam: Team = { id: 'team-abcd', name: 'api', project: null, machine: 'local', cwd: '/w', state: 'resting', seats: [{ role: 'leader', sessionId: null }], createdAt: T, updatedAt: T, restingAt: T };
const mkS = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w', project: 'w', title: `${name} · w`, tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, source: 'launcher', ...extra });

describe('the daemon, lot D final review', () => {
  let dir: string; let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null; let store: Store;
  const sockets: WebSocket[] = [];
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-final-')); process.env.LEDGE_HOME = dir; panes.clear(); });
  afterEach(async () => { for (const s of sockets.splice(0)) s.terminate(); await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; rmSync(dir, { recursive: true, force: true }); });

  async function boot(o: { engine?: 'ledge' | 'openrig'; rigs?: FakeRig[]; teams?: Team[]; peer?: ReturnType<typeof fakePeer>; sessions?: Session[]; env?: Record<string, string>; brain?: boolean } = {}) {
    if (o.engine) writeTeamsEngine(paths().teamsEngine, o.engine);
    const machinesFile = join(dir, 'machines.json');
    writeMachines([{ id: 'local', label: 'PC' }, ...(o.peer ? [{ id: 'ec2', label: 'ec2-build', ssh: 'ec2-build' } satisfies Machine] : [])], machinesFile);
    if (o.brain) await writeBrainSettings(paths().brainSettings, { enabled: true, tool: 'claude' });
    fake = await createFakeOpenRig(); fake.humans.push('ledge'); for (const r of o.rigs ?? []) fake.rigs.push(r);
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as never, home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    if (o.teams) writeFileSync(paths().teams, JSON.stringify(o.teams));
    store = new Store(); for (const s of o.sessions ?? []) store.upsert(s);
    srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, machinesFile, daemon: { version: '0.0.0', install: 'git', systemd: false },
      agentEnv: async () => ({ ...process.env, ...o.env }), claudeBin: [process.execPath, FAKE_CLAUDE],
      ...(o.teams ? { teams: teamsJournal(paths().teams) } : {}), openrig: bridge, ...(o.peer ? { remoteConnect: () => o.peer!.client } : {}) });
    await bridge.start(); await until(() => bridge!.status().state === 'running');
    return client();
  }
  async function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${srv!.port}`, { headers: authHeaders() }); sockets.push(ws);
    const got: ServerMessage[] = [];
    ws.on('message', d => { try { got.push(parseServerMessage(JSON.parse(String(d)))); } catch { /* not ours */ } });
    await new Promise(r => ws.once('open', r));
    await until(() => got.some(m => m.type === 'ledge.thread.history'));
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    const answer = async <K extends ServerMessage['type']>(type: K, pred: (m: Extract<ServerMessage, { type: K }>) => boolean = () => true, ms = 3000) => {
      await until(() => got.some(m => m.type === type && pred(m as never)), ms);
      return got.find(m => m.type === type && pred(m as never)) as Extract<ServerMessage, { type: K }>;
    };
    return { got, send, answer, ws };
  }
  /** What a client shows of the rigs, every machine's, from the frames it got: rig ids by machine. */
  const view = (got: ServerMessage[], upTo = got.length) => {
    const shown = new Map<string, Map<string, Rig>>();
    const of = (machine: string) => { let m = shown.get(machine); if (!m) shown.set(machine, m = new Map()); return m; };
    for (const m of got.slice(0, upTo)) {
      if (m.type === 'rig.snapshot') shown.set(m.machine, new Map(m.rigs.map(r => [r.id, r])));
      if (m.type === 'rig.updated') of(m.rig.machine).set(m.rig.id, m.rig);
      if (m.type === 'rig.removed') of(m.machine).delete(m.rigId);
    }
    return [...shown.values()].flatMap(m => [...m.values()]);
  };

  describe('one engine for every machine (I1)', () => {
    it('a switch is passed on to a peer that knows the engine; its refusal comes back in peers', async () => {
      const peer = fakePeer();
      const c = await boot({ peer });
      peer.hello('ledge');
      c.send({ type: 'teams.engine.set', rid: 's1', engine: 'openrig' });
      await until(() => peer.sets().length === 1);
      expect(peer.sets()[0]).toMatchObject({ engine: 'openrig' });
      peer.emit({ type: 'teams.engine.result', rid: peer.sets()[0]!.rid, ok: false, reason: 'une équipe Ledge tourne : mets-la au repos ou dissous-la avant de changer de moteur' });
      expect(await c.answer('teams.engine.result', m => m.rid === 's1')).toEqual({ type: 'teams.engine.result', rid: 's1', ok: true,
        peers: [{ machine: 'ec2', ok: false, reason: 'une équipe Ledge tourne : mets-la au repos ou dissous-la avant de changer de moteur' }] });
      expect(readFileSync(paths().teamsEngine, 'utf8')).toContain('openrig');
    });

    it('a peer that takes it answers ok; one already on that engine is not asked', async () => {
      const peer = fakePeer();
      const c = await boot({ peer });
      peer.hello('ledge');
      c.send({ type: 'teams.engine.set', rid: 's1', engine: 'openrig' });
      await until(() => peer.sets().length === 1);
      peer.emit({ type: 'teams.engine.result', rid: peer.sets()[0]!.rid, ok: true });
      peer.emit({ type: 'teams.engine', engine: 'openrig', openrigAvailable: true, running: false });
      expect((await c.answer('teams.engine.result', m => m.rid === 's1')).peers).toEqual([{ machine: 'ec2', ok: true }]);
      c.send({ type: 'teams.engine.set', rid: 's2', engine: 'openrig' });
      expect(await c.answer('teams.engine.result', m => m.rid === 's2')).toEqual({ type: 'teams.engine.result', rid: 's2', ok: true });
      expect(peer.sets()).toHaveLength(1);
    });

    it('an older peer (no teams.engine) is left as it is', async () => {
      const peer = fakePeer();
      const c = await boot({ peer });
      peer.hello();
      c.send({ type: 'teams.engine.set', rid: 's1', engine: 'openrig' });
      expect(await c.answer('teams.engine.result', m => m.rid === 's1')).toEqual({ type: 'teams.engine.result', rid: 's1', ok: true });
      await sleep(50);
      expect(peer.sets()).toEqual([]);
    });

    it('a peer that connects later on another engine is given the local one, once', async () => {
      const peer = fakePeer();
      await boot({ peer });
      peer.hello('openrig');
      await until(() => peer.sets().length === 1);
      expect(peer.sets()[0]).toMatchObject({ engine: 'ledge' });
      peer.emit({ type: 'teams.engine.result', rid: peer.sets()[0]!.rid, ok: false, reason: 'un rig OpenRig tourne' });
      peer.emit({ type: 'teams.engine', engine: 'openrig', openrigAvailable: true, running: true });
      await sleep(50);
      expect(peer.sets()).toHaveLength(1);
    });

    it('an unreachable or old peer does not make OpenRig available (M3)', async () => {
      const peer = fakePeer();
      fake = null;
      const machinesFile = join(dir, 'machines.json');
      writeMachines([{ id: 'local', label: 'PC' }, { id: 'ec2', label: 'ec2-build', ssh: 'ec2-build' }], machinesFile);
      // OpenRig absent here: a bridge whose CLI is missing.
      bridge = createBridge({ env: async () => ({ OPENRIG_PORT: '1' }), exec: (async () => ({ code: 127, stdout: '', stderr: 'rig: not found' })) as never, projects: () => ({ version: 1, projects: [], rules: [] }) as never,
        home: dir, file: join(dir, 'openrig.json'), asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 50 });
      srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, machinesFile, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }), openrig: bridge, remoteConnect: () => peer.client });
      await bridge.start(); await until(() => bridge!.status().state === 'absent');
      // The peer is a Ledge that does not know OpenRig: unsupported.
      peer.client.status = () => 'open';
      peer.emit({ type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.20.0', install: 'npm', systemd: true } } as ServerMessage);
      const c = await client();
      await c.answer('openrig.status', m => m.status.machine === 'ec2' && m.status.state === 'unsupported').catch(() => null);
      c.send({ type: 'teams.engine.set', rid: 's1', engine: 'openrig' });
      expect(await c.answer('teams.engine.result', m => m.rid === 's1')).toMatchObject({ ok: false, reason: expect.stringContaining("n'est installé sur aucune machine") });
      expect(c.got.filter(m => m.type === 'teams.engine').at(-1)).toMatchObject({ openrigAvailable: false });
    });
  });

  describe('one read path (I2)', () => {
    it('the brain\'s rigs listing follows the engine: Ledge\'s teams, then OpenRig\'s rigs', async () => {
      const c = await boot({ rigs: [factory()], teams: [restingTeam], sessions: [mkS('brain', 'Ledge', { brain: true })] });
      await noTmux.newSession({ name: 'ledge-brain' } as never);
      let n = 0;
      const rigs = async () => {
        const rid = `b${++n}`;
        c.send({ type: 'brain.cmd', rid, by: 'brain', key: sessionKey('brain') ?? '', op: 'rigs', args: [] });
        return (await c.answer('brain.result', m => m.rid === rid, 5000)).line;
      };
      const ledge = await rigs();
      expect(ledge).toContain('api'); expect(ledge).not.toContain('factory');
      c.send({ type: 'teams.engine.set', rid: 's', engine: 'openrig' });
      expect((await c.answer('teams.engine.result')).ok).toBe(true);
      await until(() => bridge!.rigs().length === 1);
      const openrig = await rigs();
      expect(openrig).toContain('factory'); expect(openrig).not.toContain('api');
    });

    it('the chat\'s rigs.md follows the engine', async () => {
      // The fake agent answers with the rigs.md it was given.
      const c = await boot({ rigs: [factory()], teams: [restingTeam], env: { FAKE_CLAUDE_MODE: 'rigs' } });
      c.send({ type: 'chat.ask', qid: 'q1', text: 'les équipes ?' });
      const ledge = (await c.answer('chat.done', m => m.qid === 'q1', 10_000)).text;
      expect(ledge).toContain('- api ·'); expect(ledge).not.toContain('factory');
      c.send({ type: 'teams.engine.set', rid: 's', engine: 'openrig' });
      expect((await c.answer('teams.engine.result')).ok).toBe(true);
      await until(() => bridge!.rigs().length === 1);
      c.send({ type: 'chat.ask', qid: 'q2', text: 'et maintenant ?' });
      const openrig = (await c.answer('chat.done', m => m.qid === 'q2', 10_000)).text;
      expect(openrig).toContain('- factory ·'); expect(openrig).not.toContain('- api ·');
    }, 20_000);
  });

  describe('no stale rig pairing (I3)', () => {
    const paired = mkS('s1', 'Nova', { rig: { machine: 'local', rigId: 'r1', rigName: 'factory', seat: 'dev-build@factory', pod: 'dev', member: 'build' } });
    it('a session paired to a rig loses `rig` on the switch to Ledge, and can be ended', async () => {
      const c = await boot({ engine: 'openrig', rigs: [factory()], sessions: [paired] });
      await noTmux.newSession({ name: 'ledge-s1' } as never);
      await until(() => bridge!.rigs().length === 1);
      expect(store.get('s1')!.rig).toBeDefined();
      c.send({ type: 'session.kill', id: 's1' });
      expect(await c.answer('error', m => m.request === 'session.kill')).toMatchObject({ code: 'rig_managed' });
      c.send({ type: 'teams.engine.set', rid: 's', engine: 'ledge' });
      expect((await c.answer('teams.engine.result')).ok).toBe(true);
      expect(store.get('s1')).not.toHaveProperty('rig');
      await c.answer('session.updated', m => m.session.id === 's1' && m.session.rig === undefined);
      c.send({ type: 'session.kill', id: 's1' });
      await until(() => store.get('s1')!.state === 'exited');
    });

    it('a daemon that starts under Ledge drops every `rig` kept from before', async () => {
      await boot({ engine: 'ledge', sessions: [paired] });
      expect(store.get('s1')).not.toHaveProperty('rig');
    });
  });

  it('M2: the switch to Ledge gives the brain\'s graces back to pending before OpenRig\'s escalations leave', async () => {
    const c = await boot({ engine: 'openrig', rigs: [factory()], brain: true });
    await until(() => store.get('brain')?.state === 'starting', 5000);
    store.upsert({ ...store.get('brain')!, state: 'idle' });
    await c.answer('brain.status', m => m.status.state === 'on', 5000);
    fake!.pushEscalation({ qitemId: 'E9', humanIntent: 'decision', humanQuestions: [{ id: 'q', question: 'Branche ?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] });
    await until(() => bridge!.escalation('E9')?.state === 'grace', 5000);
    const from = c.got.length;
    c.send({ type: 'teams.engine.set', rid: 's', engine: 'ledge' });
    expect((await c.answer('teams.engine.result')).ok).toBe(true);
    const after = c.got.slice(from);
    const pending = after.findIndex(m => m.type === 'escalation.updated' && m.escalation.id === 'E9' && m.escalation.state === 'pending' && !m.escalation.graceUntil);
    const removed = after.findIndex(m => m.type === 'escalation.removed' && m.id === 'E9');
    expect(pending).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(pending);
  }, 20_000);

  it('M5: Ledge → OpenRig → Ledge, one client throughout: each time exactly that engine\'s rigs, never both; a late client sees the same', async () => {
    const c = await boot({ rigs: [factory()], teams: [restingTeam] });
    const ids = (upTo?: number) => view(c.got, upTo).map(r => r.id).sort();
    const neverBoth = () => { for (let i = 1; i <= c.got.length; i++) { const v = ids(i); expect(v.includes('team-abcd') && v.includes('r1'), `frame ${i}`).toBe(false); } };
    await until(() => ids().join() === 'team-abcd');
    c.send({ type: 'teams.engine.set', rid: 'a', engine: 'openrig' });
    expect((await c.answer('teams.engine.result', m => m.rid === 'a')).ok).toBe(true);
    await until(() => ids().join() === 'r1');
    const late = await client();
    await until(() => view(late.got).map(r => r.id).join() === 'r1');
    c.send({ type: 'teams.engine.set', rid: 'b', engine: 'ledge' });
    expect((await c.answer('teams.engine.result', m => m.rid === 'b')).ok).toBe(true);
    await until(() => ids().join() === 'team-abcd');
    await sleep(150); // OpenRig's probe turns: nothing of it comes back
    expect(ids()).toEqual(['team-abcd']);
    neverBoth();
    await until(() => view(late.got).map(r => r.id).join() === 'team-abcd');
    const last = await client();
    expect(view(last.got).map(r => r.id)).toEqual(['team-abcd']);
  }, 20_000);
});

// The phone reads the teams through the same path (I2, M4): a device linked over the real relay to the real daemon.
describe('the phone follows the engine (I2, M4)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-final-phone-')); process.env.LEDGE_HOME = dir; panes.clear(); });
  afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); rmSync(dir, { recursive: true, force: true }); });

  it('sees Ledge\'s teams under Ledge, OpenRig\'s rigs under OpenRig, never the other engine\'s', async () => {
    const relay = await startTestRelay(); cleanups.push(() => relay.relay.close());
    writeMobileConfig({ enabled: true, relayUrl: relay.url });
    writeRelaySession({ token: relay.pcToken, accountId: TEST_ACCOUNT, login: 'octocat', relayUrl: relay.url });
    const mobile = await createMobileService(); cleanups.push(() => mobile.stop());
    await until(() => mobile.state().link.state === 'online', 6000);
    const fake = await createFakeOpenRig(); cleanups.push(() => fake.stop()); fake.rigs.push(factory());
    let srv: ServerHandle | null = null;
    const bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake.port) }), exec: fakeRigCli(fake), projects: () => ({ version: 1, projects: [], rules: [] }) as never, home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: () => undefined, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    writeFileSync(paths().teams, JSON.stringify([restingTeam]));
    srv = await startServer({ store: new Store(), tmux: noTmux, port: 0, home: dir, mobile, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }),
      teams: teamsJournal(paths().teams), openrig: bridge });
    cleanups.push(async () => { await bridge.stop(); await srv!.close(); });
    await bridge.start(); await until(() => bridge.status().state === 'running');
    const PEER = 'd_cccccccccccccccc';
    const phone = await fakeDevice({ relayUrl: relay.url, token: relay.deviceToken(PEER), peer: PEER, label: 'Pixel 8' }); cleanups.push(() => phone.close());
    const { result } = await phone.pair();
    await until(() => mobile.state().pairings[0]?.state === 'confirm', 6000);
    await mobile.handle({ type: 'mobile.pairing.approve', id: mobile.state().pairings[0]!.id });
    expect(await result).toBe('ok');
    await phone.hello();
    await until(() => mobile.state().devices[0]?.online === true, 6000);
    const snapshots = () => phone.received.map(t => PhoneServerMessageSchema.parse(JSON.parse(t))).flatMap(m => (m.type === 'snapshot' ? [m] : []));
    const lastRigs = async () => {
      const n = snapshots().length;
      await phone.send(JSON.stringify({ type: 'snapshot.request' }));
      await until(() => snapshots().length > n, 6000);
      return (snapshots().at(-1)!.rigs ?? []).map(r => r.name);
    };
    expect(await lastRigs()).toEqual(['api']);
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() }); cleanups.push(() => ws.terminate());
    const got: ServerMessage[] = []; ws.on('message', d => got.push(parseServerMessage(JSON.parse(String(d)))));
    await new Promise(r => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'teams.engine.set', rid: 's', engine: 'openrig' }));
    await until(() => got.some(m => m.type === 'teams.engine.result'));
    await until(() => bridge.rigs().length === 1);
    expect(await lastRigs()).toEqual(['factory']);
  }, 30_000);
});
