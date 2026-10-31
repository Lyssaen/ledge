import { LEDGE_GIVER, type PhoneSession, type PhoneTask, type PhoneTeam } from '@ledge/protocol';
import { agentsOf, type AgentRow } from './agents';

/** A task Ledge gave that came to an end: done, refused or dropped. */
export const taskClosed = (t: PhoneTask): boolean => t.state === 'done' || t.state === 'refused' || t.state === 'dropped';

/** A decision a session put to the user (`ledge task give ledge …`): its owner is Ledge, never one of Ledge's own tasks. */
export const isDecision = (t: PhoneTask): boolean => t.owner === LEDGE_GIVER;

/** A task Ledge gave: a PC that predates `giver` sent only those. */
const givenByLedge = (t: PhoneTask): boolean => (t.giver ?? LEDGE_GIVER) === LEDGE_GIVER && !isDecision(t);

/** The decisions not answered yet, the oldest first: items of « À toi », answered through the chat's card. */
export function openDecisions(tasks: Iterable<PhoneTask>): PhoneTask[] {
  return [...tasks].filter(t => isDecision(t) && !taskClosed(t)).sort((a, b) => a.at.localeCompare(b.at));
}

/** The closed tasks of Ledge not put away yet, the oldest first: items of « À toi » and « À traiter ». */
export function closedTasks(tasks: Iterable<PhoneTask>): PhoneTask[] {
  return [...tasks].filter(t => givenByLedge(t) && taskClosed(t) && !t.seen).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** The open tasks of Ledge, the latest first: « Confiées par Ledge ». */
export function openTasks(tasks: Iterable<PhoneTask>): PhoneTask[] {
  return [...tasks].filter(t => givenByLedge(t) && !taskClosed(t)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  // Teams with no known session: in the group of their project (its name, whatever its case), else a group of their own;
  // an active one before the common table, a resting one at the end.
  const alone = (teams ?? []).filter(t => !placed.has(t.id));
  const extra = new Map<string, Table[]>();
  for (const t of alone) {
    const label = t.project ?? t.name;
    const table: Table = { kind: 'team', team: t, rows: [] };
    const home = groups.find(g => g.label.toLowerCase() === label.toLowerCase());
    if (home) {
      if (t.state === 'resting') home.tables.push(table);
      else home.tables.splice(home.tables.filter(x => x.kind === 'team' && x.team.state === 'active').length, 0, table);
      continue;
    }
    extra.set(label, [...(extra.get(label) ?? []), table].sort((a, b) => (a.kind === 'team' && b.kind === 'team' && a.team.state !== b.team.state ? (a.team.state === 'active' ? -1 : 1) : 0)));
  }
  return [...groups, ...[...extra].map(([label, tables]) => ({ label, key: `team:${label}`, tables }))];
}
