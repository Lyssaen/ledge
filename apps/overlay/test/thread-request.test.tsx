import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ClientMessage } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

const sent: ClientMessage[] = [];
const client: DaemonClient = { connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('session thread request', () => {
  it('a peek does not ask the daemon for the thread', () => {
    act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a'), fakeSession('b', { name: 'Pim' })] }); });
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
    expect(document.querySelector('[data-surface]')).toHaveAttribute('data-mode', 'peek');
    expect(sent.filter(m => m.type === 'session.thread')).toEqual([]);
  });
});
