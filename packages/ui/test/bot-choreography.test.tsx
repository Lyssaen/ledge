import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './fixtures';
import { Bot, type BotProps } from '../src/bots/Bot';

const base: BotProps = { tool: 'claude', state: 'working', pose: 1, size: 32, theme: 'dark', seed: 'session-a', reducedMotion: false };
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const mount = (props: Partial<BotProps> = {}) => {
  const view = render(<Bot {...base} {...props} />);
  return { ...view, svg: view.container.querySelector('svg')! };
};

describe('session bot choreography', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('interrupts rapid state arrivals without changing the business state or replacing the SVG', () => {
    const { svg, rerender } = mount();
    rerender(<Bot {...base} state="question" />);
    expect(svg).toHaveAttribute('data-transition', 'question');
    advance(120);
    rerender(<Bot {...base} state="done" />);
    expect(svg).toHaveAttribute('data-transition', 'done');
    advance(120);
    rerender(<Bot {...base} state="working" />);
    expect(svg).toHaveAttribute('data-transition', 'working');
    advance(300);
    expect(svg).toHaveAttribute('data-transition', 'working');
    advance(180);
    expect(svg).not.toHaveAttribute('data-transition');
    expect(svg).toHaveAttribute('data-state', 'working');
    expect(document.querySelector('svg')).toBe(svg);
  });

  it('cancels a pending approval gesture when hidden, never replays the stale request', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { svg, rerender } = mount();
    rerender(<Bot {...base} state="approval" askKey="one" />);
    advance(100);
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(0);
    advance(2000);
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    advance(1000);
    expect(svg).not.toHaveAttribute('data-gesture');
  });

  it('tracks the cursor within two SVG units and lets selection clicks bubble', () => {
    const selected = vi.fn();
    const { container } = render(<button onClick={selected}><Bot {...base} /></button>);
    const svg = container.querySelector('svg')!;
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 32, height: 32 } as DOMRect);
    fireEvent(svg, new MouseEvent('pointermove', { clientX: 100, clientY: -100, bubbles: true }));
    expect(svg.style.getPropertyValue('--bot-gx')).toBe('2px');
    expect(svg.style.getPropertyValue('--bot-gy')).toBe('-2px');
    fireEvent.click(svg);
    expect(selected).toHaveBeenCalledOnce();
    expect(svg).toHaveAttribute('data-touch', 'true');
    advance(360);
    expect(svg).not.toHaveAttribute('data-touch');
    fireEvent(svg, new MouseEvent('pointerleave'));
    expect(svg.style.getPropertyValue('--bot-gx')).toBe('0px');
  });

  it.each<Partial<BotProps>>([
    { size: 12 }, { size: 20 }, { size: 48, shownSize: 12 },
    { reducedMotion: true }, { frozen: true }, { paused: true }, { readOnly: true }, { state: 'readonly' }
  ])('suppresses new gestures for %j', props => {
    const { svg, rerender } = mount(props);
    fireEvent.click(svg);
    expect(svg).not.toHaveAttribute('data-touch');
    rerender(<Bot {...base} {...props} state={props.state ?? 'question'} />);
    expect(svg).not.toHaveAttribute('data-transition');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops all transient gestures when an ancestor becomes inert', async () => {
    const view = render(<div><Bot {...base} /></div>);
    const svg = view.container.querySelector('svg')!;
    fireEvent.click(svg);
    const parent = svg.parentElement!;
    await act(async () => parent.setAttribute('inert', ''));
    expect(svg).not.toHaveAttribute('data-touch');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => parent.removeAttribute('inert'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(svg);
    expect(svg).not.toHaveAttribute('data-touch');
  });

  it('plays rare deterministic idle looks and stretches, and cancels them on a state change', () => {
    const observe = () => {
      const { svg, unmount } = mount({ state: 'idle' });
      const events: string[] = [];
      let last = '';
      for (let t = 100; t <= 60_000; t += 100) {
        advance(100);
        const gesture = svg.getAttribute('data-idle') ?? '';
        if (gesture && gesture !== last) events.push(`${t}:${gesture}`);
        last = gesture;
      }
      unmount();
      return events;
    };
    const first = observe();
    expect(first.length).toBeGreaterThan(3);
    expect(first.length).toBeLessThan(11);
    expect(first.some(e => e.endsWith(':stretch'))).toBe(true);
    vi.setSystemTime(0);
    expect(observe()).toEqual(first);
    const { svg, rerender } = mount({ state: 'idle' });
    advance(9000);
    rerender(<Bot {...base} state="approval" />);
    expect(svg).not.toHaveAttribute('data-idle');
    advance(10_000);
    expect(svg).not.toHaveAttribute('data-idle');
  });
  it.each(['paused', 'frozen', 'reducedMotion', 'readOnly'] as const)('does not replay an approval interrupted by %s', flag => {
    const { svg, rerender } = mount({ state: 'approval', askKey: 'one' });
    advance(100);
    rerender(<Bot {...base} state="approval" askKey="one" {...{ [flag]: true }} />);
    expect(vi.getTimerCount()).toBe(0);
    rerender(<Bot {...base} state="approval" askKey="one" />);
    advance(1200);
    expect(svg).not.toHaveAttribute('data-gesture');
  });

  it('cancels an acknowledgement on a rapid state change', () => {
    const { svg, rerender } = mount({ state: 'approval', nodKey: 0 });
    rerender(<Bot {...base} state="approval" nodKey={1} />);
    expect(svg).toHaveAttribute('data-gesture', 'nod');
    rerender(<Bot {...base} state="error" nodKey={1} />);
    advance(500);
    expect(vi.getTimerCount()).toBe(0);
    expect(svg).not.toHaveAttribute('data-gesture');
  });
  it('plays work anticipation when approval is replaced before its hand rises', () => {
    const { svg, rerender } = mount();
    rerender(<Bot {...base} state="approval" askKey="one" />);
    advance(100);
    rerender(<Bot {...base} />);
    expect(svg).toHaveAttribute('data-transition', 'working');
    advance(500);
    expect(svg).not.toHaveAttribute('data-gesture');
  });

  it('keeps a received decision nod from being overwritten by a pending hand gesture', () => {
    const { svg, rerender } = mount({ state: 'approval', askKey: 'one', nodKey: 0 });
    advance(100);
    rerender(<Bot {...base} state="approval" askKey="one" nodKey={1} />);
    advance(100);
    expect(svg).toHaveAttribute('data-gesture', 'nod');
    advance(550);
    expect(svg).not.toHaveAttribute('data-gesture');
  });
  it('cancels the old nod timer when a fresh request replaces the decision', () => {
    const { svg, rerender } = mount({ state: 'approval', askKey: 'one', nodKey: 0 });
    advance(100);
    rerender(<Bot {...base} state="approval" askKey="one" nodKey={1} />);
    advance(100);
    rerender(<Bot {...base} state="approval" askKey="two" nodKey={1} />);
    advance(550);
    expect(svg).toHaveAttribute('data-gesture', 'ask');
    advance(480);
    expect(svg).not.toHaveAttribute('data-gesture');
  });
});
