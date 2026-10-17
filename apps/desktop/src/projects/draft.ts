import { normalizePath, type Project, type ProjectColor, type Projects, type Repo, type Session } from '@ledge/protocol';
import { newProjectId, withProject, withRule } from '@ledge/fleet';
import { ruleFor } from '../atelier/filing';

/** The mockup's colour order (the keys of PROJECT_COLORS). */
export const COLOR_ORDER: readonly ProjectColor[] = ['blue', 'green', 'amber', 'violet', 'teal', 'pink', 'red', 'slate'];

/** `file`: the ids of the sessions to put away in the project too (checked). */
export interface ProjectDraft { id?: string; name: string; color: ProjectColor; description: string; repos: Repo[]; file: string[] }

export function draftOf(p: Project): ProjectDraft {
  return { id: p.id, name: p.name, color: p.color, description: p.description, repos: p.repos.map(r => ({ ...r })), file: [] };
}

/** A new project: the first unused colour (else `blue`); from « Ranger dans… › Nouveau projet… », the session's folder as a repo and the session checked. */
export function newDraft(state: Projects, from?: Session): ProjectDraft {
  const used = new Set(state.projects.map(p => p.color));
  return {
    name: '',
    color: COLOR_ORDER.find(c => !used.has(c)) ?? 'blue',
    description: '',
    repos: from ? [{ machine: from.machineId ?? 'local', path: normalizePath(from.cwd) }] : [],
    file: from ? [from.id] : []
  };
}

export type DraftProblem = { code: 'name_empty' } | { code: 'name_taken' } | { code: 'repo_duplicate'; index: number } | { code: 'gone' };

// projectsProblems ignores case only; the editor ignores accents too.
const key = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleLowerCase();

/** The first problem that prevents saving: gone, name_empty, name_taken, repo_duplicate. */
export function draftProblem(d: ProjectDraft, state: Projects): DraftProblem | null {
  if (d.id !== undefined && !state.projects.some(p => p.id === d.id)) return { code: 'gone' };
  const name = key(d.name);
  if (name === '') return { code: 'name_empty' };
  if (state.projects.some(p => p.id !== d.id && key(p.name) === name)) return { code: 'name_taken' };
  const seen = new Set<string>();
  for (const [index, r] of d.repos.entries()) {
    const k = `${r.machine}\n${normalizePath(r.path)}`;
    if (seen.has(k)) return { code: 'repo_duplicate', index };
    seen.add(k);
  }
  return null;
}

/** Another project (not the draft's own) that also owns this repo. */
export function alsoIn(repo: Repo, d: ProjectDraft, state: Projects): Project | undefined {
  return state.projects.find(p => p.id !== d.id && p.repos.some(r => r.machine === repo.machine && normalizePath(r.path) === normalizePath(repo.path)));
}

/** The state to send: the project (id kept, or `newProjectId` for a new one), then a rule for each checked session. */
export function afterSave(state: Projects, d: ProjectDraft, sessions: readonly Session[]): { next: Projects; id: string } {
  const name = d.name.trim();
  const id = d.id ?? newProjectId(name, state.projects.map(p => p.id));
  let next = withProject(state, { id, name, color: d.color, description: d.description, repos: d.repos.map(r => ({ machine: r.machine, path: normalizePath(r.path) })) });
  for (const s of sessions) if (d.file.includes(s.id)) next = withRule(next, ruleFor(s, id));
  return { next, id };
}

/** What deleting will do: the agents at the table (by `projectIdOf`) and the project's rules. */
export function deletion(state: Projects, id: string, sessions: readonly Session[], projectIdOf: (s: Session) => string | null): { agents: Session[]; rules: number } {
  return { agents: sessions.filter(s => projectIdOf(s) === id), rules: state.rules.filter(r => r.project === id).length };
}

/** Confirmed when the broadcast holds the project as sent: id, name, colour, description, repos in order. */
export function saved(state: Projects, sent: Project): boolean {
  const p = state.projects.find(x => x.id === sent.id);
  return !!p && p.name === sent.name && p.color === sent.color && p.description === sent.description
    && p.repos.length === sent.repos.length && p.repos.every((r, i) => r.machine === sent.repos[i]!.machine && r.path === sent.repos[i]!.path);
}

export function removed(state: Projects, id: string): boolean {
  return !state.projects.some(p => p.id === id);
}
