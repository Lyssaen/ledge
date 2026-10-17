import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

/** The session screen left the island. Clicking a bot opens a peek and never asks for its thread. */
const client: DaemonClient = { connect() {}, close() {}, send() {}, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };
const mode = () => document.querySelector('[data-surface]')!.getAttribute('data-mode');

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); daemonStore.reset(); });
afterEach(() => { vi.useRealTimers(); });

describe('a bot click stays on the peek', () => {
  it('opens the peek and leaves the session layer inert', () => {
    act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a')] }); });
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
    expect(mode()).toBe('peek');
    expect(document.querySelector('[data-layer="peek"]')).not.toHaveAttribute('inert');
    expect(document.querySelector('[data-layer="session"]')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mode()).toBe('handle');
  });
});
