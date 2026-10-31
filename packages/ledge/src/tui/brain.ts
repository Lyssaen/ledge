import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Exchange, LedgeDecision, LedgeRule } from '@ledge/protocol';

/** What Ledge's brain says of itself: the decisions it took, its rules, its mandate. Each stays undefined until the daemon sends it
 *  (lot 7); the fleet's store keeps none of them yet, so the TUI listens for them itself (ruling R4). */
export interface Brain { decisions?: LedgeDecision[]; rules?: LedgeRule[]; mandate?: { text: string; path: string } }

/** The local daemon's `decisions`, `rules` and `mandate`, the latest of each. Used once, by the App, so nothing sent before a
 *  screen opens is missed. */
export function useBrain(client: DaemonClient): Brain {
  const [brain, setBrain] = useState<Brain>({});
  useEffect(() => client.onMessage(m => {
    if (m.type === 'decisions') setBrain(b => ({ ...b, decisions: m.items }));
    else if (m.type === 'rules') setBrain(b => ({ ...b, rules: m.items }));
    else if (m.type === 'mandate') setBrain(b => ({ ...b, mandate: { text: m.text, path: m.path } }));
  }), [client]);
  return brain;
}

const noop = () => () => {};

/** The exchanges of the rigs `named` (`machine/rigId`), as the fleet holds them; each rig is asked for once while it has none
 *  loaded (ruling R10: a TUI hook, none in the fleet). */
export function useRigExchanges(client: DaemonClient, named: readonly { machine: string; rigId: string }[]): ReadonlyMap<string, readonly Exchange[] | null> {
  const fleet = client.fleet;
  const keyOf = named.map(n => `${n.machine}/${n.rigId}`).join('\n');
  // The snapshot changes only when one of the rigs' lists does: the fleet hands the same array back until then.
  const last = useRef<{ key: string; lists: (readonly Exchange[] | null)[]; map: Map<string, readonly Exchange[] | null> }>({ key: '', lists: [], map: new Map() });
  const snapshot = () => {
    const lists = named.map(n => fleet?.exchanges(n.machine, n.rigId) ?? null);
    const l = last.current;
    if (l.key === keyOf && lists.length === l.lists.length && lists.every((x, i) => x === l.lists[i])) return l.map;
    const map = new Map(named.map((n, i) => [`${n.machine}/${n.rigId}`, lists[i]!] as const));
    last.current = { key: keyOf, lists, map };
    return map;
  };
  const map = useSyncExternalStore(fleet?.subscribe ?? noop, snapshot, snapshot);
  const asked = useMemo(() => new Set<string>(), [client]);
  useEffect(() => {
    for (const n of named) {
      const k = `${n.machine}/${n.rigId}`;
      if (asked.has(k) || fleet?.exchanges(n.machine, n.rigId)) continue;
      if (fleet?.requestExchanges(n.machine, n.rigId)) asked.add(k);
    }
  }, [keyOf, fleet, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return map;
}
