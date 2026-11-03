import { isArchived, type Helper, type Projects, type Session } from '@ledge/protocol';
import { fold, taskOf } from '../../nav/agents';

const UNASSIGNED = 'Sans projet';

export const branchOf = (s: Pick<Session, 'branch'>): string => s.branch?.trim() || 'main';


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
  /** The project's sessions, by branch. */
  branches: BranchGroup[];
}

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

function projectGroup(id: string | null, name: string, sessions: readonly Session[]): ProjectGroup {
  const branches = branchGroups(sessions);
  const repo = sessions.find(s => s.repo)?.repo;
  return {
    id,
    name,
    ...(repo !== undefined ? { repo } : {}),
    flatten: id === null || branches.length <= 1,
    branches
  };
}

/** A live agent (docs/mockups/ledge-projects-eye.html): neither ended nor archived — working, waiting, in error, at rest or offline. */
export const isLive = (s: Session): boolean => s.state !== 'exited' && !isArchived(s);

/** The projects the tree shows by the eye (docs/mockups/ledge-projects-eye.html). Pressed: those with a live agent, and how many of
 *  the others it hides. Released: every project of the registry, those without a session included; « Sans projet » only with
 *  sessions. A project still shows while a session is dragged (to be dropped on it) and while it is the filter. */
export function eyeGroups(groups: readonly ProjectGroup[], hideDone: boolean, keep: { dragging: boolean; filter?: string | null | undefined }): { shown: ProjectGroup[]; hidden: number } {
  const sessions = (g: ProjectGroup) => g.branches.flatMap(b => b.sessions);
  const kept = (g: ProjectGroup) => (g.id !== null && keep.dragging) || (g.id !== null && keep.filter === g.id);
  // « Sans projet » is no project of the registry: without a session it is nowhere, neither shown nor counted.
  const real = groups.filter(g => g.id !== null || sessions(g).length > 0);
  const shown = real.filter(g => kept(g) || !hideDone || sessions(g).some(isLive));
  return { shown, hidden: hideDone ? real.length - shown.length : 0 };
}

export function treeModel(
  sessions: readonly Session[],
  projects: Projects | null,
  projectIdOf: (s: Session) => string | null
): ProjectGroup[] {
  if (!projects) return [projectGroup(null, UNASSIGNED, sessions)];
  const groups = projects.projects.map(p => projectGroup(p.id, p.name, sessions.filter(s => projectIdOf(s) === p.id)));
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
