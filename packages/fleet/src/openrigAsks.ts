import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HumanAnswer, HumanAsk, HumanChannel, OpenRigAnswered } from '@ledge/protocol';
import type { DaemonClient } from './client';

/** How often « À toi » asks again, besides the pushes: a restarted daemon starts following OpenRig on the next ask. */
export const OPENRIG_ASKS_POLL_MS = 60_000;

export interface OpenRigAsksView {
  /** Whether the rigs can reach the person on that machine; null until its first answer. */
  channel: HumanChannel | null;
  /** What waits on the person there: critical, then urgent, then the rest, the most recent first within each. */
  asks: readonly HumanAsk[];
  truncated: boolean;
  /** A read failed on that machine (OpenRig unreachable, a row or a source not read): the asks known before are kept, so none missing
   *  from this list is settled; an ask never read in full has its summary as body (`bodyTruncated`). */
  partial: boolean;
  /** The machine could not answer: `offline`, or `outdated` (its Ledge daemon predates « À toi »). */
  error?: 'offline' | 'outdated';
  /** Sends the person's answer; resolves with its end (`ok` false with `error` and `message` for « Pas envoyée : … »). Retrying is
   *  sending it again. */
  answer(qitemId: string, answer: HumanAnswer): Promise<OpenRigAnswered>;
  refresh(): void;
}

let next = 0;

/**
 * « À toi » on one machine (docs/vision/ledge-human-channel-contract.md): asked at once and every `pollMs`, and taken whole from
 * every push of that machine (`machine` null: nothing is asked).
 */
export function useOpenRigAsks(client: DaemonClient, machine: string | null, pollMs = OPENRIG_ASKS_POLL_MS): OpenRigAsksView {
  const [view, setView] = useState<{ machine: string | null; channel: HumanChannel | null; asks: readonly HumanAsk[]; truncated: boolean; partial: boolean; error?: 'offline' | 'outdated' }>(
    { machine, channel: null, asks: [], truncated: false, partial: false });
  const waiting = useRef(new Map<string, (a: OpenRigAnswered) => void>());
  const asked = useRef<string | null>(null);

  const ask = useCallback(() => {
    if (machine === null) return;
    const requestId = `openrig-asks-${++next}`;
    asked.current = requestId;
    client.send({ type: 'openrig.asks', requestId, machineId: machine });
  }, [client, machine]);

  useEffect(() => {
    setView({ machine, channel: null, asks: [], truncated: false, partial: false });
    if (machine === null) return;
    const off = client.onMessage(m => {
      if (m.type === 'openrig.asksChanged') {
        if ((m.machineId ?? 'local') !== machine) return;
        // An answer to an older ask is not taken over a newer one; a push always is.
        if (m.requestId !== undefined && m.requestId !== asked.current) return;
        setView(v => m.error
          ? { ...v, machine, error: m.error }
          : { machine, channel: m.channel ?? null, asks: m.asks, truncated: m.truncated === true, partial: m.partial === true });
      } else if (m.type === 'openrig.answered') {
        const resolve = waiting.current.get(m.requestId);
        if (!resolve) return;
        waiting.current.delete(m.requestId);
        resolve(m);
      }
    });
    ask();
    const timer = setInterval(ask, pollMs);
    return () => {
      off(); clearInterval(timer);
      for (const [requestId, r] of waiting.current) r({ type: 'openrig.answered', requestId, qitemId: '', ok: false, error: 'offline' });
      waiting.current.clear();
    };
  }, [client, machine, ask, pollMs]);

  const answer = useCallback((qitemId: string, a: HumanAnswer): Promise<OpenRigAnswered> => {
    if (machine === null) return Promise.resolve({ type: 'openrig.answered', requestId: '', qitemId, ok: false, error: 'offline' });
    const requestId = `openrig-answer-${++next}`;
    return new Promise<OpenRigAnswered>(resolve => {
      waiting.current.set(requestId, resolve);
      client.send({ type: 'openrig.answer', requestId, qitemId, answer: a, machineId: machine });
    });
  }, [client, machine]);

  const shown = view.machine === machine ? view : { channel: null, asks: [], truncated: false, partial: false };
  return { channel: shown.channel, asks: shown.asks, truncated: shown.truncated, partial: shown.partial, ...('error' in shown && shown.error ? { error: shown.error } : {}), answer, refresh: ask };
}

/** An ask and the machine it waits on: an answer goes back to that machine. */
export type MachineAsk = HumanAsk & { machineId: string };

/** One machine's « À toi », as `useOpenRigAsksAll` keeps it. `error`: it could not answer (its asks known before are kept). */
export interface MachineAsksState {
  channel: HumanChannel | null; asks: readonly HumanAsk[]; partial: boolean; truncated: boolean; error?: 'offline' | 'outdated';
}

export interface OpenRigAsksAllView {
  /** Every machine's asks, the pressing first (critical, then urgent), then the most recent, each with its machine. */
  asks: readonly MachineAsk[];
  /** Each machine's state, by id: its channel (whose default person, read on that machine), whether its list is partial or failed. */
  machines: Readonly<Record<string, MachineAsksState>>;
  /** True when one machine's list is partial or could not be read: an ask missing from `asks` is then not settled. */
  partial: boolean;
  answer(machineId: string, qitemId: string, answer: HumanAnswer): Promise<OpenRigAnswered>;
  refresh(): void;
}

const RANK: Record<HumanAsk['priority'], number> = { critical: 0, urgent: 1, routine: 2 };

/**
 * « À toi » across machines (lot 3): each machine in `machines` is asked at once and every `pollMs`, its pushes taken whole, and
 * its asks kept when it drops or cannot answer (marked, never settled). An answer goes to the machine that holds the ask.
 */
export function useOpenRigAsksAll(client: DaemonClient, machines: readonly string[], pollMs = OPENRIG_ASKS_POLL_MS): OpenRigAsksAllView {
  const [state, setState] = useState<Record<string, MachineAsksState>>({});
  const waiting = useRef(new Map<string, (a: OpenRigAnswered) => void>());
  const asked = useRef(new Map<string, string>());
  const key = machines.join('\n');

  const ask = useCallback(() => {
    for (const machine of key ? key.split('\n') : []) {
      const requestId = `openrig-asks-all-${++next}`;
      asked.current.set(machine, requestId);
      client.send({ type: 'openrig.asks', requestId, machineId: machine });
    }
  }, [client, key]);

  useEffect(() => {
    const wanted = new Set(key ? key.split('\n') : []);
    // A machine no longer followed leaves; the others keep what they had.
    setState(s => Object.fromEntries(Object.entries(s).filter(([id]) => wanted.has(id))));
    const off = client.onMessage(m => {
      if (m.type === 'openrig.asksChanged') {
        const machine = m.machineId ?? 'local';
        if (!wanted.has(machine)) return;
        if (m.requestId !== undefined && m.requestId !== asked.current.get(machine)) return;
        setState(s => {
          const before = s[machine] ?? { channel: null, asks: [], partial: false, truncated: false };
          return { ...s, [machine]: m.error
            ? { ...before, error: m.error }
            : { channel: m.channel ?? null, asks: m.asks, partial: m.partial === true, truncated: m.truncated === true } };
        });
      } else if (m.type === 'openrig.answered') {
        const resolve = waiting.current.get(m.requestId);
        if (!resolve) return;
        waiting.current.delete(m.requestId);
        resolve(m);
      }
    });
    ask();
    const timer = setInterval(ask, pollMs);
    return () => {
      off(); clearInterval(timer);
      for (const [requestId, r] of waiting.current) r({ type: 'openrig.answered', requestId, qitemId: '', ok: false, error: 'offline' });
      waiting.current.clear();
    };
  }, [client, key, ask, pollMs]);

  const answer = useCallback((machineId: string, qitemId: string, a: HumanAnswer): Promise<OpenRigAnswered> => {
    const requestId = `openrig-answer-all-${++next}`;
    return new Promise<OpenRigAnswered>(resolve => {
      waiting.current.set(requestId, resolve);
      client.send({ type: 'openrig.answer', requestId, qitemId, answer: a, machineId });
    });
  }, [client]);

  // Derived once per change, so a screen's effects on them do not run on every render.
  const view = useMemo(() => {
    const wanted = key ? key.split('\n') : [];
    const shown = Object.fromEntries(wanted.filter(id => state[id]).map(id => [id, state[id]!]));
    const asks = wanted.flatMap(id => (state[id]?.asks ?? []).map(a => ({ ...a, machineId: id })))
      .sort((x, y) => RANK[x.priority] - RANK[y.priority] || y.updatedAt.localeCompare(x.updatedAt));
    const partial = wanted.some(id => !state[id] || state[id]!.partial || state[id]!.error !== undefined);
    return { asks, machines: shown, partial };
  }, [state, key]);
  return { ...view, answer, refresh: ask };
}
