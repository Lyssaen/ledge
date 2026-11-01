import type { Projects, Role, Session, Team, TeamTemplate } from '@ledge/protocol';

/** A folder whose roles « Équipes » reads (`roles.list {cwd}`) on its machine (#99); `cwd: null` is « Perso seulement »,
 *  the local `~/.ledge` alone. */
export interface Scope { cwd: string | null; machine: string; label: string }

/** What « Équipes » hands « Nouvelle session » on ↵: the folder, its machine, its project, and the role, or the template (team mode). */
export interface LaunchPrefill { cwd: string | null; machine: string; project: string | null; role?: Role; template?: string }

/** The catalog's memory across screens: the last folder chosen (undefined: none yet) and its machine, and the launch to prefill. */
export interface CatalogMemo { folder?: string | null; machine?: string; launch?: LaunchPrefill }

/** A folder on a machine, as the fleet's machines list their recents. */
export interface Place { machine: string; cwd: string }

const machineOf = (s: Session) => s.machineId ?? 'local';

/** The project a folder of `machine` belongs to: the one with this repository there, or one of its parents. */
export function projectOfFolder(projects: Projects | null, cwd: string | null, machine = 'local'): string | null {
  if (!cwd) return null;
  const hit = (projects?.projects ?? []).find(p => p.repos.some(r => r.machine === machine && (cwd === r.path || cwd.startsWith(`${r.path}/`))));
  return hit?.id ?? null;
}

/** The folders `c` steps through, each on its machine: the selected session's repository, the last one chosen, each
 *  project's first repository (a local one first), the machines' recents; then « Perso seulement ». */
export function catalogScopes(o: { selected: Session | null; memo: CatalogMemo; projects: Projects | null; recents: readonly Place[]; homeOnly: string }): Scope[] {
  const list = o.projects?.projects ?? [];
  const selected = o.selected ? { machine: machineOf(o.selected), cwd: o.selected.repoPath ?? o.selected.cwd } : undefined;
  const memo = o.memo.folder ? { machine: o.memo.machine ?? 'local', cwd: o.memo.folder } : undefined;
  const firsts = list.map(p => { const r = p.repos.find(x => x.machine === 'local') ?? p.repos[0]; return r && { machine: r.machine, cwd: r.path }; });
  const places = [selected, memo, ...firsts, ...o.recents.slice(0, 6)].filter((x): x is Place => !!x?.cwd);
  const seen = new Set<string>();
  const label = (x: Place) => { const p = list.find(y => y.id === projectOfFolder(o.projects, x.cwd, x.machine)); return p ? `${p.name} ${x.cwd}` : x.cwd; };
  return [
    ...places.filter(x => { const k = `${x.machine}\0${x.cwd}`; if (seen.has(k)) return false; seen.add(k); return true; }).map((x): Scope => ({ cwd: x.cwd, machine: x.machine, label: label(x) })),
    { cwd: null, machine: 'local', label: o.homeOnly }
  ];
}

/** The scope « Équipes » opens on: the selected session's repository, else the last folder chosen, else the first. */
export function initialScope(scopes: readonly Scope[], selected: Session | null, memo: CatalogMemo): Scope {
  const own = selected ? scopes.find(x => x.machine === machineOf(selected) && x.cwd === (selected.repoPath ?? selected.cwd)) : undefined;
  const last = memo.folder !== undefined ? scopes.find(x => x.cwd === memo.folder && (memo.folder === null || x.machine === (memo.machine ?? 'local'))) : undefined;
  return own ?? last ?? scopes[0]!;
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
