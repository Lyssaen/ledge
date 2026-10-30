import type { Rig, Tool } from '@ledge/protocol';
import type { Store } from '../store.js';
import type { Bridge } from './bridge.js';

/**
 * Pairs a session with its OpenRig seat after one of its events. The seat name the hook carried wins; without one,
 * a read-only (`hook_only`) session without a rig falls back to its folder and tool, which the bridge settles only
 * when exactly one unpaired seat fits. An unknown name pairs nothing: the next event tries again. True when `rig` changed.
 */
export function pairSession(store: Store, bridge: Pick<Bridge, 'pair' | 'pairByCwd'>, msg: { id: string; cwd?: string; agent?: Tool; openrig?: { sessionName: string } }): boolean {
  const cur = store.get(msg.id); if (!cur) return false;
  const rig = msg.openrig ? bridge.pair(msg.id, msg.openrig.sessionName)
    : cur.source === 'hook_only' && !cur.rig && msg.cwd && msg.agent ? bridge.pairByCwd(msg.id, msg.cwd, msg.agent) : null;
  if (!rig) return false;
  store.patch(msg.id, { rig });
  return store.get(msg.id)?.rig !== cur.rig;
}

/** Drops `rig` from the sessions whose rig is no longer among `rigs`; returns their ids. */
export function unpairGone(store: Store, rigs: readonly Rig[]): string[] {
  const live = new Set(rigs.map(r => r.id));
  const gone = store.all().filter(s => s.rig && !live.has(s.rig.rigId)).map(s => s.id);
  for (const id of gone) store.patch(id, { rig: undefined });
  return gone;
}
