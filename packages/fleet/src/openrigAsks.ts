import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HumanAnswer, HumanAsk, HumanChannel, OpenRigAnswered } from '@ledge/protocol';
import type { DaemonClient } from './client';

/** How often « À toi » asks again, besides the pushes: a restarted daemon starts following OpenRig on the next ask. */
export const OPENRIG_ASKS_POLL_MS = 60_000;
/** How long an answer waits for its end before it is told `uncertain`: it may have gone, and sending it again is safe. */
export const OPENRIG_ANSWER_WAIT_MS = 45_000;

type AnswerWait = { qitemId: string; machineId: string; resolve: (a: OpenRigAnswered) => void; timer: ReturnType<typeof setTimeout> };

/**
 * The answers on their way, by requestId, for one client: each always ends. `offline`: the connection (or the machine, in a fleet) was
 * not up, nothing left. `uncertain`: it left but its end did not come back (the connection dropped, nothing in `waitMs`, the screen
 * left): sending the same answer again is safe, OpenRig records an answer once. Lives as long as the client, whatever machines a
 * screen follows meanwhile.
 */
function useAnswers(client: DaemonClient, waitMs: number) {
  const waiting = useRef(new Map<string, AnswerWait>());
  const end = (requestId: string, m: OpenRigAnswered) => {
    const w = waiting.current.get(requestId);
    if (!w) return;
    waiting.current.delete(requestId); clearTimeout(w.timer);
    w.resolve(m);
  };
  const lost = (requestId: string, w: AnswerWait, error: 'offline' | 'uncertain') =>
    end(requestId, { type: 'openrig.answered', requestId, machineId: w.machineId, qitemId: w.qitemId, ok: false, error });
  useEffect(() => {
    const off = client.onMessage(m => { if (m.type === 'openrig.answered') end(m.requestId, m); });
    const offStatus = client.onStatus(s => { if (s !== 'open') for (const [id, w] of [...waiting.current]) lost(id, w, 'uncertain'); });
    return () => { off(); offStatus(); for (const [id, w] of [...waiting.current]) lost(id, w, 'uncertain'); };
  }, [client]);
  return useCallback((machineId: string, qitemId: string, a: HumanAnswer): Promise<OpenRigAnswered> => {
    const requestId = `openrig-answer-${++next}`;
    const down = client.status() !== 'open' || (client.fleet ? client.fleet.machines().find(x => x.id === machineId)?.status !== 'open' : false);
    if (down) return Promise.resolve({ type: 'openrig.answered', requestId, machineId, qitemId, ok: false, error: 'offline' });
    return new Promise<OpenRigAnswered>(resolve => {
      const w: AnswerWait = { qitemId, machineId, resolve, timer: setTimeout(() => lost(requestId, w, 'uncertain'), waitMs) };
      waiting.current.set(requestId, w);
      client.send({ type: 'openrig.answer', requestId, qitemId, answer: a, machineId });
    });
  }, [client, waitMs]);
}

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
export function useOpenRigAsks(client: DaemonClient, machine: string | null, pollMs = OPENRIG_ASKS_POLL_MS, waitMs = OPENRIG_ANSWER_WAIT_MS): OpenRigAsksView {
  const [view, setView] = useState<{ machine: string | null; channel: HumanChannel | null; asks: readonly HumanAsk[]; truncated: boolean; partial: boolean; error?: 'offline' | 'outdated' }>(
    { machine, channel: null, asks: [], truncated: false, partial: false });
  const send = useAnswers(client, waitMs);
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
      }
    });
    ask();
    const timer = setInterval(ask, pollMs);
    return () => { off(); clearInterval(timer); };
  }, [client, machine, ask, pollMs]);

  const answer = useCallback((qitemId: string, a: HumanAnswer): Promise<OpenRigAnswered> => {
    if (machine === null) return Promise.resolve({ type: 'openrig.answered', requestId: '', qitemId, ok: false, error: 'offline' });
    return send(machine, qitemId, a);
  }, [machine, send]);

  const shown = view.machine === machine ? view : { channel: null, asks: [], truncated: false, partial: false };
  return { channel: shown.channel, asks: shown.asks, truncated: shown.truncated, partial: shown.partial, ...('error' in shown && shown.error ? { error: shown.error } : {}), answer, refresh: ask };
}

/** An ask and the machine it waits on: an answer goes back to that machine. */
export type MachineAsk = HumanAsk & { machineId: string };

/** One machine's « À toi », as `useOpenRigAsksAll` keeps it. `error`: it could not answer, or is not connected now (its asks known
 *  before are kept). */
export interface MachineAsksState {
  channel: HumanChannel | null; asks: readonly HumanAsk[]; partial: boolean; truncated: boolean; error?: 'offline' | 'outdated';
}

export interface OpenRigAsksAllView {
  /** Every machine's asks, the pressing first (critical, then urgent), then the most recent, each with its machine. */
  asks: readonly MachineAsk[];
  /** Each machine's state, by id: its channel (whose default person, read on that machine), whether its list is partial or failed. */
  machines: Readonly<Record<string, MachineAsksState>>;
  /** True when one machine's list is partial, not heard yet, or not reachable: an ask missing from `asks` is then not settled. */
  partial: boolean;
  /** Sends an answer to the machine that holds the ask; always ends (`offline`: nothing left; `uncertain`: it may have, send again). */
  answer(machineId: string, qitemId: string, answer: HumanAnswer): Promise<OpenRigAnswered>;
  refresh(): void;
}

const RANK: Record<HumanAsk['priority'], number> = { critical: 0, urgent: 1, routine: 2 };

/**
 * « À toi » across machines (lot 3): each machine in `machines` is asked at once and every `pollMs`, its pushes taken whole, and
 * its asks kept when it drops or cannot answer (marked, never settled). In a fleet, a machine's connection is watched too: one that
 * drops is marked at once, and asked again when it is back. An answer goes to the machine that holds the ask.
 */
export function useOpenRigAsksAll(client: DaemonClient, machines: readonly string[], pollMs = OPENRIG_ASKS_POLL_MS, waitMs = OPENRIG_ANSWER_WAIT_MS): OpenRigAsksAllView {
  const [state, setState] = useState<Record<string, MachineAsksState>>({});
  const answer = useAnswers(client, waitMs);
  const asked = useRef(new Map<string, string>());
  const key = machines.join('\n');

  const askOne = useCallback((machine: string) => {
    const requestId = `openrig-asks-all-${++next}`;
    asked.current.set(machine, requestId);
    client.send({ type: 'openrig.asks', requestId, machineId: machine });
  }, [client]);
  const ask = useCallback(() => { for (const machine of key ? key.split('\n') : []) askOne(machine); }, [key, askOne]);

  useEffect(() => {
    const wanted = new Set(key ? key.split('\n') : []);
    // A machine no longer followed leaves; the others keep what they had.
    setState(s => Object.fromEntries(Object.entries(s).filter(([id]) => wanted.has(id))));
    const blank: MachineAsksState = { channel: null, asks: [], partial: false, truncated: false };
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.asksChanged') return;
      const machine = m.machineId ?? 'local';
      if (!wanted.has(machine)) return;
      if (m.requestId !== undefined && m.requestId !== asked.current.get(machine)) return;
      setState(s => ({ ...s, [machine]: m.error
        ? { ...(s[machine] ?? blank), error: m.error }
        : { channel: m.channel ?? null, asks: m.asks, partial: m.partial === true, truncated: m.truncated === true } }));
    });
    // A machine whose connection drops between two reads is marked now, not at the next poll; back, it is asked again.
    const down = new Set<string>();
    const watch = () => {
      for (const mc of client.fleet?.machines() ?? []) {
        if (!wanted.has(mc.id)) continue;
        if (mc.status !== 'open') {
          if (down.has(mc.id)) continue;
          down.add(mc.id);
          setState(s => ({ ...s, [mc.id]: { ...(s[mc.id] ?? blank), error: 'offline' } }));
        } else if (down.delete(mc.id)) askOne(mc.id);
      }
    };
    const offFleet = client.fleet?.subscribe(watch);
    watch();
    ask();
    const timer = setInterval(ask, pollMs);
    return () => { off(); offFleet?.(); clearInterval(timer); };
  }, [client, key, ask, askOne, pollMs]);

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
