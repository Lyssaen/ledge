import { groupSessions } from '@ledge/client';
import type { Session, Tool } from '@ledge/protocol';
import { copy } from '../copy';
import { requestsOf, type InboxItem } from './requests';

export type Tone = 'attention' | 'info' | 'ok' | 'muted' | 'danger';

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
}

const firstLine = (t: string) => t.split('\n').find(l => l.trim())?.trim() ?? '';

function statusOf(s: Session, pending: InboxItem | undefined): AgentRow['status'] {
  if (pending) return { tone: 'attention', label: pending.risk === 'high' && pending.kind !== 'question' ? copy.risk.badge : copy.kind[pending.kind] };
  switch (s.state) {
    case 'waiting_permission': return { tone: 'attention', label: copy.kind.permission };
    case 'waiting_input': return { tone: 'attention', label: copy.kind.question };
    case 'idle': return { tone: 'ok', label: copy.agents.state.idle };
    case 'exited': return { tone: 'muted', label: copy.agents.state.exited };
    case 'error': return { tone: 'danger', label: copy.agents.state.error };
    default: return { tone: 'info', label: copy.agents.state.working };
  }
}

function lastOf(s: Session, pending: InboxItem | undefined): string {
  if (pending) return pending.kind === 'question' ? pending.text : (firstLine(pending.text) || copy.kind[pending.kind]);
  const reply = s.lastReply ? firstLine(s.lastReply.text) : '';
  if (reply) return reply;
  return s.state === 'working' ? copy.agents.working : '';
}

/** The sessions by repository, in the order the PC lists them, each as a row. */
export function agentsOf(sessions: Session[]): Array<{ label: string; rows: AgentRow[] }> {
  const pendings = new Map(requestsOf(sessions).map(i => [i.sessionId, i]));
  return groupSessions(sessions).map(g => ({
    label: g.label,
    rows: g.sessions.map((s): AgentRow => {
      const pending = pendings.get(s.id);
      return {
        sessionId: s.id, task: s.topic ?? s.project, botName: s.name, tool: s.tool,
        ...(s.branch ? { branch: s.branch } : {}), ...(s.worktree ? { worktree: true } : {}),
        last: lastOf(s, pending), status: statusOf(s, pending), unread: s.unread === true,
        ...(pending ? { pending } : {})
      };
    })
  }));
}
