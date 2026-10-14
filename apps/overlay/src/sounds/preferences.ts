import { useCallback, useSyncExternalStore } from 'react';

import { CATEGORIES, DEFAULT_SOUNDS, FINISHED_VALUES, VOLUMES, type FinishedNotify, type SoundPrefs, type SoundVolume, type SoundCategory } from '@ledge/ui/sounds/preferences';
export { CATEGORIES, DEFAULT_SOUNDS, FINISHED_VALUES, VOLUMES, VOLUME_GAIN } from '@ledge/ui/sounds/preferences';
export type { FinishedNotify, SoundPrefs, SoundVolume, SoundCategory } from '@ledge/ui/sounds/preferences';

const FINISHED_KEY = 'ledge.finished';
const SOUNDS_KEY = 'ledge.sounds';

export function loadFinished(): FinishedNotify {
  try { const v = localStorage.getItem(FINISHED_KEY); return (FINISHED_VALUES as readonly string[]).includes(v ?? '') ? (v as FinishedNotify) : 'both'; } catch { return 'both'; }
}
/** Each field is validated on its own, so a partial or outdated record keeps what it can and defaults the rest. */
export function loadSounds(): SoundPrefs {
  try {
    const raw = localStorage.getItem(SOUNDS_KEY); if (!raw) return DEFAULT_SOUNDS;
    const v = JSON.parse(raw) as Partial<SoundPrefs> | null; if (!v || typeof v !== 'object') return DEFAULT_SOUNDS;
    const categories = { ...DEFAULT_SOUNDS.categories };
    for (const c of CATEGORIES) if (typeof v.categories?.[c] === 'boolean') categories[c] = v.categories[c]!;
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SOUNDS.enabled,
      volume: (VOLUMES as readonly string[]).includes(v.volume ?? '') ? (v.volume as SoundVolume) : DEFAULT_SOUNDS.volume,
      categories,
      onlyWhenTerminalBehind: typeof v.onlyWhenTerminalBehind === 'boolean' ? v.onlyWhenTerminalBehind : DEFAULT_SOUNDS.onlyWhenTerminalBehind
    };
  } catch { return DEFAULT_SOUNDS; }
}

let finished = loadFinished();
let sounds = loadSounds();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export type SoundPatch = Partial<Omit<SoundPrefs, 'categories'>> & { categories?: Partial<Record<SoundCategory, boolean>> };
export function setFinished(v: FinishedNotify): void {
  finished = v;
  try { localStorage.setItem(FINISHED_KEY, v); } catch { /* storage unavailable: the in-memory value still applies */ }
  emit();
}
export function setSounds(patch: SoundPatch): void {
  sounds = { ...sounds, ...patch, categories: { ...sounds.categories, ...(patch.categories ?? {}) } };
  try { localStorage.setItem(SOUNDS_KEY, JSON.stringify(sounds)); } catch { /* storage unavailable */ }
  emit();
}
/** Test hook: forget the module state (the next read reloads from storage). */
export function resetSoundPrefsForTests(): void { finished = loadFinished(); sounds = loadSounds(); emit(); }

export function useSoundPrefs() {
  const f = useSyncExternalStore(subscribe, () => finished, () => finished);
  const s = useSyncExternalStore(subscribe, () => sounds, () => sounds);
  return { finished: f, sounds: s, setFinished: useCallback(setFinished, []), setSounds: useCallback(setSounds, []) };
}
