// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ClientMessage, HumanAsk, HumanChannel, ServerMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/client';
import { useOpenRigAsks } from '../src/openrigAsks';

function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => listeners.forEach(f => f(m))), listeners };
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

  it('answer resolves with its own end; leaving resolves what waits as offline', async () => {
    const { client, sent, emit, listeners } = fake();
    const { result, unmount } = renderHook(() => useOpenRigAsks(client, 'local'));
    const p = result.current.answer('qitem-1', { kind: 'words', text: 'Oui' });
    const msg = sent.find(m => m.type === 'openrig.answer')!;
    expect(msg).toEqual({ type: 'openrig.answer', requestId: rid(msg), qitemId: 'qitem-1', answer: { kind: 'words', text: 'Oui' }, machineId: 'local' });
    emit({ type: 'openrig.answered', requestId: rid(msg), machineId: 'local', qitemId: 'qitem-1', ok: false, error: 'unreachable', message: "OpenRig's daemon did not answer" });
    expect(await p).toMatchObject({ ok: false, error: 'unreachable' });
    const q = result.current.answer('qitem-1', { kind: 'seen' });
    unmount();
    expect(await q).toMatchObject({ ok: false, error: 'offline' });
    expect(listeners.size).toBe(0);
  });
});
