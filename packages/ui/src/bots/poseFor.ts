import type { Session, SessionState } from '@ledge/protocol';
import { liveHelpers } from '@ledge/fleet/changes';

/** The expression a bot shows. `readonly` is only a fallback for an unknown expression, never a replacement for a known one. */
export type BotState = 'starting' | 'working' | 'question' | 'approval' | 'idle' | 'done' | 'error' | 'readonly';

const FROM_SESSION: Record<SessionState, BotState> = {
  starting: 'starting',
  working: 'working',
  waiting_input: 'question',
  waiting_permission: 'approval',
  idle: 'idle',
  exited: 'done',
  error: 'error'
};

/** The helpers (subagents) still running under a session; defined in the fleet, re-exported for the bots' importers. */
export { liveHelpers };

/**
 * Exited always reads as `done` (still, eyes closed); a nonzero exit code belongs to the badge and text.
 * The daemon rests a parent whose main thread ended its turn even while a background helper still works: the bot keeps working.
 */
export function botState(session: Session): BotState {
  if (session.state === 'idle' && liveHelpers(session).length > 0) return 'working';
  return FROM_SESSION[session.state];
}

/** Stable 32-bit hash of a session/helper ID; the same function seeds the ambient motion. */
export function seedHash(seed: string): number {
  let h = 7;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** One of three sober tilt variants, deterministic from the stable ID (never the display name) and the state. */
export function poseFor(seed: string, state: SessionState | BotState): 1 | 2 | 3 {
  return ((seedHash(`${seed}:${state}`) % 3) + 1) as 1 | 2 | 3;
}
