import type { MachineState } from '@ledge/fleet';
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
