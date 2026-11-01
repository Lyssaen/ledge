import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type Escalation, type Exchange, type Machine, type Machines, type OpenRigStatus, type Projects, type Rig, type ServerMessage } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '@ledge/fleet';
import { createRigAggregate } from '../src/daemon/openrig/aggregate.js';
import type { Bridge, BridgeMessage } from '../src/daemon/openrig/bridge.js';
import type { RemoteMessage, RemotePeers } from '../src/daemon/openrig/remote.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge } from '../src/daemon/openrig/bridge.js';
import { writeMachines } from '../src/daemon/machines.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const T = '2026-10-30T08:00:00.000Z';
const LOCAL: Machine = { id: 'local', label: 'PC' };
const EC2: Machine = { id: 'ec2', label: 'ec2-build', ssh: 'ec2-build' };
const none: Projects = { projects: [], rules: [] };
const rig = (id: string, machine: string, extra: Partial<Rig> = {}): Rig => ({ id, name: id, machine, cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: false,
  seats: [{ ref: `dev@${id}`, address: '@dev', name: 'dev', runtime: 'claude-code', state: 'ready' }], repos: [], ...extra });
const esc = (id: string, machine: string): Escalation => ({ id, source: 'rig', machine, from: 'dev@r', intent: 'decision', summary: 'Which?', questions: [], createdAt: T, state: 'pending' });
const exch = (machine: string): Exchange => ({ id: 'x1', machine, rigId: 'r2', from: '@dev', to: '@qa', kind: 'message', text: 'hi', at: T });

function fakeBridge() {
  const fns = new Set<(m: BridgeMessage) => void>();
  const st = { status: { machine: 'local', state: 'running' } as OpenRigStatus, rigs: [rig('r1', 'local')], escalations: [esc('L1', 'local')] };
  const bridge = {
    status: () => st.status, rigs: () => st.rigs, escalations: () => st.escalations, escalation: (id: string) => st.escalations.find(e => e.id === id),
    replay: (): BridgeMessage[] => [{ type: 'openrig.status', status: st.status }, { type: 'rig.snapshot', machine: 'local', rigs: st.rigs },
      ...st.escalations.map((escalation): BridgeMessage => ({ type: 'escalation.updated', escalation }))],
    onMessage: (fn: (m: BridgeMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; }
  } as unknown as Bridge;
  return { bridge, st, emit: (m: BridgeMessage) => fns.forEach(f => f(m)) };
}

function fakeRemote() {
  const msgFns = new Set<(machine: string, m: RemoteMessage) => void>(), stFns = new Set<(machine: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => void>();
  const statuses = new Map<string, 'open' | 'connecting' | 'unreachable' | 'unsupported'>(); const versions = new Map<string, string>();
  const remote: RemotePeers = {
    setMachines() {}, status: m => statuses.get(m) ?? 'unreachable', version: m => versions.get(m), send: () => true, close() {},
    onMessage(fn) { msgFns.add(fn); return () => { msgFns.delete(fn); }; },
    onStatus(fn) { stFns.add(fn); return () => { stFns.delete(fn); }; }
  };
  return {
    remote, versions,
    msg: (machine: string, m: RemoteMessage) => msgFns.forEach(f => f(machine, m)),
    status: (machine: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => { if (s !== 'removed') statuses.set(machine, s); else statuses.delete(machine); stFns.forEach(f => f(machine, s)); }
  };
}

function setup(projects: Projects = none) {
  const b = fakeBridge(), r = fakeRemote();
  const machines: Machines = [LOCAL, EC2];
  const agg = createRigAggregate({ bridge: b.bridge, remote: r.remote, machines: () => machines, projects: () => projects, settleMs: 20 });
  const out: BridgeMessage[] = []; agg.onMessage(m => out.push(m));
  /** The peer comes back: open, then its daemon's replay (status, rigs, escalations). */
  const ec2Replay = (rigs: Rig[], escs: Escalation[] = []) => {
    r.status('ec2', 'open');
    r.msg('ec2', { type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
    r.msg('ec2', { type: 'rig.snapshot', machine: 'ec2', rigs });
    for (const e of escs) r.msg('ec2', { type: 'escalation.updated', escalation: e });
  };
  return { ...b, ...r, agg, out, ec2Replay };
}
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

describe('RigAggregate', () => {
  it('replays one status and one rig.snapshot per machine, then the escalations', () => {
    const s = setup();
    s.ec2Replay([rig('r2', 'ec2')], [esc('E1', 'ec2')]);
    const rp = s.agg.replay();
    expect(rp.map(m => m.type)).toEqual(['openrig.status', 'openrig.status', 'rig.snapshot', 'rig.snapshot', 'escalation.updated', 'escalation.updated']);
    expect(rp.filter(m => m.type === 'rig.snapshot').map(m => (m as { machine: string }).machine)).toEqual(['local', 'ec2']);
    expect(s.agg.rigs().map(r => [r.machine, r.id])).toEqual([['local', 'r1'], ['ec2', 'r2']]);
    expect(s.agg.statuses().map(x => x.machine)).toEqual(['local', 'ec2']);
    expect(s.agg.escalation('E1')?.machine).toBe('ec2');
    expect(s.agg.escalation('L1')?.machine).toBe('local');
  });

  it('remembers collisions between local and remote, and between remote machines', () => {
    const s = setup();
    s.msg('ec2', { type: 'escalation.updated', escalation: esc('L1', 'ec2') });
    expect(s.agg.escalationAmbiguous('L1')).toBe(true);
    s.msg('ec2', { type: 'escalation.updated', escalation: esc('same', 'ec2') });
    expect(s.agg.escalationAmbiguous('same')).toBe(false);
    s.msg('other', { type: 'escalation.updated', escalation: esc('same', 'other') });
    expect(s.agg.escalationAmbiguous('same')).toBe(true);
    // The previous owner was replaced inside the aggregate, but the collision must still fail closed.
    s.msg('other', { type: 'escalation.removed', id: 'same' });
    expect(s.agg.escalationAmbiguous('same')).toBe(true);
    s.msg('ec2', { type: 'escalation.updated', escalation: esc('reused', 'ec2') });
    s.msg('ec2', { type: 'escalation.removed', id: 'reused' });
    s.msg('other', { type: 'escalation.updated', escalation: esc('reused', 'other') });
    expect(s.agg.escalationAmbiguous('reused')).toBe(true);
  });

  it('refuses to assert uniqueness while a peer replay is incomplete', async () => {
    const s = setup(); let synced = 0; s.agg.onSynced(() => { synced += 1; }); s.status('ec2', 'open');
    expect(s.agg.escalationAmbiguous('L1')).toBe(true);
    s.msg('ec2', { type: 'rig.snapshot', machine: 'ec2', rigs: [] });
    await sleep(40);
    expect(s.agg.escalationAmbiguous('L1')).toBe(false); expect(synced).toBe(1);
  });

  it('ends the replay gate if a peer disconnects during its replay', () => {
    const s = setup(); let synced = 0; s.agg.onSynced(() => { synced += 1; });
    s.status('ec2', 'open'); expect(s.agg.escalationAmbiguous('L1')).toBe(true);
    s.status('ec2', 'unreachable'); expect(s.agg.escalationAmbiguous('L1')).toBe(false); expect(synced).toBe(1);
  });

  it('passes the local bridge through and the peer messages on', () => {
    const s = setup();
    s.emit({ type: 'rig.updated', rig: rig('r1', 'local', { lifecycle: 'partial' }) });
    s.ec2Replay([rig('r2', 'ec2')]);
    s.msg('ec2', { type: 'rig.exchange', exchange: exch('ec2') });
    expect(s.out.map(m => m.type)).toEqual(['rig.updated', 'openrig.status', 'rig.snapshot', 'rig.exchange']);
    expect(s.out[2]).toMatchObject({ type: 'rig.snapshot', machine: 'ec2', rigs: [{ id: 'r2', machine: 'ec2' }] });
  });

  it('an unreachable peer: status unreachable, its rigs kept as unreachable, its escalations kept', () => {
    const s = setup();
    s.ec2Replay([rig('r2', 'ec2')], [esc('E1', 'ec2')]);
    s.out.length = 0;
    s.status('ec2', 'unreachable');
    expect(s.out).toContainEqual({ type: 'openrig.status', status: { machine: 'ec2', state: 'unreachable' } });
    expect(s.out.find(m => m.type === 'rig.updated')).toMatchObject({ rig: { id: 'r2', machine: 'ec2', lifecycle: 'unreachable' } });
    expect(s.agg.escalations().map(e => e.id)).toContain('E1');
    expect(s.agg.rigs().find(r => r.id === 'r2')?.lifecycle).toBe('unreachable');
    expect(s.agg.statuses().find(x => x.machine === 'ec2')?.state).toBe('unreachable');
  });

  it('a peer coming back: the rigs and escalations its replay no longer cites are removed', async () => {
    const s = setup();
    s.ec2Replay([rig('r2', 'ec2')], [esc('E1', 'ec2'), esc('E2', 'ec2')]);
    s.status('ec2', 'unreachable');
    s.out.length = 0;
    s.ec2Replay([], [esc('E2', 'ec2')]);
    expect(s.out).toContainEqual({ type: 'rig.removed', machine: 'ec2', rigId: 'r2' });
    await sleep(60);
    expect(s.out).toContainEqual({ type: 'escalation.removed', id: 'E1' });
    expect(s.out).not.toContainEqual({ type: 'escalation.removed', id: 'E2' });
    expect(s.agg.escalations().map(e => e.id)).toEqual(['L1', 'E2']);
  });

  it('ends the escalation resync at the next message that is not one, before the timer', () => {
    const s = setup();
    s.ec2Replay([rig('r2', 'ec2')], [esc('E1', 'ec2')]);
    s.ec2Replay([rig('r2', 'ec2')]);
    s.msg('ec2', { type: 'rig.updated', rig: rig('r2', 'ec2') });
    expect(s.out).toContainEqual({ type: 'escalation.removed', id: 'E1' });
  });

  it('a live rig.snapshot of the peer (OpenRig reconnect) does not drop its escalations', async () => {
    const s = setup();
    s.ec2Replay([rig('r2', 'ec2')], [esc('E1', 'ec2')]);
    await sleep(60);
    s.msg('ec2', { type: 'rig.snapshot', machine: 'ec2', rigs: [rig('r2', 'ec2')] });
    await sleep(60);
    expect(s.agg.escalation('E1')).toBeDefined();
  });

  it('a removed peer takes its rigs, escalations and status away', () => {
    const s = setup();
    s.ec2Replay([rig('r2', 'ec2')], [esc('E1', 'ec2')]);
    s.out.length = 0;
    s.status('ec2', 'removed');
    expect(s.out).toEqual([{ type: 'rig.removed', machine: 'ec2', rigId: 'r2' }, { type: 'escalation.removed', id: 'E1' }]);
    expect(s.agg.statuses().map(x => x.machine)).toEqual(['local']);
    expect(s.agg.rigs().map(r => r.id)).toEqual(['r1']);
  });

  it('a peer without OpenRig is unsupported, with the update hint naming its version', () => {
    const s = setup();
    s.versions.set('ec2', '0.12.0');
    s.status('ec2', 'unsupported');
    expect(s.out).toContainEqual({ type: 'openrig.status', status: { machine: 'ec2', state: 'unsupported', detail: 'Ledge 0.12.0 sur ec2-build ne connaît pas OpenRig : mets-le à jour' } });
  });

  it('the update hint without a version', () => {
    const s = setup();
    s.status('ec2', 'unsupported');
    expect(s.out).toContainEqual({ type: 'openrig.status', status: { machine: 'ec2', state: 'unsupported', detail: 'Ledge sur ec2-build ne connaît pas OpenRig : mets-le à jour' } });
  });

  it('a slow replay (open long before the rig.snapshot) removes no escalation', async () => {
    const s = setup();
    s.ec2Replay([rig('r2', 'ec2')], [esc('E1', 'ec2')]);
    s.agg.overlay('E1', { state: 'answered' });
    await sleep(60);
    s.out.length = 0;
    s.status('ec2', 'unreachable');
    s.status('ec2', 'open');
    await sleep(80); // machines, projects, asks… of the peer's snapshot, slowly, over SSH
    expect(s.out.some(m => m.type === 'escalation.removed')).toBe(false);
    s.msg('ec2', { type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
    s.msg('ec2', { type: 'rig.snapshot', machine: 'ec2', rigs: [rig('r2', 'ec2')] });
    s.msg('ec2', { type: 'escalation.updated', escalation: esc('E1', 'ec2') });
    await sleep(60);
    expect(s.out.some(m => m.type === 'escalation.removed')).toBe(false);
    expect(s.agg.escalation('E1')?.state).toBe('answered');
  });

  it('keeps an overlay over a resync removal: the answer queue owns it', async () => {
    const s = setup();
    s.ec2Replay([], [esc('E1', 'ec2')]);
    s.agg.overlay('E1', { state: 'answered' });
    s.ec2Replay([]);
    await sleep(60);
    expect(s.agg.escalation('E1')).toBeUndefined();
    s.ec2Replay([], [esc('E1', 'ec2')]);
    expect(s.agg.escalation('E1')?.state).toBe('answered');
  });

  it('refresh files the remote rigs again in the projects as they are now', () => {
    let projects = none;
    const b = fakeBridge(), r = fakeRemote();
    const agg = createRigAggregate({ bridge: b.bridge, remote: r.remote, machines: () => [LOCAL, EC2], projects: () => projects, settleMs: 20 });
    const out: BridgeMessage[] = []; agg.onMessage(m => out.push(m));
    r.status('ec2', 'open');
    r.msg('ec2', { type: 'rig.snapshot', machine: 'ec2', rigs: [rig('r2', 'ec2', { cwd: '/home/ubuntu/app' })] });
    expect(agg.rigs().find(x => x.id === 'r2')?.projectId).toBeNull();
    projects = { projects: [{ id: 'app', name: 'App', color: 'red', description: '', repos: [], rigs: [] }], rules: [{ machine: 'ec2', path: '/home/ubuntu/app', project: 'app' }] } as unknown as Projects;
    out.length = 0;
    agg.refresh();
    expect(out).toEqual([{ type: 'rig.snapshot', machine: 'ec2', rigs: [rig('r2', 'ec2', { cwd: '/home/ubuntu/app', projectId: 'app' })] }]);
  });

  it('recomputes a remote rig projectId from the local projects', () => {
    const projects = { projects: [{ id: 'app', name: 'App', color: 'red', description: '', repos: [], rigs: [] }], rules: [{ machine: 'ec2', path: '/home/ubuntu/app', project: 'app' }] } as unknown as Projects;
    const s = setup(projects);
    s.ec2Replay([rig('r2', 'ec2', { cwd: '/home/ubuntu/app/sub' }), rig('r3', 'ec2', { cwd: '/srv/other', projectId: 'stale' })]);
    s.msg('ec2', { type: 'rig.updated', rig: rig('r4', 'ec2', { cwd: '/home/ubuntu/app' }) });
    const byId = new Map(s.agg.rigs().map(r => [r.id, r.projectId]));
    expect(byId.get('r2')).toBe('app'); expect(byId.get('r3')).toBeNull(); expect(byId.get('r4')).toBe('app');
    expect(s.out.find(m => m.type === 'rig.updated')).toMatchObject({ rig: { id: 'r4', projectId: 'app' } });
  });

  it('files a remote rig listed in a project\'s rigs there, whatever its folder', () => {
    const projects = { projects: [{ id: 'app', name: 'App', color: 'red', description: '', repos: [], rigs: ['r2'] }], rules: [] } as unknown as Projects;
    const s = setup(projects);
    s.ec2Replay([rig('r2', 'ec2', { cwd: '/srv/elsewhere' })]);
    s.msg('ec2', { type: 'rig.updated', rig: rig('r2', 'ec2', { cwd: '' }) });
    expect(s.agg.rigs().find(r => r.id === 'r2')?.projectId).toBe('app');
    expect(s.out.find(m => m.type === 'rig.snapshot' && m.machine === 'ec2')).toMatchObject({ rigs: [{ id: 'r2', projectId: 'app' }] });
    expect(s.out.find(m => m.type === 'rig.updated')).toMatchObject({ rig: { id: 'r2', projectId: 'app' } });
  });

  it('a peer removes only its own escalations', () => {
    const s = setup();
    s.ec2Replay([], [esc('E1', 'ec2')]);
    s.out.length = 0;
    s.msg('ec2', { type: 'escalation.removed', id: 'L1' });
    expect(s.out).toEqual([]);
    s.msg('ec2', { type: 'escalation.removed', id: 'E1' });
    expect(s.out).toEqual([{ type: 'escalation.removed', id: 'E1' }]);
    expect(s.agg.escalation('E1')).toBeUndefined();
  });

  it('overlays a local state on a remote escalation, and takes it off', () => {
    const s = setup();
    s.ec2Replay([], [esc('E1', 'ec2')]);
    s.out.length = 0;
    const answer = { by: 'user' as const, answers: { q: 'yes' }, at: T, delivery: 'queued' as const };
    s.agg.overlay('E1', { state: 'answered', answer });
    expect(s.out).toEqual([{ type: 'escalation.updated', escalation: { ...esc('E1', 'ec2'), state: 'answered', answer } }]);
    expect(s.agg.escalation('E1')?.answer?.delivery).toBe('queued');
    // The peer's own updates stay overlaid until the overlay is taken off.
    s.msg('ec2', { type: 'escalation.updated', escalation: { ...esc('E1', 'ec2'), summary: 'Which one?' } });
    expect(s.agg.escalation('E1')).toMatchObject({ summary: 'Which one?', state: 'answered' });
    expect(s.agg.replay().find(m => m.type === 'escalation.updated' && m.escalation.id === 'E1')).toMatchObject({ escalation: { state: 'answered' } });
    s.agg.overlay('E1', null);
    expect(s.out.at(-1)).toEqual({ type: 'escalation.updated', escalation: { ...esc('E1', 'ec2'), summary: 'Which one?' } });
    expect(s.agg.escalation('E1')?.state).toBe('pending');
  });

  it('keeps the last rig.exchanges of a remote rig; local ones are the bridge\'s', () => {
    const s = setup();
    s.ec2Replay([rig('r2', 'ec2')]);
    expect(s.agg.exchanges('ec2', 'r2')).toBeNull();
    s.msg('ec2', { type: 'rig.exchanges', machine: 'ec2', rigId: 'r2', items: [exch('ec2')] });
    expect(s.agg.exchanges('ec2', 'r2')).toEqual([exch('ec2')]);
    expect(s.out.some(m => (m.type as string) === 'rig.exchanges')).toBe(false);
  });
});

// ---- Against startServer: the daemon replays and broadcasts the aggregate.

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });

function fakePeerClient() {
  let onMsg = (_: ServerMessage) => {}, onSt = (_: DaemonStatus) => {}, status: DaemonStatus = 'connecting';
  const o = { closed: 0, urls: [] as string[] };
  const client: DaemonClient = {
    connect() {}, close() { o.closed++; }, send() {}, status: () => status,
    onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; }
  };
  return { o, client, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}

let srv: ServerHandle | null = null; let bridgeS: Bridge | null = null; let fake: FakeOpenRig | null = null; const dirs: string[] = [];
afterEach(async () => { await bridgeS?.stop(); bridgeS = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('server with the rig aggregate', () => {
  it('announces openrigFleet, replays both machines after the snapshot and broadcasts remote changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-openrig-agg-')); dirs.push(dir); process.env.LEDGE_HOME = dir;
    const machinesFile = join(dir, 'machines.json'); writeMachines([LOCAL, EC2], machinesFile);
    const store = new Store();
    fake = await createFakeOpenRig(); fake.rigs.push(starter());
    let server: ServerHandle | null = null;
    const bridge = bridgeS = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => none, home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => server!.asks.all(), onChange: f => server!.asks.onChange(f) }, sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    const peer = fakePeerClient(); const urls: string[] = [];
    server = srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, machinesFile, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }),
      openrig: bridge, remoteConnect: (_m, url) => { urls.push(url); return peer.client; } });
    await bridge.start();
    await until(() => bridge.status().state === 'running' && bridge.rigs().length === 1);
    expect(urls).toEqual([`ws://127.0.0.1:${server.port}/ssh/ec2-build`]);
    peer.set('open');
    peer.emit({ type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, openrig: true } } as ServerMessage);
    peer.emit({ type: 'openrig.status', status: { machine: 'local', state: 'running' } });
    peer.emit({ type: 'rig.snapshot', machine: 'local', rigs: [rig('r9', 'local')] });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { headers: authHeaders() });
    const msgs: ServerMessage[] = [];
    ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    await until(() => msgs.some(m => m.type === 'ledge.thread.history'));
    const snap = msgs.find(m => m.type === 'snapshot') as Extract<ServerMessage, { type: 'snapshot' }>;
    expect(snap.daemon?.openrigFleet).toBe(true);
    const snaps = msgs.filter((m): m is Extract<ServerMessage, { type: 'rig.snapshot' }> => m.type === 'rig.snapshot');
    expect(snaps.map(m => [m.machine, m.rigs.map(r => r.machine)])).toEqual([['local', ['local']], ['ec2', ['ec2']]]);
    expect(msgs.findIndex(m => m.type === 'snapshot')).toBeLessThan(msgs.findIndex(m => m.type === 'rig.snapshot'));

    // A remote change reaches the client; the machine leaving machines.json takes its rig away.
    peer.emit({ type: 'rig.updated', rig: rig('r9', 'local', { lifecycle: 'partial', cwd: '/home/ubuntu/app' }) });
    await until(() => msgs.some(m => m.type === 'rig.updated' && m.rig.id === 'r9' && m.rig.machine === 'ec2'));

    // A remote escalation is one item of Ledge's thread, even sent again.
    peer.emit({ type: 'escalation.updated', escalation: esc('RE1', 'local') });
    peer.emit({ type: 'escalation.updated', escalation: { ...esc('RE1', 'local'), summary: 'Which one?' } });
    await until(() => msgs.filter(m => m.type === 'escalation.updated' && m.escalation.id === 'RE1').length === 2);
    const items = () => msgs.filter(m => m.type === 'ledge.thread.item' && m.item.kind === 'escalation' && m.item.escalationId === 'RE1');
    await until(() => items().length === 1);
    await new Promise(r => setTimeout(r, 50));
    expect(items()).toHaveLength(1);

    // New projects file the remote rig live.
    ws.send(JSON.stringify({ type: 'projects.set', projects: { projects: [{ id: 'app', name: 'App', color: 'red', description: '', repos: [], rigs: [] }], rules: [{ machine: 'ec2', path: '/home/ubuntu/app', project: 'app' }] } }));
    await until(() => msgs.some(m => m.type === 'rig.snapshot' && m.machine === 'ec2' && m.rigs.some(r => r.id === 'r9' && r.projectId === 'app')));

    ws.send(JSON.stringify({ type: 'machines.set', machines: [LOCAL] }));
    await until(() => msgs.some(m => m.type === 'rig.removed' && m.machine === 'ec2' && m.rigId === 'r9'));
    expect(peer.o.closed).toBe(1);
    // Local bridge messages are broadcast once (through the aggregate, not twice).
    const localUpdates = () => msgs.filter(m => m.type === 'rig.updated' && m.rig.machine === 'local').length;
    const before = localUpdates();
    bridge.refresh();
    await until(() => localUpdates() > before);
    await new Promise(r => setTimeout(r, 50));
    expect(localUpdates()).toBe(before + 1);
    await new Promise<void>(r => { ws.once('close', () => r()); ws.close(); });
  });
});
