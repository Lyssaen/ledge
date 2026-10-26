import { useEffect, useRef } from 'react';
import { useDaemon, type DaemonClient } from '@ledge/fleet';
import type { Session, ThreadItem } from '@ledge/protocol';

/** Les fils de plusieurs sessions, par id : chacun demandé une fois par snapshot tant qu'il manque, jamais pour une session hors
 *  ligne (elle garde ce qu'elle avait) ; pendant la nouvelle demande après un snapshot, les derniers éléments de la même
 *  session. Ceux d'une session sortie de la liste sont oubliés. */
export function useThreads(client: Pick<DaemonClient, 'send'>, sessions: readonly Session[]): ReadonlyMap<string, ThreadItem[] | undefined> {
  const { threads, snapshotSeq } = useDaemon();
  const kept = useRef<ReadonlyMap<string, ThreadItem[]>>(new Map());
  // The snapshot each missing thread was last asked at.
  const asked = useRef(new Map<string, number>());
  const out = new Map<string, ThreadItem[] | undefined>();
  const next = new Map<string, ThreadItem[]>();
  const missing: string[] = [];
  for (const s of sessions) {
    const own = threads.get(s.id);
    const items = own ?? kept.current.get(s.id);
    if (items) next.set(s.id, items);
    out.set(s.id, items);
    if (!own && s.offline !== true) missing.push(s.id);
  }
  kept.current = next;
  // Keyed on what is to be asked (ids, online and missing), not on the array: a new array each render asks nothing more.
  const want = missing.join('\n');
  useEffect(() => {
    const was = asked.current;
    asked.current = new Map();
    if (want === '') return;
    for (const id of want.split('\n')) {
      asked.current.set(id, snapshotSeq);
      if (was.get(id) !== snapshotSeq) client.send({ type: 'session.thread', id });
    }
  }, [client, want, snapshotSeq]);
  return out;
}

/** Le fil d'une session (useThreads pour elle seule). */
export function useThread(client: Pick<DaemonClient, 'send'>, session: Session): ThreadItem[] | undefined {
  return useThreads(client, [session]).get(session.id);
}
