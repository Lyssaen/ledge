import { islandWidth } from '../src/surface/geometry';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { ClientMessage, Session } from '@ledge/protocol';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { Bot } from '../src/bots/Bot';
import { useMotionPreferences } from '../src/motionPreferences';
import { useMeasuredHeight } from '../src/surface/useMeasuredHeight';
import { SURFACE_CHROME_Y } from '../src/surface/geometry';
import { Badge, BADGE } from '../src/ui/Badge';
import type { BotState } from '../src/bots/poseFor';
import { fakeSession } from './mockDaemon';

/* The parity scenarios drive the surface from the daemon store directly with a recording client, so the fake clock is
   exact (no socket I/O, no shouldAdvanceTime drift). */
function stubClient() {
  const sent: ClientMessage[] = [];
  const client: DaemonClient = { connect() {}, close() {}, send: m => { if (m.type !== 'session.thread') sent.push(m); }, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };
  return { client, sent };
}
const snapshot = (sessions: Session[]) => act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions }); });
const update = (s: Session) => act(() => { daemonStore.apply({ type: 'session.updated', session: s }); });
const tick = (n: number) => act(() => { vi.advanceTimersByTime(n); });
const press = (key: string, extra: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(document.activeElement ?? window, { key, ...extra }); });
const shortcut = () => press('l', { ctrlKey: true, altKey: true });
/** Keyboard focus on the n-th listed row (1-based), with K to the top then J down. */
const toRow = (n: number) => { for (let i = 0; i < 9; i++) press('k'); for (let i = 1; i < n; i++) press('j'); };
const surface = () => document.querySelector('[data-surface]') as HTMLElement;
const layer = (name: string) => document.querySelector(`[data-layer="${name}"]`) as HTMLElement;
const mode = () => surface().getAttribute('data-mode');

const otto = (extra: Partial<Session> = {}) => fakeSession('a', extra);
const pim = (extra: Partial<Session> = {}) => fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z', ...extra });
const lu = (extra: Partial<Session> = {}) => fakeSession('c', { name: 'Lu', tool: 'cursor', project: 'docs', startedAt: '2026-10-09T18:02:00.000Z', ...extra });
const asks = (text: string) => ({ state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text, source: 'hook' as const } });
const question = (text: string, options: string[]) => ({ state: 'waiting_input' as const, pending: { kind: 'question' as const, text, options, source: 'hook' as const } });

function Harness({ client, dnd: initialDnd = false }: { client: DaemonClient; dnd?: boolean }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [dnd, setDnd] = useState(initialDnd);
  return <Surface screenH={1080} theme={theme} client={client} dnd={dnd} onToggleDnd={() => setDnd(d => !d)} onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} />;
}

/** jsdom has no ResizeObserver: this one records what it observes and lets a test report a size. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  target: Element | null = null; disconnected = false;
  constructor(public cb: ResizeObserverCallback) { FakeResizeObserver.all.push(this); }
  observe(el: Element) { this.target = el; this.disconnected = false; }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  report(h: number) { this.cb([{ target: this.target!, borderBoxSize: [{ blockSize: h, inlineSize: 440 }], contentRect: { height: h } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
}

let rec: ReturnType<typeof stubClient>;
beforeEach(() => {
  vi.useFakeTimers();
  try { localStorage.clear(); } catch { /* ignore */ }
  daemonStore.reset();
  rec = stubClient();
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  const prefs = renderHook(() => useMotionPreferences()); act(() => prefs.result.current.setReduced(false)); prefs.unmount();
});

describe('prototype parity', () => {
  it('theme changes material without replacing SVG or resetting state', () => {
    snapshot([otto(), pim()]);
    const { rerender } = render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    const handleBot = () => layer('handle').querySelector('svg.bot') as SVGSVGElement;
    const firstHandle = handleBot();
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    const svg = layer('peek').querySelector('svg.bot') as SVGSVGElement;
    const phase = svg.style.getPropertyValue('--bot-phase'); const state = svg.getAttribute('data-state');
    expect(svg).toHaveAttribute('data-material', 'signal');
    rerender(<Surface screenH={1080} theme="light" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    const after = layer('peek').querySelector('svg.bot') as SVGSVGElement;
    expect(after).toBe(svg);
    expect(after).toHaveAttribute('data-material', 'pebble');
    expect(after.style.getPropertyValue('--bot-phase')).toBe(phase);
    expect(after.getAttribute('data-state')).toBe(state);
    expect(handleBot()).toBe(firstHandle);
    expect(handleBot()).toHaveAttribute('data-material', 'pebble');
    expect(mode()).toBe('peek');
    expect(within(layer('peek')).getByText('Otto')).toBeInTheDocument();
  });

  it('an ask has no clock; a notice keeps the time it had left while held', () => {
    snapshot([otto(), pim(asks('git push'))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    expect(mode()).toBe('bubble');
    expect(document.querySelector('[data-timer]')).toBeNull();
    fireEvent.click(within(layer('bubble')).getByRole('button', { name: 'Approve' }));
    update(pim({ state: 'working' }));
    tick(900);
    expect(mode()).toBe('handle');
    update(otto({ state: 'idle' }));
    tick(540);
    expect(screen.getByText('Otto finished')).toBeInTheDocument();
    tick(1000);
    fireEvent.mouseEnter(surface());
    tick(5000);
    expect(mode()).toBe('bubble');
    fireEvent.mouseLeave(surface());
    expect(document.querySelector('[data-timer]')).toHaveAttribute('data-remaining', '5000');
    tick(4999);
    expect(mode()).toBe('bubble');
    tick(1);
    expect(mode()).toBe('handle');
  });

  it('a late confirmation cannot steal focus', () => {
    snapshot([otto(asks('rm -rf dist')), pim(asks('git push'))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    expect(screen.getByText('Otto needs your approval')).toBeInTheDocument();
    fireEvent.click(within(layer('bubble')).getByRole('button', { name: 'Approve' }));
    expect(rec.sent).toContainEqual({ type: 'session.decide', id: 'a', decision: 'accept' });
    // Ctrl+Alt+L while Otto's ask is showing opens the chat. The late confirmation must not steal it.
    shortcut();
    expect(mode()).toBe('chat');
    const field = screen.getByRole('textbox', { name: 'Ask Ledge' }) as HTMLInputElement;
    act(() => field.focus());
    fireEvent.change(field, { target: { value: 'wait for CI' } });
    update(otto({ state: 'working' }));
    tick(900);
    expect(mode()).toBe('chat');
    expect(field.value).toBe('wait for CI');
    expect(document.activeElement).toBe(field);
    expect(rec.sent.filter(m => m.type === 'session.decide' && m.id === 'b')).toHaveLength(0);
  });

  it('decision timing does not fabricate success', () => {
    const cmd = asks('rm -rf dist');
    snapshot([otto(cmd)]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    const bubble = layer('bubble');
    const btn = (name: string) => within(bubble).getByRole('button', { name });
    fireEvent.click(btn('Approve'));
    tick(900);
    expect(mode()).toBe('bubble');
    expect(bubble).toHaveAttribute('data-ack', 'pending');
    expect(btn('Approve')).toBeDisabled();
    expect(within(bubble).queryByText(/received/i)).toBeNull();
    // A terminal error unlocks recovery and never shows success.
    update(otto({ ...cmd, state: 'error', lastError: 'the terminal did not take it' }));
    expect(bubble).toHaveAttribute('data-ack', 'failed');
    expect(btn('Approve')).toBeEnabled();
    expect(within(bubble).getByText(/the terminal did not take it/)).toBeInTheDocument();
    expect(bubble.querySelector('svg.bot')).toHaveAttribute('data-state', 'error');
    expect(bubble.querySelector('svg.bot')).not.toHaveAttribute('data-gesture');
    expect(within(bubble).queryByText(/received/i)).toBeNull();
    tick(900);
    expect(mode()).toBe('bubble');
    // A daemon error reply for that id unlocks it too.
    fireEvent.click(btn('Deny'));
    expect(bubble).toHaveAttribute('data-ack', 'pending');
    act(() => { daemonStore.apply({ type: 'error', id: 'a', message: 'nothing to decide' }); });
    expect(bubble).toHaveAttribute('data-ack', 'failed');
    expect(btn('Deny')).toBeEnabled();
    expect(within(bubble).getByText(/nothing to decide/)).toBeInTheDocument();
    // A confirmed refusal: the bubble advances once the daemon says so, and nothing invents test results.
    fireEvent.click(btn('Deny'));
    expect(rec.sent.filter(m => m.type === 'session.decide')).toEqual([
      { type: 'session.decide', id: 'a', decision: 'accept' }, { type: 'session.decide', id: 'a', decision: 'deny' }, { type: 'session.decide', id: 'a', decision: 'deny' }
    ]);
    update(otto({ state: 'idle' }));
    tick(900);
    expect(mode()).toBe('handle');
    fireEvent.click(screen.getByRole('button', { name: /Otto available, open/ }));
    const view = layer('peek');
    expect(within(view).getByText('Available')).toBeInTheDocument();
    expect(within(view).queryByText(/passed|tests? ran|all green|✓/i)).toBeNull();
  });

  it('large and empty teams fit', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver); FakeResizeObserver.all = [];
    snapshot([]);
    const { unmount } = render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    expect(surface()).toHaveStyle({ width: `${islandWidth(0)}px`, height: '38px' });
    unmount();

    const team = Array.from({ length: 12 }, (_, i) => fakeSession(`s${String(i).padStart(2, '0')}`, { name: `Bot${i}`, ...(i % 4 === 1 ? asks(`cmd ${i}`) : {}) }));
    snapshot(team);
    const big = render(<Surface screenH={1080} theme="dark" client={rec.client} dnd onToggleDnd={() => {}} />);
    // Six companions at most, the asks first, then a "+6" pill for the rest; the island stays inside the 1024 px viewport.
    const buttons = within(layer('handle')).getAllByRole('button', { name: /open$/ }).filter(b => !b.hasAttribute('data-resident'));
    expect(buttons).toHaveLength(6);
    for (const b of buttons) expect(b).toHaveStyle({ width: '22px' });
    expect(buttons.slice(0, 3).every(b => /needs your approval/.test(b.getAttribute('aria-label')!))).toBe(true);
    expect(layer('handle').querySelector('[data-overflow]')).toHaveTextContent('+6');
    const left = parseFloat(surface().style.left), w = parseFloat(surface().style.width);
    expect(surface()).toHaveStyle({ top: '0px', height: '38px' });
    expect(left).toBeGreaterThanOrEqual(0); expect(left + w).toBeLessThanOrEqual(1024);
    big.unmount();

    daemonStore.reset();
    const long = 'pnpm --filter overlay test --run prototype-parity machine keyboard theme bubble session --reporter verbose';
    snapshot([otto(asks(long))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    expect(mode()).toBe('bubble');
    const ro = FakeResizeObserver.all.find(o => o.target === layer('bubble') && !o.disconnected)!;
    expect(ro).toBeDefined();
    act(() => ro.report(172));
    // The surface is borderless (the notch merges with the screen edge): it holds the whole bubble, timer bar included.
    expect(surface()).toHaveStyle({ width: '440px', height: `${172 + SURFACE_CHROME_Y}px` });
    expect(surface().getAttribute('style')).not.toMatch(/border(-(top|right|bottom|left))?(-(width|style|color))?:/);
    expect(layer('bubble')).toHaveStyle({ width: '440px' });
    expect(within(layer('bubble')).getByText(new RegExp(long.slice(0, 20)))).not.toHaveStyle({ whiteSpace: 'nowrap' });
    expect(within(layer('bubble')).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('native Tab and the card keys coexist', () => {
    snapshot([otto(asks('rm -rf dist')), pim(question('Which?', ['Rebase', 'Merge'])), lu()]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    shortcut();
    expect(mode()).toBe('bubble');
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })).toBe(true);
    for (const name of ['handle', 'settings', 'help', 'list']) expect(layer(name)).toHaveAttribute('inert');
    expect(layer('bubble')).not.toHaveAttribute('inert');
    const field = within(layer('bubble')).getByRole('button', { name: 'Approve' });
    act(() => field.focus());
    for (const k of ['j', 'k']) fireEvent.keyDown(field, { key: k });
    expect(mode()).toBe('bubble');
    expect(rec.sent.some(m => m.type === 'session.decide')).toBe(false);
    press('Escape');
    expect(mode()).toBe('bubble');
    expect(screen.getByText('Pim has a question')).toBeInTheDocument();
    const radio = screen.getByRole('radio', { name: /Rebase/ });
    act(() => radio.focus());
    for (const k of ['j', 'k', 'y', 'n']) fireEvent.keyDown(radio, { key: k });
    expect(mode()).toBe('bubble');
    expect(rec.sent).toHaveLength(0);
  });

  it('a chat draft survives a disconnect, and an offline ask cannot be decided', () => {
    snapshot([otto(), pim(asks('git push')), lu({ ...asks('rm -rf /tmp/x'), source: 'hook_only' })]);
    render(<Harness client={rec.client} dnd />);
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    tick(180);
    const field = screen.getByRole('textbox', { name: 'Ask Ledge' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'keep going, then rebase' } });
    act(() => daemonStore.setStatus('unreachable'));
    expect(field.value).toBe('keep going, then rebase');
    expect(field).toBeDisabled();
    for (const svg of document.querySelectorAll('svg.bot')) expect(svg).toHaveAttribute('data-frozen', 'true');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(rec.sent.filter(m => m.type === 'chat.ask')).toHaveLength(0);
    act(() => daemonStore.setStatus('open'));
    expect(field).toBeEnabled();
    expect(field.value).toBe('keep going, then rebase');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mode()).toBe('handle');
    act(() => daemonStore.setStatus('unreachable'));
    shortcut();
    expect(mode()).toBe('bubble');
    expect(within(layer('bubble')).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(layer('bubble')).getByRole('button', { name: 'Deny' })).toBeDisabled();
    press('y'); press('n');
    expect(rec.sent).toHaveLength(0);
  });

  it('reduced motion keeps the card usable, and an ask does not expire', () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    snapshot([otto(), lu()]);
    const onToggleDnd = vi.fn();
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd onToggleDnd={onToggleDnd} />);
    for (const svg of document.querySelectorAll('svg.bot')) expect(svg).toHaveAttribute('data-reduced', 'false');
    shortcut();
    expect(mode()).toBe('chat');
    fireEvent.click(screen.getByRole('button', { name: 'Ledge menu' }));
    fireEvent.click(screen.getByRole('switch', { name: /Do not disturb/ }));
    expect(onToggleDnd).toHaveBeenCalledTimes(1);
    press('Escape');
    expect(mode()).toBe('handle');
    update(lu(question('Which strategy?', ['Backfill', 'Shadow'])));
    tick(540);
    expect(mode()).toBe('handle');
    fireEvent.click(screen.getByRole('button', { name: /Lu has a question, open/ }));
    expect(mode()).toBe('bubble');
    tick(6000);
    expect(mode()).toBe('bubble');
    fireEvent.click(screen.getByRole('radio', { name: /Shadow/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(rec.sent).toContainEqual({ type: 'session.reply', id: 'c', text: 'Shadow' });
  });

  it('reduced motion: the OS preference wins and hidden or unmounted bots release their timers', () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    const props = { tool: 'claude' as const, state: 'working' as const, pose: 1 as const, size: 48, theme: 'dark' as const, seed: 'a', reducedMotion: false };
    vi.clearAllTimers(); // only this bot's own work is counted
    const { rerender, unmount } = render(<Bot {...props} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    rerender(<Bot {...props} paused />);
    expect(vi.getTimerCount()).toBe(0);
    rerender(<Bot {...props} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<Bot {...props} />);
    expect(document.querySelector('svg.bot')).toHaveAttribute('data-reduced', 'true');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('carried items', () => {
  const inInert = () => !!document.activeElement?.closest('[inert]');

  it('a dropped connection unlocks a decision in flight; the next snapshot resolves it', () => {
    snapshot([otto(asks('rm -rf dist'))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    fireEvent.click(within(layer('bubble')).getByRole('button', { name: 'Approve' }));
    act(() => daemonStore.setStatus('unreachable'));
    expect(layer('bubble')).toHaveAttribute('data-ack', 'failed');
    expect(layer('bubble').querySelector('svg.bot')).toHaveAttribute('data-frozen', 'true');
    // Offline keeps the actions off until the daemon is back.
    expect(within(layer('bubble')).getByRole('button', { name: 'Approve' })).toBeDisabled();
    snapshot([otto({ state: 'working' })]);
    expect(mode()).toBe('handle');
    expect(rec.sent).toHaveLength(1);
  });

  it('a retry that fails again (already in error, the daemon answers with an error reply) unlocks again', () => {
    const cmd = asks('rm -rf dist');
    snapshot([otto(cmd)]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    const bubble = layer('bubble');
    const approve = () => within(bubble).getByRole('button', { name: 'Approve' });
    fireEvent.click(approve());
    update(otto({ ...cmd, state: 'error', lastError: 'the terminal did not take it', lastActivityAt: '2026-10-09T18:05:00.000Z' }));
    act(() => { daemonStore.apply({ type: 'error', id: 'a', message: 'the terminal did not take it' }); });
    expect(bubble).toHaveAttribute('data-ack', 'failed');
    expect(approve()).toBeEnabled();
    fireEvent.click(approve());
    expect(bubble).toHaveAttribute('data-ack', 'pending');
    expect(approve()).toBeDisabled();
    // Pane activity while the retry is in flight is not a failure (no lastActivityAt heuristic any more).
    update(otto({ ...cmd, state: 'error', lastError: 'the terminal did not take it', lastActivityAt: '2026-10-09T18:05:30.000Z' }));
    expect(bubble).toHaveAttribute('data-ack', 'pending');
    expect(approve()).toBeDisabled();
    // The retry fails too: InjectFailed (still in error), then the daemon's error reply for that id.
    update(otto({ ...cmd, state: 'error', lastError: 'the terminal did not take it', lastActivityAt: '2026-10-09T18:06:00.000Z' }));
    expect(bubble).toHaveAttribute('data-ack', 'pending');
    act(() => { daemonStore.apply({ type: 'error', id: 'a', message: 'the terminal did not take it' }); });
    expect(bubble).toHaveAttribute('data-ack', 'failed');
    expect(approve()).toBeEnabled();
    fireEvent.click(approve());
    expect(rec.sent.filter(m => m.type === 'session.decide')).toHaveLength(3);
  });

  it('a failure text never carries over to the next request of the same session', () => {
    snapshot([otto(asks('rm -rf dist'))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    fireEvent.click(within(layer('bubble')).getByRole('button', { name: 'Approve' }));
    act(() => { daemonStore.apply({ type: 'error', id: 'a', message: 'nothing to decide' }); });
    expect(within(layer('bubble')).getByText(/nothing to decide/)).toBeInTheDocument();
    // Resolved, then a new request: no stale failure in the bubble or the session view.
    update(otto({ state: 'working' }));
    update(otto(asks('git push --force')));
    tick(540);
    expect(mode()).toBe('bubble');
    expect(within(layer('bubble')).queryByText(/nothing to decide/)).toBeNull();
    expect(layer('bubble')).toHaveAttribute('data-ack', 'none');
    fireEvent.click(within(layer('bubble')).getByRole('button', { name: 'Approve' }));
    act(() => { daemonStore.apply({ type: 'error', id: 'a', message: 'nothing to decide' }); });
    expect(within(layer('bubble')).getByText(/nothing to decide/)).toBeInTheDocument();
    update(otto(asks('npm publish')));
    expect(within(layer('bubble')).queryByText(/nothing to decide/)).toBeNull();
  });

  it('every rendered bot freezes while the daemon is unreachable', () => {
    snapshot([otto(), pim(asks('git push'))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    act(() => daemonStore.setStatus('unreachable'));
    const bots = document.querySelectorAll('svg.bot');
    expect(bots.length).toBeGreaterThanOrEqual(2);
    for (const svg of bots) expect(svg).toHaveAttribute('data-frozen', 'true');
    act(() => daemonStore.setStatus('open'));
    for (const svg of document.querySelectorAll('svg.bot')) expect(svg).toHaveAttribute('data-frozen', 'false');
  });

  it('a mouse open of a bot shows the peek; Escape folds it and never leaves focus in an inert layer', () => {
    snapshot([otto(), pim()]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Pim working, open/ }));
    expect(mode()).toBe('peek');
    press('Escape');
    expect(mode()).toBe('handle');
    expect(inInert()).toBe(false);
  });

  it('the chat menu sends settings to Ledge Desktop and toggles do not disturb here', () => {
    snapshot([otto()]);
    const onToggleDnd = vi.fn();
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={onToggleDnd} />);
    shortcut();
    expect(mode()).toBe('chat');
    expect(surface()).toHaveStyle({ width: '480px' });
    expect(screen.queryByRole('button', { name: 'Back to sessions' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ledge menu' }));
    fireEvent.click(screen.getByRole('button', { name: /Settings in Ledge Desktop/ }));
    expect(screen.getByText(/Opening settings in Ledge Desktop/)).toBeInTheDocument();
    expect(mode()).toBe('chat');
    fireEvent.click(screen.getByRole('button', { name: 'Ledge menu' }));
    fireEvent.click(screen.getByRole('switch', { name: /Do not disturb/ }));
    expect(onToggleDnd).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mode()).toBe('handle');
    expect(inInert()).toBe(false);
  });

  it('useMeasuredHeight observes only while active and disconnects on unmount', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver); FakeResizeObserver.all = [];
    const { result, rerender, unmount } = renderHook(({ active }) => {
      const ref = useRef<HTMLElement | null>(document.createElement('div'));
      return useMeasuredHeight(ref, active);
    }, { initialProps: { active: false } });
    expect(FakeResizeObserver.all).toHaveLength(0);
    expect(result.current).toBe(0);
    rerender({ active: true });
    const ro = FakeResizeObserver.all[0]!;
    act(() => ro.report(140));
    expect(result.current).toBe(140);
    rerender({ active: false });
    expect(ro.disconnected).toBe(true);
    rerender({ active: true });
    unmount();
    expect(FakeResizeObserver.all.every(o => o.disconnected)).toBe(true);
  });

  it('status badges are calm: none pulses', () => {
    for (const state of Object.keys(BADGE) as BotState[]) {
      const { container, unmount } = render(<Badge state={state} />);
      for (const el of container.querySelectorAll<HTMLElement>('*')) expect(el.style.animation).toBe('');
      unmount();
    }
  });
});
