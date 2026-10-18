/**
 * The island's two settings (spec 2026-10-12 §5): where its axis sits on the top edge, and whether it shrinks to a
 * strip under a maximised window. Both apply live; storage failures fall back to the defaults.
 */
import { DEFAULT_ISLAND_PREFS, IslandPrefsSchema, type IslandPrefs } from '@ledge/protocol';
import type { IslandPosition } from './surface/geometry';
import { loadMonitor } from './monitor';
import { loadScale } from './scale';
export type { IslandPosition } from './surface/geometry';

export const ISLAND_POSITIONS: readonly IslandPosition[] = ['center', 'left', 'right'];
const POSITION_KEY = 'ledge.islandPosition';
const DISCREET_KEY = 'ledge.discreet';
const PREFS_KEY = 'ledge.island';

export function loadIslandPosition(): IslandPosition {
  try {
    const v = localStorage.getItem(POSITION_KEY);
    return (ISLAND_POSITIONS as readonly string[]).includes(v ?? '') ? (v as IslandPosition) : 'center';
  } catch { return 'center'; }
}

export function saveIslandPosition(p: IslandPosition): void {
  try { localStorage.setItem(POSITION_KEY, p); } catch { /* storage unavailable: the in-memory value still applies */ }
}

/** On unless explicitly switched off. */
export function loadDiscreet(): boolean {
  try { return localStorage.getItem(DISCREET_KEY) !== '0'; } catch { return true; }
}

export function saveDiscreet(on: boolean): void {
  try { localStorage.setItem(DISCREET_KEY, on ? '1' : '0'); } catch { /* storage unavailable: the in-memory value still applies */ }
}

/** The last settings the local daemon sent (Ledge Desktop › Settings › Island): an offline start applies them. Null when none was kept. */
export function loadIslandPrefs(): IslandPrefs | null {
  try { const v = IslandPrefsSchema.safeParse(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')); return v.success ? v.data : null; } catch { return null; }
}

export function saveIslandPrefs(p: IslandPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage unavailable: the in-memory value still applies */ }
}

/** The island's own values as one set of settings, for a daemon that holds none yet: what the island stored before Desktop
 *  held them (a chosen monitor reads as the second screen), the rest as last kept or the defaults. */
export function localIslandPrefs(): IslandPrefs {
  return { ...(loadIslandPrefs() ?? DEFAULT_ISLAND_PREFS), position: loadIslandPosition(), discreet: loadDiscreet(), screen: loadMonitor() !== null ? 'second' : 'primary', islandScale: loadScale('handle'), panelScale: loadScale('panel') };
}
