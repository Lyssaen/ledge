import { useSyncExternalStore } from 'react';

/** One clock for the whole TUI, ticking each second while something shows it: only what reads it draws again. */
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => { now = Date.now(); for (const l of listeners) l(); }, 1000);
    timer.unref?.();
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

/** The time, again each second. */
export const useNow = (): number => useSyncExternalStore(subscribe, () => now);
