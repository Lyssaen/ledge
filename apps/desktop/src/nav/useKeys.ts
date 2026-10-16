import { useEffect, useRef } from 'react';
import type { Session } from '@ledge/protocol';
import type { NavAction, NavState } from './state';

const typing = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.matches('input, textarea, select') || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
};

/** The window's keyboard shortcuts (the mockup's `onKey`): one `keydown` listener. Ctrl/⌘ K, Ctrl , and Escape always work;
 *  the single keys stay out of the way of dialogs, fields and the chat. */
export function useKeys(dispatch: (a: NavAction) => void, ctx: { state: NavState; order: readonly Session[] }): void {
  const latest = useRef({ dispatch, ctx });
  latest.current = { dispatch, ctx };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const { dispatch, ctx: { state, order } } = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && key === 'k') { e.preventDefault(); dispatch({ type: 'modal', modal: 'search' }); return; }
      if (mod && !e.altKey && e.key === ',') { e.preventDefault(); dispatch({ type: 'settings' }); return; }
      if (e.key === 'Escape') { e.preventDefault(); dispatch({ type: 'escape' }); return; }
      if (state.modal === 'search') return;
      if (state.modal || state.chat || typing(document.activeElement)) return;

      const { place } = state;
      if (e.altKey && !mod) {
        const digit = /^[1-9]$/.test(e.key) ? e.key : /^Digit([1-9])$/.exec(e.code)?.[1];
        if (digit) {
          const target = order[Number(digit) - 1];
          if (target) { e.preventDefault(); dispatch({ type: 'open', id: target.id }); }
          return;
        }
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && order.length > 0) {
          e.preventDefault();
          const base = place.kind === 'settings' ? place.back : place;
          const at = base.kind === 'session' ? order.findIndex(s => s.id === base.id) : -1;
          const step = e.key === 'ArrowRight' ? 1 : -1;
          const next = at < 0 ? (step === 1 ? 0 : order.length - 1) : (at + step + order.length) % order.length;
          dispatch({ type: 'open', id: order[next]!.id });
        }
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); dispatch({ type: 'chat', open: true }); }
      else if (e.key === '?') { e.preventDefault(); dispatch({ type: 'modal', modal: 'shortcuts' }); }
      else if (key === 'n' && !e.shiftKey && place.kind === 'overview') { e.preventDefault(); dispatch({ type: 'modal', modal: 'launch' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
