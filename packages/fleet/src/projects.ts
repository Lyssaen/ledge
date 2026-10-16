import { normalizePath, type Project, type Projects, type Repo, type Rule, type Session } from '@ledge/protocol';

const under = (cwd: string, path: string) => path === '/' || cwd === path || cwd.startsWith(`${path}/`);
const sameFolder = (a: { machine: string; path: string }, b: { machine: string; path: string }) => a.machine === b.machine && a.path === b.path;

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

/** Adds a project, or replaces the one with its id where it stands. */
export function withProject(state: Projects, project: Project): Projects {
  const i = state.projects.findIndex(p => p.id === project.id);
  return { ...state, projects: i < 0 ? [...state.projects, project] : state.projects.map((p, j) => (j === i ? project : p)) };
}

/** Removes a project. With `moveTo`, its rules point there and its repos join that project; with `null` they go too. */
export function withoutProject(state: Projects, id: string, moveTo: string | null): Projects {
  const gone = state.projects.find(p => p.id === id);
  const target = moveTo !== null && moveTo !== id && state.projects.some(p => p.id === moveTo) ? moveTo : null;
  const projects = state.projects.filter(p => p.id !== id).map(p => {
    if (p.id !== target || !gone) return p;
    const repos: Repo[] = [...p.repos];
    for (const r of gone.repos) if (!repos.some(x => sameFolder(x, r))) repos.push(r);
    return { ...p, repos };
  });
  const rules = state.rules.flatMap(r => (r.project !== id ? [r] : target ? [{ ...r, project: target }] : []));
  return { projects, rules };
}

/** Remembers « this folder → this project »: replaces the rule for the same folder on the same machine, else adds it. */
export function withRule(state: Projects, rule: Rule): Projects {
  const next = { ...rule, path: normalizePath(rule.path) };
  return { ...state, rules: [...state.rules.filter(r => !sameFolder(r, next)), next] };
}

/** A readable id from the name (« Payment Service » → `payment-service`), suffixed `-2`, `-3`… when taken. */
export function newProjectId(name: string, taken: readonly string[]): string {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'project';
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n++) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`;
}
