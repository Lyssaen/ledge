import type { MachineConfig, MachineState, ProbeResult } from '@ledge/fleet';
import type { ServerMessage } from '@ledge/protocol';
import { machine } from './launch-helpers';

/** The four fleet calls the Machines section uses. `state.down`: the local daemon is closed (`configure` throws
 *  `DaemonOffline` like the real fleet); `probes` wait for `answer`; `emit` plays a daemon message from one machine. */
export function fakeMachineFleet() {
  const state = { down: false };
  const configured: MachineConfig[][] = [];
  const retried: string[] = [];
  const probes: { ssh: string; answer(r: ProbeResult): void }[] = [];
  const listeners = new Set<(machine: string, m: ServerMessage) => void>();
  return {
    state, configured, retried, probes,
    configure(c: MachineConfig[]): void {
      if (state.down) throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
      configured.push(c);
    },
    probe(ssh: string): Promise<ProbeResult> { return new Promise(resolve => probes.push({ ssh, answer: resolve })); },
    retry(id: string): void { retried.push(id); },
    onMachineMessage(fn: (machine: string, m: ServerMessage) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
    emit(from: string, m: ServerMessage): void { for (const fn of [...listeners]) fn(from, m); }
  };
}
export type FakeMachineFleet = ReturnType<typeof fakeMachineFleet>;
/** The list as the daemon's `machines` broadcast brings it back into the fleet. */
export const statesOf = (list: MachineConfig[]): MachineState[] => list.map(c => machine(c.id, { label: c.label, ...(c.ssh ? { ssh: c.ssh } : {}) }));
