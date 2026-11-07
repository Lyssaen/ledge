import { useSyncExternalStore } from 'react';

/** The bottom panel (mockup `bottomPanel()`): its terminals side by side, by their terminal tab's ref (`shell:<n>`, `agent:<id>`),
 *  and the tab in front. Pure; its store is not saved (R15): a restart opens the panel empty. */
export interface Panel { terms: readonly string[]; tab: 'term' | 'out' }

export const EMPTY_PANEL: Panel = { terms: [], tab: 'term' };

/** At the end, Terminaux in front; already there: the same terminals. */
export function addTerm(p: Panel, ref: string): Panel {
  if (p.terms.includes(ref)) return p.tab === 'term' ? p : { ...p, tab: 'term' };
  return { terms: [...p.terms, ref], tab: 'term' };
}

/** Absent: the same object. */
export function removeTerm(p: Panel, ref: string): Panel {
  return p.terms.includes(ref) ? { ...p, terms: p.terms.filter(x => x !== ref) } : p;
}

/** The view key of a tile (its TabPlace): the agent's one screen (R2) is held by a tile as by a tab (`terminal:<ref>`). */
export const panelViewer = (ref: string): string => `panel:${ref}`;

/** A terminal tab's key: a bottom-panel shell's (`terminal:shell:<n>`) or an agent's (`terminal:agent:<id>`). */
export const isTerminalRef = (key: string): boolean => key.startsWith('terminal:shell:') || key.startsWith('terminal:agent:');

export interface PanelStore { get(): Panel; update(fn: (p: Panel) => Panel): void; subscribe(cb: () => void): () => void }

export function createPanelStore(initial: Panel = EMPTY_PANEL): PanelStore {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    update(fn) {
      const next = fn(state);
      if (next === state) return;
      state = next;
      for (const cb of [...subs]) cb();
    },
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; }
  };
}

export function usePanel(store: PanelStore): Panel {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
