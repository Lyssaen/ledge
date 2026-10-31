import { useCallback, useMemo, useState } from 'react';
import { useContextNear, useTasks, useTeams, type DaemonClient } from '@ledge/fleet';
import { CONTEXT_NEAR, contextNear, contextShare, LEDGE_GIVER, openDecision, taskClosed, type DefinitionProblem, type Role, type Session, type Task, type Team, type TeamTemplate } from '@ledge/protocol';

/** What `roles.list` answers for a folder: its roles and templates, and the files skipped with why (`problems`). */
export interface RolesListing { roles: Role[]; templates: TeamTemplate[]; problems: DefinitionProblem[];
  /** The daemon did not answer in time: nothing is known of the folder (not an empty one). */
  silent?: true;
  /** The folder's machine could not answer (#99): 'offline', or 'outdated' for a daemon without roles.list. */
  error?: string }
const SILENT: RolesListing = { roles: [], templates: [], problems: [], silent: true };

/** What the fronts do with the local daemon's teams and Ledge's tasks (roles spec §3.3, §3.7): every command goes to the
 *  daemon, whose broadcast (`team.updated`, `task.updated`) changes what is shown. */
export interface TeamsApi {
  /** The live teams (dissolved ones left out); null while the daemon has not spoken of teams. */
  teams: Team[] | null;
  tasks: Task[];
  teamOf(s: Pick<Session, 'team'>): Team | undefined;
  join(team: string, session: string, role: string): void;
  leave(team: string, session: string): void;
  resume(team: string): void;
  dissolve(team: string): void;
  /** Puts a closed task Ledge gave away from « À toi ». */
  seen(task: string): void;
  /** Hands a session over to a fresh one at its seat (context handover spec §3.3): null once asked, else why not. */
  handover(session: string): Promise<string | null>;
  /** The sessions put away with « Plus tard », at the share they had (context handover spec §3.2): shared by « À toi » and « Le point ». */
  later: ReadonlyMap<string, number>;
  /** The context threshold (« Contexte max », the local daemon's): past it a session is near its limit. */
  near: number;
  putLater(session: Session): void;
  /** The roles and templates a folder can use, and the files skipped, from its machine's daemon (`roles.list`, the local one by
   *  default); without a folder, `~/.ledge`'s alone. Empty and `silent` when it does not answer in time. */
  roles(cwd?: string, machine?: string): Promise<RolesListing>;
  /** The user's answer to a decision a session put to it: the registry's `task.answer`, confirmed (the one way an answer goes,
   *  never a `task.cmd done`). Undefined once done, else why not (ANSWER_SILENT when the daemon does not say in time). */
  answer(task: string, text: string): Promise<string | undefined>;
}

let seq = 0;
/** How long an answer's `action.result` is waited for, and what `answer` says past it: sent, its outcome unknown. */
export const ANSWER_TIMEOUT_MS = 8000;
export const ANSWER_SILENT = 'silent';
/** How long `roles.list` is waited for. */
export const ROLES_TIMEOUT_MS = 4000;
/** `roles.list` asked of a folder's machine (the local daemon by default): its answer, or `silent` past ROLES_TIMEOUT_MS. */
export const listRoles = (client: DaemonClient, cwd?: string, machine?: string) => new Promise<RolesListing>(resolve => {
  const requestId = `roles-${Date.now()}-${++seq}`;
  const done = (r: RolesListing) => { clearTimeout(timer); off(); resolve(r); };
  const off = client.onMessage(m => { if (m.type === 'roles.listing' && m.requestId === requestId) done({ roles: m.roles, templates: m.templates, problems: m.problems, ...(m.error ? { error: m.error } : {}) }); });
  const timer = setTimeout(() => done(SILENT), ROLES_TIMEOUT_MS);
  client.send({ type: 'roles.list', ...(cwd ? { cwd } : {}), ...(machine && machine !== 'local' ? { machineId: machine } : {}), requestId });
});
export function useTeamsApi(client: DaemonClient): TeamsApi {
  const all = useTeams(client);
  const tasks = useTasks(client);
  const teams = useMemo(() => all?.filter(t => t.state !== 'dissolved') ?? null, [all]);
  const teamOf = useCallback((s: Pick<Session, 'team'>) => (s.team ? teams?.find(t => t.id === s.team) : undefined), [teams]);
  const roles = useCallback((cwd?: string, machine?: string) => listRoles(client, cwd, machine), [client]);
  const handover = useCallback((id: string) => new Promise<string | null>(resolve => {
    const rid = `handover-${Date.now()}-${++seq}`;
    const done = (r: string | null) => { clearTimeout(timer); off(); resolve(r); };
    const off = client.onMessage(m => { if (m.type === 'session.handover.result' && m.rid === rid) done(m.ok ? null : m.reason ?? '?'); });
    const timer = setTimeout(() => done(null), 4000);
    client.send({ type: 'session.handover', rid, id });
  }), [client]);
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
    teams, tasks, teamOf, roles, handover, later, putLater, near, answer,
    join: (team, session, role) => client.send({ type: 'team.join', team, session, role }),
    leave: (team, session) => client.send({ type: 'team.leave', team, session }),
    resume: team => client.send({ type: 'team.resume', team }),
    dissolve: team => client.send({ type: 'team.dissolve', team }),
    seen: task => client.send({ type: 'task.cmd', rid: `seen-${++seq}`, by: LEDGE_GIVER, op: 'seen', task })
  }), [client, teams, tasks, teamOf, roles, handover, later, putLater, near, answer]);
}

/** A team's tasks Ledge gave: how many are done of how many given (« 1/2 »). */
export function ledgeProgress(tasks: readonly Task[], team: string): { done: number; given: number } {
  const mine = tasks.filter(t => t.team === team && t.giver === LEDGE_GIVER);
  return { done: mine.filter(t => t.state === 'done').length, given: mine.length };
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
