import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../state/storage';
import { close, closeOthers, deserialize, empty, find, keyOf, remember, reopenLast, serialize, type Closed, type Tab, type Workspace } from './model';

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

/** `closed`: told of each tab the USER closes (`close`, `closeOthers`), after it left the model; never of a tab `update` drops
 *  (reconcile, a move): a bottom-panel shell's tab closed kills its shell (R9), a tab moved keeps it. */
export function createWorkspaceStore(initial: Workspace = loadWorkspace(), opts: { closed?(key: string): void } = {}): WorkspaceStore {
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
    close(key) {
      if (!find(state, key)) return;
      closed = remember(closed, state, key);
      update(w => close(w, key));
      opts.closed?.(key);
    },
    closeOthers(key) {
      const hit = find(state, key);
      if (!hit) return;
      const others = hit.group.tabs.map(keyOf).filter(k => k !== key);
      for (const k of others) closed = remember(closed, state, k);
      update(w => closeOthers(w, key));
      for (const k of others) opts.closed?.(k);
    },
    reopen(keep) { const r = reopenLast(state, closed, keep); closed = r.stack; update(() => r.w); },
  };
}

/** The saved workspace, or one group without tabs (the welcome) when nothing usable is stored. */
export function loadWorkspace(): Workspace {
  const raw = readJson(WORKSPACE_KEY);
  return (typeof raw === 'string' ? deserialize(raw) : null) ?? empty();
}

export function useWorkspace(store: WorkspaceStore): Workspace {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
