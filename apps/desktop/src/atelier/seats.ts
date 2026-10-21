import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../state/storage';
import { MAX_SEATS } from './layout';

/** How many main agents sit around a table before « +N » (Settings › Appearance): the mockup's six by default. */
export const SEATS_KEY = 'desktop.atelier.seats';
export const SEAT_CHOICES = [4, 6, 8, 10, 12] as const;
export type SeatChoice = (typeof SEAT_CHOICES)[number];
const isSeats = (v: unknown): v is SeatChoice => (SEAT_CHOICES as readonly unknown[]).includes(v);

/** The stored seat count; six when none is stored or the stored value is not offered. */
export function loadSeats(): SeatChoice {
  const v = readJson(SEATS_KEY);
  return isSeats(v) ? v : (MAX_SEATS as SeatChoice);
}

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Keeps the seat count and tells every reader (the tables follow at once). */
export function saveSeats(n: SeatChoice): void {
  writeJson(SEATS_KEY, n);
  listeners.forEach(l => l());
}

/** The seat count and its setter. The snapshot is read from storage, so it never lags behind a store that was cleared. */
export function useSeats(): [SeatChoice, (n: SeatChoice) => void] {
  return [useSyncExternalStore(subscribe, loadSeats, loadSeats), saveSeats];
}

/** The detached Atelier is another window on the same storage: the setting only reaches it as a `storage` event. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === SEATS_KEY) listeners.forEach(l => l()); });
}
