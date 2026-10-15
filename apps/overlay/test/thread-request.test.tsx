import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ClientMessage, Session } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

const sent: ClientMessage[] = [];
const client: DaemonClient = { connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };
const threadRequests = () => sent.filter(m => m.type === 'session.thread');
const snapshot = (sessions: Session[]) => act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions }); });

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('session thread request', () => {
  it('asks once when a session opens, not again on unrelated updates, and again after a snapshot emptied the threads', () => {
    const a = fakeSession('a'); const b = fakeSession('b', { name: 'Pim', startedAt: '2026-10-09T18:01:00.000Z' });
    snapshot([a, b]);
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    expect(threadRequests()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
    expect(threadRequests()).toEqual([{ type: 'session.thread', id: 'a' }]);
    // The reply is still pending: other traffic rebuilds the store's maps but must not re-request.
    act(() => { daemonStore.apply({ type: 'session.updated', session: { ...b, state: 'working' } }); });
    act(() => { daemonStore.apply({ type: 'session.preview', id: 'b', lines: ['x'] }); });
    expect(threadRequests()).toHaveLength(1);
    // The reply arrives, then a reconnection snapshot empties the threads: requested again.
    act(() => { daemonStore.apply({ type: 'session.thread', id: 'a', items: [] }); });
    expect(threadRequests()).toHaveLength(1);
    snapshot([a, b]);
    expect(threadRequests()).toHaveLength(2);
  });
});
