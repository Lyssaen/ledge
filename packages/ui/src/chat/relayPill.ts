import type { Session } from '@ledge/protocol';

export type RelayPill = 'yours' | 'working' | 'waiting' | 'stopped';

/**
 * The relay card's target as the card words it, on the PC and the phone alike: your turn, working, waiting for you, or stopped
 * (gone, exited, error). A session at rest whose helpers still work is working, as its bot shows it.
 */
export function relayPill(s: Pick<Session, 'state' | 'helpers'> | undefined): RelayPill {
  if (!s || s.state === 'exited' || s.state === 'error') return 'stopped';
  if (s.state === 'waiting_input' || s.state === 'waiting_permission') return 'waiting';
  return s.state === 'idle' && !s.helpers.some(h => h.state !== 'exited' && h.state !== 'idle') ? 'yours' : 'working';
}
