import { createSoundPrefs } from '@ledge/ui/sounds/preferences';
export * from '@ledge/ui/sounds/preferences';

// The island keeps the `ledge.finished` / `ledge.sounds` keys.
export const { loadFinished, loadSounds, setFinished, setSounds, resetSoundPrefsForTests, useSoundPrefs } = createSoundPrefs('ledge');
