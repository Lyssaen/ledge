import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../state/storage';
import { close, closeOthers, deserialize, empty, find, keyOf, open, remember, reopenLast, serialize, type Closed, type Tab, type Workspace } from './model';

/** The IDE workspace, outside React: tabs survive a reload (`ledge.ide.workspace`). */
export const WORKSPACE_KEY = 'ledge.ide.workspace';
export const ATELIER_TAB: Tab = { kind: 'atelier', ref: 'main' };
export const SETTINGS_TAB: Tab = { kind: 'settings', ref: 'main' };
export const openrigTab = (machine = 'local'): Tab => ({ kind: 'openrig', ref: machine });

export interface WorkspaceStore {
  get(): Workspace; update(fn: (w: Workspace) => Workspace): void; subscribe(cb: () => void): () => void;
  /** The user closes a tab (its ×, middle click, the menu, Ctrl+W): it is remembered for `reopen`. A tab closed by
   *  `update` (reconcile: its session gone) is not. */
  close(key: string): void;
  /** « Fermer les autres »: each tab closed is remembered. */
  closeOthers(key: string): void;
  /** Ctrl+Shift+T: the last tab closed back where it was; those `keep` refuses (their session gone) are dropped. */
  reopen(keep?: (t: Tab) => boolean): void;
}

export function createWorkspaceStore(initial: Workspace = loadWorkspace()): WorkspaceStore {
  let state = initial;
  // The tabs closed by the user, the last on top (CLOSED_MAX); this run only, never saved.
  let closed: readonly Closed[] = [];
  const subs = new Set<() => void>();
  const update = (fn: (w: Workspace) => Workspace) => {
    const next = fn(state);
    if (next === state) return;
    state = next;
    writeJson(WORKSPACE_KEY, serialize(next));
    for (const cb of [...subs]) cb();
  };
  return {
    get: () => state,
    update,
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    close(key) { closed = remember(closed, state, key); update(w => close(w, key)); },
    closeOthers(key) {
      const hit = find(state, key);
      if (!hit) return;
      for (const t of hit.group.tabs) if (keyOf(t) !== key) closed = remember(closed, state, keyOf(t));
      update(w => closeOthers(w, key));
    },
    reopen(keep) { const r = reopenLast(state, closed, keep); closed = r.stack; update(() => r.w); },
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
