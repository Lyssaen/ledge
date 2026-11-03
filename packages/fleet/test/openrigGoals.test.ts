// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ClientMessage, Goal, ServerMessage } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { useOpenRigGoals } from '../src/openrigGoals';

function fake(initial: DaemonStatus = 'open') {
  const listeners = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>(), sent: ClientMessage[] = [];
  let status = initial;
  const client = {
    send: (m: ClientMessage) => { sent.push(m); }, status: () => status,
    onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
    onStatus: (f: (s: DaemonStatus) => void) => { statuses.add(f); return () => { statuses.delete(f); }; }
  } as unknown as DaemonClient;
  return { client, sent, listeners, emit: (m: ServerMessage) => act(() => listeners.forEach(f => f(m))),
    drop: () => act(() => { status = 'connecting'; statuses.forEach(f => f(status)); }) };
}
const rid = (m: ClientMessage | undefined) => (m as { requestId: string }).requestId;
const GOAL: Goal = { goalId: 'g1', qitemId: 'qitem-ledge-goal-g1', text: 'x', folder: null, sentAt: '', to: 'operator-agent@kernel', state: 'sent', proposal: null, question: null, trail: [], current: null };

describe('useOpenRigGoals', () => {
  it('asks at once, takes its answer and every push of its machine, says partial', () => {
    const { client, sent, emit } = fake();
    const { result } = renderHook(() => useOpenRigGoals(client, 'local'));
    expect(result.current.loading).toBe(true);
    emit({ type: 'openrig.goalsChanged', requestId: rid(sent[0]), machineId: 'local', goals: [GOAL] });
    expect(result.current).toMatchObject({ goals: [GOAL], partial: false, loading: false });
    emit({ type: 'openrig.goalsChanged', machineId: 'other', goals: [] });
    expect(result.current.goals).toEqual([GOAL]);
    emit({ type: 'openrig.goalsChanged', machineId: 'local', goals: [GOAL], partial: true });
    expect(result.current.partial).toBe(true);
  });

  it('send makes a goal id and a retry reuses it; its answer ends it', async () => {
    const { client, sent, emit } = fake();
    const { result } = renderHook(() => useOpenRigGoals(client, 'local'));
    const p = result.current.send('La pochette', '/w');
    const m = sent.find(x => x.type === 'openrig.goal.send') as Extract<ClientMessage, { type: 'openrig.goal.send' }>;
    expect(m).toMatchObject({ text: 'La pochette', folder: '/w', machineId: 'local' });
    expect(m.goalId).toMatch(/^[0-9a-f-]{36}$/);
    emit({ type: 'openrig.goal.sent', requestId: rid(m), machineId: 'local', goalId: m.goalId, ok: true, qitemId: 'q' });
    expect(await p).toMatchObject({ ok: true, goalId: m.goalId });
    void result.current.send('La pochette', '/w', m.goalId);
    expect((sent.at(-1) as { goalId: string }).goalId).toBe(m.goalId);
  });

  it('always ends: offline when nothing left, uncertain when the connection drops or nothing comes back in time, with the ids to retry', async () => {
    vi.useFakeTimers();
    try {
      const closed = fake('connecting');
      const { result: r0 } = renderHook(() => useOpenRigGoals(closed.client, 'local'));
      expect(await r0.current.send('x', undefined, 'g-off')).toMatchObject({ ok: false, error: 'offline', goalId: 'g-off' });
      expect(closed.sent.some(m => m.type === 'openrig.goal.send')).toBe(false);

      const f = fake();
      const { result } = renderHook(() => useOpenRigGoals(f.client, 'local', 60_000, 1000));
      const dropped = result.current.reply('g1', 'Prends Ida');
      const sentReply = f.sent.find(m => m.type === 'openrig.goal.reply') as Extract<ClientMessage, { type: 'openrig.goal.reply' }>;
      f.drop();
      expect(await dropped).toMatchObject({ type: 'openrig.goal.replied', ok: false, error: 'uncertain', goalId: 'g1', replyId: sentReply.replyId });

      const g = fake();
      const { result: r2 } = renderHook(() => useOpenRigGoals(g.client, 'local', 60_000, 1000));
      const late = r2.current.send('x', undefined, 'g-late');
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(await late).toMatchObject({ ok: false, error: 'uncertain', goalId: 'g-late' });
      // An answer arriving after that is ignored: the caller already has its end.
      g.emit({ type: 'openrig.goal.sent', requestId: rid(g.sent.find(m => m.type === 'openrig.goal.send')), goalId: 'g-late', ok: true });
    } finally { vi.useRealTimers(); }
  });

  it('a reply\'s end carries its replyId, and leaving ends what waits', async () => {
    const { client, sent, emit, listeners } = fake();
    const { result, unmount } = renderHook(() => useOpenRigGoals(client, 'local'));
    const p = result.current.reply('g1', 'Prends Ida', 'r-1');
    const m = sent.find(x => x.type === 'openrig.goal.reply')!;
    emit({ type: 'openrig.goal.replied', requestId: rid(m), machineId: 'local', goalId: 'g1', replyId: 'r-1', ok: true, qitemId: 'q' });
    expect(await p).toMatchObject({ ok: true, replyId: 'r-1' });
    const q = result.current.send('y');
    unmount();
    expect(await q).toMatchObject({ ok: false, error: 'uncertain' });
    expect(listeners.size).toBe(0);
  });
});
