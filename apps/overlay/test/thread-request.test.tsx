import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ClientMessage, Session } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

const sent: ClientMessage[] = [];
const client: DaemonClient = { connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent.length = 0; });
afterEach(() => { vi.useRealTimers(); });
/** The notch has no bot row (lot 4): a session's peek opens from its balloon, here once its finish notice has folded. */
const peekFinished = (s: Session) => {
  act(() => { daemonStore.apply({ type: 'session.updated', session: s }); });
  act(() => { vi.advanceTimersByTime(540); }); act(() => { vi.advanceTimersByTime(6100); });
  fireEvent.click(document.querySelector('[data-unread-say]')!);
};

describe('session thread request', () => {
  it('a peek does not ask the daemon for the thread', () => {
    act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a'), fakeSession('b', { name: 'Pim' })] }); });
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    peekFinished(fakeSession('a', { state: 'idle' }));
    expect(document.querySelector('[data-surface]')).toHaveAttribute('data-mode', 'peek');
    expect(sent.filter(m => m.type === 'session.thread')).toEqual([]);
  });
});
