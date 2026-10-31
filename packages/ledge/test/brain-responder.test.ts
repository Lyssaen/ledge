import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseServerMessage, type BrainStatus, type Escalation, type LedgeThreadItem, type ServerMessage } from '@ledge/protocol';
import { brainResponder, BRAIN_STOPPED_TEXT, BRAIN_FIRST_TEXT } from '../src/daemon/brain/responder.js';
import type { BrainEvent } from '../src/daemon/brain/inbox.js';
import { createLedgeThread, type LedgeThread } from '../src/daemon/ledgeThread.js';
import { Store } from '../src/daemon/store.js';
import { startServer, type ServerHandle } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { authHeaders, until } from './helpers.js';

type UserItem = Extract<LedgeThreadItem, { kind: 'user' }>;
const AT = '2026-10-31T10:00:00.000Z';
const user = (id: string): UserItem => ({ kind: 'user', id, at: AT, text: `message ${id}`, qid: id });
const esc = { id: 'qi-1' } as Escalation;

let dir: string; let thread: LedgeThread; let n: number;
let status: BrainStatus; let session: boolean; let listeners: Array<(s: BrainStatus) => void>;
let pushed: BrainEvent[]; let pushOk: boolean; let served: string[];
beforeEach(() => {
  n = 0; dir = mkdtempSync(join(tmpdir(), 'brain-responder-'));
  thread = createLedgeThread({ path: join(dir, 'thread.jsonl'), now: () => AT, uuid: () => `t${++n}` });
  status = { state: 'on', tool: 'claude', enabled: true }; session = true; listeners = []; pushed = []; pushOk = true; served = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (waitMs?: number) => brainResponder({ waitMs, inbox: { push: e => { pushed.push(e); return pushOk; } }, thread,
  fallback: async item => { served.push(item.id); }, status: () => status, hasSession: () => session,
  onStatus: fn => { listeners.push(fn); return () => {}; } });
const change = (s: Partial<BrainStatus>, hasSession: boolean) => { status = { ...status, ...s }; session = hasSession; for (const l of listeners) l(status); };
const bubbles = () => thread.page().items.filter(i => i.kind === 'ledge').map(i => (i as { text: string }).text);

describe('brainResponder', () => {
  test('brain on: a say goes to the brain, not to the fallback, and resolves at once', async () => {
    const r = make();
    await r(user('u1'), esc);
    expect(pushed).toEqual([{ kind: 'user', item: user('u1'), about: esc }]);
    expect(served).toEqual([]); expect(bubbles()).toEqual([]);
  });
  test('brain starting without a session: the say waits, then goes to the brain once it is on', async () => {
    change({ state: 'starting' }, false);
    const r = make();
    let done = false; void r(user('u1')).then(() => { done = true; });
    await new Promise(x => setTimeout(x, 5));
    expect(done).toBe(false); expect(pushed).toEqual([]);
    change({ state: 'starting' }, true);
    await until(() => done);
    expect(pushed).toEqual([{ kind: 'user', item: user('u1'), about: undefined }]);
    expect(served).toEqual([]);
  });
  test('a stalled start falls back once and does not deliver twice after recovery', async () => {
    change({ state: 'starting' }, false);
    await make(10)(user('timeout'));
    expect(served).toEqual(['timeout']);
    change({ state: 'on' }, true);
    expect(pushed).toEqual([]);
  });
  test('brain starting with a session: the inbox queues, no wait', async () => {
    change({ state: 'starting' }, true);
    await make()(user('u1'));
    expect(pushed).toHaveLength(1); expect(served).toEqual([]);
  });
  test('brain down: the fallback answers and the stopped bubble appears once per outage', async () => {
    change({ state: 'down', reason: 'x' }, false);
    const r = make();
    await r(user('u1')); await r(user('u2'));
    expect(served).toEqual(['u1', 'u2']); expect(pushed).toEqual([]);
    expect(bubbles()).toEqual(['Ledge est arrêté · Démarrer']);
    expect(BRAIN_STOPPED_TEXT).toBe('Ledge est arrêté · Démarrer');
  });
  test('the bubble comes back after the brain recovered and went down again', async () => {
    change({ state: 'down' }, false);
    const r = make();
    await r(user('u1'));
    change({ state: 'on' }, true);
    await r(user('u2'));
    change({ state: 'down' }, false);
    await r(user('u3'));
    expect(bubbles()).toEqual([BRAIN_STOPPED_TEXT, BRAIN_STOPPED_TEXT]);
    expect(served).toEqual(['u1', 'u3']);
  });
  test('enabled with no live session counts as down (bubble + fallback)', async () => {
    change({ state: 'on' }, false);
    await make()(user('u1'));
    expect(served).toEqual(['u1']); expect(bubbles()).toEqual([BRAIN_STOPPED_TEXT]);
  });
  test('brain off: the fallback, no bubble', async () => {
    change({ state: 'off', enabled: false }, false);
    await make()(user('u1'));
    expect(served).toEqual(['u1']); expect(bubbles()).toEqual([]);
    change({ state: 'off', enabled: null }, false);
    await make()(user('u2'));
    expect(served).toEqual(['u1', 'u2']); expect(bubbles()).toEqual([]);
  });
  test('a refused push falls back to the fallback', async () => {
    pushOk = false;
    await make()(user('u1'));
    expect(served).toEqual(['u1']);
  });
  test('a queued say goes to the fallback when the brain goes down instead of coming on', async () => {
    change({ state: 'starting' }, false);
    const r = make();
    const p = r(user('u1'));
    change({ state: 'down' }, false);
    await p;
    expect(served).toEqual(['u1']); expect(pushed).toEqual([]);
    expect(bubbles()).toEqual([BRAIN_STOPPED_TEXT]);
  });
  test('a queued say goes to the fallback, with no bubble, when the brain is turned off', async () => {
    change({ state: 'starting' }, false);
    const p = make()(user('u1'));
    change({ state: 'off', enabled: false }, false);
    await p;
    expect(served).toEqual(['u1']); expect(bubbles()).toEqual([]);
  });
});

// --- the first activation announcement, through the daemon ---
const fakeTmux = (): Tmux => {
  const panes = new Set<string>();
  return { async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(nm) { return panes.has(nm); }, async listSessions() { return [...panes]; }, async setOption() {}, async killSession(nm) { panes.delete(nm); }, attachArgs: nm => ['attach', nm] };
};
describe('brain.set first', () => {
  let saved: string | undefined; let srv: ServerHandle | null = null; let ws: WebSocket; let home: string; let msgs: ServerMessage[];
  beforeEach(async () => {
    saved = process.env.LEDGE_HOME; home = mkdtempSync(join(tmpdir(), 'brain-first-')); process.env.LEDGE_HOME = home;
    srv = await startServer({ store: new Store(), tmux: fakeTmux(), port: 0, home, agentEnv: async () => ({ ...process.env }) });
    msgs = [];
    ws = new WebSocket(`ws://127.0.0.1:${srv.port}`, { headers: authHeaders() });
    ws.on('message', d => msgs.push(parseServerMessage(JSON.parse(String(d)))));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    await until(() => msgs.some(m => m.type === 'ledge.thread.history'));
  });
  afterEach(async () => {
    await new Promise<void>(r => { ws.once('close', () => r()); ws.close(); }); await srv?.close(); srv = null;
    if (saved === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });
  const set = async (rid: string, extra: object) => {
    ws.send(JSON.stringify({ type: 'brain.set', rid, ...extra }));
    await until(() => msgs.some(m => m.type === 'rig.result' && m.rid === rid));
    return msgs.find(m => m.type === 'rig.result' && m.rid === rid) as Extract<ServerMessage, { type: 'rig.result' }>;
  };
  const ledgeTexts = () => msgs.filter((m): m is Extract<ServerMessage, { type: 'ledge.thread.item' }> => m.type === 'ledge.thread.item').map(m => m.item).filter(i => i.kind === 'ledge').map(i => (i as { text: string }).text);
  test('first:true + enabled:true announces once in the thread', async () => {
    expect((await set('s1', { enabled: true, first: true })).ok).toBe(true);
    await until(() => ledgeTexts().includes(BRAIN_FIRST_TEXT));
    expect(BRAIN_FIRST_TEXT).toBe('Je pense en continu désormais : je lis les escalades des rigs, je tranche ce que mon mandat permet après une minute, et je te passe le reste.');
  });
  test('when disabling, nothing is announced', async () => {
    expect((await set('s3', { enabled: false, first: true })).ok).toBe(true);
    await new Promise(x => setTimeout(x, 50));
    expect(ledgeTexts()).not.toContain(BRAIN_FIRST_TEXT);
  });
});
