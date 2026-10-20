// Whether the app is in front, told to the PC: a phone whose app is visible gets no push.
import type { MobileStore } from '../state/store';

/** Says it now and at every `visibilitychange` (the store says it again after every ready). Returns the way to stop. */
export function startPresence(store: MobileStore, doc: Document = document): () => void {
  const tell = () => store.presence(doc.visibilityState === 'visible');
  doc.addEventListener('visibilitychange', tell);
  tell();
  return () => doc.removeEventListener('visibilitychange', tell);
}
