import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { LedgeThreadItem, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';
import { daemonStore } from '../src/store';
import { answerEscalation, mergeThread, sayToLedge, useAnswerState, useLedgeThread } from '../src/ledgeThread';

const at = (n: number) => new Date(Date.UTC(2026, 9, 30, 8, 0, n)).toISOString();
const say = (id: string, n: number, text = id): Extract<LedgeThreadItem, { kind: 'ledge' }> => ({ kind: 'ledge', id, at: at(n), text });
const fake = () => { const sent: Array<Record<string, unknown>> = []; const client = { connect() {}, close() {}, send: (m: unknown) => { sent.push(m as never); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} } as unknown as DaemonClient; return { client, sent }; };
const ids = () => daemonStore.getState().ledgeThread.map(i => i.id);

beforeEach(() => daemonStore.reset());
afterEach(() => vi.useRealTimers());

describe('mergeThread', () => {
  it('upserts by id in place and sorts by at, arrival order on ties', () => {
    const out = mergeThread([say('a', 1), say('b', 2)], [say('c', 2), { ...say('b', 2), text: 'b2' }, say('z', 0)]);
    expect(out.map(i => i.id)).toEqual(['z', 'a', 'b', 'c']);
    expect((out[2] as { text: string }).text).toBe('b2');
  });
});

describe('thread in the store', () => {
  it('history then items merge by id', () => {
    daemonStore.apply({ type: 'ledge.thread.history', items: [say('a', 1), say('b', 2)] });
    daemonStore.apply({ type: 'ledge.thread.item', item: { ...say('b', 2), text: "b'" } });
    daemonStore.apply({ type: 'ledge.thread.item', item: say('c', 3) });
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect((daemonStore.getState().ledgeThread[1] as { text: string }).text).toBe("b'");
  });
  it('a history after a reconnect keeps what was held', () => {
    daemonStore.apply({ type: 'ledge.thread.history', items: [say('a', 1), say('b', 2)] });
    daemonStore.apply({ type: 'ledge.thread.history', items: [say('b', 2), say('c', 3)] });
    expect(ids()).toEqual(['a', 'b', 'c']);
  });
  it('older history is prepended and before kept; hasOlder false without before', () => {
    const { client, sent } = fake();
    daemonStore.apply({ type: 'ledge.thread.history', items: [say('c', 3), say('d', 4)], before: 'cur-1' });
    const { result } = renderHook(() => useLedgeThread(client));
    expect(result.current.hasOlder).toBe(true);
    act(() => result.current.loadOlder());
    expect(sent).toEqual([{ type: 'ledge.thread.request', before: 'cur-1' }]);
    act(() => result.current.loadOlder()); // one at a time
    expect(sent).toHaveLength(1);
    act(() => daemonStore.apply({ type: 'ledge.thread.history', items: [say('a', 1), say('b', 2)] }));
    expect(result.current.items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.current.hasOlder).toBe(false);
    expect(daemonStore.getState().threadLoading).toBe(false);
  });
});

describe('answers', () => {
  it('sending, then done on rig.result ok', () => {
    const { client, sent } = fake();
    const { result } = renderHook(() => useAnswerState('e1'));
    expect(result.current.state).toBe('idle');
    let rid = '';
    act(() => { rid = answerEscalation(client, 'e1', { q: 'yes' }); });
    expect(sent[0]).toEqual({ type: 'escalation.answer', rid, id: 'e1', answers: { q: 'yes' }, by: 'user' });
    expect(result.current.state).toBe('sending');
    act(() => daemonStore.apply({ type: 'rig.result', rid, ok: true }));
    expect(result.current.state).toBe('done');
  });
  it('rig.result already_answered marks the answer refused with its code', () => {
    const { client } = fake();
    const { result } = renderHook(() => useAnswerState('e1'));
    let rid = '';
    act(() => { rid = answerEscalation(client, 'e1', { q: 'yes' }); });
    act(() => daemonStore.apply({ type: 'rig.result', rid, ok: false, code: 'already_answered', reason: 'late' }));
    expect(result.current).toEqual({ state: 'refused', code: 'already_answered', reason: 'late' });
  });
  it('follows the latest attempt of an id and ignores a foreign rid', () => {
    const { client } = fake();
    const { result } = renderHook(() => useAnswerState('e1'));
    let r1 = '', r2 = '';
    act(() => { r1 = answerEscalation(client, 'e1', {}); });
    act(() => daemonStore.apply({ type: 'rig.result', rid: r1, ok: false, code: 'failed' }));
    act(() => { r2 = answerEscalation(client, 'e1', {}); });
    expect(result.current.state).toBe('sending');
    act(() => daemonStore.apply({ type: 'rig.result', rid: 'other', ok: false, code: 'failed' }));
    expect(result.current.state).toBe('sending');
    act(() => daemonStore.apply({ type: 'rig.result', rid: r2, ok: true }));
    expect(result.current.state).toBe('done');
  });
  it('no result in time is refused with code failed', () => {
    vi.useFakeTimers();
    const { client } = fake();
    const { result } = renderHook(() => useAnswerState('e1'));
    act(() => { answerEscalation(client, 'e1', {}); });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current.state).toBe('refused');
    expect(result.current.code).toBe('failed');
  });
  it('sayToLedge sends ledge.say with a rid, about only when given', () => {
    const { client, sent } = fake();
    sayToLedge(client, 'hi'); sayToLedge(client, 'ça', 'e1');
    expect(sent[0]).toMatchObject({ type: 'ledge.say', text: 'hi' }); expect(sent[0]).not.toHaveProperty('about');
    expect(sent[1]).toMatchObject({ type: 'ledge.say', text: 'ça', about: 'e1' });
    expect(sent[0]!.rid).not.toBe(sent[1]!.rid);
  });
});

// Fleet routing, with two machines.
function peer() {
  const sent: Array<Record<string, unknown>> = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m as never); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
describe('fleet routing', () => {
  const snap: ServerMessage = { type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.30.0', install: 'npm', systemd: true, routing: true } };
  function setup() {
    const peers = [peer(), peer()];
    const api = createFleetClient([LOCAL_MACHINE, { id: 'ec2', label: 'EC2', ssh: 'ec2' }], o => (o.url === LOCAL_MACHINE.url ? peers[0]! : peers[1]!).client, {});
    api.connect(); peers.forEach(p => p.set('open')); peers[0]!.emit(snap); peers[1]!.emit({ ...snap, sshAlias: 'ec2' } as ServerMessage);
    peers[0]!.sent.length = 0; peers[1]!.sent.length = 0;
    return { api, local: peers[0]!, ec2: peers[1]! };
  }
  it('ledge.say, ledge.thread.request and escalation.answer go to local even when ec2 is selected', () => {
    const { api, local, ec2 } = setup();
    api.fleet!.select('ec2');
    api.send({ type: 'ledge.say', rid: 'r1', text: 'hi' });
    api.send({ type: 'ledge.thread.request', before: 'x' });
    api.send({ type: 'escalation.answer', rid: 'r2', id: 'e1', answers: {}, by: 'user' });
    expect(local.sent.map(m => m.type)).toEqual(['ledge.say', 'ledge.thread.request', 'escalation.answer']);
    expect(ec2.sent).toEqual([]);
  });
  it('rig.send goes to msg.machine, rewritten to local', () => {
    const { api, local, ec2 } = setup();
    api.send({ type: 'rig.send', rid: 'r3', machine: 'ec2', seatRef: 'dev@r', text: 'go' });
    expect(local.sent).toEqual([]);
    expect(ec2.sent).toEqual([{ type: 'rig.send', rid: 'r3', machine: 'local', seatRef: 'dev@r', text: 'go' }]);
  });
  it('ledge.thread.* and rig.result from a remote daemon are ignored; the local ones reach the store', () => {
    const { api, local, ec2 } = setup();
    const seen: ServerMessage[] = []; api.onMessage(m => seen.push(m));
    ec2.emit({ type: 'ledge.thread.item', item: say('r', 1) });
    ec2.emit({ type: 'rig.result', rid: 'x', ok: true });
    expect(seen.filter(m => m.type === 'ledge.thread.item' || m.type === 'rig.result')).toEqual([]);
    local.emit({ type: 'ledge.thread.item', item: say('l', 1) });
    expect(seen.map(m => m.type)).toContain('ledge.thread.item');
  });
});
