import { useSyncExternalStore } from 'react';
import type { SessionView } from './prefs';

/**
 * « Vue par défaut d'une session » (#300, docs/mockups/ledge-session-view-default.html, validated 2026-11-13): the view a session
 * opens on, Fil or Terminal, set in Settings › General. It replaces the memory of the last view: a view changed on a session
 * lasts for that visit (outside the IDE) or that tab (in the IDE). Desktop only. Absent or invalid: Fil (the behaviour before).
 * Its own key, so the session page's preferences (saved whole on each change) never overwrite it.
 */
export const DEFAULT_VIEW_KEY = 'desktop.sessionDefaultView';

const read = (): SessionView => { try { return localStorage.getItem(DEFAULT_VIEW_KEY) === 'terminal' ? 'terminal' : 'thread'; } catch { return 'thread'; } };
let value: SessionView = read();
const subscribers = new Set<() => void>();

export const getDefaultView = (): SessionView => value;

export function setDefaultView(v: SessionView): void {
  value = v;
  try { localStorage.setItem(DEFAULT_VIEW_KEY, v); } catch { /* not kept: still applied */ }
  subscribers.forEach(f => f());
}

export const useDefaultView = (): SessionView => useSyncExternalStore(f => { subscribers.add(f); return () => { subscribers.delete(f); }; }, () => value);

/** For tests: read the key again (a test that writes localStorage before mounting). */
export const reloadDefaultView = (): void => { value = read(); };
