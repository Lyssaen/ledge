import type { DaemonClient, MachineState } from '@ledge/fleet';
import { useOpenRig, useOpenRigStates } from '@ledge/fleet/openrig';
import type { OpenRigState } from '@ledge/protocol';

export type RigKernelState = OpenRigState['kernel']['state'];

/** The machine « Démarrer OpenRig » acts on, always (the user's decision): this computer's. */
export const LOCAL = 'local';

/** What the sidebar knows of OpenRig across the followed machines (docs/mockups/ledge-sidebar-tidy.html, points 3, 4 and 7). */
export interface SidebarOpenRig {
  /** OpenRig is installed on a followed machine: the Projets / Rigs toggle shows, even without a seat. */
  installed: boolean;
  /** A followed machine's daemon runs: no « OpenRig est arrêté » box. */
  daemonUp: boolean;
  /** The kernel's state on a machine, once read. */
  kernelState(machine: string): RigKernelState | undefined;
  /** A machine's name, for the kernel tag's tooltip. */
  labelOf(machine: string): string;
  /** The local machine answers and has OpenRig: « Démarrer OpenRig » is offered there (otherwise only the OpenRig page link). */
  canStart: boolean;
  /** « Démarrer OpenRig » runs (on the local machine). */
  starting: boolean;
  /** Why the last « Démarrer OpenRig » failed (the daemon's error code or `rig`'s last line), until the next try. */
  failed: string | null;
  /** Starts OpenRig (daemon and kernel) on the local machine, as the OpenRig page's « Démarrer ». Never another machine. */
  start(): void;
}

/** The pure part: what the read states say. */
export function summarize(states: readonly OpenRigState[]): Pick<SidebarOpenRig, 'installed' | 'daemonUp'> {
  return { installed: states.some(s => s.installed), daemonUp: states.some(s => s.installed && s.daemon.state === 'running') };
}

/** The sidebar's pace while a daemon runs. It shares one read per machine with the OpenRig page (whose 5 s wins while shown);
 *  a machine whose OpenRig is absent or stopped is read every minute, on a window focus, and right after « Démarrer ». */
export const SIDEBAR_POLL_MS = 15_000;

export function useSidebarOpenRig(client: DaemonClient, machines: readonly MachineState[]): SidebarOpenRig {
  const localReady = machines.some(m => m.id === LOCAL && m.ready);
  const others = machines.filter(m => m.ready && m.id !== LOCAL).map(m => m.id);
  const local = useOpenRig(client, localReady ? LOCAL : null, SIDEBAR_POLL_MS);
  const rest = useOpenRigStates(client, others, SIDEBAR_POLL_MS);
  const byMachine = new Map(rest);
  if (local.state) byMachine.set(LOCAL, local.state);
  const last = local.last;
  const canStart = local.state?.installed === true;
  return {
    ...summarize([...byMachine.values()]),
    kernelState: machine => byMachine.get(machine)?.kernel.state,
    labelOf: machine => machines.find(m => m.id === machine)?.label ?? machine,
    canStart,
    starting: local.pending?.kind === 'daemon.start',
    failed: last && !last.ok && last.error !== 'cancelled' ? (last.error ?? '') : null,
    // The action's end reads the machine again (useOpenRig).
    start: () => { if (canStart) void local.act({ kind: 'daemon.start' }); }
  };
}
