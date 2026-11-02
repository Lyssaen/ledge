import { useEffect, useRef, useState } from 'react';
import { createActivityFeed, sameTrack, type NotchActivity, type NowPlaying, type NowPlayingState, type Session } from '@ledge/protocol';
import type { DaemonClient } from '../daemon/client';
import { nowPlaying, onNowPlaying } from '../tauri/bridge';
import { hoverLine, initialLine, lineView, nextDeadline, pushLine, tickLine, type LineState, type NotchLine } from './line';

/** A paused track stays in the notch this long, then leaves with its filet until it plays again. */
export const PAUSED_KEEP_MS = 5 * 60_000;

/**
 * What plays on the PC, as the notch shows it: null when nothing plays, or after 5 min of pause. `onTrack` fires on a
 * new track (or a new player) after the first read, never for play/pause or a late artwork.
 */
export function useNowPlaying(onTrack: (np: NowPlaying) => void): NowPlaying | null {
  const [np, setNp] = useState<NowPlayingState>(null);
  const [stale, setStale] = useState(false);
  const last = useRef<NowPlayingState>(null);
  const read = useRef(false);
  const onTrackRef = useRef(onTrack); onTrackRef.current = onTrack;
  useEffect(() => {
    let disposed = false;
    const apply = (next: NowPlayingState, initial: boolean) => {
      if (disposed) return;
      const was = last.current;
      last.current = next;
      if (!initial && next && !sameTrack(was, next)) onTrackRef.current(next);
      setNp(next);
    };
    // A change that arrives before the first read is the state as it stands at start (already playing): no wake.
    const off = onNowPlaying(s => { const initial = !read.current; read.current = true; apply(s, initial); });
    void nowPlaying().then(s => { if (!read.current) apply(s, true); read.current = true; });
    return () => { disposed = true; off(); };
  }, []);
  // The pause clock: it starts with the pause, a play or a new track resets it.
  const paused = !!np && !np.playing;
  const trackKey = np ? `${np.player.id}|${np.title}|${np.artist}|${np.album ?? ''}` : '';
  useEffect(() => {
    setStale(false);
    if (!paused) return;
    const t = setTimeout(() => setStale(true), PAUSED_KEEP_MS);
    return () => clearTimeout(t);
  }, [paused, trackKey]);
  return np && !stale ? np : null;
}

export interface NotchLineView { awake: boolean; line: NotchLine | null; seenAt: number | null; aged: boolean; trackKey: number }

/**
 * The activity line, fed by every daemon message (the contract's `createActivityFeed`) and by the new tracks. `hovering`
 * holds the notch awake. The feed learns the sessions from the snapshot it is seeded with, then from the wire.
 */
export function useNotchLine({ client, sessions, dnd, hovering }: { client: DaemonClient; sessions: Session[]; dnd: boolean; hovering: boolean }) {
  const [state, setState] = useState<LineState>(() => initialLine(Date.now()));
  const dndRef = useRef(dnd); dndRef.current = dnd;
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions;
  const push = (line: NotchLine) => setState(s => pushLine(s, line, Date.now(), dndRef.current));
  const pushRef = useRef(push); pushRef.current = push;
  useEffect(() => {
    const feed = createActivityFeed();
    feed.push({ type: 'snapshot', sessions: sessionsRef.current, recents: [] } as Parameters<typeof feed.push>[0]);
    return client.onMessage(m => { const a: NotchActivity | null = feed.push(m); if (a) pushRef.current(a); });
  }, [client]);
  useEffect(() => { setState(s => hoverLine(s, hovering, Date.now())); }, [hovering]);
  const deadline = nextDeadline(state);
  useEffect(() => {
    if (deadline === null) return;
    const t = setTimeout(() => setState(s => tickLine(s, Date.now(), dndRef.current)), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(t);
  }, [deadline]);
  const view: NotchLineView = { ...lineView(state), trackKey: state.trackKey };
  return { view, pushTrack: (np: NowPlaying) => pushRef.current({ kind: 'track', title: np.title, artist: np.artist }) };
}
