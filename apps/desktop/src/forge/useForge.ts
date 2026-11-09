import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Fleet, FleetForgeStatus, FleetPullRequest } from '@ledge/fleet';

type ForgeSource = Pick<Fleet, 'prs' | 'forges' | 'onForge'>;
interface Snapshot { prs: readonly FleetPullRequest[]; forges: readonly FleetForgeStatus[] }
const EMPTY: Snapshot = { prs: [], forges: [] };

/** Every machine's pull and merge requests and forges (lot 8a), kept as one snapshot between changes: `prs()` builds a new
 *  array on each call, which `useSyncExternalStore` would take for a change at every render. */
export function useForge(fleet: ForgeSource | null | undefined): Snapshot {
  // The snapshot, and the fleet it was read from: another fleet reads again.
  const cache = useRef<{ from: ForgeSource; snap: Snapshot } | null>(null);
  const subscribe = useCallback((cb: () => void) => {
    if (!fleet) return () => {};
    return fleet.onForge(() => { cache.current = null; cb(); });
  }, [fleet]);
  const get = useCallback((): Snapshot => {
    if (!fleet) return EMPTY;
    if (cache.current?.from !== fleet) cache.current = { from: fleet, snap: { prs: fleet.prs(), forges: fleet.forges() } };
    return cache.current.snap;
  }, [fleet]);
  return useSyncExternalStore(subscribe, get, get);
}
