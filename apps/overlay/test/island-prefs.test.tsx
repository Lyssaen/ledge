import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import WebSocket from 'ws';
import { DEFAULT_ISLAND_PREFS, type IslandPrefs } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { SessionView } from '../src/surface/SessionView';
import { resetSoundPrefsForTests } from '../src/sounds/preferences';
import { subscribeOpenInLedge, type LedgeTarget } from '../src/desktop/openInLedge';
import { localIslandPrefs } from '../src/island';
import { setFrame, setHotZone } from '../src/tauri/bridge';
import { App } from '../src/App';

const monitors = [
  { id: '\\\\.\\DISPLAY1', name: null, width: 1920, height: 1080, workH: 1032, primary: true },
  { id: '\\\\.\\DISPLAY2', name: null, width: 2560, height: 1440, workH: 1400, primary: false }
];
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), setFrame: vi.fn(async () => true), setHotZone: vi.fn(), listMonitors: vi.fn(async () => monitors) }));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const surface = () => document.querySelector('[data-surface]') as HTMLElement | null;
const prefs = (extra: Partial<IslandPrefs> = {}, shows: Partial<IslandPrefs['shows']> = {}): IslandPrefs => ({ ...DEFAULT_ISLAND_PREFS, ...extra, shows: { ...DEFAULT_ISLAND_PREFS.shows, ...shows } });

describe('the island applies the settings Desktop shares', () => {
  let mock: Awaited<ReturnType<typeof createMockDaemon>>; let client: ReturnType<typeof createDaemonClient>; let detach: () => void;
  const pim = (extra = {}) => fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', ...extra });
  const pimAsks = () => pim({ state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
  const pimQuestion = () => pim({ state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow table'], source: 'hook' } });
  const draw = (p: Partial<Parameters<typeof Surface>[0]> = {}) => <Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} {...p} />;
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear(); resetSoundPrefsForTests(); vi.mocked(setFrame).mockClear(); vi.mocked(setHotZone).mockClear();
    daemonStore.reset(); mock = await createMockDaemon();
    mock.sessions.set('b', pim());
    client = createDaemonClient({ url: mock.url, WebSocketImpl: WebSocket as never }); detach = attachClient(client); client.connect();
    await sleep(100);
  });
  afterEach(async () => { cleanup(); detach(); client.close(); await mock.close(); vi.useRealTimers(); });

  it('finished off: a bot that finishes unfolds no bubble', async () => {
    render(draw({ shows: prefs({}, { finished: false }).shows }));
    await act(async () => { mock.upsert(pim({ state: 'idle' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(screen.queryByText('Pim finished')).toBeNull();
  });

  it('finished off still shows an error notice', async () => {
    render(draw({ shows: prefs({}, { finished: false }).shows }));
    await act(async () => { mock.upsert(pim({ state: 'error', lastError: 'boom' })); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(document.querySelector('[data-layer="bubble"]')).toHaveAttribute('data-kind', 'error');
  });

  it('say off: no speech bubble on the handle', async () => {
    render(draw({ shows: prefs({}, { say: false }).shows }));
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    fireEvent.click(screen.getByRole('button', { name: /^Later/ }));
    expect(surface()).toHaveAttribute('data-mode', 'handle');
    expect(document.querySelector('[data-unread-say]')).toHaveStyle({ opacity: '0' });
  });

  it('quick off: an approval shows only Open in Ledge and Later, and Y does nothing; Enter opens it in Ledge', async () => {
    const opened: LedgeTarget[] = []; const off = subscribeOpenInLedge(t => opened.push(t));
    render(draw({ shows: prefs({}, { quick: false }).shows }));
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'y' });
    await act(async () => { await sleep(50); });
    expect(mock.received.some(m => m.type === 'session.decide')).toBe(false);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(opened).toEqual([{ kind: 'session', id: 'b' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Ledge' }));
    expect(opened).toHaveLength(2);
    off();
  });

  it('quick off: a question shows no choices, no field and no Reply; 1 picks nothing', async () => {
    render(draw({ shows: prefs({}, { quick: false }).shows }));
    await act(async () => { mock.upsert(pimQuestion()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(screen.getByText('Which strategy? · speos-api')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(document.querySelector('[data-layer="bubble"] [data-reply]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in Ledge' })).toBeInTheDocument();
  });

  it('hidden: nothing is drawn, no frame nor hot zone; the asks are still counted and show once it is visible again', async () => {
    const { rerender } = render(draw({ visible: false }));
    expect(surface()).toBeNull();
    expect(vi.mocked(setFrame).mock.calls.at(-1)?.[0]).toEqual({ left: 0, top: 0, w: 0, h: 0 });
    expect(vi.mocked(setHotZone).mock.calls.at(-1)).toEqual([-100_000, 0]);
    await act(async () => { mock.upsert(pimAsks()); await sleep(50); vi.advanceTimersByTime(540); });
    expect(surface()).toBeNull();
    expect(document.querySelector('[data-unread-say]')).toBeNull();
    rerender(draw());
    expect(surface()).toHaveAttribute('data-mode', 'bubble');
    expect(screen.getByText('Pim needs your approval')).toBeInTheDocument();
    expect(vi.mocked(setHotZone).mock.calls.at(-1)![0]).toBeGreaterThan(0);
  });

  it('the shortcut Desktop shows is named in Ledge’s tooltip', () => {
    render(draw({ shortcut: 'Ctrl Shift Space' }));
    expect(document.querySelector('[data-resident]')!.getAttribute('title')).toContain('Ctrl Shift Space');
  });
});

describe('helpers off', () => {
  afterEach(cleanup);
  it('the sub-agents tree is not drawn', () => {
    const thread = [{ kind: 'helper' as const, id: 'h1', at: '2026-10-13T10:00:01.000Z', turn: 1, task: 'find consumers', agentType: 'Explore', state: 'working' as const }];
    const base = { preview: [], visible: true, reading: false, draft: '', onDraft: () => {}, onBack: () => {}, onClose: () => {}, onDecide: () => {}, onReply: () => {}, onInterrupt: () => {}, onKill: () => {}, onFocus: () => {}, onToggleReading: () => {} };
    const { container, rerender } = render(<SessionView {...base} session={fakeSession('a', { state: 'working', helpers: [] })} thread={thread} />);
    expect(container.querySelector('[data-helpers]')).not.toBeNull();
    rerender(<SessionView {...base} session={fakeSession('a', { state: 'working', helpers: [] })} thread={thread} helpers={false} />);
    expect(container.querySelector('[data-helpers]')).toBeNull();
  });
});

/** The local daemon's socket, driven by the test: it opens at once and records what the island sends. */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 0; sent: { type: string; prefs?: IslandPrefs }[] = [];
  constructor(readonly url: string) { FakeSocket.all.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  push(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const local = () => FakeSocket.all.find(s => s.url.includes('47831'))!;
const islandSets = () => local().sent.filter(m => m.type === 'island.set');
async function boot() {
  render(<App />);
  await act(async () => { await sleep(20); });
  await act(async () => { local().push({ type: 'snapshot', sessions: [] }); await sleep(20); });
}
const speak = async (p: IslandPrefs | null) => { await act(async () => { local().push({ type: 'island', prefs: p }); await sleep(20); }); };

describe('App and the daemon’s island settings', () => {
  beforeEach(() => { FakeSocket.all = []; vi.stubGlobal('WebSocket', FakeSocket); localStorage.clear(); localStorage.setItem('ledge.lang', 'en'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('the island’s own values, a chosen monitor read as the second screen', () => {
    localStorage.setItem('ledge.islandPosition', 'left'); localStorage.setItem('ledge.discreet', '0'); localStorage.setItem('ledge.monitor', 'X');
    localStorage.setItem('ledge.handleScale', '1.5'); localStorage.setItem('ledge.panelScale', '2');
    expect(localIslandPrefs()).toEqual(prefs({ position: 'left', discreet: false, screen: 'second', islandScale: 1.5, panelScale: 2 }));
    localStorage.clear();
    expect(localIslandPrefs()).toEqual(DEFAULT_ISLAND_PREFS);
  });

  it('a daemon that holds none gets the island’s own values, once', async () => {
    localStorage.setItem('ledge.islandPosition', 'right'); localStorage.setItem('ledge.discreet', '0'); localStorage.setItem('ledge.handleScale', '1.25');
    await boot();
    await speak(null);
    expect(islandSets()).toEqual([{ type: 'island.set', prefs: prefs({ position: 'right', discreet: false, islandScale: 1.25 }) }]);
    await speak(null);
    expect(islandSets()).toHaveLength(1);
  });

  it('a daemon that holds some gets nothing; they apply and are kept for an offline start', async () => {
    localStorage.setItem('ledge.monitor', 'X');
    await boot();
    await speak(prefs({ position: 'left', discreet: false, islandScale: 2, panelScale: 1.25, screen: 'primary' }));
    expect(islandSets()).toHaveLength(0);
    expect(localStorage.getItem('ledge.islandPosition')).toBe('left');
    expect(localStorage.getItem('ledge.discreet')).toBe('0');
    expect(localStorage.getItem('ledge.monitor')).toBeNull();
    expect((document.querySelector('[data-zoom="handle"]') as HTMLElement).style.zoom).toBe('2');
    expect((document.querySelector('[data-panel]') as HTMLElement).style.zoom).toBe('1.25');
    expect(JSON.parse(localStorage.getItem('ledge.island')!)).toMatchObject({ position: 'left', panelScale: 1.25 });
    await speak(prefs({ screen: 'second' }));
    await act(async () => { await sleep(20); });
    expect(localStorage.getItem('ledge.monitor')).toBe(monitors[1]!.id);
    expect(localStorage.getItem('ledge.islandPosition')).toBe('center');
    await speak(prefs({ visible: false }));
    expect(surface()).toBeNull();
    await speak(prefs());
    expect(surface()).not.toBeNull();
  });

  it('an offline start applies the last settings kept', () => {
    localStorage.setItem('ledge.island', JSON.stringify(prefs({ visible: false })));
    render(<App />);
    expect(surface()).toBeNull();
  });
});
