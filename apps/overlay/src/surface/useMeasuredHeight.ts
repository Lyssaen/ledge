import { useLayoutEffect, useState, type RefObject } from 'react';

/** Observes the border-box height of `ref` while `active`; 0 until a measurement exists (callers fall back to a default).
 *  The observer is disconnected when inactive and on unmount. */
export function useMeasuredHeight(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const set = (v: number) => { const n = Math.ceil(v); if (n > 0) setH(prev => (prev === n ? prev : n)); };
    set(el.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const e = entries[entries.length - 1];
      if (!e) return;
      set(e.borderBoxSize?.[0]?.blockSize ?? e.target.getBoundingClientRect().height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return h;
}
