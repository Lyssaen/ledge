import { useEffect, useRef } from 'react';
import type { SessionChange } from '../daemon/changes';
import type { DaemonStatus } from '../daemon/client';
import { foregroundIsTerminal } from '../tauri/bridge';
import { decideSound } from './decide';
import type { Cue } from './cues';
import type { SoundPlayer } from './player';
import { VOLUME_GAIN, useSoundPrefs } from './preferences';

const cueOf = (c: SessionChange): Cue | null => {
  switch (c.kind) {
    case 'asked': return c.ask === 'approval' ? 'approval' : 'question';
    case 'finished': return 'finished';
    case 'failed': return 'error';
    case 'joined': return 'join';
    case 'left': return 'leave';
  }
};

/**
 * Turns session changes and the user's decisions into cues through `decideSound` (spec §7 ter). Owns the two clocks the
 * decision needs: the last cue played and the moment the daemon connected. The terminal check is async (a Tauri command),
 * so a cue is decided once that answer is in; nothing visual ever waits for it.
 */
export function useSounds(o: { player: SoundPlayer; dnd: boolean; status: DaemonStatus; terminalInFront?: () => Promise<boolean> }) {
  const { finished, sounds } = useSoundPrefs();
  const live = useRef({ player: o.player, dnd: o.dnd, finished, sounds, check: o.terminalInFront ?? foregroundIsTerminal });
  live.current = { player: o.player, dnd: o.dnd, finished, sounds, check: o.terminalInFront ?? foregroundIsTerminal };
  const lastPlayedAt = useRef<number | null>(null);
  const connectedAt = useRef<number | null>(null);
  const prevStatus = useRef(o.status);

  const play = (cue: Cue) => {
    const l = live.current;
    const needsCheck = l.sounds.onlyWhenTerminalBehind && cue !== 'accept' && cue !== 'deny';
    void (needsCheck ? l.check() : Promise.resolve(false)).then(front => {
      const now = Date.now();
      const d = decideSound({ cue, sounds: l.sounds, finished: l.finished, dnd: l.dnd, terminalInFront: front, lastPlayedAt: lastPlayedAt.current, connectedAt: connectedAt.current, now });
      if (!d.play) return;
      if (cue !== 'accept' && cue !== 'deny') lastPlayedAt.current = now;   // a tick of yours never silences the next ask
      l.player.play(cue, d.gain);
    });
  };
  // The daemon lost (spec §7 ter, Échec): once per outage, on open -> unreachable only; retries and the reconnection are silent.
  useEffect(() => {
    const was = prevStatus.current; prevStatus.current = o.status;
    if (o.status === 'open') connectedAt.current = Date.now();
    if (was === 'open' && o.status === 'unreachable') play('error');
  }, [o.status]); // eslint-disable-line react-hooks/exhaustive-deps -- play reads the live ref
  return {
    onChange: (c: SessionChange) => { const cue = cueOf(c); if (cue) play(cue); },
    user: (cue: 'accept' | 'deny') => play(cue),
    /** The settings' Test button: the question cue, through the volume only (no DND, category or terminal cut). */
    test: () => { const l = live.current; l.player.play('question', VOLUME_GAIN[l.sounds.volume]); }
  };
}
