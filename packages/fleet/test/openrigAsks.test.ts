// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ClientMessage, HumanAsk, HumanChannel, ServerMessage } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { useOpenRigAsks, useOpenRigAsksAll } from '../src/openrigAsks';

/** A client with a fleet: `status` is the connection's; `machine(id, s)` sets one machine's connection, as the fleet publishes it. */
function fake(initial: DaemonStatus = 'open') {
  const listeners = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>(), fleetSubs = new Set<() => void>(), sent: ClientMessage[] = [];
  let status = initial;
  const machines = new Map<string, DaemonStatus>([['local', 'open'], ['server', 'open']]);
  const client = {
    send: (m: ClientMessage) => { sent.push(m); }, status: () => status,
    onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
    onStatus: (f: (s: DaemonStatus) => void) => { statuses.add(f); return () => { statuses.delete(f); }; },
    fleet: { machines: () => [...machines].map(([id, st]) => ({ id, status: st })), subscribe: (f: () => void) => { fleetSubs.add(f); return () => { fleetSubs.delete(f); }; } }
  } as unknown as DaemonClient;
  return { client, sent, listeners, emit: (m: ServerMessage) => act(() => listeners.forEach(f => f(m))),
    drop: () => act(() => { status = 'connecting'; statuses.forEach(f => f(status)); }),
    machine: (id: string, st: DaemonStatus) => act(() => { machines.set(id, st); fleetSubs.forEach(f => f()); }) };
}
const rid = (m: ClientMessage | undefined) => (m as { requestId: string }).requestId;
const CHANNEL: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };
const ASK: HumanAsk = { id: 'qitem-1', kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Un modèle ?', body: 'Un modèle ?', bodyTruncated: false, detail: null, evidenceRef: null, questions: [], createdAt: '', updatedAt: '' };

describe('useOpenRigAsks', () => {
  it('asks at once and every poll, takes its own latest answer and every push of its machine', () => {
    vi.useFakeTimers();
    try {
      const { client, sent, emit, listeners } = fake();
      const { result, unmount } = renderHook(() => useOpenRigAsks(client, 'local', 1000));
      expect(sent).toEqual([{ type: 'openrig.asks', requestId: rid(sent[0]), machineId: 'local' }]);
      act(() => { vi.advanceTimersByTime(1000); });
      emit({ type: 'openrig.asksChanged', requestId: rid(sent[0]), machineId: 'local', channel: CHANNEL, asks: [ASK] }); // superseded
      expect(result.current.channel).toBeNull();
      emit({ type: 'openrig.asksChanged', machineId: 'other', channel: CHANNEL, asks: [ASK] }); // another machine
      expect(result.current.asks).toEqual([]);
      emit({ type: 'openrig.asksChanged', machineId: 'local', channel: CHANNEL, asks: [ASK] }); // a push
      expect(result.current).toMatchObject({ channel: CHANNEL, asks: [ASK], truncated: false });
      emit({ type: 'openrig.asksChanged', requestId: rid(sent[1]), machineId: 'local', asks: [], error: 'outdated' });
      expect(result.current.error).toBe('outdated');
      unmount();
      expect(listeners.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('says when a list is partial, and when it no longer is', () => {
    const { client, emit } = fake();
    const { result } = renderHook(() => useOpenRigAsks(client, 'local'));
    expect(result.current.partial).toBe(false);
    emit({ type: 'openrig.asksChanged', machineId: 'local', channel: CHANNEL, asks: [ASK], partial: true });
    expect(result.current).toMatchObject({ partial: true, asks: [ASK] });
    emit({ type: 'openrig.asksChanged', machineId: 'local', channel: CHANNEL, asks: [] });
    expect(result.current).toMatchObject({ partial: false, asks: [] });
  });

  it('answer resolves with its own end; leaving ends what waits as uncertain, with its row', async () => {
    const { client, sent, emit, listeners } = fake();
    const { result, unmount } = renderHook(() => useOpenRigAsks(client, 'local'));
    const p = result.current.answer('qitem-1', { kind: 'words', text: 'Oui' });
    const msg = sent.find(m => m.type === 'openrig.answer')!;
    expect(msg).toEqual({ type: 'openrig.answer', requestId: rid(msg), qitemId: 'qitem-1', answer: { kind: 'words', text: 'Oui' }, machineId: 'local' });
    emit({ type: 'openrig.answered', requestId: rid(msg), machineId: 'local', qitemId: 'qitem-1', ok: false, error: 'unreachable', message: "OpenRig's daemon did not answer" });
    expect(await p).toMatchObject({ ok: false, error: 'unreachable' });
    const q = result.current.answer('qitem-1', { kind: 'seen' });
    unmount();
    expect(await q).toMatchObject({ ok: false, error: 'uncertain', qitemId: 'qitem-1' });
    expect(listeners.size).toBe(0);
  });
});

describe('useOpenRigAsksAll', () => {
  const ask = (id: string, priority: HumanAsk['priority'], updatedAt: string): HumanAsk => ({ ...ASK, id, priority, updatedAt });

  it('asks every machine, merges their asks with their machine, the pressing first; a machine that drops keeps its asks, marked', () => {
    const { client, sent, emit } = fake();
    const { result } = renderHook(() => useOpenRigAsksAll(client, ['local', 'server']));
    const asked = sent.filter(m => m.type === 'openrig.asks');
    expect(asked.map(m => (m as { machineId: string }).machineId)).toEqual(['local', 'server']);
    expect(result.current.partial).toBe(true); // nothing heard yet: nothing is settled
    emit({ type: 'openrig.asksChanged', requestId: rid(asked[0]), machineId: 'local', channel: CHANNEL, asks: [ask('l1', 'routine', '2026-11-02T10:00:00Z')] });
    emit({ type: 'openrig.asksChanged', requestId: rid(asked[1]), machineId: 'server', channel: { ...CHANNEL, person: { address: 'bob@external', name: 'Bob' } },
      asks: [ask('s1', 'routine', '2026-11-02T11:00:00Z'), ask('s2', 'urgent', '2026-11-02T09:00:00Z')] });
    expect(result.current.asks.map(a => `${a.machineId}:${a.id}`)).toEqual(['server:s2', 'server:s1', 'local:l1']);
    expect(result.current.machines.server!.channel!.person!.address).toBe('bob@external'); // each machine its own default person
    expect(result.current.partial).toBe(false);
    // A push from one machine replaces only its own.
    emit({ type: 'openrig.asksChanged', machineId: 'local', channel: CHANNEL, asks: [] });
    expect(result.current.asks.map(a => a.id)).toEqual(['s2', 's1']);
    // The server drops: its asks stay, the view says it.
    act(() => { result.current.refresh(); });
    const again = sent.filter(m => m.type === 'openrig.asks').at(-1)!;
    emit({ type: 'openrig.asksChanged', requestId: rid(again), machineId: 'server', asks: [], error: 'offline' });
    expect(result.current.asks.map(a => a.id)).toEqual(['s2', 's1']);
    expect(result.current.machines.server).toMatchObject({ error: 'offline' });
    expect(result.current.partial).toBe(true);
    // A machine's own partial list marks the whole.
    emit({ type: 'openrig.asksChanged', machineId: 'local', channel: CHANNEL, asks: [], partial: true });
    expect(result.current.machines.local!.partial).toBe(true);
  });

  it('an answer goes to the machine that holds the ask, and comes back to its asker', async () => {
    const { client, sent, emit } = fake();
    const { result } = renderHook(() => useOpenRigAsksAll(client, ['local', 'server']));
    const p = result.current.answer('server', 's1', { kind: 'choice', questionId: 'team', optionId: 'confirm' });
    const m = sent.find(x => x.type === 'openrig.answer')!;
    expect(m).toMatchObject({ machineId: 'server', qitemId: 's1' });
    emit({ type: 'openrig.answered', requestId: rid(m), machineId: 'server', qitemId: 's1', ok: true, outcome: 'answered' });
    expect(await p).toMatchObject({ ok: true, machineId: 'server' });
  });

  it('a machine no longer followed leaves the view', () => {
    const { client, sent, emit } = fake();
    let machines = ['local', 'server'];
    const { result, rerender } = renderHook(() => useOpenRigAsksAll(client, machines));
    const asked = sent.filter(m => m.type === 'openrig.asks');
    emit({ type: 'openrig.asksChanged', requestId: rid(asked[1]), machineId: 'server', channel: CHANNEL, asks: [ask('s1', 'routine', 't')] });
    machines = ['local'];
    rerender();
    expect(result.current.asks).toEqual([]);
    expect(Object.keys(result.current.machines)).toEqual([]);
  });
});

describe('« À toi » answers always end', () => {
  it('offline when nothing left (connection or machine down), uncertain when the connection drops or nothing comes back in time', async () => {
    vi.useFakeTimers();
    try {
      const closed = fake('connecting');
      const { result: r0 } = renderHook(() => useOpenRigAsksAll(closed.client, ['local']));
      expect(await r0.current.answer('local', 'q0', { kind: 'seen' })).toMatchObject({ ok: false, error: 'offline', qitemId: 'q0' });
      expect(closed.sent.some(m => m.type === 'openrig.answer')).toBe(false);

      const f = fake();
      const { result } = renderHook(() => useOpenRigAsksAll(f.client, ['local', 'server'], 60_000, 1000));
      f.machine('server', 'unreachable');
      expect(await result.current.answer('server', 'q1', { kind: 'seen' })).toMatchObject({ ok: false, error: 'offline', machineId: 'server' });
      const inFlight = result.current.answer('local', 'q2', { kind: 'seen' });
      f.drop();
      expect(await inFlight).toMatchObject({ ok: false, error: 'uncertain', qitemId: 'q2', machineId: 'local' });

      const g = fake();
      const { result: r2 } = renderHook(() => useOpenRigAsksAll(g.client, ['local'], 60_000, 1000));
      const late = r2.current.answer('local', 'q3', { kind: 'seen' });
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(await late).toMatchObject({ ok: false, error: 'uncertain', qitemId: 'q3' });
    } finally { vi.useRealTimers(); }
  });

  it('a change of the machines followed does not end an answer on its way', async () => {
    const f = fake();
    let machines = ['local', 'server'];
    const { result, rerender } = renderHook(() => useOpenRigAsksAll(f.client, machines));
    const p = result.current.answer('server', 'q1', { kind: 'seen' });
    machines = ['server', 'local'];
    rerender();
    const m = f.sent.find(x => x.type === 'openrig.answer')!;
    f.emit({ type: 'openrig.answered', requestId: rid(m), machineId: 'server', qitemId: 'q1', ok: true, outcome: 'answered' });
    expect(await p).toMatchObject({ ok: true, qitemId: 'q1' });
  });

  it('a machine whose connection drops is marked at once, its asks kept, and asked again when back', () => {
    const f = fake();
    const { result } = renderHook(() => useOpenRigAsksAll(f.client, ['local', 'server']));
    const first = f.sent.filter(m => m.type === 'openrig.asks');
    f.emit({ type: 'openrig.asksChanged', requestId: rid(first[1]), machineId: 'server', channel: CHANNEL, asks: [ASK] });
    f.emit({ type: 'openrig.asksChanged', requestId: rid(first[0]), machineId: 'local', channel: CHANNEL, asks: [] });
    expect(result.current.partial).toBe(false);
    f.machine('server', 'unreachable');
    expect(result.current.machines.server).toMatchObject({ error: 'offline', asks: [ASK] });
    expect(result.current.partial).toBe(true);
    const before = f.sent.length;
    f.machine('server', 'open');
    expect(f.sent.slice(before)).toEqual([{ type: 'openrig.asks', requestId: expect.any(String), machineId: 'server' }]);
  });
});
