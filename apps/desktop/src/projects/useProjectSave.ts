import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fleet } from '@ledge/fleet';
import type { Projects } from '@ledge/protocol';

export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'refused'; reason: 'offline' | 'outdated' | 'invalid' | 'timeout' };

/** How long a sent state waits for the broadcast that holds it (as a filed agent does, atelier/filing.ts). */
export const UNCONFIRMED_MS = 8000;
const IDLE: SaveState = { status: 'idle' };
const SAVING: SaveState = { status: 'saving' };

interface Waiting { confirm: (p: Projects) => boolean; onDone: () => void; timer: ReturnType<typeof setTimeout> }

/** Nothing optimistic: `send` calls `setProjects(next)`, then waits for a `projects` broadcast that `confirm` accepts (UNCONFIRMED_MS),
 *  and only then calls `onDone`. A refusal is named from the error (`DaemonOffline` → offline, `DaemonOutdated` → outdated, any other,
 *  zod's included → invalid), a silence is `timeout`. One send at a time; after `reset` (or unmounting), nothing that arrives counts. */
export function useProjectSave(fleet: Pick<Fleet, 'setProjects'>, projects: Projects | null): { state: SaveState; send(next: Projects, confirm: (p: Projects) => boolean, onDone: () => void): void; reset(): void } {
  const [state, setState] = useState<SaveState>(IDLE);
  // A synchronous mirror of the send in flight: two Ctrl ↵ in the same frame see the first one before React renders again.
  const waiting = useRef<Waiting | null>(null);
  const drop = () => {
    if (waiting.current) clearTimeout(waiting.current.timer);
    waiting.current = null;
  };
  useEffect(() => drop, []);

  const send = useCallback((next: Projects, confirm: (p: Projects) => boolean, onDone: () => void) => {
    if (waiting.current) return;
    try {
      fleet.setProjects(next);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      setState({ status: 'refused', reason: name === 'DaemonOffline' ? 'offline' : name === 'DaemonOutdated' ? 'outdated' : 'invalid' });
      return;
    }
    const w: Waiting = {
      confirm, onDone,
      timer: setTimeout(() => {
        if (waiting.current !== w) return;
        waiting.current = null;
        setState({ status: 'refused', reason: 'timeout' });
      }, UNCONFIRMED_MS)
    };
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

  return { state, send, reset };
}
