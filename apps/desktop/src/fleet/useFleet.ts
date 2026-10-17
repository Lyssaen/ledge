import { useEffect } from 'react';
import { attachClient, createDaemonClient, createFleetClient, loadMachines, LOCAL_MACHINE, useDaemon, useMachines, type DaemonClient, type DaemonError, type DaemonStatus, type Fleet, type MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';

const LOCAL_URL = LOCAL_MACHINE.url!;

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

export interface FleetView {
  sessions: Session[]; machines: MachineState[]; status: DaemonStatus; fleet: Fleet; client: DaemonClient; localDown: boolean;
  /** The daemon's last `error` reply (a refused decision, a machine offline at send), its session id qualified. */
  lastError: DaemonError | null;
  /** The last errors (a refused send, a machine offline at send), oldest first, the session ids qualified. */
  errors: readonly DaemonError[];
}

/** One attach/connect per client however many components use it: the first consumer starts it, the last one stops it. */
const consumers = new WeakMap<DaemonClient, { count: number; detach: () => void }>();
function acquire(client: DaemonClient): () => void {
  let entry = consumers.get(client);
  if (!entry) { entry = { count: 0, detach: () => {} }; consumers.set(client, entry); }
  if (entry.count++ === 0) { const off = attachClient(client); client.connect(); entry.detach = () => { off(); client.close(); }; }
  return () => { const e = consumers.get(client)!; if (--e.count === 0) e.detach(); };
}

export function useFleet(client: DaemonClient = defaultClient()): FleetView {
  useEffect(() => acquire(client), [client]);
  const daemon = useDaemon();
  const machines = useMachines(client);
  // Only a settled failure counts: the first machine starts as 'connecting', which must not flash the notice at boot.
  const localDown = machines[0]?.status === 'unreachable';
  return { sessions: daemon.sessions, machines, status: daemon.status, fleet: client.fleet!, client, localDown, lastError: daemon.lastError, errors: daemon.errors };
}
