import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, renderHook, cleanup } from '@testing-library/react';
import { StrictMode, type ComponentProps } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeSession } from './mockDaemon';
import { Bot } from '../src/bots/Bot';
import { botState, poseFor } from '../src/bots/poseFor';
import { useMotionPreferences } from '../src/motionPreferences';

type Props = ComponentProps<typeof Bot>;
const base: Props = { tool: 'claude', state: 'working', pose: 1, size: 32, theme: 'dark', seed: 'session-a', reducedMotion: false };

/** Steps fake time in 10 ms ticks and records the rising edges of blinks and gaze moves. */
function record(svg: SVGSVGElement, totalMs: number, at?: { ms: number; run: () => void }) {
  const blinks: number[] = [];
  const looks: Array<[number, string]> = [];
  const gestures: Array<[number, string]> = [];
  let blinking = false;
  let gaze = svg.style.getPropertyValue('--bot-gx');
  let gesture = svg.getAttribute('data-gesture');
  for (let t = 10; t <= totalMs; t += 10) {
    act(() => { vi.advanceTimersByTime(10); });
    if (at && t === at.ms) act(at.run);
    const b = svg.getAttribute('data-blink') === 'true';
    if (b && !blinking) blinks.push(t);
    blinking = b;
    const g = svg.style.getPropertyValue('--bot-gx');
    if (g !== gaze) looks.push([t, g]);
    gaze = g;
    const ge = svg.getAttribute('data-gesture');
    if (ge && ge !== gesture) gestures.push([t, ge]);
    gesture = ge;
  }
  return { blinks, looks, gestures };
}

function mount(props: Partial<Props> = {}) {
  const view = render(<Bot {...base} {...props} />);
  return { ...view, svg: view.container.querySelector('svg')! };
}

describe('Bot ambient motion', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('blinks and moves the gaze on a deterministic, seed-specific schedule within the spec ranges', () => {
    const a1 = record(mount({ seed: 'session-a' }).svg, 30_000);
    const a2 = record(mount({ seed: 'session-a' }).svg, 30_000);
    const b = record(mount({ seed: 'session-b' }).svg, 30_000);
    expect(a1).toEqual(a2);
    expect(a1.blinks).not.toEqual(b.blinks);
    expect(a1.blinks.length).toBeGreaterThanOrEqual(4);
    for (const run of [a1, b]) {
      const gaps = run.blinks.slice(1).map((t, i) => t - run.blinks[i]!);
      gaps.forEach(g => { expect(g).toBeGreaterThanOrEqual(3400); expect(g).toBeLessThanOrEqual(6700); });
      const lookGaps = run.looks.slice(1).map(([t], i) => t - run.looks[i]![0]);
      lookGaps.forEach(g => { expect(g).toBeGreaterThanOrEqual(2400); expect(g).toBeLessThanOrEqual(4500); });
      expect(new Set(run.looks.map(([, g]) => g))).toEqual(new Set(['1.4px', '-1.4px']));
    }
  });

  it('ends each blink after 180 ms', () => {
    const { svg } = mount();
    const { blinks } = record(svg, 8000);
    const first = blinks[0]!;
    vi.setSystemTime(0);
    const { svg: again } = mount();
    act(() => { vi.advanceTimersByTime(first); });
    expect(again).toHaveAttribute('data-blink', 'true');
    act(() => { vi.advanceTimersByTime(180); });
    expect(again).not.toHaveAttribute('data-blink', 'true');
  });

  it('keeps its scheduled deadlines through a theme-only rerender', () => {
    const plain = record(mount().svg, 20_000);
    vi.setSystemTime(0);
    const { svg, rerender } = mount();
    const themed = record(svg, 20_000, { ms: 2000, run: () => rerender(<Bot {...base} theme="light" />) });
    expect(svg).toHaveAttribute('data-material', 'pebble');
    expect(themed.blinks).toEqual(plain.blinks);
    expect(themed.looks).toEqual(plain.looks);
  });

  it('keeps the seed, and so the schedule, through a rename', () => {
    const before = fakeSession('s1', { name: 'Otto' });
    const props = (s: typeof before): Props => ({ ...base, seed: s.id, tool: s.tool, state: botState(s), pose: poseFor(s.id, s.state) });
    const plain = record(mount(props(before)).svg, 15_000);
    vi.setSystemTime(0);
    const { svg, rerender } = mount(props(before));
    const renamed = record(svg, 15_000, { ms: 1000, run: () => rerender(<Bot {...props({ ...before, name: 'Renamed' })} />) });
    expect(renamed.blinks).toEqual(plain.blinks);
  });

  it('raises the hand exactly once for a new approval request, after the gaze settles', () => {
    const { svg, rerender } = mount();
    const run = record(svg, 12_000, { ms: 1000, run: () => rerender(<Bot {...base} state="approval" />) });
    expect(run.gestures).toEqual([[1180, 'ask']]);
    expect(svg).not.toHaveAttribute('data-gesture');
    expect(svg.style.getPropertyValue('--bot-gx')).toBe('0px');
  });

  it('does not raise the hand again when an approval bot is re-rendered', () => {
    const { svg, rerender } = mount({ state: 'approval' });
    const run = record(svg, 5000, { ms: 1000, run: () => rerender(<Bot {...base} state="approval" theme="light" />) });
    expect(run.gestures).toEqual([]);
  });

  it('waves once when it mounts already asking with a request key', () => {
    const { svg } = mount({ state: 'approval', askKey: 'req-1' });
    expect(record(svg, 5000).gestures).toEqual([[180, 'ask']]);
  });

  it('waves once per new request key, never again for the same key', () => {
    const { svg, rerender } = mount({ state: 'approval', askKey: 'req-1' });
    const same = record(svg, 4000, { ms: 2000, run: () => rerender(<Bot {...base} state="approval" askKey="req-1" theme="light" />) });
    expect(same.gestures).toEqual([[180, 'ask']]);
    const next = record(svg, 4000, { ms: 1000, run: () => rerender(<Bot {...base} state="approval" askKey="req-2" />) });
    expect(next.gestures).toEqual([[1180, 'ask']]);
  });

  it('waves once for a transition into approval that also brings a key', () => {
    const { svg, rerender } = mount();
    const run = record(svg, 4000, { ms: 1000, run: () => rerender(<Bot {...base} state="approval" askKey="req-1" />) });
    expect(run.gestures).toEqual([[1180, 'ask']]);
  });

  it('waves once on a StrictMode mount with a request key', () => {
    const view = render(<StrictMode><Bot {...base} state="approval" askKey="req-1" /></StrictMode>);
    expect(record(view.container.querySelector('svg')!, 3000).gestures).toEqual([[180, 'ask']]);
  });

  it.each<[string, Partial<Props>]>([
    ['reduced', { reducedMotion: true }],
    ['frozen', { frozen: true }],
    ['paused', { paused: true }],
    ['read-only', { readOnly: true }],
    ['default test env', { reducedMotion: undefined }]
  ])('does not wave for a request key when %s', (_name, props) => {
    const { svg } = mount({ state: 'approval', askKey: 'req-1', ...props });
    expect(vi.getTimerCount()).toBe(0);
    expect(record(svg, 3000).gestures).toEqual([]);
  });

  it('nods once for 650 ms when a decision is received', () => {
    const { svg, rerender } = mount({ state: 'approval', nodKey: 0 });
    act(() => { rerender(<Bot {...base} state="approval" nodKey={1} />); });
    expect(svg).toHaveAttribute('data-gesture', 'nod');
    act(() => { vi.advanceTimersByTime(649); });
    expect(svg).toHaveAttribute('data-gesture', 'nod');
    act(() => { vi.advanceTimersByTime(1); });
    expect(svg).not.toHaveAttribute('data-gesture');
  });

  it('releases all scheduled work and listeners on unmount', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = mount();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    remove.mockRestore();
  });

  it.each<[string, Partial<Props>]>([
    ['read-only', { readOnly: true }],
    ['frozen', { frozen: true }],
    ['exited', { state: 'done' }],
    ['error', { state: 'error' }],
    ['12 px', { size: 12 }],
    ['20 px', { size: 20 }],
    ['reduced motion', { reducedMotion: true }],
    ['paused', { paused: true }],
    ['default test env (VITE_LEDGE_MOTION=0)', { reducedMotion: undefined }]
  ])('starts no ambient timers when %s', (_name, props) => {
    const { svg } = mount(props);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(svg).not.toHaveAttribute('data-blink');
  });

  it('starts no ambient timers inside an inactive (inert) layer', () => {
    render(<div inert><Bot {...base} /></div>);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits while the document is hidden and resumes when it is visible again', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    mount();
    expect(vi.getTimerCount()).toBe(0);
    hidden.mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    hidden.mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(vi.getTimerCount()).toBe(0);
    hidden.mockRestore();
  });
});

describe('Bot CSS pause contract', () => {
  afterEach(cleanup);
  const css = readFileSync(resolve(__dirname, '../src/bots/bots.css'), 'utf8').replace(/\s+/g, ' ');

  it('holds every bot animation, including respiration and the halo, inside inert layers and paused views', () => {
    expect(css).toContain('[inert] .bot, [inert] .bot *, .bot[data-paused="true"], .bot[data-paused="true"] * { animation-play-state: paused !important; }');
    expect(css).toContain('.bot[data-frozen="true"], .bot[data-frozen="true"] * { animation-play-state: paused !important; }');
    expect(css).toMatch(/\.bot \.body \{[^}]*animation: bot-breathe/);
    // The halo of a waiting bot breathes on the svg root itself, hence the root in the two pause selectors above.
    expect(css).toMatch(/\.bot\[data-halo="true"\]:is\(\[data-state="approval"\], \[data-state="question"\]\) \{[^}]*animation: bot-halo-breathe/);
  });

  it('exposes the paused flag the rule keys on', () => {
    const { container, rerender } = render(<Bot {...base} />);
    expect(container.querySelector('svg')).toHaveAttribute('data-paused', 'false');
    rerender(<Bot {...base} paused />);
    expect(container.querySelector('svg')).toHaveAttribute('data-paused', 'true');
    const inert = render(<div inert><Bot {...base} /></div>);
    expect(inert.container.querySelector('[inert] .bot .body')).not.toBeNull();
  });
});

describe('useMotionPreferences', () => {
  afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('reduces motion when VITE_LEDGE_MOTION=0', () => {
    const { result } = renderHook(() => useMotionPreferences());
    expect(result.current.reduced).toBe(true);
  });

  it('follows and persists the app preference when the env allows motion', () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    const { result } = renderHook(() => useMotionPreferences());
    expect(result.current.reduced).toBe(false);
    act(() => result.current.setReduced(true));
    expect(result.current.reduced).toBe(true);
    expect(localStorage.getItem('ledge.reducedMotion')).toBe('true');
    act(() => result.current.setReduced(false));
    expect(result.current.reduced).toBe(false);
  });

  it('cannot force motion against the OS preference, and follows it live', () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q, get matches() { return matches; },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l)
    }));
    const { result } = renderHook(() => useMotionPreferences());
    expect(result.current.reduced).toBe(true);
    act(() => result.current.setReduced(false));
    expect(result.current.reduced).toBe(true);
    act(() => { matches = false; listeners.forEach(l => l()); });
    expect(result.current.reduced).toBe(false);
  });
});
