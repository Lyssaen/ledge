import { useSyncExternalStore } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { useTui } from '../context.js';

interface Store { id: string | null; listeners: Set<() => void> }
/** One store per daemon client, so a dialog left open never outlives the TUI that opened it. */
const stores = new WeakMap<object, Store>();

/** The « Lier un appareil » dialog's state: which pairing it shows, shared by the screen's rows and the dialog itself (null: closed). */
export function usePairingDialog(): PairingDialogState { return usePairingDialogOf(useTui().client); }

export type PairingDialogState = { open(id: string): void; close(): void; id: string | null };

/** The same state read from a client alone, for the shell, which sits above the TUI's context. */
export function usePairingDialogOf(client: DaemonClient): PairingDialogState {
  let s = stores.get(client);
  if (!s) { s = { id: null, listeners: new Set() }; stores.set(client, s); }
  const store = s;
  const id = useSyncExternalStore(l => { store.listeners.add(l); return () => { store.listeners.delete(l); }; }, () => store.id);
  const set = (next: string | null) => { if (next !== store.id) { store.id = next; for (const l of store.listeners) l(); } };
  return { open: set, close: () => set(null), id };
}
