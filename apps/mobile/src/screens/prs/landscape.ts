import { useSyncExternalStore } from 'react';
import { WIDE_QUERY } from '../../ui/layout';

/** A tablet on its side: the request shows its Discussion in a column and its pipeline left to right (m5-mr-pr.html, §10). */
const QUERY = `${WIDE_QUERY} and (orientation: landscape)`;

const media = () => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(QUERY) : null);
const subscribe = (fn: () => void) => {
  const m = media();
  m?.addEventListener?.('change', fn);
  return () => m?.removeEventListener?.('change', fn);
};

/** Whether the screen is wide and lying down; upright, a request keeps the phone's four views. */
export function useLandscape(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}
