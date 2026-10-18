import { normalizePath, type Project, type ProjectColor, type Projects, type Repo, type Session } from '@ledge/protocol';
import { newProjectId, withProject, withRule, type Proposal, type Why } from '@ledge/fleet';
import { ruleFor } from '../atelier/filing';

/** The mockup's colour order (the keys of PROJECT_COLORS). */
export const COLOR_ORDER: readonly ProjectColor[] = ['blue', 'green', 'amber', 'violet', 'teal', 'pink', 'red', 'slate'];

/** `file`: the ids of the sessions to put away in the project too (checked). `proposed`: the repositories Ledge proposed (by
 *  `repoKey`), with their reason and their box; an unchecked one stays listed but counts nowhere (problems, save, count). */
export interface ProjectDraft { id?: string; name: string; color: ProjectColor; description: string; repos: Repo[]; file: string[]; proposed?: Record<string, { why: Why; checked: boolean }> }

/** A repository's key: machine and normalised path. */
export const repoKey = (machine: string, path: string): string => `${machine}\n${normalizePath(path)}`;

const counts = (d: ProjectDraft, r: Repo) => d.proposed?.[repoKey(r.machine, r.path)]?.checked !== false;
/** The repositories that count: all of them but the proposed ones unchecked. */
export function keptRepos(d: ProjectDraft): Repo[] {
  return d.repos.filter(r => counts(d, r));
}

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

/** A proposal laid on the draft (« Laisser Ledge faire », or one opened by the navigation): with a target that still exists, the
 *  draft becomes that project (the draft itself when it already is, its edits kept; else the target's repositories, then the
 *  draft's own, a seeded folder included), else the proposal's name, colour and description (the description typed kept).
 *  The proposed repositories follow, checked, with their reason (one already listed is not added again); the proposal's sessions
 *  join the draft's ones to file, checked. A listed repository another project has stays `repo_taken` (draftProblem). */
export function applyProposal(d: ProjectDraft, p: Proposal, state: Projects): ProjectDraft {
  const target = p.targetId === undefined ? undefined : state.projects.find(x => x.id === p.targetId);
  const { id: _own, ...fresh } = d;
  const base: ProjectDraft = target ? (d.id === target.id ? d : onto(draftOf(target), d))
    : { ...fresh, name: p.name, color: p.color, description: d.description || p.description };
  const listed = new Set(base.repos.map(r => repoKey(r.machine, r.path)));
  const repos = [...base.repos];
  const proposed = { ...base.proposed };
  for (const r of p.repos) {
    const k = repoKey(r.machine, r.path);
    if (listed.has(k)) continue;
    listed.add(k);
    repos.push({ machine: r.machine, path: normalizePath(r.path) });
    proposed[k] = { why: r.why, checked: true };
  }
  return { ...base, repos, file: [...new Set([...base.file, ...p.file])], proposed };
}

/** The target's draft with `d`'s own repositories after (those it does not have already), its sessions to file and its boxes. */
function onto(target: ProjectDraft, d: ProjectDraft): ProjectDraft {
  const has = new Set(target.repos.map(r => repoKey(r.machine, r.path)));
  return { ...target, repos: [...target.repos, ...d.repos.filter(r => !has.has(repoKey(r.machine, r.path)))], file: [...d.file], ...(d.proposed ? { proposed: d.proposed } : {}) };
}

/** The draft of a proposal opened by the navigation: a new project, or its target's draft with the proposed repositories after. */
export function draftFromProposal(p: Proposal, state: Projects): ProjectDraft {
  return applyProposal(newDraft(state), p, state);
}

/** `repo_taken`: a repository that another project (`project`, its id) already has: a repository belongs to one project only
 *  (`projectOf` needs a single answer, and the daemon refuses `duplicate_repo` across projects). */
export type DraftProblem = { code: 'name_empty' } | { code: 'name_taken' } | { code: 'repo_duplicate'; index: number } | { code: 'repo_taken'; index: number; project: string } | { code: 'gone' };

/** A project name as the editor compares them (name_taken, the chat's `addTo`): projectsProblems ignores case only; the editor
 *  ignores accents too. */
export const nameKey = (name: string): string => name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleLowerCase();

/** The first problem that prevents saving: gone, name_empty, name_taken, repo_duplicate, repo_taken. */
export function draftProblem(d: ProjectDraft, state: Projects): DraftProblem | null {
  if (d.id !== undefined && !state.projects.some(p => p.id === d.id)) return { code: 'gone' };
  const name = nameKey(d.name);
  if (name === '') return { code: 'name_empty' };
  if (state.projects.some(p => p.id !== d.id && nameKey(p.name) === name)) return { code: 'name_taken' };
  // Indexes in `d.repos`; an unchecked proposed repository is skipped.
  const seen = new Set<string>();
  for (const [index, r] of d.repos.entries()) {
    if (!counts(d, r)) continue;
    const k = repoKey(r.machine, r.path);
    if (seen.has(k)) return { code: 'repo_duplicate', index };
    seen.add(k);
  }
  for (const [index, r] of d.repos.entries()) {
    if (!counts(d, r)) continue;
    const owner = alsoIn(r, d, state);
    if (owner) return { code: 'repo_taken', index, project: owner.id };
  }
  return null;
}

/** Another project (not the draft's own) that also owns this repo. */
export function alsoIn(repo: Repo, d: ProjectDraft, state: Projects): Project | undefined {
  return state.projects.find(p => p.id !== d.id && p.repos.some(r => r.machine === repo.machine && normalizePath(r.path) === normalizePath(repo.path)));
}

/** The state to send: the project (id kept, or `newProjectId` for a new one) with the repositories that count, then a rule for each checked session. */
export function afterSave(state: Projects, d: ProjectDraft, sessions: readonly Session[]): { next: Projects; id: string } {
  const name = d.name.trim();
  const id = d.id ?? newProjectId(name, state.projects.map(p => p.id));
  let next = withProject(state, { id, name, color: d.color, description: d.description, repos: keptRepos(d).map(r => ({ machine: r.machine, path: normalizePath(r.path) })) });
  for (const s of sessions) if (d.file.includes(s.id)) next = withRule(next, ruleFor(s, id));
  return { next, id };
}

/** What deleting will do: the agents at the table (by `projectIdOf`) and the project's rules. */
export function deletion(state: Projects, id: string, sessions: readonly Session[], projectIdOf: (s: Session) => string | null): { agents: Session[]; rules: number } {
  return { agents: sessions.filter(s => projectIdOf(s) === id), rules: state.rules.filter(r => r.project === id).length };
}

/** The same values to save (the id aside): name, colour, description, repositories that count in order, agents to file. */
export function sameDraft(a: ProjectDraft, b: ProjectDraft): boolean {
  const ra = keptRepos(a), rb = keptRepos(b);
  return a.name === b.name && a.color === b.color && a.description === b.description
    && ra.length === rb.length && ra.every((r, i) => r.machine === rb[i]!.machine && normalizePath(r.path) === normalizePath(rb[i]!.path))
    && a.file.length === b.file.length && a.file.every((x, i) => x === b.file[i]);
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
