import { useSyncExternalStore } from 'react';

/** How the atelier and the sidebar group OpenRig's seats: in their rig's room and the Rigs / Kernel groups (`rigs`), or at
 *  their project's table like any session (`projects`). Kept across launches. */
export type Grouping = 'rigs' | 'projects';
const KEY = 'desktop.grouping';
let value: Grouping = (() => { try { return localStorage.getItem(KEY) === 'projects' ? 'projects' : 'rigs'; } catch { return 'rigs'; } })();
const subscribers = new Set<() => void>();

export function setGrouping(g: Grouping): void {
  value = g;
  try { localStorage.setItem(KEY, g); } catch { /* not kept: still applied */ }
  subscribers.forEach(f => f());
}
export const useGrouping = (): Grouping => useSyncExternalStore(f => { subscribers.add(f); return () => { subscribers.delete(f); }; }, () => value);
