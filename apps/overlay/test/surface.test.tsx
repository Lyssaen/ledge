import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { DEFAULT_SOUNDS, resetSoundPrefsForTests } from '../src/sounds/preferences';
import { MESSAGES } from '../src/i18n/messages';
import { filetWidth, islandWidth, ISLAND } from '../src/surface/geometry';
import { SHOULDER_R, STRIP_SHOULDER_R } from '../src/surface/Shoulders';

let mock: Awaited<ReturnType<typeof createMockDaemon>>; let client: ReturnType<typeof createDaemonClient>; let detach: () => void;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear(); resetSoundPrefsForTests();
  daemonStore.reset(); mock = await createMockDaemon();
  mock.sessions.set('a', fakeSession('a')); mock.sessions.set('b', fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z' }));
  client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); detach = attachClient(client); client.connect();
  await sleep(100);
});
afterEach(async () => { detach(); client.close(); await mock.close(); vi.useRealTimers(); });

const surface = () => document.querySelector('[data-surface]') as HTMLElement;
const pim = (extra = {}) => fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z', ...extra });
const pimAsks = () => pim({ state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });

describe('<Surface>', () => {
  it('starts as the handle sized to the team', () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    expect(screen.getAllByRole('button', { name: /open$/ })).toHaveLength(3);
  });

  it('an ask grows the bot, unfolds the bubble at its slot, approve sends the decision, then it folds back', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    expect(screen.getByRole('button', { name: /Pim needs your approval, open/ }).querySelector('[data-dot]')).toHaveAttribute('data-state', 'approval');
    await act(async () => { vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '440px', height: '128px' });
    expect(screen.getByText('Pim needs your approval')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.decide', id: 'b', decision: 'accept' }));
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); vi.advanceTimersByTime(900); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
  });

  it('after approve the bubble does not fold on the 900 ms timer alone, without the daemon confirmation', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '440px' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.decide', id: 'b', decision: 'accept' }));
    await act(async () => { vi.advanceTimersByTime(900); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '440px' });
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
  });

  it('a pointer left over a surface that shrank away does not hold the next bubble open', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(surface());
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    expect(surface()).toHaveAttribute('data-mode', 'peek');
    expect(surface()).toHaveStyle({ width: '360px' });
    // The view closes from under the pointer: no mouseleave is ever delivered.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '440px' });
    expect(document.querySelector('[data-timer]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
  });

  it('hover, focus within and a hidden document pause a notice', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    const timer = () => document.querySelector('[data-timer]');
    expect(timer()).toHaveAttribute('data-paused', 'false');
    fireEvent.mouseEnter(surface());
    expect(timer()).toHaveAttribute('data-paused', 'true');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(surface()).toHaveStyle({ width: '440px' });
    fireEvent.mouseLeave(surface());
    expect(timer()).toHaveAttribute('data-paused', 'false');
    act(() => { screen.getByRole('button', { name: 'OK' }).focus(); });
    expect(timer()).toHaveAttribute('data-paused', 'true');
    act(() => { (document.activeElement as HTMLElement).blur(); });
    expect(timer()).toHaveAttribute('data-paused', 'false');
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(timer()).toHaveAttribute('data-paused', 'true');
    hidden.mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(timer()).toHaveAttribute('data-paused', 'false');
    hidden.mockRestore();
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
  });

  it('hovering the filet wakes it into the compact island, no list; a robot opens a peek and the resident opens the chat', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    expect(document.querySelectorAll('[data-layer="handle"] svg.bot')).toHaveLength(0);
    fireEvent.mouseEnter(document.querySelector('[data-surface]')!);
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(surface()).toHaveAttribute('data-awake', 'true');
    expect(surface()).toHaveStyle({ width: `${islandWidth(2)}px`, height: `${ISLAND.h}px` });
    expect(document.querySelectorAll('[data-layer="handle"] svg.bot')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Pim working, open/ }));
    expect(surface()).toHaveAttribute('data-mode', 'peek');
    expect(surface()).toHaveStyle({ width: '360px' });
    expect(document.querySelector('[data-layer="peek"]')).toHaveTextContent('Pim');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    fireEvent.mouseEnter(surface());
    expect(surface()).toHaveStyle({ width: `${islandWidth(2)}px` });
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveAttribute('data-mode', 'chat');
  });

  it('Ctrl+Alt+N notes a new session for Ledge Desktop and leaves the island where it is', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true, altKey: true });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(screen.getByText(/Opening a new session in Ledge Desktop/)).toBeInTheDocument();
    expect(mock.received.some(m => m.type === 'session.launch')).toBe(false);
  });

  it('an ask to Ledge names the stored default harness', async () => {
    localStorage.setItem('ledge.defaultTool', 'codex');
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    await act(async () => { vi.advanceTimersByTime(180); });
    const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
    fireEvent.change(input, { target: { value: 'How are the others doing?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'chat.ask', qid: expect.any(String), text: 'How are the others doing?', tool: 'codex' }));
  });

  it('a session that stops on an error, with nothing left to decide, unfolds an error notice', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'error', pending: undefined, lastError: 'the pane died' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(screen.getByText('Pim stopped on an error')).toBeInTheDocument();
    expect(screen.getByText('the pane died')).toBeInTheDocument();
    expect(document.querySelector('[data-timer]')).toBeTruthy();
  });

  it('a removed peek folds back to the handle', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    expect(surface()).toHaveStyle({ width: '360px' });
    await act(async () => { mock.remove('a'); await sleep(50); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(surface()).toHaveStyle({ width: `${filetWidth([1])}px` });
  });

  it('a chat draft survives a daemon disconnect', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    await act(async () => { vi.advanceTimersByTime(180); });
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask Ledge' }), { target: { value: 'keep going' } });
    const port = mock.port; await act(async () => { await mock.close(); await sleep(80); });
    expect(screen.getByText(/daemon unreachable/)).toBeInTheDocument();
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    expect((screen.getByRole('textbox', { name: 'Ask Ledge' }) as HTMLInputElement).value).toBe('keep going');
    mock = await createMockDaemon({ port }); mock.sessions.set('a', fakeSession('a'));
    await act(async () => { vi.advanceTimersByTime(2500); await sleep(100); });
    expect((screen.getByRole('textbox', { name: 'Ask Ledge' }) as HTMLInputElement).value).toBe('keep going');
  });

  it('turning dnd on takes the bubble down and does not surface the queued asks', async () => {
    const { rerender } = render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => {
      mock.upsert(fakeSession('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })); mock.upsert(pimAsks());
      await sleep(50); vi.advanceTimersByTime(540);
    });
    expect(surface()).toHaveStyle({ width: '440px' });
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(screen.getByRole('button', { name: /Otto has a question, open/ })).toHaveStyle({ width: '5px' });
    expect(screen.getByRole('button', { name: /Pim needs your approval, open/ })).toHaveStyle({ width: '5px' });
    // Turning dnd off does not re-bubble asks that are already pending.
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('dnd suppresses the bubble and keeps the question dash', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(fakeSession('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })); await sleep(50); vi.advanceTimersByTime(600); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    expect(screen.getByRole('button', { name: /Otto has a question, open/ })).toHaveStyle({ width: '5px' });
    expect(screen.queryByText('Which?')).not.toBeInTheDocument();
  });

  it('the chat stays open when the pointer leaves, and Close folds it', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    expect(screen.queryByRole('button', { name: 'Back to sessions' })).toBeNull();
    act(() => screen.getByRole('textbox', { name: 'Ask Ledge' }).focus());
    fireEvent.mouseLeave(surface());
    await act(async () => { vi.advanceTimersByTime(800); });
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('hovering the handle never opens a panel; no edge band exists any more', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    expect(document.querySelectorAll('[data-hotzone]')).toHaveLength(0);
    fireEvent.mouseEnter(surface());
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.mouseLeave(surface());
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    fireEvent.mouseEnter(surface());
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('a peek stays open when the pointer leaves; Close folds it', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(surface());
    await act(async () => { vi.advanceTimersByTime(180); });
    fireEvent.click(screen.getByRole('button', { name: /Pim working, open/ }));
    expect(surface()).toHaveAttribute('data-mode', 'peek');
    act(() => screen.getByRole('button', { name: 'Close' }).focus());
    fireEvent.mouseLeave(surface());
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(surface()).toHaveAttribute('data-mode', 'peek');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('a press outside an open panel folds it back to the handle; a press inside does not', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Ask Ledge' }));
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    fireEvent.pointerDown(document.body);
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('Ledge finishing an answer unfolds a finished bubble; Open goes to the chat', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => {
      daemonStore.beginTurn({ qid: 'q1', question: 'How are the others doing?', askedAt: '2026-10-11T10:00:00.000Z', steps: [] });
      await sleep(20);
      daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'Deux bots travaillent.', at: '2026-10-11T10:01:20.000Z' });
      await sleep(50);
    });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    await act(async () => { vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '440px' });
    const bubble = document.querySelector('[data-layer="bubble"]') as HTMLElement;
    expect(bubble).toHaveTextContent('Ledge finished');
    expect(bubble).toHaveTextContent('Deux bots travaillent.');
    fireEvent.click(screen.getByRole('button', { name: 'Open in Ledge' }));
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    expect(document.querySelector('[data-layer="chat"]')).toHaveTextContent('Deux bots travaillent.');
  });

  it('Ledge finishing while the handle is up keeps a speech bubble until the chat is opened', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => {
      daemonStore.beginTurn({ qid: 'q1', question: 'How are the others doing?', askedAt: '2026-10-11T10:00:00.000Z', steps: [] });
      await sleep(20);
      daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'Deux bots travaillent.', at: '2026-10-11T10:01:20.000Z' });
      await sleep(50);
    });
    const say = () => document.querySelector('[data-unread-say]') as HTMLElement;
    expect(say()).toHaveAttribute('data-say-kind', 'ledge');
    expect(MESSAGES.en.say.ledge).toContain(say().textContent);
    expect(say()).toHaveStyle({ opacity: '1' });
    await act(async () => { vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(say()).toHaveStyle({ opacity: '0' });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(say()).toHaveStyle({ opacity: '1' });
    fireEvent.click(say());
    expect(surface()).toHaveAttribute('data-mode', 'chat');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(say()).toHaveStyle({ opacity: '0' });
  });

  it('a speech bubble lingers 5 s on the handle then fades; the bot stays held and a new ask speaks again', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); });
    await act(async () => { vi.advanceTimersByTime(540); });
    await act(async () => { vi.advanceTimersByTime(6100); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    const say = () => document.querySelector('[data-unread-say]') as HTMLElement;
    expect(say()).toHaveAttribute('data-say-kind', 'finished');
    expect(say()).toHaveStyle({ opacity: '1' });
    await act(async () => { vi.advanceTimersByTime(4900); });
    expect(say()).toHaveStyle({ opacity: '1' });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(say()).toHaveStyle({ opacity: '0' });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    // The finish is still unread: the bot stays up and opens its session.
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    fireEvent.click(screen.getByRole('button', { name: 'Pim available, open' }));
    expect(surface()).toHaveAttribute('data-mode', 'peek');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(say()).toHaveStyle({ opacity: '0' });
    // A new ask speaks on the handle once it has been set aside. It does not fold on its own.
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    fireEvent.click(screen.getByRole('button', { name: /^Later/ }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(say()).toHaveAttribute('data-say-kind', 'approval');
    expect(say()).toHaveStyle({ opacity: '1' });
    await act(async () => { vi.advanceTimersByTime(5100); });
    expect(say()).toHaveStyle({ opacity: '0' });
  });

  it('a bot that finishes its task (working → idle) unfolds a finished bubble that folds after 6 s', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    await act(async () => { vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '440px' });
    expect(screen.getByText('Pim finished')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5900); });
    expect(surface()).toHaveStyle({ width: '440px' });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    const say = document.querySelector('[data-unread-say]') as HTMLElement;
    expect(say).toHaveAttribute('data-say-kind', 'finished');
    expect(MESSAGES.en.say.finished).toContain(say.textContent);
    expect(say).toHaveStyle({ opacity: '1' });
    fireEvent.click(say);
    expect(surface()).toHaveAttribute('data-mode', 'peek');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(document.querySelector('[data-unread-say]')).toHaveStyle({ opacity: '0' });
  });

  it('an ask that folds back leaves an approval balloon; a Ledge unread waits behind it', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => {
      daemonStore.beginTurn({ qid: 'q1', question: 'How are the others doing?', askedAt: '2026-10-11T10:00:00.000Z', steps: [] });
      await sleep(20);
      daemonStore.apply({ type: 'chat.done', qid: 'q1', text: 'Deux bots travaillent.', at: '2026-10-11T10:01:20.000Z' });
      await sleep(50);
    });
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    fireEvent.click(screen.getByRole('button', { name: /^Later/ }));
    // A Ledge finish that was still unfolding waits behind the ask and shows once it is set aside.
    if (surface().getAttribute('data-mode') === 'bubble') {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    }
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    const say = () => document.querySelector('[data-unread-say]') as HTMLElement;
    expect(say()).toHaveAttribute('data-say-kind', 'approval');
    expect(MESSAGES.en.say.approval).toContain(say().textContent);
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); });
    expect(say()).toHaveAttribute('data-say-kind', 'ledge');
    expect(MESSAGES.en.say.ledge).toContain(say().textContent);
  });

  it('idle again without working in between is not a finish, and DND or the Handle-only setting keep the handle', async () => {
    localStorage.setItem('ledge.finished', 'none'); resetSoundPrefsForTests();
    const { rerender } = render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    localStorage.setItem('ledge.finished', 'both'); resetSoundPrefsForTests();
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle', lastActivityAt: '2026-10-09T18:09:00.000Z' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
  });

  describe('sounds', () => {
    const fakePlayer = () => { const played: Array<[string, number]> = []; return { played, play: (c: string, g: number) => { played.push([c, g]); } }; };
    it('an ask knocks, a finish falls, approve ticks; a second ask within 1.5 s is silent', async () => {
      const p = fakePlayer();
      render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { vi.advanceTimersByTime(2000); });                       // past the snapshot quiet window
      await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
      await waitFor(() => expect(p.played).toEqual([['approval', 1]]));
      await act(async () => { mock.upsert(fakeSession('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })); await sleep(50); });
      expect(p.played).toHaveLength(1);                                                 // rate limited
      vi.advanceTimersByTime(1500);                                                      // so that only the tick is recent below
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(p.played.at(-1)).toEqual(['accept', 1]));               // the user's tick always plays
      await act(async () => { mock.upsert(fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'ls', source: 'hook' } })); await sleep(50); vi.advanceTimersByTime(300); });
      await waitFor(() => expect(p.played.at(-1)).toEqual(['approval', 1]));             // a tick never silences the next ask
      await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); vi.advanceTimersByTime(2000); });
      await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); });
      await waitFor(() => expect(p.played.at(-1)).toEqual(['finished', 1]));
    });
    it('a question bubble answered with its first option ticks like any reply', async () => {
      const p = fakePlayer();
      render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { vi.advanceTimersByTime(2000); });
      await act(async () => { mock.upsert(pim({ state: 'waiting_input', pending: { kind: 'question', text: 'Which migration?', options: ['Backfill', 'Shadow'], source: 'hook' } })); await sleep(50); vi.advanceTimersByTime(540); });
      await waitFor(() => expect(p.played).toEqual([['question', 1]]));
      fireEvent.click(screen.getByRole('radio', { name: /Backfill/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
      await waitFor(() => expect(mock.received).toContainEqual(expect.objectContaining({ type: 'session.reply', id: 'b' })));
      await waitFor(() => expect(p.played.at(-1)).toEqual(['accept', 1]));
    });
    it('the snapshot on connect plays no join; DND and the switch silence everything; Sound-only finish plays without a bubble', async () => {
      const p = fakePlayer();
      localStorage.setItem('ledge.sounds', JSON.stringify({ ...DEFAULT_SOUNDS, categories: { ...DEFAULT_SOUNDS.categories, team: true } })); resetSoundPrefsForTests();
      const { rerender } = render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { await sleep(100); });
      expect(p.played).toEqual([]);                                                      // two sessions in the snapshot, no pops
      rerender(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { vi.advanceTimersByTime(2000); mock.upsert(pimAsks()); await sleep(50); });
      expect(p.played).toEqual([]);
      // The switch off, DND off: still nothing.
      localStorage.setItem('ledge.sounds', JSON.stringify({ ...DEFAULT_SOUNDS, enabled: false, categories: { ...DEFAULT_SOUNDS.categories, team: true } })); resetSoundPrefsForTests();
      rerender(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { mock.upsert(fakeSession('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })); await sleep(50); });
      expect(p.played).toEqual([]);
      localStorage.setItem('ledge.sounds', JSON.stringify({ ...DEFAULT_SOUNDS, categories: { ...DEFAULT_SOUNDS.categories, team: true } }));
      await act(async () => { mock.upsert(fakeSession('a')); await sleep(50); });
      localStorage.setItem('ledge.finished', 'sound'); resetSoundPrefsForTests();
      rerender(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} soundPlayer={p as never} />);
      await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); vi.advanceTimersByTime(2000); mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
      await waitFor(() => expect(p.played).toEqual([['finished', 1]]));
      expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    });
  });
});

describe('<Surface> island', () => {
  const mount = (props: Partial<Parameters<typeof Surface>[0]> = {}) => render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} {...props} />);
  const cover = (covered: boolean) => act(() => { window.dispatchEvent(new CustomEvent('ledge:foreground', { detail: { covered } })); });

  it('the island hangs from the top edge, centred on the viewport, 10 px high; the list keeps 380 px under it', async () => {
    mount();
    expect(surface()).toHaveStyle({ top: '0px', height: '10px', width: `${filetWidth([2])}px`, left: `${Math.round(window.innerWidth / 2 - filetWidth([2]) / 2)}px` });
    expect(surface().style.borderRadius).toBe('0px 0px 5px 5px');
    // The resting fillets are the strip's 6 px: the 12 px ones hang below a 10 px bar.
    const fillet = document.querySelector('[data-shoulder="left"]') as HTMLElement;
    expect(fillet).toHaveStyle({ height: `${STRIP_SHOULDER_R}px` });
    expect(parseFloat(fillet.style.top) + parseFloat(fillet.style.height)).toBeLessThanOrEqual(parseFloat(surface().style.height));
    fireEvent.mouseEnter(surface());
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveStyle({ top: '0px', width: '480px', left: `${Math.round(window.innerWidth / 2 - 240)}px` });
    expect(surface().style.borderRadius).toBe('0px 0px 22px 22px');
    expect(document.querySelector('[data-shoulder="left"]')).toHaveStyle({ height: `${SHOULDER_R}px` });
  });

  it('the top band either side of the island opens nothing; the edge far away opens nothing', async () => {
    mount();
    const g = { left: parseFloat(surface().style.left) };
    fireEvent.mouseMove(document, { clientX: 3, clientY: 3 });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    fireEvent.mouseMove(document, { clientX: g.left - 20, clientY: 4 });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('discreet: the island stays compact while a say hangs under it; the strip comes once the say has faded', async () => {
    mount();
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    await act(async () => { vi.advanceTimersByTime(6100); });
    expect(surface()).toHaveStyle({ width: `${filetWidth([2])}px` });
    const say = document.querySelector('[data-unread-say]') as HTMLElement;
    expect(say).toHaveAttribute('data-say-kind', 'finished');
    expect(say).toHaveStyle({ opacity: '1' });
    cover(true);
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(surface()).not.toHaveAttribute('data-strip');
    expect(surface()).toHaveStyle({ height: '10px' });
    await act(async () => { vi.advanceTimersByTime(4500); });
    expect(say).toHaveStyle({ opacity: '0' });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(surface()).toHaveAttribute('data-strip');
  });

  it('discreet: a covering window shrinks the island to the strip 500 ms after the fold; hovering the band wakes it', async () => {
    mount();
    cover(true);
    expect(surface()).not.toHaveAttribute('data-strip');
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(surface()).toHaveAttribute('data-strip');
    expect(surface()).toHaveStyle({ height: '10px' });
    expect(surface().style.borderRadius).toBe('0px 0px 5px 5px');
    expect(document.querySelector('[data-layer="handle"][data-strip] [data-dot]')).not.toBeNull();
    const left = parseFloat(surface().style.left);
    fireEvent.mouseMove(document, { clientX: left - 10, clientY: 4 });
    expect(surface()).not.toHaveAttribute('data-strip');
    // The pointer in the band wakes the notch into the compact island.
    expect(surface()).toHaveAttribute('data-awake', 'true');
    expect(surface()).toHaveStyle({ height: `${ISLAND.h}px` });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    cover(false);
    fireEvent.mouseMove(document, { clientX: 900, clientY: 600 });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(surface()).not.toHaveAttribute('data-strip');
  });

  it('discreet off: a covering window changes nothing', async () => {
    mount({ discreet: false });
    cover(true);
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(surface()).not.toHaveAttribute('data-strip');
    expect(surface()).toHaveStyle({ height: '10px' });
  });

  it('a bubble while the strip shows: the island stretches to 440 px, the strip waits', async () => {
    mount();
    cover(true);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(surface()).toHaveAttribute('data-strip');
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(surface()).toHaveStyle({ width: '440px', top: '0px' });
    expect(surface()).not.toHaveAttribute('data-strip');
  });

  it('the island sits at a quarter of the screen when the position says left', () => {
    mount({ islandPosition: 'left' });
    expect(surface()).toHaveStyle({ left: `${Math.round(window.innerWidth / 4 - filetWidth([2]) / 2)}px` });
  });
});
