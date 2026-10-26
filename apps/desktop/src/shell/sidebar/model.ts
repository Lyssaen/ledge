import type { Helper, Projects, Session, Team } from '@ledge/protocol';
import { teamProject } from '../../atelier/layout';
import { fold, taskOf } from '../../nav/agents';

const UNASSIGNED = 'Sans projet';

export const branchOf = (s: Pick<Session, 'branch'>): string => s.branch?.trim() || 'main';

export const isFinished = (s: Pick<Session, 'state' | 'offline'>): boolean =>
  !s.offline && (s.state === 'exited' || s.state === 'idle');

export interface BranchGroup {
  branch: string;
  worktree: boolean;
  sessions: Session[];
}

export interface ProjectGroup {
  id: string | null;
  name: string;
  repo?: string;
  flatten: boolean;
  /** The common table's sessions, by branch (all of them when the project has no team). */
  branches: BranchGroup[];
  /** The project's live teams (atelier rooms spec §3.4), each with its seats' sessions, after the common table. */
  teams: TeamGroup[];
}
export interface TeamGroup { team: Team; sessions: Session[] }

function branchGroups(sessions: readonly Session[]): BranchGroup[] {
  const byBranch = new Map<string, Session[]>();
  const order: string[] = [];
  for (const s of sessions) {
    const b = branchOf(s);
    if (!byBranch.has(b)) {
      byBranch.set(b, []);
      order.push(b);
    }
    byBranch.get(b)!.push(s);
  }
  return order.map(branch => {
    const group = byBranch.get(branch)!;
    return { branch, worktree: group.some(x => x.worktree), sessions: group };
  });
}

function projectGroup(id: string | null, name: string, sessions: readonly Session[], teams: readonly Team[] = []): ProjectGroup {
  const seated = (s: Session) => teams.some(t => t.id === s.team);
  const common = sessions.filter(s => !seated(s));
  const branches = branchGroups(common);
  const repo = sessions.find(s => s.repo)?.repo;
  return {
    id,
    name,
    ...(repo !== undefined ? { repo } : {}),
    flatten: id === null || branches.length <= 1,
    branches,
    teams: teams.map(team => ({ team, sessions: sessions.filter(s => s.team === team.id) }))
  };
}

export function treeModel(
  sessions: readonly Session[],
  projects: Projects | null,
  projectIdOf: (s: Session) => string | null,
  teams: readonly Team[] = []
): ProjectGroup[] {
  if (!projects) return [projectGroup(null, UNASSIGNED, sessions)];
  const live = teams.filter(t => t.state !== 'dissolved');
  const groups = projects.projects.map(p =>
    projectGroup(p.id, p.name, sessions.filter(s => projectIdOf(s) === p.id), live.filter(t => teamProject(t, projects) === p.id))
  );
  const loose = sessions.filter(s => projectIdOf(s) === null);
  if (loose.length) groups.push(projectGroup(null, UNASSIGNED, loose));
  return groups;
}

export type AttnKind = 'approval' | 'question' | 'error';

export interface AttnItem {
  session: Session;
  helper?: Helper;
  kind: AttnKind;
  since: string;
}

const attnKind = (state: Session['state']): AttnKind | null => {
  switch (state) {
    case 'waiting_permission': return 'approval';
    case 'waiting_input': return 'question';
    case 'error': return 'error';
    default: return null;
  }
};

/** Yes / No on a one-line card: a permission or a diff. A plan is read on its page.
 *  Offline and read-only (`hook_only`) are refused by `decisions.decide`. */
export function quickDecide(s: Pick<Session, 'offline' | 'source' | 'pending'>): boolean {
  if (s.offline || s.source === 'hook_only' || !s.pending) return false;
  const k = s.pending.kind;
  return k === 'permission' || k === 'diff';
}

export function attentionOf(
  sessions: readonly Session[],
  waits: ReadonlyMap<string, { since: string }>
): AttnItem[] {
  const items: AttnItem[] = [];
  for (const session of sessions) {
    if (session.offline) continue;
    const kind = attnKind(session.state);
    if (!kind) continue;
    const helperId = session.pending?.helperId;
    const helper = helperId ? session.helpers?.find(h => h.id === helperId) : undefined;
    items.push({
      session,
      ...(helper !== undefined ? { helper } : {}),
      kind,
      since: waits.get(session.id)?.since ?? session.lastActivityAt
    });
  }
  return items.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
}

export function filterArchived(
  archived: readonly Session[],
  q: string,
  projectName: (s: Session) => string
): Session[] {
  const query = fold(q.trim());
  if (!query) return [...archived];
  return archived.filter(s =>
    fold([s.name, taskOf(s), projectName(s)].join('\n')).includes(query)
  );
}
