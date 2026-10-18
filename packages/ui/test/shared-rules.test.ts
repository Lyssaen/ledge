import { describe, expect, it } from 'vitest';
import { decideSound, SOUND_RATE_MS, type SoundInput } from '../src/sounds/decide';
import { DEFAULT_SOUNDS } from '../src/sounds/preferences';
import { compareVersions } from '../src/semver';

const base: SoundInput = { cue: 'question', sounds: DEFAULT_SOUNDS, finished: 'both', dnd: false, terminalInFront: false, lastPlayedAt: null, connectedAt: null, now: 10_000 };

describe('decideSound, shared by both fronts', () => {
  it('plays at the chosen volume', () => {
    expect(decideSound(base)).toEqual({ play: true, gain: 1 });
    expect(decideSound({ ...base, sounds: { ...DEFAULT_SOUNDS, volume: 'quiet' } })).toEqual({ play: true, gain: 0.5 });
  });
  it('sounds off and Do not disturb cut everything, the user ticks too', () => {
    expect(decideSound({ ...base, sounds: { ...DEFAULT_SOUNDS, enabled: false } })).toEqual({ play: false, why: 'off' });
    expect(decideSound({ ...base, cue: 'accept', dnd: true })).toEqual({ play: false, why: 'dnd' });
  });
  it('one cue per window, the user ticks excepted', () => {
    expect(decideSound({ ...base, lastPlayedAt: base.now - SOUND_RATE_MS + 1 })).toEqual({ play: false, why: 'rate' });
    expect(decideSound({ ...base, cue: 'deny', lastPlayedAt: base.now - 1 })).toMatchObject({ play: true });
  });
  it('a finish follows the finish mode', () => {
    expect(decideSound({ ...base, cue: 'finished', finished: 'bubble' })).toEqual({ play: false, why: 'finished-setting' });
    expect(decideSound({ ...base, cue: 'finished', finished: 'sound' })).toMatchObject({ play: true });
  });
});

describe('compareVersions', () => {
  it('orders releases and puts a pre-release first', () => {
    expect(compareVersions('0.5.0', '0.4.9')).toBe(1);
    expect(compareVersions('0.4.9', '0.5.0')).toBe(-1);
    expect(compareVersions('0.5.0', '0.5.0')).toBe(0);
    expect(compareVersions('0.5.0-dev', '0.5.0')).toBe(-1);
  });
});
