import type { PhonePending, PhoneSession, RiskReason, Tool } from '@ledge/protocol';

/** One request waiting on the PC, as the inbox and the detail show it. */
export interface InboxItem {
  sessionId: string;
  /** The request's key: it covers its whole content, and goes back to the PC as `expect`. */
  key: string;
  kind: PhonePending['kind'];
  /** The inbox filter this request belongs to: plans and diffs count as authorisations. */
  filter: 'permission' | 'question';
  task: string;
  botName: string;
  tool: Tool;
  repo: string;
  branch?: string;
  worktree?: boolean;
  /** The session's last activity: the PC does not say when the request itself came. */
  since: string;
  text: string;
  body?: string;
  /** `body` was shortened; the whole one is asked with `session.pending`. */
  cut?: true;
  options?: string[];
  optionDetails?: string[];
  /** `high` needs a device check before it can be accepted. */
  risk: 'low' | 'high';
  riskReason: RiskReason;
}

export type Filter = 'all' | 'permission' | 'question';

/** Requests that carry a key (one without cannot be answered from here), the oldest first. */
export function requestsOf(sessions: PhoneSession[]): InboxItem[] {
  const items: InboxItem[] = [];
  for (const s of sessions) {
    const p = s.pending;
    if (!p?.key) continue;
    items.push({
      sessionId: s.id, key: p.key, kind: p.kind,
      filter: p.kind === 'question' ? 'question' : 'permission',
      task: s.topic ?? s.project, botName: s.name, tool: s.tool, repo: s.repo ?? s.project,
      ...(s.branch ? { branch: s.branch } : {}), ...(s.worktree ? { worktree: true } : {}),
      since: s.lastActivityAt, text: p.text,
      ...(p.body !== undefined ? { body: p.body } : {}), ...(p.cut ? { cut: true as const } : {}),
      ...(p.options ? { options: p.options } : {}), ...(p.optionDetails ? { optionDetails: p.optionDetails } : {}),
      risk: p.risk, riskReason: p.riskReason
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

export const firstLine = (t: string) => t.split('\n').find(l => l.trim())?.trim() ?? '';

export function headline(item: InboxItem): string {
  switch (item.kind) {
    case 'question': return item.text;
    case 'plan': return 'Plan à valider';
    case 'diff': return `Modifier ${firstLine(item.text)}`.trim();
    default: return firstLine(item.text);
  }
}
