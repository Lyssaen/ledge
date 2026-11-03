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
  /** The kernel's state on a machine: `offline` when the machine does not answer (unreachable, or its Ledge too old),
   *  undefined while it has not answered yet. */
  kernelState(machine: string): RigKernelState | 'offline' | undefined;
  /** A machine's name, for the kernel tag's tooltip. */
  labelOf(machine: string): string;
  /** The local machine answers and has OpenRig: « Démarrer OpenRig » is offered there (otherwise only the OpenRig page link). */
  canStart: boolean;
  /** Where OpenRig is installed when not on this computer: the first such machine in display order (« Il est installé sur … »). */
  installedOn: { id: string; label: string } | null;
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
  const byMachine = new Map<string, OpenRigState>();
  for (const [m, seen] of rest) if (seen.state) byMachine.set(m, seen.state);
  if (local.state) byMachine.set(LOCAL, local.state);
  const unreachable = (m: string) => !machines.some(x => x.id === m && x.ready) || (m === LOCAL ? !!local.error : !!rest.get(m)?.error);
  const last = local.last;
  const canStart = local.state?.installed === true;
  return {
    ...summarize([...byMachine.values()]),
    kernelState: machine => (unreachable(machine) ? 'offline' : byMachine.get(machine)?.kernel.state),
    labelOf: machine => machines.find(m => m.id === machine)?.label ?? machine,
    canStart,
    installedOn: (() => { const m = machines.find(x => x.id !== LOCAL && byMachine.get(x.id)?.installed); return m ? { id: m.id, label: m.label } : null; })(),
    starting: local.pending?.kind === 'daemon.start',
    failed: last && !last.ok && last.error !== 'cancelled' ? (last.error ?? '') : null,
    // The action's end reads the machine again (useOpenRig).
    start: () => { if (canStart) void local.act({ kind: 'daemon.start' }); }
  };
}
