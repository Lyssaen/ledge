import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useMeasuredHeight } from '../src/surface/useMeasuredHeight';

/** jsdom has no ResizeObserver: this one records what it observes and lets a test report a size. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  target: Element | null = null; disconnected = false;
  constructor(public cb: ResizeObserverCallback) { FakeResizeObserver.all.push(this); }
  observe(el: Element) { this.target = el; }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  report(h: number) { this.cb([{ target: this.target!, borderBoxSize: [{ blockSize: h, inlineSize: 380 }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
}
const live = () => FakeResizeObserver.all.filter(o => !o.disconnected);

let setEpoch: (n: number) => void = () => {};
/** A measured view that is remounted (keyed) on each `epoch`, as the surface keys the launch form on each open. */
function Measured() {
  const ref = useRef<HTMLDivElement>(null);
  const [epoch, set] = useState(0); setEpoch = set;
  const h = useMeasuredHeight(ref, true, 1, epoch);
  return <div><div key={epoch} ref={ref} data-epoch={epoch} /><output>{h}</output></div>;
}

afterEach(() => { vi.unstubAllGlobals(); FakeResizeObserver.all = []; });

describe('useMeasuredHeight', () => {
  it('follows the element remounted under a new epoch, not the one it replaced', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { container } = render(<Measured />);
    const first = container.querySelector('[data-epoch="0"]')!;
    expect(live().map(o => o.target)).toEqual([first]);
    act(() => live()[0]!.report(300));
    expect(container.querySelector('output')).toHaveTextContent('300');

    act(() => setEpoch(1));
    const second = container.querySelector('[data-epoch="1"]')!;
    expect(second).not.toBe(first);
    expect(live().map(o => o.target)).toEqual([second]);
    act(() => live()[0]!.report(520));
    expect(container.querySelector('output')).toHaveTextContent('520');
  });
});
