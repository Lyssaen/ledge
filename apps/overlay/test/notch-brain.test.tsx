import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ClientMessage, LedgeDecision } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

const bridge = vi.hoisted(() => ({ focusOverlay: vi.fn(async () => {}), releaseFocus: vi.fn(async () => {}), focusTerminal: vi.fn(async (_t: string) => true) }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), ...bridge }));

let sent: ClientMessage[] = [];
const client = (): DaemonClient => ({ connect() {}, close() {}, send: m => { sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} });
const now = () => new Date().toISOString();

beforeEach(() => { vi.useFakeTimers(); daemonStore.reset(); sent = []; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('the notch and Ledge\'s brain (lot 7)', () => {
  it('a decision Ledge settled shows in the feed from the fleet store (lot 4 tf94a73)', () => {
    render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
    const decision: LedgeDecision = { id: 'd1', escalationId: 'qi-9', by: 'ledge', category: 'git', summary: 'Rebase sur main avant la revue.', answers: {}, at: now() };
    act(() => {
      daemonStore.setStatus('open');
      daemonStore.apply({ type: 'snapshot', sessions: [] });
      daemonStore.apply({ type: 'decisions', items: [decision] });
      daemonStore.apply({ type: 'ledge.thread.history', items: [{ kind: 'decided', id: 'dd1', at: now(), decisionId: 'd1' }] });
    });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, altKey: true })); });
    expect(document.querySelector('[data-surface]')).toHaveAttribute('data-mode', 'chat');
    expect(screen.getByText('Rebase sur main avant la revue.')).toBeInTheDocument();
  });

  it('an idle brain session is not one of the notch\'s sessions', () => {
    render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
    act(() => {
      daemonStore.setStatus('open');
      daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a', { name: 'Otto' }), fakeSession('brain', { name: 'Cerveau', brain: true, state: 'idle' })] });
    });
    expect(screen.queryByText('Cerveau')).toBeNull();
    expect(screen.queryAllByText(/Otto/).length).toBeGreaterThan(0);
  });

  it('a waiting brain reaches the notch: the handle line names it', () => {
    render(<Surface screenH={1080} theme="dark" client={client()} dnd={false} onToggleDnd={() => {}} />);
    act(() => {
      daemonStore.setStatus('open');
      daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('brain', { name: 'Cerveau', brain: true, state: 'idle' })] });
    });
    act(() => { daemonStore.apply({ type: 'session.updated', session: fakeSession('brain', { name: 'Cerveau', brain: true, state: 'waiting_input', pending: { kind: 'question', text: 'Trust this folder?', source: 'hook' } }) }); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryAllByText(/Cerveau/).length).toBeGreaterThan(0);
  });
});
