import { useEffect, useRef } from 'react';
import { useDaemon, type DaemonClient } from '@ledge/fleet';
import type { Session, ThreadItem } from '@ledge/protocol';

/** Le fil d'une session : demandé une fois par snapshot tant qu'il manque, jamais pour une session hors ligne (elle garde ce qu'elle avait) ;
 *  pendant la nouvelle demande après un snapshot, les derniers éléments de la même session. */
export function useThread(client: Pick<DaemonClient, 'send'>, session: Session): ThreadItem[] | undefined {
  const { threads, snapshotSeq } = useDaemon();
  const own = threads.get(session.id);
  const asked = useRef<string | null>(null);
  const kept = useRef<{ id: string; items: ThreadItem[] } | null>(null);
  if (own) kept.current = { id: session.id, items: own };
  const offline = session.offline === true;
  useEffect(() => {
    if (own || offline) return;
    const key = `${session.id}@${snapshotSeq}`;
    if (asked.current === key) return;
    asked.current = key;
    client.send({ type: 'session.thread', id: session.id });
  }, [client, session.id, snapshotSeq, own, offline]);
  return own ?? (kept.current?.id === session.id ? kept.current.items : undefined);
}
