import { projectOf } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';

const TOOLS: Record<Session['tool'], string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };
export const toolName = (tool: Session['tool']): string => TOOLS[tool];
export const taskOf = (s: Session): string => s.topic ?? s.title;

/** Agents grouped by project in the projects' order, « Sans projet » last (also for a project that is gone), oldest first (then by id) within a group. */
export function mainOrder(sessions: readonly Session[], projects: Projects | null): Session[] {
  const rank = (s: Session): number => {
    if (!projects) return 0;
    const id = projectOf(s, projects);
    const i = id === null ? -1 : projects.projects.findIndex(p => p.id === id);
    return i < 0 ? projects.projects.length : i;
  };
  const at = (s: Session) => Date.parse(s.startedAt) || 0;
  return [...sessions].sort((x, y) => rank(x) - rank(y) || at(x) - at(y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function searchSessions(sessions: readonly Session[], query: string, projectName: (s: Session) => string): Session[] {
  const q = fold(query.trim());
  if (!q) return [...sessions];
  return sessions.filter(s => fold([s.name, taskOf(s), toolName(s.tool), s.machineName ?? '', projectName(s)].join('\n')).includes(q));
}

export type Dot = 'working' | 'approval' | 'question' | 'done' | 'offline' | 'error';
export function dotOf(s: Session): Dot {
  if (s.offline) return 'offline';
  switch (s.state) {
    case 'waiting_permission': return 'approval';
    case 'waiting_input': return 'question';
    case 'exited': case 'idle': return 'done';
    case 'error': return 'error';
    default: return 'working';
  }
}
