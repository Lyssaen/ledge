import { isPending, liveHelpers, splitId } from '@ledge/fleet';
import { LEDGE_GIVER, projectOf, taskClosed, type Project, type ProjectColor, type Projects, type Session, type Task, type Team } from '@ledge/protocol';

/** A session row of the tree under its branch. */
export interface BranchRow { branch: string; sessions: Session[] }
/** A project of the tree: a project of the daemon's list, or a repository outside any (`color` absent). */
export interface ProjectNode { key: string; label: string; color?: ProjectColor; branches: BranchRow[]; count: number;
  /** The project's live teams (roles spec §3.9), after its common table: each with its live seats and Ledge's tasks done of given. */
  teams: TeamRow[] }
export interface TeamRow { key: string; team: Team; sessions: Session[]; done: number; given: number }
export interface Overview {
  /** The sessions waiting for the user, the oldest request first. */
  yours: Session[];
  tree: ProjectNode[];
  /** Every session in the order `j`/`k` walks them: the tree's order. */
  order: string[];
  machines: number;
}

/** The sessions the overview lists: live ones (an exited session leaves the list; archived ones are not in `sessions`). */
export const listed = (sessions: readonly Session[]): Session[] => sessions.filter(s => s.state !== 'exited');

const machineOf = (s: Session): string => s.machineId ?? splitId(s.id)?.machine ?? 'local';

/** The tree: the daemon's projects in their order, then repositories outside any project in the order their first session
 *  started; inside each, branches in the order their first session started. A session without a branch sits under « - ». */
export function overview(sessions: readonly Session[], projects: Projects | null, teams: readonly Team[] = [], tasks: readonly Task[] = []): Overview {
  const live = listed(sessions);
  const yours = live.filter(isPending).sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt) || a.id.localeCompare(b.id));
  const nodes = new Map<string, ProjectNode>();
  const known = new Map<string, Project>((projects?.projects ?? []).map(p => [p.id, p]));
  for (const p of projects?.projects ?? []) nodes.set(`p:${p.id}`, { key: `p:${p.id}`, label: p.name, color: p.color, branches: [], count: 0, teams: [] });
  // A team's room is the project its folder falls in (the atelier's rule).
  const rooms = new Map<string, TeamRow>();
  for (const team of teams) {
    if (team.state === 'dissolved') continue;
    const pid = projects ? projectOf({ machineId: team.machine, cwd: team.cwd }, projects) ?? team.project : team.project;
    const node = pid ? nodes.get(`p:${pid}`) : undefined;
    if (!node) continue;
    const mine = tasks.filter(x => x.team === team.id && x.giver === LEDGE_GIVER);
    const row: TeamRow = { key: `${node.key}|team:${team.id}`, team, sessions: [], done: mine.filter(x => x.state === 'done').length, given: mine.length };
    node.teams.push(row); rooms.set(team.id, row);
  }
  for (const s of live) {
    const pid = projects ? projectOf({ machineId: machineOf(s), cwd: s.cwd }, projects) : null;
    const key = pid && known.has(pid) ? `p:${pid}` : `r:${machineOf(s)}:${s.repoPath ?? s.cwd}`;
    let node = nodes.get(key);
    if (!node) { node = { key, label: s.repo ?? s.project, branches: [], count: 0, teams: [] }; nodes.set(key, node); }
    const seat = s.team ? rooms.get(s.team) : undefined;
    if (seat && node.teams.includes(seat)) { seat.sessions.push(s); node.count += 1; continue; }
    const branch = s.branch ?? '-';
    let row = node.branches.find(b => b.branch === branch);
    if (!row) { row = { branch, sessions: [] }; node.branches.push(row); }
    row.sessions.push(s); node.count += 1;
  }
  const tree = [...nodes.values()].filter(n => n.count > 0 || n.teams.length > 0);
  const order = tree.flatMap(n => [...n.branches.flatMap(b => b.sessions.map(s => s.id)), ...n.teams.flatMap(x => x.sessions.map(s => s.id))]);
  return { yours, tree, order, machines: new Set(live.map(machineOf)).size };
}

/** The live helpers' count shown as `+n` next to a session. */
export const helperCount = (s: Session): number => liveHelpers(s).length;

/** The selection after the list changed: the same session while it is listed, else the one now at its place, else the first. */
export function keepSelection(order: readonly string[], selected: string | null, previous: readonly string[] = []): string | null {
  if (selected && order.includes(selected)) return selected;
  if (selected) {
    const at = previous.indexOf(selected);
    for (let i = at; i >= 0 && at >= 0; i--) if (order.includes(previous[i]!)) return previous[i]!;
  }
  return order[0] ?? null;
}

/** `j`/`k`: the next or previous session, wrapping. */
export function step(order: readonly string[], selected: string | null, by: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = selected ? order.indexOf(selected) : -1;
  return order[(at + by + order.length) % order.length]!;
}

/** `tab`: the next session waiting for the user after the selected one, wrapping. */
export function nextWaiting(yours: readonly Session[], selected: string | null): string | null {
  if (yours.length === 0) return null;
  const at = yours.findIndex(s => s.id === selected);
  return yours[(at + 1) % yours.length]!.id;
}

/** The latest messages between sessions, newest first, from each session's `lastMessage`; with `tasks`, the tasks Ledge
 *  gave are exchanges too, Ledge as their sender (roles spec §3.9). */
export function exchanges(sessions: readonly Session[], max: number, tasks: readonly Task[] = [], ledge = 'Ledge'): Array<{ at: string; from: string; to: string; summary: string }> {
  const byId = new Map(sessions.map(s => [s.id, s]));
  return [...sessions.flatMap(s => {
    const m = s.lastMessage;
    if (!m) return [];
    const peer = m.peer ? (byId.get(m.peer) ?? sessions.find(x => splitId(x.id)?.id === m.peer)) : undefined;
    return [{ at: m.at, from: s.name, to: peer?.name ?? m.to, summary: m.summary }];
  }), ...tasks.filter(x => x.giver === LEDGE_GIVER).map(x => ({ at: x.at, from: ledge, to: x.ownerName, summary: x.title }))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/** The closed tasks Ledge gave that the user has not put away: items of « À toi » (roles spec §3.7). */
export const closedLedgeTasks = (tasks: readonly Task[]): Task[] => tasks.filter(x => x.giver === LEDGE_GIVER && taskClosed(x) && !x.seen);
