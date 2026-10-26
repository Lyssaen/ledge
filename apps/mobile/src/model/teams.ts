import type { PhoneSession, PhoneTask, PhoneTeam } from '@ledge/protocol';
import { agentsOf, type AgentRow } from './agents';

/** A task Ledge gave that came to an end: done, refused or dropped. */
export const taskClosed = (t: PhoneTask): boolean => t.state === 'done' || t.state === 'refused' || t.state === 'dropped';

/** The closed tasks of Ledge not put away yet, the oldest first: items of « À toi » and « À traiter ». */
export function closedTasks(tasks: Iterable<PhoneTask>): PhoneTask[] {
  return [...tasks].filter(t => taskClosed(t) && !t.seen).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** The open tasks of Ledge, the latest first: « Confiées par Ledge ». */
export function openTasks(tasks: Iterable<PhoneTask>): PhoneTask[] {
  return [...tasks].filter(t => !taskClosed(t)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One table of a project as « Agents » draws it: a team (active or resting), or the common table. */
export type Table =
  | { kind: 'team'; team: PhoneTeam; rows: AgentRow[] }
  | { kind: 'common'; rows: AgentRow[] };

/**
 * The sessions by project, then by table (ledge home spec §2.4): the active teams first, then the common table, then
 * the resting teams. A team none of whose sessions the phone knows is drawn in a group of its own project's name.
 */
export function tablesOf(sessions: PhoneSession[], teams: PhoneTeam[] | null): Array<{ label: string; key: string; tables: Table[] }> {
  const byId = new Map((teams ?? []).map(t => [t.id, t]));
  const teamOf = new Map(sessions.map(s => [s.id, s.team && byId.has(s.team) ? s.team : undefined]));
  const placed = new Set<string>();
  const groups = agentsOf(sessions).map(g => {
    const common: AgentRow[] = [];
    const seated = new Map<string, AgentRow[]>();
    for (const r of g.rows) {
      const team = teamOf.get(r.sessionId);
      if (!team) { common.push(r); continue; }
      seated.set(team, [...(seated.get(team) ?? []), r]);
    }
    const ofState = (state: PhoneTeam['state']): Table[] => [...seated].flatMap(([id, rows]) => {
      const team = byId.get(id)!;
      if (team.state !== state) return [];
      placed.add(id);
      return [{ kind: 'team' as const, team, rows }];
    });
    const tables: Table[] = [...ofState('active'), ...(common.length ? [{ kind: 'common' as const, rows: common }] : []), ...ofState('resting')];
    return { label: g.label, key: g.rows[0]!.sessionId, tables };
  });
  // Teams with no known session: by their project, active first.
  const alone = (teams ?? []).filter(t => !placed.has(t.id)).sort((a, b) => (a.state === b.state ? 0 : a.state === 'active' ? -1 : 1));
  const extra = new Map<string, Table[]>();
  for (const t of alone) {
    const label = t.project ?? t.name;
    extra.set(label, [...(extra.get(label) ?? []), { kind: 'team', team: t, rows: [] }]);
  }
  return [...groups, ...[...extra].map(([label, tables]) => ({ label, key: `team:${label}`, tables }))];
}
