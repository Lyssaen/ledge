import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DEFAULT_SOUNDS, loadFinished, loadSounds, useSoundPrefs, resetSoundPrefsForTests } from '../src/sounds/preferences';
import { CUES, CATEGORY_OF, USER_CUES } from '../src/sounds/cues';
import { decideSound, SOUND_RATE_MS } from '../src/sounds/decide';
import { createWebAudioPlayer } from '../src/sounds/player';

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

describe('decideSound', () => {
  const base = { sounds: DEFAULT_SOUNDS, finished: 'both' as const, dnd: false, terminalInFront: false, lastPlayedAt: null, connectedAt: null, now: 100_000 };
  it('plays an approval at the volume gain', () => {
    expect(decideSound({ ...base, cue: 'approval' })).toEqual({ play: true, gain: 1 });
    expect(decideSound({ ...base, cue: 'approval', sounds: { ...DEFAULT_SOUNDS, volume: 'loud' } })).toEqual({ play: true, gain: 1.8 });
  });
  it('is cut by the switch, DND, the category, and the terminal in front', () => {
    expect(decideSound({ ...base, cue: 'approval', sounds: { ...DEFAULT_SOUNDS, enabled: false } })).toEqual({ play: false, why: 'off' });
    expect(decideSound({ ...base, cue: 'approval', dnd: true })).toEqual({ play: false, why: 'dnd' });
    expect(decideSound({ ...base, cue: 'join' })).toEqual({ play: false, why: 'category' });   // team is off by default
    expect(decideSound({ ...base, cue: 'approval', terminalInFront: true })).toEqual({ play: false, why: 'terminal' });
    expect(decideSound({ ...base, cue: 'approval', terminalInFront: true, sounds: { ...DEFAULT_SOUNDS, onlyWhenTerminalBehind: false } }).play).toBe(true);
  });
  it('the finished cue follows the finished setting', () => {
    expect(decideSound({ ...base, cue: 'finished', finished: 'bubble' })).toEqual({ play: false, why: 'finished-setting' });
    expect(decideSound({ ...base, cue: 'finished', finished: 'none' })).toEqual({ play: false, why: 'finished-setting' });
    expect(decideSound({ ...base, cue: 'finished', finished: 'sound' }).play).toBe(true);
  });
  it('one cue per 1.5 s, except the user\'s own ticks, which always play', () => {
    expect(decideSound({ ...base, cue: 'question', lastPlayedAt: base.now - SOUND_RATE_MS + 1 })).toEqual({ play: false, why: 'rate' });
    expect(decideSound({ ...base, cue: 'question', lastPlayedAt: base.now - SOUND_RATE_MS }).play).toBe(true);
    expect(decideSound({ ...base, cue: 'accept', lastPlayedAt: base.now - 300 }).play).toBe(true);
    expect(decideSound({ ...base, cue: 'deny', lastPlayedAt: base.now - 300, terminalInFront: true }).play).toBe(true);
  });
  it('join cues are swallowed right after connect (snapshot replay), other cues are not', () => {
    const team = { ...DEFAULT_SOUNDS, categories: { ...DEFAULT_SOUNDS.categories, team: true } };
    expect(decideSound({ ...base, cue: 'join', sounds: team, connectedAt: base.now - 1000 })).toEqual({ play: false, why: 'snapshot' });
    expect(decideSound({ ...base, cue: 'join', sounds: team, connectedAt: base.now - 2000 }).play).toBe(true);
    expect(decideSound({ ...base, cue: 'approval', connectedAt: base.now - 1000 }).play).toBe(true);
  });
});

describe('createWebAudioPlayer', () => {
  it('without an AudioContext (jsdom) it is silent and never throws', () => {
    const p = createWebAudioPlayer();
    expect(() => p.play('approval', 1)).not.toThrow();
  });
});
