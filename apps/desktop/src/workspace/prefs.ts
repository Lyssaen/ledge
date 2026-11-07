import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../state/storage';

const KEY = 'ledge.ide.enabled';
const RESUME_KEY = 'ledge.ide.resumeOnStart';
const listeners = new Set<() => void>();

/** « Interface IDE (aperçu) »: off by default; anything stored that is not a boolean reads as off. */
export const loadIdeEnabled = (): boolean => readJson(KEY) === true;

export function saveIdeEnabled(on: boolean): void {
  writeJson(KEY, on);
  listeners.forEach(l => l());
}

/** « Au démarrage, reprendre les sessions ouvertes »: on by default; only a stored `false` turns it off. */
export const loadResumeOnStart = (): boolean => readJson(RESUME_KEY) !== false;

export function saveResumeOnStart(on: boolean): void {
  writeJson(RESUME_KEY, on);
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The switch's value, shared: every consumer re-renders when any one sets it, so Shell swaps interfaces without a restart. */
export function useIdeEnabled(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, loadIdeEnabled), saveIdeEnabled];
}

export function useResumeOnStart(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, loadResumeOnStart), saveResumeOnStart];
}
