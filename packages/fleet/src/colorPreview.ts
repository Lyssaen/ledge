import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { DaemonClient } from './client';
import { splitId, useMachines } from './machines';
import { daemonStore, useDaemon } from './store';

interface Target { machine: string; id: string }
/** Where a session id goes: a qualified id to its machine with the bare id; an id with no machine (a client without a fleet) to the local daemon as is. */
const targetOf = (client: DaemonClient, id: string | null): Target | null => {
  if (id === null) return null;
  const origin = client.fleet ? splitId(id) : null;
  return origin ?? { machine: 'local', id };
};
/** The machine's own daemon says whether it takes the color subscription. */
const post = (client: DaemonClient, machine: string, id: string | null) => {
  const msg = { type: 'session.preview.subscribe' as const, id, color: true as const };
  if (client.fleet) client.fleet.sendTo(machine, msg); else client.send(msg);
};

/** Follows one session in color while the component is mounted: subscribes on the session's machine (with its bare id),
 *  subscribes again after each snapshot (a reconnected daemon forgot it), and unfollows on the machine it left when the session
 *  changes machine, goes away or the component unmounts. undefined until lines arrive, or when that machine's daemon does not
 *  announce `colorPreview`. */
export function useColorPreview(client: DaemonClient, id: string | null): string[] | undefined {
  const machines = useMachines(client);
  const state = useDaemon();
  const target = targetOf(client, id);
  const daemon = client.fleet ? machines.find(m => m.id === target?.machine)?.daemon : state.daemon;
  const want = target && daemon?.colorPreview ? target : null;
  const followed = useRef<Target | null>(null);
  const machine = want?.machine, bare = want?.id, seq = state.snapshotSeq;
  useEffect(() => {
    const prev = followed.current;
    if (prev && prev.machine !== machine) { post(client, prev.machine, null); followed.current = null; }
    if (machine !== undefined && bare !== undefined) { post(client, machine, bare); followed.current = { machine, id: bare }; }
    else if (followed.current) { post(client, followed.current.machine, null); followed.current = null; }
  }, [client, machine, bare, seq]);
  useEffect(() => () => { if (followed.current) { post(client, followed.current.machine, null); followed.current = null; } }, [client]);
  const lines = useSyncExternalStore(daemonStore.subscribe, () => (id === null ? undefined : daemonStore.getState().colorPreviews.get(id)), () => undefined);
  return want ? lines : undefined;
}
