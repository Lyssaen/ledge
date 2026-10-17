import { z } from 'zod';
import { MachineIdSchema } from './machines.js';
import type { Session } from './session.js';

/** The eight project colours of the mockup, stored by key so a front may restyle them. */
export const PROJECT_COLORS = { blue: '#3b82f6', green: '#10b981', amber: '#f59e0b', violet: '#8b5cf6', teal: '#14b8a6', pink: '#ec4899', red: '#ef4444', slate: '#64748b' } as const;
export const ProjectColorSchema = z.enum(['blue', 'green', 'amber', 'violet', 'teal', 'pink', 'red', 'slate']);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;

export const ProjectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** An absolute POSIX path as the projects store it: trimmed, no repeated slash, no trailing slash but for `/`. */
export function normalizePath(raw: string): string {
  const p = raw.trim().replace(/\/+/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}
const PathSchema = z.string().max(4096).refine(p => p.startsWith('/') && p === normalizePath(p), 'an absolute, normalized path');

/** A folder on one machine: a Git repository or a plain folder (the branch is detected when shown, never stored). */
export const RepoSchema = z.object({ machine: MachineIdSchema, path: PathSchema });
export type Repo = z.infer<typeof RepoSchema>;

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().trim().min(1).max(80),
  color: ProjectColorSchema,
  description: z.string().max(500).default(''),
  repos: z.array(RepoSchema).max(50)
});
export type Project = z.infer<typeof ProjectSchema>;

/** « Dossier → projet », remembered when an agent is put away: that folder and what is under it, on that machine. */
export const RuleSchema = z.object({ machine: MachineIdSchema, path: PathSchema, project: ProjectIdSchema });
export type Rule = z.infer<typeof RuleSchema>;

export type ProjectsProblemCode = 'duplicate_id' | 'duplicate_name' | 'duplicate_repo' | 'duplicate_rule' | 'unknown_project';
export interface ProjectsProblem { code: ProjectsProblemCode; path: (string | number)[] }

/** What makes a set of projects inconsistent as a whole; the editor shows them, the daemon refuses on them. */
export function projectsProblems(p: { projects: readonly Project[]; rules: readonly Rule[] }): ProjectsProblem[] {
  const out: ProjectsProblem[] = [];
  const ids = new Set<string>(), names = new Set<string>(), repos = new Set<string>(), rules = new Set<string>();
  p.projects.forEach((project, i) => {
    if (ids.has(project.id)) out.push({ code: 'duplicate_id', path: ['projects', i, 'id'] });
    ids.add(project.id);
    const name = project.name.trim().toLocaleLowerCase();
    if (names.has(name)) out.push({ code: 'duplicate_name', path: ['projects', i, 'name'] });
    names.add(name);
    project.repos.forEach((repo, j) => {
      const key = `${repo.machine}\n${repo.path}`;
      if (repos.has(key)) out.push({ code: 'duplicate_repo', path: ['projects', i, 'repos', j] });
      repos.add(key);
    });
  });
  p.rules.forEach((rule, i) => {
    const key = `${rule.machine}\n${rule.path}`;
    if (rules.has(key)) out.push({ code: 'duplicate_rule', path: ['rules', i] });
    rules.add(key);
    if (!ids.has(rule.project)) out.push({ code: 'unknown_project', path: ['rules', i, 'project'] });
  });
  return out;
}

export const ProjectsSchema = z.object({ projects: z.array(ProjectSchema).max(100), rules: z.array(RuleSchema).max(1000) }).superRefine((p, ctx) => {
  for (const problem of projectsProblems(p)) ctx.addIssue({ code: 'custom', message: problem.code, path: problem.path });
});
export type Projects = z.infer<typeof ProjectsSchema>;

export const DEFAULT_PROJECTS: Projects = { projects: [], rules: [] };

const under = (cwd: string, path: string) => path === '/' || cwd === path || cwd.startsWith(`${path}/`);

/**
 * The project a session belongs to (build spec §5): among the repos and rules of the session's machine whose folder holds its
 * `cwd`, the deepest wins; on the same folder a rule (the user put the agent away) wins over a repo. `null`: « Sans projet ».
 */
export function projectOf(session: Pick<Session, 'machineId' | 'cwd'>, state: Projects): string | null {
  const machine = session.machineId ?? 'local';
  const cwd = normalizePath(session.cwd);
  const known = new Set(state.projects.map(p => p.id));
  const candidates = [
    ...state.projects.flatMap(p => p.repos.filter(r => r.machine === machine).map(r => ({ project: p.id, path: r.path, rule: false }))),
    ...state.rules.filter(r => r.machine === machine && known.has(r.project)).map(r => ({ project: r.project, path: r.path, rule: true }))
  ].filter(c => under(cwd, c.path));
  candidates.sort((x, y) => y.path.length - x.path.length || Number(y.rule) - Number(x.rule));
  return candidates[0]?.project ?? null;
}
