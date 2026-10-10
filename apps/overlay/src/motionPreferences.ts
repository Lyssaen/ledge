import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'ledge.reducedMotion';
const QUERY = '(prefers-reduced-motion: reduce)';

function readStored(): boolean {
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

let appReduced = readStored();
const appListeners = new Set<() => void>();
const emitApp = () => appListeners.forEach(l => l());

function subscribeApp(listener: () => void) {
  appListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    appReduced = e.newValue === 'true';
    emitApp();
  };
  window.addEventListener('storage', onStorage);
  return () => { appListeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

function setReduced(value: boolean) {
  appReduced = value;
  try { localStorage.setItem(KEY, String(value)); } catch { /* storage unavailable: keep the in-memory value */ }
  emitApp();
}

const media = (): MediaQueryList | null => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null);

function subscribeOs(listener: () => void) {
  const m = media();
  m?.addEventListener('change', listener);
  return () => m?.removeEventListener('change', listener);
}
const osSnapshot = () => media()?.matches ?? false;

/** `VITE_LEDGE_MOTION=0` removes presentation motion (tests). */
function envReduced(): boolean {
  const v: unknown = import.meta.env.VITE_LEDGE_MOTION;
  return v !== undefined && Number(v) === 0;
}

/** Live OS `prefers-reduced-motion`; nothing in the app can override it to force animation. */
export function useOsReducedMotion(): boolean {
  return useSyncExternalStore(subscribeOs, osSnapshot, () => false);
}

/** The app-wide motion preference: persisted app setting OR live OS reduction OR `VITE_LEDGE_MOTION=0`.
 *  `app` is the app's own setting alone (what the settings switch shows). */
export function useMotionPreferences(): { reduced: boolean; app: boolean; setReduced(value: boolean): void } {
  const app = useSyncExternalStore(subscribeApp, () => appReduced, () => appReduced);
  const os = useOsReducedMotion();
  const set = useCallback((value: boolean) => setReduced(value), []);
  return { reduced: app || os || envReduced(), app, setReduced: set };
}
