import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DEFAULT_SOUNDS, loadFinished, loadSounds, useSoundPrefs, resetSoundPrefsForTests } from '../src/sounds/preferences';

describe('sound and finished preferences', () => {
  beforeEach(() => { localStorage.clear(); resetSoundPrefsForTests(); });

  it('defaults: bubble and sound on finish; sounds on, normal, team off, terminal rule on', () => {
    expect(loadFinished()).toBe('both');
    expect(loadSounds()).toEqual({ enabled: true, volume: 'normal', categories: { requests: true, finished: true, errors: true, decisions: true, team: false }, onlyWhenTerminalBehind: true });
    expect(DEFAULT_SOUNDS.categories.team).toBe(false);
  });

  it('persists changes and merges a partial categories patch', () => {
    const { result } = renderHook(() => useSoundPrefs());
    act(() => { result.current.setFinished('sound'); result.current.setSounds({ volume: 'loud', categories: { team: true } }); });
    expect(result.current.finished).toBe('sound');
    expect(result.current.sounds.volume).toBe('loud');
    expect(result.current.sounds.categories).toEqual({ requests: true, finished: true, errors: true, decisions: true, team: true });
    expect(localStorage.getItem('ledge.finished')).toBe('sound');
    expect(JSON.parse(localStorage.getItem('ledge.sounds')!).volume).toBe('loud');
    expect(loadSounds().categories.team).toBe(true);
  });

  it('garbage and a throwing storage fall back to the defaults, and toggles still work in memory', () => {
    localStorage.setItem('ledge.finished', 'loudly'); localStorage.setItem('ledge.sounds', '{not json');
    expect(loadFinished()).toBe('both'); expect(loadSounds()).toEqual(DEFAULT_SOUNDS);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadSounds()).toEqual(DEFAULT_SOUNDS);
    const { result } = renderHook(() => useSoundPrefs());
    act(() => result.current.setSounds({ enabled: false }));
    expect(result.current.sounds.enabled).toBe(false);
    get.mockRestore(); set.mockRestore();
  });
});
