import { LEADER_ROLE, TASK_TITLE_MAX, type Session, type Team, type TeamObjective } from '@ledge/protocol';

/** The objective task's title: the goal's first non-empty line, cut to TASK_TITLE_MAX with `…` when longer. The cut falls between
 *  code points, never inside a surrogate pair; the length stays counted in UTF-16 units, as the schema's `max` counts. */
export function objectiveTitle(goal: string): string {
  const first = goal.split(/\r\n|\r|\n/).map(l => l.trim()).find(l => l.length > 0) ?? goal.trim();
  if (first.length <= TASK_TITLE_MAX) return first;
  let kept = '';
  for (const cp of Array.from(first)) { if (kept.length + cp.length > TASK_TITLE_MAX - 1) break; kept += cp; }
  return `${kept}…`;
}

/** A team's lead and the other seats as they started (a session ended, or never spawned, is not there), and the crew its notice names:
 *  `@role (name, tool)` each, or `personne d'autre`. */
export function crewOf(team: Pick<Team, 'seats'>, get: (id: string) => Session | undefined): { leader?: Session; others: Array<{ role: string; session: Session }>; crew: string } {
  const sessionOf = (seat: Team['seats'][number]) => { const s = seat.sessionId ? get(seat.sessionId) : undefined; return s && s.state !== 'exited' ? s : undefined; };
  const lead = team.seats.find(s => s.role === LEADER_ROLE);
  const leader = lead && sessionOf(lead);
  const others = team.seats.filter(s => s !== lead).flatMap(s => { const x = sessionOf(s); return x ? [{ role: s.role, session: x }] : []; });
  const crew = others.length ? others.map(o => `@${o.role} (${o.session.name}, ${o.session.tool})`).join(', ') : "personne d'autre";
  return { ...(leader ? { leader } : {}), others, crew };
}

/** The objective task's detail: the whole goal, the team's folder, then the branch and the « done » test when given. */
export function objectiveText(team: Pick<Team, 'cwd'>, o: TeamObjective): string {
  return [`Objectif : ${o.goal}`, `Dépôt : ${team.cwd}`, ...(o.branch ? [`Branche : ${o.branch}`] : []), ...(o.done ? [`Fini quand : ${o.done}`] : [])].join('\n');
}

/** What the lead is typed at launch: its task, how to run the team, and who is in it (`crew`: the other seats, or `personne d'autre`). */
export function leadNotice(team: Pick<Team, 'name'>, taskId: string, text: string, crew: string): string {
  return `Tu es le lead de l'équipe ${team.name}. Ta tâche ${taskId} est l'objectif :\n${text}\nPrends-la (ledge task take ${taskId}), découpe le travail et confie chaque morceau à un siège (ledge task give @<rôle> "<titre>" "<détail>") ; leurs résultats te reviennent. Quand l'objectif est atteint : ledge task done ${taskId} "<résultat>". Ton équipe : ${crew}.`;
}

/** What every other seat is typed at launch: the lead has the objective, wait for its task. */
export function waitNotice(team: Pick<Team, 'name'>, role: string, leadName: string): string {
  return `Tu es @${role} dans l'équipe ${team.name}. Le lead (@leader, ${leadName}) a l'objectif et va te confier une tâche : attends-la, ne commence rien d'autre.`;
}

/** The objective's reason added to a launch whose lead did not start: no task is given. */
export const LEAD_NOT_STARTED = "objectif non donné : le lead n'a pas démarré";
