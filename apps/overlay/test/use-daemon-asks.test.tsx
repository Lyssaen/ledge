import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Session } from '@ledge/protocol';
import { useDaemonAsks } from '../src/surface/useDaemonAsks';
import type { DaemonError } from '../src/daemon/store';
import type { DaemonStatus } from '@ledge/client';
import { fakeSession } from './mockDaemon';

const asking = (extra = {}) => fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook', id: 'p1-a', version: 1 }, ...extra });
type Props = { sessions: Session[]; status: DaemonStatus; lastError: DaemonError | null };
const setup = (init: Partial<Props> = {}) => {
  const dispatch = vi.fn();
  const hook = renderHook((p: Props) => useDaemonAsks({ ...p, dnd: false, dispatch, finishedBubble: true }), { initialProps: { sessions: [asking()], status: 'open' as DaemonStatus, lastError: null, ...init } });
  return { dispatch, ...hook };
};

describe('useDaemonAsks decision lock', () => {
  it('one decision per request: a second begin is refused while it is in flight', () => {
    const h = setup();
    let first = false, second = true;
    act(() => { first = h.result.current.begin('a'); second = h.result.current.begin('a'); });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(h.result.current.inFlight.has('a')).toBe(true);
  });

  it('still fails the lock on error', () => {
    const h = setup();
    act(() => { h.result.current.begin('a'); });
    h.rerender({ sessions: [asking()], status: 'open', lastError: { id: 'a', message: 'request changed', seq: 1 } });
    expect(h.result.current.inFlight.has('a')).toBe(false);
    expect(h.result.current.failures.a).toBe('request changed');
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'decisionFailed', id: 'a' });
  });

  it('lock releases on disconnect', () => {
    const h = setup();
    act(() => { h.result.current.begin('a'); });
    h.rerender({ sessions: [asking()], status: 'unreachable', lastError: null });
    expect(h.result.current.inFlight.has('a')).toBe(false);
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'decisionFailed', id: 'a' });
  });

  it('a request replaced by one with another id unlocks the new request', () => {
    const h = setup();
    act(() => { h.result.current.begin('a'); });
    h.rerender({ sessions: [asking({ pending: { kind: 'permission', text: 'npm test', source: 'hook', id: 'p2-b', version: 1 } })], status: 'open', lastError: null });
    expect(h.result.current.inFlight.has('a')).toBe(false);
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'askReplaced', id: 'a' });
  });
});
