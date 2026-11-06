import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../state/storage';

const KEY = 'ledge.ide.enabled';
const listeners = new Set<() => void>();

/** « Interface IDE (aperçu) »: off by default; anything stored that is not a boolean reads as off. */
export const loadIdeEnabled = (): boolean => readJson(KEY) === true;

export function saveIdeEnabled(on: boolean): void {
  writeJson(KEY, on);
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The switch's value, shared: every consumer re-renders when any one sets it, so Shell swaps interfaces without a restart. */
export function useIdeEnabled(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, loadIdeEnabled), saveIdeEnabled];
}
