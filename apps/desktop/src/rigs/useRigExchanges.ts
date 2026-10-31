import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Exchange, Rig } from '@ledge/protocol';
import { rigKey } from '@ledge/ui/rigs/model';

const noop = () => () => {};
const EMPTY: ReadonlyMap<string, Exchange[]> = new Map();

/** The exchanges of the rigs shown, by `rigKey`: asked once per rig (`requestExchanges`, again if the machine was not reachable yet),
 *  then read from the fleet at each of its changes (a new `rig.exchange` notifies its subscribers). */
export function useRigExchanges(client: DaemonClient, rigs: readonly Rig[]): ReadonlyMap<string, Exchange[]> {
  const fleet = client.fleet;
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!fleet) return;
    for (const r of rigs) {
      const k = rigKey(r);
      if (!asked.current.has(k) && fleet.requestExchanges(r.machine, r.id)) asked.current.add(k);
    }
  }, [fleet, rigs]);
  // The snapshot is a string of the lists' identities' lengths and last ids, so useSyncExternalStore sees a stable value between changes.
  const version = useSyncExternalStore(fleet?.subscribe ?? noop, () => {
    if (!fleet) return '';
    return rigs.map(r => { const l = fleet.exchanges(r.machine, r.id); return l ? `${rigKey(r)}:${l.length}:${l.at(-1)?.id ?? ''}` : ''; }).join('|');
  }, () => '');
  return useMemo(() => {
    if (!fleet) return EMPTY;
    const map = new Map<string, Exchange[]>();
    for (const r of rigs) { const l = fleet.exchanges(r.machine, r.id); if (l) map.set(rigKey(r), l); }
    return map;
    // `version` stands for the fleet's lists.
  }, [fleet, rigs, version]);
}
