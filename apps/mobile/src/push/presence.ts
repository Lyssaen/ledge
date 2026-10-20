// Whether the app is in front, told to the PC: a phone whose app is visible gets no push. Also clears the app badge then.
import type { MobileStore } from '../state/store';

/** Says it now and at every `visibilitychange` (the store says it again after every ready). Returns the way to stop. */
export function startPresence(store: MobileStore, doc: Document = document): () => void {
  const tell = () => {
    const visible = doc.visibilityState === 'visible';
    store.presence(visible);
    // The app is in front: whatever the badge counted is being looked at. A courtesy: its failure changes nothing.
    if (visible) try { void (navigator as { clearAppBadge?: () => Promise<void> }).clearAppBadge?.()?.catch(() => {}); } catch { /* ignored */ }
  };
  doc.addEventListener('visibilitychange', tell);
  tell();
  return () => doc.removeEventListener('visibilitychange', tell);
}
