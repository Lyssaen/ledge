import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type ClientMessage, type LedgeThreadItem, type Projects, type ServerMessage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import { createBridge, type Bridge } from '../src/daemon/openrig/bridge.js';
import type { Tmux } from '../src/tmux.js';
import { createFakeOpenRig, fakeRigCli, type FakeOpenRig, type FakeRig } from './fakes/openrig.js';
import { authHeaders, until } from './helpers.js';

const noTmux = new Proxy({} as Tmux, { get: () => async () => { throw new Error('no tmux in this test'); } });
const none = { version: 1, projects: [], rules: [] } as unknown as Projects;
const starter = (): FakeRig => ({ rigId: 'r1', name: 'starter', status: 'running', nodes: [
  { logicalId: 'dev.build', canonicalSessionName: 'dev-build@starter', runtime: 'claude-code', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } },
  { logicalId: 'dev.test', canonicalSessionName: 'dev-test@starter', runtime: 'codex', sessionStatus: 'running', startupStatus: 'ready', cwd: '/w/app', activityState: { activity: 'idle-at-prompt' } }] });

/** A raw local client that keeps every message in arrival order. */
async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
  const msgs: ServerMessage[] = [];
  ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const of = <K extends ServerMessage['type']>(t: K) => msgs.filter((m): m is Extract<ServerMessage, { type: K }> => m.type === t);
  return { msgs, of, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), close: () => new Promise<void>(r => { ws.once('close', () => r()); ws.close(); }) };
}
type Client = Awaited<ReturnType<typeof client>>;
const threadItems = (c: Client) => c.of('ledge.thread.item').map(m => m.item);
const escalationItems = (items: LedgeThreadItem[], id: string) => items.filter(i => i.kind === 'escalation' && i.escalationId === id);

let srv: ServerHandle | null = null; let bridge: Bridge | null = null; let fake: FakeOpenRig | null = null; const dirs: string[] = [];
afterEach(async () => { await bridge?.stop(); bridge = null; await srv?.close(); srv = null; await fake?.stop(); fake = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A fresh LEDGE_HOME (so a fresh ledge-thread.jsonl) per test; `lines` are written to the thread file first. */
async function setup(o: { bridge: boolean; lines?: LedgeThreadItem[]; hold?: Promise<unknown> }) {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-thread-srv-')); dirs.push(dir); process.env.LEDGE_HOME = dir;
  if (o.lines) writeFileSync(join(dir, 'ledge-thread.jsonl'), o.lines.map(l => `${JSON.stringify(l)}\n`).join(''));
  const store = new Store();
  let server: ServerHandle | null = null;
  if (o.bridge) {
    fake = await createFakeOpenRig(); fake.rigs.push(starter()); fake.humans.push('ledge');
    fake.queue.push({ qitemId: 'E1', sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: 'question E1', createdAt: '2026-10-30 10:00:00' });
    bridge = createBridge({ env: async () => ({ OPENRIG_PORT: String(fake!.port) }), exec: fakeRigCli(fake, o.hold ? { hold: o.hold } : {}), projects: () => none, home: dir, file: join(dir, 'openrig.json'),
      asks: { all: () => server!.asks.all(), onChange: f => server!.asks.onChange(f) }, sessionName: id => store.get(id)?.name, probeMs: 20, outboxMs: 30, resyncMs: 50 });
  }
  server = srv = await startServer({ store, tmux: noTmux, port: 0, home: dir, daemon: { version: '0.0.0', install: 'git', systemd: false }, agentEnv: async () => ({ ...process.env }),
    ...(bridge ? { openrig: bridge } : {}) });
  if (bridge) {
    await bridge.start();
    await until(() => bridge!.status().state === 'running' && bridge!.rigs().length === 1 && bridge!.escalations().length === 1);
  }
  return { server, dir };
}

const user = (i: number): LedgeThreadItem => ({ kind: 'user', id: `u${i}`, at: `2026-10-30T10:${String(i % 60).padStart(2, '0')}:00.000Z`, text: `m${i}` });

describe('the ledge thread served', () => {
  it('a new client gets the latest thread page, and older pages on request', async () => {
    const { server } = await setup({ bridge: false, lines: Array.from({ length: 53 }, (_, i) => user(i + 1)) });
    const c = await client(server.port);
    await until(() => c.of('ledge.thread.history').length === 1);
    const h = c.of('ledge.thread.history')[0]!;
    expect(h.items.map(i => i.id)).toEqual(Array.from({ length: 50 }, (_, i) => `u${i + 4}`));
    expect(h.before).toBe('u4');
    const order = c.msgs.map(m => m.type);
    expect(order.indexOf('ledge.thread.history')).toBeGreaterThan(order.indexOf('chat.history'));

    const other = await client(server.port); await until(() => other.of('ledge.thread.history').length === 1);
    c.send({ type: 'ledge.thread.request', before: 'u4' });
    await until(() => c.of('ledge.thread.history').length === 2);
    const older = c.of('ledge.thread.history')[1]!;
    expect(older.items.map(i => i.id)).toEqual(['u1', 'u2', 'u3']); expect(older.before).toBeUndefined();
    await new Promise(r => setTimeout(r, 50));
    expect(other.of('ledge.thread.history')).toHaveLength(1); // to the asker only
    await other.close(); await c.close();
  });

  it('without OpenRig the thread is there and an answer is refused as openrig_down', async () => {
    const { server } = await setup({ bridge: false, lines: [user(1), user(2), user(3)] });
    const c = await client(server.port);
    await until(() => c.of('ledge.thread.history').length === 1);
    expect(c.of('ledge.thread.history')[0]!.items).toHaveLength(3);
    c.send({ type: 'escalation.answer', rid: 'a1', id: 'E1', answers: { text: 'go' }, by: 'user' });
    await until(() => c.of('rig.result').length === 1);
    expect(c.of('rig.result')[0]).toMatchObject({ rid: 'a1', ok: false, code: 'openrig_down' });
    expect(c.of('error').filter(e => e.request === 'escalation.answer' || e.request === 'ledge.thread.request')).toEqual([]);
    await c.close();
  });

  it('sends the thread after the OpenRig mirror; a new escalation appears once in the thread', async () => {
    const { server } = await setup({ bridge: true });
    const c = await client(server.port);
    await until(() => c.of('ledge.thread.history').length === 1);
    const order = c.msgs.map(m => m.type);
    expect(order.indexOf('ledge.thread.history')).toBeGreaterThan(order.lastIndexOf('escalation.updated'));
    expect(escalationItems(c.of('ledge.thread.history')[0]!.items, 'E1')).toHaveLength(1);

    fake!.pushEscalation({ qitemId: 'E2' });
    await until(() => escalationItems(threadItems(c), 'E2').length === 1);
    fake!.pushEscalation({ qitemId: 'E2', summary: 'question E2, reworded' }); // the bridge sends escalation.updated again
    await until(() => c.of('escalation.updated').some(m => m.escalation.id === 'E2' && m.escalation.summary === 'question E2, reworded'));
    fake!.queue.splice(fake!.queue.findIndex(r => r.qitemId === 'E2'), 1);
    fake!.emit({ type: 'queue.updated', qitemId: 'E2', destinationSession: 'ledge@external' }); // removed: the thread keeps its item
    await until(() => c.of('escalation.removed').some(m => m.id === 'E2'));
    expect(escalationItems(threadItems(c), 'E2')).toHaveLength(1);

    const late = await client(server.port); await until(() => late.of('ledge.thread.history').length === 1);
    const items = late.of('ledge.thread.history')[0]!.items;
    expect(escalationItems(items, 'E1')).toHaveLength(1); expect(escalationItems(items, 'E2')).toHaveLength(1);
    await late.close(); await c.close();
  });

  it('exchanges become one growing group item; Ledge\'s own rows stay out', async () => {
    const { server } = await setup({ bridge: true });
    const c = await client(server.port);
    await until(() => c.of('ledge.thread.history').length === 1);
    fake!.pushExchange({ qitemId: 'X1', from: 'dev-build@starter', to: 'dev-test@starter' });
    await until(() => threadItems(c).some(i => i.kind === 'exchanges'));
    fake!.pushExchange({ qitemId: 'L1', from: 'ledge@external', to: 'dev-build@starter' });
    fake!.pushExchange({ qitemId: 'X2', from: 'dev-test@starter', to: 'dev-build@starter' });
    await until(() => threadItems(c).filter(i => i.kind === 'exchanges').length === 2);
    const groups = threadItems(c).filter((i): i is Extract<LedgeThreadItem, { kind: 'exchanges' }> => i.kind === 'exchanges');
    expect(groups[0]!.id).toBe(groups[1]!.id);
    expect(groups[0]!.exchangeIds).toEqual(['q-X1']); expect(groups[1]!.exchangeIds).toEqual(['q-X1', 'q-X2']);
    expect(groups[1]).toMatchObject({ machine: 'local', rigId: 'r1' });
    // Ledge's reply row is still an exchange of the rig, marked as Ledge's own.
    expect(bridge!.exchanges('r1').find(x => x.id === 'q-L1')).toMatchObject({ kind: 'ledge', from: 'ledge@external' });
    await c.close();
  });

  it('escalation.answer answers through OpenRig and replies rig.result to the sender only', async () => {
    const { server } = await setup({ bridge: true });
    const c = await client(server.port); const other = await client(server.port);
    await until(() => c.of('ledge.thread.history').length === 1 && other.of('ledge.thread.history').length === 1);
    c.send({ type: 'escalation.answer', rid: 'a1', id: 'E1', answers: { text: 'go ahead' }, by: 'user' });
    await until(() => c.of('rig.result').length === 1);
    expect(c.of('rig.result')[0]).toEqual({ type: 'rig.result', rid: 'a1', ok: true });
    await until(() => other.of('escalation.updated').some(m => m.escalation.id === 'E1' && m.escalation.state === 'answered'));
    expect(other.of('escalation.updated').find(m => m.escalation.state === 'answered')!.escalation.answer).toMatchObject({ by: 'user', answers: { text: 'go ahead' } });
    // Through the real bridge: one reply row to the seat, then the human row approved as Ledge.
    const reply = fake!.queue.filter(r => r.sourceSession === 'ledge@external');
    expect(reply).toHaveLength(1); expect(reply[0]).toMatchObject({ destinationSession: 'dev-build@starter', replyTo: 'E1' });
    expect(reply[0]!.body).toContain('go ahead');
    expect(fake!.queue.find(r => r.qitemId === 'E1')!.state).toBe('done');
    const approve = fake!.requests.find(r => r.method === 'POST' && r.path === '/api/mission-control/action');
    expect(approve).toMatchObject({ body: { verb: 'approve', qitemId: 'E1' }, headers: { 'x-openrig-session': 'ledge@external' } });
    // The thread is not touched by the answer itself.
    expect(escalationItems(threadItems(c), 'E1')).toHaveLength(0);
    expect(other.of('rig.result')).toHaveLength(0);
    await other.close(); await c.close();
  });

  it('two clients answering the same escalation: one ok, one already_answered', async () => {
    let release!: () => void; const hold = new Promise<void>(r => { release = r; });
    const { server } = await setup({ bridge: true, hold });
    const a = await client(server.port); const b = await client(server.port);
    await until(() => a.of('ledge.thread.history').length === 1 && b.of('ledge.thread.history').length === 1);
    a.send({ type: 'escalation.answer', rid: 'ra', id: 'E1', answers: { text: 'yes' }, by: 'user' });
    b.send({ type: 'escalation.answer', rid: 'rb', id: 'E1', answers: { text: 'no' }, by: 'user' });
    await until(() => a.of('rig.result').length + b.of('rig.result').length === 1);
    release();
    await until(() => a.of('rig.result').length === 1 && b.of('rig.result').length === 1);
    const results = [...a.of('rig.result'), ...b.of('rig.result')];
    expect(results.map(r => r.ok).sort()).toEqual([false, true]);
    expect(results.find(r => !r.ok)).toMatchObject({ code: 'already_answered' });
    expect(fake!.queue.filter(r => r.sourceSession === 'ledge@external')).toHaveLength(1);
    expect(fake!.requests.filter(r => r.method === 'POST' && r.path === '/api/mission-control/action')).toHaveLength(1);
    await a.close(); await b.close();
  });
});
