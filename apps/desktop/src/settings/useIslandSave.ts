import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fleet } from '@ledge/fleet';
import { DEFAULT_ISLAND_PREFS, type IslandPrefs } from '@ledge/protocol';
import { UNCONFIRMED_MS } from '../projects/useProjectSave';

export type IslandRefusal = 'offline' | 'outdated' | 'invalid' | 'timeout';
/** A change sent and not confirmed yet: what was sent, what « Setting saved » says of it, and its timer. */
interface Wait { prefs: IslandPrefs; what: string; timer: ReturnType<typeof setTimeout> }

/** Two island settings are the same, whatever the order of their keys (ours are spread, the daemon's come out of zod). */
export const sameIsland = (a: IslandPrefs, b: IslandPrefs): boolean =>
  a.visible === b.visible && a.screen === b.screen && a.position === b.position && a.discreet === b.discreet && a.islandScale === b.islandScale
  && a.panelScale === b.panelScale && a.shortcut === b.shortcut
  && a.shows.quick === b.shows.quick && a.shows.finished === b.shows.finished && a.shows.say === b.shows.say && a.shows.helpers === b.shows.helpers;

/**
 * The island's settings, saved through the local daemon (`island.set`). `shown` is what the controls show: the last change sent while
 * one waits (so a second change builds on the first), else the daemon's (its defaults while none was set). « Setting saved » (`saved`)
 * comes only once a broadcast holds the change; a refusal (`DaemonOffline` → offline, `DaemonOutdated` → outdated, any other → invalid)
 * or UNCONFIRMED_MS of silence (timeout) is said under the control it came from (`key`), and the controls go back to the daemon's.
 */
export function useIslandSave(fleet: Pick<Fleet, 'setIsland'>, island: IslandPrefs | null | undefined, saved: (what: string) => void, timeoutMs = UNCONFIRMED_MS): {
  shown: IslandPrefs; saving: boolean; refused: { key: string; reason: IslandRefusal } | null; send(key: string, next: IslandPrefs, what: string): void
} {
  const waits = useRef<Wait[]>([]);
  const [pending, setPending] = useState<IslandPrefs | null>(null);
  const [refused, setRefused] = useState<{ key: string; reason: IslandRefusal } | null>(null);
  const say = useRef(saved);
  say.current = saved;
  useEffect(() => () => { waits.current.forEach(w => clearTimeout(w.timer)); waits.current = []; }, []);

  // Each broadcast: the change waiting that it holds is saved, and so are those sent before it (the daemon applies them in order:
  // two broadcasts that reach one render show only the last). Those sent after keep waiting.
  useEffect(() => {
    if (!island) return;
    const at = waits.current.findIndex(w => sameIsland(w.prefs, island));
    if (at < 0) return;
    const done = waits.current.splice(0, at + 1);
    done.forEach(w => clearTimeout(w.timer));
    setPending(waits.current.at(-1)?.prefs ?? null);
    done.forEach(w => say.current(w.what));
  }, [island]);

  const send = useCallback((key: string, next: IslandPrefs, what: string) => {
    try { fleet.setIsland(next); } catch (e) {
      const name = e instanceof Error ? e.name : '';
      setRefused({ key, reason: name === 'DaemonOffline' ? 'offline' : name === 'DaemonOutdated' ? 'outdated' : 'invalid' });
      return;
    }
    setRefused(null);
    const w: Wait = {
      prefs: next, what,
      timer: setTimeout(() => {
        waits.current = waits.current.filter(x => x !== w);
        setPending(waits.current.at(-1)?.prefs ?? null);
        setRefused({ key, reason: 'timeout' });
      }, timeoutMs)
    };
    waits.current.push(w);
    setPending(next);
  }, [fleet, timeoutMs]);

  return { shown: pending ?? island ?? DEFAULT_ISLAND_PREFS, saving: pending !== null, refused, send };
}
