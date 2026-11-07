import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../state/storage';
import { WEBGL_DEFAULT, WEBGL_MAX, WEBGL_MIN } from './webgl';

const KEY = 'ledge.ide.webgl';
const listeners = new Set<() => void>();

/** The WebGL budget: 12 by default; anything stored that is not a whole number reads as the default, the rest is clamped to 1..16. */
export function loadWebglMax(): number {
  const v = readJson(KEY);
  return typeof v === 'number' && Number.isInteger(v) ? Math.max(WEBGL_MIN, Math.min(WEBGL_MAX, v)) : WEBGL_DEFAULT;
}

export function saveWebglMax(n: number): void {
  writeJson(KEY, Math.max(WEBGL_MIN, Math.min(WEBGL_MAX, Math.round(n))));
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The setting's value, shared: every consumer re-renders when any one sets it. */
export function useWebglMax(): [number, (n: number) => void] {
  return [useSyncExternalStore(subscribe, loadWebglMax), saveWebglMax];
}
