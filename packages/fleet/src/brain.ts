import { useMemo, useSyncExternalStore } from 'react';
import type { BrainStatus, LedgeDecision, LedgeRule } from '@ledge/protocol';
import type { DaemonClient } from './client';
import { daemonStore } from './store';

/** Ledge's brain as the local daemon serves it (lot 7): the mandate, the memory, the brain's state, and the requests about them.
 *  The requests go to the local daemon whatever machine is selected (fleet routing, C25); their `rig.result` is not tracked. */
let next = 0;
const rid = (kind: string) => `${kind}-${Date.now().toString(36)}-${++next}`;
const get = () => daemonStore.getState();
const pick = <T>(f: (s: ReturnType<typeof get>) => T): T => useSyncExternalStore(daemonStore.subscribe, () => f(get()), () => f(get()));

/** `~/.ledge/mandat.md` and its text; undefined until the daemon sent it. */
export const useMandate = (): { text: string; path: string } | undefined => pick(s => s.mandate);
export const useLedgeRules = (): LedgeRule[] => pick(s => s.rules);
/** The decisions (the daemon's 200 newest, newest first). */
export const useLedgeDecisionList = (): LedgeDecision[] => pick(s => s.decisions);
/** The decisions by id, as the thread's `decided` items point to them. */
export function useLedgeDecisions(): ReadonlyMap<string, LedgeDecision> {
  const list = useLedgeDecisionList();
  return useMemo(() => new Map(list.map(d => [d.id, d])), [list]);
}
/** The brain's state; undefined until the daemon sent it (an older daemon never does). */
export const useBrainStatus = (): BrainStatus | undefined => pick(s => s.brain);

/** « Revenir dessus »: reopens a decision (`text`: what the user says instead). */
export function revisitDecision(client: DaemonClient, id: string, text?: string): void {
  client.send({ type: 'decision.revisit', rid: rid('revisit'), id, ...(text !== undefined ? { text } : {}) });
}
/** Turns the brain on or off (`first`: the user's first yes, which the daemon announces). */
export function setBrain(client: DaemonClient, o: { enabled: boolean; tool?: BrainStatus['tool']; first?: boolean }): void {
  client.send({ type: 'brain.set', rid: rid('brain'), enabled: o.enabled, ...(o.tool ? { tool: o.tool } : {}), ...(o.first ? { first: true as const } : {}) });
}
