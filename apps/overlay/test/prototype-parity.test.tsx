import { filetWidth } from '../src/surface/geometry';
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
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    const reply = screen.getByPlaceholderText('Reply to Otto…');
    fireEvent.change(reply, { target: { value: 'not yet' } });
    const svg = layer('session').querySelector('svg.bot') as SVGSVGElement;
    const phase = svg.style.getPropertyValue('--bot-phase'); const state = svg.getAttribute('data-state');
    expect(svg).toHaveAttribute('data-material', 'signal');
    rerender(<Surface screenH={1080} theme="light" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    const after = layer('session').querySelector('svg.bot') as SVGSVGElement;
    expect(after).toBe(svg);
    expect(after).toHaveAttribute('data-material', 'pebble');
    expect(after.style.getPropertyValue('--bot-phase')).toBe(phase);
    expect(after.getAttribute('data-state')).toBe(state);
    expect(layer('handle').querySelector('[data-ledge-mark]')).toBeInTheDocument();
    expect(mode()).toBe('session');
    expect((screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement).value).toBe('not yet');
  });

  it('bubble retains its remaining time', () => {
    snapshot([otto(), pim(asks('git push'))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    const bubbleBtn = (name: string) => within(layer('bubble')).getByRole('button', { name });
    const holders: Array<{ hold: () => void; release: () => void }> = [
      { hold: () => fireEvent.mouseEnter(surface()), release: () => fireEvent.mouseLeave(surface()) },
      { hold: () => act(() => bubbleBtn('Approve').focus()), release: () => act(() => (document.activeElement as HTMLElement).blur()) },
      (() => {
        let spy: { mockRestore(): void } | null = null;
        return {
          hold: () => { spy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); act(() => { document.dispatchEvent(new Event('visibilitychange')); }); },
          release: () => { spy!.mockRestore(); act(() => { document.dispatchEvent(new Event('visibilitychange')); }); }
        };
      })()
    ];
    let n = 0;
    for (const h of holders) {
      // A fresh ask re-unfolds the bubble; the oldest pending request (Pim's, never answered) comes back first.
      if (n++ > 0) update(fakeSession(`late${n}`, { name: `Late${n}`, startedAt: `2026-10-09T18:0${n + 2}:00.000Z`, ...asks(`ls ${n}`) }));
      tick(540);
      expect(mode()).toBe('bubble');
      expect(screen.getByText('Pim needs your approval')).toBeInTheDocument();
      tick(1000);
      h.hold();
      tick(5000);
      expect(mode()).toBe('bubble');
      h.release();
      expect(document.querySelector('[data-timer]')).toHaveAttribute('data-remaining', '3000');
      tick(2999);
      expect(mode()).toBe('bubble');
      tick(1);
      expect(mode()).toBe('handle');
      // Closing preserves the pending request: nothing was decided and Pim still asks from the handle.
      expect(rec.sent.filter(m => m.type === 'session.decide')).toHaveLength(0);
      expect(screen.getByRole('button', { name: /Pim needs your approval, open/ })).toBeInTheDocument();
    }
  });

  it('a late confirmation cannot steal focus', () => {
    snapshot([otto(asks('rm -rf dist')), pim(asks('git push'))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    expect(screen.getByText('Otto needs your approval')).toBeInTheDocument();
    fireEvent.click(within(layer('bubble')).getByRole('button', { name: 'Approve' }));
    expect(rec.sent).toContainEqual({ type: 'session.decide', id: 'a', decision: 'accept' });
    // Manually open B from the keyboard: Ctrl+Alt+L over the bubble opens the list.
    shortcut();
    expect(mode()).toBe('list');
    toRow(2); press('Enter');
    expect(mode()).toBe('session');
    expect(document.activeElement).toHaveAccessibleName('Back to sessions');
    const reply = screen.getByPlaceholderText('Reply to Pim…') as HTMLInputElement;
    act(() => reply.focus());
    fireEvent.change(reply, { target: { value: 'wait for CI' } });
    // A's confirmation lands late.
    update(otto({ state: 'working' }));
    tick(900);
    expect(mode()).toBe('session');
    expect(screen.getByText('Pim · speos-api')).toBeInTheDocument();
    expect(reply.value).toBe('wait for CI');
    expect(document.activeElement).toBe(reply);
    // Double-clicking sends one command.
    const approve = within(layer('session')).getByRole('button', { name: 'Approve' });
    fireEvent.click(approve); fireEvent.click(approve);
    expect(rec.sent.filter(m => m.type === 'session.decide' && m.id === 'b')).toHaveLength(1);
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
    const view = layer('session');
    expect(within(view).getByRole('img', { name: /Available/ })).toBeInTheDocument();
    expect(within(view).queryByText(/passed|tests? ran|all green|✓/i)).toBeNull();
  });

  it('large and empty teams fit', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver); FakeResizeObserver.all = [];
    snapshot([]);
    const { unmount } = render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    expect(surface()).toHaveStyle({ width: `${filetWidth([])}px`, height: '10px' });
    unmount();

    const team = Array.from({ length: 12 }, (_, i) => fakeSession(`s${String(i).padStart(2, '0')}`, { name: `Bot${i}`, ...(i % 4 === 1 ? asks(`cmd ${i}`) : {}) }));
    snapshot(team);
    const big = render(<Surface screenH={1080} theme="dark" client={rec.client} dnd onToggleDnd={() => {}} />);
    // Every session is a dash, asks first; the filet stays inside the 1024 px viewport.
    const buttons = within(layer('handle')).getAllByRole('button', { name: /open$/ }).filter(b => !b.hasAttribute('data-resident'));
    expect(buttons).toHaveLength(12);
    for (const b of buttons) expect(b).toHaveStyle({ width: '5px' });
    expect(buttons.slice(0, 3).every(b => /needs your approval/.test(b.getAttribute('aria-label')!))).toBe(true);
    expect(layer('handle').querySelector('[data-overflow]')).toBeNull();
    const left = parseFloat(surface().style.left), w = parseFloat(surface().style.width);
    expect(surface()).toHaveStyle({ top: '0px', height: '10px' });
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

  it('native Tab and scoped shortcuts coexist', () => {
    snapshot([otto(asks('rm -rf dist')), pim(question('Which?', ['Rebase', 'Merge'])), lu()]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd onToggleDnd={() => {}} />);
    shortcut();
    expect(mode()).toBe('list');
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })).toBe(true);
    press('ArrowRight', { altKey: true });
    expect(document.activeElement).toHaveAttribute('aria-label', expect.stringMatching(/Pim/));
    // Every inactive layer is inert, so nothing in it can take focus.
    for (const name of ['handle', 'bubble', 'settings', 'help']) expect(layer(name)).toHaveAttribute('inert');
    expect(layer('list')).not.toHaveAttribute('inert');
    toRow(1); press('Enter');
    expect(mode()).toBe('session');
    const reply = screen.getByPlaceholderText('Reply to Otto…');
    act(() => reply.focus());
    for (const k of ['j', 'k', 'y', 'n']) fireEvent.keyDown(reply, { key: k });
    expect(mode()).toBe('session');
    expect(rec.sent.some(m => m.type === 'session.decide')).toBe(false);
    press('Escape'); // leaves the field's ownership to Escape: back to the list
    expect(mode()).toBe('list');
    toRow(2); press('Enter');
    const radio = screen.getByRole('radio', { name: 'Rebase' });
    act(() => radio.focus());
    for (const k of ['j', 'k', 'y', 'n']) fireEvent.keyDown(radio, { key: k });
    expect(mode()).toBe('session');
    expect(screen.getByText('Pim · speos-api')).toBeInTheDocument();
    expect(rec.sent).toHaveLength(0);
  });

  it('drafts survive view and connection changes', () => {
    snapshot([otto(), pim(asks('git push')), lu({ ...asks('rm -rf /tmp/x'), source: 'hook_only' })]);
    render(<Harness client={rec.client} dnd />);
    const value = () => (screen.getByPlaceholderText('Reply to Otto…') as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    fireEvent.change(screen.getByPlaceholderText('Reply to Otto…'), { target: { value: 'keep going, then rebase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(mode()).toBe('list');
    fireEvent.click(within(layer('list')).getByRole('button', { name: 'Settings' }));
    fireEvent.click(within(layer('settings')).getByRole('button', { name: /theme/i }));
    expect(layer('handle').querySelector('[data-ledge-mark]')).toBeInTheDocument();
    fireEvent.click(within(layer('settings')).getByRole('button', { name: 'Back to sessions' }));
    fireEvent.click(within(layer('list')).getByRole('button', { name: /harness-assistant, Otto, open/ }));
    expect(value()).toBe('keep going, then rebase');
    fireEvent.click(screen.getByRole('button', { name: 'Reading mode' }));
    expect(value()).toBe('keep going, then rebase');
    fireEvent.click(screen.getByRole('button', { name: 'Reading mode' }));
    act(() => daemonStore.setStatus('unreachable'));
    expect(value()).toBe('keep going, then rebase');
    // Offline: the bots freeze and every send path is disabled, the draft stays editable.
    for (const svg of document.querySelectorAll('svg.bot')) expect(svg).toHaveAttribute('data-frozen', 'true');
    expect(within(layer('session')).getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(screen.getByPlaceholderText('Reply to Otto…'), { key: 'Enter' });
    expect(rec.sent.filter(m => m.type === 'session.reply')).toHaveLength(0);
    snapshot([otto(), pim(asks('git push')), lu({ ...asks('rm -rf /tmp/x'), source: 'hook_only' })]);
    expect(value()).toBe('keep going, then rebase');
    expect(within(layer('session')).getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.click(within(layer('session')).getByRole('button', { name: 'Close' }));
    expect(mode()).toBe('handle');
    fireEvent.click(screen.getByRole('button', { name: /Otto working, open/ }));
    expect(value()).toBe('keep going, then rebase');
    fireEvent.click(within(layer('session')).getByRole('button', { name: 'Close' }));

    // Offline from the keyboard: y, n, digits and r-send do nothing; the buttons are disabled. The terminal tab stays
    // reachable (it is the fallback), but `o` sends nothing to the unreachable daemon.
    act(() => daemonStore.setStatus('unreachable'));
    shortcut();
    toRow(2);
    press('y'); press('n'); press('o');
    press('Enter');
    expect(mode()).toBe('session');
    const view = layer('session');
    expect(within(view).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(view).getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(within(view).getByRole('button', { name: 'Kill session' })).toBeDisabled();
    expect(within(view).getByRole('button', { name: 'Focus terminal tab' })).toBeEnabled();
    press('y'); press('n'); press('o');
    press('r');
    fireEvent.change(document.activeElement!, { target: { value: 'please' } });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(rec.sent).toHaveLength(0);

    // Read-only (started without Ledge): the same, while the daemon is reachable.
    snapshot([otto(), pim(asks('git push')), lu({ ...asks('rm -rf /tmp/x'), source: 'hook_only' })]);
    press('Escape');
    toRow(3); press('y'); press('n');
    press('Enter');
    expect(screen.getByText('Lu · docs')).toBeInTheDocument();
    expect(within(layer('session')).getByRole('button', { name: 'Approve' })).toBeDisabled();
    press('y');
    expect(rec.sent).toHaveLength(0);
  });

  it('reduced motion keeps interactions functional', () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    snapshot([otto(), lu(question('Which strategy?', ['Backfill', 'Shadow']))]);
    render(<Harness client={rec.client} dnd />);
    for (const svg of document.querySelectorAll('svg.bot')) expect(svg).toHaveAttribute('data-reduced', 'false');
    shortcut();
    fireEvent.click(within(layer('list')).getByRole('button', { name: 'Settings' }));
    expect(mode()).toBe('settings');
    fireEvent.click(within(layer('settings')).getByRole('switch', { name: /Reduced motion/ }));
    for (const svg of document.querySelectorAll('svg.bot')) expect(svg).toHaveAttribute('data-reduced', 'true');
    press('Escape');
    expect(mode()).toBe('list');
    // Do not disturb off, then a new ask: the bubble still expires after 4,000 ms of active time.
    fireEvent.click(within(layer('list')).getAllByRole('button', { name: 'Do not disturb' })[0]!);
    press('Escape');
    expect(mode()).toBe('handle');
    update(pim(asks('git push')));
    tick(540);
    expect(mode()).toBe('bubble');
    tick(3999);
    expect(mode()).toBe('bubble');
    tick(1);
    expect(mode()).toBe('handle');
    // Replies still work.
    fireEvent.click(screen.getByRole('button', { name: /Lu has a question, open/ }));
    fireEvent.click(screen.getByLabelText('Shadow'));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(rec.sent).toContainEqual({ type: 'session.reply', id: 'c', text: '2' });
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
    fireEvent.click(screen.getByRole('link', { name: /Otto needs your approval/ }));
    expect(within(layer('session')).queryByText(/nothing to decide/)).toBeNull();
    // A request replaced in place (no resolution in between) also drops the old failure.
    fireEvent.click(within(layer('session')).getByRole('button', { name: 'Approve' }));
    act(() => { daemonStore.apply({ type: 'error', id: 'a', message: 'nothing to decide' }); });
    expect(within(layer('session')).getByText(/nothing to decide/)).toBeInTheDocument();
    update(otto(asks('npm publish')));
    expect(within(layer('session')).queryByText(/nothing to decide/)).toBeNull();
  });

  it('every rendered bot freezes while the daemon is unreachable', () => {
    snapshot([otto(), pim(asks('git push'))]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    tick(540);
    fireEvent.click(screen.getByRole('link', { name: /Pim needs your approval/ }));
    act(() => daemonStore.setStatus('unreachable'));
    const bots = document.querySelectorAll('svg.bot');
    expect(bots.length).toBeGreaterThanOrEqual(1);
    for (const svg of bots) expect(svg).toHaveAttribute('data-frozen', 'true');
    act(() => daemonStore.setStatus('open'));
    for (const svg of document.querySelectorAll('svg.bot')) expect(svg).toHaveAttribute('data-frozen', 'false');
  });

  it('a mouse open moves focus into the session; Escape steps back to the list then closes, never leaving focus in an inert layer', () => {
    snapshot([otto(), pim()]);
    render(<Surface screenH={1080} theme="dark" client={rec.client} dnd={false} onToggleDnd={() => {}} />);
    fireEvent.mouseEnter(document.querySelector('[data-surface]')!);
    tick(180);
    const row = within(layer('list')).getByRole('button', { name: /speos-api, Pim, open/ });
    act(() => row.focus());
    fireEvent.click(row);
    expect(mode()).toBe('session');
    expect(document.activeElement).toHaveAccessibleName('Back to sessions');
    press('Escape');
    expect(mode()).toBe('list');
    expect(document.activeElement).toBe(row);
    press('Escape');
    expect(mode()).toBe('handle');
    expect(inInert()).toBe(false);
  });

  it('settings share do not disturb, theme and motion with the app; the footer opens the help', () => {
    snapshot([otto()]);
    render(<Harness client={rec.client} />);
    shortcut();
    const list = layer('list');
    fireEvent.click(within(list).getByRole('button', { name: 'Settings' }));
    expect(mode()).toBe('settings');
    expect(surface()).toHaveStyle({ width: '380px' });
    expect(document.activeElement).toHaveAccessibleName('Back to sessions');
    const view = layer('settings');
    fireEvent.click(within(view).getByRole('tab', { name: 'Notifications' }));
    fireEvent.click(within(view).getByRole('switch', { name: /Do not disturb/ }));
    for (const b of within(list).getAllByRole('button', { name: 'Do not disturb', hidden: true })) expect(b).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(view).getByRole('tab', { name: 'Display' }));
    expect(within(view).getByRole('button', { name: /Dark theme · Signal/ })).toBeInTheDocument();
    fireEvent.click(within(view).getByRole('button', { name: /theme/ }));
    expect(within(view).getByRole('button', { name: /Light theme · Pebble/ })).toBeInTheDocument();
    expect(mode()).toBe('settings');
    fireEvent.click(within(view).getByRole('button', { name: 'Back to sessions' }));
    expect(mode()).toBe('list');
    fireEvent.click(within(list).getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(mode()).toBe('help');
    expect(within(layer('help')).getByText('Previous or next session')).toBeInTheDocument();
    fireEvent.click(within(layer('help')).getByRole('button', { name: 'Close' }));
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
