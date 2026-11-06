import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../state/storage';
import { deserialize, empty, open, serialize, type Tab, type Workspace } from './model';

/** The IDE workspace, outside React: tabs survive a reload (`ledge.ide.workspace`). */
export const WORKSPACE_KEY = 'ledge.ide.workspace';
export const ATELIER_TAB: Tab = { kind: 'atelier', ref: 'main' };
export const SETTINGS_TAB: Tab = { kind: 'settings', ref: 'main' };
export const openrigTab = (machine = 'local'): Tab => ({ kind: 'openrig', ref: machine });

export interface WorkspaceStore { get(): Workspace; update(fn: (w: Workspace) => Workspace): void; subscribe(cb: () => void): () => void }

export function createWorkspaceStore(initial: Workspace = loadWorkspace()): WorkspaceStore {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    update(fn) {
      const next = fn(state);
      if (next === state) return;
      state = next;
      writeJson(WORKSPACE_KEY, serialize(next));
      for (const cb of [...subs]) cb();
    },
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}

/** The saved workspace, or the atelier alone when nothing usable is stored. */
export function loadWorkspace(): Workspace {
  const raw = readJson(WORKSPACE_KEY);
  return (typeof raw === 'string' ? deserialize(raw) : null) ?? open(empty(), ATELIER_TAB);
}

export function useWorkspace(store: WorkspaceStore): Workspace {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
