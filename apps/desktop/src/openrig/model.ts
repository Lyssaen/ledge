import { KERNEL_RIG, rigCommands, showRigCommand, type OpenRigAction, type OpenRigState, type Rig, type RigSeat } from '@ledge/protocol';

/**
 * What the OpenRig page (docs/mockups/ledge-openrig.html, views 1, 2 and 5) shows and offers, as pure functions: the
 * React page only draws them. Every stop asks first and names who works; a start does not ask.
 */

export const isRunning = (r: Rig): boolean => r.status === 'running' || r.status === 'partial' || r.running > 0;
/** The rigs of the list: the kernel has its own card. */
export const listedRigs = (s: OpenRigState): Rig[] => s.rigs.filter(r => r.name !== KERNEL_RIG);
export const kernelRig = (s: OpenRigState): Rig | undefined => s.rigs.find(r => r.name === KERNEL_RIG);
/** A seat that would lose work if it stopped now: it is running a turn, or holds tasks. */
export const isWorking = (seat: RigSeat): boolean => seat.activity === 'running' || seat.work > 0;

/** What stopping would interrupt: every working seat of the rig (the kernel's for the kernel, every rig's for the daemon). */
export function workingSeats(s: OpenRigState, action: OpenRigAction): Array<{ rig: string; seat: RigSeat }> {
  const of = (rigs: Rig[]) => rigs.flatMap(r => r.nodes.filter(isWorking).map(seat => ({ rig: r.name, seat })));
  switch (action.kind) {
    case 'rig.stop': case 'rig.restart': return of(s.rigs.filter(r => r.name === action.rig));
    case 'kernel.stop': case 'kernel.restart': return of(s.rigs.filter(r => r.name === KERNEL_RIG));
    case 'daemon.stop': case 'daemon.restart': return of(s.rigs);
    default: return [];
  }
}

/** Whether an action stops something, and so asks first. */
export const asksFirst = (a: OpenRigAction): boolean => a.kind.endsWith('.stop') || a.kind.endsWith('.restart');

/** The commands as the page shows them, `rig down starter --snapshot`. */
export const commandsOf = (a: OpenRigAction): string[] => rigCommands(a).map(showRigCommand);

/** The rig an action is about, for the row that shows it busy; null for the daemon and the kernel. */
export const rigOf = (a: OpenRigAction | null): string | null => (a && 'rig' in a ? a.rig : null);

/** `kernel` for kernel actions, `daemon` for daemon ones, the rig's name otherwise. */
export const targetOf = (a: OpenRigAction): string => (a.kind.startsWith('daemon.') ? 'daemon' : a.kind.startsWith('kernel.') ? KERNEL_RIG : (a as { rig: string }).rig);
