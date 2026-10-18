/**
 * What the notch reads from Ledge Desktop. The two windows share one origin, so Desktop's choices are its localStorage
 * keys; a write in Desktop's window reaches this one as a `storage` event.
 */

/** Do not disturb, '1' / '0': Desktop's switch, which the notch's own toggles write too. */
export const DND_KEY = 'desktop.dnd';
/** The version Desktop found and has not installed yet; absent when there is none. */
export const UPDATE_KEY = 'desktop.update.available';

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };

export function loadDnd(): boolean { return read(DND_KEY) === '1'; }
export function loadDesktopUpdate(): string | null { return read(UPDATE_KEY) || null; }

/** Calls `fn` with the new value whenever another window changes `key` (null: removed). Returns the unsubscribe. */
export function onStorageKey(key: string, fn: (value: string | null) => void): () => void {
  const h = (e: StorageEvent) => { if (e.key === key) fn(e.newValue); };
  window.addEventListener('storage', h);
  return () => window.removeEventListener('storage', h);
}
