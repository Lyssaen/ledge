import { isBusy, type FleetAsk } from '@ledge/fleet';
import type { Escalation, Helper, Projects, Rig, Session } from '@ledge/protocol';
import { isStandalone } from '@ledge/ui/rigs/model';
import { fold, taskOf } from '../../nav/agents';

const UNASSIGNED = 'Sans projet';

export const branchOf = (s: Pick<Session, 'branch'>): string => s.branch?.trim() || 'main';

/** Exited, or at rest with no subagent still at work (a background one outlives its parent's turn). */
export const isFinished = (s: Session): boolean =>
  !s.offline && (s.state === 'exited' || (s.state === 'idle' && !isBusy(s)));

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

/** `rigs`: the seats of a known rig leave the tree (they live in the Rigs section); without it only the brain session leaves. */
export function treeModel(
  sessions: readonly Session[],
  projects: Projects | null,
  projectIdOf: (s: Session) => string | null,
  rigs?: readonly Rig[]
): ProjectGroup[] {
  sessions = sessions.filter(s => isStandalone(s, rigs ?? []));
  if (!projects) return [projectGroup(null, UNASSIGNED, sessions)];
  const groups = projects.projects.map(p =>
    projectGroup(p.id, p.name, sessions.filter(s => projectIdOf(s) === p.id))
  );
  const loose = sessions.filter(s => projectIdOf(s) === null);
  if (loose.length) groups.push(projectGroup(null, UNASSIGNED, loose));
  return groups;
}

export type AttnKind = 'approval' | 'question' | 'error';

export interface SessionAttn {
  session: Session;
  helper?: Helper;
  kind: AttnKind;
  since: string;
}
/** What « À toi » lists: a standalone session waiting on the user, or a decision an OpenRig seat or the operator raised (lot 4). */
export type AttnItem = (SessionAttn) | { kind: 'escalation'; escalation: Escalation; since: string };

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

const byAge = (a: { since: string }, b: { since: string }): number => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0);

/**
 * « À toi »: the standalone sessions waiting on the user (rig seats are relieved by OpenRig, not Ledge: spec §8.1) and the pending or
 * grace `decision` escalations, oldest first. An `ask` is shown by the ask card (free-text reply), never here, and while a session has an
 * open ask its own line is dropped (matched by session name and machine).
 */
export function attentionOf(
  sessions: readonly Session[],
  waits: ReadonlyMap<string, { since: string }>,
  escalations: readonly Escalation[] = [],
  rigs?: readonly Rig[],
  asks: readonly Pick<FleetAsk, 'fromName' | 'machine' | 'state'>[] = []
): AttnItem[] {
  const open = (e: Escalation) => e.state === 'pending' || e.state === 'grace';
  const asking = new Set<string>([
    ...asks.filter(a => a.state === 'open').map(a => `${a.machine}\u0000${a.fromName}`),
    ...escalations.filter(e => e.source === 'ask' && open(e)).map(e => `${e.machine}\u0000${e.from}`)
  ]);
  const items: AttnItem[] = [];
  for (const session of sessions) {
    if (session.offline) continue;
    if (!isStandalone(session, rigs ?? [])) continue;
    if (asking.has(`${session.machineId ?? 'local'}\u0000${session.name}`)) continue;
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
  for (const escalation of escalations) {
    if (escalation.intent !== 'decision' || escalation.source === 'ask' || !open(escalation)) continue;
    items.push({ kind: 'escalation', escalation, since: escalation.createdAt });
  }
  return items.sort(byAge);
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
