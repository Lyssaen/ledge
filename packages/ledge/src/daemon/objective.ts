import { TASK_TITLE_MAX, type Team, type TeamObjective } from '@ledge/protocol';

/** The objective task's title: the goal's first non-empty line, cut to TASK_TITLE_MAX with `…` when longer. */
export function objectiveTitle(goal: string): string {
  const first = goal.split(/\r\n|\r|\n/).map(l => l.trim()).find(l => l.length > 0) ?? goal.trim();
  return first.length > TASK_TITLE_MAX ? `${first.slice(0, TASK_TITLE_MAX - 1)}…` : first;
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
