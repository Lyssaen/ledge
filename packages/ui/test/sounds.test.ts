import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DEFAULT_SOUNDS, createSoundPrefs } from '../src/sounds/preferences';
import { CUES, CATEGORY_OF, USER_CUES } from '../src/sounds/cues';
import { createWebAudioPlayer } from '../src/sounds/player';

const { loadFinished, loadSounds, useSoundPrefs, resetSoundPrefsForTests } = createSoundPrefs('ledge');

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

describe('cues', () => {
  it('every cue is sine or triangle, under 350 ms, peaking at or under the −18 dBFS gain', () => {
    for (const [name, notes] of Object.entries(CUES)) {
      expect(notes.length, name).toBeGreaterThan(0);
      const end = Math.max(...notes.map(n => n.at + n.dur));
      expect(end, name).toBeLessThanOrEqual(0.35);
      for (const n of notes) { expect(['sine', 'triangle']).toContain(n.type); expect(n.gain).toBeLessThanOrEqual(0.14); expect(n.gain).toBeGreaterThan(0); }
    }
    expect(CATEGORY_OF.approval).toBe('requests'); expect(CATEGORY_OF.question).toBe('requests'); expect(CATEGORY_OF.finished).toBe('finished');
    expect(CATEGORY_OF.error).toBe('errors'); expect(CATEGORY_OF.accept).toBe('decisions'); expect(CATEGORY_OF.deny).toBe('decisions');
    expect(CATEGORY_OF.join).toBe('team'); expect(CATEGORY_OF.leave).toBe('team');
    expect([...USER_CUES].sort()).toEqual(['accept', 'deny']);
  });
  it('asks rise or knock, results fall, decisions are single ticks', () => {
    expect(CUES.question[1]!.freq).toBeGreaterThan(CUES.question[0]!.freq);
    expect(CUES.finished[1]!.freq).toBeLessThan(CUES.finished[0]!.freq);
    expect(CUES.approval).toHaveLength(2); expect(CUES.approval[0]!.freq).toBe(CUES.approval[1]!.freq);
    expect(CUES.accept).toHaveLength(1); expect(CUES.deny).toHaveLength(1); expect(CUES.accept[0]!.freq).toBeGreaterThan(CUES.deny[0]!.freq);
    expect(CUES.error[0]!.glideTo!).toBeLessThan(CUES.error[0]!.freq);
  });
});

describe('createWebAudioPlayer', () => {
  it('without an AudioContext (jsdom) it is silent and never throws', () => {
    const p = createWebAudioPlayer();
    expect(() => p.play('approval', 1)).not.toThrow();
  });
});

describe('sound preferences per prefix', () => {
  beforeEach(() => localStorage.clear());
  it('two instances never share a key nor a subscriber', () => {
    const island = createSoundPrefs('ledge'); const desktop = createSoundPrefs('desktop');
    island.setFinished('sound');
    expect(localStorage.getItem('ledge.finished')).toBe('sound');
    expect(desktop.loadFinished()).toBe('both');
    const { result: d } = renderHook(() => desktop.useSoundPrefs());
    act(() => island.setSounds({ volume: 'loud' }));
    expect(d.current).toMatchObject({ finished: 'both', sounds: DEFAULT_SOUNDS });
    expect(localStorage.getItem('desktop.sounds')).toBeNull();
    expect(localStorage.getItem('desktop.finished')).toBeNull();
  });
});
