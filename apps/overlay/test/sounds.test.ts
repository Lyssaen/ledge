import { describe, it, expect } from 'vitest';
import { DEFAULT_SOUNDS } from '../src/sounds/preferences';
import { decideSound, SOUND_RATE_MS } from '../src/sounds/decide';

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
