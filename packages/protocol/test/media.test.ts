import { describe, it, expect } from 'vitest';
import { MediaCommandSchema, NowPlayingSchema, parseNowPlaying, sameTrack, type NowPlaying } from '../src/index.js';

const track: NowPlaying = {
  title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', artwork: 'data:image/png;base64,iVBORw0KGgo=',
  playing: true, can: { previous: true, playPause: true, next: true }, player: { id: 'Spotify.exe', name: 'Spotify' }
};

describe('now playing', () => {
  it('reads what the shell sends, and anything else as nothing playing', () => {
    expect(parseNowPlaying(track)).toEqual(track);
    expect(parseNowPlaying(null)).toBeNull();
    expect(parseNowPlaying(undefined)).toBeNull();
    expect(parseNowPlaying({ ...track, title: '' })).toBeNull();
    expect(parseNowPlaying({ ...track, player: { id: '' } })).toBeNull();
    // an artwork that is not an image data URL is refused: the front never loads a remote URL from a player
    expect(parseNowPlaying({ ...track, artwork: 'https://example.com/a.png' })).toBeNull();
  });

  it('takes a track without artist, album, artwork or player name', () => {
    const bare = { title: 'Live', artist: '', playing: false, can: { previous: false, playPause: true, next: false }, player: { id: 'MSEdge' } };
    expect(NowPlayingSchema.parse(bare)).toEqual(bare);
  });

  it('offers exactly the three controls', () => {
    expect(MediaCommandSchema.options).toEqual(['previous', 'play_pause', 'next']);
    expect(MediaCommandSchema.safeParse('stop').success).toBe(false);
  });

  it('tells a new track from a change of the same one', () => {
    expect(sameTrack(track, { ...track, playing: false, artwork: undefined, can: { previous: false, playPause: true, next: false } })).toBe(true);
    expect(sameTrack(track, { ...track, title: 'Angel' })).toBe(false);
    expect(sameTrack(track, { ...track, artist: 'Other' })).toBe(false);
    expect(sameTrack(track, { ...track, album: undefined })).toBe(false);
    expect(sameTrack(track, { ...track, player: { id: 'MSEdge' } })).toBe(false);
    expect(sameTrack(track, null)).toBe(false);
    expect(sameTrack(null, null)).toBe(true);
  });
});
