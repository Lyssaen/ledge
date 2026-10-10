import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSounds } from '../src/sounds/useSounds';
import { DEFAULT_SOUNDS, VOLUME_GAIN, resetSoundPrefsForTests } from '../src/sounds/preferences';

describe('useSounds().test', () => {
  beforeEach(() => { localStorage.clear(); resetSoundPrefsForTests(); });
  it('plays the question cue at the current volume, even with the switch off and DND on', () => {
    localStorage.setItem('ledge.sounds', JSON.stringify({ ...DEFAULT_SOUNDS, enabled: false, volume: 'loud' })); resetSoundPrefsForTests();
    const played: Array<[string, number]> = [];
    const player = { play: (c: string, g: number) => { played.push([c, g]); } };
    const { result } = renderHook(() => useSounds({ player: player as never, dnd: true, status: 'open' }));
    result.current.test();
    expect(played).toEqual([['question', VOLUME_GAIN.loud]]);
  });
});
