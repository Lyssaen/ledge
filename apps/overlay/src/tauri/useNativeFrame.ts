import { useEffect, useRef, useState } from 'react';
import { setFrame, type Frame } from './bridge';
import { containsFrame, unionFrame } from '../surface/frame';

/**
 * Keeps the native window on `frame`. Growing applies at once; shrinking first holds the union of the old and new
 * frames for `settleMs` (the surface's size transition) so the animation is not clipped. Returns the top of the frame
 * the shell last confirmed: the page content is offset by it, so page y = screen y - frame top. Always 0 in the browser.
 */
export function useNativeFrame(frame: Frame, settleMs: number): number {
  const [offset, setOffset] = useState(0);
  const applied = useRef<Frame | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = `${frame.top}:${frame.w}:${frame.h}`;
  useEffect(() => {
    const apply = (f: Frame) => {
      applied.current = f;
      void Promise.resolve(setFrame(f)).then(ok => { if (ok) setOffset(f.top); });
    };
    clearTimeout(timer.current);
    const was = applied.current;
    if (!was || settleMs <= 0 || containsFrame(frame, was)) { apply(frame); return; }
    apply(unionFrame(was, frame));
    timer.current = setTimeout(() => apply(frame), settleMs);
  }, [key, settleMs]); // `frame` is captured by value through `key`
  useEffect(() => () => clearTimeout(timer.current), []);
  return offset;
}
