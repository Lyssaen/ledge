import { useCallback, useEffect, useRef, useState } from 'react';
import { qualify, type Fleet, type MachineState } from '@ledge/fleet';
import { LAUNCH_TIMEOUT_MS, START, step, type Flow, type FlowEvent } from './flow';
import type { LaunchRequest } from './form';

/** The two fleet calls a launch needs: it talks to the chosen machine only (spec §9.2), never through the selected one. */
export type LaunchFleet = Pick<Fleet, 'sendTo' | 'onMachineMessage'>;
export interface LaunchApi { flow: Flow; open(): void; close(): void; launch(request: LaunchRequest): void; retry(): void; edit(): void }

/** Lives in the Shell, not in the screen: a cancelled attempt's late answer is still skipped after the screen is gone. */
export function useLaunch(fleet: LaunchFleet, machines: MachineState[], onLaunched: (id: string) => void): LaunchApi {
  const [flow, setFlow] = useState<Flow>(START);
  const current = useRef<Flow>(START);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deps = useRef({ fleet, onLaunched });
  useEffect(() => { deps.current = { fleet, onLaunched }; });

  const fire = useCallback(function fire(e: FlowEvent): void {
    const { flow: next, send, launched } = step(current.current, e);
    if (next === current.current) return;
    current.current = next;
    setFlow(next);
    if (next.stage !== 'starting' && timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (send) {
      if (timer.current) clearTimeout(timer.current);
      const attempt = next.attempt;
      timer.current = setTimeout(() => { timer.current = null; fire({ type: 'timeout', attempt }); }, LAUNCH_TIMEOUT_MS);
      const { machine, tool, cwd, prompt } = send;
      if (!deps.current.fleet.sendTo(machine, { type: 'session.launch', tool, cwd, prompt })) fire({ type: 'unsent' });
    }
    if (launched) deps.current.onLaunched(launched);
  }, []);

  useEffect(() => fleet.onMachineMessage((machine, m) => {
    if (m.type === 'session.launched') fire({ type: 'launched', machine, id: qualify(machine, m.id) });
    // An error that names a session answers a session command (lot 4), never a launch.
    else if (m.type === 'error' && m.id === undefined) fire({ type: 'refused', machine, message: m.message });
  }), [fleet, fire]);

  // A machine that is no longer ready has lost the connection the answer would come back on.
  const down = machines.filter(m => !m.ready).map(m => m.id).join('\n');
  useEffect(() => { if (down) for (const id of down.split('\n')) fire({ type: 'dropped', machine: id }); }, [down, fire]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const open = useCallback(() => fire({ type: 'open' }), [fire]);
  const close = useCallback(() => fire({ type: 'close' }), [fire]);
  const launch = useCallback((request: LaunchRequest) => fire({ type: 'start', request }), [fire]);
  const retry = useCallback(() => fire({ type: 'retry' }), [fire]);
  const edit = useCallback(() => fire({ type: 'edit' }), [fire]);
  return { flow, open, close, launch, retry, edit };
}
