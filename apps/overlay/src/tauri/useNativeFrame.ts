import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { isTauri, setFrame, type Frame } from './bridge';
import { containsFrame, unionFrame } from '../surface/frame';

/**
 * Keeps the native window on `frame`. Growing applies at once; shrinking first holds the union of the old and new
 * frames for `settleMs` (the surface's size transition) so the animation is not clipped. Returns the page offset:
 * page y = screen y - frame top. The offset is committed together with the request to move the window (before it is
 * painted, before the shell answers), never after the answer. Always 0 in the browser.
 */
export function useNativeFrame(frame: Frame, settleMs: number): number {
  const [offset, setOffset] = useState(0);
  const applied = useRef<Frame | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = `${frame.top}:${frame.w}:${frame.h}`;
  useLayoutEffect(() => {
    // In a layout effect the state update re-renders synchronously before paint; from the settle timer it is flushed.
    const apply = (f: Frame, sync: boolean) => {
      applied.current = f;
      if (isTauri()) { if (sync) setOffset(f.top); else flushSync(() => setOffset(f.top)); }
      void setFrame(f);
    };
    clearTimeout(timer.current);
    const was = applied.current;
    if (!was || settleMs <= 0 || containsFrame(frame, was)) { apply(frame, true); return; }
    apply(unionFrame(was, frame), true);
    timer.current = setTimeout(() => apply(frame, false), settleMs);
  }, [key, settleMs]); // `frame` is captured by value through `key`
  useEffect(() => () => clearTimeout(timer.current), []);
  return offset;
}
