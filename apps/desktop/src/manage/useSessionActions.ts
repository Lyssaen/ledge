import { useEffect, useRef, useState } from 'react';
import { canManage, type DaemonClient, type DaemonError, type MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

export type ManageKind = 'end' | 'archive' | 'delete';

/** What a confirmation says: who, how many still work, who cannot be stopped (their machine is out of reach), whether the archive is involved and how many subagents go along. */
export interface Confirm { kind: ManageKind; names: string[]; live: number; offline: string[]; archived: boolean; kids: number; ids: string[] }

export interface SessionActions {
  /** Ending and deleting ask first; archiving asks only when it must stop a session that still works. Otherwise it is sent at once (archiving with an « Annuler » toast). */
  request(kind: ManageKind, ids: string[]): void;
  resume(id: string): void;
  restore(id: string): void;
  pending: Confirm | null;
  confirm(): void;
  cancel(): void;
  /** False when the session's machine cannot archive, restore, resume or delete (an older daemon): nothing is sent to it. */
  allowed(id: string): boolean;
}

/** How long the « Annuler » of an archiving lives (an ordinary toast: 6 s). */
export const UNDO_MS = 8000;
const MANAGE_REQUESTS: ReadonlySet<string> = new Set(['session.kill', 'session.archive', 'session.restore', 'session.resume', 'session.delete']);

/** A session still runs when its machine answers and it has not exited. */
const isLive = (s: Session) => !s.offline && s.state !== 'exited';

/** End (`session.kill`), archive, resume, restore and delete, with the confirmation each needs, the undo of an archiving, and the daemon's
 *  refusals said in a toast. Only principal sessions are known here: a subagent's id (or any unknown one) is ignored. */
export function useSessionActions(o: { client: Pick<DaemonClient, 'send'>; sessions: readonly Session[]; archived: readonly Session[]; machines: readonly MachineState[]; errors: readonly DaemonError[]; notify: (text: string, action?: { label: string; run(): void; ms?: number }) => void }): SessionActions {
  const { client, sessions, archived, machines, errors, notify } = o;
  const { t } = useI18n();
  const [pending, setPending] = useState<Confirm | null>(null);
  const byId = new Map<string, Session>();
  for (const s of sessions) byId.set(s.id, s);
  for (const s of archived) byId.set(s.id, s);
  const inArchive = new Set(archived.map(s => s.id));

  const allowedSession = (s: Session) => { const m = machines.find(x => x.id === s.machineId); return m !== undefined && canManage(m); };
  const allowed = (id: string) => { const s = byId.get(id); return s !== undefined && allowedSession(s); };

  const archiveNow = (list: Session[]) => {
    for (const s of list) client.send({ type: 'session.archive', id: s.id });
    const ids = list.map(s => s.id);
    const run = () => { for (const id of ids) client.send({ type: 'session.restore', id }); };
    const kids = list.reduce((n, s) => n + s.helpers.length, 0);
    notify(list.length === 1 ? t.manage.archived(list[0]!.name, kids) : t.manage.archivedMany(list.length), { label: t.manage.undo, run, ms: UNDO_MS });
  };

  const request: SessionActions['request'] = (kind, ids) => {
    const seen = new Set<string>();
    let list: Session[] = [];
    for (const id of ids) {
      const s = byId.get(id);
      if (s && !seen.has(id)) { seen.add(id); list.push(s); }
    }
    // Ending needs nothing new from the daemon, and a session that does not run (or cannot be reached) has nothing to stop.
    list = kind === 'end' ? list.filter(s => isLive(s) && !inArchive.has(s.id)) : list.filter(s => allowedSession(s) && (kind === 'delete' || !inArchive.has(s.id)));
    if (list.length === 0) return;
    const live = list.filter(s => isLive(s) && !inArchive.has(s.id));
    if (kind === 'archive' && live.length === 0) { archiveNow(list); return; }
    setPending({
      kind, ids: list.map(s => s.id), names: list.map(s => s.name), live: live.length, kids: list.reduce((n, s) => n + s.helpers.length, 0),
      offline: kind === 'end' ? [] : list.filter(s => s.offline && !inArchive.has(s.id)).map(s => s.name),
      archived: list.some(s => inArchive.has(s.id))
    });
  };

  const confirm = () => {
    const c = pending;
    if (!c) return;
    setPending(null);
    const list = c.ids.map(id => byId.get(id)).filter((s): s is Session => s !== undefined);
    if (c.kind === 'archive') archiveNow(list);
    else for (const s of list) client.send(c.kind === 'end' ? { type: 'session.kill', id: s.id } : { type: 'session.delete', id: s.id });
  };

  const sendOne = (type: 'session.resume' | 'session.restore', id: string, wanted: (s: Session) => boolean) => {
    const s = byId.get(id);
    if (s && allowedSession(s) && wanted(s)) client.send({ type, id });
  };

  // The daemon's refusals of these messages, each judged once, in order (as decisions.ts does).
  const latest = useRef({ byId, t, notify });
  latest.current = { byId, t, notify };
  const seen = useRef(errors.at(-1)?.seq ?? 0);
  useEffect(() => {
    const last = errors.at(-1)?.seq ?? 0;
    if (last < seen.current) seen.current = 0; // the store started over
    for (const e of errors) {
      if (e.seq <= seen.current) continue;
      seen.current = e.seq;
      if (e.id === undefined || !e.request || !MANAGE_REQUESTS.has(e.request)) continue;
      const { byId: known, t: tr, notify: say } = latest.current;
      say(tr.manage.refused(known.get(e.id)?.name ?? e.id, e.message));
    }
  }, [errors]);

  return {
    request,
    resume: id => sendOne('session.resume', id, () => true),
    restore: id => sendOne('session.restore', id, s => inArchive.has(s.id)),
    pending, confirm, cancel: () => setPending(null), allowed
  };
}
