import { beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '@ledge/protocol';
import { newOperationId, OPS_KEY, loadOps, opsReducer, toCheck, type OpEvent, type OpState } from '../src/model/operations';
import { outcomeFor } from '../src/model/requestOutcome';
import { createMobileStore } from '../src/state/store';
import { connectRemote } from '../src/connection/remoteClient';
import { TOKEN_KEY } from '../src/state/persist';

const t = { sessionId: 'a', pendingId: 'p1', pendingVersion: 2 };
const op = (id: string, extra: Partial<OpState> = {}): OpState => ({ operationId: id, sessionId: 'a', pendingId: 'p1', pendingVersion: 2, kind: 'decide', decision: 'accept', phase: 'sending', startedAt: '2026-10-15T10:00:00.000Z', ...extra });
const sessionWith = (pid?: string, version = 2): Session => ({ id: 'a', name: 'Otto', tool: 'claude', cwd: '/w/x', project: 'x', title: 'Otto · x', tmuxSession: null, state: 'waiting_permission', helpers: [], startedAt: '2026-10-09T18:00:00.000Z', lastActivityAt: '2026-10-09T18:00:00.000Z', source: 'launcher', ...(pid ? { pending: { id: pid, version, kind: 'permission', text: 'x' } } : {}) } as Session);
const id1 = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const sent = (o: OpState) => opsReducer({}, { type: 'sent', op: o });

beforeEach(() => localStorage.clear());

describe('opsReducer', () => {
  it('sent, received, result walk the phases', () => {
    let s = sent(op(id1));
    expect(s[id1]!.phase).toBe('sending');
    s = opsReducer(s, { type: 'received', operationId: id1 });
    expect(s[id1]!.phase).toBe('received');
    s = opsReducer(s, { type: 'result', operationId: id1, status: 'applied' });
    expect(s[id1]!.phase).toBe('applied');
    expect(opsReducer(s, { type: 'received', operationId: id1 })[id1]!.phase).toBe('applied');
  });

  it('a rejection keeps its reason', () => {
    const s = opsReducer(sent(op(id1)), { type: 'result', operationId: id1, status: 'rejected', reason: 'stale' });
    expect(s[id1]).toMatchObject({ phase: 'rejected', reason: 'stale' });
  });

  it('a close while sending marks the operation uncertain', () => {
    const s = opsReducer(sent(op(id1)), { type: 'link', link: 'offline' });
    expect(s[id1]!.phase).toBe('uncertain');
    expect(opsReducer(sent(op(id1, { phase: 'received' })), { type: 'link', link: 'connecting' })[id1]!.phase).toBe('uncertain');
  });

  it('staying online changes nothing', () => {
    const s = sent(op(id1));
    expect(opsReducer(s, { type: 'link', link: 'online' })).toBe(s);
  });

  it('resume with an open operation marks it uncertain and asks its status', () => {
    const s = opsReducer(sent(op(id1)), { type: 'resumed' });
    expect(s[id1]!.phase).toBe('uncertain');
    expect(toCheck(s)).toEqual([id1]);
  });

  it('an uncertain operation resolves from its status result', () => {
    let s = opsReducer(sent(op(id1)), { type: 'resumed' });
    s = opsReducer(s, { type: 'result', operationId: id1, status: 'applied' });
    expect(s[id1]!.phase).toBe('applied');
    expect(toCheck(s)).toEqual([]);
  });

  it('a result unknown after a daemon restart is unknown', () => {
    const s = opsReducer(opsReducer(sent(op(id1)), { type: 'resumed' }), { type: 'result', operationId: id1, status: 'unknown' });
    expect(s[id1]!.phase).toBe('unknown');
  });

  it('no event ever produces a new decision', () => {
    const events: OpEvent[] = [
      { type: 'received', operationId: id2 }, { type: 'result', operationId: id2, status: 'applied' },
      { type: 'link', link: 'online' }, { type: 'link', link: 'offline' }, { type: 'resumed' }
    ];
    for (const e of events) {
      const s = opsReducer({}, e);
      expect(Object.keys(s)).toEqual([]);
      const before = { [id1]: op(id1, { phase: 'uncertain' }) };
      const after = opsReducer(before, e);
      expect(Object.values(after).filter(o => o.phase === 'sending')).toEqual([]);
      expect(Object.keys(after)).toEqual([id1]);
    }
  });

  it('newOperationId is a uuid', () => {
    expect(newOperationId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newOperationId()).not.toBe(newOperationId());
  });
});

describe('outcomeFor', () => {
  it('shows each phase', () => {
    expect(outcomeFor(t, [sessionWith('p1')], { [id1]: op(id1) })).toEqual({ kind: 'sending' });
    expect(outcomeFor(t, [sessionWith('p1')], { [id1]: op(id1, { phase: 'uncertain' }) })).toEqual({ kind: 'uncertain' });
    expect(outcomeFor(t, [sessionWith()], { [id1]: op(id1, { phase: 'applied' }) })).toEqual({ kind: 'applied', decision: 'accept' });
    expect(outcomeFor(t, [sessionWith('p1')], { [id1]: op(id1, { phase: 'rejected', reason: 'stale' }) })).toEqual({ kind: 'rejected', reason: 'stale' });
    expect(outcomeFor(t, [sessionWith('p1')], { [id1]: op(id1, { phase: 'failed', reason: 'busy' }) })).toEqual({ kind: 'failed', reason: 'busy' });
  });

  it('unknown operation shows current request state', () => {
    const o = op(id1, { phase: 'unknown' });
    expect(outcomeFor(t, [sessionWith('p1')], { [id1]: o })).toEqual({ kind: 'unknown', stillPending: true });
    expect(outcomeFor(t, [sessionWith()], { [id1]: o })).toEqual({ kind: 'unknown', stillPending: false });
  });

  it('a request gone without an operation of ours is handled elsewhere', () => {
    expect(outcomeFor(t, [sessionWith()], {})).toEqual({ kind: 'handledElsewhere' });
    expect(outcomeFor(t, [], { [id2]: op(id2, { pendingId: 'other', phase: 'applied' }) })).toEqual({ kind: 'handledElsewhere' });
  });

  it('a request that moved to a new version is changed; the same one is idle', () => {
    expect(outcomeFor(t, [sessionWith('p1', 3)], {})).toEqual({ kind: 'changed' });
    expect(outcomeFor(t, [sessionWith('p1', 2)], {})).toEqual({ kind: 'idle' });
  });

  it('an applied answer carries its text', () => {
    const o = op(id1, { kind: 'answer', decision: undefined, text: 'blue', phase: 'applied' });
    expect(outcomeFor(t, [sessionWith()], { [id1]: o })).toEqual({ kind: 'applied', answer: 'blue' });
  });
});

describe('store operations', () => {
  const online = () => { const st = createMobileStore(); const out: unknown[] = []; st.setSender(m => out.push(m)); st.apply({ type: 'auth.ok', deviceId: 'd', deviceName: 'i', pcName: 'PC' }); out.length = 0; return { st, out }; };

  it('submit sends only while online and tracks the operation', () => {
    const { st, out } = online();
    const msg = { type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'p1', pendingVersion: 2, operationId: id1 } as const;
    expect(st.submit(op(id1), msg)).toBe(true);
    expect(out).toEqual([msg]);
    expect(st.getState().ops[id1]!.phase).toBe('sending');
    st.apply({ type: 'operation.received', operationId: id1 });
    st.apply({ type: 'operation.result', operationId: id1, status: 'applied' });
    expect(st.getState().ops[id1]!.phase).toBe('applied');
  });

  it('never sends or queues a decision while not online', () => {
    const { st, out } = online();
    st.setLink('offline');
    const msg = { type: 'session.decide', id: 'a', decision: 'deny', operationId: id2 } as const;
    expect(st.submit(op(id2), msg)).toBe(false);
    st.setLink('connecting');
    expect(st.submit(op(id2), msg)).toBe(false);
    st.apply({ type: 'auth.ok', deviceId: 'd', deviceName: 'i', pcName: 'PC' });
    expect(out).toEqual([]);
    expect(st.getState().ops).toEqual({});
  });

  it('a drop makes the open operation uncertain; auth.ok asks its status and never resends', () => {
    const { st, out } = online();
    st.submit(op(id1), { type: 'session.decide', id: 'a', decision: 'accept', operationId: id1 });
    out.length = 0;
    st.setLink('offline'); st.setLink('connecting');
    expect(st.getState().ops[id1]!.phase).toBe('uncertain');
    st.apply({ type: 'auth.ok', deviceId: 'd', deviceName: 'i', pcName: 'PC' });
    expect(out).toEqual([{ type: 'operation.status', operationId: id1 }]);
    st.apply({ type: 'operation.result', operationId: id1, status: 'unknown' });
    expect(st.getState().ops[id1]!.phase).toBe('unknown');
  });

  it('operations survive a reload, open ones as uncertain, and only 50 finished are kept', () => {
    const { st } = online();
    st.submit(op(id1), { type: 'session.decide', id: 'a', decision: 'accept', operationId: id1 });
    for (let i = 0; i < 55; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      st.dispatch({ type: 'sent', op: op(id) });
      st.dispatch({ type: 'result', operationId: id, status: 'applied' });
    }
    expect(JSON.parse(localStorage.getItem(OPS_KEY)!)).toHaveLength(51);
    const reloaded = createMobileStore();
    expect(reloaded.getState().ops[id1]!.phase).toBe('uncertain');
    expect(Object.keys(loadOps())).toHaveLength(51);
  });

  it('unpairing forgets the operations', () => {
    const { st } = online();
    st.submit(op(id1), { type: 'session.decide', id: 'a', decision: 'accept', operationId: id1 });
    st.reset();
    expect(st.getState().ops).toEqual({});
  });
});

describe('remote client foreground', () => {
  class Ws {
    static all: Ws[] = [];
    sent: string[] = []; readyState = 0;
    onopen: null | (() => void) = null; onclose: null | ((ev: { code?: number }) => void) = null;
    onerror = null; onmessage: null | ((ev: { data: unknown }) => void) = null;
    constructor(public url: string) { Ws.all.push(this); }
    send(d: string) { this.sent.push(d); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    push(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  }

  it('foregrounding shows connecting, marks the open operation uncertain, and checks it after auth', () => {
    Ws.all = []; localStorage.setItem(TOKEN_KEY, 't'.repeat(43));
    const store = createMobileStore();
    const client = connectRemote({ store, url: 'wss://pc/m/ws', WebSocketImpl: Ws as never });
    const first = Ws.all[0]!; first.open();
    first.push({ type: 'auth.ok', deviceId: 'd', deviceName: 'i', pcName: 'PC' });
    expect(store.submit(op(id1), { type: 'session.decide', id: 'a', decision: 'accept', operationId: id1 })).toBe(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.getState().link).toBe('connecting');
    expect(store.getState().ops[id1]!.phase).toBe('uncertain');
    const second = Ws.all[1]!; second.open();
    expect(second.sent.map(x => JSON.parse(x))).toEqual([{ type: 'auth', token: 't'.repeat(43) }]);
    second.push({ type: 'auth.ok', deviceId: 'd', deviceName: 'i', pcName: 'PC' });
    expect(second.sent.map(x => JSON.parse(x)).slice(1)).toEqual([{ type: 'operation.status', operationId: id1 }]);
    client.close();
  });
});
