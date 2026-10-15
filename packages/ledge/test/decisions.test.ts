import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Pending, Session } from '@ledge/protocol';
import { prepareDecide, type DecisionDeps } from '../src/daemon/decisions.js';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import type { PeerSocket } from '../src/daemon/peers.js';
import { DeviceStore, type MobileControl } from '../src/daemon/devices.js';
import { createPairing } from '../src/daemon/pairing.js';
import { registrationOptions, verifyRegistration } from '../src/daemon/webauthn.js';
import type { MobileConfig } from '../src/mobile/config.js';
import { createSoftAuthenticator } from './soft-authenticator.js';
import { until } from './helpers.js';

const T0 = '2026-10-15T09:00:00.000Z';
const cfg: MobileConfig = { origin: 'https://pc.t.ts.net', rpID: 'pc.t.ts.net' };
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});
// The bottom of a Claude Code 2.x permission dialog.
const PROMPT = 'x\n' + '─'.repeat(40) + '\n Bash command\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';

/** A tmux whose panes are queues (the last entry stays), and whose captures can be held until the test releases them. */
function fakeTmux(panes: Record<string, string[]>) {
  const sent: string[][] = [];
  let gate: Promise<void> | null = null;
  const tmux: Tmux = {
    async newSession() {}, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture(n) { if (gate) await gate; const q = panes[n] ?? ['']; return q.length > 1 ? q.shift()! : q[0]!; },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async setOption() {}, async killSession(n) { sent.push(['kill', n]); }, attachArgs: n => ['attach', n]
  };
  return {
    tmux, sent,
    /** Every capture waits until the returned function is called. */
    hold() { let release!: () => void; gate = new Promise(r => { release = r; }); return () => { gate = null; release(); }; }
  };
}

/** A phone attached as a remote peer: what the daemon sends is kept in order, what it sends is fed to the socket. */
function phone(srv: Awaited<ReturnType<typeof startServer>>, deviceId: string) {
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
    /** The first message matching `pred` sent after the call, or after `from`. */
    async wait(pred: (m: any) => boolean, ms = 3000) {
      const end = Date.now() + ms;
      for (;;) {
        const m = sent.find(pred);
        if (m) return m;
        if (Date.now() > end) throw new Error('timeout');
        await new Promise(r => setTimeout(r, 10));
      }
    },
    result(operationId: string, ms?: number) { return this.wait(m => m.type === 'operation.result' && m.operationId === operationId && m.status !== 'received', ms); }
  };
}

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let fake: ReturnType<typeof fakeTmux>; let devices: DeviceStore;
let soft: ReturnType<typeof createSoftAuthenticator>; let deviceId: string;

async function start(panes: string[] = [PROMPT, PROMPT, 'Running…']) {
  fake = fakeTmux({ 'ledge-a': panes });
  const mobile: MobileControl = { devices, pairing: createPairing({ config: () => cfg, devices }), state: () => ({ origin: cfg.origin, listening: true }), configure: async () => {} };
  srv = await startServer({ store, tmux: fake.tmux, port: 0, mobile, verify: { attempts: 3, intervalMs: 20 }, agentEnv: async () => ({ ...process.env }) });
}

beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-'));
  store = new Store();
  devices = new DeviceStore({ path: join(process.env.LEDGE_HOME, 'devices.json') });
  soft = createSoftAuthenticator(cfg);
  const options = await registrationOptions(cfg, 'iPhone');
  const credential = await verifyRegistration(cfg, soft.register(options), options.challenge);
  deviceId = (await devices.create('iPhone', credential)).device.id;
  await start();
});
afterEach(async () => { await srv.close(); });

const low: Pending = { id: 'pA', version: 1, kind: 'permission', text: 'npm test', tool: 'Bash', risk: 'low', riskReason: 'read_only_command', source: 'hook' };
const high: Pending = { id: 'pA', version: 1, kind: 'permission', text: 'git push --force origin main', tool: 'Bash', risk: 'high', riskReason: 'pushes', source: 'hook' };
const waiting = (pending: Pending) => store.upsert(mk('a', { state: pending.kind === 'question' ? 'waiting_input' : 'waiting_permission', pending }));
const decide = (extra: Record<string, unknown> = {}) => ({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 1, operationId: randomUUID(), ...extra });

describe('remote decisions', () => {
  it('a decision taken on the phone then on the PC is injected once', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    await p.wait(m => m.type === 'operation.received' && m.operationId === msg.operationId);
    expect(await p.result(msg.operationId)).toEqual({ type: 'operation.result', operationId: msg.operationId, status: 'applied' });
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 1 });
    expect(await c.next('error')).toMatchObject({ id: 'a', message: 'stale' });
    expect(fake.sent).toEqual([['text', 'ledge-a', '1']]);
    await c.close();
  });

  it('a late accept of A never answers B', async () => {
    waiting(low);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    await c.next('session.updated', 3000);
    expect(fake.sent).toHaveLength(1);
    waiting({ ...low, id: 'pB', text: 'npm run build' });
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(fake.sent).toHaveLength(1);
    await c.close();
  });

  it('changed version is rejected', async () => {
    store.upsert(mk('a', { tool: 'codex', state: 'waiting_permission' }));
    store.apply('a', { name: 'PanePrompt', at: T0, source: 'pane', kind: 'permission', text: 'git push' });
    const v1 = store.get('a')!.pending!;
    store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'git push --force origin main' });
    expect(store.get('a')!.pending).toMatchObject({ id: v1.id, version: 2 });
    const p = phone(srv, deviceId);
    const msg = decide({ decision: 'deny', pendingId: v1.id, pendingVersion: 1 });
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'changed' });
    expect(fake.sent).toEqual([]);
  });

  it('git push --force: refused without assertion, refused with a wrong one, applied with a valid one', async () => {
    waiting(high);
    const p = phone(srv, deviceId);
    const bare = decide();
    p.send(bare);
    expect(await p.result(bare.operationId)).toMatchObject({ status: 'rejected', reason: 'assertion_required' });

    // A challenge bound to a deny never verifies an accept, and one signed by another key never verifies.
    p.send({ type: 'decide.prepare', id: 'a', pendingId: 'pA', pendingVersion: 1, decision: 'accept' });
    const ch1 = await p.wait(m => m.type === 'decide.challenge');
    const thief = createSoftAuthenticator(cfg);
    const forged = decide({ assertion: thief.assert(ch1.options) });
    p.send(forged);
    expect(await p.result(forged.operationId)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    // That challenge is spent: the genuine key cannot reuse it.
    const replayed = decide({ assertion: soft.assert(ch1.options) });
    p.send(replayed);
    expect(await p.result(replayed.operationId)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(fake.sent).toEqual([]);

    p.sent.length = 0;
    p.send({ type: 'decide.prepare', id: 'a', pendingId: 'pA', pendingVersion: 1, decision: 'accept' });
    const ch2 = await p.wait(m => m.type === 'decide.challenge');
    expect(ch2).toMatchObject({ id: 'a', pendingId: 'pA', pendingVersion: 1, decision: 'accept' });
    const good = decide({ assertion: soft.assert(ch2.options) });
    p.send(good);
    expect(await p.result(good.operationId)).toMatchObject({ status: 'applied' });
    expect(fake.sent).toEqual([['text', 'ledge-a', '1']]);
    expect(devices.get(deviceId)!.credential.counter).toBe(2);
  });

  it('decide.prepare refuses a stale, changed, read-only or low-risk request with an error to the asker', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const prepare = (extra: Record<string, unknown>) => p.send({ type: 'decide.prepare', id: 'a', pendingId: 'pA', pendingVersion: 1, decision: 'accept', ...extra });
    const error = async () => { const m = await p.wait(x => x.type === 'error'); p.sent.length = 0; return m; };
    prepare({});
    expect(await error()).toEqual({ type: 'error', id: 'a', message: 'invalid' });
    waiting(high);
    prepare({ pendingId: 'pZ' });
    expect(await error()).toEqual({ type: 'error', id: 'a', message: 'stale' });
    prepare({ pendingVersion: 2 });
    expect(await error()).toEqual({ type: 'error', id: 'a', message: 'changed' });
    prepare({ id: 'zz' });
    expect(await error()).toEqual({ type: 'error', id: 'zz', message: 'stale' });
    const q = phone(srv, 'unknown-device');
    q.send({ type: 'decide.prepare', id: 'a', pendingId: 'pA', pendingVersion: 1, decision: 'accept' });
    expect(await q.wait(x => x.type === 'error')).toEqual({ type: 'error', id: 'a', message: 'forbidden' });
    expect(p.sent.some(m => m.type === 'decide.challenge')).toBe(false);
  });

  it('a remote decide on a request without risk needs an assertion, and decide.prepare issues a challenge for it', async () => {
    const { risk: _r, riskReason: _rr, ...unclassified } = high;
    waiting(unclassified as Pending);
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'assertion_required' });
    p.send({ type: 'decide.prepare', id: 'a', pendingId: 'pA', pendingVersion: 1, decision: 'accept' });
    expect(await p.wait(m => m.type === 'decide.challenge')).toMatchObject({ id: 'a', pendingId: 'pA', pendingVersion: 1, decision: 'accept' });
    expect(fake.sent).toEqual([]);
  });

  it('a remote reply to a question that is not low-risk is refused as forbidden', async () => {
    waiting({ id: 'pA', version: 1, kind: 'question', text: 'Which?', options: ['Red', 'Blue'], risk: 'high', riskReason: 'unknown', source: 'hook' });
    const p = phone(srv, deviceId);
    const m = { type: 'session.reply', id: 'a', text: '1', pendingId: 'pA', pendingVersion: 1, operationId: randomUUID() };
    p.send(m);
    expect(await p.result(m.operationId)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
    expect(fake.sent).toEqual([]);
  });

  it('decide.prepare refuses as forbidden, without leaking the exception, when the challenge cannot be built', async () => {
    waiting(high);
    const sent: any[] = [];
    const peer = { ctx: { kind: 'remote' as const, deviceId }, send: (m: unknown) => { sent.push(m); }, close() {} };
    const deps: DecisionDeps = {
      store, ops: { } as never, challenges: { issue: () => { throw new Error('secret internals'); } } as never, devices, config: () => cfg, inject: async () => {}, interrupt: async () => {}
    };
    await prepareDecide(peer as never, { type: 'decide.prepare', id: 'a', pendingId: 'pA', pendingVersion: 1, decision: 'accept' }, deps);
    expect(sent).toEqual([{ type: 'error', id: 'a', message: 'forbidden' }]);
  });

  it('a remote decide without its request or operation is invalid', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    p.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect(await p.wait(m => m.type === 'error')).toEqual({ type: 'error', id: 'a', message: 'invalid' });
    p.sent.length = 0;
    p.send({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 1 });
    expect(await p.wait(m => m.type === 'error')).toEqual({ type: 'error', id: 'a', message: 'invalid' });
    expect(fake.sent).toEqual([]);
  });

  it('a read-only session is refused as read_only', async () => {
    store.upsert(mk('a', { tmuxSession: null, source: 'hook_only', state: 'waiting_permission', pending: low }));
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'read_only' });
  });

  it('the same operationId twice injects once and replays the result', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'applied' });
    p.sent.length = 0;
    p.send(msg);
    expect(await p.result(msg.operationId)).toEqual({ type: 'operation.result', operationId: msg.operationId, status: 'applied' });
    expect(p.sent.some(m => m.type === 'operation.received')).toBe(false);
    expect(fake.sent).toEqual([['text', 'ledge-a', '1']]);
  });

  it('the same operationId with another decision is a conflict', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'applied' });
    p.sent.length = 0;
    p.send({ ...msg, decision: 'deny' });
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'conflict' });
    // Another device cannot read or reuse it either.
    const other = phone(srv, 'other-device');
    other.send(msg);
    expect(await other.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'conflict' });
    expect(fake.sent).toHaveLength(1);
  });

  it('two simultaneous decisions: one applied, the other busy', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const one = decide(); const two = decide();
    p.send(one); p.send(two);
    expect(await p.result(two.operationId)).toMatchObject({ status: 'rejected', reason: 'busy' });
    expect(await p.result(one.operationId)).toMatchObject({ status: 'applied' });
    expect(fake.sent).toEqual([['text', 'ledge-a', '1']]);
  });

  it('revocation before injection rejects the operation', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const release = fake.hold(); // the lock is taken, the prompt capture is still pending
    const msg = decide();
    p.send(msg);
    await p.wait(m => m.type === 'operation.received');
    await devices.revoke(deviceId);
    release();
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
    expect(fake.sent).toEqual([]);
    expect(store.get('a')!.pending).toMatchObject({ id: 'pA' });
  });

  it('the final result reaches a new socket of the same device when the first one died mid-injection', async () => {
    waiting(low);
    const a = phone(srv, deviceId);
    const release = fake.hold();
    const msg = decide();
    a.send(msg);
    await a.wait(m => m.type === 'operation.received');
    const b = phone(srv, deviceId);
    const other = phone(srv, 'someone-else');
    release();
    expect(await b.result(msg.operationId)).toMatchObject({ status: 'applied' });
    expect(other.sent.filter(m => m.type === 'operation.result')).toEqual([]);
  });

  it('a revocation after the first character lets the injection finish, and the result stays readable', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    await until(() => fake.sent.length === 1);
    await devices.revoke(deviceId);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'applied' });
    expect(store.get('a')).toMatchObject({ state: 'working' });
    expect(fake.sent).toEqual([['text', 'ledge-a', '1']]);
  });

  it('a request that changes while the lock waits for the prompt capture is never answered', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const release = fake.hold();
    const msg = decide();
    p.send(msg);
    await p.wait(m => m.type === 'operation.received');
    store.apply('a', { name: 'PermissionRequest', at: T0, source: 'hook', tool: 'Bash', text: 'npm test -- --watch' });
    release();
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'rejected', reason: 'changed' });
    expect(fake.sent).toEqual([]);
  });

  it('a remote question answered by option number is applied; free text is unsupported', async () => {
    waiting({ id: 'pA', version: 1, kind: 'question', text: 'Which?', options: ['Red', 'Blue'], risk: 'low', riskReason: 'question', source: 'hook' });
    const p = phone(srv, deviceId);
    const reply = (text: string) => ({ type: 'session.reply', id: 'a', text, pendingId: 'pA', pendingVersion: 1, operationId: randomUUID() });
    for (const text of ['make it green', '3', '0']) {
      const m = reply(text);
      p.send(m);
      expect(await p.result(m.operationId)).toMatchObject({ status: 'rejected', reason: 'unsupported' });
    }
    expect(fake.sent).toEqual([]);
    const ok = reply('2');
    p.send(ok);
    expect(await p.result(ok.operationId)).toMatchObject({ status: 'applied' });
    expect(fake.sent).toEqual([['text', 'ledge-a', '2']]);
  });

  it('a remote reply to a permission is unsupported, and an instruction to an agent waiting on a request is agent_busy', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const toPermission = { type: 'session.reply', id: 'a', text: '1', pendingId: 'pA', pendingVersion: 1, operationId: randomUUID() };
    p.send(toPermission);
    expect(await p.result(toPermission.operationId)).toMatchObject({ status: 'rejected', reason: 'unsupported' });
    const free = { type: 'session.reply', id: 'a', text: 'hello', operationId: randomUUID() };
    p.send(free);
    expect(await p.result(free.operationId)).toMatchObject({ status: 'rejected', reason: 'agent_busy' });
    expect(fake.sent).toEqual([]);
  });

  it('operation.status replays a result and answers unknown for an unknown id', async () => {
    waiting(low);
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    await p.result(msg.operationId);
    p.sent.length = 0;
    p.send({ type: 'operation.status', operationId: msg.operationId });
    expect(await p.result(msg.operationId)).toEqual({ type: 'operation.result', operationId: msg.operationId, status: 'applied' });
    const unknown = randomUUID();
    p.send({ type: 'operation.status', operationId: unknown });
    expect(await p.wait(m => m.operationId === unknown)).toEqual({ type: 'operation.result', operationId: unknown, status: 'unknown' });
    // Another device does not learn this device's operations.
    const other = phone(srv, 'other-device');
    other.send({ type: 'operation.status', operationId: msg.operationId });
    expect(await other.wait(m => m.operationId === msg.operationId)).toMatchObject({ status: 'unknown' });
  });

  it('a failed injection reports failed/not_taken and keeps the request for an explicit retry', async () => {
    await srv.close(); await start([PROMPT]);
    waiting(low);
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'failed', reason: 'not_taken' });
    expect(store.get('a')).toMatchObject({ state: 'error', pending: { id: 'pA', version: 1 } });
    expect(fake.sent).toHaveLength(1);
    await new Promise(r => setTimeout(r, 150));
    expect(fake.sent).toHaveLength(1); // never re-sent by itself
    const retry = decide();
    p.send(retry);
    expect(await p.result(retry.operationId)).toMatchObject({ status: 'failed', reason: 'not_taken' });
    expect(fake.sent).toHaveLength(2);
  });

  it('no prompt on screen reports failed/no_prompt and types nothing', async () => {
    await srv.close(); await start(['● Bash(npm test)\n  Running…']);
    waiting(low);
    const p = phone(srv, deviceId);
    const msg = decide();
    p.send(msg);
    expect(await p.result(msg.operationId)).toMatchObject({ status: 'failed', reason: 'no_prompt' });
    expect(fake.sent).toEqual([]);
  });
});

describe('local decisions', () => {
  it('local accept of a high-risk request needs no assertion', async () => {
    waiting(high);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept' });
    expect((await c.next('session.updated', 3000)).session.state).toBe('working');
    expect(fake.sent).toEqual([['text', 'ledge-a', '1']]);
    await c.close();
  });

  it('with its request named, a local accept is checked for identity, and still answered with error { id }', async () => {
    waiting(high);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 2 });
    expect(await c.next('error')).toEqual({ type: 'error', id: 'a', message: 'changed' });
    expect(fake.sent).toEqual([]);
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 1 });
    expect((await c.next('session.updated', 3000)).session.state).toBe('working');
    expect(fake.sent).toEqual([['text', 'ledge-a', '1']]);
    await c.close();
  });

  it('a local peer gets operation messages only when it names an operation', async () => {
    waiting(low);
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    const operationId = randomUUID();
    c.send({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 1, operationId });
    expect(await c.next('operation.received')).toEqual({ type: 'operation.received', operationId });
    expect(await c.next('operation.result', 3000)).toEqual({ type: 'operation.result', operationId, status: 'applied' });
    await c.close();
  });
});
