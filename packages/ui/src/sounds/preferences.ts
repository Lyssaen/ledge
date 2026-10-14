// Stateless sound types and constants; the stateful store stays with each app until createSoundPrefs (task 4).
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
