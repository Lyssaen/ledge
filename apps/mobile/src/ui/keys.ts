import { useEffect, useRef } from 'react';

/** Whether a key goes to a field the person is typing in: a shortcut must never take a letter meant for the text. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** Whether a modal is open: it isolates the screen behind it, so a shortcut must never act on what the modal hides. */
export function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/**
 * A wide screen's keyboard shortcuts (m1-a-toi.html §12: ↑ ↓ change request, Y allows, N refuses). `onKey` gets a bare key
 * (no modifier, not repeated, not typed into a field, no modal open) and says whether it used it; a key used is kept from
 * scrolling the page.
 */
export function useShortcuts(on: boolean, onKey: (key: string) => boolean): void {
  const ref = useRef(onKey);
  ref.current = onKey;
  useEffect(() => {
    if (!on) return;
    const listener = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.isComposing || typingIn(e.target) || modalOpen()) return;
      if (ref.current(e.key)) e.preventDefault();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [on]);
}
