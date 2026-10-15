import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pending, Session, SessionEvent } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { History } from '../src/daemon/history.js';
import { startServer } from '../src/daemon/server.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import type { PeerSocket } from '../src/daemon/peers.js';
import { DeviceStore, type MobileControl } from '../src/daemon/devices.js';
import { createPairing } from '../src/daemon/pairing.js';
import type { MobileConfig } from '../src/mobile/config.js';

const T0 = '2026-10-15T09:00:00.000Z';
const cfg: MobileConfig = { origin: 'https://pc.t.ts.net', rpID: 'pc.t.ts.net' };
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});
// The bottom of a Claude Code 2.x permission dialog.
const PROMPT = 'x\n' + '─'.repeat(40) + '\n Bash command\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';
const RUNNING = 'Running…';
const credential = { id: 'cred', publicKey: 'key', counter: 0 };

/** A tmux whose panes are queues (the last entry stays). */
function fakeTmux(panes: Record<string, string[]>) {
  const sent: string[][] = [];
  const tmux: Tmux = {
    async newSession() {}, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture(n) { const q = panes[n] ?? ['']; return q.length > 1 ? q.shift()! : q[0]!; },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async setOption() {}, async killSession(n) { sent.push(['kill', n]); }, attachArgs: n => ['attach', n]
  };
  return { tmux, sent };
}

type Srv = Awaited<ReturnType<typeof startServer>>;

/** A phone attached as a remote peer: what the daemon sends is kept in order. */
function phone(srv: Srv, deviceId: string) {
  const handlers: Record<string, ((...a: any[]) => void)[]> = {};
  const sent: any[] = [];
  const sock: PeerSocket = {
    readyState: 1,
    send(data: string) { sent.push(JSON.parse(data)); },
    close() { sock.readyState = 3; for (const h of handlers.close ?? []) h(); },
    on(ev, fn) { (handlers[ev] ??= []).push(fn); return sock; }
  };
  srv.attach(sock, { kind: 'remote', deviceId });
  return {
    sent,
    send(msg: unknown) { for (const h of handlers.message ?? []) h(Buffer.from(JSON.stringify(msg))); },
    /** The first message matching `pred` at index `from` or later. */
    async wait(pred: (m: any) => boolean, from = 0, ms = 3000) {
      const end = Date.now() + ms;
      for (;;) {
        const m = sent.slice(from).find(pred);
        if (m) return m;
        if (Date.now() > end) throw new Error('timeout');
        await new Promise(r => setTimeout(r, 10));
      }
    },
    result(operationId: string) { return this.wait(m => m.type === 'operation.result' && m.operationId === operationId && m.status !== 'received'); }
  };
}

let srv: Srv; let store: Store; let history: History; let devices: DeviceStore; let fake: ReturnType<typeof fakeTmux>;
let d1: string; let d2: string;

async function start(panes: string[]) {
  fake = fakeTmux({ 'ledge-a': panes });
  const mobile: MobileControl = { devices, pairing: createPairing({ config: () => cfg, devices }), state: () => ({ origin: cfg.origin, listening: true }), configure: async () => {} };
  srv = await startServer({ store, history, tmux: fake.tmux, port: 0, mobile, verify: { attempts: 3, intervalMs: 20 }, agentEnv: async () => ({ ...process.env }) });
}

beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
  store = new Store(); history = new History();
  devices = new DeviceStore({ path: join(process.env.LEDGE_HOME, 'devices.json') });
  d1 = (await devices.create('iPhone', credential)).device.id;
  d2 = (await devices.create('iPad', credential)).device.id;
  await start([PROMPT, RUNNING]);
});
afterEach(async () => { await srv.close(); });

const low: Pending = { id: 'pA', version: 1, kind: 'permission', text: 'npm test', tool: 'Bash', risk: 'low', riskReason: 'read_only_command', source: 'hook' };
const ev = (name: SessionEvent['name'], extra: Partial<SessionEvent> = {}): SessionEvent => ({ name, at: new Date().toISOString(), source: 'hook', ...extra });

/** Sends hook events from a local client, as `ledge hook` does, and waits for the store to change. */
async function hook(id: string, ...events: SessionEvent[]) {
  const c = await connect({ port: srv.port }); await c.next('snapshot');
  for (const event of events) { c.send({ type: 'session.event', id, event }); await c.next('session.updated'); }
  c.close();
}

async function turnsOf(id: string) {
  const c = await connect({ port: srv.port }); await c.next('snapshot');
  c.send({ type: 'session.history', id });
  const m = await c.next('session.turns');
  c.close();
  return m.turns;
}

describe('thread', () => {
  it('the thread shows prompts, replies and decisions in order after a daemon restart', async () => {
    store.upsert(mk('a', { state: 'idle' }));
    await hook('a', ev('UserPromptSubmit', { text: 'run the tests' }));
    store.upsert({ ...store.get('a')!, state: 'waiting_permission', pending: low });
    const p = phone(srv, d1);
    const opId = randomUUID();
    p.send({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 1, operationId: opId });
    expect(await p.result(opId)).toMatchObject({ status: 'applied' });
    await hook('a', ev('Stop', { text: 'All 12 tests pass.' }));

    await srv.close(); await store.save(); await history.flush();
    store = new Store(); await store.load(); history = new History(); await history.load();
    await start([RUNNING]);
    const turns = await turnsOf('a');
    expect(turns.map((t: any) => t.kind)).toEqual(['prompt', 'decision', 'reply']);
    expect(new Set(turns.map((t: any) => t.id)).size).toBe(3);
    expect(turns[0]).toMatchObject({ text: 'run the tests' });
    expect(turns[1]).toMatchObject({ decision: 'accept', source: 'phone', pendingId: 'pA' });
    expect(turns[2]).toMatchObject({ text: 'All 12 tests pass.' });
  });

  it('a phone decision is recorded from the phone, an overlay decision from the PC', async () => {
    await srv.close();
    await start([PROMPT, RUNNING, PROMPT, RUNNING]);
    store.upsert(mk('a', { state: 'waiting_permission', pending: low }));
    const p = phone(srv, d1);
    const opId = randomUUID();
    p.send({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 1, operationId: opId });
    expect(await p.result(opId)).toMatchObject({ status: 'applied' });
    store.upsert({ ...store.get('a')!, state: 'waiting_permission', pending: { ...low, id: 'pB' } });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'deny', pendingId: 'pB', pendingVersion: 1 });
    await c.next('session.updated', 3000);
    c.close();
    const turns = await turnsOf('a');
    expect(turns.map((t: any) => [t.kind, t.decision, t.source, t.pendingId])).toEqual([['decision', 'accept', 'phone', 'pA'], ['decision', 'deny', 'pc', 'pB']]);
  });

  it('an answer picked on the phone is written with the option label', async () => {
    store.upsert(mk('a', { state: 'waiting_input', pending: { id: 'pQ', version: 1, kind: 'question', text: 'Which?', options: ['Red', 'Blue'], risk: 'low', riskReason: 'question', source: 'hook' } }));
    const p = phone(srv, d1);
    const msg = { type: 'session.reply', id: 'a', text: '2', pendingId: 'pQ', pendingVersion: 1, operationId: randomUUID() };
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'applied' });
    expect(await turnsOf('a')).toMatchObject([{ kind: 'answer', text: 'Blue', source: 'phone', pendingId: 'pQ' }]);
  });

  it('an interrupt from the overlay is written from the PC', async () => {
    store.upsert(mk('a', { state: 'working' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.interrupt', id: 'a' });
    await new Promise(r => setTimeout(r, 50));
    c.close();
    expect(fake.sent).toEqual([['keys', 'ledge-a', 'Escape']]);
    expect(await turnsOf('a')).toMatchObject([{ kind: 'interrupt', source: 'pc' }]);
  });

  it('a request settled in the terminal, seen only by the poller, is a resolved turn', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { ...low, source: 'pane' } }));
    store.apply('a', { name: 'PaneIdle', at: new Date().toISOString(), source: 'pane' });
    expect(await turnsOf('a')).toMatchObject([{ kind: 'resolved', source: 'pc', pendingId: 'pA' }]);
  });

  it('unread is per device: reading on one phone leaves the other unread', async () => {
    store.upsert(mk('a'));
    const p1 = phone(srv, d1); const p2 = phone(srv, d2);
    expect((await p1.wait(m => m.type === 'snapshot')).sessions[0].unread).toBe(false);
    await hook('a', ev('Stop', { text: 'Done.' }));
    const u1 = await p1.wait(m => m.type === 'session.updated' && m.session.unread === true);
    await p2.wait(m => m.type === 'session.updated' && m.session.unread === true);
    expect(u1.session.state).toBe('idle');
    const from1 = p1.sent.length; const from2 = p2.sent.length;
    const replyAt = (await turnsOf('a')).at(-1)!.at;
    // A mark past the last turn is held to it: a reply still to come stays unread.
    p1.send({ type: 'session.read', id: 'a', at: '2099-01-01T00:00:00.000Z' });
    expect((await p1.wait(m => m.type === 'session.updated', from1)).session.unread).toBe(false);
    await new Promise(r => setTimeout(r, 50));
    expect(p2.sent.length).toBe(from2);
    p2.send({ type: 'snapshot.request' });
    expect((await p2.wait(m => m.type === 'snapshot', from2)).sessions[0].unread).toBe(true);
    expect(devices.get(d1)?.read).toEqual({ a: replyAt });
  });

  it('a message to an idle agent is typed once and its prompt is tagged phone', async () => {
    store.upsert(mk('a', { state: 'idle' }));
    const p = phone(srv, d1);
    const msg = { type: 'session.reply', id: 'a', text: 'now fix the lint', operationId: randomUUID() };
    p.send(msg);
    expect(await p.result(msg.operationId)).toEqual({ type: 'operation.result', operationId: msg.operationId, status: 'applied' });
    const from = p.sent.length;
    p.send(msg);
    expect(await p.wait(m => m.type === 'operation.result', from)).toMatchObject({ status: 'applied' });
    expect(fake.sent).toEqual([['text', 'ledge-a', 'now fix the lint'], ['keys', 'ledge-a', 'Enter']]);
    await hook('a', ev('UserPromptSubmit', { text: 'now fix the lint' }));
    expect(await turnsOf('a')).toMatchObject([{ kind: 'prompt', text: 'now fix the lint', source: 'phone' }]);
  });

  it('a message to a working agent is refused as agent_busy and nothing is typed or queued', async () => {
    store.upsert(mk('a', { state: 'working' }));
    const p = phone(srv, d1);
    const msg = { type: 'session.reply', id: 'a', text: 'now fix the lint', operationId: randomUUID() };
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'agent_busy' });
    await hook('a', ev('Stop', { text: 'Done.' }));
    expect(store.get('a')?.state).toBe('idle');
    await new Promise(r => setTimeout(r, 100));
    expect(fake.sent).toEqual([]);
    // A prompt typed on the PC with the same text is not the phone's.
    await hook('a', ev('UserPromptSubmit', { text: 'now fix the lint' }));
    expect((await turnsOf('a')).at(-1)).toEqual(expect.not.objectContaining({ source: 'phone' }));
  });

  it('a message longer than 4 000 characters is refused as invalid', async () => {
    store.upsert(mk('a', { state: 'idle' }));
    const p = phone(srv, d1);
    const msg = { type: 'session.reply', id: 'a', text: 'x'.repeat(4001), operationId: randomUUID() };
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(fake.sent).toEqual([]);
  });

  it('interrupt twice with the same operationId sends the keys once', async () => {
    store.upsert(mk('a', { state: 'working', tool: 'cursor' }));
    const p = phone(srv, d1);
    const msg = { type: 'session.interrupt', id: 'a', operationId: randomUUID() };
    p.send(msg); p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'applied' });
    const from = p.sent.length;
    p.send(msg);
    expect(await p.wait(m => m.type === 'operation.result', from)).toMatchObject({ status: 'applied' });
    expect(fake.sent).toEqual([['keys', 'ledge-a', 'C-c']]);
    expect(await turnsOf('a')).toMatchObject([{ kind: 'interrupt', source: 'phone' }]);
  });

  it('an interrupt from a phone needs an operation and a working agent', async () => {
    store.upsert(mk('a', { state: 'idle' }));
    const p = phone(srv, d1);
    p.send({ type: 'session.interrupt', id: 'a' });
    expect(await p.wait(m => m.type === 'error')).toMatchObject({ id: 'a', message: 'invalid' });
    const msg = { type: 'session.interrupt', id: 'a', operationId: randomUUID() };
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'agent_busy' });
    expect(fake.sent).toEqual([]);
  });

  it('a fast tool whose result beats the check leaves a phone decision a decision, never settled in the terminal', async () => {
    store.upsert(mk('a', { state: 'working' }));
    store.apply('a', ev('UserPromptSubmit', { text: 'run the tests' }));
    store.apply('a', ev('PermissionRequest', { tool: 'Bash', text: 'ls' }));
    const pending = store.get('a')!.pending!;
    // The keys go out, and the tool's PostToolUse lands while the daemon waits to see the prompt gone.
    const keys = fake.tmux.sendKeys.bind(fake.tmux);
    fake.tmux.sendKeys = async (n, k) => { await keys(n, k); setTimeout(() => store.apply('a', ev('PostToolUse', { tool: 'Bash' })), 5); };
    const p = phone(srv, d1);
    const opId = randomUUID();
    p.send({ type: 'session.decide', id: 'a', decision: 'deny', pendingId: pending.id, pendingVersion: pending.version, operationId: opId });
    expect(await p.result(opId)).toMatchObject({ status: 'applied' });
    const turns = await turnsOf('a');
    expect(turns.map((t: any) => [t.kind, t.decision, t.source, t.pendingId])).toEqual([['prompt', undefined, undefined, undefined], ['decision', 'deny', 'phone', pending.id]]);
    expect(history.items('a').find(i => i.kind === 'permission')).toMatchObject({ decision: 'deny', source: 'phone', pendingId: pending.id });
  });

  it('a read mark covers a reply updated in place after a later turn', async () => {
    store.upsert(mk('a', { state: 'working' }));
    const p = phone(srv, d1);
    await p.wait(m => m.type === 'snapshot');
    await hook('a', ev('UserPromptSubmit', { text: 'go' }), ev('Stop', { text: 'first', at: '2026-10-15T09:00:01.000Z' }));
    history.note('a', { note: 'interrupt', source: 'pc' }, '2026-10-15T09:00:02.000Z');
    // The same turn's reply comes again, later: its row keeps its place, its time moves past the note.
    store.apply('a', ev('Stop', { text: 'second', at: '2026-10-15T09:00:03.000Z' }));
    const from = p.sent.length;
    p.send({ type: 'session.read', id: 'a', at: '2099-01-01T00:00:00.000Z' });
    expect((await p.wait(m => m.type === 'session.updated', from)).session.unread).toBe(false);
    expect(devices.get(d1)?.read).toEqual({ a: '2026-10-15T09:00:03.000Z' });
  });

  it('notes never reach the overlay: neither broadcast nor in the thread it asks for', async () => {
    store.upsert(mk('a', { state: 'working' }));
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    const p = phone(srv, d1);
    const msg = { type: 'session.interrupt', id: 'a', operationId: randomUUID() };
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'applied' });
    expect(history.items('a').map(i => i.kind)).toEqual(['note']);
    await expect(c.next('session.thread.item', 200)).rejects.toThrow(/timeout/);
    c.send({ type: 'session.thread', id: 'a' });
    expect(await c.next('session.thread')).toEqual({ type: 'session.thread', id: 'a', items: [] });
    c.close();
  });

  it('dismissing a session deletes its history', async () => {
    store.upsert(mk('a', { state: 'idle' }));
    await hook('a', ev('Stop', { text: 'Done.' }));
    await history.flush();
    expect(readdirSync(join(process.env.LEDGE_HOME!, 'history'))).toEqual(['a.jsonl']);
    store.upsert({ ...store.get('a')!, state: 'exited' });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.dismiss', id: 'a' });
    await c.next('session.removed');
    await history.flush();
    expect(existsSync(join(process.env.LEDGE_HOME!, 'history', 'a.jsonl'))).toBe(false);
    c.send({ type: 'session.history', id: 'a' });
    expect(await c.next('error')).toMatchObject({ id: 'a', message: 'unknown session' });
    c.close();
  });
});
