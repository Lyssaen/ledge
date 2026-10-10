import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, act, waitFor, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import WebSocket from 'ws';
import { useKeyboard } from '../src/keyboard/useKeyboard';
import { SessionList } from '../src/surface/SessionList';
import { Surface } from '../src/surface/Surface';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { createMockDaemon, fakeSession } from './mockDaemon';

const sessions = [
  fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }),
  fakeSession('b', { name: 'Pim', state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' }, startedAt: '2026-10-09T18:01:00.000Z' }),
  fakeSession('c', { name: 'Lu', startedAt: '2026-10-09T18:02:00.000Z' })
];
const press = (key: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...extra });
const noop = () => {};
const handlers = () => ({ onFocus: vi.fn(), onOpen: vi.fn(), onDecide: vi.fn(), onNextAsk: vi.fn(), onClose: vi.fn(), onReplyFocus: vi.fn(), onToggleDnd: vi.fn(), onHelp: vi.fn() });

describe('useKeyboard', () => {
  it('moves with j/k and digits, opens with Enter, decides with y/n on a permission only', () => {
    const h = handlers();
    const { rerender } = renderHook(({ focusedId }) => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId, ...h }), { initialProps: { focusedId: null as string | null } });
    press('j'); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    rerender({ focusedId: 'a' }); press('j'); expect(h.onFocus).toHaveBeenLastCalledWith('b');
    rerender({ focusedId: 'b' }); press('k'); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    press('3'); expect(h.onFocus).toHaveBeenLastCalledWith('c');
    rerender({ focusedId: 'a' }); press('y'); expect(h.onDecide).toHaveBeenCalledWith('a', 'accept');
    press('n'); expect(h.onDecide).toHaveBeenCalledWith('a', 'deny');
    rerender({ focusedId: 'b' }); press('y'); expect(h.onOpen).toHaveBeenCalledWith('b');
    press('Enter'); expect(h.onOpen).toHaveBeenLastCalledWith('b');
    press('Tab'); expect(h.onNextAsk).not.toHaveBeenCalled();
    press('ArrowRight', { altKey: true }); expect(h.onNextAsk).toHaveBeenCalled();
    press('Escape'); expect(h.onClose).toHaveBeenCalled();
    press('?'); expect(h.onHelp).toHaveBeenCalled();
    press('d'); expect(h.onToggleDnd).toHaveBeenCalled();
  });
  it('does nothing while disabled or while typing in an input', () => {
    const onFocus = vi.fn();
    renderHook(() => useKeyboard({ enabled: false, mode: 'list', sessions, focusedId: null, onFocus, onOpen: noop, onDecide: noop, onNextAsk: noop, onClose: noop, onReplyFocus: noop, onToggleDnd: noop, onHelp: noop }));
    press('j'); expect(onFocus).not.toHaveBeenCalled();
    const onFocus2 = vi.fn();
    renderHook(() => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId: null, onFocus: onFocus2, onOpen: noop, onDecide: noop, onNextAsk: noop, onClose: noop, onReplyFocus: noop, onToggleDnd: noop, onHelp: noop }));
    const input = document.createElement('input'); document.body.appendChild(input); input.focus();
    fireEvent.keyDown(input, { key: 'j' }); expect(onFocus2).not.toHaveBeenCalled();
    input.remove();
  });
  it('never prevents Tab, ignores letters while choosing an option or in a select, but Escape still closes', () => {
    const h = handlers();
    renderHook(() => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId: 'a', ...h }));
    expect(fireEvent.keyDown(window, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })).toBe(true);
    const radio = document.createElement('input'); radio.type = 'radio'; document.body.appendChild(radio); radio.focus();
    fireEvent.keyDown(radio, { key: 'y' }); fireEvent.keyDown(radio, { key: 'ArrowDown' });
    const select = document.createElement('select'); document.body.appendChild(select); select.focus();
    fireEvent.keyDown(select, { key: 'n' }); fireEvent.keyDown(select, { key: 'j' });
    expect(h.onDecide).not.toHaveBeenCalled(); expect(h.onFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(select, { key: 'Escape' }); expect(h.onClose).toHaveBeenCalled();
    radio.remove(); select.remove();
  });
  it('leaves modified keys and Enter on another button to the platform', () => {
    const h = handlers();
    renderHook(() => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId: 'a', ...h }));
    press('d', { ctrlKey: true }); press('y', { metaKey: true }); press('j', { altKey: true });
    expect(h.onToggleDnd).not.toHaveBeenCalled(); expect(h.onDecide).not.toHaveBeenCalled(); expect(h.onFocus).not.toHaveBeenCalled();
    const btn = document.createElement('button'); document.body.appendChild(btn); btn.focus();
    expect(fireEvent.keyDown(btn, { key: 'Enter' })).toBe(true); expect(h.onOpen).not.toHaveBeenCalled();
    btn.remove();
  });
  it('in a session view only decide, reply, next ask, dnd, help and Escape apply', () => {
    const h = handlers();
    renderHook(() => useKeyboard({ enabled: true, mode: 'session', sessions, focusedId: 'a', ...h }));
    press('j'); press('2'); press('Enter');
    expect(h.onFocus).not.toHaveBeenCalled(); expect(h.onOpen).not.toHaveBeenCalled();
    press('y'); expect(h.onDecide).toHaveBeenCalledWith('a', 'accept');
    press('r'); expect(h.onReplyFocus).toHaveBeenCalled();
    press('Escape'); expect(h.onClose).toHaveBeenCalled();
  });
});

describe('<SessionList> focused row', () => {
  it('a focused yes/no row grows to 100 px with real Approve, Deny and Open buttons inside the scroll container', () => {
    const onDecide = vi.fn(), onOpen = vi.fn();
    render(<SessionList sessions={sessions} visible numbered selectedId={null} focusedId="a" dnd={false} onToggleDnd={noop} onOpen={onOpen} onDecide={onDecide} onClose={noop} />);
    const row = document.querySelector('[data-row-id="a"]') as HTMLElement;
    expect(row).toHaveStyle({ height: '100px' });
    expect(row.closest('[data-scroll]')).not.toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /Approve/ })); expect(onDecide).toHaveBeenCalledWith('a', 'accept');
    fireEvent.click(within(row).getByRole('button', { name: /Deny/ })); expect(onDecide).toHaveBeenCalledWith('a', 'deny');
    fireEvent.click(within(row).getByRole('button', { name: /^Open/ })); expect(onOpen).toHaveBeenCalledWith('a');
  });
  it('a focused question or idle row keeps 58 px with no inline actions', () => {
    render(<SessionList sessions={sessions} visible numbered selectedId={null} focusedId="b" dnd={false} onToggleDnd={noop} onOpen={noop} onDecide={noop} onClose={noop} />);
    const row = document.querySelector('[data-row-id="b"]') as HTMLElement;
    expect(row).toHaveStyle({ height: '58px' });
    expect(within(row).queryByRole('button', { name: /Approve/ })).toBeNull();
  });
});

describe('<Surface> keyboard first', () => {
  let mock: Awaited<ReturnType<typeof createMockDaemon>>; let client: ReturnType<typeof createDaemonClient>; let detach: () => void;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const surface = () => document.querySelector('[data-surface]') as HTMLElement;
  const shortcut = () => press('l', { ctrlKey: true, altKey: true });
  const coach = () => screen.queryByRole('dialog', { name: 'Keyboard' });
  beforeEach(async () => {
    try { localStorage.removeItem('ledge.coachmarks'); } catch { /* ignore */ }
    daemonStore.reset(); mock = await createMockDaemon();
    for (const s of sessions) mock.sessions.set(s.id, s);
    client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); detach = attachClient(client); client.connect();
    await sleep(100);
  });
  afterEach(async () => { detach(); client.close(); await mock.close(); });

  it('the shortcut opens a numbered list focused on the oldest ask; y approves it and Escape closes', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => shortcut());
    expect(surface()).toHaveAttribute('data-mode', 'list');
    expect(within(document.querySelector('[data-row-id="a"]') as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(document.querySelector('[data-row-id="a"]')).toHaveStyle({ height: '100px' });
    act(() => press('y'));
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.decide', id: 'a', decision: 'accept' }));
    act(() => press('Escape'));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('j moves the focus, Enter opens, Escape goes back to the list then closes', () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => shortcut());
    act(() => press('j'));
    expect(document.activeElement).toHaveAttribute('aria-label', expect.stringMatching(/Pim/));
    act(() => press('Enter'));
    expect(surface()).toHaveAttribute('data-mode', 'session');
    act(() => press('Escape'));
    expect(surface()).toHaveAttribute('data-mode', 'list');
    act(() => press('Escape'));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('Alt+ArrowRight focuses the next pending row, wrapping', () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => shortcut());
    act(() => press('ArrowRight', { altKey: true }));
    expect(document.activeElement).toHaveAttribute('aria-label', expect.stringMatching(/Pim/));
    act(() => press('ArrowRight', { altKey: true }));
    expect(document.activeElement).toHaveAttribute('aria-label', expect.stringMatching(/Otto/));
  });

  it('r opens the focused row and puts the cursor in the reply field; letters then type', () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => shortcut());
    act(() => press('r'));
    expect(surface()).toHaveAttribute('data-mode', 'session');
    expect(document.activeElement).toHaveAttribute('aria-label', 'Reply to Otto');
    fireEvent.keyDown(document.activeElement!, { key: 'n' });
    expect(mock.received.some(m => m.type === 'session.decide')).toBe(false);
  });

  it('d toggles dnd from the keyboard', () => {
    const onToggleDnd = vi.fn();
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={onToggleDnd} />);
    act(() => shortcut());
    act(() => press('d'));
    expect(onToggleDnd).toHaveBeenCalledTimes(1);
  });

  it('the coachmark shows on the first three keyboard opens only, Got it dismisses and ? brings it back', () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    for (let i = 1; i <= 3; i++) {
      act(() => shortcut());
      expect(coach()).toBeInTheDocument();
      expect(localStorage.getItem('ledge.coachmarks')).toBe(String(i));
      act(() => shortcut());
    }
    act(() => shortcut());
    expect(coach()).toBeNull();
    act(() => press('?'));
    expect(coach()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(coach()).toBeNull();
  });

  it('a mouse-opened list ignores the keyboard commands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
      const zone = document.querySelector('[data-hotzone]') as HTMLElement;
      fireEvent.mouseEnter(zone);
      await act(async () => { vi.advanceTimersByTime(180); });
      expect(surface()).toHaveAttribute('data-mode', 'list');
      act(() => press('y'));
      await sleep(30);
      expect(mock.received.some(m => m.type === 'session.decide')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
