import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@ledge/protocol';
import type { DaemonError } from '../daemon/store';
import type { DaemonStatus } from '../daemon/client';
import type { SurfaceEvent } from './machine';

export const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
/** A request the surface still tracks: waiting, or failed (state `error`) with its request kept for a retry. */
const tracked = (s: Session) => !!s.pending && (isPending(s) || s.state === 'error');
const sameRequest = (a: Session['pending'], b: Session['pending']) => !!a && !!b && a.kind === b.kind && a.text === b.text && a.helperId === b.helperId;
const LOST = 'The connection dropped before the terminal answered';

/**
 * Turns daemon updates into machine events (ask, askCleared, removed, decisionFailed) and owns the transport-side lock
 * of decisions: one command per request until the daemon confirms it (request gone), fails it (state `error` or an
 * `error` reply for that id) or the connection drops. No timer ever resolves a decision.
 */
export function useDaemonAsks(o: { sessions: Session[]; status: DaemonStatus; lastError: DaemonError | null; dnd: boolean; dispatch: (e: SurfaceEvent) => void }) {
  const { sessions, status, lastError, dnd, dispatch } = o;
  const prev = useRef<Map<string, Session>>(new Map());
  const lock = useRef<Set<string>>(new Set());
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const sync = () => setInFlight(new Set(lock.current));
  const release = (id: string) => { if (lock.current.delete(id)) sync(); };
  const fail = (id: string, why: string) => {
    release(id);
    setFailures(f => (f[id] === why ? f : { ...f, [id]: why }));
    dispatch({ type: 'decisionFailed', id });
  };

  useEffect(() => {
    const before = prev.current;
    const now = new Map(sessions.map(s => [s.id, s]));
    const ids = [...now.keys()];
    for (const id of before.keys()) if (!now.has(id)) { release(id); dispatch({ type: 'removed', id, remaining: ids }); }
    for (const s of sessions) {
      const was = before.get(s.id);
      const wasTracked = !!was && tracked(was);
      if (isPending(s) && !wasTracked && !dnd) dispatch({ type: 'ask', id: s.id });
      else if (wasTracked && tracked(s) && s.state === 'error' && was!.state !== 'error') fail(s.id, s.lastError ?? 'The terminal did not take it');
      else if (wasTracked && !tracked(s)) { release(s.id); dispatch({ type: 'askCleared', id: s.id }); }
      else if (wasTracked && !sameRequest(was!.pending, s.pending)) release(s.id); // a new request replaced the old one
    }
    prev.current = now;
  }, [sessions, dnd, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps -- release/fail only touch refs and setters

  // An `error` reply about a decision in flight fails it (the surface shows why and unlocks the actions).
  useEffect(() => {
    if (lastError?.id && lock.current.has(lastError.id)) fail(lastError.id, lastError.message);
  }, [lastError?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // A dropped connection leaves every decision in flight unresolved: unlock them; the next snapshot tells what happened.
  useEffect(() => {
    if (status !== 'unreachable') return;
    for (const id of [...lock.current]) fail(id, LOST);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Takes the lock for a decision on `id`; false when one is already in flight (a double click sends one command). */
  const begin = useCallback((id: string): boolean => {
    if (lock.current.has(id)) return false;
    lock.current.add(id); sync();
    setFailures(f => { if (!(id in f)) return f; const { [id]: _gone, ...rest } = f; return rest; });
    return true;
  }, []);

  return { inFlight, failures, begin };
}
