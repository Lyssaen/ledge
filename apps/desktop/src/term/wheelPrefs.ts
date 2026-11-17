import { useSyncExternalStore } from 'react';
import { isRecord, readJson, writeJson } from '../state/storage';
import type { WheelPref } from './wheel';

const KEY = 'ledge.ide.wheel';
export const WHEEL_MIN = 1;
export const WHEEL_MAX = 20;
/** Like Windows; 3 lines on the stepper, Windows' own default, until one is chosen. */
export const WHEEL_DEFAULT: WheelPref = { mode: 'system', lines: 3 };
const listeners = new Set<() => void>();

const clamp = (n: number) => Math.max(WHEEL_MIN, Math.min(WHEEL_MAX, Math.round(n)));

/** The wheel's setting; anything stored that is not a mode with a whole number of lines reads as the default. */
export function loadWheel(): WheelPref {
  const v = readJson(KEY);
  if (!isRecord(v) || (v.mode !== 'system' && v.mode !== 'fixed') || typeof v.lines !== 'number' || !Number.isInteger(v.lines)) return WHEEL_DEFAULT;
  return { mode: v.mode, lines: clamp(v.lines) };
}

export function saveWheel(p: WheelPref): void {
  writeJson(KEY, { mode: p.mode, lines: clamp(p.lines) });
  listeners.forEach(l => l());
}

// useSyncExternalStore needs the same object while the stored text is the same.
let last: { raw: string | null; pref: WheelPref } | null = null;
const snapshot = () => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage unavailable: the default */ }
  if (!last || last.raw !== raw) last = { raw, pref: loadWheel() };
  return last.pref;
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The setting's value, shared: every consumer re-renders when any one sets it. */
export function useWheel(): [WheelPref, (p: WheelPref) => void] {
  return [useSyncExternalStore(subscribe, snapshot), saveWheel];
}
