import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fleet } from '@ledge/fleet';
import type { Projects } from '@ledge/protocol';

export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'refused'; reason: 'offline' | 'outdated' | 'invalid' | 'timeout' };

/** How long a sent state waits for the broadcast that holds it (as a filed agent does, atelier/filing.ts). */
export const UNCONFIRMED_MS = 8000;
const IDLE: SaveState = { status: 'idle' };
const SAVING: SaveState = { status: 'saving' };

/** `timer` null once timed out: the broadcast is still listened for until `reset`. */
interface Waiting { confirm: (p: Projects) => boolean; onDone: () => void; timer: ReturnType<typeof setTimeout> | null }

/** Nothing optimistic: `send` calls `setProjects(next)`, then waits for a `projects` state that `confirm` accepts (the current one,
 *  checked at once, then each broadcast), and only then calls `onDone`. A refusal is named from the error (`DaemonOffline` → offline,
 *  `DaemonOutdated` → outdated, any other, zod's included → invalid), UNCONFIRMED_MS of silence is `timeout`. A confirmation that
 *  comes after the timeout still ends the save (the editor is still open). One send at a time while saving; a timed out one may be
 *  sent again, and the new send replaces it (also when it is refused at once). After `reset` (or unmounting), nothing that arrives
 *  counts. `confirming`: this render's `projects` holds what is being waited for (the wait ends in the effect right after). */
export function useProjectSave(fleet: Pick<Fleet, 'setProjects'>, projects: Projects | null): { state: SaveState; confirming: boolean; send(next: Projects, confirm: (p: Projects) => boolean, onDone: () => void): void; reset(): void } {
  const [state, setState] = useState<SaveState>(IDLE);
  // A synchronous mirror of the send in flight: two Ctrl ↵ in the same frame see the first one before React renders again.
  const waiting = useRef<Waiting | null>(null);
  const drop = () => {
    if (waiting.current?.timer) clearTimeout(waiting.current.timer);
    waiting.current = null;
  };
  // The state at the time of a send: the broadcast that holds the change may already be there.
  const current = useRef(projects);
  current.current = projects;
  useEffect(() => drop, []);

  const send = useCallback((next: Projects, confirm: (p: Projects) => boolean, onDone: () => void) => {
    if (waiting.current?.timer) return;
    try {
      fleet.setProjects(next);
    } catch (e) {
      drop();
      const name = e instanceof Error ? e.name : '';
      setState({ status: 'refused', reason: name === 'DaemonOffline' ? 'offline' : name === 'DaemonOutdated' ? 'outdated' : 'invalid' });
      return;
    }
    const w: Waiting = {
      confirm, onDone,
      timer: setTimeout(() => {
        if (waiting.current !== w) return;
        w.timer = null;
        setState({ status: 'refused', reason: 'timeout' });
      }, UNCONFIRMED_MS)
    };
    drop();
    if (current.current !== null && confirm(current.current)) { clearTimeout(w.timer!); setState(IDLE); onDone(); return; }
    waiting.current = w;
    setState(SAVING);
  }, [fleet]);

  // Each broadcast: the one that holds what was sent ends the wait.
  useEffect(() => {
    const w = waiting.current;
    if (!w || projects === null || !w.confirm(projects)) return;
    drop();
    setState(IDLE);
    w.onDone();
  }, [projects]);

  const reset = useCallback(() => {
    drop();
    setState(s => (s.status === 'idle' ? s : IDLE));
  }, []);

  const confirming = waiting.current !== null && projects !== null && waiting.current.confirm(projects);
  return { state, confirming, send, reset };
}
