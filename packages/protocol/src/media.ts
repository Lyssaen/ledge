import { z } from 'zod';

/**
 * What is playing on the PC, as Windows' media controls (SMTC) report it, for the closed notch. Ledge Desktop's shell
 * reads it and pilots it (Tauri, Windows only): it never travels through the daemon.
 *
 *   command `now_playing`                  → NowPlaying | null, the state as it stands (read once on mount)
 *   event   `ledge://now-playing`          payload NowPlaying | null, on every change (track, play/pause, artwork, player)
 *   command `media_command { command }`    → boolean, whether the player took it (false: no player, or it refused)
 *
 * Outside Windows (and outside Tauri) there is never anything playing: `null`, and every command answers false.
 */
export const NOW_PLAYING_EVENT = 'ledge://now-playing';
export const NOW_PLAYING_COMMAND = 'now_playing';
export const MEDIA_COMMAND = 'media_command';

/** The three controls the notch offers. */
export const MediaCommandSchema = z.enum(['previous', 'play_pause', 'next']);
export type MediaCommand = z.infer<typeof MediaCommandSchema>;

/** The largest artwork the shell sends, decoded (bytes): a bigger thumbnail is left out rather than flooding the event. */
export const ARTWORK_MAX_BYTES = 512 * 1024;

export const NowPlayingSchema = z.object({
  /** The track's title; a session without one is not reported (nothing to show). */
  title: z.string().min(1),
  /** '' when the player gives none (a web video often has no artist). */
  artist: z.string(),
  album: z.string().optional(),
  /** The cover as a `data:image/…;base64,` URL; left out when the player has none, or it is over ARTWORK_MAX_BYTES. It can
   *  arrive in a later event than the track itself: players often publish the thumbnail a moment after the title. */
  artwork: z.string().startsWith('data:image/').optional(),
  /** True while it plays; a paused session is still reported (with false), `null` means no media session at all. */
  playing: z.boolean(),
  /** What the player accepts now; a control it refuses is disabled, not hidden, at the front's choice. */
  can: z.object({ previous: z.boolean(), playPause: z.boolean(), next: z.boolean() }),
  /** The player: SMTC's source app id (`Spotify.exe`, `MSEdge`, a packaged app's AUMID), and its display name when
   *  Windows knows one. Several players can hold a session: the one reported is the one playing (Windows' current one
   *  first), else Windows' current one. Commands go to that same player. */
  player: z.object({ id: z.string().min(1), name: z.string().optional() })
});
export type NowPlaying = z.infer<typeof NowPlayingSchema>;

export const NowPlayingStateSchema = NowPlayingSchema.nullable();
export type NowPlayingState = z.infer<typeof NowPlayingStateSchema>;

/** The shell's payload read defensively: anything that is not a valid state reads as nothing playing. */
export function parseNowPlaying(raw: unknown): NowPlayingState {
  const r = NowPlayingSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Whether two states are the same track of the same player: a new track (or a new player) is what wakes the notch;
 *  play/pause, the artwork arriving or the controls changing are not. */
export function sameTrack(a: NowPlayingState, b: NowPlayingState): boolean {
  if (!a || !b) return a === b;
  return a.player.id === b.player.id && a.title === b.title && a.artist === b.artist && (a.album ?? '') === (b.album ?? '');
}
