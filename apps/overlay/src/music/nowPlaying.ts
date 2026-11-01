import { useEffect, useRef, useState } from 'react';
import { MUSIC_PAUSED_MS, type MediaAction, type MusicPrefs, type NowPlaying } from '@ledge/protocol';
import { mediaControl, mediaNow, mediaWatch, onNowPlaying } from '../tauri/bridge';

/** Whether the cover is on the notch: the setting, a session, and how long a pause has lasted. */
export function musicShown(o: { prefs: MusicPrefs; now: NowPlaying | null; pausedSince: number | null; at: number }): boolean {
  if (!o.prefs.enabled || !o.now) return false;
  if (o.now.playing) return true;
  if (o.prefs.paused === 'hide') return false;
  if (o.prefs.paused === 'always') return true;
  if (o.pausedSince == null) return false;
  return o.at - o.pausedSince < MUSIC_PAUSED_MS;
}

/** A new pause (or a new title that is already paused) starts the countdown; play, or no session, clears it. */
function pausedAt(prev: NowPlaying | null, next: NowPlaying | null, since: number | null, at: number): number | null {
  if (!next || next.playing) return null;
  if (!prev || prev.playing || prev.title !== next.title) return at;
  return since;
}

/**
 * Follows the track while the notch is shown and the setting is on, and stops the poll when it unmounts.
 * `shown` already applies the pause delay. `control` never throws.
 */
export function useNowPlaying(prefs: MusicPrefs, active: boolean): { now: NowPlaying | null; shown: boolean; control(a: MediaAction): void } {
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [pausedSince, setPausedSince] = useState<number | null>(null);
  const [at, setAt] = useState(() => Date.now());
  const nowRef = useRef<NowPlaying | null>(null);
  const sinceRef = useRef<number | null>(null);
  const serial = useRef(0);

  useEffect(() => {
    mediaWatch(active && prefs.enabled);
    return () => mediaWatch(false);
  }, [active, prefs.enabled]);

  useEffect(() => {
    let live = true;
    const apply = (next: NowPlaying | null, ticket: number) => {
      if (!live || ticket < serial.current) return;
      serial.current = ticket;
      const stamp = Date.now();
      const since = pausedAt(nowRef.current, next, sinceRef.current, stamp);
      nowRef.current = next;
      sinceRef.current = since;
      setAt(stamp);
      setNow(next);
      setPausedSince(since);
    };
    // The first read can resolve after a live event: the later ticket wins, so a stale null does not clear the track.
    const ticket = ++serial.current;
    void mediaNow().then(n => apply(n, ticket)).catch(() => {});
    const off = onNowPlaying(n => apply(n, ++serial.current));
    return () => { live = false; off(); };
  }, []);

  useEffect(() => {
    if (!now || now.playing || prefs.paused !== '5min' || pausedSince == null) return;
    const left = pausedSince + MUSIC_PAUSED_MS - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => setAt(Date.now()), left);
    return () => clearTimeout(id);
  }, [now, prefs.paused, pausedSince]);

  const shown = musicShown({ prefs, now, pausedSince, at });
  const control = (a: MediaAction) => { void mediaControl(a).catch(() => {}); };
  return { now, shown, control };
}
