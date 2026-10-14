import { useEffect } from 'react';
import { attachClient, createDaemonClient, createFleetClient, loadMachines, LOCAL_MACHINE, useDaemon, useMachines, type DaemonClient, type DaemonStatus, type Fleet, type MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';

const LOCAL_URL = LOCAL_MACHINE.url ?? 'ws://127.0.0.1:47831';

/** Desktop keeps a fallen machine's last sessions on screen (keepStale) and trusts the daemon's machine list (spec §6, §5.3).
 *  `url` and `WebSocketImpl` are test hooks: `parseMachines` pins local to LOCAL_MACHINE.url, so the override goes through `makeClient`. */
export function createDesktopFleet(opts: { url?: string; WebSocketImpl?: unknown } = {}): DaemonClient {
  // A short backoff keeps the e2e run quick (Task 8 sets VITE_LEDGE_E2E).
  const backoff = import.meta.env.VITE_LEDGE_E2E ? { minBackoffMs: 200, maxBackoffMs: 500 } : {};
  return createFleetClient(
    loadMachines('desktop'),
    (c) => createDaemonClient({ url: (c.url ?? LOCAL_URL).replace(LOCAL_URL, opts.url ?? LOCAL_URL), ...(opts.WebSocketImpl ? { WebSocketImpl: opts.WebSocketImpl as never } : {}), ...backoff }),
    { prefix: 'desktop', keepStale: true, machinesFromDaemon: true },
  );
}

let singleton: DaemonClient | null = null;
const defaultClient = (): DaemonClient => (singleton ??= createDesktopFleet());

export interface FleetView { sessions: Session[]; machines: MachineState[]; status: DaemonStatus; fleet: Fleet; client: DaemonClient; localDown: boolean }

export function useFleet(client: DaemonClient = defaultClient()): FleetView {
  useEffect(() => { const off = attachClient(client); client.connect(); return () => { off(); client.close(); }; }, [client]);
  const daemon = useDaemon();
  const machines = useMachines(client);
  // Only a settled failure counts: the first machine starts as 'connecting', which must not flash the notice at boot.
  const localDown = machines[0]?.status === 'unreachable';
  return { sessions: daemon.sessions, machines, status: daemon.status, fleet: client.fleet!, client, localDown };
}
