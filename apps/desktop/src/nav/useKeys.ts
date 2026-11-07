import { useEffect, useRef } from 'react';
import type { Session } from '@ledge/protocol';
import type { NavAction, NavState } from './state';
import type { ScreenKeys } from './screenKeys';
import { termKey } from '../term/keys';

const typing = (el: Element | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.matches('input, textarea, select') || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
};

/** The IDE shell's keys (flag on). */
export interface IdeKeys {
  toggle(panel: 'side' | 'bottom' | 'right'): void;
  /** Ctrl \: an empty group right of the focused one. */ split?(): void;
  /** N opens the launch dialog from any tab, not only the overview (the screen's keys run first: on an approval N denies). */ newSessionAnywhere?: true;
  /** Ctrl W: the focused group's active tab closes; an empty group, the group. */ closeTab?(): void;
  /** Ctrl Shift T: the last tab closed comes back where it was. */ reopenTab?(): void;
  /** Ctrl Tab / Ctrl Shift Tab, Ctrl PageDown / PageUp: next / previous tab of the focused group. */ cycleTab?(step: 1 | -1): void;
  /** Ctrl 1…9: the Nth group of the main window. */ focusGroup?(n: number): void;
  /** Ctrl Alt → / ←: the active tab into the group on the right / left. */ moveTab?(step: 1 | -1): void;
}

/** The window's keyboard shortcuts (the mockup's `onKey`): one `keydown` listener. Ctrl/⌘ K, Ctrl , and Escape always work (Ctrl/⌘ Z too, outside a field) (Escape after the dialog and the chat, offered to the screen before navigation),
 *  except in the terminal, which keeps every key for its shell; Ctrl + the key left of 1 takes the keyboard there. The single keys stay out of the way of dialogs, fields and the chat. */
export function useKeys(dispatch: (a: NavAction) => void, ctx: { state: NavState; order: readonly Session[]; screen: ScreenKeys; undo(): boolean; /** A confirmation is open (it is no `nav.modal`): it owns the keyboard, Escape cancels it and nothing else acts. */ confirming?: { cancel(): void } | null; /** Shows the terminal if hidden and focuses its tab; false off a session page. */ toTerminal?(): boolean; /** The IDE shell (flag on): Ctrl B / Ctrl J / Ctrl / show or hide its panels, even in a field (never in the terminal). */ ide?: IdeKeys }): void {
  const latest = useRef({ dispatch, ctx });
  latest.current = { dispatch, ctx };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // In the terminal every key is the shell's (its Ctrl + ² is handled and stopped by the xterm): Ledge neither acts nor takes the focus back.
      if (document.activeElement?.closest('[data-terminal]')) return;
      const { dispatch, ctx: { state, order, screen, undo, confirming, toTerminal, ide } } = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Ctrl W never closes the window (WebView2), whatever owns the keyboard.
      if (ide && mod && !e.altKey && !e.shiftKey && key === 'w') e.preventDefault();
      if (confirming) { if (e.key === 'Escape') { e.preventDefault(); confirming.cancel(); } return; }
      // The same physical key as inside the terminal (`code`, so ² on AZERTY); a dialog keeps the focus.
      if (termKey(e, false) === 'thread') { if (!state.modal && toTerminal?.()) e.preventDefault(); return; }
      if (mod && !e.altKey && key === 'k') { e.preventDefault(); dispatch({ type: 'modal', modal: { kind: 'search' } }); return; }
      // The IDE's panels, VS Code's keys: they act inside a field too (the terminal returned above).
      if (ide && !state.modal && mod && !e.altKey && (key === 'b' || key === 'j' || e.key === '/')) { e.preventDefault(); ide.toggle(key === 'b' ? 'side' : key === 'j' ? 'bottom' : 'right'); return; }
      // Ctrl \ splits the focused group, as VS Code, in a field too. The key, not its place: AltGr (\ on AZERTY) reports Ctrl + Alt
      // on Windows, so Alt is allowed only as AltGr; a QWERTY Ctrl + Alt + \ is another chord.
      if (ide?.split && !state.modal && mod && e.key === '\\' && (!e.altKey || e.getModifierState('AltGraph'))) { e.preventDefault(); ide.split(); return; }
      if (ide && tabKeys(e, ide, mod, !state.modal)) return;
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
      // / goes to Ledge's home view, its composer focused (ledge home spec §2.1); in a field, / is typed. Ctrl / asks Ledge
      // beside what is shown, in the docked panel (already open: its field takes the focus again).
      if (!state.modal && e.key === '/' && mod && !e.altKey) { e.preventDefault(); dispatch({ type: 'chat', open: true }); return; }
      if (!state.modal && e.key === '/' && !mod && !e.altKey && !typing(document.activeElement)) { e.preventDefault(); dispatch({ type: 'ledge' }); return; }
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
      else if (key === 'n' && !e.shiftKey && (place.kind === 'overview' || ide?.newSessionAnywhere)) { e.preventDefault(); dispatch({ type: 'modal', modal: { kind: 'launch' } }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The IDE's tab keys, VS Code's defaults, in a field too (the terminal returned before): true when the chord is one of
 *  them (then prevented; it acts only when `free`, no dialog owning the keyboard). Letters, arrows and Tab by `key`, the
 *  digits by `code` (Ctrl + & on AZERTY is Ctrl 1). Shift + Tab alone stays the focus's. */
type TabKeys = Pick<IdeKeys, 'closeTab' | 'reopenTab' | 'cycleTab' | 'focusGroup' | 'moveTab'>;
function tabKeys(e: KeyboardEvent, ide: TabKeys, mod: boolean, free: boolean): boolean {
  if (!mod) return false;
  const key = e.key.toLowerCase();
  let act: (() => void) | undefined;
  if (!e.altKey) {
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (key === 'w' && !e.shiftKey) act = () => ide.closeTab?.();
    else if (key === 't' && e.shiftKey) act = () => ide.reopenTab?.();
    else if (e.key === 'Tab') act = () => ide.cycleTab?.(e.shiftKey ? -1 : 1);
    else if ((e.key === 'PageDown' || e.key === 'PageUp') && !e.shiftKey) act = () => ide.cycleTab?.(e.key === 'PageDown' ? 1 : -1);
    else if (digit && !e.shiftKey) act = () => ide.focusGroup?.(Number(digit));
  } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey && !e.getModifierState('AltGraph')) {
    act = () => ide.moveTab?.(e.key === 'ArrowRight' ? 1 : -1);
  }
  if (!act) return false;
  e.preventDefault();
  if (free) act();
  return true;
}

/** The terminal's Ctrl + ²: the keyboard goes back to the thread's scroller, or to the page's panel while « Modifications » hides it. */
export function focusThread(): void {
  const to = document.querySelector<HTMLElement>('[data-thread-focus]:not([hidden])') ?? document.querySelector<HTMLElement>('.session-body');
  to?.focus({ preventScroll: true });
}
