// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ClientMessage, Goal, ServerMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/client';
import { useOpenRigGoals } from '../src/openrigGoals';

function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => listeners.forEach(f => f(m))), listeners };
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

  it('send makes a goal id, a retry reuses it; a reply and a send left waiting resolve as offline with their own type', async () => {
    const { client, sent, emit, listeners } = fake();
    const { result, unmount } = renderHook(() => useOpenRigGoals(client, 'local'));
    const p = result.current.send('La pochette', '/w');
    const m = sent.find(x => x.type === 'openrig.goal.send') as Extract<ClientMessage, { type: 'openrig.goal.send' }>;
    expect(m).toMatchObject({ text: 'La pochette', folder: '/w', machineId: 'local' });
    expect(m.goalId).toMatch(/^[0-9a-f-]{36}$/);
    emit({ type: 'openrig.goal.sent', requestId: rid(m), machineId: 'local', goalId: m.goalId, ok: false, error: 'uncertain' });
    expect(await p).toMatchObject({ ok: false, error: 'uncertain', goalId: m.goalId });
    void result.current.send('La pochette', '/w', m.goalId);
    expect((sent.at(-1) as { goalId: string }).goalId).toBe(m.goalId);
    const r = result.current.reply(m.goalId, 'Prends Ida');
    unmount();
    expect(await r).toMatchObject({ type: 'openrig.goal.replied', ok: false, error: 'offline', goalId: m.goalId });
    expect(listeners.size).toBe(0);
  });
});
