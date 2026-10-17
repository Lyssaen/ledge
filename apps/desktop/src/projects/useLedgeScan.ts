import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DaemonClient, MachineState, ScanOf } from '@ledge/fleet';
import type { FoundRepo } from '@ledge/protocol';

/** How long a machine may stay silent before its step says so and the proposal goes on without it. */
export const SCAN_TIMEOUT_MS = 15_000;

/** One machine's step: `waiting` its answer, `done` (with how many repositories, and whether the walk was cut short), `offline`
 *  (not ready, so never asked, or dropped meanwhile), `outdated` (its daemon does not know repos.scan), `timeout` (silent for
 *  SCAN_TIMEOUT_MS), `failed` (its daemon answered that the scan failed). */
export type ScanStep = { machine: string; label: string; state: 'waiting' | 'done' | 'offline' | 'outdated' | 'timeout' | 'failed'; repos: number; truncated: boolean };

interface Run { steps: ScanStep[]; found: FoundRepo[][] }
let next = 0;

/** Ledge's scan of the machines (« Laisser Ledge faire », Settings › Projects): on `start`, one `repos.scan` per machine ready, each
 *  with its own requestId and SCAN_TIMEOUT_MS; a machine not ready gets its « offline » step without being asked. The steps fill as
 *  the answers come (partial results); `done` once every machine is settled. `scans` is what `proposeProjects` takes: `ok` for a
 *  machine that answered, `outdated`, else `offline` (a timeout or a failure included). `cancel` (and unmounting) forgets the
 *  requests: an answer that comes after counts for nothing. Nothing is written. */
export function useLedgeScan(client: DaemonClient, machines: readonly MachineState[]): { status: 'idle' | 'scanning' | 'done'; steps: ScanStep[]; scans: ScanOf[]; start(): void; cancel(): void } {
  const [run, setRun] = useState<Run | null>(null);
  // requestId -> the index of its step, for the requests of the run in progress only.
  const pending = useRef(new Map<string, number>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Listening only while a run waits: subscribed before the first send (the fleet answers « offline » within `send` itself).
  const unsubscribe = useRef<(() => void) | null>(null);
  const given = useRef(machines);
  given.current = machines;

  const forget = useCallback(() => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    pending.current.clear();
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  useEffect(() => forget, [forget]);

  const settle = useCallback((requestId: string, step: Pick<ScanStep, 'state' | 'repos' | 'truncated'>, found: FoundRepo[] = []) => {
    const i = pending.current.get(requestId);
    if (i === undefined) return;
    pending.current.delete(requestId);
    if (pending.current.size === 0) { unsubscribe.current?.(); unsubscribe.current = null; }
    setRun(r => r && {
      steps: r.steps.map((s, j) => (j === i ? { ...s, ...step } : s)),
      found: r.found.map((f, j) => (j === i ? found : f))
    });
  }, []);

  const start = useCallback(() => {
    forget();
    const list = given.current;
    const steps: ScanStep[] = list.map(m => ({ machine: m.id, label: m.label, state: m.ready ? 'waiting' : 'offline', repos: 0, truncated: false }));
    setRun({ steps, found: list.map(() => []) });
    if (list.some(m => m.ready)) unsubscribe.current = client.onMessage(m => {
      if (m.type !== 'repos.found' || !pending.current.has(m.requestId)) return;
      if (m.error === undefined) settle(m.requestId, { state: 'done', repos: m.repos.length, truncated: m.truncated }, m.repos);
      else settle(m.requestId, { state: m.error === 'offline' ? 'offline' : m.error === 'outdated' ? 'outdated' : 'failed', repos: 0, truncated: false });
    });
    list.forEach((m, i) => {
      if (!m.ready) return;
      const requestId = `scan-${++next}`;
      pending.current.set(requestId, i);
      timers.current.push(setTimeout(() => settle(requestId, { state: 'timeout', repos: 0, truncated: false }), SCAN_TIMEOUT_MS));
      client.send({ type: 'repos.scan', requestId, machineId: m.id });
    });
  }, [client, forget, settle]);

  const cancel = useCallback(() => {
    forget();
    setRun(null);
  }, [forget]);

  const scans = useMemo<ScanOf[]>(() => (run ? run.steps.map((s, i) => ({
    machine: s.machine, label: s.label, status: s.state === 'done' ? 'ok' : s.state === 'outdated' ? 'outdated' : 'offline', repos: run.found[i] ?? [], truncated: s.truncated
  })) : []), [run]);
  const status = run === null ? 'idle' : run.steps.some(s => s.state === 'waiting') ? 'scanning' : 'done';
  return { status, steps: run?.steps ?? [], scans, start, cancel };
}
