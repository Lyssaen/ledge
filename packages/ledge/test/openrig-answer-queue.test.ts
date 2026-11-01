import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup as setupGateway, flush as flushGateway, stopAll as stopGateways } from './helpers/gateway.js';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Escalation, type Machine, type OpenRigStatus, type Projects, type Rig, type ServerMessage } from '@ledge/protocol';
import { createDaemonClient, type DaemonClient, type DaemonStatus } from '@ledge/fleet/client';
import { createTokenSource } from '@ledge/fleet/token';
import { readDaemonToken } from '../src/auth.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import { createCursorWriter, readOpenRigFile } from '../src/daemon/openrig/cursor.js';
import { createAnswerReceipts } from '../src/mobile/answerReceipts.js';
import { createAnswerQueue, type QueuedAnswer } from '../src/daemon/openrig/answerQueue.js';
import { createRigAggregate, type RigAggregate } from '../src/daemon/openrig/aggregate.js';
import type { BridgeMessage } from '../src/daemon/openrig/bridge.js';
import { createRemotePeers, type PeerStatus, type RemoteMessage, type RemotePeers } from '../src/daemon/openrig/remote.js';
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

function setup(file: string, opts: { settleMs?: number; machines?: Machine[] } = {}) {
  const sent: ClientMessage[] = [];
  const msgFns = new Set<(machine: string, m: RemoteMessage) => void>();
  const stFns = new Set<(machine: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => void>();
  let status: PeerStatus = 'unreachable';
  const remote: RemotePeers = {
    setMachines() {}, close() {}, version: () => '0.20.0',
    status: m => (m === 'ec2' ? status : 'unreachable'),
    send(machine, msg) { if (machine !== 'ec2' || status !== 'open') return false; sent.push(msg); return true; },
    onMessage(fn) { msgFns.add(fn); return () => { msgFns.delete(fn); }; },
    onStatus(fn) { stFns.add(fn); return () => { stFns.delete(fn); }; }
  };
  const overlays: Array<[string, Partial<Escalation> | null]> = [];
  const known = new Map<string, Escalation>([['E1', esc('E1', 'ec2')], ['E2', esc('E2', 'ec2')]]);
  const aggregate = { escalation: (id: string) => known.get(id), overlay: (id: string, p: Partial<Escalation> | null) => { overlays.push([id, p]); } } as unknown as RigAggregate;
  const notices: string[] = [];
  const queue = createAnswerQueue({ remote, aggregate, file, notice: t => { notices.push(t); }, now: () => T, labelOf: id => (id === 'ec2' ? 'EC2' : id), settleMs: opts.settleMs ?? 20,
    ...(opts.machines ? { machines: () => opts.machines! } : {}) });
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

afterEach(() => { stopGateways(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

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

  it('emits a correlated receipt only after a sent answer receives the peer’s result', () => {
    const s = setup(join(tmp(), 'openrig.json')); const receipts: Array<unknown> = [];
    s.queue.onSettled((answer, result) => receipts.push({ answer, result }));
    s.queue.enqueue(s.answer('r1'), s.reply); expect(receipts).toEqual([]);
    s.replay('running', ['E1']); expect(s.answersSent()).toHaveLength(1);
    s.peer({ ...ok('r1'), confirmed: true });
    expect(receipts).toEqual([{ answer: expect.objectContaining({ rid: 'r1', machine: 'ec2', id: 'E1', answers: { q1: 'a' } }), result: { status: 'applied' } }]);
  });
  it('emits the same rid receipt after the peer connection drops and the answer is resent', () => {
    const s = setup(join(tmp(), 'openrig.json')); const receipts: Array<unknown> = [];
    s.queue.onSettled((answer, result) => receipts.push({ answer, result }));
    s.queue.enqueue(s.answer('r1'), s.reply); s.replay('running', ['E1']); s.peerStatus('unreachable');
    expect(receipts).toEqual([]); s.replay('running', ['E1']);
    expect(s.answersSent().filter(m => m.type === 'escalation.answer' && m.rid === 'r1')).toHaveLength(2);
    s.peer({ ...ok('r1'), confirmed: true }); expect(receipts).toEqual([{ answer: expect.objectContaining({ rid: 'r1' }), result: { status: 'applied' } }]);
  });
  it('does not treat an unproven positive peer result as a receipt', () => {
    const s = setup(join(tmp(), 'openrig.json')); const receipts: Array<unknown> = [];
    s.queue.onSettled((answer, result) => receipts.push({ answer, result }));
    s.queue.enqueue(s.answer('r1'), s.reply); s.replay('running', ['E1']); s.peer(ok('r1'));
    expect(receipts).toEqual([]);
  });
  it('does not claim application from an inferred lost acknowledgement or an unsolicited result', () => {
    const s = setup(join(tmp(), 'openrig.json')); const receipts: Array<unknown> = [];
    s.queue.onSettled((answer, result) => receipts.push({ answer, result }));
    s.queue.enqueue(s.answer('r1'), s.reply); s.peer(ok('r1')); expect(receipts).toEqual([]);
    s.queue.enqueue(s.answer('r2'), s.reply); s.replay('running', ['E1']); s.peerStatus('unreachable'); s.replay('running', []);
    s.peer({ type: 'rig.result', rid: 'r2', ok: false, code: 'failed' }); expect(receipts).toEqual([]);
  });
  it.each([true, false])('relays a queued peer reply to the phone only with proof: %s', async (confirmed) => {
    const s = setup(join(tmp(), 'openrig.json')); const e = esc('E1', 'ec2');
    const view = { rigs: () => [], escalations: () => [e], escalation: (id: string) => id === e.id ? e : undefined, escalationAmbiguous: () => false, rules: () => [], decisions: () => [], projects: () => ({ projects: [], rules: [] }), thread: () => ({ items: [] }), exchanges: () => [] };
    const g = setupGateway({ deps: { openrig: view }, dispatch: async (msg, reply) => { if (msg.type === 'escalation.answer') s.queue.enqueue({ rid: msg.rid, machine: 'ec2', id: msg.id, answers: msg.answers, by: msg.by, at: T }, reply); } });
    s.queue.onSettled((answer, result) => g.gw.answerSettled(answer, result));
    const op = randomUUID(); const msg = { type: 'escalation.answer', op, id: 'E1', answers: { q1: 'a' } };
    g.send('dev1', msg); await flushGateway(); expect(g.results('dev1').at(-1)).toMatchObject({ op, status: 'received' });
    s.replay('running', ['E1']); s.peerStatus('unreachable'); s.replay('running', ['E1']);
    s.peer({ ...ok(op), ...(confirmed ? { confirmed: true as const } : {}) }); await flushGateway();
    g.send('dev1', msg); await flushGateway();
    expect(g.results('dev1').at(-1)).toMatchObject({ op, status: confirmed ? 'applied' : 'received' });
  });
  it('recovers a durable phone receipt when both the queue and gateway restart before the peer confirms', async () => {
    const dir = tmp(); const queueFile = join(dir, 'openrig.json'); const receiptFile = join(dir, 'receipts.json'); const op = randomUUID();
    const e = esc('E1', 'ec2'); const view = { rigs: () => [], escalations: () => [e], escalation: (id: string) => id === e.id ? e : undefined, escalationAmbiguous: () => false, rules: () => [], decisions: () => [], projects: () => ({ projects: [], rules: [] }), thread: () => ({ items: [] }), exchanges: () => [] };
    const firstQueue = setup(queueFile); const first = setupGateway({ deps: { openrig: view, answerReceipts: createAnswerReceipts(receiptFile) }, dispatch: async (msg, reply) => { if (msg.type === 'escalation.answer') firstQueue.queue.enqueue({ rid: msg.rid, machine: 'ec2', id: msg.id, answers: msg.answers, by: msg.by, at: T }, reply); } });
    const message = { type: 'escalation.answer', op, id: 'E1', answers: { q1: 'a' } }; first.send('dev1', message); await flushGateway(); first.gw.stop();
    const restartedQueue = setup(queueFile); const second = setupGateway({ deps: { openrig: view, answerReceipts: createAnswerReceipts(receiptFile) } });
    restartedQueue.queue.onSettled((answer, result) => second.gw.answerSettled(answer, result));
    restartedQueue.replay('running', ['E1']); restartedQueue.peer({ ...ok(op), confirmed: true }); await flushGateway(); second.gw.stop();
    const third = setupGateway({ deps: { openrig: view, answerReceipts: createAnswerReceipts(receiptFile) } }); third.send('dev1', message); await flushGateway();
    expect(third.results('dev1').at(-1)).toMatchObject({ op, status: 'applied' }); expect(third.dispatched).toEqual([]);
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

  it('at startup, drops the answers of a machine no longer in machines.json, with one notice per machine', () => {
    const file = join(tmp(), 'openrig.json');
    const a = (rid: string, machine: string, id: string) => ({ rid, machine, id, answers: { q: 'a' }, by: 'user', at: T });
    writeFileSync(file, JSON.stringify({ version: 1, machines: {}, outbox: [a('r1', 'ec2', 'E1'), a('r2', 'nas', 'N1'), a('r3', 'nas', 'N2')] }));
    const s = setup(file, { machines: [{ id: 'local', label: 'PC' }, { id: 'ec2', label: 'EC2', ssh: 'ec2' }] });
    expect(s.queue.pending().map(x => x.rid)).toEqual(['r1']);
    expect(readOpenRigFile(file).outbox?.map(x => x.rid)).toEqual(['r1']);
    expect(s.notices).toEqual(["Mes 2 réponses en attente pour nas ne sont pas parties : nas a été retirée des machines"]);
    expect(s.overlays.filter(([, p]) => p)).toEqual([['E1', expect.objectContaining({ state: 'answered' })]]);
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

  it('lost ack and the remote daemon restarted (its rid memo gone): « unknown » or « already answered » for a resent answer is delivered, no notice', async () => {
    for (const code of ['failed', 'already_answered'] as const) {
      const s = setup(join(tmp(), 'openrig.json'));
      s.queue.enqueue(s.answer('r1'), s.reply);
      s.replay('running', ['E1']);
      expect(s.answersSent().map(m => m.rid)).toEqual(['r1']);
      s.peerStatus('unreachable'); // cut before its rig.result; the remote daemon restarts meanwhile
      s.replay('running', []); // the answer arrived: E1 is gone over there
      await until(() => s.answersSent().length === 2, 1000);
      s.peer({ type: 'rig.result', rid: 'r1', ok: false, code, reason: code === 'failed' ? 'aucune escalade E1' : 'déjà répondue' });
      expect(s.queue.pending()).toEqual([]);
      expect(s.notices).toEqual([]);
      expect(s.overlays.at(-1)).toEqual(['E1', null]);
    }
  });

  it('an answer the router had sent when the link dropped (sentAt): kept as sent, then a restarted peer\'s « unknown » is quiet', async () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue({ ...s.answer('r1'), sentAt: T }, s.reply);
    expect(s.queue.pending()).toEqual([{ ...s.answer('r1'), sentAt: T }]);
    s.replay('running', []);
    await until(() => s.answersSent().length === 1, 1000);
    s.peer({ type: 'rig.result', rid: 'r1', ok: false, code: 'failed', reason: 'aucune escalade E1' });
    expect(s.queue.pending()).toEqual([]);
    expect(s.notices).toEqual([]);
  });

  it('an escalation the returning peer no longer lists: the answer goes anyway, its daemon\'s « unknown » abandons it with the notice', async () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.queue.enqueue(s.answer('r2', 'E2'), s.reply);
    s.replay('running', ['E2']);
    expect(s.answersSent().map(m => m.rid)).toEqual(['r2']);
    await until(() => s.answersSent().length === 2, 1000); // the listing is over: r1 goes, same rid
    expect(s.notices).toEqual([]); // the listing alone never abandons
    s.peer({ type: 'rig.result', rid: 'r1', ok: false, code: 'failed', reason: 'aucune escalade E1' });
    expect(s.notices).toEqual(["Ma réponse à question E1 n'est pas partie : la question a été fermée sur EC2"]);
    expect(s.queue.pending().map(a => a.rid)).toEqual(['r2']);
    expect(s.overlays).toContainEqual(['E1', null]);
  });

  it('a remote queue not read yet (failed read after a restart) never abandons: kept, sent again once listed', async () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.replay('running', []); // its OpenRig runs, its human queue failed to load: lists nothing
    await until(() => s.answersSent().length === 1, 1000);
    s.peer({ type: 'rig.result', rid: 'r1', ok: false, code: 'openrig_down', reason: "les escalades d'OpenRig ne sont pas encore lues" });
    expect(s.queue.pending()).toEqual([s.answer('r1')]); // kept, `sentAt` cleared: it did not arrive
    expect(s.notices).toEqual([]);
    expect(s.overlays.at(-1)).toEqual(['E1', expect.objectContaining({ answer: expect.objectContaining({ delivery: 'queued' }) })]);
    s.peer({ type: 'escalation.updated', escalation: esc('E1', 'ec2') }); // its next read finds E1
    expect(s.answersSent().map(m => m.rid)).toEqual(['r1', 'r1']);
    s.peer({ type: 'rig.result', rid: 'r1', ok: false, code: 'already_answered', reason: 'déjà répondue' }); // listed: someone else answered
    expect(s.queue.pending()).toEqual([]); expect(s.notices).toEqual([]);
  });

  it('a peer whose Ledge does not know OpenRig: its answers abandoned with one notice', () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue(s.answer('r1'), s.reply);
    s.peerStatus('unsupported');
    expect(s.queue.pending()).toEqual([]);
    expect(s.notices).toEqual(["Ma réponse à question E1 n'est pas partie : Ledge 0.20.0 sur EC2 ne connaît pas OpenRig : mets-le à jour"]);
    expect(s.overlays.at(-1)).toEqual(['E1', null]);
  });

  it('refuses an answer by Ledge (the wire carries only the user\'s)', () => {
    const s = setup(join(tmp(), 'openrig.json'));
    s.queue.enqueue({ ...s.answer('r1'), by: 'ledge' }, s.reply);
    expect(s.replies).toEqual([expect.objectContaining({ type: 'rig.result', rid: 'r1', ok: false, code: 'failed' })]);
    expect(s.queue.pending()).toEqual([]);
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

// ---- The real peers, aggregate and queue together: a machine whose ssh alias changes stays the same machine.

describe('ssh alias change', () => {
  it('keeps the queued answers, the rigs (unreachable) and the escalations; nothing is abandoned', () => {
    const clients: Array<{ set(s: DaemonStatus): void; emit(m: ServerMessage): void; closed: number }> = [];
    const remote = createRemotePeers({ port: 1, connect: () => {
      let onMsg = (_: ServerMessage) => {}, onSt = (_: DaemonStatus) => {}, status: DaemonStatus = 'connecting';
      const c = { closed: 0, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } }; clients.push(c);
      return { connect() {}, close() { c.closed++; }, send() {}, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } } as DaemonClient;
    } });
    const fns = new Set<(m: BridgeMessage) => void>();
    const bridge = { status: () => ({ machine: 'local', state: 'running' }) as OpenRigStatus, rigs: () => [], escalations: () => [], escalation: () => undefined, replay: () => [],
      onMessage: (fn: (m: BridgeMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; } } as unknown as Bridge;
    let machines: Machine[] = [{ id: 'local', label: 'PC' }, { id: 'ec2', label: 'EC2', ssh: 'ec2-old' }];
    const aggregate = createRigAggregate({ bridge, remote, machines: () => machines, projects: () => none, settleMs: 20 });
    const out: BridgeMessage[] = []; aggregate.onMessage(m => out.push(m));
    const notices: string[] = [];
    const queue = createAnswerQueue({ remote, aggregate, file: join(tmp(), 'openrig.json'), notice: t => { notices.push(t); }, now: () => T, labelOf: id => (id === 'ec2' ? 'EC2' : id), settleMs: 20 });
    remote.setMachines(machines);
    const c0 = clients[0]!; c0.set('open');
    c0.emit({ type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, openrig: true } } as ServerMessage);
    const r2: Rig = { id: 'r2', name: 'r2', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: false, seats: [], repos: [] };
    c0.emit({ type: 'openrig.status', status: { machine: 'local', state: 'running' } });
    c0.emit({ type: 'rig.snapshot', machine: 'local', rigs: [r2] });
    c0.emit({ type: 'escalation.updated', escalation: esc('E1') });
    c0.set('unreachable');
    const replies: ServerMessage[] = [];
    queue.enqueue({ rid: 'r1', machine: 'ec2', id: 'E1', answers: { q1: 'a' }, by: 'user', at: T }, m => { replies.push(m); });
    expect(replies).toEqual([ok('r1')]);
    out.length = 0;

    machines = [machines[0]!, { id: 'ec2', label: 'EC2', ssh: 'ec2-new' }];
    remote.setMachines(machines);
    expect(c0.closed).toBe(1);
    expect(clients).toHaveLength(2);
    expect(queue.pending('ec2').map(a => a.rid)).toEqual(['r1']);
    expect(notices).toEqual([]);
    expect(out.some(m => m.type === 'rig.removed' || m.type === 'escalation.removed')).toBe(false);
    expect(aggregate.rigs().find(r => r.id === 'r2')).toMatchObject({ machine: 'ec2', lifecycle: 'unreachable' });
    expect(aggregate.escalation('E1')).toMatchObject({ machine: 'ec2', state: 'answered', answer: { delivery: 'queued' } });
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
const homeBefore = process.env.LEDGE_HOME;
afterEach(async () => {
  for (const d of running.splice(0)) { await d.bridge.stop(); await d.srv.close(); }
  for (const f of fakes.splice(0)) await f.stop();
  if (homeBefore === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = homeBefore;
});

/** A daemon in `home` (LEDGE_HOME while it starts: its thread, token and openrig.json live there). */
async function daemon(home: string, fake: FakeOpenRig, o: { port?: number; exec?: FakeRigCli; machinesFile?: string; remoteConnect?: (m: Machine, url: string) => DaemonClient; shift?: () => number; fetch?: typeof fetch } = {}): Promise<Daemon> {
  const was = process.env.LEDGE_HOME; process.env.LEDGE_HOME = home;
  try {
    const store = new Store(); let srv: ServerHandle | null = null;
    const now = () => new Date(Date.now() + (o.shift?.() ?? 0)).toISOString();
    const bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake.port) }), exec: o.exec ?? fakeRigCli(fake), projects: () => none, home, file: join(home, 'openrig.json'), now, ...(o.fetch ? { fetch: o.fetch } : {}),
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
    const toPeer: ClientMessage[] = []; let cutOn: string | null = null; let cut = false; let peerClient: DaemonClient | null = null;
    const token = createTokenSource(async () => { const t = readDaemonToken(); return t ? { kind: 'token', token: t } : { kind: 'absent' }; });
    const remoteConnect = (): DaemonClient => {
      const c = createDaemonClient({ url: `ws://127.0.0.1:${portA}`, WebSocketImpl: WebSocket as never, token, minBackoffMs: 30, maxBackoffMs: 150 });
      peerClient = c;
      return { ...c,
        send: m => { toPeer.push(m); c.send(m); },
        // The « lost ack »: the peer's rig.result for `cutOn` never arrives (the test then drops the link and brings it back).
        onMessage: fn => c.onMessage(m => { if (cutOn && m.type === 'rig.result' && m.rid === cutOn) { cutOn = null; cut = true; return; } fn(m); }) };
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
    await until(() => cut, 8000);
    expect(answersTo('r2')).toBe(1);
    // Before the link comes back, E2 (and E1) close over there: the remote bridge's answered patches expire.
    shift = 25 * 3600_000;
    await until(() => !a.bridge.escalations().some(x => x.id === 'E2') && msgs.some(m => m.type === 'escalation.removed' && m.id === 'E1'), 8000);
    peerClient!.connect(); // the link drops and comes back
    await until(() => answersTo('r2') === 2, 8000); // resent with the same rid, though no machine lists E2 any more
    await until(() => readOpenRigFile(join(homeB, 'openrig.json')).outbox === undefined, 8000);
    expect(delivered() - before2).toBe(1); // OpenRig got one answer (the remote daemon's rid memo, Task 2)
    expect(answersTo('r1')).toBe(1);
    // Settled by the memo's ok: no « n'est pas partie » in Ledge's thread.
    await new Promise(r => setTimeout(r, 100));
    expect(msgs.some(m => m.type === 'ledge.thread.item' && m.item.kind === 'ledge' && 'text' in m.item && String(m.item.text).includes("n'est pas partie"))).toBe(false);
    await new Promise<void>(r => { ws.once('close', () => r()); ws.close(); });
  }, 30_000);

  it('a remote whose OpenRig queue failed to load: openrig_down, not memoized; the same rid goes once the queue loads, OpenRig gets one answer', async () => {
    const homeA = tmp('ledge-aq-remote-'), homeB = tmp('ledge-aq-local-');
    const fakeA = await createFakeOpenRig(); fakes.push(fakeA);
    fakeA.rigs.push(starter()); fakeA.humans.push('ledge'); fakeA.queue.push(humanRow('E1'));
    const execA = fakeRigCli(fakeA);
    let broken = false; const base = fetch;
    const brokenQueue = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (broken && String(input).includes('/api/queue/list')) return new Response('{}', { status: 200 });
      return base(input, init);
    }) as typeof fetch;
    let a = await daemon(homeA, fakeA, { exec: execA, fetch: brokenQueue });
    const portA = a.srv.port;
    await until(() => a.bridge.escalations().some(e => e.id === 'E1'));
    copyFileSync(join(homeA, 'token'), join(homeB, 'token'));
    process.env.LEDGE_HOME = homeB;
    const fakeB = await createFakeOpenRig(); fakes.push(fakeB);
    const machinesFile = join(homeB, 'machines.json');
    writeMachines([{ id: 'local', label: 'PC' }, { id: 'ec2', label: 'EC2', ssh: 'ec2' }], machinesFile);
    const toPeer: ClientMessage[] = []; const fromPeer: ServerMessage[] = [];
    const token = createTokenSource(async () => { const t = readDaemonToken(); return t ? { kind: 'token', token: t } : { kind: 'absent' }; });
    const remoteConnect = (): DaemonClient => {
      const c = createDaemonClient({ url: `ws://127.0.0.1:${portA}`, WebSocketImpl: WebSocket as never, token, minBackoffMs: 30, maxBackoffMs: 150 });
      return { ...c, send: m => { toPeer.push(m); c.send(m); }, onMessage: fn => c.onMessage(m => { fromPeer.push(m); fn(m); }) };
    };
    const b = await daemon(homeB, fakeB, { machinesFile, remoteConnect });
    process.env.LEDGE_HOME = homeB;
    const ws = new WebSocket(`ws://127.0.0.1:${b.srv.port}`, { headers: { authorization: `Bearer ${readDaemonToken()}` } });
    const msgs: ServerMessage[] = [];
    ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const last = (id: string) => msgs.filter((m): m is Extract<ServerMessage, { type: 'escalation.updated' }> => m.type === 'escalation.updated' && m.escalation.id === id).at(-1)?.escalation;
    const delivered = () => execA.calls.filter(c => c.join(' ').includes('queue create')).length + fakeA.requests.filter(r => r.method === 'POST').length;
    const answersTo = (rid: string) => toPeer.filter(m => m.type === 'escalation.answer' && m.rid === rid).length;
    await until(() => last('E1')?.machine === 'ec2', 8000);
    const answers = Object.fromEntries(last('E1')!.questions.map(q => [q.id, q.options[0]!.id]));

    // ec2 goes down, the user answers: queued.
    await stopDaemon(a);
    await until(() => msgs.some(m => m.type === 'openrig.status' && m.status.machine === 'ec2' && m.status.state === 'unreachable'), 8000);
    ws.send(JSON.stringify({ type: 'escalation.answer', rid: 'r1', id: 'E1', answers, by: 'user' }));
    await until(() => last('E1')?.answer?.delivery === 'queued');
    const before = delivered();

    // ec2 comes back, its OpenRig running but its human queue failing to load: it lists nothing.
    broken = true;
    process.env.LEDGE_HOME = homeA;
    a = await daemon(homeA, fakeA, { exec: execA, port: portA, fetch: brokenQueue });
    process.env.LEDGE_HOME = homeB;
    await until(() => a.bridge.status().state === 'running', 8000);
    expect(a.bridge.humanRead()).toBe(false);
    // The listing over, r1 goes anyway; the remote daemon answers « not read yet ».
    await until(() => fromPeer.some(m => m.type === 'rig.result' && m.rid === 'r1' && !m.ok && m.code === 'openrig_down'), 8000);
    expect(answersTo('r1')).toBe(1);
    expect(readOpenRigFile(join(homeB, 'openrig.json')).outbox?.map(x => x.rid)).toEqual(['r1']);
    expect(delivered()).toBe(before);

    // The queue loads: E1 is listed, r1 goes again (same rid), and is delivered this time (the refusal was not memoized).
    broken = false;
    await until(() => readOpenRigFile(join(homeB, 'openrig.json')).outbox === undefined, 8000);
    expect(answersTo('r1')).toBe(2);
    expect(fromPeer.filter(m => m.type === 'rig.result' && m.rid === 'r1').at(-1)).toEqual({ ...ok('r1'), confirmed: true });
    expect(delivered() - before).toBe(1);
    expect(msgs.some(m => m.type === 'ledge.thread.item' && m.item.kind === 'ledge' && 'text' in m.item && String(m.item.text).includes("n'est pas partie"))).toBe(false);
    await new Promise<void>(r => { ws.once('close', () => r()); ws.close(); });
  }, 30_000);
});
