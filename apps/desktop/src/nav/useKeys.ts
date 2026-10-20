import { useEffect, useRef } from 'react';
import type { Session } from '@ledge/protocol';
import type { NavAction, NavState } from './state';
import type { ScreenKeys } from './screenKeys';
import { termKey } from '../term/keys';

const typing = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.matches('input, textarea, select') || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
};

/** The window's keyboard shortcuts (the mockup's `onKey`): one `keydown` listener. Ctrl/⌘ K, Ctrl , and Escape always work (Ctrl/⌘ Z too, outside a field) (Escape after the dialog and the chat, offered to the screen before navigation),
 *  except in the terminal, which keeps every key for its shell; Ctrl + the key left of 1 takes the keyboard there. The single keys stay out of the way of dialogs, fields and the chat. */
export function useKeys(dispatch: (a: NavAction) => void, ctx: { state: NavState; order: readonly Session[]; screen: ScreenKeys; undo(): boolean; /** A confirmation is open (it is no `nav.modal`): it owns the keyboard, Escape cancels it and nothing else acts. */ confirming?: { cancel(): void } | null; /** Shows the terminal if hidden and focuses its tab; false off a session page. */ toTerminal?(): boolean }): void {
  const latest = useRef({ dispatch, ctx });
  latest.current = { dispatch, ctx };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // In the terminal every key is the shell's (its Ctrl + ² is handled and stopped by the xterm): Ledge neither acts nor takes the focus back.
      if (document.activeElement?.closest('[data-terminal]')) return;
      const { dispatch, ctx: { state, order, screen, undo, confirming, toTerminal } } = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (confirming) { if (e.key === 'Escape') { e.preventDefault(); confirming.cancel(); } return; }
      // The same physical key as inside the terminal (`code`, so ² on AZERTY); a dialog keeps the focus.
      if (termKey(e, false) === 'thread') { if (!state.modal && toTerminal?.()) e.preventDefault(); return; }
      if (mod && !e.altKey && key === 'k') { e.preventDefault(); dispatch({ type: 'modal', modal: { kind: 'search' } }); return; }
      // Ctrl , opens Settings on General; inside Settings it keeps the section open (it only closes the dialog or the chat).
      // Ctrl Z takes back what the toast offers (« Annuler »); in a field it stays the field's own undo.
      if (mod && !e.altKey && !e.shiftKey && key === 'z' && !typing(document.activeElement)) { if (undo()) e.preventDefault(); return; }
      if (mod && !e.altKey && e.key === ',') { e.preventDefault(); dispatch(state.place.kind === 'settings' ? { type: 'settings', section: state.place.section } : { type: 'settings' }); return; }
      if (e.key === 'Escape') {
        // A dialog, then the chat, close first; then the screen may take it (even while typing: it decides); else navigation.
        if (!state.modal && !state.chat && screen.current?.(e)) { e.preventDefault(); return; }
        e.preventDefault(); dispatch({ type: 'escape' }); return;
      }
      if (state.modal?.kind === 'search') return;
      // / focuses Ask Ledge when that field is actually on screen. The narrow sidebar (under 850px), a window under 540px,
      // and full screen hide it, so / opens the chat (already open: its field takes the focus again). In a field, / is typed.
      if (!state.modal && e.key === '/' && !mod && !e.altKey && !typing(document.activeElement)) {
        const ask = document.querySelector<HTMLInputElement>('[data-ask-input]');
        if (ask && ask.getClientRects().length > 0 && !state.fullscreen) { e.preventDefault(); ask.focus(); return; }
        e.preventDefault(); dispatch({ type: 'chat', open: true }); return;
      }
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
      if (e.key === '?') { e.preventDefault(); dispatch({ type: 'modal', modal: { kind: 'shortcuts' } }); }
      else if (key === 'n' && !e.shiftKey && place.kind === 'overview') { e.preventDefault(); dispatch({ type: 'modal', modal: { kind: 'launch' } }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The terminal's Ctrl + ²: the keyboard goes back to the thread's scroller, or to the page's panel while « Modifications » hides it. */
export function focusThread(): void {
  const to = document.querySelector<HTMLElement>('[data-thread-focus]:not([hidden])') ?? document.querySelector<HTMLElement>('.session-body');
  to?.focus({ preventScroll: true });
}
