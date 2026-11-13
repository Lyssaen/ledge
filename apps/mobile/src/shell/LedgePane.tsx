import { useEffect, useRef, type ReactNode } from 'react';
import { copy } from '../copy';
import { modalOpen } from '../ui/keys';

/*
 * The tablet's Ledge pane (docs/mockups/ledge-mobile-refonte/m3-chat.html §7, Q36): 400 px on the right, over any tab, opened
 * and closed by the rail's button. A tap outside does not close it; its own « Fermer » and Échap do. Once opened it stays
 * mounted, hidden while closed, so that its draft, its past conversation and its scroll are there again when it opens.
 */

export function LedgePane({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const pane = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Where the thread was scrolled, kept while hidden: a hidden box loses its scroll.
  const scrolled = useRef<number | null>(null);
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const keep = (e: Event) => { if (open && e.target instanceof HTMLElement && e.target.tagName === 'MAIN') scrolled.current = e.target.scrollTop; };
    el.addEventListener('scroll', keep, true);
    return () => el.removeEventListener('scroll', keep, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const main = pane.current?.querySelector('main');
    if (main && scrolled.current !== null) main.scrollTop = scrolled.current;
    // Échap closes the pane, even from its field; a sheet open over it takes the key first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || modalOpen()) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return <aside ref={pane} hidden={!open} aria-label={copy.chat.title} data-ledge-pane="" className="lpane">{children}</aside>;
}
