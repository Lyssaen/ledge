import { useSyncExternalStore } from 'react';
import { localStore } from './storage';

/*
 * Whether the tablet's Ledge pane is open (m3-chat.html §7, Q36): the rail's button opens and closes it, and the device keeps
 * it, so the pane comes back as it was left after a reload.
 */

export const LEDGE_PANE_KEY = 'ledge.mobile.ledgePane';

const listeners = new Set<() => void>();
/** The choice made on this page, which holds even where the storage refuses to keep it. */
let chosen: boolean | null = null;

function read(storage?: Storage): boolean {
  if (chosen !== null) return chosen;
  try { return localStore(storage)?.getItem(LEDGE_PANE_KEY) === 'open'; } catch { return false; }
}

export function setLedgePane(open: boolean, storage?: Storage): void {
  chosen = open;
  try { localStore(storage)?.setItem(LEDGE_PANE_KEY, open ? 'open' : 'closed'); } catch { /* kept for this page only */ }
  for (const l of listeners) l();
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** The pane's state, and the app drawn again when it changes. */
export function useLedgePane(storage?: Storage): boolean {
  return useSyncExternalStore(subscribe, () => read(storage), () => false);
}

/** For the tests: forgets the choice made on this page, so the storage decides again. */
export const forgetLedgePane = (): void => { chosen = null; };
