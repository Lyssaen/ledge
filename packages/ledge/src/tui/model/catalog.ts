import type { Projects, Role, Session, Team, TeamTemplate } from '@ledge/protocol';

/** A folder whose roles « Équipes » reads (`roles.list {cwd}`); `cwd: null` is « Perso seulement », `~/.ledge` alone. */
export interface Scope { cwd: string | null; label: string }

/** What « Équipes » hands « Nouvelle session » on ↵: the folder, its project, and the role, or the template (team mode). */
export interface LaunchPrefill { cwd: string | null; project: string | null; role?: Role; template?: string }

/** The catalog's memory across screens: the last folder chosen (undefined: none yet) and the launch to prefill. */
export interface CatalogMemo { folder?: string | null; launch?: LaunchPrefill }

const isLocal = (s: Session) => !s.machineId || s.machineId === 'local';

/** The project a local folder belongs to: the one with this repository, or one of its parents. */
export function projectOfFolder(projects: Projects | null, cwd: string | null): string | null {
  if (!cwd) return null;
  const hit = (projects?.projects ?? []).find(p => p.repos.some(r => r.machine === 'local' && (cwd === r.path || cwd.startsWith(`${r.path}/`))));
  return hit?.id ?? null;
}

/** The folders `c` steps through: the selected session's repository, the last one chosen, each project's first local
 *  repository, the local recents; then « Perso seulement ». */
export function catalogScopes(o: { selected: Session | null; memo: CatalogMemo; projects: Projects | null; recents: readonly string[]; homeOnly: string }): Scope[] {
  const list = o.projects?.projects ?? [];
  const selected = o.selected && isLocal(o.selected) ? (o.selected.repoPath ?? o.selected.cwd) : undefined;
  const folders = [selected, o.memo.folder ?? undefined, ...list.map(p => p.repos.find(r => r.machine === 'local')?.path), ...o.recents.slice(0, 6)]
    .filter((x): x is string => !!x);
  const label = (cwd: string) => { const p = list.find(x => x.id === projectOfFolder(o.projects, cwd)); return p ? `${p.name} ${cwd}` : cwd; };
  return [...[...new Set(folders)].map((cwd): Scope => ({ cwd, label: label(cwd) })), { cwd: null, label: o.homeOnly }];
}

/** The scope « Équipes » opens on: the selected session's repository, else the last folder chosen, else the first. */
export function initialScope(scopes: readonly Scope[], selected: Session | null, memo: CatalogMemo): Scope {
  const own = selected && isLocal(selected) ? (selected.repoPath ?? selected.cwd) : undefined;
  return scopes.find(x => x.cwd === own) ?? (memo.folder !== undefined ? scopes.find(x => x.cwd === memo.folder) : undefined) ?? scopes[0]!;
}

/** The repository's definitions, then the home's, each by id as the daemon sends them. */
export const bySource = <T extends { source: 'repo' | 'home' }>(list: readonly T[]): { repo: T[]; home: T[] } =>
  ({ repo: list.filter(x => x.source === 'repo'), home: list.filter(x => x.source === 'home') });

/** The templates with a seat in this role. */
export const usedIn = (id: string, templates: readonly TeamTemplate[]): TeamTemplate[] => templates.filter(x => x.seats.some(s => s.role === id));

/** The live sessions in this role, with their team's name when they sit in one; in `project` when it is given. */
export function heldBy(id: string, sessions: readonly Session[], teams: readonly Team[], project: string | null, projectIdOf: (s: Session) => string | null): Array<{ name: string; team?: string }> {
  return sessions.filter(s => s.role === id && s.state !== 'exited' && (project === null || projectIdOf(s) === project))
    .map(s => ({ name: s.name, team: teams.find(x => x.id === s.team && x.state !== 'dissolved')?.name }));
}

/** `list[i ± by]`, wrapping; 0 for an empty list. */
export const stepIndex = (length: number, i: number, by: number): number => (length ? ((i + by) % length + length) % length : 0);
