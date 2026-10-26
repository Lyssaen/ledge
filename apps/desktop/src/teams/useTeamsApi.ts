import { useCallback, useMemo } from 'react';
import { useTasks, useTeams, type DaemonClient } from '@ledge/fleet';
import { LEDGE_GIVER, taskClosed, type Role, type Session, type Task, type Team, type TeamTemplate } from '@ledge/protocol';

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
  /** The roles and templates a folder can use, from the local daemon (`roles.list`); empty when it does not answer in time. */
  roles(cwd: string): Promise<{ roles: Role[]; templates: TeamTemplate[] }>;
}

let seq = 0;
export function useTeamsApi(client: DaemonClient): TeamsApi {
  const all = useTeams(client);
  const tasks = useTasks(client);
  const teams = useMemo(() => all?.filter(t => t.state !== 'dissolved') ?? null, [all]);
  const teamOf = useCallback((s: Pick<Session, 'team'>) => (s.team ? teams?.find(t => t.id === s.team) : undefined), [teams]);
  const roles = useCallback((cwd: string) => new Promise<{ roles: Role[]; templates: TeamTemplate[] }>(resolve => {
    const requestId = `roles-${Date.now()}-${++seq}`;
    const done = (r: { roles: Role[]; templates: TeamTemplate[] }) => { clearTimeout(timer); off(); resolve(r); };
    const off = client.onMessage(m => { if (m.type === 'roles.listing' && m.requestId === requestId) done({ roles: m.roles, templates: m.templates }); });
    const timer = setTimeout(() => done({ roles: [], templates: [] }), 4000);
    client.send({ type: 'roles.list', cwd, requestId });
  }), [client]);
  return useMemo(() => ({
    teams, tasks, teamOf, roles,
    join: (team, session, role) => client.send({ type: 'team.join', team, session, role }),
    leave: (team, session) => client.send({ type: 'team.leave', team, session }),
    resume: team => client.send({ type: 'team.resume', team }),
    dissolve: team => client.send({ type: 'team.dissolve', team }),
    seen: task => client.send({ type: 'task.cmd', rid: `seen-${++seq}`, by: LEDGE_GIVER, op: 'seen', task })
  }), [client, teams, tasks, teamOf, roles]);
}

/** A team's tasks Ledge gave: how many are done of how many given (« 1/2 »). */
export function ledgeProgress(tasks: readonly Task[], team: string): { done: number; given: number } {
  const mine = tasks.filter(t => t.team === team && t.giver === LEDGE_GIVER);
  return { done: mine.filter(t => t.state === 'done').length, given: mine.length };
}

/** A closed task Ledge gave and the user has not put away: an item of « À toi » (roles spec §3.7). */
export const closedLedgeTasks = (tasks: readonly Task[]): Task[] => tasks.filter(t => t.giver === LEDGE_GIVER && taskClosed(t) && !t.seen);
