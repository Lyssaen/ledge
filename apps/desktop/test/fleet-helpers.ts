import type { MachineConfig, MachineState, ProbeResult } from '@ledge/fleet';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';

/** A machine as the fleet publishes it: ready unless told otherwise; remotes get an SSH alias. */
export function machine(id: string, extra: Partial<MachineState> = {}): MachineState {
  const label = id === 'local' ? 'Local' : id[0]!.toUpperCase() + id.slice(1);
  return { id, label, ...(id === 'local' ? {} : { ssh: id }), status: 'open', ready: true, recents: [], sessions: [], launcher: null, ...extra };
}

/** The two fleet calls a machine action uses. `offline` lists the machines `sendTo` refuses; `emit` plays a daemon message from one machine. */
export function fakeFleet(down: string[] = []) {
  const sent: { machine: string; msg: ClientMessage }[] = [];
  const listeners = new Set<(machine: string, m: ServerMessage) => void>();
  const offline = new Set(down);
  return {
    sent, offline, listeners,
    sendTo(machine: string, msg: ClientMessage): boolean { if (offline.has(machine)) return false; sent.push({ machine, msg }); return true; },
    onMachineMessage(fn: (machine: string, m: ServerMessage) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
    emit(machine: string, m: ServerMessage): void { for (const fn of [...listeners]) fn(machine, m); }
  };
}
export type FakeFleet = ReturnType<typeof fakeFleet>;

/** The four fleet calls the Settings › Machines section uses. `state.down`: the local daemon is closed (`configure` throws
 *  `DaemonOffline` like the real fleet); `probes` wait for `answer` (or `fail`); `emit` plays a daemon message from one machine. */
export function fakeMachineFleet() {
  const state = { down: false };
  const configured: MachineConfig[][] = [];
  const retried: string[] = [];
  const probes: { ssh: string; answer(r: ProbeResult): void; fail(e: unknown): void }[] = [];
  const listeners = new Set<(machine: string, m: ServerMessage) => void>();
  return {
    state, configured, retried, probes, listeners,
    configure(c: MachineConfig[]): void {
      if (state.down) throw Object.assign(new Error('The local daemon is not connected'), { name: 'DaemonOffline' });
      configured.push(c);
    },
    probe(ssh: string): Promise<ProbeResult> { return new Promise((resolve, reject) => probes.push({ ssh, answer: resolve, fail: reject })); },
    retry(id: string): void { retried.push(id); },
    onMachineMessage(fn: (machine: string, m: ServerMessage) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
    emit(from: string, m: ServerMessage): void { for (const fn of [...listeners]) fn(from, m); }
  };
}
export type FakeMachineFleet = ReturnType<typeof fakeMachineFleet>;
/** The list as the daemon's `machines` broadcast brings it back into the fleet. */
export const statesOf = (list: readonly MachineConfig[]): MachineState[] => list.map(c => machine(c.id, { label: c.label, ...(c.ssh ? { ssh: c.ssh } : {}) }));
