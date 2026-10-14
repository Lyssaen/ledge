import { useCallback, useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

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

/** One store per key prefix: the island keeps `ledge.reducedMotion`, Desktop gets `desktop.reducedMotion` (spec §7). */
export function createMotionPreferences(prefix: string) {
  const KEY = `${prefix}.reducedMotion`;
  function loadReduced(): boolean {
    try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
  }

  let appReduced = loadReduced();
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

  function saveReduced(value: boolean) {
    appReduced = value;
    try { localStorage.setItem(KEY, String(value)); } catch { /* storage unavailable: keep the in-memory value */ }
    emitApp();
  }

  /** The app-wide motion preference: persisted app setting OR live OS reduction OR `VITE_LEDGE_MOTION=0`.
   *  `app` is the app's own setting alone (what the settings switch shows). */
  function useMotionPreferences(): { reduced: boolean; app: boolean; setReduced(value: boolean): void } {
    const app = useSyncExternalStore(subscribeApp, () => appReduced, () => appReduced);
    const os = useOsReducedMotion();
    const set = useCallback((value: boolean) => saveReduced(value), []);
    return { reduced: app || os || envReduced(), app, setReduced: set };
  }
  return { loadReduced, saveReduced, useMotionPreferences };
}

export type MotionPreferencesHook = () => { reduced: boolean; app: boolean; setReduced(value: boolean): void };

/** Neutral until an app registers its own: OS preference + env, no storage key, nothing to persist. */
const useNeutralMotionPreferences: MotionPreferencesHook = () => ({ reduced: useOsReducedMotion() || envReduced(), app: false, setReduced() {} });
let resolveDefault: MotionPreferencesHook = useNeutralMotionPreferences;
/** An app registers its store here (the island: `ledge.reducedMotion`): a mascot with no `reducedMotion` prop reads it. */
export function setDefaultMotionPreferences(hook: MotionPreferencesHook): void { resolveDefault = hook; }
/** What the shared mascots read; call it only at render, after the app has registered. */
export function useDefaultMotionPreferences(): ReturnType<MotionPreferencesHook> { return resolveDefault(); }
