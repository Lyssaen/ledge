import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../state/storage';

const KEY = 'ledge.ide.openSession';
const listeners = new Set<() => void>();

/** « Ouvrir une session »: in the active group, or in a new group on its right. */
export type OpenSession = 'active' | 'right';

/** 'active' by default; anything else stored reads as 'active' (« Nouvelle fenêtre » is hidden until lot 9). */
export const loadOpenSession = (): OpenSession => (readJson(KEY) === 'right' ? 'right' : 'active');

export function saveOpenSession(v: OpenSession): void {
  writeJson(KEY, v);
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The setting's value, shared: every consumer re-renders when any one sets it. */
export function useOpenSession(): [OpenSession, (v: OpenSession) => void] {
  return [useSyncExternalStore(subscribe, loadOpenSession), saveOpenSession];
}
