import type { Session } from '@ledge/protocol';
import { splitId, type MachineState } from '@ledge/fleet';

/** Entries of sessions that are gone (spec §7: purged when the session is removed). Only a ready machine says what it no
 *  longer has; a machine still connecting or unreachable keeps its entries, a machine removed from the list loses them.
 *  `ledge` (the resident) is never pruned. Same object when nothing goes. */
export function pruneGone<T>(map: Readonly<Record<string, T>>, sessions: readonly Session[], machines: readonly MachineState[]): Readonly<Record<string, T>> {
  const present = new Set(sessions.map(s => s.id));
  let out: Record<string, T> | null = null;
  for (const id of Object.keys(map)) {
    if (id === 'ledge' || present.has(id)) continue;
    const owner = machines.find(m => m.id === splitId(id)?.machine);
    if (owner && !owner.ready) continue;
    out ??= { ...map };
    delete out[id];
  }
  return out ?? map;
}
