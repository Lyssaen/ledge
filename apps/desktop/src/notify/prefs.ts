import { useSyncExternalStore } from 'react';
import { createSoundPrefs } from '@ledge/ui/sounds/preferences';
export type { FinishedNotify, SoundPatch, SoundPrefs } from '@ledge/ui/sounds/preferences';

/** Desktop's sounds (`desktop.sounds`) start off and its finish alert lives in `desktop.notify` (spec §7, §10): both
 *  fronts may run on the same daemon, and these defaults keep them from playing every cue twice. */
const prefs = createSoundPrefs('desktop', { finishedKey: 'desktop.notify', enabled: false });
export const { loadSounds, setSounds, useSoundPrefs, resetSoundPrefsForTests } = prefs;
export const loadNotifyMode = prefs.loadFinished;
export const setNotifyMode = prefs.setFinished;

/** Do not disturb (`desktop.dnd`, '1' / '0' like the island's `ledge.dnd`): cuts toasts and sounds, never what the screen shows. */
const DND_KEY = 'desktop.dnd';
export function loadDnd(): boolean {
  try { return localStorage.getItem(DND_KEY) === '1'; } catch { return false; }
}
let dnd = loadDnd();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const getDnd = (): boolean => dnd;
export function setDnd(on: boolean): void {
  dnd = on;
  try { localStorage.setItem(DND_KEY, on ? '1' : '0'); } catch { /* storage unavailable: the in-memory value still applies */ }
  emit();
}
export function useDnd(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, getDnd, getDnd), setDnd];
}
/** The notch is another window on the same storage: its switch only reaches this one as a `storage` event. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== DND_KEY) return;
    dnd = e.newValue === '1';
    emit();
  });
}
/** Test hook: the next read reloads from storage. */
export function resetDndForTests(): void { dnd = loadDnd(); emit(); }
