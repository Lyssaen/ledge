import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type Projects, type ServerMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig, type FakeRigCli } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';
import { createMemory } from '../src/daemon/brain/memory.js';
import { paths } from '../src/paths.js';

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const T = '2026-10-30T10:00:00.000Z';
const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } },
  { logicalId: 'dev.test', canonicalSessionName: 'dev-test@starter', runtime: 'codex', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });
const humanRow = (id: string) => ({ qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: `question ${id}`, createdAt: '2026-10-30 10:00:00' });
const task = (id: string) => ({ type: 'queue.created', qitemId: id, sourceSession: 'dev-build@starter', destinationSession: 'dev-test@starter', summary: `do ${id}` });

/** A raw local client that keeps every message in arrival order. */
async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const of = <K extends ServerMessage['type']>(t: K) => msgs.filter((m): m is Extract<ServerMessage, { type: K }> => m.type === t);
  return { msgs, of, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), close: () => new Promise<void>(r => { ws.once('close', () => r()); ws.close(); }) };
}

let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null; const dirs: string[] = []; let rigExec: FakeRigCli | null = null;
afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function setup(withBridge: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-openrig-srv-')); dirs.push(dir); process.env.LEDGE_HOME = dir;
  const store = new Store();
  let server: ServerHandle | null = null;
  if (withBridge) {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.queue.push(humanRow('E1'));
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: (rigExec = fakeRigCli(fake)), projects: () => none, home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => server!.asks.all(), onChange: f => server!.asks.onChange(f) }, sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
  }
  server = srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }),
    ...(bridge ? { openrig: bridge } : {}) });
  if (bridge) {
    await bridge.start();
    await until(() => bridge!.status().state === 'running' && bridge!.rigs().length === 1 && bridge!.escalations().length === 1);
  }
  return { store, server };
}

describe('server with the OpenRig bridge', () => {
  it('replays the mirror after the snapshot, broadcasts changes, answers exchanges, refuses what is not built yet and pairs seats', async () => {
    const { store, server } = await setup(true);
    const c = await client(server.port);
    await until(() => c.of('escalation.updated').length >= 1);
    const snap = c.of('snapshot')[0]!; expect(snap.daemon?.openrig).toBe(true);
    const order = c.msgs.map(m => m.type);
    const iStatus = order.indexOf('openrig.status'); const iRigs = order.indexOf('rig.snapshot'); const iEsc = order.indexOf('escalation.updated');
    expect(order[0]).toBe('snapshot'); expect(order.indexOf('asks')).toBeLessThan(iStatus);
    expect(iStatus).toBeLessThan(iRigs); expect(iRigs).toBeLessThan(iEsc);
    expect(c.of('openrig.status')[0]!.status.state).toBe('running');
    expect(c.of('rig.snapshot')[0]!.rigs.map(r => r.name)).toEqual(['starter']);
    expect(c.of('escalation.updated')[0]!.escalation.id).toBe('E1');

    // A human queue item created in OpenRig reaches the client.
    fake!.queue.push(humanRow('E2')); fake!.emit({ type: 'queue.created', qitemId: 'E2', sourceSession: 'dev-build@starter', destinationSession: 'ledge@external' });
    await until(() => c.of('escalation.updated').some(m => m.escalation.id === 'E2'));

    // Exchanges of a rig, on request; another machine is not this daemon's to answer.
    fake!.emit(task('X1')); await until(() => bridge!.exchanges('r1').length === 1);
    c.send({ type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' });
    await until(() => c.of('rig.exchanges').length === 1);
    expect(c.of('rig.exchanges')[0]).toMatchObject({ machine: 'local', rigId: 'r1' }); expect(c.of('rig.exchanges')[0]!.items.map(x => x.id)).toEqual(bridge!.exchanges('r1').map(x => x.id));
    c.send({ type: 'rig.exchanges.request', machine: 'pc2', rigId: 'r1' });
    await until(() => c.of('error').some(e => e.request === 'rig.exchanges.request'));
    expect(c.of('error').find(e => e.request === 'rig.exchanges.request')).toMatchObject({ code: 'unreachable' });

    // An unknown project is refused as a rig.result (the adoption itself is in openrig-adopt.test.ts).
    c.send({ type: 'rig.adopt', rid: 'a1', machine: 'local', rigId: 'r1', projectId: 'p' } as ClientMessage);
    await until(() => c.of('rig.result').some(r => r.rid === 'a1'));
    expect(c.of('rig.result').find(r => r.rid === 'a1')).toMatchObject({ ok: false, code: 'failed', reason: 'unknown project' });

    // A hook from a seat pairs its session.
    c.send({ type: 'session.event', id: 's1', agent: 'claude', cwd: '/w/app', openrig: { sessionName: 'dev-build@starter' }, event: { name: 'SessionStart', at: T, source: 'hook' } } as ClientMessage);
    await until(() => c.of('session.updated').some(m => m.session.id === 's1' && !!m.session.rig));
    expect(store.get('s1')!.rig).toMatchObject({ machine: 'local', rigId: 'r1', rigName: 'starter' });

    // The rig gone from OpenRig: its sessions lose their seat.
    fake!.rigs.splice(0); await until(() => !store.get('s1')!.rig, 3000);
    await c.close();
  });

  it('rig.send writes to a seat signed Ledge; a remote machine is unreachable; an @seat in ledge.say is sent, not asked', async () => {
    const { server } = await setup(true);
    const c = await client(server.port);
    c.send({ type: 'rig.send', rid: 's1', machine: 'local', seatRef: 'dev-build@starter', text: 'relance' });
    c.send({ type: 'rig.send', rid: 's2', machine: 'mac', seatRef: 'dev-build@starter', text: 'relance' });
    c.send({ type: 'rig.send', rid: 's4', machine: 'local', seatRef: '-x', text: 'a' });
    c.send({ type: 'rig.send', rid: 's5', machine: 'local', seatRef: 'dev-build@starter', text: '  ' });
    await until(() => c.of('rig.result').length === 4);
    expect(c.of('rig.result').filter(r => r.rid === 's4' || r.rid === 's5')).toEqual([expect.objectContaining({ ok: false, code: 'invalid' }), expect.objectContaining({ ok: false, code: 'invalid' })]);
    expect(c.of('rig.result').find(r => r.rid === 's1')).toMatchObject({ ok: true });
    expect(c.of('rig.result').find(r => r.rid === 's2')).toMatchObject({ ok: false, code: 'unreachable' });
    expect(rigExec!.calls.filter(a => a[0] === 'send')).toEqual([['send', 'dev-build@starter', '[Ledge] relance']]);
    c.send({ type: 'ledge.say', rid: 's3', text: '@build lance les tests' });
    await until(() => c.of('ledge.thread.item').some(m => m.item.kind === 'user' && m.item.to === '@build'));
    expect(rigExec!.calls.filter(a => a[0] === 'send').at(-1)).toEqual(['send', 'dev-build@starter', '[Ledge] lance les tests']);
    await c.close();
  });

  it('decision.revisit reopens an answered card while the seat has not taken the reply; an unknown decision is not ok', async () => {
    const { server } = await setup(true);
    const c = await client(server.port);
    c.send({ type: 'escalation.answer', rid: 'e1', id: 'E1', answers: { text: 'oui' }, by: 'user' });
    await until(() => c.of('rig.result').some(r => r.rid === 'e1'));
    expect(c.of('rig.result').find(r => r.rid === 'e1')).toMatchObject({ ok: true });
    const dec = createMemory({ dir: paths().memoryDir }).decisions().find(d => d.escalationId === 'E1')!;
    expect(dec).toBeDefined();
    c.send({ type: 'decision.revisit', rid: 'v0', id: 'nope' });
    c.send({ type: 'decision.revisit', rid: 'v1', id: dec.id });
    await until(() => c.of('rig.result').filter(r => r.rid.startsWith('v')).length === 2);
    expect(c.of('rig.result').find(r => r.rid === 'v0')).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(c.of('rig.result').find(r => r.rid === 'v1')).toMatchObject({ ok: true });
    await until(() => c.of('escalation.updated').some(m => m.escalation.id === 'E1' && m.escalation.correcting === dec.id && m.escalation.state === 'pending'));
    // The first item for E1 predates this client: the reopened card is a new one.
    await until(() => c.of('ledge.thread.item').some(m => m.item.kind === 'escalation' && m.item.escalationId === 'E1'));
    await c.close();
  });

  it('without a bridge: no openrig flag, rig requests are refused as unavailable', async () => {
    const { server } = await setup(false);
    const c = await client(server.port);
    await until(() => c.of('snapshot').length === 1);
    expect(c.of('snapshot')[0]!.daemon?.openrig).toBeUndefined();
    c.send({ type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' });
    await until(() => c.of('error').length === 1);
    expect(c.of('error')[0]).toMatchObject({ code: 'unavailable' });
    c.send({ type: 'rig.adopt', rid: 'a1', machine: 'local', rigId: 'r1', projectId: 'p' } as ClientMessage);
    c.send({ type: 'rig.send', rid: 's1', machine: 'local', seatRef: 'dev-build@starter', text: 'x' });
    await until(() => c.of('rig.result').length === 2);
    for (const r of c.of('rig.result')) expect(r).toMatchObject({ ok: false, code: 'openrig_down' });
    expect(c.msgs.some(m => m.type === 'openrig.status' || m.type === 'rig.snapshot')).toBe(false);
    await c.close();
  });
});
