import { useCallback, useMemo, useState } from 'react';
import { useContextNear, useTasks, type DaemonClient } from '@ledge/fleet';
import { CONTEXT_NEAR, contextNear, contextShare, LEDGE_GIVER, openDecision, taskClosed, type Session, type Task } from '@ledge/protocol';

/** What the fronts do with Ledge's tasks and the sessions near their context limit: every command goes to the daemon, whose
 *  broadcast (`task.updated`, `sessions.updated`) changes what is shown. */
export interface TasksApi {
  tasks: Task[];
  /** Puts a closed task Ledge gave away from « À toi ». */
  seen(task: string): void;
  /** Hands a session over to a fresh one (context handover spec §3.3): null once asked, else why not. */
  handover(session: string): Promise<string | null>;
  /** The sessions put away with « Plus tard », at the share they had (context handover spec §3.2): shared by « À toi » and « Le point ». */
  later: ReadonlyMap<string, number>;
  /** The context threshold (« Contexte max », the local daemon's): past it a session is near its limit. */
  near: number;
  putLater(session: Session): void;
  /** The user's answer to a decision a session put to it: the registry's `task.answer`, confirmed (the one way an answer goes,
   *  never a `task.cmd done`). Undefined once done, else why not (ANSWER_SILENT when the daemon does not say in time). */
  answer(task: string, text: string): Promise<string | undefined>;
}

let seq = 0;
/** How long an answer's `action.result` is waited for, and what `answer` says past it: sent, its outcome unknown. */
export const ANSWER_TIMEOUT_MS = 8000;
export const ANSWER_SILENT = 'silent';
/** How long a handover's `session.handover.result` is waited for: past it, the ask is taken as sent. */
export const HANDOVER_TIMEOUT_MS = 4000;

/** « Passer le relais » (context handover spec §3.3): `session.handover` to the daemon; null once asked, else why not. */
export const requestHandover = (client: DaemonClient, id: string) => new Promise<string | null>(resolve => {
  const rid = `handover-${Date.now()}-${++seq}`;
  const done = (r: string | null) => { clearTimeout(timer); off(); resolve(r); };
  const off = client.onMessage(m => { if (m.type === 'session.handover.result' && m.rid === rid) done(m.ok ? null : m.reason ?? '?'); });
  const timer = setTimeout(() => done(null), HANDOVER_TIMEOUT_MS);
  client.send({ type: 'session.handover', rid, id });
});

export function useTasksApi(client: DaemonClient): TasksApi {
  const tasks = useTasks(client);
  const handover = useCallback((id: string) => requestHandover(client, id), [client]);
  const answer = useCallback((task: string, text: string) => new Promise<string | undefined>(resolve => {
    const rid = `answer-${Date.now()}-${++seq}`;
    const done = (r: string | undefined) => { clearTimeout(timer); off(); resolve(r); };
    const off = client.onMessage(m => { if (m.type === 'action.result' && m.rid === rid) done(m.reason); });
    const timer = setTimeout(() => done(ANSWER_SILENT), ANSWER_TIMEOUT_MS);
    client.send({ type: 'action.run', rid, action: 'task.answer', args: { task, answer: text }, confirmed: true });
  }), [client]);
  const [later, setLater] = useState<ReadonlyMap<string, number>>(new Map());
  const near = useContextNear(client);
  const putLater = useCallback((s: Session) => setLater(m => new Map(m).set(s.id, contextShare(s.context) ?? 1)), []);
  return useMemo(() => ({
    tasks, handover, later, putLater, near, answer,
    seen: task => client.send({ type: 'task.cmd', rid: `seen-${++seq}`, by: LEDGE_GIVER, op: 'seen', task })
  }), [client, tasks, handover, later, putLater, near, answer]);
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

/** A closed task Ledge gave and the user has not put away: an item of « À toi » (roles spec §3.7). */
export const closedLedgeTasks = (tasks: readonly Task[]): Task[] => tasks.filter(t => t.giver === LEDGE_GIVER && taskClosed(t) && !t.seen);

/** The decisions sessions put to the user (`ledge task give ledge …`), not answered yet: items of « À toi », oldest first. */
export const openDecisions = (tasks: readonly Task[]): Task[] => tasks.filter(openDecision);

/** The options a decision proposes, one per line of its text (a list's `-`, `*` or `1.` left out): aids, never the answer. */
export function decisionOptions(text: string | undefined): string[] {
  const lines = (text ?? '').split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  return lines.length > 1 && lines.length <= 8 ? lines : [];
}
