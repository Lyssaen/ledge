import type { Session } from '@ledge/protocol';

export interface SessionGroup { key: string; label: string; path: string; sessions: Session[] }

/** Sessions by repository, in the order their first session appears; a folder outside any repository is its own group. */
export function groupSessions(sessions: Session[]): SessionGroup[] {
  const out: SessionGroup[] = []; const by = new Map<string, SessionGroup>();
  for (const s of sessions) {
    const key = s.repoPath ?? s.cwd; let g = by.get(key);
    if (!g) { g = { key, label: s.repo ?? s.project, path: key, sessions: [] }; by.set(key, g); out.push(g); }
    g.sessions.push(s);
  }
  return out;
}

/** The order the list shows: the sessions group by group. Digits, J/K and the handle all follow it. */
export const displayOrder = (sessions: Session[]): Session[] => groupSessions(sessions).flatMap(g => g.sessions);

/** How many group headers sit above the row of `id` (0 when the id is not listed). */
export function headersBefore(groups: SessionGroup[], id: string | null): number {
  let n = 0;
  for (const g of groups) { n++; if (g.sessions.some(s => s.id === id)) return n; }
  return 0;
}

/** `/home/<user>/x` and `/Users/<user>/x` as `~/x`. */
export const tildePath = (p: string): string => p.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~');
