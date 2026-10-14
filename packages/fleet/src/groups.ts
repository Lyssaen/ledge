import type { Session } from '@ledge/protocol';

export interface SessionGroup { key: string; label: string; path: string; sessions: Session[] }

/** Sessions by repository, in the order their first session appears; a folder outside any repository is its own group. */
export function groupSessions(sessions: Session[]): SessionGroup[] {
  const out: SessionGroup[] = []; const by = new Map<string, SessionGroup>();
  for (const s of sessions) {
    const path = s.repoPath ?? s.cwd;
    const key = s.repoId ? `git:${s.repoId}` : s.machineId ? `${s.machineId}:${path}` : path; let g = by.get(key);
    if (!g) { g = { key, label: s.repo ?? s.project, path, sessions: [] }; by.set(key, g); out.push(g); }
    g.sessions.push(s);
  }
  return out;
}
