import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fleet, MachineConfig, MachineState, ProbeResult } from '@ledge/fleet';
import { sameMachines } from './machineDrafts';

export type MachineFleet = Pick<Fleet, 'configure' | 'probe' | 'retry' | 'onMachineMessage'>;
export type SaveOutcome = 'saved' | 'offline' | 'timeout' | 'refused';
export const SAVE_TIMEOUT_MS = 10_000;
export interface ProbeState { key: string; alias: string; result: ProbeResult | null }
export interface MachineEditor { saving: boolean; save(next: MachineConfig[]): Promise<SaveOutcome>; probing: ProbeState | null; probe(key: string, alias: string): void; clearProbe(): void }

/**
 * Saving waits for the daemon (spec §5.3): `configure` sends `machines.set`, and the save is done only when the fleet's
 * list equals the one sent (the daemon's `machines` broadcast). A closed local daemon, an `error` without id from it,
 * or `timeoutMs` without an answer end it with nothing applied. One save at a time: a second call gets the first's promise.
 */
export function useMachineEditor(fleet: MachineFleet, machines: readonly MachineState[], timeoutMs = SAVE_TIMEOUT_MS): MachineEditor {
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState<ProbeState | null>(null);
  const busy = useRef<Promise<SaveOutcome> | null>(null);
  const waiter = useRef<{ next: MachineConfig[]; finish(o: SaveOutcome): void } | null>(null);
  const current = useRef(machines); current.current = machines;
  const probeToken = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; waiter.current?.finish('timeout'); }; }, []);

  const save = useCallback((next: MachineConfig[]): Promise<SaveOutcome> => {
    if (busy.current) return busy.current;
    let resolve!: (o: SaveOutcome) => void;
    const p = new Promise<SaveOutcome>(r => { resolve = r; });
    busy.current = p; setSaving(true);
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let off = () => {};
    const finish = (o: SaveOutcome) => {
      if (done) return; done = true;
      clearTimeout(timer); off(); waiter.current = null; busy.current = null;
      if (mounted.current) setSaving(false);
      resolve(o);
    };
    off = fleet.onMachineMessage((machine, m) => { if (machine === 'local' && m.type === 'error' && m.id === undefined) finish('refused'); });
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    waiter.current = { next, finish };
    try { fleet.configure(next); }
    catch (e) { finish(e instanceof Error && e.name === 'DaemonOffline' ? 'offline' : 'refused'); return p; }
    if (sameMachines(current.current, next)) finish('saved');   // nothing to wait for (an unchanged list)
    return p;
  }, [fleet, timeoutMs]);

  useEffect(() => { const w = waiter.current; if (w && sameMachines(machines, w.next)) w.finish('saved'); }, [machines]);

  const probe = useCallback((key: string, alias: string) => {
    const mine = ++probeToken.current;
    setProbing({ key, alias, result: null });
    void fleet.probe(alias)
      .then((r): ProbeResult => r, (e: unknown): ProbeResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .then(result => { if (mounted.current && probeToken.current === mine) setProbing({ key, alias, result }); });
  }, [fleet]);

  /** Forgets the shown result and drops any answer still on its way. */
  const clearProbe = useCallback(() => { probeToken.current++; setProbing(null); }, []);

  return { saving, save, probing, probe, clearProbe };
}
