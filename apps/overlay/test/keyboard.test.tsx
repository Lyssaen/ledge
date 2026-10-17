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
import { subscribeOpenInLedge } from '../src/desktop/openInLedge';

vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), setFrame: vi.fn() }));

const sessions = [
  fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }),
  fakeSession('b', { name: 'Pim', state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' }, startedAt: '2026-10-09T18:01:00.000Z' }),
  fakeSession('c', { name: 'Lu', startedAt: '2026-10-09T18:02:00.000Z' })
];
const press = (key: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...extra });
const noop = () => {};
const handlers = () => ({ onFocus: vi.fn(), onOpen: vi.fn(), onDecide: vi.fn(), onClose: vi.fn(), onReplyFocus: vi.fn(), onToggleDnd: vi.fn(), onHelp: vi.fn() });

describe('useKeyboard', () => {
  it('moves with j/k, opens with Enter, decides with y/n on a permission only', () => {
    const h = handlers();
    const { rerender } = renderHook(({ focusedId }) => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId, ...h }), { initialProps: { focusedId: null as string | null } });
    press('j'); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    rerender({ focusedId: 'a' }); press('j'); expect(h.onFocus).toHaveBeenLastCalledWith('b');
    rerender({ focusedId: 'b' }); press('k'); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    rerender({ focusedId: 'a' }); press('y'); expect(h.onDecide).toHaveBeenCalledWith('a', 'accept');
    press('n'); expect(h.onDecide).toHaveBeenCalledWith('a', 'deny');
    rerender({ focusedId: 'b' }); press('y'); expect(h.onOpen).toHaveBeenCalledWith('b');
    press('Enter'); expect(h.onOpen).toHaveBeenLastCalledWith('b');
    press('Tab'); expect(h.onFocus).toHaveBeenCalledTimes(3);
    press('Escape'); expect(h.onClose).toHaveBeenCalled();
    press('?'); expect(h.onHelp).toHaveBeenCalled();
    press('d'); expect(h.onToggleDnd).toHaveBeenCalled();
  });
  it('i focuses the first instruction in the new-session form only, and types as usual once there', () => {
    const onInstruction = vi.fn();
    const { rerender } = renderHook(({ mode }) => useKeyboard({ enabled: true, mode, sessions, focusedId: null, ...handlers(), onInstruction }), { initialProps: { mode: 'list' as 'list' | 'launch' } });
    press('i'); expect(onInstruction).not.toHaveBeenCalled();
    rerender({ mode: 'launch' });
    expect(fireEvent.keyDown(window, { key: 'i' })).toBe(false); expect(onInstruction).toHaveBeenCalledTimes(1);
    const area = document.createElement('textarea'); document.body.appendChild(area); area.focus();
    fireEvent.keyDown(area, { key: 'i' }); expect(onInstruction).toHaveBeenCalledTimes(1);
    area.remove();
  });
  it('does nothing while disabled or while typing in an input', () => {
    const onFocus = vi.fn();
    renderHook(() => useKeyboard({ enabled: false, mode: 'list', sessions, focusedId: null, onFocus, onOpen: noop, onDecide: noop, onClose: noop, onReplyFocus: noop, onToggleDnd: noop, onHelp: noop }));
    press('j'); expect(onFocus).not.toHaveBeenCalled();
    const onFocus2 = vi.fn();
    renderHook(() => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId: null, onFocus: onFocus2, onOpen: noop, onDecide: noop, onClose: noop, onReplyFocus: noop, onToggleDnd: noop, onHelp: noop }));
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
  it('digits no longer move the focus in the list', () => {
    const h = handlers();
    renderHook(() => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId: 'a', ...h }));
    for (const k of ['1', '2', '3']) expect(fireEvent.keyDown(window, { key: k })).toBe(true);
    expect(h.onFocus).not.toHaveBeenCalled(); expect(h.onOpen).not.toHaveBeenCalled();
  });
  it('Alt+ArrowRight and Alt+ArrowLeft focus the next and previous row, wrapping, asks or not', () => {
    const h = handlers();
    const { rerender } = renderHook(({ focusedId }) => useKeyboard({ enabled: true, mode: 'list', sessions, focusedId, ...h }), { initialProps: { focusedId: null as string | null } });
    press('ArrowRight', { altKey: true }); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    press('ArrowLeft', { altKey: true }); expect(h.onFocus).toHaveBeenLastCalledWith('c');
    rerender({ focusedId: 'b' });
    press('ArrowRight', { altKey: true }); expect(h.onFocus).toHaveBeenLastCalledWith('c');
    press('ArrowLeft', { altKey: true }); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    rerender({ focusedId: 'c' });
    press('ArrowRight', { altKey: true }); expect(h.onFocus).toHaveBeenLastCalledWith('a');
    expect(h.onOpen).not.toHaveBeenCalled();
  });
  it('in a session, Alt+ArrowRight and Alt+ArrowLeft open the next and previous session, even while typing', () => {
    const h = handlers();
    renderHook(() => useKeyboard({ enabled: true, mode: 'session', sessions, focusedId: 'a', ...h }));
    press('ArrowRight', { altKey: true }); expect(h.onOpen).toHaveBeenLastCalledWith('b');
    press('ArrowLeft', { altKey: true }); expect(h.onOpen).toHaveBeenLastCalledWith('c');
    const area = document.createElement('textarea'); document.body.appendChild(area); area.focus();
    fireEvent.keyDown(area, { key: 'ArrowRight', altKey: true }); expect(h.onOpen).toHaveBeenCalledTimes(3);
    area.remove();
    expect(h.onFocus).not.toHaveBeenCalled();
  });
  it('a lone session has no neighbour to move to', () => {
    const h = handlers();
    renderHook(() => useKeyboard({ enabled: true, mode: 'session', sessions: [sessions[0]!], focusedId: 'a', ...h }));
    press('ArrowRight', { altKey: true }); press('ArrowLeft', { altKey: true });
    expect(h.onOpen).not.toHaveBeenCalled();
  });
  it('in a session view only decide, reply, neighbours, dnd, help and Escape apply', () => {
    const h = handlers();
    renderHook(() => useKeyboard({ enabled: true, mode: 'session', sessions, focusedId: 'a', ...h }));
    press('j'); press('2'); press('Enter');
    expect(h.onFocus).not.toHaveBeenCalled(); expect(h.onOpen).not.toHaveBeenCalled();
    press('y'); expect(h.onDecide).toHaveBeenCalledWith('a', 'accept');
    press('r'); expect(h.onReplyFocus).toHaveBeenCalled();
    press('Escape'); expect(h.onClose).toHaveBeenCalled();
  });
});

describe('useKeyboard, spec section 5 additions', () => {
  it('o opens the terminal tab of the focused row, or of the open session; never with modifiers or while typing', () => {
    const onTerminal = vi.fn();
    const { rerender } = renderHook(({ mode }) => useKeyboard({ enabled: true, mode, sessions, focusedId: 'b', ...handlers(), onTerminal }), { initialProps: { mode: 'list' as 'list' | 'session' } });
    press('o'); expect(onTerminal).toHaveBeenLastCalledWith('b');
    rerender({ mode: 'session' }); press('o'); expect(onTerminal).toHaveBeenCalledTimes(2);
    press('o', { ctrlKey: true }); expect(onTerminal).toHaveBeenCalledTimes(2);
    const input = document.createElement('input'); document.body.appendChild(input); input.focus();
    fireEvent.keyDown(input, { key: 'o' }); expect(onTerminal).toHaveBeenCalledTimes(2);
    input.remove();
  });
  it('in a session with a question, 1 to 9 choose the option, also from a focused radio, never from a text field', () => {
    const onChooseOption = vi.fn(); const h = handlers();
    const { rerender } = renderHook(({ focusedId }) => useKeyboard({ enabled: true, mode: 'session', sessions, focusedId, ...h, onChooseOption }), { initialProps: { focusedId: 'b' } });
    press('2'); expect(onChooseOption).toHaveBeenLastCalledWith(2);
    expect(h.onFocus).not.toHaveBeenCalled();
    const radio = document.createElement('input'); radio.type = 'radio'; document.body.appendChild(radio); radio.focus();
    fireEvent.keyDown(radio, { key: '1' }); expect(onChooseOption).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(radio, { key: 'ArrowDown' }); fireEvent.keyDown(radio, { key: 'j' });
    expect(h.onFocus).not.toHaveBeenCalled();
    const text = document.createElement('input'); text.type = 'text'; document.body.appendChild(text); text.focus();
    fireEvent.keyDown(text, { key: '3' }); expect(onChooseOption).toHaveBeenCalledTimes(2);
    rerender({ focusedId: 'a' }); document.body.focus(); radio.blur(); text.blur();
    press('2'); expect(onChooseOption).toHaveBeenCalledTimes(2);
    radio.remove(); text.remove();
  });
});

describe('<SessionList> focused row', () => {
  it('a focused yes/no row grows to 100 px with real Approve, Deny and Open buttons inside the scroll container', () => {
    const onDecide = vi.fn(), onOpen = vi.fn();
    render(<SessionList sessions={sessions} visible selectedId={null} focusedId="a" dnd={false} onToggleDnd={noop} onOpen={onOpen} onDecide={onDecide} onClose={noop} />);
    const row = document.querySelector('[data-row-id="a"]') as HTMLElement;
    expect(row).toHaveStyle({ height: '100px' });
    expect(row.closest('[data-scroll]')).not.toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /Approve/ })); expect(onDecide).toHaveBeenCalledWith('a', 'accept');
    fireEvent.click(within(row).getByRole('button', { name: /Deny/ })); expect(onDecide).toHaveBeenCalledWith('a', 'deny');
    fireEvent.click(within(row).getByRole('button', { name: /^Open/ })); expect(onOpen).toHaveBeenCalledWith('a');
  });
  it('a focused question or idle row keeps 58 px with no inline actions', () => {
    render(<SessionList sessions={sessions} visible selectedId={null} focusedId="b" dnd={false} onToggleDnd={noop} onOpen={noop} onDecide={noop} onClose={noop} />);
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
  beforeEach(async () => {
    try { localStorage.removeItem('ledge.coachmarks'); } catch { /* ignore */ }
    daemonStore.reset(); mock = await createMockDaemon();
    for (const s of sessions) mock.sessions.set(s.id, s);
    client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); detach = attachClient(client); client.connect();
    await sleep(100);
  });
  afterEach(async () => { detach(); client.close(); await mock.close(); });

  it('the shortcut opens the oldest ask; Escape sets it aside and y approves the one left', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => shortcut());
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(screen.getByText('Otto needs your approval')).toBeInTheDocument();
    act(() => press('Escape'));
    expect(screen.getByText('Pim has a question')).toBeInTheDocument();
    act(() => press('Escape'));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    act(() => shortcut());
    expect(screen.getByText('Otto needs your approval')).toBeInTheDocument();
    act(() => press('y'));
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.decide', id: 'a', decision: 'accept' }));
  });

  it('a second shortcut from the ask opens the chat, and from the chat it folds', () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => shortcut());
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    act(() => shortcut());
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    expect(screen.queryByRole('button', { name: 'Back to sessions' })).toBeNull();
    act(() => shortcut());
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('Ctrl+Alt+N notes a launch for Ledge Desktop and does not open a form', () => {
    const heard: unknown[] = [];
    const stop = subscribeOpenInLedge(t => heard.push(t));
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => press('n', { ctrlKey: true, altKey: true }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    act(() => press('n', { ctrlKey: true, altKey: true }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(heard).toEqual([{ kind: 'launch' }, { kind: 'launch' }]);
    stop();
  });

  it('o on an ask notes the session for Ledge Desktop and does not focus a terminal', () => {
    const heard: unknown[] = [];
    const stop = subscribeOpenInLedge(t => heard.push(t));
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => shortcut());
    act(() => press('o'));
    expect(heard).toEqual([{ kind: 'session', id: 'a' }]);
    expect(mock.received.some(m => m.type === 'session.focus')).toBe(false);
    stop();
  });

  it('the ask field stays off until the daemon connection is open', () => {
    act(() => daemonStore.setStatus('connecting'));
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    act(() => shortcut());
    // The list's field and the chat's composer alike.
    const fields = () => [...document.querySelectorAll<HTMLInputElement>('[data-ask-input]')];
    expect(fields().length).toBeGreaterThan(0);
    expect(fields().every(f => f.disabled)).toBe(true);
    act(() => daemonStore.setStatus('open'));
    expect(fields().every(f => !f.disabled)).toBe(true);
  });

  it('digits choose a question on the card; a short answer in the field is what gets sent', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
    await act(async () => { mock.upsert({ ...sessions[1]!, pending: { kind: 'question', text: 'Which?', source: 'hook', options: ['Rebase', 'Merge'] } }); await sleep(50); });
    act(() => shortcut());
    act(() => press('Escape'));
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(screen.getByText('Pim has a question')).toBeInTheDocument();
    act(() => press('2'));
    expect(screen.getByRole('radio', { name: /Merge/ })).toHaveAttribute('aria-checked', 'true');
    const field = screen.getByRole('textbox', { name: 'Short answer' });
    act(() => { field.focus(); fireEvent.change(field, { target: { value: '2 tabs' } }); fireEvent.keyDown(field, { key: 'Enter' }); });
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.reply', id: 'b', text: '2 tabs' }));
  });

  it('d from the chat toggles do not disturb; the menu does too', () => {
    const onToggleDnd = vi.fn();
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={onToggleDnd} />);
    act(() => shortcut());
    act(() => shortcut());
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    act(() => press('d'));
    expect(onToggleDnd).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ledge menu' }));
    fireEvent.click(screen.getByRole('switch', { name: /Do not disturb/ }));
    expect(onToggleDnd).toHaveBeenCalledTimes(2);
  });

  it('hovering the handle does not open a panel, so y decides nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={noop} />);
      fireEvent.mouseEnter(document.querySelector('[data-surface]') as HTMLElement);
      await act(async () => { vi.advanceTimersByTime(180); });
      expect(surface()).toHaveAttribute('data-mode', 'handle');
      act(() => press('y'));
      await sleep(30);
      expect(mock.received.some(m => m.type === 'session.decide')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
