import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { MachineState } from '@ledge/fleet';
import { readJson, writeJson } from '../state/storage';
import { displayedMachine } from '../ide/rigs/model';

const KEY = 'ledge.ide.enabled';
const RESUME_KEY = 'ledge.ide.resumeOnStart';
const USAGE_KEY = 'ledge.ide.showUsage';
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

/** « Limites d’usage des comptes » (Settings › Workspace › Status bar): on by default; only a stored `false` turns it off. */
export const loadShowUsage = (): boolean => readJson(USAGE_KEY) !== false;

export function saveShowUsage(on: boolean): void {
  writeJson(USAGE_KEY, on);
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

export function useShowUsage(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, loadShowUsage), saveShowUsage];
}

const MACHINE_KEY = 'ledge.ide.rigsMachine';
const FOLD_KEY = 'ledge.ide.rigsFold';

/** The IDE Rigs view's machine, as saved on this computer (null: never chosen). */
export const loadRigsMachine = (): string | null => { const v = readJson(MACHINE_KEY); return typeof v === 'string' ? v : null; };

export function saveRigsMachine(id: string): void {
  writeJson(MACHINE_KEY, id);
  listeners.forEach(l => l());
}

/** The machine the Rigs view shows: the saved one, this computer's when it is gone. */
export function useRigsMachine(machines: readonly MachineState[]): [string, (id: string) => void] {
  const saved = useSyncExternalStore(subscribe, loadRigsMachine);
  return [displayedMachine(saved, machines), saveRigsMachine];
}

/** What is folded in the Rigs view, as the keys `p:<section>` and `r:<rig>`: everything is open until folded. */
const loadFolded = (): readonly string[] => { const v = readJson(FOLD_KEY); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; };
const foldedRaw = (): string => JSON.stringify(loadFolded());

export function useRigsFold(): { pane(k: 'kernel' | 'rigs' | 'openrig'): boolean; rig(name: string): boolean; toggle(key: string): void } {
  const raw = useSyncExternalStore(subscribe, foldedRaw);
  const folded = useMemo(() => new Set<string>(JSON.parse(raw) as string[]), [raw]);
  const toggle = useCallback((key: string) => {
    const now = new Set(loadFolded());
    if (!now.delete(key)) now.add(key);
    writeJson(FOLD_KEY, [...now]);
    listeners.forEach(l => l());
  }, []);
  return { pane: k => !folded.has(`p:${k}`), rig: name => !folded.has(`r:${name}`), toggle };
}
