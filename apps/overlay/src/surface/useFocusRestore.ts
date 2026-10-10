import { useEffect, useRef, type RefObject } from 'react';
import type { Mode } from './geometry';

/** Focus sits on a control of this surface that just went inert. Focus elsewhere (or nowhere) is left alone, so a
 *  hover-opened list never grabs focus (which would keep it from folding when the pointer leaves). */
const stranded = (root: HTMLElement) => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && root.contains(a) && !!a.closest('[inert]');
};

/**
 * After a view change, focus never stays in a layer that just went inert: a detail view (session, settings, help) takes
 * it on its first control, the list on the row that was open (or the first row); folding to the handle or the bubble
 * drops it (a focused handle would hold the next bubble's clock). Keyed on the view only, so a daemon update (a late
 * confirmation included) never moves focus.
 */
export function useFocusRestore(rootRef: RefObject<HTMLElement | null>, view: { mode: Mode; selectedId: string | null }) {
  const prev = useRef(view);
  useEffect(() => {
    const was = prev.current; prev.current = view;
    const root = rootRef.current;
    if (!root || (was.mode === view.mode && was.selectedId === view.selectedId) || !stranded(root)) return;
    const a = document.activeElement as HTMLElement | null;
    if (view.mode === 'handle' || view.mode === 'bubble') { if (a && root.contains(a)) a.blur(); return; }
    const layer = root.querySelector<HTMLElement>(`[data-layer="${view.mode}"]`);
    const target = view.mode === 'list'
      ? (was.selectedId ? layer?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(was.selectedId)}"] [data-row]`) : null) ?? layer?.querySelector<HTMLElement>('[data-row]') ?? layer?.querySelector<HTMLElement>('button')
      : layer?.querySelector<HTMLElement>('[data-initial-focus]') ?? layer?.querySelector<HTMLElement>('button');
    target?.focus();
  }, [view.mode, view.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
}
