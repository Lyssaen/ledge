import { useEffect, useRef } from 'react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { useDaemon, type DaemonClient } from '@ledge/fleet';

/** The session's thread (spec §9.1: the full thread from `session.thread`, then live `session.thread.item`). Asked once per
 *  snapshot while not loaded (a snapshot empties the live threads); a frozen session cannot be asked and keeps what it had (R10). */
export function useThreadRequest(client: DaemonClient, session: Session): ThreadItem[] | undefined {
  const { threads, snapshotSeq } = useDaemon();
  const items = threads.get(session.id);
  const loaded = items !== undefined;
  const asked = useRef(new Set<string>());
  const key = `${session.id}#${snapshotSeq}`;
  useEffect(() => {
    if (loaded || session.offline || asked.current.has(key)) return;
    asked.current.add(key);
    client.send({ type: 'session.thread', id: session.id });
  }, [client, key, loaded, session.id, session.offline]);
  return items;
}
