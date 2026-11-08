import { useSyncExternalStore } from 'react';
import type { Session } from '@ledge/protocol';

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
/** Whether « Projets | Rigs » is offered: a live OpenRig seat, or OpenRig installed on a followed machine (its empty states
 *  live in « Rigs »). Shared by the sidebar and the IDE's Atelier bar. */
export const offersRigs = (sessions: readonly Pick<Session, 'rig' | 'state'>[], installed: boolean | undefined): boolean =>
  sessions.some(s => s.rig && s.state !== 'exited') || installed === true;
export const useGrouping =(): Grouping => useSyncExternalStore(f => { subscribers.add(f); return () => { subscribers.delete(f); }; }, () => value);
