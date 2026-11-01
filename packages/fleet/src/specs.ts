import { useCallback, useEffect, useState } from 'react';
import type { DaemonClient } from './client';
import type { RigSpecInfo } from '@ledge/protocol';

export interface RigSpecsState { status: 'idle' | 'loading' | 'ready'; specs: readonly RigSpecInfo[]; error?: string }
const IDLE: RigSpecsState = { status: 'idle', specs: [] };
const LOADING: RigSpecsState = { status: 'loading', specs: [] };
/** Successful answers already received this run, per machine: the Specs tab opened again shows them at once. */
const known = new Map<string, RigSpecsState>();
let next = 0;

/** The rig specs a machine offers (OpenRig library, registry, built-ins): one `rig.specs.request` per machine, with its own requestId.
 *  A failure (OpenRig down, an older daemon: `unsupported`, machine offline: `failed`) is ready with its `error`, and not kept, so the next visit asks again. */
export function useRigSpecs(client: DaemonClient, machine: string | null): RigSpecsState & { refresh: () => void } {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => {
    if (machine === null) return;
    known.delete(machine);
    setAnswer(null);
    setRevision(n => n + 1);
  }, [machine]);
  const [answer, setAnswer] = useState<{ machine: string; state: RigSpecsState } | null>(null);
  useEffect(() => {
    if (machine === null || known.has(machine)) return;
    const requestId = `specs-${++next}`;
    const off = client.onMessage(m => {
      if (m.type !== 'rig.specs' || m.requestId !== requestId) return;
      const state: RigSpecsState = { status: 'ready', specs: m.specs, ...(m.error ? { error: m.error } : {}) };
      if (!m.error) known.set(machine, state);
      setAnswer({ machine, state });
    });
    client.send({ type: 'rig.specs.request', requestId, machineId: machine });
    return off;
  }, [client, machine, revision]);
  const state = machine === null ? IDLE : known.get(machine) ?? (answer && answer.machine === machine ? answer.state : LOADING);
  return { ...state, refresh };
}

/** For tests: forget the answers kept this run. */
export function forgetRigSpecs(): void { known.clear(); }
