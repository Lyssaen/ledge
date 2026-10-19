import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { AgentLink, Tab, TermStore } from './store';

/** The app's one terminal store; App provides it. */
export const TermStoreContext = createContext<TermStore | null>(null);

/** A session's tabs, its selected tab and its agent's link, re-rendered on every change of the store. */
export function useTerms(sessionId: string): { tabs: readonly Tab[]; active: string; link: AgentLink; store: TermStore } {
  const store = useContext(TermStoreContext);
  if (!store) throw new Error('useTerms needs a TermStoreContext provider');
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  const tabs = useSyncExternalStore(subscribe, () => store.tabs(sessionId));
  const active = useSyncExternalStore(subscribe, () => store.active(sessionId));
  const link = useSyncExternalStore(subscribe, () => store.link(sessionId));
  return { tabs, active, link, store };
}
