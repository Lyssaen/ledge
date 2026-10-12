import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { isTauri, setFrame, toMonitorFrame, type Frame } from './bridge';
import { containsFrame, unionFrame } from '../surface/frame';

/** Runs `fn` right after the next frame is painted: a task posted from inside that frame's animation callback. A
 *  document with no animation frames (hidden) runs it after `maxMs` instead. Returns a cancel. */
export function afterPaint(fn: () => void, maxMs = 50): () => void {
  let done = false;
  let task: ReturnType<typeof setTimeout> | undefined;
  const run = () => { if (done) return; done = true; clearTimeout(task); clearTimeout(fallback); fn(); };
  const raf = typeof requestAnimationFrame === 'function' && !document.hidden ? requestAnimationFrame(() => { task = setTimeout(run, 0); }) : undefined;
  const fallback = setTimeout(run, maxMs);
  return () => { done = true; if (raf !== undefined) cancelAnimationFrame(raf); clearTimeout(task); clearTimeout(fallback); };
}

/**
 * Keeps the native window on `frame`. Growing applies as soon as the frame that starts the transition is painted;
 * shrinking first holds the union of the old and new frames for `settleMs` (the surface's size transition) and one
 * more painted frame, so the animation is never clipped. Returns the page offset: page x = screen x - frame left,
 * page y = screen y - frame top.
 *
 * The offset is committed together with the request to move the window, never after the shell's answer: the stale
 * frame the compositor keeps while the window moves then lands exactly where the moved window shows it. The commit
 * is made right after a paint, not in the render pass that changed the frame: the shell gets a whole frame interval
 * to move the window before the page is presented at the new offset. Committed just before a paint, the page could
 * be presented at the new offset inside the window still at its old place and size (the content clipped out of it,
 * or displaced, for that frame). The first painted frame of a transition shows no motion yet (the size transition is
 * at its start, the fades are delayed), so holding the old offset through it changes nothing on screen. Frames that
 * change several times within one pass (a fallback size, then the measured one) go out once, as the last one.
 *
 * Always 0 in the browser. `frame` is in CSS px; under the UI `zoom` the window is placed at whole monitor px rounded
 * outward, and the offset is that monitor corner back in CSS px, so the drawing lands exactly where it would without the zoom.
 */
export interface PageOffset { left: number; top: number }
const NO_OFFSET: PageOffset = { left: 0, top: 0 };

export function useNativeFrame(frame: Frame, settleMs: number, zoom = 1): PageOffset {
  const [offset, setOffset] = useState<PageOffset>(NO_OFFSET);
  /** The frame the shell holds (or was last asked for). */
  const applied = useRef<Frame | null>(null);
  /** The frame the page wants, from the latest render. */
  const wanted = useRef({ frame, zoom });
  const cancelCommit = useRef<() => void>(() => {});
  const settle = useRef<{ timer?: ReturnType<typeof setTimeout>; cancel?: () => void }>({});
  const key = `${frame.left}:${frame.top}:${frame.w}:${frame.h}@${zoom}`;
  useLayoutEffect(() => {
    wanted.current = { frame, zoom };
    const clearSettle = () => { clearTimeout(settle.current.timer); settle.current.cancel?.(); settle.current = {}; };
    // In a layout effect the state update re-renders synchronously before paint; from a task it is flushed.
    const apply = (f: Frame, z: number, inRender: boolean) => {
      applied.current = f;
      if (isTauri()) {
        const m = toMonitorFrame(f, z); const next = { left: m.left / z, top: m.top / z };
        const set = () => setOffset(o => (o.left === next.left && o.top === next.top ? o : next));
        if (inRender) set(); else flushSync(set);
      }
      void setFrame(f, z);
    };
    const commit = () => {
      const { frame: f, zoom: z } = wanted.current;
      const was = applied.current;
      clearSettle();
      if (!was || settleMs <= 0 || containsFrame(f, was)) { apply(f, z, false); return; }
      apply(unionFrame(was, f), z, false);
      settle.current.timer = setTimeout(() => { settle.current.cancel = afterPaint(() => apply(f, z, false)); }, settleMs);
    };
    cancelCommit.current();
    // The first placement: nothing was on screen before, so it goes out in this pass.
    if (!applied.current) { apply(frame, zoom, true); return; }
    cancelCommit.current = afterPaint(commit);
  }, [key, settleMs]); // `frame` and `zoom` are read from `wanted`, captured by value through `key`
  useEffect(() => () => { cancelCommit.current(); clearTimeout(settle.current.timer); settle.current.cancel?.(); }, []);
  return offset;
}
