import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Fleet, FleetFollowedSession, FleetForgeStatus, FleetPullRequest } from '@ledge/fleet';
import { reachOf } from './states';

type ForgeSource = Pick<Fleet, 'prs' | 'forges' | 'onForge'> & Partial<Pick<Fleet, 'followed' | 'machines'>>;
/** A request, `stale` when its machine has fallen: shown as last read, dimmed, without actions (state 4). */
export type ShownPr = FleetPullRequest & { stale?: boolean };
export interface ForgeSnapshot {
  prs: readonly ShownPr[]; forges: readonly FleetForgeStatus[];
  /** The sessions each daemon follows, and their repository's forge (the chip « PR ? »). */
  followed: readonly FleetFollowedSession[];
  /** When each machine's requests were last read (ms), null for a machine never read. */
  readAt(machine: string): number | null;
}

/** Folds the live requests into what was last read per machine: a machine with requests or forges is replaced and timed; one
 *  without is kept only while it is down (`down`: unreachable, its daemon cut), its last requests marked stale by the caller. A
 *  reachable machine that sends nothing follows nothing any more (review P2): its old requests go. Pure. */
export function foldForge(last: ReadonlyMap<string, { prs: readonly FleetPullRequest[]; at: number }>, live: readonly FleetPullRequest[], liveForges: readonly FleetForgeStatus[], now: number, down: readonly string[] = []): Map<string, { prs: readonly FleetPullRequest[]; at: number }> {
  const next = new Map(last);
  const heard = new Set([...live.map(p => p.machineId), ...liveForges.map(f => f.machineId)]);
  for (const m of heard) next.set(m, { prs: live.filter(p => p.machineId === m), at: now });
  for (const m of [...next.keys()]) if (!heard.has(m) && !down.includes(m)) next.delete(m);
  return next;
}

/** Every machine's pull and merge requests and forges (lot 8a), kept as one snapshot between changes (`prs()` builds a new
 *  array on each call, which `useSyncExternalStore` would take for a change at every render), with each machine's last read:
 *  a machine that falls keeps its requests, stale. */
export function useForge(fleet: ForgeSource | null | undefined, now: () => number = Date.now): ForgeSnapshot {
  const last = useRef(new Map<string, { prs: readonly FleetPullRequest[]; at: number }>());
  // The snapshot, and the fleet it was read from: another fleet reads again.
  const cache = useRef<{ from: ForgeSource; snap: ForgeSnapshot } | null>(null);
  const subscribe = useCallback((cb: () => void) => {
    if (!fleet) return () => {};
    return fleet.onForge(() => { cache.current = null; cb(); });
  }, [fleet]);
  const get = useCallback((): ForgeSnapshot => {
    if (!fleet) return EMPTY;
    if (cache.current?.from === fleet) return cache.current.snap;
    const live = fleet.prs(), forges = fleet.forges();
    // Down now, as the fleet has it: it marks a machine down before it drops its requests (fleet.ts, onStatus), where a
    // render's machine list may still say it answers.
    const down = (fleet.machines?.() ?? []).filter(m => { const r = reachOf(m); return r === 'offline' || r === 'daemonDown'; }).map(m => m.id);
    last.current = foldForge(last.current, live, forges, now(), down);
    const heard = new Set([...live.map(p => p.machineId), ...forges.map(f => f.machineId)]);
    const stale: ShownPr[] = [...last.current].filter(([m]) => !heard.has(m)).flatMap(([, v]) => v.prs.map(p => ({ ...p, stale: true })));
    const times = new Map([...last.current].map(([m, v]) => [m, v.at]));
    const snap: ForgeSnapshot = { prs: [...live, ...stale], forges, followed: fleet.followed?.() ?? [], readAt: m => times.get(m) ?? null };
    cache.current = { from: fleet, snap };
    return snap;
  }, [fleet, now]);
  return useSyncExternalStore(subscribe, get, get);
}
const EMPTY: ForgeSnapshot = { prs: [], forges: [], followed: [], readAt: () => null };
