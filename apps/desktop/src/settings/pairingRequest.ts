import { useSyncExternalStore } from 'react';

/** A request to show the « Link a device » dialog for one pairing (its `id` in MobileState.pairings). `seq` grows with each
 *  request, so asking again for the same pairing (after Escape closed the dialog) is a new request. */
export interface PairingRequest { id: string; seq: number }

let current: PairingRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const put = (r: PairingRequest | null) => { current = r; for (const fn of [...listeners]) fn(); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Asks the dialog to show that pairing (Settings › Mobile access, « Compare the code »). */
export const requestPairingDialog = (id: string): void => put({ id, seq: ++seq });
/** The dialog has taken the request, or was closed: nothing is asked any more. */
export const clearPairingRequest = (): void => put(null);
/** The latest request, null when none is waiting. */
export const usePairingRequest = (): PairingRequest | null => useSyncExternalStore(subscribe, () => current, () => current);

/** The pairing the « Link a device » dialog shows, null when it is closed. While it shows, the section hides its pending rows and
 *  the tab its dot (the mockup's `showPending`). The shell does not read this: it decides the dialog at render time
 *  (usePairingDialogState), so its `inert` changes in the same commit as the dialog. */
let open: string | null = null;
const openListeners = new Set<() => void>();
const subscribeOpen = (fn: () => void) => { openListeners.add(fn); return () => { openListeners.delete(fn); }; };
/** Published by the dialog's state: the pairing on screen, null once closed. */
export const setPairingDialogOpen = (id: string | null): void => { open = id; for (const fn of [...openListeners]) fn(); };
/** Whether the dialog is on screen. */
export const usePairingDialogOpen = (): boolean => useSyncExternalStore(subscribeOpen, () => open !== null, () => open !== null);
