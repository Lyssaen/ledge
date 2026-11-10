import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DEFAULT_PROJECTS, type HarnessUsage, isArchived, projectOf, seatsByRole, taskClosed, type ChatStep, type OpenRigState, type Projects, type Recent, type Session, type Task } from '@ledge/protocol';
import { LEDGE_MD, writeLedgeMd, type LedgeInfo } from './guide.js';
import { writeNotes } from './notes.js';

/** `sessions`: every session the daemon holds, archived ones included (listed apart, for `session.restore`). */
export interface ContextInput { sessions: Session[]; recents?: Recent[]; projects?: Projects; tasks?: Task[];
  /** This PC's OpenRig as last read: `rigs.md` (its rigs, their seats by role, the kernel), only where OpenRig is installed. */
  rigs?: OpenRigState;
  /** The harnesses' account limits as the daemon last read them: `limits.md`, only where the daemon reads them. */
  usage?: readonly HarnessUsage[];
  /** What `ledge.md` holds (the guide, the version, the agents installed); no `ledge.md` when left out. */
  ledge?: LedgeInfo;
  /** The user's notes folder (`~/.ledge/context`): copied as `context-<name>.md` with `context-index.md`; none when left out. */
  notesDir?: string;
  capture: (s: Session) => Promise<string[] | null>; git: (cwd: string) => Promise<string | null>; now: string }
export interface Context { dir: string; steps: Map<string, ChatStep>; repoPaths: string[];
  /** `limits.md` was written: reading it reads the limits. */
  limits?: true }
/** The file that holds the limits: a turn that reads it is one a phone shows the limits under (M3 Q31). */
export const LIMITS_MD = 'limits.md';

const STATE: Record<Session['state'], string> = {
  starting: 'starting', working: 'working', waiting_permission: "waiting for the user's approval", waiting_input: 'asking the user a question',
  idle: 'idle, waiting for instructions', error: 'in error', exited: 'exited'
};

/**
 * The folder Ledge reads before answering (spec 2026-10-11 §5.3): `sessions.md` names every session and the files that
 * describe it; `folders.md` lists the recent folders; `ledge.md` what Ledge is and does; `context-index.md` and `context-<name>.md` the user's notes; `projects.md` the projects, their repositories and remembered folders (only where the daemon holds some); `pane-<id>.txt`, `reply-<id>.md` and `git-<id>.txt` exist only where there is something to read.
 */
export async function writeContext(dir: string, input: ContextInput): Promise<Context> {
  await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  const steps = new Map<string, ChatStep>();
  const projects = input.projects ?? DEFAULT_PROJECTS;
  // A daemon that holds no projects (a remote one) says nothing about them: the context it wrote before projects existed.
  const withProjects = projects.projects.length > 0 || projects.rules.length > 0;
  const nameOf = new Map(projects.projects.map(p => [p.id, oneLine(p.name)]));
  const lines = [`# Ledge sessions at ${input.now}`, '', 'Each session below lists the files that describe it, in this folder.', ''];
  const live = input.sessions.filter(s => !isArchived(s)); const archived = input.sessions.filter(isArchived);
  for (const s of live) {
    lines.push(`## ${s.name} (${s.tool}) — ${STATE[s.state]}`, `- id: ${s.id}`, `- topic: ${s.topic ?? '(none yet)'}`, `- folder: ${s.cwd}`,
      `- repository: ${s.repo ?? s.project}${s.branch ? `, branch ${s.branch}${s.worktree ? ' (linked worktree)' : ''}` : ''}`, `- started: ${s.startedAt}, last activity: ${s.lastActivityAt}`);
    if (s.machineName) lines.push(`- machine: ${oneLine(s.machineName)}${s.offline ? ' (unreachable: last known state)' : ''}`);
    // What session.model changes: the current one, so a request « passe-la sur Opus » is checked against it.
    if (s.model || s.effort) lines.push(`- model: ${s.model ?? "the agent's default"}${s.effort ? `, effort ${s.effort}` : ''}`);
    if (s.queue?.length) lines.push(`- queued instructions: ${s.queue.length} (sent once it is free)`);
    if (withProjects) lines.push(`- Project: ${nameOf.get(projectOf(s, projects) ?? '') ?? 'no project'}`);
    // Its context (context handover spec §3.2): past 80 % the user may hand it over to a fresh session (« Passer le relais »).
    if (s.context) lines.push(`- context: ${Math.round((s.context.used / s.context.window) * 100)} % of ${s.context.window} tokens (the user's threshold decides when it is near its limit; a relief is started from its « ⋯ » menu)`);
    if (s.handover) lines.push(`- relief: ${s.handover.state}${s.handover.toName ? `, relieved by ${oneLine(s.handover.toName)}` : ''}${s.handover.reason ? ` (${oneLine(s.handover.reason)})` : ''}`);
    if (s.relieves) lines.push(`- relieves ${oneLine(s.relieves.name)} (its context was full)`);
    if (s.source === 'hook_only') lines.push('- read-only: Ledge cannot send to it');
    if (s.pending) lines.push(`- pending ${s.pending.kind}: ${s.pending.text}`);
    const helpers = s.helpers.filter(h => h.state !== 'exited');
    if (helpers.length) lines.push(`- subagents: ${helpers.map(h => h.task || h.kind).join('; ')}`);
    const pane = await input.capture(s).catch(() => null);
    if (pane?.length) { const f = `pane-${s.id}.txt`; await writeFile(join(dir, f), pane.join('\n')); steps.set(f, { kind: 'pane', id: s.id, name: s.name }); lines.push(`- terminal, last lines: ${f}`); }
    if (s.lastReply?.text.trim()) { const f = `reply-${s.id}.md`; await writeFile(join(dir, f), s.lastReply.text); steps.set(f, { kind: 'reply', id: s.id, name: s.name }); lines.push(`- last reply (${s.lastReply.at}): ${f}`); }
    const g = await input.git(s.cwd).catch(() => null);
    if (g) { const f = `git-${s.id}.txt`; await writeFile(join(dir, f), g); steps.set(f, { kind: 'git', id: s.id, name: s.name }); lines.push(`- git status, log and diff stat: ${f}`); }
    lines.push('');
  }
  // Archived sessions (out of the list, kept): only what session.restore needs, no terminal, reply nor git.
  if (archived.length) lines.push('# Archived sessions', '', 'Out of the list but kept: session.restore brings one back.', '',
    ...archived.map(s => `- ${s.name} (${s.tool}), id ${s.id}, folder ${s.cwd}, archived ${s.archivedAt}`), '');
  await writeFile(join(dir, 'sessions.md'), lines.join('\n')); steps.set('sessions.md', { kind: 'sessions' });
  // The folders a session can be proposed in (spec 2026-10-12 §4), beside the sessions' own folders in sessions.md.
  // A folder under the temporary directory (an agent's scratchpad) is never a folder to propose a session in.
  const recents = (input.recents ?? []).filter(r => !underTmp(r.cwd));
  await writeFile(join(dir, 'folders.md'), ['# Recent folders', '', 'The folders the user started sessions in, most recent first.', '',
    ...(recents.length ? recents.map(r => `- ${r.project}: ${r.cwd} (last used ${r.lastAt})`) : ['- (none yet)']), ''].join('\n'));
  // The projects (build spec §5), only where the daemon holds some; a name or a description is one line, so it forges no heading.
  if (withProjects) await writeFile(join(dir, 'projects.md'), projectsMd(projects));
  if (input.tasks) await writeTasksContext(dir, input.tasks, steps, input.now.slice(0, 10));
  if (input.rigs?.installed) { await writeFile(join(dir, 'rigs.md'), rigsMd(input.rigs)); steps.set('rigs.md', { kind: 'sessions' }); }
  if (input.usage) await writeFile(join(dir, LIMITS_MD), limitsMd(input.usage, input.now));
  if (input.ledge) { await writeLedgeMd(dir, input.ledge); steps.set(LEDGE_MD, { kind: 'repo', name: 'Ledge', path: LEDGE_MD }); }
  if (input.notesDir) await writeNotes(dir, input.notesDir, steps);
  // The live sessions' repositories and the projects' ones on this machine: a question with no session can still read a project.
  // A project's folder may be gone (an --add-dir that does not exist would fail the run): only folders that exist now.
  const projectRepos = await existing(projects.projects.flatMap(p => p.repos.filter(r => r.machine === 'local').map(r => r.path)));
  const repoPaths = [...new Set([...live.map(s => s.repoPath ?? s.cwd), ...projectRepos].filter(p => p && !coversHome(p)).map(p => resolve(p)))];
  return { dir, steps, repoPaths, ...(input.usage ? { limits: true as const } : {}) };
}

const HARNESS: Record<HarnessUsage['harness'], string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };
const WINDOW: Record<HarnessUsage['windows'][number]['kind'], string> = { five_hour: '5-hour window', seven_day: 'week', model: 'week, one model', month: 'month', pool: 'included usage' };
const USAGE_STATUS: Record<HarnessUsage['status'], string> = {
  ok: 'read less than 5 minutes ago', loading: 'not read yet since the daemon started', stale: 'not read for more than 5 minutes',
  unreachable: 'the last read failed', expired: "Claude Code's session has expired: the user signs in again in Claude Code"
};
/** `limits.md`: each harness's account limits as the daemon last read them, the same the user sees under « Limites ». */
export function limitsMd(usage: readonly HarnessUsage[], now: string): string {
  const lines = [`# Account limits at ${now}`, '', "Each harness the user's agents run on, its windows (how much is used, when it starts again from zero) and when the daemon read them.", ''];
  if (usage.length === 0) lines.push('- (no harness read on this PC)');
  for (const h of usage) {
    lines.push(`## ${HARNESS[h.harness]}`, `- status: ${USAGE_STATUS[h.status]}`, `- read at: ${h.readAt ?? 'never'}`);
    for (const w of h.windows) {
      const what = `${WINDOW[w.kind]}${w.model ? ` (${oneLine(w.model)})` : ''}${w.pool ? ` (${w.pool === 'cursor' ? "Cursor's models" : 'other models'})` : ''}`;
      lines.push(`- ${what}: ${w.pct} % used${w.pct >= 100 ? ' (reached)' : ''}, ${w.resetsAt ? `starts again at ${w.resetsAt}` : 'reset time not given'}`);
    }
    if (h.windows.length === 0) lines.push('- no window read');
    lines.push('');
  }
  return lines.join('\n');
}

/** `rigs.md`: OpenRig on this PC as Ledge last read it, what rig.act and rig.seats name (a rig by its name, a role as `pod.member`). */
export function rigsMd(st: OpenRigState): string {
  const lines = [`# OpenRig on this PC, read at ${st.at}`, '', `- OpenRig ${st.version ?? '(version unknown)'}, daemon ${st.daemon.state}, kernel ${st.kernel.state}`, ''];
  for (const r of st.rigs) {
    lines.push(`## ${oneLine(r.name)} — ${oneLine(r.status)}`, `- seats: ${r.running} of ${r.seats} running${r.attention ? `, ${r.attention} need attention` : ''}`);
    for (const [role, ids] of seatsByRole(r.nodes)) lines.push(`- role ${role}: ${ids.length} seat${ids.length > 1 ? 's' : ''} (${ids.join(', ')})`);
    lines.push('');
  }
  if (!st.rigs.length) lines.push('- (no rig)', '');
  return lines.join('\n');
}

/** `projects.md` (also `ledge brain projects`): each project, its description and repositories per machine, then the filed folders. */
export function projectsMd(projects: Projects): string {
  const nameOf = new Map(projects.projects.map(p => [p.id, oneLine(p.name)]));
  return ['# Projects', '', ...(projects.projects.length ? projects.projects.flatMap(p => [`## ${oneLine(p.name)}`, ...(p.description.trim() ? [oneLine(p.description)] : []), '', ...p.repos.map(r => `- ${r.machine}: ${r.path}`), '']) : ['No projects.', '']),
    ...(projects.rules.length ? ['## Filed folders', '', ...projects.rules.map(r => `- ${r.machine}: ${r.path} → ${nameOf.get(r.project) ?? r.project}`), ''] : [])].join('\n');
}

const STATE_FR: Record<Task['state'], string> = { open: 'open (not taken yet)', taken: 'taken', done: 'done', refused: 'refused', dropped: 'dropped (its owner ended)' };

/** The most of a task's detail written: a decision's options fit, a long brief is cut and says so. */
export const TASK_DETAIL_MAX = 1000;

/** `tasks.md`: the open tasks and those closed `day` (the context's date), each with its detail (a decision's options). */
async function writeTasksContext(dir: string, taskList: readonly Task[], steps: Map<string, ChatStep>, day: string): Promise<void> {
  const shown = taskList.filter(t => !taskClosed(t) || t.updatedAt.slice(0, 10) === day);
  await writeFile(join(dir, 'tasks.md'), ['# Tasks', '', 'Open tasks and those closed today. A giver `Ledge` is the user, through you.', '',
    ...(shown.length ? shown.flatMap(t => [`- ${t.id} « ${oneLine(t.title)} » — giver ${t.giverName}, owner ${t.ownerName}, ${STATE_FR[t.state]}${t.result ? `: ${oneLine(t.result).slice(0, 200)}` : ''} (updated ${t.updatedAt})`, ...detail(t)]) : ['- (none)']), ''].join('\n'));
  steps.set('tasks.md', { kind: 'sessions' });
}

/** A task's detail as one indented line under it, cut at TASK_DETAIL_MAX. */
function detail(t: Task): string[] {
  const text = t.text ? oneLine(t.text) : '';
  if (!text) return [];
  return [`  - detail: ${text.length > TASK_DETAIL_MAX ? `${text.slice(0, TASK_DETAIL_MAX)}… (cut: \`ledge task show ${t.id}\` has the rest)` : text}`];
}

/** The paths that are folders now. */
async function existing(paths: readonly string[]): Promise<string[]> {
  const ok = await Promise.all(paths.map(p => stat(p).then(st => st.isDirectory(), () => false)));
  return paths.filter((_, i) => ok[i]);
}

/** Under the OS temporary directory or `/tmp`. */
function underTmp(path: string): boolean {
  const p = resolve(path);
  return [resolve(tmpdir()), '/tmp'].some(t => p === t || p.startsWith(`${t}/`));
}

/** Text written on one line of a Markdown file: its line breaks become spaces. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** The home folder, the root or any parent of the home: a hook-only agent started there must not open `.ssh` or `.aws` to the model. */
function coversHome(path: string): boolean {
  const p = resolve(path); const home = resolve(homedir());
  return p === home || home.startsWith(p.endsWith('/') ? p : `${p}/`);
}

/** The step a file read stands for: a context file by name, a repository file by repository, anything else by its path. */
export function stepFor(path: string, ctx: Context): ChatStep | null {
  const abs = resolve(path);
  if (abs.startsWith(`${resolve(ctx.dir)}/`)) return ctx.steps.get(basename(abs)) ?? null;
  const repo = ctx.repoPaths.find(r => abs.startsWith(`${resolve(r)}/`));
  return repo ? { kind: 'repo', name: basename(repo), path: abs.slice(resolve(repo).length + 1) } : { kind: 'repo', path: abs };
}
