import { useSyncExternalStore } from 'react';
import { localStore } from './state/storage';

/**
 * « Réduire les animations » on this device: on, `data-motion="reduced"` on the root stills every animation and transition
 * (styles.css). Off, the phone's own setting still applies (`prefers-reduced-motion`, which the styles read anyway).
 */
const KEY = 'ledge.motion';
const listeners = new Set<() => void>();
let reduced = false;

export function readReduced(storage?: Storage): boolean {
  try { return localStore(storage)?.getItem(KEY) === 'reduced'; } catch { return false; }
}

function apply(): void {
  const root = globalThis.document?.documentElement;
  if (root) {
    if (reduced) root.dataset.motion = 'reduced';
    else delete root.dataset.motion;
  }
  listeners.forEach(l => l());
}

/** Reads the stored choice; called once, before the first render. */
export function initMotion(storage?: Storage): void {
  reduced = readReduced(storage);
  apply();
}

export function setReducedMotion(on: boolean, storage?: Storage): void {
  reduced = on;
  try {
    const s = localStore(storage);
    if (on) s?.setItem(KEY, 'reduced'); else s?.removeItem(KEY);
  } catch { /* the choice holds until the page reloads */ }
  apply();
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useReducedMotion = (): boolean => useSyncExternalStore(subscribe, () => reduced, () => reduced);
