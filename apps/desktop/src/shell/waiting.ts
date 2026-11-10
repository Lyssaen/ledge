import type { Session } from '@ledge/protocol';
import type { Wait } from '../list/time';
import { dotOf } from '../nav/agents';

const ms = (iso: string) => Date.parse(iso) || 0;

/** The sessions that wait for the user (permission or question, not offline), the oldest wait first: since the wait began
 *  (the shell's `waits`, as the List's « depuis »), else the last activity. */
export function waitingSessions(sessions: readonly Session[], waits: ReadonlyMap<string, Wait>): Session[] {
  const since = (s: Session) => ms(waits.get(s.id)?.since ?? s.lastActivityAt);
  return sessions.filter(s => { const d = dotOf(s); return d === 'approval' || d === 'question'; }).sort((a, b) => since(a) - since(b));
}
