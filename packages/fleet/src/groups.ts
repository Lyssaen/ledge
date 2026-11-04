import { pathKey, type Session } from '@ledge/protocol';

export interface SessionGroup { key: string; label: string; path: string; sessions: Session[] }

/** Sessions by repository, in the order their first session appears; a folder outside any repository is its own group. */
export function groupSessions(sessions: Session[]): SessionGroup[] {
  const out: SessionGroup[] = []; const by = new Map<string, SessionGroup>();
  for (const s of sessions) {
    const path = s.repoPath ?? s.cwd;
    // A Windows folder in two spellings (case, `/`) is one group; the first spelling seen names it.
    const key = s.repoId ? `git:${s.repoId}` : s.machineId ? `${s.machineId}:${pathKey(path)}` : pathKey(path); let g = by.get(key);
    if (!g) { g = { key, label: s.repo ?? s.project, path, sessions: [] }; by.set(key, g); out.push(g); }
    g.sessions.push(s);
  }
  return out;
}
