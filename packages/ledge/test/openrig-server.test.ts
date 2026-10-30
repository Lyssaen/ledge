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
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

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

let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null; const dirs: string[] = [];
afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function setup(withBridge: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-openrig-srv-')); dirs.push(dir); process.env.LEDGE_HOME = dir;
  const store = new Store();
  let server: ServerHandle | null = null;
  if (withBridge) {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge'); fake.queue.push(humanRow('E1'));
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake), projects: () => none, home: dir, file: join(dir, 'openrig.json'),
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

    // Writes come in later lots.
    c.send({ type: 'rig.act', rid: 'a1', machine: 'local', rigId: 'r1', verb: 'up' } as ClientMessage);
    await until(() => c.of('error').some(e => e.request === 'rig.act'));
    expect(c.of('error').find(e => e.request === 'rig.act')).toMatchObject({ code: 'unavailable', message: 'not supported yet' });

    // A hook from a seat pairs its session.
    c.send({ type: 'session.event', id: 's1', agent: 'claude', cwd: '/w/app', openrig: { sessionName: 'dev-build@starter' }, event: { name: 'SessionStart', at: T, source: 'hook' } } as ClientMessage);
    await until(() => c.of('session.updated').some(m => m.session.id === 's1' && !!m.session.rig));
    expect(store.get('s1')!.rig).toMatchObject({ machine: 'local', rigId: 'r1', rigName: 'starter' });

    // The rig gone from OpenRig: its sessions lose their seat.
    fake!.rigs.splice(0); await until(() => !store.get('s1')!.rig, 3000);
    await c.close();
  });

  it('without a bridge: no openrig flag, rig requests are refused as unavailable', async () => {
    const { server } = await setup(false);
    const c = await client(server.port);
    await until(() => c.of('snapshot').length === 1);
    expect(c.of('snapshot')[0]!.daemon?.openrig).toBeUndefined();
    c.send({ type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' });
    c.send({ type: 'rig.act', rid: 'a1', machine: 'local', rigId: 'r1', verb: 'up' } as ClientMessage);
    await until(() => c.of('error').length === 2);
    for (const e of c.of('error')) expect(e).toMatchObject({ code: 'unavailable' });
    expect(c.msgs.some(m => m.type === 'openrig.status' || m.type === 'rig.snapshot')).toBe(false);
    await c.close();
  });
});
