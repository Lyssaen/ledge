import type { PhoneSession, Tool } from '@ledge/protocol';
import { copy } from '../copy';
import { firstLine, requestsOf, type InboxItem } from './requests';

export type Tone = 'approval' | 'attention' | 'info' | 'ok' | 'muted' | 'danger';

/** As on the desktop: an accord waits in red, a question in amber, a plan or a change to read in blue. */
export const kindTone: Record<InboxItem['kind'], Tone> = { permission: 'approval', question: 'attention', plan: 'info', diff: 'info' };

/** One session of the « Agents » list. */
export interface AgentRow {
  sessionId: string;
  /** What the session is about, shown first. */
  task: string;
  botName: string;
  tool: Tool;
  branch?: string;
  worktree?: boolean;
  last: string;
  /** A state always has a label; the tone only colours it. A waiting request carries its kind (or « Impact élevé »). */
  status: { tone: Tone; label: string };
  unread: boolean;
  pending?: InboxItem;
  /** Its role in its team (roles spec): drawn as a pill. */
  role?: string;
}

function statusOf(s: PhoneSession, pending: InboxItem | undefined): AgentRow['status'] {
  if (pending) {
    const high = pending.risk === 'high' && pending.kind !== 'question';
    return { tone: high ? 'danger' : kindTone[pending.kind], label: high ? copy.risk.badge : copy.kind[pending.kind] };
  }
  switch (s.state) {
    case 'waiting_permission': return { tone: 'approval', label: copy.kind.permission };
    case 'waiting_input': return { tone: 'attention', label: copy.kind.question };
    case 'idle': return { tone: 'ok', label: copy.agents.state.idle };
    case 'exited': return { tone: 'muted', label: copy.agents.state.exited };
    case 'error': return { tone: 'danger', label: copy.agents.state.error };
    default: return { tone: 'info', label: copy.agents.state.working };
  }
}

function lastOf(s: PhoneSession, pending: InboxItem | undefined): string {
  if (pending) return pending.kind === 'question' ? pending.text : (firstLine(pending.text) || copy.kind[pending.kind]);
  const reply = s.lastReply ? firstLine(s.lastReply.text) : '';
  if (reply) return reply;
  return s.state === 'working' ? copy.agents.working : '';
}

/**
 * The sessions by repository (a folder outside any repository by its project), in the order the PC lists them.
 * The phone gets no folder, so a repository and a project of the same name stay two groups.
 */
function groupsOf(sessions: PhoneSession[]): Array<{ label: string; sessions: PhoneSession[] }> {
  const groups = new Map<string, { label: string; sessions: PhoneSession[] }>();
  for (const s of sessions) {
    const id = s.repo ? `repo:${s.repo}` : `project:${s.project}`;
    let g = groups.get(id);
    if (!g) groups.set(id, g = { label: s.repo ?? s.project, sessions: [] });
    g.sessions.push(s);
  }
  return [...groups.values()];
}

/** The sessions by repository, in the order the PC lists them, each as a row. */
export function agentsOf(sessions: PhoneSession[]): Array<{ label: string; rows: AgentRow[] }> {
  const pendings = new Map(requestsOf(sessions).map(i => [i.sessionId, i]));
  return groupsOf(sessions).map(g => ({
    label: g.label,
    rows: g.sessions.map((s): AgentRow => {
      const pending = pendings.get(s.id);
      return {
        sessionId: s.id, task: s.topic ?? s.project, botName: s.name, tool: s.tool,
        ...(s.branch ? { branch: s.branch } : {}), ...(s.worktree ? { worktree: true } : {}),
        last: lastOf(s, pending), status: statusOf(s, pending), unread: s.unread, ...(s.role ? { role: s.role } : {}),
        ...(pending ? { pending } : {})
      };
    })
  }));
}
