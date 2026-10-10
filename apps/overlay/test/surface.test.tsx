import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';

let mock: Awaited<ReturnType<typeof createMockDaemon>>; let client: ReturnType<typeof createDaemonClient>; let detach: () => void;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
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
    expect(surface()).toHaveStyle({ width: '28px' });
    expect(screen.getAllByRole('button', { name: /open$/ })).toHaveLength(2);
  });

  it('an ask grows the bot, unfolds the bubble at its slot, approve sends the decision, then it folds back', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '28px' });
    await act(async () => { vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '336px', height: '128px' });
    expect(screen.getByText('Pim needs your approval')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.decide', id: 'b', decision: 'accept' }));
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); vi.advanceTimersByTime(900); });
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('after approve the bubble does not fold on the 900 ms timer alone, without the daemon confirmation', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '336px' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.decide', id: 'b', decision: 'accept' }));
    await act(async () => { vi.advanceTimersByTime(900); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '336px' });
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('a pointer left over a surface that shrank away does not hold the next bubble open', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(surface());
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    expect(surface()).toHaveStyle({ width: '420px' });
    // The view closes from under the pointer: no mouseleave is ever delivered.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(surface()).toHaveStyle({ width: '28px' });
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '336px' });
    expect(document.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'false');
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('hover, focus within and a hidden document pause the bubble', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    const timer = () => document.querySelector('[data-timer]');
    fireEvent.mouseEnter(surface());
    expect(timer()).toHaveAttribute('data-paused', 'true');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(surface()).toHaveStyle({ width: '336px' });
    fireEvent.mouseLeave(surface());
    expect(timer()).toHaveAttribute('data-paused', 'false');
    act(() => { screen.getByRole('button', { name: 'Approve' }).focus(); });
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
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('edge hover opens the list, clicking a row opens the session, back and close shrink', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(document.querySelectorAll('[data-hotzone]')[0]!);
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(surface()).toHaveStyle({ width: '380px' });
    fireEvent.click(screen.getByRole('button', { name: /speos-api/ }));
    expect(surface()).toHaveStyle({ width: '420px' });
    expect(screen.getByText('Pim · speos-api')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(surface()).toHaveStyle({ width: '380px' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('a removed session that is open falls back to the list', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    expect(surface()).toHaveStyle({ width: '420px' });
    await act(async () => { mock.remove('a'); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '380px' });
    // It leaves like a Back: still drawn while it fades, but inert, so nothing in it can be reached or clicked.
    expect(screen.getByText('Otto · harness-assistant').closest('[inert]')).not.toBeNull();
  });

  it('a draft survives a daemon disconnect and the session stays open', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    fireEvent.change(screen.getByPlaceholderText('Reply to Otto…'), { target: { value: 'keep going' } });
    const port = mock.port; await act(async () => { await mock.close(); await sleep(80); });
    expect(screen.getByText(/daemon unreachable/)).toBeInTheDocument();
    expect(surface()).toHaveStyle({ width: '420px' });
    mock = await createMockDaemon({ port }); mock.sessions.set('a', fakeSession('a'));
    await act(async () => { vi.advanceTimersByTime(2500); await sleep(100); });
    expect((screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement).value).toBe('keep going');
  });

  it('turning dnd on takes the bubble down and does not surface the queued asks', async () => {
    const { rerender } = render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => {
      mock.upsert(fakeSession('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })); mock.upsert(pimAsks());
      await sleep(50); vi.advanceTimersByTime(540);
    });
    expect(surface()).toHaveStyle({ width: '336px' });
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(surface()).toHaveStyle({ width: '28px' });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(surface()).toHaveStyle({ width: '28px' });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(screen.getByRole('button', { name: /Otto has a question, open/ })).toHaveStyle({ width: '20px' });
    expect(screen.getByRole('button', { name: /Pim needs your approval, open/ })).toHaveStyle({ width: '20px' });
    // Turning dnd off does not re-bubble asks that are already pending.
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
  });

  it('dnd suppresses the bubble but the bot still grows', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(fakeSession('a', { state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } })); await sleep(50); vi.advanceTimersByTime(600); });
    expect(surface()).toHaveStyle({ width: '28px' });
    expect(screen.getByRole('button', { name: /Otto has a question, open/ })).toHaveStyle({ width: '20px' });
  });
});
