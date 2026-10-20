import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneSession, ThreadItem } from '@ledge/protocol';
import { createStore, type MobileStore } from '../../src/state/store';
import { OPS_KEY, RESEND_MAX_MS, UNCERTAIN_MS } from '../../src/state/operations';
import { LAST_STATE_KEY } from '../../src/state/persist';
import { outcomeFor } from '../../src/model/requestOutcome';
import { pending, session } from '../model/fixtures';
import { fakeLink, MemoryStorage, snapshot } from './helpers';

const stores: MobileStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  vi.useRealTimers();
});

function setup(opts: { state?: Parameters<typeof fakeLink>[0]; storage?: Storage } = {}) {
  const f = fakeLink(opts.state ?? 'ready');
  const storage = opts.storage ?? new MemoryStorage();
  const store = createStore(f.link, storage);
  stores.push(store);
  return { ...f, store, storage, state: () => store.getState() };
}

const waiting = (id: string, extra: Partial<PhoneSession> = {}) => session(id, { state: 'waiting_permission', pending: pending(), ...extra });
const prompt = (id: string, text: string): ThreadItem => ({ kind: 'prompt', id, at: '2026-10-14T10:00:00.000Z', turn: 1, text });

describe('the store, from the PC', () => {
  it('a snapshot replaces everything and makes the state fresh', () => {
    const t = setup();
    expect(t.state()).toMatchObject({ fresh: false, daemon: null, capabilities: null });
    t.deliver(snapshot([session('a'), session('b')]));
    t.deliver({ type: 'session.preview', id: 'b', lines: ['$ pnpm test'] });
    t.deliver(snapshot([session('a', { name: 'Kai' }), session('c')], 'Bureau'));
    const s = t.state();
    expect([...s.sessions.keys()]).toEqual(['a', 'c']);
    expect(s.sessions.get('a')?.name).toBe('Kai');
    expect(s.previews.has('b')).toBe(false);
    expect(s.daemon).toEqual({ version: '0.9.0', name: 'Bureau' });
    expect(s.capabilities?.cursor.freeTextAnswer).toBe(false);
    expect(s.fresh).toBe(true);
    expect(s.syncedAt).not.toBeNull();
  });

  it('session.updated adds a session it did not know, and replaces one it knew', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    t.deliver({ type: 'session.updated', session: session('new', { name: 'Nova' }) });
    t.deliver({ type: 'session.updated', session: session('a', { state: 'working' }) });
    expect([...t.state().sessions.keys()]).toEqual(['a', 'new']);
    expect(t.state().sessions.get('a')?.state).toBe('working');
    expect(t.state().sessions.get('new')?.name).toBe('Nova');
  });

  it('session.removed drops the session, and its open thread is gone', () => {
    const t = setup();
    t.deliver(snapshot([session('a'), session('b')]));
    t.store.openThread('a');
    expect(t.of('session.thread')).toEqual([{ type: 'session.thread', id: 'a' }]);
    expect(t.state().threads.get('a')?.status).toBe('loading');
    t.deliver({ type: 'session.thread', id: 'a', items: [prompt('i1', 'Bonjour')], cut: [], more: false });
    expect(t.state().threads.get('a')).toMatchObject({ status: 'ready', items: [{ id: 'i1' }], more: false });
    t.deliver({ type: 'session.removed', id: 'a' });
    expect(t.state().sessions.has('a')).toBe(false);
    expect(t.state().threads.get('a')?.status).toBe('gone');
  });

  it('a thread item updates its row in place or is added at the end', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    t.store.openThread('a');
    t.deliver({ type: 'session.thread', id: 'a', items: [prompt('i1', 'Un'), prompt('i2', 'Deux')], cut: [], more: true });
    t.deliver({ type: 'session.thread.item', id: 'a', item: prompt('i1', 'Un bis'), cut: true });
    t.deliver({ type: 'session.thread.item', id: 'a', item: prompt('i3', 'Trois') });
    const th = t.state().threads.get('a')!;
    expect(th.items.map(i => [i.id, 'text' in i ? i.text : ''])).toEqual([['i1', 'Un bis'], ['i2', 'Deux'], ['i3', 'Trois']]);
    expect(th.cut).toEqual(['i1']);
  });

  it('a thread asked of a session the PC no longer knows is gone', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    t.store.openThread('zz');
    t.deliver({ type: 'error', code: 'unknown_session', request: 'session.thread' });
    expect(t.state().threads.get('zz')?.status).toBe('gone');
  });

  it('an unknown_session error goes to the oldest thread still unanswered, not the last one asked', () => {
    const t = setup();
    t.deliver(snapshot([session('b')]));
    t.store.openThread('a');
    t.store.openThread('b');
    t.deliver({ type: 'error', code: 'unknown_session', request: 'session.thread' });
    expect(t.state().threads.get('a')?.status).toBe('gone');
    expect(t.state().threads.get('b')?.status).toBe('loading');
    t.deliver({ type: 'session.thread', id: 'b', items: [], cut: [], more: false });
    expect(t.state().threads.get('b')?.status).toBe('ready');
    t.store.openThread('c');
    t.store.openThread('d');
    t.deliver({ type: 'session.thread', id: 'c', items: [], cut: [], more: false });
    t.deliver({ type: 'error', code: 'unknown_session', request: 'session.thread' });
    expect(t.state().threads.get('c')?.status).toBe('ready');
    expect(t.state().threads.get('d')?.status).toBe('gone');
  });

  it('losing the channel makes the state stale, the sessions kept', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    t.set('pc_offline');
    expect(t.state().fresh).toBe(false);
    expect(t.state().sessions.has('a')).toBe(true);
  });

  it('notifies on change and keeps the same state object otherwise, as useSyncExternalStore needs', () => {
    const t = setup();
    const seen = vi.fn();
    t.store.subscribe(seen);
    const before = t.state();
    expect(t.state()).toBe(before);
    t.deliver({ type: 'session.updated', session: session('a') });
    expect(seen).toHaveBeenCalled();
    expect(t.state()).not.toBe(before);
  });

  it('the full body of a request replaces the shortened one, and a later shortened copy of the same request keeps it', () => {
    const t = setup();
    t.deliver(snapshot([waiting('a', { pending: pending({ kind: 'plan', text: 'Plan', body: 'court', cut: true }) })]));
    t.store.loadPending('a');
    expect(t.of('session.pending')).toEqual([{ type: 'session.pending', id: 'a' }]);
    t.deliver({ type: 'session.pending', id: 'a', pending: pending({ kind: 'plan', text: 'Plan', body: 'le plan entier' }) });
    expect(t.state().sessions.get('a')?.pending).toMatchObject({ body: 'le plan entier' });
    expect(t.state().sessions.get('a')?.pending).not.toHaveProperty('cut');
    t.deliver({ type: 'session.updated', session: waiting('a', { lastActivityAt: '2026-10-14T10:01:00.000Z', pending: pending({ kind: 'plan', text: 'Plan', body: 'court', cut: true }) }) });
    expect(t.state().sessions.get('a')?.pending).toMatchObject({ body: 'le plan entier' });
    t.deliver({ type: 'session.updated', session: waiting('a', { pending: pending({ key: 'p2', kind: 'plan', text: 'Autre', body: 'x', cut: true }) }) });
    expect(t.state().sessions.get('a')?.pending).toMatchObject({ key: 'p2', body: 'x', cut: true });
  });

  it('watch goes to the link', () => {
    const t = setup();
    t.store.watch('a');
    t.store.watch(null);
    expect(t.of('session.watch')).toEqual([{ type: 'session.watch', id: 'a' }, { type: 'session.watch', id: null }]);
  });
});

describe('the store, writing', () => {
  it('a reply with no request waiting says so with expect: null', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    const op = t.store.reply('a', 'Lance les tests');
    expect(op).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.of('session.reply')).toEqual([{ type: 'session.reply', op, id: 'a', text: 'Lance les tests', expect: null }]);
    expect(t.state().ops[op!]).toMatchObject({ op, phase: 'sending', message: { type: 'session.reply', op } });
  });

  it('a reply to a request names the request it answers', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { state: 'waiting_input', pending: pending({ key: 'q1', kind: 'question', text: 'Quel thème ?', options: ['Clair', 'Sombre'] }) })]));
    const op = t.store.reply('a', '2');
    expect(t.of('session.reply')).toEqual([{ type: 'session.reply', op, id: 'a', text: '2', expect: { key: 'q1', kind: 'question', text: 'Quel thème ?' } }]);
  });

  it('a decision always names its request, and is refused when there is none', () => {
    const t = setup();
    t.deliver(snapshot([waiting('a'), session('b')]));
    const op = t.store.decide('a', 'accept');
    expect(t.of('session.decide')).toEqual([{ type: 'session.decide', op, id: 'a', decision: 'accept', expect: { key: 'p1', kind: 'permission', text: 'pnpm test' } }]);
    expect(t.store.decide('b', 'accept')).toBeNull();
    expect(t.of('session.decide')).toHaveLength(1);
  });

  it('a deny carries its note', () => {
    const t = setup();
    t.deliver(snapshot([waiting('a')]));
    const op = t.store.decide('a', 'deny', { note: 'Pas maintenant' });
    expect(t.of('session.decide')[0]).toMatchObject({ op, decision: 'deny', note: 'Pas maintenant' });
  });

  it('the same request is not answered twice while the first answer is on its way', () => {
    const t = setup();
    t.deliver(snapshot([waiting('a')]));
    expect(t.store.decide('a', 'accept')).not.toBeNull();
    expect(t.store.decide('a', 'deny')).toBeNull();
    expect(t.of('session.decide')).toHaveLength(1);
  });

  it('nothing is written while the link is not ready', () => {
    const t = setup({ state: 'pc_offline' });
    t.deliver(snapshot([waiting('a')]));
    expect(t.store.decide('a', 'accept')).toBeNull();
    expect(t.store.reply('a', 'x')).toBeNull();
    expect(t.store.interrupt('a')).toBeNull();
    expect(t.sent).toEqual([]);
  });

  it('an interrupt is an operation of its own', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { state: 'working' })]));
    const op = t.store.interrupt('a');
    expect(t.of('session.interrupt')).toEqual([{ type: 'session.interrupt', op, id: 'a' }]);
  });

  it('a message the PC would refuse as invalid is never sent', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    expect(t.store.reply('a', '')).toBeNull();
    expect(t.store.reply('a', 'x'.repeat(20_001))).toBeNull();
    expect(t.sent).toEqual([]);
  });

  it('operation results move the operation on', () => {
    const t = setup();
    t.deliver(snapshot([waiting('a')]));
    const op = t.store.decide('a', 'accept')!;
    t.deliver({ type: 'operation.result', op, status: 'received' });
    expect(t.state().ops[op]?.phase).toBe('sending');
    t.deliver({ type: 'operation.result', op, status: 'applied' });
    expect(t.state().ops[op]?.phase).toBe('applied');
    t.deliver({ type: 'operation.result', op, status: 'rejected', reason: 'stale' });
    expect(t.state().ops[op]?.phase).toBe('applied');
  });
});

describe('the store, across reconnections', () => {
  it('an operation with no result after 10 s is uncertain, and is sent again with the same op at the next ready', () => {
    vi.useFakeTimers();
    const t = setup();
    t.deliver(snapshot([waiting('a')]));
    const op = t.store.decide('a', 'accept')!;
    vi.advanceTimersByTime(UNCERTAIN_MS - 1);
    expect(t.state().ops[op]?.phase).toBe('sending');
    vi.advanceTimersByTime(1);
    expect(t.state().ops[op]?.phase).toBe('uncertain');
    t.set('pc_offline');
    t.set('handshaking');
    t.set('ready');
    const decides = t.of('session.decide');
    expect(decides).toHaveLength(2);
    expect(decides[1]).toEqual(decides[0]);
    expect(t.state().ops[op]?.phase).toBe('sending');
    t.deliver({ type: 'operation.result', op, status: 'applied' });
    t.set('pc_offline');
    t.set('ready');
    expect(t.of('session.decide')).toHaveLength(2);
  });

  it('a received operation does not turn uncertain while the link holds', () => {
    vi.useFakeTimers();
    const t = setup();
    t.deliver(snapshot([waiting('a')]));
    const op = t.store.decide('a', 'accept')!;
    t.deliver({ type: 'operation.result', op, status: 'received' });
    vi.advanceTimersByTime(UNCERTAIN_MS * 3);
    expect(t.state().ops[op]?.phase).toBe('sending');
  });

  it('losing the link before the result makes the operation uncertain at once, and it is sent again after', () => {
    const t = setup();
    t.deliver(snapshot([session('a')]));
    const op = t.store.reply('a', 'Lance les tests')!;
    t.set('pc_offline');
    expect(t.state().ops[op]?.phase).toBe('uncertain');
    t.set('ready');
    expect(t.of('session.reply').map(m => m.op)).toEqual([op, op]);
  });

  it('a stale refusal asks for the new request and shows it', () => {
    const t = setup();
    t.deliver(snapshot([waiting('a')]));
    const op = t.store.decide('a', 'accept')!;
    t.deliver({ type: 'operation.result', op, status: 'rejected', reason: 'stale' });
    expect(t.of('session.pending')).toEqual([{ type: 'session.pending', id: 'a' }]);
    t.deliver({ type: 'session.pending', id: 'a', pending: pending({ key: 'p2', text: 'pnpm build' }) });
    const s = t.state();
    expect(s.sessions.get('a')?.pending).toMatchObject({ key: 'p2', text: 'pnpm build' });
    expect(s.ops[op]).toMatchObject({ phase: 'rejected', reason: 'stale' });
    expect(outcomeFor({ sessionId: 'a', key: 'p1' }, [...s.sessions.values()], s.ops)).toEqual({ kind: 'changed' });
    expect(outcomeFor({ sessionId: 'a', key: 'p2' }, [...s.sessions.values()], s.ops)).toEqual({ kind: 'idle' });
  });

  it('read marks are sent, and sent again after every ready', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { unread: true }), session('b', { unread: true })]));
    t.store.read('a', '2026-10-14T10:05:00.000Z');
    t.store.read('a', '2026-10-14T10:01:00.000Z');
    t.store.read('b', '2026-10-14T10:02:00.000Z');
    expect(t.state().sessions.get('a')?.unread).toBe(false);
    // An older mark than the one already made is not sent.
    expect(t.of('session.read').map(m => [m.id, m.at])).toEqual([['a', '2026-10-14T10:05:00.000Z'], ['b', '2026-10-14T10:02:00.000Z']]);
    t.set('pc_offline');
    t.set('ready');
    expect(t.of('session.read').slice(2)).toEqual([
      { type: 'session.read', id: 'a', at: '2026-10-14T10:05:00.000Z' },
      { type: 'session.read', id: 'b', at: '2026-10-14T10:02:00.000Z' }
    ]);
    t.set('handshaking');
    t.set('ready');
    expect(t.of('session.read')).toHaveLength(6);
  });

  it('an instruction left uncertain too long is not sent again, and no longer blocks a new one; a decision still is', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T10:00:00.000Z'));
    const t = setup();
    t.deliver(snapshot([session('a'), waiting('b')]));
    const old = t.store.reply('a', 'Lance les tests')!;
    const stop = t.store.interrupt('a')!;
    const decision = t.store.decide('b', 'accept')!;
    t.set('pc_offline');
    vi.setSystemTime(Date.parse('2026-10-14T10:00:00.000Z') + RESEND_MAX_MS);
    t.set('ready');
    expect(t.of('session.reply').map(m => m.op)).toEqual([old]);
    expect(t.of('session.interrupt').map(m => m.op)).toEqual([stop]);
    expect(t.of('session.decide').map(m => m.op)).toEqual([decision, decision]);
    expect(t.state().ops[old]?.phase).toBe('uncertain');
    expect(t.state().ops[stop]?.phase).toBe('uncertain');
    const next = t.store.reply('a', 'Lance les tests');
    expect(next).not.toBeNull();
    expect(next).not.toBe(old);
    expect(t.store.interrupt('a')).not.toBeNull();
  });

  it('a read made offline is sent at the next ready', () => {
    const t = setup({ state: 'pc_offline' });
    t.store.read('a', '2026-10-14T10:05:00.000Z');
    expect(t.sent).toEqual([]);
    t.set('ready');
    expect(t.of('session.read')).toEqual([{ type: 'session.read', id: 'a', at: '2026-10-14T10:05:00.000Z' }]);
  });
});

describe('the store, cached on the phone', () => {
  it('a reload shows the last sessions, not fresh', () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    first.deliver(snapshot([session('a', { name: 'Kai' }), waiting('b')]));
    first.deliver({ type: 'session.preview', id: 'a', lines: ['ok'] });
    first.store.close();
    const again = setup({ storage, state: 'handshaking' });
    const s = again.state();
    expect([...s.sessions.keys()]).toEqual(['a', 'b']);
    expect(s.sessions.get('a')?.name).toBe('Kai');
    expect(s.previews.get('a')).toEqual(['ok']);
    expect(s.daemon?.name).toBe('Atelier');
    expect(s.fresh).toBe(false);
    expect(s.syncedAt).not.toBeNull();
  });

  it('a terminal preview does not rewrite the cache by itself; the next write or close keeps it', () => {
    const storage = new MemoryStorage();
    const t = setup({ storage });
    t.deliver(snapshot([session('a'), session('b')]));
    const before = storage.getItem(LAST_STATE_KEY);
    t.deliver({ type: 'session.preview', id: 'a', lines: ['$ pnpm test'] });
    t.deliver({ type: 'session.preview', id: 'a', lines: ['$ pnpm test', 'ok'] });
    expect(storage.getItem(LAST_STATE_KEY)).toBe(before);
    t.deliver({ type: 'session.updated', session: session('b', { state: 'working' }) });
    expect(JSON.parse(storage.getItem(LAST_STATE_KEY)!).previews).toEqual({ a: ['$ pnpm test', 'ok'] });
    t.deliver({ type: 'session.preview', id: 'b', lines: ['…'] });
    t.store.close();
    expect(JSON.parse(storage.getItem(LAST_STATE_KEY)!).previews).toEqual({ a: ['$ pnpm test', 'ok'], b: ['…'] });
  });

  it('a cache that does not parse, or holds an invalid session, is dropped', () => {
    const storage = new MemoryStorage();
    storage.setItem(LAST_STATE_KEY, '{nope');
    expect(setup({ storage }).state().sessions.size).toBe(0);
    storage.setItem(LAST_STATE_KEY, JSON.stringify({ sessions: [session('a'), { id: 'b' }], previews: {}, daemon: null, syncedAt: null }));
    expect([...setup({ storage }).state().sessions.keys()]).toEqual(['a']);
  });

  it('operations survive a reload: one still on its way is uncertain, then sent again with the same op', () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    first.deliver(snapshot([waiting('a')]));
    const op = first.store.decide('a', 'accept')!;
    first.store.close();
    expect(storage.getItem(OPS_KEY)).toContain(op);
    const again = setup({ storage, state: 'pc_offline' });
    expect(again.state().ops[op]?.phase).toBe('uncertain');
    again.set('ready');
    expect(again.of('session.decide').map(m => m.op)).toEqual([op]);
  });

  it('no ledge.mobile.* key holds a private key', () => {
    const storage = new MemoryStorage();
    const t = setup({ storage });
    t.deliver(snapshot([waiting('a'), session('b')]));
    t.store.decide('a', 'accept');
    t.store.reply('b', 'Bonjour');
    t.store.read('b', '2026-10-14T10:05:00.000Z');
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!);
    expect(keys.filter(k => k.startsWith('ledge.mobile.')).length).toBeGreaterThan(0);
    for (const k of keys) {
      const v = storage.getItem(k) ?? '';
      expect(v).not.toMatch(/privateKey|pkcs8/i);
    }
  });

  it('close stops listening to the link', () => {
    const t = setup();
    expect(t.listening()).toBeGreaterThan(0);
    t.store.close();
    expect(t.listening()).toBe(0);
  });
});
