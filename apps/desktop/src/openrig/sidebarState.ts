import type { DaemonClient, MachineState } from '@ledge/fleet';
import { useOpenRig, useOpenRigStates } from '@ledge/fleet/openrig';
import type { OpenRigState } from '@ledge/protocol';

type RigKernelState = OpenRigState['kernel']['state'];

/** What the sidebar knows of OpenRig across the followed machines (docs/mockups/ledge-sidebar-tidy.html, points 3, 4 and 7). */
export interface SidebarOpenRig {
  /** OpenRig is installed on a followed machine: the Projets / Rigs toggle shows, even without a seat. */
  installed: boolean;
  /** A followed machine's daemon runs: no « OpenRig est arrêté » box. */
  daemonUp: boolean;
  /** The kernel's state on a machine, once read. */
  kernelState(machine: string): RigKernelState | undefined;
  /** « Démarrer OpenRig » runs (on the local machine). */
  starting: boolean;
  /** Why the last « Démarrer OpenRig » failed (the daemon's error code or `rig`'s last line), until the next try. */
  failed: string | null;
  /** Starts OpenRig (daemon and kernel) on the local machine, as the OpenRig page's « Démarrer ». */
  start(): void;
}

/** The pure part: what the read states say. */
export function summarize(states: readonly OpenRigState[]): Pick<SidebarOpenRig, 'installed' | 'daemonUp'> {
  return { installed: states.some(s => s.installed), daemonUp: states.some(s => s.installed && s.daemon.state === 'running') };
}

/** The machine « Démarrer OpenRig » acts on: the local one, else the first that answers. */
export const startMachineOf = (machines: readonly MachineState[]): string | null =>
  machines.find(m => m.id === 'local' && m.ready)?.id ?? machines.find(m => m.ready)?.id ?? null;

/** The sidebar asks less often than the OpenRig page: each ask runs `rig` on the machine. An action's state arrives at once anyway. */
export const SIDEBAR_POLL_MS = 15_000;

export function useSidebarOpenRig(client: DaemonClient, machines: readonly MachineState[]): SidebarOpenRig {
  const home = startMachineOf(machines);
  const others = machines.filter(m => m.ready && m.id !== home).map(m => m.id);
  const local = useOpenRig(client, home, SIDEBAR_POLL_MS);
  const rest = useOpenRigStates(client, others, SIDEBAR_POLL_MS);
  const byMachine = new Map(rest);
  if (home && local.state) byMachine.set(home, local.state);
  const last = local.last;
  return {
    ...summarize([...byMachine.values()]),
    kernelState: machine => byMachine.get(machine)?.kernel.state,
    starting: local.pending?.kind === 'daemon.start',
    failed: last && !last.ok && last.error !== 'cancelled' ? (last.error ?? '') : null,
    start: () => { void local.act({ kind: 'daemon.start' }).then(() => local.refresh()); }
  };
}
