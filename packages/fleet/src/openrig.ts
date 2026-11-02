import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenRigAction, OpenRigDone, OpenRigLaunched, OpenRigState, RigLaunch, RigSpec } from '@ledge/protocol';
import type { DaemonClient } from './client';

/** How often a screen that shows a machine's OpenRig asks it again. */
export const OPENRIG_POLL_MS = 5_000;

export interface OpenRigView {
  /** The machine's OpenRig as last read; null until its first answer. */
  state: OpenRigState | null;
  /** The machine could not answer: `offline`, or `outdated` (its Ledge daemon does not know OpenRig). */
  error?: 'offline' | 'outdated';
  /** The action running on that machine from this front, if any. */
  pending: OpenRigAction | null;
  /** The last action's end, until the next one starts. */
  last: OpenRigDone | null;
  /** Runs an action on the machine; resolves with its end (`ok` false and `error` `busy` when one already runs). */
  act(action: OpenRigAction): Promise<OpenRigDone>;
  /** Asks again now. */
  refresh(): void;
}

let next = 0;

/**
 * A machine's OpenRig, read every `OPENRIG_POLL_MS` while the screen is shown (`machine` null: nothing is asked), and the
 * actions run on it. A state an action broadcasts, from this front or another, is taken at once.
 */
export function useOpenRig(client: DaemonClient, machine: string | null, pollMs = OPENRIG_POLL_MS): OpenRigView {
  const [view, setView] = useState<{ machine: string | null; state: OpenRigState | null; error?: 'offline' | 'outdated' }>({ machine, state: null });
  const [pending, setPending] = useState<OpenRigAction | null>(null);
  const [last, setLast] = useState<OpenRigDone | null>(null);
  const waiting = useRef(new Map<string, (d: OpenRigDone) => void>());
  const asked = useRef<string | null>(null);

  const ask = useCallback(() => {
    if (machine === null) return;
    const requestId = `openrig-${++next}`;
    asked.current = requestId;
    client.send({ type: 'openrig.status', requestId, machineId: machine });
  }, [client, machine]);

  useEffect(() => {
    setView({ machine, state: null }); setPending(null); setLast(null);
    if (machine === null) return;
    const off = client.onMessage(m => {
      if (m.type === 'openrig.state') {
        if ((m.machineId ?? 'local') !== machine) return;
        // An answer to an older ask of this screen is not taken over a newer one; a broadcast always is.
        if (m.requestId !== undefined && m.requestId !== asked.current) return;
        setView(v => ({ machine, state: m.state ?? (m.error ? null : v.state), ...(m.error ? { error: m.error } : {}) }));
      } else if (m.type === 'openrig.done') {
        const resolve = waiting.current.get(m.requestId);
        if (!resolve) return;
        waiting.current.delete(m.requestId);
        resolve(m);
      }
    });
    ask();
    const timer = setInterval(ask, pollMs);
    return () => { off(); clearInterval(timer); for (const [, r] of waiting.current) r({ type: 'openrig.done', requestId: '', ok: false, commands: [], error: 'cancelled' }); waiting.current.clear(); };
  }, [client, machine, ask, pollMs]);

  const act = useCallback((action: OpenRigAction): Promise<OpenRigDone> => {
    if (machine === null) return Promise.resolve({ type: 'openrig.done', requestId: '', ok: false, commands: [], error: 'offline' });
    const requestId = `openrig-act-${++next}`;
    setPending(action); setLast(null);
    return new Promise<OpenRigDone>(resolve => {
      waiting.current.set(requestId, d => { setPending(p => (p === action ? null : p)); setLast(d); resolve(d); });
      client.send({ type: 'openrig.act', requestId, action, machineId: machine });
    });
  }, [client, machine]);

  const shown = view.machine === machine ? view : { state: null };
  return { state: shown.state, ...('error' in shown && shown.error ? { error: shown.error } : {}), pending, last, act, refresh: ask };
}

export interface RigSpecsView { status: 'idle' | 'loading' | 'ready'; specs: readonly RigSpec[]; error?: string; reload(): void }

/** The machine's rig specs, asked once per machine (and again on `reload`): `error` `daemon_stopped` while OpenRig is off. */
export function useRigSpecs(client: DaemonClient, machine: string | null): RigSpecsView {
  const [answer, setAnswer] = useState<{ machine: string; specs: readonly RigSpec[]; error?: string } | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (machine === null) return;
    const requestId = `openrig-specs-${++next}`;
    setAnswer(a => (a?.machine === machine ? a : null));
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.specList' || m.requestId !== requestId) return;
      setAnswer({ machine, specs: m.specs, ...(m.error ? { error: m.error } : {}) });
    });
    client.send({ type: 'openrig.specs', requestId, machineId: machine });
    return off;
  }, [client, machine, round]);
  const reload = useCallback(() => setRound(r => r + 1), []);
  if (machine === null) return { status: 'idle', specs: [], reload };
  if (!answer || answer.machine !== machine) return { status: 'loading', specs: [], reload };
  return { status: 'ready', specs: answer.specs, ...(answer.error ? { error: answer.error } : {}), reload };
}

/** Checks (`plan`) or launches a rig on a machine; resolves with its end. */
export function launchRig(client: DaemonClient, machine: string, launch: RigLaunch): Promise<OpenRigLaunched> {
  const requestId = `openrig-launch-${++next}`;
  return new Promise(resolve => {
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.launched' || m.requestId !== requestId) return;
      off(); resolve(m);
    });
    client.send({ type: 'openrig.launch', requestId, launch, machineId: machine });
  });
}
