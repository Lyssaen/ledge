import { splitId, type MachineState } from '@ledge/fleet';
import { pickName, type ClientMessage, type Project, type Repo, type RepoInfo, type Session } from '@ledge/protocol';

export type Tool = Session['tool'];
/** Harnesses that take several folders (Claude Code: `--add-dir`); the others get one repository at a time. */
export const MULTI_REPO_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['claude']);
export const LAUNCH_TIMEOUT_MS = 20_000;
export type LaunchMessage = Extract<ClientMessage, { type: 'session.launch' }>;
/** `repos` are paths on `machine`. */
export interface LaunchForm { tool: Tool | null; prompt: string; project: string | null; machine: string | null; repos: string[] }
export type Missing = 'tool' | 'prompt' | 'machine' | 'repos';
type Infos = ReadonlyMap<string, RepoInfo>;

/** Online: what the fleet takes (connected, fresh, its snapshot there), not merely a socket open. */
export const isUp = (m: MachineState) => m.ready;
const find = (projects: readonly Project[], id: string | null) => projects.find(p => p.id === id);
const usable = (infos: Infos | undefined, path: string) => infos?.get(path)?.exists !== false;

/** The project's repositories on the machine, in the project's order. */
export function reposOn(project: Project | undefined, machine: string | null): Repo[] {
  return machine === null ? [] : (project?.repos.filter(r => r.machine === machine) ?? []);
}

function firstRepo(project: Project | undefined, machine: string | null, infos?: Infos): string[] {
  const r = reposOn(project, machine).find(r => usable(infos, r.path));
  return r ? [r.path] : [];
}

export function launchDefaults(projects: readonly Project[], machines: readonly MachineState[], wanted: { project?: string; filter?: string }, infos?: Infos): LaunchForm {
  const project = (find(projects, wanted.project ?? null) ?? find(projects, wanted.filter ?? null) ?? projects[0])?.id ?? null;
  const up = machines.filter(isUp);
  const machine = (up.find(m => m.id === 'local') ?? up[0])?.id ?? null;
  return { tool: null, prompt: '', project, machine, repos: firstRepo(find(projects, project), machine, infos) };
}

export function withProject(f: LaunchForm, projects: readonly Project[], id: string, infos?: Infos): LaunchForm {
  return { ...f, project: id, repos: firstRepo(find(projects, id), f.machine, infos) };
}
export function withMachine(f: LaunchForm, projects: readonly Project[], machine: string, infos?: Infos): LaunchForm {
  return { ...f, machine, repos: firstRepo(find(projects, f.project), machine, infos) };
}
export function withTool(f: LaunchForm, tool: Tool): LaunchForm {
  return { ...f, tool, repos: MULTI_REPO_TOOLS.has(tool) ? f.repos : f.repos.slice(0, 1) };
}
export function toggleRepo(f: LaunchForm, path: string): LaunchForm {
  if (f.tool !== null && !MULTI_REPO_TOOLS.has(f.tool)) return { ...f, repos: [path] };
  return { ...f, repos: f.repos.includes(path) ? f.repos.filter(p => p !== path) : [...f.repos, path] };
}

/** The first missing field: agent, instruction, machine (none online, or the chosen one went down), repository. */
export function missingOf(f: LaunchForm, machines: readonly MachineState[]): Missing | null {
  if (f.tool === null) return 'tool';
  if (!f.prompt.trim()) return 'prompt';
  if (f.machine === null || !machines.some(m => m.id === f.machine && isUp(m))) return 'machine';
  if (f.repos.length === 0) return 'repos';
  return null;
}

/** The free name on the machine (its unfinished sessions) and the seat: the table's main agents, as the Atelier seats them (all states), plus one. */
export function previewOf(f: LaunchForm, sessions: readonly Session[], projectIdOf: (s: Session) => string | null): { name: string; seat: number } {
  const machineOf = (s: Session) => splitId(s.id)?.machine ?? s.machineId ?? 'local';
  const taken = sessions.filter(s => s.state !== 'exited' && machineOf(s) === f.machine).map(s => s.name);
  const seated = f.project === null ? 0 : sessions.filter(s => projectIdOf(s) === f.project).length;
  return { name: pickName(taken), seat: seated + 1 };
}

export function launchMessage(f: LaunchForm, name: string): LaunchMessage {
  const [cwd = '', ...rest] = f.repos;
  const tool = f.tool!;
  return { type: 'session.launch', tool, cwd, ...(MULTI_REPO_TOOLS.has(tool) && rest.length ? { dirs: rest } : {}), name, prompt: f.prompt.trim(), ...(f.machine ? { machineId: f.machine } : {}) };
}
