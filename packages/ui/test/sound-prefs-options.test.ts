import { beforeEach, describe, expect, it } from 'vitest';
import { createSoundPrefs, DEFAULT_SOUNDS } from '../src/sounds/preferences';

beforeEach(() => localStorage.clear());

describe('createSoundPrefs options', () => {
  it('keeps the island keys and defaults without options', () => {
    const p = createSoundPrefs('ledge');
    expect(p.loadSounds()).toEqual(DEFAULT_SOUNDS);
    expect(p.loadFinished()).toBe('both');
    p.setFinished('sound');
    expect(localStorage.getItem('ledge.finished')).toBe('sound');
  });

  it('keeps the finish mode under its own key and starts with sounds off', () => {
    const p = createSoundPrefs('desktop', { finishedKey: 'desktop.notify', enabled: false });
    expect(p.loadSounds()).toEqual({ ...DEFAULT_SOUNDS, enabled: false });
    p.setFinished('bubble');
    expect(localStorage.getItem('desktop.notify')).toBe('bubble');
    expect(localStorage.getItem('desktop.finished')).toBeNull();
    p.setSounds({ enabled: true });
    expect(JSON.parse(localStorage.getItem('desktop.sounds')!).enabled).toBe(true);
    expect(createSoundPrefs('desktop', { finishedKey: 'desktop.notify', enabled: false }).loadSounds().enabled).toBe(true);
  });

  it('defaults a partial or broken record with the instance defaults', () => {
    localStorage.setItem('desktop.sounds', JSON.stringify({ volume: 'loud' }));
    expect(createSoundPrefs('desktop', { enabled: false }).loadSounds()).toMatchObject({ enabled: false, volume: 'loud' });
    localStorage.setItem('desktop.sounds', '{oops');
    expect(createSoundPrefs('desktop', { enabled: false }).loadSounds().enabled).toBe(false);
  });
});
