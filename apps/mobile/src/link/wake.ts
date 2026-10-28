// Back in front, the link is woken: a phone freezes a page in the background, its timers stand still, and its socket may
// be dead without a close (the relay drops it on a missed pong, the phone never hears of it).
import type { PhoneLink } from './link';

/** Hidden at least this long, an open socket is not trusted any more: a shorter glance away keeps it. */
export const WAKE_AFTER_HIDDEN_MS = 5_000;

/**
 * Resumes the link when the page is visible again after `WAKE_AFTER_HIDDEN_MS` hidden (or sooner when the PC is not
 * reached), when it comes back from the back-forward cache, and when the network is back. Returns the way to stop.
 */
export function startWake(link: PhoneLink, doc: Document = document, win: Window = window): () => void {
  let hiddenAt: number | null = doc.visibilityState === 'hidden' ? Date.now() : null;
  const onVisibility = () => {
    if (doc.visibilityState !== 'visible') {
      hiddenAt ??= Date.now();
      return;
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (away >= WAKE_AFTER_HIDDEN_MS || link.reach() !== 'pc_online') link.resume();
  };
  const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) link.resume(); };
  const onOnline = () => link.resume();
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pageshow', onPageShow);
  win.addEventListener('online', onOnline);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pageshow', onPageShow);
    win.removeEventListener('online', onOnline);
  };
}
