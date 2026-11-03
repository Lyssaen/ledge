import { useCallback, useEffect, useRef, useState } from 'react';
import type { Goal, OpenRigGoalReplied, OpenRigGoalSent } from '@ledge/protocol';
import type { DaemonClient } from './client';

/** How often the goals are asked again, besides the pushes. */
export const OPENRIG_GOALS_POLL_MS = 60_000;
/** How long a goal sent (or a reply) waits for its end before it is told `uncertain`: it may have gone, and sending it again is safe. */
export const OPENRIG_GOAL_WAIT_MS = 45_000;

export interface OpenRigGoalsView {
  /** The goals given to Max on that machine, the most recent first (20 at most). */
  goals: readonly Goal[];
  /** A read failed: the goals known before are kept. */
  partial: boolean;
  /** Not answered yet. */ loading: boolean;
  /** The machine could not answer: `offline`, or `outdated` (its Ledge daemon predates goals). */
  error?: 'offline' | 'outdated';
  /**
   * Sends a goal to Max; always ends. `offline`: the connection was not open, nothing left. `uncertain`: it left but its end did not
   * come back (the connection dropped, or no answer in time): send it again with the same `goalId` (the result carries it), which
   * never makes a second row. Left out, `goalId` is a new one.
   */
  send(text: string, folder?: string, goalId?: string): Promise<OpenRigGoalSent>;
  /** Writes to Max about a goal, with the same endings; the result carries the `replyId` to send again with. */
  reply(goalId: string, text: string, replyId?: string): Promise<OpenRigGoalReplied>;
  refresh(): void;
}

let next = 0;
const newId = (): string => globalThis.crypto.randomUUID();
type Ended = OpenRigGoalSent | OpenRigGoalReplied;
type Waiting = { end: (error: 'offline' | 'uncertain') => void; resolve: (m: Ended) => void; timer: ReturnType<typeof setTimeout> };

/** The goals given to Max on one machine (docs/vision/ledge-goal-contract.md): asked at once and every `pollMs`, taken whole from every push. */
export function useOpenRigGoals(client: DaemonClient, machine: string | null, pollMs = OPENRIG_GOALS_POLL_MS, waitMs = OPENRIG_GOAL_WAIT_MS): OpenRigGoalsView {
  const [view, setView] = useState<{ machine: string | null; goals: readonly Goal[]; partial: boolean; loading: boolean; error?: 'offline' | 'outdated' }>(
    { machine, goals: [], partial: false, loading: true });
  const waiting = useRef(new Map<string, Waiting>());
  const asked = useRef<string | null>(null);

  const ask = useCallback(() => {
    if (machine === null) return;
    const requestId = `openrig-goals-${++next}`;
    asked.current = requestId;
    client.send({ type: 'openrig.goals', requestId, machineId: machine });
  }, [client, machine]);

  useEffect(() => {
    setView({ machine, goals: [], partial: false, loading: true });
    if (machine === null) return;
    const off = client.onMessage(m => {
      if (m.type === 'openrig.goalsChanged') {
        if ((m.machineId ?? 'local') !== machine) return;
        if (m.requestId !== undefined && m.requestId !== asked.current) return;
        setView(v => m.error ? { ...v, machine, loading: false, error: m.error } : { machine, goals: m.goals, partial: m.partial === true, loading: false });
      } else if (m.type === 'openrig.goal.sent' || m.type === 'openrig.goal.replied') {
        const w = waiting.current.get(m.requestId);
        if (!w) return;
        waiting.current.delete(m.requestId); clearTimeout(w.timer);
        w.resolve(m);
      }
    });
    // A connection that drops while a send waits: it may have left, so it is uncertain, never « not sent ».
    const offStatus = client.onStatus(s => { if (s !== 'open') for (const w of [...waiting.current.values()]) w.end('uncertain'); });
    ask();
    const timer = setInterval(ask, pollMs);
    return () => {
      off(); offStatus(); clearInterval(timer);
      for (const w of [...waiting.current.values()]) w.end('uncertain');
    };
  }, [client, machine, ask, pollMs]);

  /** Sends `msg` and waits for its end, which always comes: the answer, or `offline` (nothing left) / `uncertain` (it may have left). */
  const wait = useCallback(<T extends Ended>(requestId: string, msg: Parameters<DaemonClient['send']>[0], ended: (error: 'offline' | 'uncertain') => T): Promise<T> =>
    new Promise<T>(resolve => {
      if (client.status() !== 'open') return resolve(ended('offline'));
      const end = (error: 'offline' | 'uncertain') => {
        const w = waiting.current.get(requestId);
        if (!w) return;
        waiting.current.delete(requestId); clearTimeout(w.timer);
        resolve(ended(error));
      };
      waiting.current.set(requestId, { end, resolve: m => resolve(m as T), timer: setTimeout(() => end('uncertain'), waitMs) });
      client.send(msg);
    }), [client, waitMs]);

  const send = useCallback((text: string, folder?: string, goalId: string = newId()): Promise<OpenRigGoalSent> => {
    const requestId = `openrig-goal-${++next}`;
    const ended = (error: 'offline' | 'uncertain'): OpenRigGoalSent => ({ type: 'openrig.goal.sent', requestId, goalId, ok: false, error });
    if (machine === null) return Promise.resolve(ended('offline'));
    return wait(requestId, { type: 'openrig.goal.send', requestId, machineId: machine, goalId, text, ...(folder ? { folder } : {}) }, ended);
  }, [machine, wait]);

  const reply = useCallback((goalId: string, text: string, replyId: string = newId()): Promise<OpenRigGoalReplied> => {
    const requestId = `openrig-goal-reply-${++next}`;
    const ended = (error: 'offline' | 'uncertain'): OpenRigGoalReplied => ({ type: 'openrig.goal.replied', requestId, goalId, replyId, ok: false, error });
    if (machine === null) return Promise.resolve(ended('offline'));
    return wait(requestId, { type: 'openrig.goal.reply', requestId, machineId: machine, goalId, replyId, text }, ended);
  }, [machine, wait]);

  const shown = view.machine === machine ? view : { goals: [], partial: false, loading: true };
  return { goals: shown.goals, partial: shown.partial, loading: shown.loading, ...('error' in shown && shown.error ? { error: shown.error } : {}), send, reply, refresh: ask };
}
