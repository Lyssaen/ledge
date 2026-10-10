import type { Session } from '@ledge/protocol';

export type SessionChange =
  | { kind: 'joined'; id: string }
  | { kind: 'asked'; id: string; ask: 'approval' | 'question' }
  | { kind: 'finished'; id: string }
  | { kind: 'failed'; id: string }
  | { kind: 'left'; id: string; exitCode: number | null };

/** The session waits on a request (permission or input). */
export const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
/** The same request: same kind, text and helper. */
export const sameRequest = (a: Session['pending'], b: Session['pending']) => !!a && !!b && a.kind === b.kind && a.text === b.text && a.helperId === b.helperId;

/**
 * The one change a daemon update means for a session, or null (spec §5 and §7 ter). Pure, so the finished bubble and
 * the sound cues read the same facts: a finish is a real `working → idle` transition (a turn starts with a prompt, never
 * with SessionStart, so a launch, a /clear or a resume finishes nothing), an ask is a request
 * that was not there before, a failure is `error` or a non-zero exit, a leave is a clean exit.
 */
export function changeOf(was: Session | undefined, now: Session): SessionChange | null {
  if (!was) return { kind: 'joined', id: now.id };
  if (now.state === 'exited' && was.state !== 'exited') {
    const code = now.exitCode ?? null;
    return code !== null && code !== 0 ? { kind: 'failed', id: now.id } : { kind: 'left', id: now.id, exitCode: code };
  }
  if (now.state === 'error' && was.state !== 'error') return { kind: 'failed', id: now.id };
  if (now.state === 'idle' && was.state === 'working') return { kind: 'finished', id: now.id };
  if (isPending(now) && !(isPending(was) && sameRequest(was.pending, now.pending))) return { kind: 'asked', id: now.id, ask: now.state === 'waiting_permission' ? 'approval' : 'question' };
  return null;
}
