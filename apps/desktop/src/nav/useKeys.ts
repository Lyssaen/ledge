import { useEffect, useRef } from 'react';
import type { Session } from '@ledge/protocol';
import type { NavAction, NavState } from './state';
import type { ScreenKeys } from './screenKeys';

const typing = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.matches('input, textarea, select') || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
};

/** The window's keyboard shortcuts (the mockup's `onKey`): one `keydown` listener. Ctrl/⌘ K, Ctrl , and Escape always work (Escape after the dialog and the chat, offered to the screen before navigation);
 *  the single keys stay out of the way of dialogs, fields and the chat. */
export function useKeys(dispatch: (a: NavAction) => void, ctx: { state: NavState; order: readonly Session[]; screen: ScreenKeys }): void {
  const latest = useRef({ dispatch, ctx });
  latest.current = { dispatch, ctx };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const { dispatch, ctx: { state, order, screen } } = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && key === 'k') { e.preventDefault(); dispatch({ type: 'modal', modal: { kind: 'search' } }); return; }
      // Ctrl , opens Settings on General; inside Settings it keeps the section open (it only closes the dialog or the chat).
      if (mod && !e.altKey && e.key === ',') { e.preventDefault(); dispatch(state.place.kind === 'settings' ? { type: 'settings', section: state.place.section } : { type: 'settings' }); return; }
      if (e.key === 'Escape') {
        // A dialog, then the chat, close first; then the screen may take it (even while typing: it decides); else navigation.
        if (!state.modal && !state.chat && screen.current?.(e)) { e.preventDefault(); return; }
        e.preventDefault(); dispatch({ type: 'escape' }); return;
      }
      if (state.modal?.kind === 'search') return;
      // The chat open, / from outside a field brings the focus back to it (in its field, / is typed).
      if (state.chat && !state.modal && e.key === '/' && !mod && !e.altKey && !typing(document.activeElement)) { e.preventDefault(); dispatch({ type: 'chat', open: true }); return; }
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
      if (screen.current?.(e)) { e.preventDefault(); return; }
      if (e.key === '/') { e.preventDefault(); dispatch({ type: 'chat', open: true }); }
      else if (e.key === '?') { e.preventDefault(); dispatch({ type: 'modal', modal: { kind: 'shortcuts' } }); }
      else if (key === 'n' && !e.shiftKey && place.kind === 'overview') { e.preventDefault(); dispatch({ type: 'modal', modal: { kind: 'launch' } }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
