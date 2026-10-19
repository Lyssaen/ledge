import { useSyncExternalStore } from 'react';
import type { UpdatePhase } from './store';

/** The « What's new » panel: a release on offer (`available`, with Update / Later), the version just installed shown once
 *  at its first launch (`updated`), or the installed version's notes asked from Settings › About (`installed`). */
export interface WhatsNewView { mode: 'available' | 'updated' | 'installed'; version: string; notes: string | null; from?: string | null; skipped?: boolean }

let shown: WhatsNewView | null = null;
const listeners = new Set<() => void>();
const put = (v: WhatsNewView | null) => { shown = v; for (const fn of [...listeners]) fn(); };

export const openWhatsNew = (v: WhatsNewView): void => put(v);
export const closeWhatsNew = (): void => put(null);
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useWhatsNew = (): WhatsNewView | null => useSyncExternalStore(subscribe, () => shown, () => shown);

/** « Install » shows the notes first, when the release has some; an empty manifest (the dry run) installs at once. */
export const notesBeforeInstall = (p: UpdatePhase): WhatsNewView | null =>
  p.kind === 'available' && p.notes.trim() ? { mode: 'available', version: p.version, notes: p.notes } : null;
