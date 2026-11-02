import { useCallback, useEffect, useRef, useState } from 'react';
import type { Goal, OpenRigGoalReplied, OpenRigGoalSent } from '@ledge/protocol';
import type { DaemonClient } from './client';

/** How often the goals are asked again, besides the pushes. */
export const OPENRIG_GOALS_POLL_MS = 60_000;

export interface OpenRigGoalsView {
  /** The goals given to Max on that machine, the most recent first (20 at most). */
  goals: readonly Goal[];
  /** A read failed: the goals known before are kept. */
  partial: boolean;
  /** Not answered yet. */ loading: boolean;
  /** The machine could not answer: `offline`, or `outdated` (its Ledge daemon predates goals). */
  error?: 'offline' | 'outdated';
  /** Sends a goal to Max. `goalId`: pass the one a failed send returned to retry it (never a second row); left out, a new one. */
  send(text: string, folder?: string, goalId?: string): Promise<OpenRigGoalSent>;
  /** Writes to Max about a goal. `replyId`: as `goalId`, for a retry. */
  reply(goalId: string, text: string, replyId?: string): Promise<OpenRigGoalReplied>;
  refresh(): void;
}

let next = 0;
const newId = (): string => globalThis.crypto.randomUUID();

/** The goals given to Max on one machine (docs/vision/ledge-goal-contract.md): asked at once and every `pollMs`, taken whole from every push. */
export function useOpenRigGoals(client: DaemonClient, machine: string | null, pollMs = OPENRIG_GOALS_POLL_MS): OpenRigGoalsView {
  const [view, setView] = useState<{ machine: string | null; goals: readonly Goal[]; partial: boolean; loading: boolean; error?: 'offline' | 'outdated' }>(
    { machine, goals: [], partial: false, loading: true });
  const waiting = useRef(new Map<string, { goalId: string; reply: boolean; resolve: (m: OpenRigGoalSent | OpenRigGoalReplied) => void }>());
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
        waiting.current.delete(m.requestId);
        w.resolve(m);
      }
    });
    ask();
    const timer = setInterval(ask, pollMs);
    return () => {
      off(); clearInterval(timer);
      for (const [requestId, w] of waiting.current) w.resolve({ type: w.reply ? 'openrig.goal.replied' : 'openrig.goal.sent', requestId, goalId: w.goalId, ok: false, error: 'offline' });
      waiting.current.clear();
    };
  }, [client, machine, ask, pollMs]);

  const send = useCallback((text: string, folder?: string, goalId: string = newId()): Promise<OpenRigGoalSent> => {
    if (machine === null) return Promise.resolve({ type: 'openrig.goal.sent', requestId: '', goalId, ok: false, error: 'offline' });
    const requestId = `openrig-goal-${++next}`;
    return new Promise(resolve => {
      waiting.current.set(requestId, { goalId, reply: false, resolve: m => resolve(m as OpenRigGoalSent) });
      client.send({ type: 'openrig.goal.send', requestId, machineId: machine, goalId, text, ...(folder ? { folder } : {}) });
    });
  }, [client, machine]);

  const reply = useCallback((goalId: string, text: string, replyId: string = newId()): Promise<OpenRigGoalReplied> => {
    if (machine === null) return Promise.resolve({ type: 'openrig.goal.replied', requestId: '', goalId, ok: false, error: 'offline' });
    const requestId = `openrig-goal-reply-${++next}`;
    return new Promise(resolve => {
      waiting.current.set(requestId, { goalId, reply: true, resolve: m => resolve(m as OpenRigGoalReplied) });
      client.send({ type: 'openrig.goal.reply', requestId, machineId: machine, goalId, replyId, text });
    });
  }, [client, machine]);

  const shown = view.machine === machine ? view : { goals: [], partial: false, loading: true };
  return { goals: shown.goals, partial: shown.partial, loading: shown.loading, ...('error' in shown && shown.error ? { error: shown.error } : {}), send, reply, refresh: ask };
}
