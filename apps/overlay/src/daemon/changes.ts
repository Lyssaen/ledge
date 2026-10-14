import type { Session } from '@ledge/protocol';
import { liveHelpers } from '@ledge/client';

export type SessionChange =
  | { kind: 'joined'; id: string }
  | { kind: 'asked'; id: string; ask: 'approval' | 'question' }
  | { kind: 'finished'; id: string }
  | { kind: 'failed'; id: string }
  | { kind: 'left'; id: string; exitCode: number | null };

/** The session waits on a request (permission or input). */
export const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
/** The same request: the same id when both carry one, else same kind, text and helper. */
export const sameRequest = (a: Session['pending'], b: Session['pending']) => !!a && !!b && (a.id !== undefined && b.id !== undefined ? a.id === b.id : a.kind === b.kind && a.text === b.text && a.helperId === b.helperId);
/** The bot reads as working: its turn runs, or it rests while helpers (subagents) still work (the bot's `working`). */
export const isBusy = (s: Session) => s.state === 'working' || (s.state === 'idle' && liveHelpers(s).length > 0);

/**
 * The one change a daemon update means for a session, or null (spec §5 and §7 ter). Pure, so the finished bubble and
 * the sound cues read the same facts: a finish is a real `working → idle` transition (a turn starts with a prompt, never
 * with SessionStart, so a launch, a /clear or a resume finishes nothing), held while helpers still work under a resting
 * parent and read when the last one stops, an ask is a request
 * that was not there before, a failure is `error` or a non-zero exit, a leave is a clean exit.
 */
export function changeOf(was: Session | undefined, now: Session): SessionChange | null {
  if (!was) return { kind: 'joined', id: now.id };
  if (now.state === 'exited' && was.state !== 'exited') {
    const code = now.exitCode ?? null;
    return code !== null && code !== 0 ? { kind: 'failed', id: now.id } : { kind: 'left', id: now.id, exitCode: code };
  }
  if (now.state === 'error' && was.state !== 'error') return { kind: 'failed', id: now.id };
  if (now.state === 'idle' && isBusy(was) && !isBusy(now)) return { kind: 'finished', id: now.id };
  if (isPending(now) && !(isPending(was) && sameRequest(was.pending, now.pending))) return { kind: 'asked', id: now.id, ask: now.state === 'waiting_permission' ? 'approval' : 'question' };
  return null;
}
