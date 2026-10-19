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

/** Whether the « Link a device » dialog is on screen, and how to close it (as Escape does). While it shows, the section hides its
 *  pending rows and the tab its dot (the mockup's `showPending`), and the shell keeps its other shortcuts away. */
export interface PairingDialogOpen { id: string; dismiss(): void }
let open: PairingDialogOpen | null = null;
const openListeners = new Set<() => void>();
const subscribeOpen = (fn: () => void) => { openListeners.add(fn); return () => { openListeners.delete(fn); }; };
/** Published by the dialog: what it shows, null once closed. */
export const setPairingDialogOpen = (o: PairingDialogOpen | null): void => { open = o; for (const fn of [...openListeners]) fn(); };
/** The dialog on screen (its pairing and its dismissal), null when closed. */
export const usePairingDialog = (): PairingDialogOpen | null => useSyncExternalStore(subscribeOpen, () => open, () => open);
/** Whether the dialog is on screen. */
export const usePairingDialogOpen = (): boolean => usePairingDialog() !== null;
