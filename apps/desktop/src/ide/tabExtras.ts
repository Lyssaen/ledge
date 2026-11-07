import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { SynapseTags } from '../session/markers';
import { useTabPlace } from '../workspace/tabPlace';

/** What an IDE session tab's page knows that its tab menu says (lot 3, option A: the page has no heading row): whether the
 *  external terminal applies (the heading's button), and the Story / Objectif its shown thread leaves. */
export interface TabExtras { external: boolean; tags: SynapseTags | null }

export interface TabExtrasStore {
  get(key: string): TabExtras | undefined;
  /** null: the page is gone. */
  set(key: string, x: TabExtras | null): void;
  subscribe(fn: () => void): () => void;
}

const same = (a: TabExtras | undefined, b: TabExtras | null) =>
  (a === undefined && b === null) || (!!a && !!b && a.external === b.external && a.tags?.story === b.tags?.story && a.tags?.objectif === b.tags?.objectif);

export function createTabExtras(): TabExtrasStore {
  const map = new Map<string, TabExtras>();
  const fns = new Set<() => void>();
  return {
    get: key => map.get(key),
    set(key, x) {
      if (same(map.get(key), x)) return;
      if (x === null) map.delete(key); else map.set(key, x);
      for (const fn of fns) fn();
    },
    subscribe(fn) { fns.add(fn); return () => { fns.delete(fn); }; }
  };
}

/** null outside the IDE: a page publishes nothing. */
export const TabExtrasContext = createContext<TabExtrasStore | null>(null);

/** The page in an IDE tab publishes its extras under its tab's key while it is mounted; `x` null publishes nothing. */
export function usePublishTabExtras(x: TabExtras | null): void {
  const store = useContext(TabExtrasContext);
  const key = useTabPlace()?.key ?? null;
  const external = x?.external, story = x?.tags?.story, objectif = x?.tags?.objectif, on = x !== null;
  useEffect(() => {
    if (!store || key === null || !on) return;
    store.set(key, { external: external!, tags: story === undefined && objectif === undefined ? null : { ...(story !== undefined && { story }), ...(objectif !== undefined && { objectif }) } });
    return () => store.set(key, null);
  }, [store, key, on, external, story, objectif]);
}

/** The extras published for the tab `key` (null: none asked). */
export function useTabExtras(store: TabExtrasStore, key: string | null): TabExtras | undefined {
  return useSyncExternalStore(store.subscribe, () => (key === null ? undefined : store.get(key)));
}
