import { useLayoutEffect, useState, type RefObject } from 'react';

/** Observes the border-box height of `ref` while `active`; 0 until a measurement exists (callers fall back to a default).
 *  The observer is disconnected when inactive and on unmount. `cssZoom` is a CSS `zoom` on an ancestor (the browser
 *  UI scale): the client rect is zoomed, the observer's box and the layout are not, so the rect is divided by it. */
export function useMeasuredHeight(ref: RefObject<HTMLElement | null>, active: boolean, cssZoom = 1): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const set = (v: number) => { const n = Math.ceil(v); if (n > 0) setH(prev => (prev === n ? prev : n)); };
    set(el.getBoundingClientRect().height / cssZoom);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const e = entries[entries.length - 1];
      if (!e) return;
      set(e.borderBoxSize?.[0]?.blockSize ?? e.target.getBoundingClientRect().height / cssZoom);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active, cssZoom]);
  return h;
}
