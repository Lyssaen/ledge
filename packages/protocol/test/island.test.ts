import { describe, expect, it } from 'vitest';
import { DEFAULT_ISLAND_PREFS, DEFAULT_MUSIC_PREFS, IslandPrefsSchema, NowPlayingSchema } from '../src/island.js';

describe('island music prefs', () => {
  it('an island file written before music reads with music off', () => {
    const { music: _, ...old } = DEFAULT_ISLAND_PREFS;
    expect(IslandPrefsSchema.parse(old).music).toEqual({ enabled: false, hover: 'controls', paused: '5min' });
  });

  it('music keeps what was set', () => {
    const music = { enabled: true, hover: 'controls-title', paused: 'always' } as const;
    expect(IslandPrefsSchema.parse({ ...DEFAULT_ISLAND_PREFS, music }).music).toEqual(music);
  });

  it('an unknown paused value is refused', () => {
    expect(IslandPrefsSchema.safeParse({ ...DEFAULT_ISLAND_PREFS, music: { ...DEFAULT_MUSIC_PREFS, paused: '10min' } }).success).toBe(false);
  });

  it('a NowPlaying without cover parses', () => {
    expect(NowPlayingSchema.parse({ title: 'Quai 9', artist: '', playing: false, cover: null, canPrev: true, canNext: false, source: 'Chrome' }).cover).toBeNull();
  });
});
