import { useEffect, useLayoutEffect, useRef } from 'react';
import { setFrame, type Frame } from './bridge';
import { containsFrame, unionFrame } from '../surface/frame';

/**
 * Keeps the shell's frame on `frame`: the rectangle the page draws, which the shell turns into the window's region.
 * The native window itself covers the whole work area and never moves or resizes while the surface animates, so the
 * page draws in work-area coordinates and no offset is needed. Changing a region displaces nothing on screen, so a
 * request can go out in the render pass that changed the frame: growing applies at once; shrinking first holds the
 * union of the old and new frames for `settleMs` (the surface's size transition), so the animation is never clipped.
 *
 * `frame` is in CSS px; under the UI `zoom` the frame is rounded outward to whole monitor px by `setFrame`.
 */
export function useNativeFrame(frame: Frame, settleMs: number, zoom = 1): void {
  /** The frame the shell holds (or was last asked for). */
  const applied = useRef<Frame | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = `${frame.left}:${frame.top}:${frame.w}:${frame.h}@${zoom}`;
  useLayoutEffect(() => {
    clearTimeout(settle.current);
    const apply = (f: Frame) => { applied.current = f; void setFrame(f, zoom); };
    const was = applied.current;
    if (!was || settleMs <= 0 || containsFrame(frame, was)) { apply(frame); return; }
    apply(unionFrame(was, frame));
    settle.current = setTimeout(() => apply(frame), settleMs);
  }, [key, settleMs]); // `frame` and `zoom` are captured by value through `key`
  useEffect(() => () => clearTimeout(settle.current), []);
}
