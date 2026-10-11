import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { DEFAULT_SOUNDS, resetSoundPrefsForTests } from '../src/sounds/preferences';

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
    expect(surface()).toHaveStyle({ width: '28px' });
    expect(screen.getAllByRole('button', { name: /open$/ })).toHaveLength(3);
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

  it('back from a session: the list waits for the shrink to nearly settle before it fades in', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(document.querySelectorAll('[data-hotzone]')[0]!);
    await act(async () => { vi.advanceTimersByTime(180); });
    const list = () => document.querySelector('[data-layer="list"]') as HTMLElement;
    const row = () => document.querySelector('[data-layer="list"] [data-row]') as HTMLElement;
    // Opened from the handle (a grow): the list follows the start of the growth closely.
    expect(list().getAttribute('data-delay')).toBe('120');
    expect(row().getAttribute('data-delay')).toBe('150');
    fireEvent.click(screen.getByRole('button', { name: /speos-api/ }));
    expect(surface()).toHaveStyle({ width: '420px' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(surface()).toHaveStyle({ width: '380px' });
    // Back is a shrink (60 ms delay, 260 ms, slow start): the list appears once the surface has nearly settled,
    // so its footer and rows are never drawn at the session's size.
    expect(list().getAttribute('data-delay')).toBe('280');
    expect(row().getAttribute('data-delay')).toBe('310');
  });

  it('the + opens the launch form; Start sends session.launch; the daemon answer returns to the list with a notice that fades', async () => {
    mock.extras.recents = [{ cwd: '/w/api-gateway', project: 'api-gateway', lastAt: '2026-10-10T09:00:00.000Z' }];
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { client.connect(); await sleep(100); }); // a fresh snapshot carries the recents
    fireEvent.mouseEnter(document.querySelectorAll('[data-hotzone]')[0]!);
    await act(async () => { vi.advanceTimersByTime(180); });
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(surface()).toHaveAttribute('data-mode', 'launch');
    expect(screen.getByLabelText('Folder')).toHaveValue('/w/api-gateway');
    fireEvent.change(screen.getByLabelText('Companion'), { target: { value: 'Juno' } });
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'session.launch', tool: 'claude', cwd: '/w/api-gateway', name: 'Juno', continue: false }));
    expect(screen.getByRole('button', { name: /Starting…/ })).toBeDisabled();
    await act(async () => { mock.launched(fakeSession('n1', { name: 'Juno', project: 'api-gateway', state: 'starting', startedAt: '2026-10-10T09:00:00.000Z' })); await sleep(50); });
    expect(surface()).toHaveAttribute('data-mode', 'list');
    expect(screen.getByRole('status')).toHaveTextContent('Juno is starting in api-gateway.');
    expect(screen.getByRole('button', { name: /Juno .*open/ })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByRole('status')).toBeNull();
    // Opening the form again starts from a clean one (the name is a free pick again, not Juno).
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(screen.getByLabelText('Companion')).not.toHaveValue('Juno');
  });

  it('an ask to Ledge names the stored default harness', async () => {
    localStorage.setItem('ledge.defaultTool', 'codex');
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(document.querySelectorAll('[data-hotzone]')[0]!);
    await act(async () => { vi.advanceTimersByTime(180); });
    const input = screen.getByRole('textbox', { name: 'Ask Ledge' });
    fireEvent.change(input, { target: { value: 'How are the others doing?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mock.received).toContainEqual({ type: 'chat.ask', qid: expect.any(String), text: 'How are the others doing?', tool: 'codex' }));
  });

  it('a refused launch stays on the form with the reason; the next attempt clears it', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(document.querySelectorAll('[data-hotzone]')[0]!);
    await act(async () => { vi.advanceTimersByTime(180); });
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: '/w/nope' } });
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
    await waitFor(() => expect(mock.received.some(m => m.type === 'session.launch')).toBe(true));
    await act(async () => { mock.refuse('no such folder: /w/nope'); await sleep(50); });
    expect(surface()).toHaveAttribute('data-mode', 'launch');
    expect(screen.getByRole('status')).toHaveTextContent('Could not start: no such folder: /w/nope');
    expect(screen.getByRole('button', { name: /^Start/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Start/ }));
    expect(screen.queryByText(/Could not start/)).toBeNull();
    await waitFor(() => expect(mock.received.filter(m => m.type === 'session.launch')).toHaveLength(2));
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

  it('a bot that finishes its task (working → idle) unfolds a finished bubble that folds after 6 s', async () => {
    render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); });
    expect(surface()).toHaveStyle({ width: '28px' });
    await act(async () => { vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '336px' });
    expect(screen.getByText('Pim finished')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5900); });
    expect(surface()).toHaveStyle({ width: '336px' });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(surface()).toHaveStyle({ width: '28px' });
  });

  it('idle again without working in between is not a finish, and DND or the Handle-only setting keep the handle', async () => {
    localStorage.setItem('ledge.finished', 'none'); resetSoundPrefsForTests();
    const { rerender } = render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '28px' });
    localStorage.setItem('ledge.finished', 'both'); resetSoundPrefsForTests();
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'working' })); await sleep(50); mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '28px' });
    rerender(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
    await act(async () => { mock.upsert(pim({ state: 'idle', lastActivityAt: '2026-10-09T18:09:00.000Z' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveStyle({ width: '28px' });
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
      fireEvent.click(screen.getByRole('button', { name: 'Answer: Backfill' }));
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
      expect(surface()).toHaveStyle({ width: '28px' });
    });
  });
});
