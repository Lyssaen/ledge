import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@ledge/protocol';
import type { DaemonError } from '../daemon/store';
import type { DaemonStatus } from '../daemon/client';
import type { SurfaceEvent } from './machine';
import { useI18n } from '../i18n/lang';
import { changeOf, type SessionChange } from '../daemon/changes';

export const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
/** A request the surface still tracks: waiting, or failed (state `error`) with its request kept for a retry. */
const tracked = (s: Session) => !!s.pending && (isPending(s) || s.state === 'error');
const sameRequest = (a: Session['pending'], b: Session['pending']) => !!a && !!b && a.kind === b.kind && a.text === b.text && a.helperId === b.helperId;

/**
 * Turns daemon updates into machine events (ask, askCleared, askReplaced, removed, decisionFailed) and owns the
 * transport-side lock of decisions: one command per request until the daemon confirms it (request gone), fails it
 * (a transition into state `error`, or an `error` reply for that id) or the connection drops. No timer ever resolves a
 * decision. Every `error` reply that names a session is shown as that session's failure (the daemon only sends them in
 * answer to this client's commands), and a rejected free-text reply hands its text back through `onReplyRejected`.
 */
export function useDaemonAsks(o: { sessions: Session[]; status: DaemonStatus; lastError: DaemonError | null; dnd: boolean; dispatch: (e: SurfaceEvent) => void; finishedBubble: boolean; onChange?: (c: SessionChange, info: { elapsedMs?: number }) => void; onReplyRejected?: (id: string, text: string) => void }) {
  const { sessions, status, lastError, dnd, dispatch, finishedBubble } = o;
  const { t } = useI18n();
  const msg = useRef(t); msg.current = t;
  const prev = useRef<Map<string, Session>>(new Map());
  /** Decisions in flight. */
  const lock = useRef<Set<string>>(new Set());
  /** The text of the last reply sent per session, until the daemon rejects it or another command supersedes it. */
  const replies = useRef<Map<string, string>>(new Map());
  const onRejected = useRef(o.onReplyRejected);
  onRejected.current = o.onReplyRejected;
  const onChange = useRef(o.onChange);
  onChange.current = o.onChange;
  /** When each bot last set to work from rest, for the finished cue's elapsed time. */
  const workingSince = useRef<Map<string, number>>(new Map());
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const sync = () => setInFlight(new Set(lock.current));
  const release = (id: string) => { if (lock.current.delete(id)) sync(); };
  const clearFailure = (id: string) => setFailures(f => { if (!(id in f)) return f; const { [id]: _gone, ...rest } = f; return rest; });
  /** The request was resolved, replaced or removed: its failure text no longer applies. */
  const forget = (id: string) => { release(id); replies.current.delete(id); clearFailure(id); };
  const fail = (id: string, why: string) => {
    release(id);
    setFailures(f => (f[id] === why ? f : { ...f, [id]: why }));
    dispatch({ type: 'decisionFailed', id });
  };

  useEffect(() => {
    const before = prev.current;
    const now = new Map(sessions.map(s => [s.id, s]));
    const ids = [...now.keys()];
    for (const id of before.keys()) if (!now.has(id)) { forget(id); workingSince.current.delete(id); dispatch({ type: 'removed', id, remaining: ids }); }
    for (const s of sessions) {
      const was = before.get(s.id);
      const change = changeOf(was, s);
      // The turn clock starts when a bot sets to work from rest; a permission answered mid-turn does not restart it.
      if (s.state === 'working' && (!was || was.state === 'idle' || was.state === 'starting')) workingSince.current.set(s.id, Date.now());
      if (change) {
        const since = workingSince.current.get(s.id);
        const elapsedMs = change.kind === 'finished' && since !== undefined ? Date.now() - since : undefined;
        if (change.kind === 'finished') workingSince.current.delete(s.id);
        onChange.current?.(change, { elapsedMs });
        if (change.kind === 'finished' && finishedBubble && !dnd) dispatch({ type: 'finished', id: s.id });
      }
      const wasTracked = !!was && tracked(was);
      // A fresh request: whatever failed before it (a rejected reply, say) no longer applies.
      if (isPending(s) && !wasTracked) { if (was) clearFailure(s.id); if (!dnd) dispatch({ type: 'ask', id: s.id }); }
      else if (wasTracked && !tracked(s)) { forget(s.id); dispatch({ type: 'askCleared', id: s.id }); }
      // A new request replaced the old one in place: the old decision is moot, the new request starts unlocked.
      else if (wasTracked && !sameRequest(was!.pending, s.pending)) { forget(s.id); dispatch({ type: 'askReplaced', id: s.id }); }
      // Into `error` with the request kept: the injection failed. A retry from `error` that fails again stays in `error`;
      // the daemon then answers with an `error` reply for that id (handled below).
      else if (wasTracked && tracked(s) && s.state === 'error' && was!.state !== 'error')
        fail(s.id, s.lastError ?? msg.current.notTaken);
    }
    prev.current = now;
  }, [sessions, dnd, finishedBubble, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps -- release/fail only touch refs and setters

  // An `error` reply about a decision in flight fails it (the surface shows why and unlocks the actions); about any other
  // command for a session (a reply to an idle session, say) it is shown as that session's failure. A rejected reply
  // gives its text back so the draft is not lost.
  useEffect(() => {
    const id = lastError?.id; if (!id) return;
    const text = replies.current.get(id);
    if (text !== undefined) { replies.current.delete(id); onRejected.current?.(id, text); }
    if (lock.current.has(id)) fail(id, lastError.message);
    else setFailures(f => (f[id] === lastError.message ? f : { ...f, [id]: lastError.message }));
  }, [lastError?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // A dropped connection leaves every decision in flight unresolved: unlock them; the next snapshot tells what happened.
  useEffect(() => {
    if (status !== 'unreachable') return;
    for (const id of [...lock.current]) fail(id, msg.current.lost);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Takes the lock for a decision on `id`; false when one is already in flight (a double click sends one command). */
  const begin = useCallback((id: string): boolean => {
    if (lock.current.has(id)) return false;
    lock.current.add(id); sync();
    replies.current.delete(id); clearFailure(id);
    return true;
  }, []);

  /** Records a typed reply sent for `id` (after `begin` when it answers a request): an `error` reply gives it back. */
  const replied = useCallback((id: string, text: string) => { replies.current.set(id, text); clearFailure(id); }, []);

  return { inFlight, failures, begin, replied };
}
