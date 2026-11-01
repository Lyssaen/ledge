import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Escalation, type Machine, type OpenRigStatus, type RigPlan, type ServerMessage } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '@ledge/fleet';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { writeMachines } from '../src/daemon/machines.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';
import type { RigAggregate } from '../src/daemon/openrig/aggregate.js';
import type { AnswerQueue, QueuedAnswer } from '../src/daemon/openrig/answerQueue.js';
import type { RemoteMessage, RemotePeers, PeerStatus } from '../src/daemon/openrig/remote.js';
import { createRigRouter, isRigCommand, machineOf, type RigCommand } from '../src/daemon/openrig/router.js';

const T = '2026-10-30T08:00:00.000Z';
const esc = (id: string, machine: string): Escalation => ({ id, source: 'rig', machine, from: 'dev@r', intent: 'decision', summary: 'Which?', questions: [], createdAt: T, state: 'pending' });
const plan = (id: string, machine: string): RigPlan => ({ id, machine, spec: 'duo', goal: 'g', where: { kind: 'off-project', name: 'x' }, cwd: '/w', command: 'rig up', writes: [], seats: [], required: false } as unknown as RigPlan);

function setup(opts: { status?: PeerStatus; statuses?: OpenRigStatus[]; version?: string } = {}) {
  const sent: Array<{ machine: string; msg: ClientMessage }> = [];
  const msgFns = new Set<(machine: string, m: RemoteMessage) => void>();
  const stFns = new Set<(machine: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => void>();
  const peerStatus = new Map<string, PeerStatus>([['ec2', opts.status ?? 'open']]);
  const remote: RemotePeers = {
    setMachines() {}, close() {},
    status: m => peerStatus.get(m) ?? 'unreachable', version: m => (m === 'ec2' ? opts.version : undefined),
    send(machine, msg) { if (peerStatus.get(machine) !== 'open') return false; sent.push({ machine, msg }); return true; },
    onMessage(fn) { msgFns.add(fn); return () => { msgFns.delete(fn); }; },
    onStatus(fn) { stFns.add(fn); return () => { stFns.delete(fn); }; }
  };
  const escs = [esc('L1', 'local'), esc('E1', 'ec2')];
  const statuses = opts.statuses ?? [{ machine: 'local', state: 'running' }, { machine: 'ec2', state: 'running' }];
  const aggregate = {
    escalation: (id: string) => escs.find(e => e.id === id),
    statuses: () => statuses
  } as unknown as RigAggregate;
  const enqueued: QueuedAnswer[] = [];
  const answers: AnswerQueue = {
    enqueue(a, reply) { enqueued.push(a); reply({ type: 'rig.result', rid: a.rid, ok: true }); },
    pending: () => enqueued, flush() {}, settle() {}, drop() {}
  };
  const localCalls: RigCommand[] = [];
  let localReply: ((msg: RigCommand) => ServerMessage | null) = msg => ('rid' in msg ? { type: 'rig.result', rid: msg.rid, ok: true } : null);
  const router = createRigRouter({ aggregate, remote, answers, labelOf: id => (id === 'ec2' ? 'ec2-build' : id),
    local: async (msg, reply) => { localCalls.push(msg); const r = localReply(msg); if (r) reply(r); } });
  const client = () => { const got: ServerMessage[] = []; return { got, reply: (m: ServerMessage) => { got.push(m); } }; };
  return {
    router, sent, enqueued, localCalls, client,
    setLocalReply: (f: typeof localReply) => { localReply = f; },
    peer: (m: RemoteMessage) => msgFns.forEach(f => f('ec2', m)),
    peerStatus: (s: 'open' | 'unreachable' | 'unsupported' | 'removed') => { if (s === 'removed') peerStatus.delete('ec2'); else peerStatus.set('ec2', s); stFns.forEach(f => f('ec2', s)); }
  };
}

describe('rig router', () => {
  it('relays a remote rig.act with machine local and gives its rig.result to the sole requester', async () => {
    const s = setup(); const a = s.client(), b = s.client();
    await s.router.route({ type: 'rig.act', rid: 'r1', machine: 'ec2', rigId: 'rig1', verb: 'down' }, a.reply);
    expect(s.sent).toEqual([{ machine: 'ec2', msg: { type: 'rig.act', rid: 'r1', machine: 'local', rigId: 'rig1', verb: 'down' } }]);
    expect(a.got).toEqual([]);
    s.peer({ type: 'rig.result', rid: 'other', ok: true });
    s.peer({ type: 'rig.result', rid: 'r1', ok: true });
    expect(a.got).toEqual([{ type: 'rig.result', rid: 'r1', ok: true }]);
    expect(b.got).toEqual([]);
    s.peer({ type: 'rig.result', rid: 'r1', ok: true }); // a late duplicate goes nowhere
    expect(a.got).toHaveLength(1);
    expect(s.localCalls).toEqual([]);
  });

  it('keeps every requester of a resent rid while it is pending, and sends it once', async () => {
    const s = setup(); const a = s.client(), b = s.client();
    await s.router.route({ type: 'rig.send', rid: 'r1', machine: 'ec2', seatRef: 'dev@x', text: 'hi' }, a.reply);
    await s.router.route({ type: 'rig.send', rid: 'r1', machine: 'ec2', seatRef: 'dev@x', text: 'hi' }, b.reply);
    expect(s.sent).toHaveLength(1);
    s.peer({ type: 'rig.result', rid: 'r1', ok: true });
    expect(a.got).toEqual([{ type: 'rig.result', rid: 'r1', ok: true }]);
    expect(b.got).toEqual([{ type: 'rig.result', rid: 'r1', ok: true }]);
  });

  it('a remote rig.prepare gets its rig.plan with the real machine, and the rig.launch that follows goes to that machine', async () => {
    const s = setup(); const a = s.client();
    await s.router.route({ type: 'rig.prepare', rid: 'p1', machine: 'ec2', spec: 'duo', goal: 'g', where: { kind: 'off-project', name: 'x' } }, a.reply);
    expect(s.sent[0]).toMatchObject({ machine: 'ec2', msg: { type: 'rig.prepare', rid: 'p1', machine: 'local' } });
    s.peer({ type: 'rig.plan', rid: 'p1', plan: plan('plan-1', 'ec2') });
    expect(a.got).toHaveLength(1);
    expect(a.got[0]).toMatchObject({ type: 'rig.plan', rid: 'p1', plan: { id: 'plan-1', machine: 'ec2' } });
    await s.router.route({ type: 'rig.launch', rid: 'l1', planId: 'plan-1' }, a.reply);
    expect(s.sent[1]).toEqual({ machine: 'ec2', msg: { type: 'rig.launch', rid: 'l1', planId: 'plan-1' } });
    expect(s.localCalls).toEqual([]);
  });

  it('a local plan launches locally', async () => {
    const s = setup(); const a = s.client();
    s.setLocalReply(msg => (msg.type === 'rig.prepare' ? { type: 'rig.plan', rid: msg.rid, plan: plan('plan-L', 'local') } : 'rid' in msg ? { type: 'rig.result', rid: msg.rid, ok: true } : null));
    await s.router.route({ type: 'rig.prepare', rid: 'p1', machine: 'local', spec: 'duo', goal: 'g', where: { kind: 'off-project', name: 'x' } }, a.reply);
    await s.router.route({ type: 'rig.launch', rid: 'l1', planId: 'plan-L' }, a.reply);
    expect(s.localCalls.map(m => m.type)).toEqual(['rig.prepare', 'rig.launch']);
    expect(s.sent).toEqual([]);
  });

  it('refuses an order to an unreachable machine at once and queues an answer', async () => {
    const s = setup({ status: 'unreachable' }); const a = s.client();
    await s.router.route({ type: 'rig.act', rid: 'r1', machine: 'ec2', rigId: 'rig1', verb: 'down' }, a.reply);
    expect(a.got).toEqual([{ type: 'rig.result', rid: 'r1', ok: false, code: 'unreachable', reason: 'ec2-build est injoignable' }]);
    expect(s.sent).toEqual([]);
    await s.router.route({ type: 'escalation.answer', rid: 'r2', id: 'E1', answers: { q1: 'a' }, by: 'user' }, a.reply);
    expect(s.enqueued).toHaveLength(1);
    expect(s.enqueued[0]).toMatchObject({ rid: 'r2', machine: 'ec2', id: 'E1', answers: { q1: 'a' }, by: 'user' });
    expect(a.got[1]).toEqual({ type: 'rig.result', rid: 'r2', ok: true });
    expect(s.sent).toEqual([]);
  });

  it('relays an answer to an open machine unchanged', async () => {
    const s = setup(); const a = s.client();
    await s.router.route({ type: 'escalation.answer', rid: 'r2', id: 'E1', answers: { q1: 'a' }, by: 'user' }, a.reply);
    expect(s.sent).toEqual([{ machine: 'ec2', msg: { type: 'escalation.answer', rid: 'r2', id: 'E1', answers: { q1: 'a' }, by: 'user' } }]);
    expect(s.enqueued).toEqual([]);
  });

  it('refuses an order to a machine whose Ledge does not know OpenRig', async () => {
    const s = setup({ status: 'unsupported' }); const a = s.client();
    await s.router.route({ type: 'rig.send', rid: 'r1', machine: 'ec2', seatRef: 'dev@x', text: 'hi' }, a.reply);
    expect(a.got).toEqual([expect.objectContaining({ type: 'rig.result', rid: 'r1', ok: false, code: 'unsupported' })]);
    expect(s.sent).toEqual([]);
  });

  it('the unsupported refusals name the peer\'s Ledge version when it gave one', async () => {
    for (const [version, text] of [['0.20.0', 'Ledge 0.20.0 sur ec2-build ne connaît pas OpenRig : mets-le à jour'], [undefined, 'Ledge sur ec2-build ne connaît pas OpenRig : mets-le à jour']] as const) {
      const s = setup({ status: 'unsupported', ...(version ? { version } : {}) }); const a = s.client();
      await s.router.route({ type: 'rig.send', rid: 'r1', machine: 'ec2', seatRef: 'dev@x', text: 'hi' }, a.reply);
      await s.router.route({ type: 'rig.exchanges.request', machine: 'ec2', rigId: 'rig1' }, a.reply);
      expect(a.got).toEqual([{ type: 'rig.result', rid: 'r1', ok: false, code: 'unsupported', reason: text },
        { type: 'error', message: text, request: 'rig.exchanges.request', code: 'unsupported' }]);
    }
  });

  it('refuses rig.prepare on a machine without OpenRig, with the install command', async () => {
    const s = setup({ statuses: [{ machine: 'local', state: 'running' }, { machine: 'ec2', state: 'absent', install: 'npm install -g @openrig/cli@0.6.14 && rig setup' }] }); const a = s.client();
    await s.router.route({ type: 'rig.prepare', rid: 'p1', machine: 'ec2', spec: 'duo', goal: 'g', where: { kind: 'off-project', name: 'x' } }, a.reply);
    expect(a.got).toHaveLength(1);
    const r = a.got[0] as Extract<ServerMessage, { type: 'rig.result' }>;
    expect(r).toMatchObject({ type: 'rig.result', rid: 'p1', ok: false, code: 'openrig_down' });
    expect(r.reason).toContain("OpenRig n'est pas installé sur ec2-build");
    expect(r.reason).toContain('npm install -g @openrig/cli');
    expect(s.sent).toEqual([]);
  });

  it('sends a local command to the local handlers only', async () => {
    const s = setup(); const a = s.client();
    await s.router.route({ type: 'rig.act', rid: 'r1', machine: 'local', rigId: 'rig1', verb: 'up' }, a.reply);
    await s.router.route({ type: 'escalation.answer', rid: 'r2', id: 'L1', answers: { q1: 'a' }, by: 'user' }, a.reply);
    expect(s.localCalls.map(m => m.type)).toEqual(['rig.act', 'escalation.answer']);
    expect(s.sent).toEqual([]);
    expect(a.got).toEqual([{ type: 'rig.result', rid: 'r1', ok: true }, { type: 'rig.result', rid: 'r2', ok: true }]);
  });

  it('an answer to an escalation no machine lists, and a plan no peer made, go to the local handlers (their rid memo, their refusals)', async () => {
    const s = setup(); const a = s.client();
    s.setLocalReply(msg => ('rid' in msg ? { type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: 'aucune escalade nope' } : null));
    await s.router.route({ type: 'escalation.answer', rid: 'r1', id: 'nope', answers: {}, by: 'user' }, a.reply);
    expect(a.got).toEqual([expect.objectContaining({ type: 'rig.result', rid: 'r1', ok: false, code: 'failed' })]);
    expect(s.localCalls.map(m => m.type)).toEqual(['escalation.answer']);
    await s.router.route({ type: 'rig.launch', rid: 'r2', planId: 'nope' }, a.reply);
    expect(s.localCalls.map(m => m.type)).toEqual(['escalation.answer', 'rig.launch']);
    expect(s.sent).toEqual([]);
  });

  it('gives the peer rig.exchanges to every requester of that rig', async () => {
    const s = setup(); const a = s.client(), b = s.client();
    await s.router.route({ type: 'rig.exchanges.request', machine: 'ec2', rigId: 'rig1' }, a.reply);
    await s.router.route({ type: 'rig.exchanges.request', machine: 'ec2', rigId: 'rig1' }, b.reply);
    expect(s.sent.map(x => x.msg)).toEqual([{ type: 'rig.exchanges.request', machine: 'local', rigId: 'rig1' }, { type: 'rig.exchanges.request', machine: 'local', rigId: 'rig1' }]);
    s.peer({ type: 'rig.exchanges', machine: 'ec2', rigId: 'other', items: [] });
    expect(a.got).toEqual([]);
    s.peer({ type: 'rig.exchanges', machine: 'ec2', rigId: 'rig1', items: [] });
    expect(a.got).toEqual([{ type: 'rig.exchanges', machine: 'ec2', rigId: 'rig1', items: [] }]);
    expect(b.got).toEqual(a.got);
    s.peer({ type: 'rig.exchanges', machine: 'ec2', rigId: 'rig1', items: [] });
    expect(a.got).toHaveLength(1);
  });

  it('answers the pending requests of a machine that becomes unreachable', async () => {
    const s = setup(); const a = s.client(), b = s.client();
    await s.router.route({ type: 'rig.act', rid: 'r1', machine: 'ec2', rigId: 'rig1', verb: 'down' }, a.reply);
    await s.router.route({ type: 'rig.exchanges.request', machine: 'ec2', rigId: 'rig1' }, b.reply);
    s.peerStatus('unreachable');
    expect(a.got).toEqual([{ type: 'rig.result', rid: 'r1', ok: false, code: 'unreachable', reason: 'ec2-build est injoignable' }]);
    expect(b.got).toEqual([expect.objectContaining({ type: 'error', request: 'rig.exchanges.request', code: 'unreachable' })]);
    s.peerStatus('open');
    s.peer({ type: 'rig.result', rid: 'r1', ok: true }); // dropped: no second answer
    expect(a.got).toHaveLength(1);
  });

  it('an answer relayed but not acknowledged when the link drops goes to the queue, same rid, marked sent; its requesters get the queue\'s ok', async () => {
    const s = setup(); const a = s.client(), b = s.client();
    await s.router.route({ type: 'escalation.answer', rid: 'r2', id: 'E1', answers: { q1: 'a' }, by: 'user' }, a.reply);
    await s.router.route({ type: 'escalation.answer', rid: 'r2', id: 'E1', answers: { q1: 'a' }, by: 'user' }, b.reply);
    expect(s.sent).toHaveLength(1);
    s.peerStatus('unreachable');
    expect(s.enqueued).toEqual([{ rid: 'r2', machine: 'ec2', id: 'E1', answers: { q1: 'a' }, by: 'user', at: expect.any(String), sentAt: expect.any(String) }]);
    expect(a.got).toEqual([{ type: 'rig.result', rid: 'r2', ok: true }]);
    expect(b.got).toEqual(a.got);
    s.peerStatus('open');
    s.peer({ type: 'rig.result', rid: 'r2', ok: true }); // the queue's now: no second answer from the router
    expect(a.got).toHaveLength(1);
  });

  it('knows which messages it routes and which machine they go to', () => {
    expect(isRigCommand({ type: 'rig.act', rid: 'r', machine: 'ec2', verb: 'up' })).toBe(true);
    expect(isRigCommand({ type: 'rig.adopt', rid: 'r', machine: 'ec2', rigId: 'x', projectId: 'p' })).toBe(false);
    const aggregate = { escalation: (id: string) => (id === 'E1' ? esc('E1', 'ec2') : undefined) } as unknown as RigAggregate;
    const plans = new Map([['plan-1', 'ec2']]);
    expect(machineOf({ type: 'rig.send', rid: 'r', machine: 'ec2', seatRef: 's', text: 't' }, { aggregate, plans })).toBe('ec2');
    expect(machineOf({ type: 'rig.launch', rid: 'r', planId: 'plan-1' }, { aggregate, plans })).toBe('ec2');
    expect(machineOf({ type: 'rig.launch', rid: 'r', planId: 'x' }, { aggregate, plans })).toBeNull();
    expect(machineOf({ type: 'escalation.answer', rid: 'r', id: 'E1', answers: {}, by: 'user' }, { aggregate, plans })).toBe('ec2');
    expect(machineOf({ type: 'escalation.answer', rid: 'r', id: 'x', answers: {}, by: 'user' }, { aggregate, plans })).toBeNull();
  });
});

// ---- Against startServer: a remote command reaches the peer, its result only the requester.

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
let srv: ServerHandle | null = null; let bridgeS: Bridge | null = null; let fake: FakeOpenRig | null = null; const dirs: string[] = [];
afterEach(async () => { await bridgeS?.stop(); bridgeS = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('server with the rig router', () => {
  it('relays a remote rig.act to its peer and gives the peer rig.result to the requester only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-openrig-router-')); dirs.push(dir); process.env.LEDGE_HOME = dir;
    const machinesFile = join(dir, 'machines.json');
    writeMachines([{ id: 'local', label: 'PC' }, { id: 'ec2', label: 'ec2-build', ssh: 'ec2-build' } satisfies Machine], machinesFile);
    const store = new Store();
    fake = await createFakeOpenRig();
    let server: ServerHandle | null = null;
    const bridge = bridgeS = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => ({ projects: [], rules: [] }), home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => server!.asks.all(), onChange: f => server!.asks.onChange(f) }, sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    let onMsg = (_: ServerMessage) => {}, onSt = (_: DaemonStatus) => {}, status: DaemonStatus = 'connecting';
    const toPeer: ClientMessage[] = [];
    const client: DaemonClient = { connect() {}, close() {}, send(m) { toPeer.push(m); }, status: () => status,
      onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
    server = srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, machinesFile, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }),
      openrig: bridge, remoteConnect: () => client });
    await bridge.start();
    status = 'open'; onSt('open');
    onMsg({ type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, openrig: true } } as ServerMessage);
    onMsg({ type: 'openrig.status', status: { machine: 'local', state: 'running' } });

    const open = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${server!.port}`, { headers: authHeaders() });
      const msgs: ServerMessage[] = [];
      ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
      await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
      await until(() => msgs.some(m => m.type === 'ledge.thread.history'));
      return { ws, msgs };
    };
    const a = await open(), b = await open();
    a.ws.send(JSON.stringify({ type: 'rig.act', rid: 'r1', machine: 'ec2', rigId: 'rig1', verb: 'down' }));
    await until(() => toPeer.length === 1);
    expect(toPeer[0]).toEqual({ type: 'rig.act', rid: 'r1', machine: 'local', rigId: 'rig1', verb: 'down' });
    onMsg({ type: 'rig.result', rid: 'r1', ok: true });
    await until(() => a.msgs.some(m => m.type === 'rig.result' && m.rid === 'r1'));
    await new Promise(r => setTimeout(r, 50));
    expect(a.msgs.filter(m => m.type === 'rig.result')).toEqual([{ type: 'rig.result', rid: 'r1', ok: true }]);
    expect(b.msgs.some(m => m.type === 'rig.result')).toBe(false);
    for (const c of [a, b]) await new Promise<void>(r => { c.ws.once('close', () => r()); c.ws.close(); });
  });
});
