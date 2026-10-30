import { isPending, liveHelpers, splitId } from '@ledge/fleet';
import type { FleetAsk } from '@ledge/fleet';
import { askShown, contextNear, projectOf, type Project, type ProjectColor, type Projects, type Session } from '@ledge/protocol';

/** A session row of the tree under its branch. */
export interface BranchRow { branch: string; sessions: Session[] }
/** A project of the tree: a project of the daemon's list, or a repository outside any (`color` absent). */
export interface ProjectNode { key: string; label: string; color?: ProjectColor; branches: BranchRow[]; count: number }
export interface Overview {
  /** The sessions waiting for the user, the oldest request first. */
  yours: Session[];
  /** The decisions waiting for the user (`ledge ask`), oldest first: also items of « À toi ». */
  asks: FleetAsk[];
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
export function overview(sessions: readonly Session[], projects: Projects | null, asks: readonly FleetAsk[] = []): Overview {
  const live = listed(sessions);
  const yours = live.filter(isPending).sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt) || a.id.localeCompare(b.id));
  const nodes = new Map<string, ProjectNode>();
  const known = new Map<string, Project>((projects?.projects ?? []).map(p => [p.id, p]));
  for (const p of projects?.projects ?? []) nodes.set(`p:${p.id}`, { key: `p:${p.id}`, label: p.name, color: p.color, branches: [], count: 0 });
  for (const s of live) {
    const pid = projects ? projectOf({ machineId: machineOf(s), cwd: s.cwd }, projects) : null;
    const key = pid && known.has(pid) ? `p:${pid}` : `r:${machineOf(s)}:${s.repoPath ?? s.cwd}`;
    let node = nodes.get(key);
    if (!node) { node = { key, label: s.repo ?? s.project, branches: [], count: 0 }; nodes.set(key, node); }
    const branch = s.branch ?? '-';
    let row = node.branches.find(b => b.branch === branch);
    if (!row) { row = { branch, sessions: [] }; node.branches.push(row); }
    row.sessions.push(s); node.count += 1;
  }
  const tree = [...nodes.values()].filter(n => n.count > 0);
  const order = tree.flatMap(n => n.branches.flatMap(b => b.sessions.map(s => s.id)));
  return { yours, asks: asks.filter(askShown).sort((a, b) => a.at.localeCompare(b.at)), tree, order, machines: new Set(live.map(machineOf)).size };
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

/** The latest messages between sessions, newest first: each session's `lastMessage`. A side is named by its live session, raw
 *  or qualified id alike, else by the name the journal kept. */
export function exchanges(sessions: readonly Session[], max: number): Array<{ at: string; from: string; to: string; summary: string }> {
  const bare = (id: string) => splitId(id)?.id ?? id;
  const find = (id: string) => sessions.find(x => x.id === id) ?? sessions.find(x => bare(x.id) === bare(id));
  return sessions.flatMap(s => {
    const m = s.lastMessage;
    if (!m) return [];
    const peer = m.peer ? find(m.peer) : undefined;
    return [{ at: m.at, from: s.name, to: peer?.name ?? m.to, summary: m.summary }];
  }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/** The sessions « À toi » lists for their context (context handover spec §3.2): live ones past 80 % with no relief under way, and failed reliefs. */
export const nearContext = (sessions: readonly Session[], near?: number): Session[] =>
  sessions.filter(s => s.state !== 'exited' && !s.archivedAt && (s.handover ? s.handover.state === 'failed' : contextNear(s.context, near)));

