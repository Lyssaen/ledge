import { KERNEL_RIG, rigCommands, showRigCommand, type OpenRigAction, type OpenRigState, type Rig, type RigSeat } from '@ledge/protocol';

/**
 * The OpenRig screen's model (docs/mockups/ledge-openrig.html, view 4, « Écran OpenRig (6) »): what each key does on the
 * machine shown, and what a stop asks before it runs. Pure: the screen draws it and sends the action.
 */

/** The rigs the list shows: the kernel has its own panel. */
export const listedRigs = (s: OpenRigState | null): Rig[] => (s?.rigs ?? []).filter(r => r.name !== KERNEL_RIG);

/** The daemon answers: kernel and rigs can be acted on. */
export const daemonUp = (s: OpenRigState | null): boolean => !!s?.installed && s.daemon.state === 'running';

/** A rig with at least one seat up counts as running: `s` stops it. */
export const rigRunning = (r: Rig): boolean => r.status === 'running' || r.running > 0;

/** How a rig reads: running, starting (some seats up), needs a look (attention), stopped. */
export type RigLook = 'running' | 'starting' | 'attention' | 'stopped';
export function rigLook(r: Rig): RigLook {
  if (r.attention > 0) return 'attention';
  if (r.status === 'running') return 'running';
  return r.running > 0 ? 'starting' : 'stopped';
}

/** A seat at work: its agent runs, or work is assigned to it. */
export const seatBusy = (s: RigSeat): boolean => s.activity === 'running' || s.work > 0;

/** `s` on a rig: stop it when it runs, start it otherwise. */
export const rigToggle = (r: Rig): OpenRigAction => (rigRunning(r) ? { kind: 'rig.stop', rig: r.name, snapshot: true } : { kind: 'rig.start', rig: r.name });
/** `D`: stop the daemon when it runs, else start it and bring back the rigs that were running (`rig start --last`). */
export const daemonToggle = (s: OpenRigState): OpenRigAction => (s.daemon.state === 'running' ? { kind: 'daemon.stop' } : { kind: 'daemon.start', restore: 'last' });
/** `K`: stop the kernel when it is up or coming up, else start it. */
export const kernelToggle = (s: OpenRigState): OpenRigAction => (s.kernel.state === 'ready' || s.kernel.state === 'starting' ? { kind: 'kernel.stop' } : { kind: 'kernel.start' });

/** An action that stops something (a restart stops first): it asks y / n. A start does not ask. */
export const asksFirst = (a: OpenRigAction): boolean => a.kind.endsWith('.stop') || a.kind.endsWith('.restart');

/** The seats an action stops while they work, `rig · seat` for the daemon (every rig), the seat alone for one rig. */
export function busySeats(s: OpenRigState, a: OpenRigAction): string[] {
  const of = (r: Rig | undefined) => (r?.nodes ?? []).filter(seatBusy);
  if (a.kind === 'rig.stop' || a.kind === 'rig.restart') return of(s.rigs.find(r => r.name === a.rig)).map(n => n.logicalId);
  if (a.kind === 'kernel.stop' || a.kind === 'kernel.restart') return of(s.rigs.find(r => r.name === KERNEL_RIG)).map(n => n.logicalId);
  if (a.kind === 'daemon.stop' || a.kind === 'daemon.restart') return s.rigs.flatMap(r => of(r).map(n => `${r.name} · ${n.logicalId}`));
  return [];
}

/** The commands an action runs, as the confirmation shows them (`rig down starter --snapshot`). */
export const commandsOf = (a: OpenRigAction): string[] => rigCommands(a).map(showRigCommand);

/** What a stop asks: the action, the seats it stops at work, the commands it runs. */
export interface Confirm { action: OpenRigAction; busy: string[]; commands: string[] }
export const confirmOf = (s: OpenRigState, a: OpenRigAction): Confirm => ({ action: a, busy: busySeats(s, a), commands: commandsOf(a) });

/** The next index in a list of `n`, by `by`, wrapping; 0 when the list is empty. */
export const step = (at: number, by: number, n: number): number => (n ? (at + by + n) % n : 0);
/** The selection kept on the same rig when the list changes, else held within it. */
export function keepRig(rigs: readonly Rig[], at: number, id: string | null): number {
  const found = id ? rigs.findIndex(r => r.id === id) : -1;
  return found >= 0 ? found : Math.max(0, Math.min(at, rigs.length - 1));
}
