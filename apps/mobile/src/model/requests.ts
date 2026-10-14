import type { Pending, Session, Tool } from '@ledge/protocol';

/** One request waiting on the PC, as the inbox and the detail show it. Lot 2 adds `risk` and `riskReason` here. */
export interface InboxItem {
  sessionId: string;
  pendingId: string;
  pendingVersion: number;
  kind: Pending['kind'];
  /** The inbox filter this request belongs to: plans and diffs count as authorisations. */
  filter: 'permission' | 'question';
  task: string;
  botName: string;
  tool: Tool;
  repo: string;
  branch?: string;
  worktree?: boolean;
  since: string;
  text: string;
  reason?: string;
  options?: string[];
  /** Sessions only seen through hooks cannot be answered from here. */
  readOnly: boolean;
}

export type Filter = 'all' | 'permission' | 'question';

/** Requests that carry an id (older journals have none), the oldest first. */
export function requestsOf(sessions: Session[]): InboxItem[] {
  const items: InboxItem[] = [];
  for (const s of sessions) {
    const p = s.pending;
    if (!p?.id) continue;
    items.push({
      sessionId: s.id, pendingId: p.id, pendingVersion: p.version ?? 1, kind: p.kind,
      filter: p.kind === 'question' ? 'question' : 'permission',
      task: s.topic ?? s.project, botName: s.name, tool: s.tool, repo: s.repo ?? s.project,
      ...(s.branch ? { branch: s.branch } : {}), ...(s.worktree ? { worktree: true } : {}),
      since: p.since ?? s.lastActivityAt, text: p.text,
      ...(p.reason ? { reason: p.reason } : {}), ...(p.options ? { options: p.options } : {}),
      readOnly: s.source === 'hook_only'
    });
  }
  return items.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

export const filterItems = (items: InboxItem[], f: Filter): InboxItem[] => f === 'all' ? items : items.filter(i => i.filter === f);

export function ageLabel(since: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} j`;
}

const firstLine = (t: string) => t.split('\n').find(l => l.trim())?.trim() ?? '';

export function headline(item: InboxItem): string {
  switch (item.kind) {
    case 'question': return item.text;
    case 'plan': return 'Plan à valider';
    case 'diff': return `Modifier ${firstLine(item.text)}`.trim();
    default: return firstLine(item.text);
  }
}
