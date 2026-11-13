import { useEffect, useRef, type ReactNode } from 'react';
import { copy } from '../copy';
import { modalOpen } from '../ui/keys';

/*
 * The tablet's Ledge pane (docs/mockups/ledge-mobile-refonte/m3-chat.html §7, Q36): 400 px on the right, over any tab, opened
 * and closed by the rail's button. A tap outside does not close it; its own « Fermer » and Échap do. It keeps its scroll when it
 * is closed and opened again.
 */

/** Where the pane's thread was scrolled when it was last closed, since the page loaded. */
let scrolled: number | null = null;

export function LedgePane({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const pane = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    // The chat has scrolled to its last exchange by now (its effects ran first): the place it was left wins.
    const main = el.querySelector('main');
    if (main && scrolled !== null) main.scrollTop = scrolled;
    const keep = (e: Event) => { if (e.target instanceof HTMLElement && e.target.tagName === 'MAIN') scrolled = e.target.scrollTop; };
    el.addEventListener('scroll', keep, true);
    // Échap closes the pane, even from its field; a sheet open over it takes the key first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || modalOpen()) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('scroll', keep, true); document.removeEventListener('keydown', onKey); };
  }, []);
  return <aside ref={pane} aria-label={copy.chat.title} data-ledge-pane="" className="lpane">{children}</aside>;
}

/** For the tests: forgets where the pane was scrolled. */
export const forgetPaneScroll = (): void => { scrolled = null; };
