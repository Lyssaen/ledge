/**
 * The island's two settings (spec 2026-10-12 §5): where its axis sits on the top edge, and whether it shrinks to a
 * strip under a maximised window. Both apply live; storage failures fall back to the defaults.
 */
import type { IslandPosition } from './surface/geometry';
export type { IslandPosition } from './surface/geometry';

export const ISLAND_POSITIONS: readonly IslandPosition[] = ['center', 'left', 'right'];
const POSITION_KEY = 'ledge.islandPosition';
const DISCREET_KEY = 'ledge.discreet';

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
