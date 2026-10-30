import { useCallback, useMemo, useState } from 'react';
import { useContextNear, type DaemonClient } from '@ledge/fleet';
import { CONTEXT_NEAR, contextNear, contextShare, type Session } from '@ledge/protocol';

/** What the fronts do about a session near its context limit (context handover spec §3): every command goes to the daemon. */
export interface Relief {
  /** Hands a session over to a fresh one at its seat (context handover spec §3.3): null once asked, else why not. */
  handover(session: string): Promise<string | null>;
  /** The sessions put away with « Plus tard », at the share they had (context handover spec §3.2): shared by « À toi » and « Le point ». */
  later: ReadonlyMap<string, number>;
  /** The context threshold (« Contexte max », the local daemon's): past it a session is near its limit. */
  near: number;
  putLater(session: Session): void;
}

let seq = 0;
export function useRelief(client: DaemonClient): Relief {
  const handover = useCallback((id: string) => new Promise<string | null>(resolve => {
    const rid = `handover-${Date.now()}-${++seq}`;
    const done = (r: string | null) => { clearTimeout(timer); off(); resolve(r); };
    const off = client.onMessage(m => { if (m.type === 'session.handover.result' && m.rid === rid) done(m.ok ? null : m.reason ?? '?'); });
    const timer = setTimeout(() => done(null), 4000);
    client.send({ type: 'session.handover', rid, id });
  }), [client]);
  const [later, setLater] = useState<ReadonlyMap<string, number>>(new Map());
  const near = useContextNear(client);
  const putLater = useCallback((s: Session) => setLater(m => new Map(m).set(s.id, contextShare(s.context) ?? 1)), []);
  return useMemo(() => ({ handover, later, putLater, near }), [handover, later, putLater, near]);
}

/**
 * The sessions « À toi » lists for their context (context handover spec §3.2): live ones past the threshold with no relief
 * under way, and those whose relief failed. « Plus tard » (`later`: the share it was put away at) hides one until it
 * grows by another 5 points.
 */
export function nearLimit(sessions: readonly Session[], later: ReadonlyMap<string, number> = new Map(), near: number = CONTEXT_NEAR): Session[] {
  return sessions.filter(s => {
    if (s.state === 'exited' || s.archivedAt) return false;
    if (s.handover?.state === 'failed') return later.get(s.id) === undefined;
    if (s.handover) return false;
    const share = contextShare(s.context);
    if (share === undefined || !contextNear(s.context, near)) return false;
    const put = later.get(s.id);
    return put === undefined || share >= put + 0.05;
  });
}
