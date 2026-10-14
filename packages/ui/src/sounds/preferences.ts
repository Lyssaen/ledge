// Sound types and constants, plus a per-prefix preference store (`ledge.*` for the island, `desktop.*` for Desktop).
import { useCallback, useSyncExternalStore } from 'react';


export type FinishedNotify = 'both' | 'bubble' | 'sound' | 'none';
export type SoundVolume = 'quiet' | 'normal' | 'loud';
export type SoundCategory = 'requests' | 'finished' | 'errors' | 'decisions' | 'team';
export interface SoundPrefs { enabled: boolean; volume: SoundVolume; categories: Record<SoundCategory, boolean>; onlyWhenTerminalBehind: boolean }

export const FINISHED_VALUES: readonly FinishedNotify[] = ['both', 'bubble', 'sound', 'none'];
export const VOLUMES: readonly SoundVolume[] = ['quiet', 'normal', 'loud'];
export const CATEGORIES: readonly SoundCategory[] = ['requests', 'finished', 'errors', 'decisions', 'team'];
/** Multipliers on the −18 dBFS peak (spec §7 ter). */
export const VOLUME_GAIN: Record<SoundVolume, number> = { quiet: 0.5, normal: 1, loud: 1.8 };
export const DEFAULT_SOUNDS: SoundPrefs = { enabled: true, volume: 'normal', categories: { requests: true, finished: true, errors: true, decisions: true, team: false }, onlyWhenTerminalBehind: true };

export type SoundPatch = Partial<Omit<SoundPrefs, 'categories'>> & { categories?: Partial<Record<SoundCategory, boolean>> };

/** One preference store per key prefix; state and subscribers are per instance. */
export function createSoundPrefs(prefix: string) {
  const FINISHED_KEY = `${prefix}.finished`;
  const SOUNDS_KEY = `${prefix}.sounds`;

  function loadFinished(): FinishedNotify {
    try { const v = localStorage.getItem(FINISHED_KEY); return (FINISHED_VALUES as readonly string[]).includes(v ?? '') ? (v as FinishedNotify) : 'both'; } catch { return 'both'; }
  }
  /** Each field is validated on its own, so a partial or outdated record keeps what it can and defaults the rest. */
  function loadSounds(): SoundPrefs {
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

  function setFinished(v: FinishedNotify): void {
    finished = v;
    try { localStorage.setItem(FINISHED_KEY, v); } catch { /* storage unavailable: the in-memory value still applies */ }
    emit();
  }
  function setSounds(patch: SoundPatch): void {
    sounds = { ...sounds, ...patch, categories: { ...sounds.categories, ...(patch.categories ?? {}) } };
    try { localStorage.setItem(SOUNDS_KEY, JSON.stringify(sounds)); } catch { /* storage unavailable */ }
    emit();
  }
  /** Test hook: forget the module state (the next read reloads from storage). */
  function resetSoundPrefsForTests(): void { finished = loadFinished(); sounds = loadSounds(); emit(); }

  function useSoundPrefs() {
    const f = useSyncExternalStore(subscribe, () => finished, () => finished);
    const s = useSyncExternalStore(subscribe, () => sounds, () => sounds);
    return { finished: f, sounds: s, setFinished: useCallback(setFinished, []), setSounds: useCallback(setSounds, []) };
  }

  return { loadFinished, loadSounds, setFinished, setSounds, resetSoundPrefsForTests, useSoundPrefs };
}
