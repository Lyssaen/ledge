import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Escalation, type Machine, type Projects, type ServerMessage } from '@ledge/protocol';
import { createDaemonClient, type DaemonClient } from '@ledge/fleet/client';
import { createTokenSource } from '@ledge/fleet/token';
import { readDaemonToken } from '../src/auth.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { createCursorWriter, readOpenRigFile } from '../src/daemon/openrig/cursor.js';
import { createAnswerQueue, type QueuedAnswer } from '../src/daemon/openrig/answerQueue.js';
import type { RigAggregate } from '../src/daemon/openrig/aggregate.js';
import type { PeerStatus, RemoteMessage, RemotePeers } from '../src/daemon/openrig/remote.js';
import { writeMachines } from '../src/daemon/machines.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig, type FakeRigCli } from './fakes/openrig.js';
import { until } from './helpers.js';

const T = '2026-10-30T08:00:00.000Z';
const dirs: string[] = [];
const tmp = (p = 'ledge-answer-queue-') => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const esc = (id: string, machine = 'local'): Escalation => ({ id, source: 'rig', machine, from: 'dev@r', intent: 'decision', summary: `question ${id}`, questions: [], createdAt: T, state: 'pending' });
const ok = (rid: string): Extract<ServerMessage, { type: 'rig.result' }> => ({ type: 'rig.result', rid, ok: true });

// ---- The queue against a fake peer and a fake aggregate.

function setup(file: string, opts: { settleMs?: number } = {}) {
  const sent: ClientMessage[] = [];
  const msgFns = new Set<(machine: string, m: RemoteMessage) => void>();
  const stFns = new Set<(machine: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => void>();
  let status: PeerStatus = 'unreachable';
  const remote: RemotePeers = {
    setMachines() {}, close() {}, version: () => undefined,
    status: m => (m === 'ec2' ? status : 'unreachable'),
    send(machine, msg) { if (machine !== 'ec2' || status !== 'open') return false; sent.push(msg); return true; },
    onMessage(fn) { msgFns.add(fn); return () => { msgFns.delete(fn); }; },
    onStatus(fn) { stFns.add(fn); return () => { stFns.delete(fn); }; }
  };
  const overlays: Array<[string, Partial<Escalation> | null]> = [];
  const known = new Map<string, Escalation>([['E1', esc('E1', 'ec2')], ['E2', esc('E2', 'ec2')]]);
  const aggregate = { escalation: (id: string) => known.get(id), overlay: (id: string, p: Partial<Escalation> | null) => { overlays.push([id, p]); } } as unknown as RigAggregate;
  const notices: string[] = [];
  const queue = createAnswerQueue({ remote, aggregate, file, notice: t => { notices.push(t); }, now: () => T, labelOf: id => (id === 'ec2' ? 'EC2' : id), settleMs: opts.settleMs ?? 20 });
  const peer = (m: RemoteMessage) => msgFns.forEach(f => f('ec2', m));
  const peerStatus = (s: 'open' | 'unreachable' | 'unsupported' | 'removed') => { status = s === 'removed' ? 'unreachable' : s; stFns.forEach(f => f('ec2', s)); };
  /** The peer opens and replays: its OpenRig status, its rigs, then its escalations. */
  const replay = (state: 'running' | 'stopped', ids: string[]) => {
    peerStatus('open');
    peer({ type: 'openrig.status', status: { machine: 'ec2', state } });
    peer({ type: 'rig.snapshot', machine: 'ec2', rigs: [] });
    for (const id of ids) peer({ type: 'escalation.updated', escalation: esc(id, 'ec2') });
  };
  const replies: ServerMessage[] = [];
  const reply = (m: ServerMessage) => { replies.push(m); };
  const answer = (rid: string, id = 'E1'): QueuedAnswer => ({ rid, machine: 'ec2', id, answers: { q1: 'a' }, by: 'user', at: T });
  const answersSent = () => sent.filter(m => m.type === 'escalation.answer');
  return { queue, sent, answersSent, overlays, notices, peer, peerStatus, replay, replies, reply, answer };
}

afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('answer queue', () => {
  it('answers at once, overlays « queued » and keeps the answer in openrig.json across a restart of the local daemon', () => {
    const file = join(tmp(), 'openrig.json');
    const s = setup(file);
    s.queue.enqueue(s.answer('r1'), s.reply);
    expect(s.replies).toEqual([ok('r1')]);
    expect(s.overlays).toEqual([['E1', { state: 'answered', answer: { by: 'user', answers: { q1: 'a' }, at: T, delivery: 'queued' } }]]);
    expect(s.sent).toEqual([]);
    expect(readOpenRigFile(file).outbox).toEqual([s.answer('r1')]);

    // The same rid again: one entry; another rid for the same escalation: already answered.
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.queue.enqueue(s.answer('r9'), s.reply);
    expect(s.replies.slice(1)).toEqual([ok('r1'), expect.objectContaining({ type: 'rig.result', rid: 'r9', ok: false, code: 'already_answered' })]);
    expect(s.queue.pending()).toEqual([s.answer('r1')]);

    // The local daemon restarts: the queue is read back, its overlay laid again.
    const again = setup(file);
    expect(again.queue.pending('ec2')).toEqual([s.answer('r1')]);
    expect(again.queue.pending('nas')).toEqual([]);
    expect(again.overlays).toEqual([['E1', expect.objectContaining({ state: 'answered', answer: expect.objectContaining({ delivery: 'queued' }) })]]);
  });

  it('shares openrig.json with the cursor writer: neither drops the other one\'s part', async () => {
    const file = join(tmp(), 'openrig.json');
    const w = createCursorWriter({ file, now: () => 'NOW', minIntervalMs: 5 });
    w.set('local', { lastEventId: 3 }); w.setReplyRow('qi-1', 'row-1');
    const s = setup(file);
    s.queue.enqueue(s.answer('r1'), s.reply);
    await w.flush();
    expect(readOpenRigFile(file)).toEqual({ version: 1, machines: { local: { lastEventId: 3, rigs: [], at: 'NOW' } }, replyRows: { 'qi-1': 'row-1' }, outbox: [s.answer('r1')] });
    w.set('local', { lastEventId: 4 }); await w.flush();
    expect(readOpenRigFile(file).outbox).toEqual([s.answer('r1')]);
    s.queue.drop('ec2');
    expect(readOpenRigFile(file)).toEqual({ version: 1, machines: { local: { lastEventId: 4, rigs: [], at: 'NOW' } }, replyRows: { 'qi-1': 'row-1' } });
  });

  it('drops a malformed outbox entry when reading openrig.json', () => {
    const file = join(tmp(), 'openrig.json');
    const good = { rid: 'r1', machine: 'ec2', id: 'E1', answers: { q: 'a' }, by: 'user', at: T };
    writeFileSync(file, JSON.stringify({ version: 1, machines: {}, outbox: [good, { rid: 3 }, { ...good, rid: 'r2', by: 'robot' }] }));
    expect(readOpenRigFile(file).outbox).toEqual([good]);
  });

  it('sends once, same rid, when the returning peer lists the escalation; marks it sent; the peer\'s ok lifts the overlay', () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.peerStatus('open');
    expect(s.answersSent()).toEqual([]); // not before the peer said what it lists
    s.peer({ type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
    s.peer({ type: 'rig.snapshot', machine: 'ec2', rigs: [] });
    s.peer({ type: 'escalation.updated', escalation: esc('E1', 'ec2') });
    expect(s.answersSent()).toEqual([{ type: 'escalation.answer', rid: 'r1', id: 'E1', answers: { q1: 'a' }, by: 'user' }]);
    expect(s.overlays.at(-1)).toEqual(['E1', expect.objectContaining({ answer: expect.objectContaining({ delivery: 'sent' }) })]);
    expect(s.queue.pending()[0]!.sentAt).toBe(T);
    // Flushes again on the same connection (open, running, listing again): never a second send.
    s.queue.flush('ec2');
    s.peer({ type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
    s.peer({ type: 'escalation.updated', escalation: esc('E1', 'ec2') });
    expect(s.answersSent()).toHaveLength(1);
    // The peer's rig.result settles it (wired on remote.onMessage).
    s.peer(ok('r1'));
    expect(s.queue.pending()).toEqual([]);
    expect(s.overlays.at(-1)).toEqual(['E1', null]);
    expect(s.notices).toEqual([]);
  });

  it('lost ack: an answer sent before goes again with the same rid on the next connection, listed or not', async () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.replay('running', ['E1']);
    expect(s.answersSent().map(m => m.rid)).toEqual(['r1']);
    s.peerStatus('unreachable'); // cut before its rig.result
    expect(s.overlays.at(-1)).toEqual(['E1', expect.objectContaining({ answer: expect.objectContaining({ delivery: 'queued' }) })]);
    s.replay('running', []); // answered there: no longer listed
    await until(() => s.answersSent().length === 2, 1000);
    expect(s.answersSent().map(m => m.rid)).toEqual(['r1', 'r1']);
    s.peer(ok('r1')); // the peer's rid memo answers the resend as the first one
    expect(s.queue.pending()).toEqual([]);
    expect(s.notices).toEqual([]);
  });

  it('abandons an answer never sent whose escalation the returning peer no longer lists', async () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.queue.enqueue(s.answer('r2', 'E2'), s.reply);
    s.replay('running', ['E2']);
    await until(() => s.notices.length === 1, 1000);
    expect(s.notices).toEqual(["Ma réponse à question E1 n'est pas partie : la question a été fermée sur EC2"]);
    expect(s.queue.pending().map(a => a.rid)).toEqual(['r2']);
    expect(s.answersSent().map(m => m.rid)).toEqual(['r2']);
    expect(s.overlays).toContainEqual(['E1', null]);
  });

  it('judges nothing while the peer\'s OpenRig is not running; openrig_down keeps the answer for its next start', async () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.replay('stopped', []);
    await new Promise(r => setTimeout(r, 60));
    expect(s.notices).toEqual([]); expect(s.answersSent()).toEqual([]);
    expect(s.queue.pending()).toHaveLength(1);
    // OpenRig starts there: status, rigs, escalations, live.
    s.peer({ type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
    s.peer({ type: 'rig.snapshot', machine: 'ec2', rigs: [] });
    s.peer({ type: 'escalation.updated', escalation: esc('E1', 'ec2') });
    expect(s.answersSent().map(m => m.rid)).toEqual(['r1']);
    s.peer({ type: 'rig.result', rid: 'r1', ok: false, code: 'openrig_down', reason: "OpenRig n'est pas lancé" });
    expect(s.queue.pending()).toHaveLength(1);
    expect(s.overlays.at(-1)).toEqual(['E1', expect.objectContaining({ answer: expect.objectContaining({ delivery: 'queued' }) })]);
    s.peer({ type: 'openrig.status', status: { machine: 'ec2', state: 'running' } });
    s.peer({ type: 'rig.snapshot', machine: 'ec2', rigs: [] });
    s.peer({ type: 'escalation.updated', escalation: esc('E1', 'ec2') });
    expect(s.answersSent().map(m => m.rid)).toEqual(['r1', 'r1']);
  });

  it('settle: already_answered lifts it silently, another refusal lifts it with a notice, an unknown rid is ignored', () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.queue.enqueue(s.answer('r2', 'E2'), s.reply);
    s.queue.settle('ec2', { type: 'rig.result', rid: 'zz', ok: false, code: 'failed', reason: 'x' });
    s.queue.settle('nas', { type: 'rig.result', rid: 'r1', ok: true });
    expect(s.queue.pending()).toHaveLength(2);
    s.queue.settle('ec2', { type: 'rig.result', rid: 'r1', ok: false, code: 'already_answered', reason: 'déjà répondue' });
    s.queue.settle('ec2', { type: 'rig.result', rid: 'r2', ok: false, code: 'invalid', reason: 'réponse invalide' });
    expect(s.queue.pending()).toEqual([]);
    expect(s.notices).toEqual(["Ma réponse à question E2 n'est pas partie sur EC2 : réponse invalide"]);
    expect(s.overlays.slice(-2)).toEqual([['E1', null], ['E2', null]]);
  });

  it('Review Focus 4: a machine removed drops its answers with one notice', () => {
    const file = join(tmp(), 'openrig.json');
    const s = setup(file);
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.queue.enqueue(s.answer('r2', 'E2'), s.reply);
    s.peerStatus('removed'); // wired: drop('ec2')
    expect(s.queue.pending()).toEqual([]);
    expect(readOpenRigFile(file).outbox).toBeUndefined();
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toContain('EC2');
    s.queue.drop('ec2'); // nothing left: no second notice
    expect(s.notices).toHaveLength(1);
  });
});

// ---- Review Focus 1, end to end: a « remote » daemon over a fake OpenRig, a local daemon whose peer dials it directly.

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });
const humanRow = (id: string) => ({ qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: `question ${id}`, createdAt: '2026-10-30 10:00:00' });

interface Daemon { srv: ServerHandle; bridge: Bridge }
let running: Daemon[] = []; let fakes: FakeOpenRig[] = [];
afterEach(async () => {
  for (const d of running.splice(0)) { await d.bridge.stop(); await d.srv.close(); }
  for (const f of fakes.splice(0)) await f.stop();
});

/** A daemon in `home` (LEDGE_HOME while it starts: its thread, token and openrig.json live there). */
async function daemon(home: string, fake: FakeOpenRig, o: { port?: number; exec?: FakeRigCli; machinesFile?: string; remoteConnect?: (m: Machine, url: string) => DaemonClient; shift?: () => number } = {}): Promise<Daemon> {
  const was = process.env.LEDGE_HOME; process.env.LEDGE_HOME = home;
  try {
    const store = new Store(); let srv: ServerHandle | null = null;
    const now = () => new Date(Date.now() + (o.shift?.() ?? 0)).toISOString();
    const bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake.port) }), exec: o.exec ?? fakeRigCli(fake), projects: () => none, home, file: join(home, 'openrig.json'), now,
      asks: { all: () => srv!.asks.all(), onChange: f => srv!.asks.onChange(f) }, sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
    srv = await startServer({ store, tmux: noTmux, port: o.port ?? 0, home, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }),
      openrig: bridge, ...(o.machinesFile ? { machinesFile: o.machinesFile } : {}), ...(o.remoteConnect ? { remoteConnect: o.remoteConnect } : {}) });
    await bridge.start();
    const d = { srv, bridge }; running.push(d); return d;
  } finally { if (was === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = was; }
}
async function stopDaemon(d: Daemon) { running = running.filter(x => x !== d); await d.bridge.stop(); await d.srv.close(); }

describe('Review Focus 1: answers wait for an unreachable machine and go once', () => {
  it('answers wait for an unreachable machine and go once', async () => {
    const homeA = tmp('ledge-aq-remote-'), homeB = tmp('ledge-aq-local-');
    // The « remote » machine: its daemon over a fake OpenRig with one escalation E.
    const fakeA = await createFakeOpenRig(); fakes.push(fakeA);
    fakeA.rigs.push(starter()); fakeA.humans.push('ledge'); fakeA.queue.push(humanRow('E1'));
    const execA = fakeRigCli(fakeA);
    let shift = 0;
    let a = await daemon(homeA, fakeA, { exec: execA, shift: () => shift });
    const portA = a.srv.port;
    await until(() => a.bridge.escalations().some(e => e.id === 'E1'));
    // Both daemons share one token (the peer offers the local daemon's token to the remote one).
    copyFileSync(join(homeA, 'token'), join(homeB, 'token'));
    process.env.LEDGE_HOME = homeB;

    // The local daemon: its own (empty) OpenRig, machine ec2 dialled straight at the remote daemon (no SSH).
    const fakeB = await createFakeOpenRig(); fakes.push(fakeB);
    const machinesFile = join(homeB, 'machines.json');
    writeMachines([{ id: 'local', label: 'PC' }, { id: 'ec2', label: 'EC2', ssh: 'ec2' }], machinesFile);
    const toPeer: ClientMessage[] = []; let cutOn: string | null = null; let peerClient: DaemonClient | null = null;
    const token = createTokenSource(async () => { const t = readDaemonToken(); return t ? { kind: 'token', token: t } : { kind: 'absent' }; });
    const remoteConnect = (): DaemonClient => {
      const c = createDaemonClient({ url: `ws://127.0.0.1:${portA}`, WebSocketImpl: WebSocket as never, token, minBackoffMs: 30, maxBackoffMs: 150 });
      peerClient = c;
      return { ...c,
        send: m => { toPeer.push(m); c.send(m); },
        // The « lost ack »: the peer's rig.result for `cutOn` never arrives, the link drops and comes back.
        onMessage: fn => c.onMessage(m => { if (cutOn && m.type === 'rig.result' && m.rid === cutOn) { cutOn = null; c.connect(); return; } fn(m); }) };
    };
    const b = await daemon(homeB, fakeB, { machinesFile, remoteConnect });
    process.env.LEDGE_HOME = homeB;
    expect(peerClient).not.toBeNull();

    const ws = new WebSocket(`ws://127.0.0.1:${b.srv.port}`, { headers: { authorization: `Bearer ${readDaemonToken()}` } });
    const msgs: ServerMessage[] = [];
    ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const last = (id: string) => msgs.filter((m): m is Extract<ServerMessage, { type: 'escalation.updated' }> => m.type === 'escalation.updated' && m.escalation.id === id).at(-1)?.escalation;
    const delivered = () => execA.calls.filter(c => c.join(' ').includes('queue create')).length + fakeA.requests.filter(r => r.method === 'POST').length;
    const answersTo = (rid: string) => toPeer.filter(m => m.type === 'escalation.answer' && m.rid === rid).length;

    // 1. The local client sees E with its machine.
    await until(() => last('E1')?.machine === 'ec2', 8000);
    const e = last('E1')!;
    const answers = Object.fromEntries(e.questions.map(q => [q.id, q.options[0]!.id]));

    // 2. The remote daemon stops: ec2 unreachable, E still there.
    await stopDaemon(a);
    await until(() => msgs.some(m => m.type === 'openrig.status' && m.status.machine === 'ec2' && m.status.state === 'unreachable'), 8000);
    expect(msgs.some(m => m.type === 'escalation.removed' && m.id === 'E1')).toBe(false);

    // 3. The user answers meanwhile: accepted at once, « en attente d'envoi », nothing reaches OpenRig.
    const before = delivered();
    ws.send(JSON.stringify({ type: 'escalation.answer', rid: 'r1', id: 'E1', answers, by: 'user' }));
    await until(() => msgs.some(m => m.type === 'rig.result' && m.rid === 'r1'));
    expect(msgs.filter(m => m.type === 'rig.result' && m.rid === 'r1')).toEqual([ok('r1')]);
    await until(() => last('E1')?.answer?.delivery === 'queued');
    expect(readOpenRigFile(join(homeB, 'openrig.json')).outbox?.map(x => x.rid)).toEqual(['r1']);
    await new Promise(r => setTimeout(r, 100));
    expect(delivered()).toBe(before);
    expect(answersTo('r1')).toBe(0);

    // 4. The remote daemon comes back: the answer goes once, same rid; E shows it sent, then the peer's own answer.
    process.env.LEDGE_HOME = homeA;
    a = await daemon(homeA, fakeA, { exec: execA, port: portA, shift: () => shift });
    process.env.LEDGE_HOME = homeB;
    await until(() => msgs.some(m => m.type === 'escalation.updated' && m.escalation.id === 'E1' && m.escalation.answer?.delivery === 'sent'), 8000);
    await until(() => readOpenRigFile(join(homeB, 'openrig.json')).outbox === undefined, 8000);
    await until(() => last('E1')?.state === 'answered' && last('E1')?.answer?.delivery === undefined, 8000);
    expect(answersTo('r1')).toBe(1);
    expect(delivered() - before).toBe(1);

    // 5. Lost ack: a second escalation, answered while ec2 is down; the link drops right after the send, before its rig.result.
    fakeA.pushEscalation(humanRow('E2'));
    await until(() => last('E2')?.machine === 'ec2', 8000);
    await stopDaemon(a);
    await until(() => last('E1')?.state === 'answered' && msgs.filter(m => m.type === 'openrig.status' && m.status.machine === 'ec2' && m.status.state === 'unreachable').length === 2, 8000);
    const before2 = delivered();
    ws.send(JSON.stringify({ type: 'escalation.answer', rid: 'r2', id: 'E2', answers, by: 'user' }));
    await until(() => last('E2')?.answer?.delivery === 'queued');
    cutOn = 'r2';
    process.env.LEDGE_HOME = homeA;
    a = await daemon(homeA, fakeA, { exec: execA, port: portA, shift: () => shift });
    process.env.LEDGE_HOME = homeB;
    await until(() => answersTo('r2') === 2, 8000); // resent with the same rid after the link came back
    await until(() => readOpenRigFile(join(homeB, 'openrig.json')).outbox === undefined, 8000);
    expect(delivered() - before2).toBe(1); // OpenRig got one answer (the remote daemon's rid memo, Task 2)
    expect(answersTo('r1')).toBe(1);

    // E leaves when it closes over there (the remote bridge's answered patch expires).
    shift = 25 * 3600_000;
    await until(() => msgs.some(m => m.type === 'escalation.removed' && m.id === 'E1'), 8000);
    await new Promise<void>(r => { ws.once('close', () => r()); ws.close(); });
  }, 30_000);
});
