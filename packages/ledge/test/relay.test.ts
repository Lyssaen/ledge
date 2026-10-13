import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatRelay, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createRelay, type RelayDeps } from '../src/daemon/relay.js';

const T0 = '2026-10-12T08:00:00.000Z';
const mk = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

/** A chat holding relays by qid, in question order, as the service does. */
function fakeChat(relays: Record<string, ChatRelay>) {
  const map = new Map(Object.entries(relays)); let histories = 0;
  const chat: RelayDeps['chat'] = {
    relay: qid => map.get(qid),
    markRelay(qid, patch) { const r = map.get(qid); if (!r) return; const { id, name, tool, text } = r; map.set(qid, { id, name, tool, text, ...patch }); },
    queuedRelays: () => [...map].filter(([, r]) => r.status === 'queued').map(([qid, relay]) => ({ qid, relay }))
  };
  return { chat, map, histories: () => histories, broadcast: () => { histories++; } };
}

let store: Store; let typed: Array<[string, string]>;
let answer: (id: string, text: string) => Promise<string | null>;
const replyTo = (id: string, text: string) => { typed.push([id, text]); return answer(id, text); };
const flush = () => new Promise(r => setTimeout(r, 0));
const otto = (text: string): ChatRelay => ({ id: 's1', name: 'Otto', tool: 'claude', text });

beforeEach(() => {
  store = new Store({ journalPath: join(mkdtempSync(join(tmpdir(), 'relay-')), 'j.json') });
  typed = []; answer = async () => null;
});

describe('createRelay (spec 2026-10-12 relay §4)', () => {
  it('a free session gets the instruction now, and the card is sent', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    const c = fakeChat({ q1: otto('Lance les tests') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast, now: () => '2026-10-12T09:00:00.000Z' });
    await relay.request('q1');
    expect(typed).toEqual([['s1', 'Lance les tests']]);
    expect(c.map.get('q1')).toMatchObject({ status: 'sent', sentAt: '2026-10-12T09:00:00.000Z' });
    relay.close();
  });

  it('two clicks while it is being typed (the session still idle) type it once', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    let release!: () => void; answer = () => new Promise(r => { release = () => r(null); });
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    const first = relay.request('q1');
    await expect(relay.request('q1')).rejects.toThrow('already sent');
    release(); await first;
    await expect(relay.request('q1')).rejects.toThrow('already sent');
    expect(typed).toHaveLength(1);
    relay.close();
  });

  it('a busy session queues it; it goes when the session is free again', async () => {
    store.upsert(mk('s1', { state: 'waiting_permission', pending: { kind: 'permission', text: 'Bash', source: 'hook' } }));
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1');
    expect(c.map.get('q1')!.status).toBe('queued');
    await expect(relay.request('q1')).rejects.toThrow('already queued');
    store.upsert(mk('s1', { state: 'working' })); await flush();
    expect(typed).toEqual([]);
    store.upsert(mk('s1', { state: 'idle' })); await flush();
    expect(typed).toEqual([['s1', 'a']]);
    expect(c.map.get('q1')!.status).toBe('sent');
    relay.close();
  });

  it('two queued for the same session go one per free turn, oldest first, even if the store changes while the first is typed', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('first'), q2: otto('second') });
    let release!: () => void; answer = () => new Promise(r => { release = () => r(null); });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1'); await relay.request('q2');
    store.upsert(mk('s1', { state: 'idle' })); await flush();
    store.upsert(mk('s1', { state: 'idle', lastActivityAt: '2026-10-12T08:01:00.000Z' })); await flush();
    expect(typed).toEqual([['s1', 'first']]);
    release(); await flush();
    expect(c.map.get('q2')!.status).toBe('queued');
    answer = async () => null;
    store.upsert(mk('s1', { state: 'working' })); store.upsert(mk('s1', { state: 'idle' })); await flush();
    expect(typed).toEqual([['s1', 'first'], ['s1', 'second']]);
    relay.close();
  });

  it('cancel puts a queued one back to proposed; nothing to cancel otherwise', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    expect(() => relay.cancel('q1')).toThrow('nothing queued');
    await relay.request('q1'); relay.cancel('q1');
    expect(c.map.get('q1')).toEqual(otto('a'));
    store.upsert(mk('s1', { state: 'idle' })); await flush();
    expect(typed).toEqual([]);
    relay.close();
  });

  it.each(['exited', 'removed'] as const)('a session %s while waiting fails its queued cards', async how => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1');
    if (how === 'exited') store.upsert(mk('s1', { state: 'exited' })); else store.remove('s1');
    await flush();
    expect(c.map.get('q1')).toEqual({ ...otto('a'), error: 'Otto stopped before it got the instruction' });
    await expect(relay.request('q1')).rejects.toThrow('Otto stopped before it got the instruction');
    expect(typed).toEqual([]);
    relay.close();
  });

  it('a failed injection fails the card and the request; Retry may send it again', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    answer = async () => { throw new Error('the agent did not take the answer'); };
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await expect(relay.request('q1')).rejects.toThrow('the agent did not take the answer');
    expect(c.map.get('q1')).toEqual({ ...otto('a'), error: 'the agent did not take the answer' });
    answer = async () => null;
    await relay.request('q1');
    expect(c.map.get('q1')!.status).toBe('sent');
    expect(c.map.get('q1')).not.toHaveProperty('error');
    relay.close();
  });

  it('after a failed injection the server leaves the session in error, which is free: Retry goes at once', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    answer = async id => { store.upsert(mk(id, { state: 'error' })); return 'the agent did not take the answer'; };
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await expect(relay.request('q1')).rejects.toThrow('the agent did not take the answer');
    answer = async () => null;
    await relay.request('q1');
    expect(typed).toHaveLength(2);
    expect(c.map.get('q1')!.status).toBe('sent');
    relay.close();
  });

  it('a queued card goes when the session moves to error without pending', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1');
    store.upsert(mk('s1', { state: 'error' })); await flush();
    expect(typed).toEqual([['s1', 'a']]);
    expect(c.map.get('q1')!.status).toBe('sent');
    relay.close();
  });

  it('a session exiting while its card is being typed leaves the outcome to the delivery, not a stopped flash', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    let release!: () => void; answer = () => new Promise(r => { release = () => r(null); });
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    const p = relay.request('q1');
    c.chat.markRelay('q1', { status: 'queued' }, c.broadcast);
    store.upsert(mk('s1', { state: 'exited' })); await flush();
    expect(c.map.get('q1')!.status).toBe('queued');
    release(); await p;
    expect(c.map.get('q1')).toMatchObject({ status: 'sent' });
    relay.close();
  });

  it('an unknown qid, and a card the chat no longer has (reset, new day), are refused', async () => {
    const c = fakeChat({});
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await expect(relay.request('q9')).rejects.toThrow('unknown relay');
    relay.close();
  });

  it('cancel refuses a card being typed, which ends sent', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('a') });
    let release!: () => void; answer = () => new Promise(r => { release = () => r(null); });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1');
    store.upsert(mk('s1', { state: 'idle' })); await flush();
    expect(() => relay.cancel('q1')).toThrow('already sent');
    release(); await flush();
    expect(c.map.get('q1')!.status).toBe('sent');
    relay.close();
  });

  it('a throw while marking the sent card is logged, not unhandled', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('a') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1');
    const orig = c.chat.markRelay; c.chat.markRelay = () => { throw new Error('boom'); };
    const seen: unknown[] = []; const h = (e: unknown) => seen.push(e); process.on('unhandledRejection', h);
    store.upsert(mk('s1', { state: 'idle' })); await flush(); await flush();
    process.off('unhandledRejection', h); c.chat.markRelay = orig;
    expect(seen).toEqual([]);
    relay.close();
  });

  it('a request on a free session with older cards queued queues itself and delivers the oldest', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('first'), q2: otto('second') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1');
    store.upsert(mk('s1', { state: 'idle' })); await flush(); // q1 typed, session left idle below
    typed.length = 0; c.map.set('q1', { ...otto('first'), status: 'queued' });
    await relay.request('q2');
    expect(typed).toEqual([['s1', 'first']]);
    expect(c.map.get('q2')!.status).toBe('queued');
    relay.close();
  });

  it('a request while another card for the session is being typed is queued, not typed', async () => {
    store.upsert(mk('s1', { state: 'idle' }));
    const c = fakeChat({ q1: otto('a'), q2: otto('b') });
    let release!: () => void; answer = () => new Promise(r => { release = () => r(null); });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    const first = relay.request('q1');
    await relay.request('q2');
    expect(typed).toEqual([['s1', 'a']]);
    expect(c.map.get('q2')!.status).toBe('queued');
    release(); await first; relay.close();
  });

  it('after a refused delivery, the next queued card goes at once if the session is still free', async () => {
    store.upsert(mk('s1'));
    const c = fakeChat({ q1: otto('first'), q2: otto('second') });
    const relay = createRelay({ chat: c.chat, store, replyTo, broadcast: c.broadcast });
    await relay.request('q1'); await relay.request('q2');
    answer = async (_id, t) => (t === 'first' ? 'refused' : null);
    store.upsert(mk('s1', { state: 'idle' })); await flush(); await flush();
    expect(typed).toEqual([['s1', 'first'], ['s1', 'second']]);
    expect(c.map.get('q1')).toEqual({ ...otto('first'), error: 'refused' });
    expect(c.map.get('q2')!.status).toBe('sent');
    relay.close();
  });
});
