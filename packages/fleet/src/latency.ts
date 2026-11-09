import { useEffect, useState } from 'react';
import type { DaemonClient } from './client';

export const LATENCY_POLL_MS = 15_000;
let next = 0;

/**
 * The round trip to each machine's daemon, in ms (`ping` / `pong`), measured again every `everyMs`: one ping at a time per machine, and
 * a ping still unanswered at the next round is given up (`null`). `null` too: the machine dropped, or its daemon has no `ping` (the fleet
 * answers `outdated` without sending anything). A machine not measured yet is absent.
 */
export function useLatency(client: DaemonClient, machines: readonly string[], everyMs = LATENCY_POLL_MS): ReadonlyMap<string, number | null> {
  const [values, setValues] = useState<ReadonlyMap<string, number | null>>(new Map());
  const key = [...machines].sort().join('\u0000');
  useEffect(() => {
    const ids = key ? key.split('\u0000') : [];
    const pending = new Map<string, { requestId: string; at: number }>();
    const set = (machine: string, ms: number | null) => setValues(v => (v.get(machine) === ms && v.has(machine) ? v : new Map(v).set(machine, ms)));
    const off = client.onMessage(m => {
      if (m.type !== 'pong' || m.machineId === undefined) return;
      const p = pending.get(m.machineId);
      if (!p || p.requestId !== m.requestId) return;
      pending.delete(m.machineId);
      set(m.machineId, m.error ? null : Math.max(0, Math.round(performance.now() - p.at)));
    });
    const round = () => {
      for (const machine of ids) {
        if (pending.has(machine)) { pending.delete(machine); set(machine, null); }
        const requestId = `ping-${++next}`;
        pending.set(machine, { requestId, at: performance.now() });
        client.send({ type: 'ping', requestId, machineId: machine });
      }
    };
    round();
    const timer = setInterval(round, everyMs);
    setValues(v => { const keep = new Map([...v].filter(([id]) => ids.includes(id))); return keep.size === v.size ? v : keep; });
    return () => { clearInterval(timer); off(); };
  }, [client, key, everyMs]);
  return values;
}
