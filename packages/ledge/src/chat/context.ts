import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DEFAULT_PROJECTS, projectOf, taskClosed, type ChatStep, type Projects, type Recent, type Role, type Session, type Task, type Team, type TeamTemplate } from '@ledge/protocol';
import { listDefinitions } from '../daemon/teams.js';

export interface ContextInput { sessions: Session[]; recents?: Recent[]; projects?: Projects; teams?: Team[]; tasks?: Task[];
  /** The roles and templates by folder (roles spec §3.8): the home's and each session's repository's; read from disk when left out. */
  definitions?: (cwd?: string) => { roles: Role[]; templates: TeamTemplate[] };
  capture: (s: Session) => Promise<string[] | null>; git: (cwd: string) => Promise<string | null>; now: string }
export interface Context { dir: string; steps: Map<string, ChatStep>; repoPaths: string[] }

const STATE: Record<Session['state'], string> = {
  starting: 'starting', working: 'working', waiting_permission: "waiting for the user's approval", waiting_input: 'asking the user a question',
  idle: 'idle, waiting for instructions', error: 'in error', exited: 'exited'
};

/**
 * The folder Ledge reads before answering (spec 2026-10-11 §5.3): `sessions.md` names every session and the files that
 * describe it; `folders.md` lists the recent folders; `projects.md` the projects, their repositories and remembered folders (only where the daemon holds some); `pane-<id>.txt`, `reply-<id>.md` and `git-<id>.txt` exist only where there is something to read.
 */
export async function writeContext(dir: string, input: ContextInput): Promise<Context> {
  await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  const steps = new Map<string, ChatStep>();
  const projects = input.projects ?? DEFAULT_PROJECTS;
  // A daemon that holds no projects (a remote one) says nothing about them: the context it wrote before projects existed.
  const withProjects = projects.projects.length > 0 || projects.rules.length > 0;
  const nameOf = new Map(projects.projects.map(p => [p.id, oneLine(p.name)]));
  const lines = [`# Ledge sessions at ${input.now}`, '', 'Each session below lists the files that describe it, in this folder.', ''];
  for (const s of input.sessions) {
    lines.push(`## ${s.name} (${s.tool}) — ${STATE[s.state]}`, `- id: ${s.id}`, `- topic: ${s.topic ?? '(none yet)'}`, `- folder: ${s.cwd}`,
      `- repository: ${s.repo ?? s.project}${s.branch ? `, branch ${s.branch}${s.worktree ? ' (linked worktree)' : ''}` : ''}`, `- started: ${s.startedAt}, last activity: ${s.lastActivityAt}`);
    if (withProjects) lines.push(`- Project: ${nameOf.get(projectOf(s, projects) ?? '') ?? 'no project'}`);
    if (s.role) lines.push(`- role: ${oneLine(s.roleLabel ?? s.role)} (@${s.role})${s.autonomy ? `, autonomy ${s.autonomy}` : ''}`);
    // Its context (context handover spec §3.2): past 80 % the user may hand it over to a fresh session (« Passer le relais »).
    if (s.context) lines.push(`- context: ${Math.round((s.context.used / s.context.window) * 100)} % of ${s.context.window} tokens${s.context.used / s.context.window >= 0.8 ? ' — near its limit: a relief can be started from its page' : ''}`);
    if (s.handover) lines.push(`- relief: ${s.handover.state}${s.handover.toName ? `, relieved by ${oneLine(s.handover.toName)}` : ''}${s.handover.reason ? ` (${oneLine(s.handover.reason)})` : ''}`);
    if (s.relieves) lines.push(`- relieves ${oneLine(s.relieves.name)} (its context was full)`);
    const team = s.team ? input.teams?.find(t => t.id === s.team) : undefined;
    if (team) lines.push(`- team: ${oneLine(team.name)} (${team.id})`);
    if (s.source === 'hook_only') lines.push('- read-only: Ledge cannot send to it');
    if (s.pending) lines.push(`- pending ${s.pending.kind}: ${s.pending.text}`);
    const live = s.helpers.filter(h => h.state !== 'exited');
    if (live.length) lines.push(`- subagents: ${live.map(h => h.task || h.kind).join('; ')}`);
    const pane = await input.capture(s).catch(() => null);
    if (pane?.length) { const f = `pane-${s.id}.txt`; await writeFile(join(dir, f), pane.join('\n')); steps.set(f, { kind: 'pane', id: s.id, name: s.name }); lines.push(`- terminal, last lines: ${f}`); }
    if (s.lastReply?.text.trim()) { const f = `reply-${s.id}.md`; await writeFile(join(dir, f), s.lastReply.text); steps.set(f, { kind: 'reply', id: s.id, name: s.name }); lines.push(`- last reply (${s.lastReply.at}): ${f}`); }
    const g = await input.git(s.cwd).catch(() => null);
    if (g) { const f = `git-${s.id}.txt`; await writeFile(join(dir, f), g); steps.set(f, { kind: 'git', id: s.id, name: s.name }); lines.push(`- git status, log and diff stat: ${f}`); }
    lines.push('');
  }
  await writeFile(join(dir, 'sessions.md'), lines.join('\n')); steps.set('sessions.md', { kind: 'sessions' });
  // The folders a session can be proposed in (spec 2026-10-12 §4), beside the sessions' own folders in sessions.md.
  const recents = input.recents ?? [];
  await writeFile(join(dir, 'folders.md'), ['# Recent folders', '', 'The folders the user started sessions in, most recent first.', '',
    ...(recents.length ? recents.map(r => `- ${r.project}: ${r.cwd} (last used ${r.lastAt})`) : ['- (none yet)']), ''].join('\n'));
  // The projects (build spec §5), only where the daemon holds some; a name or a description is one line, so it forges no heading.
  if (withProjects) await writeFile(join(dir, 'projects.md'), ['# Projects', '', ...(projects.projects.length ? projects.projects.flatMap(p => [`## ${oneLine(p.name)}`, ...(p.description.trim() ? [oneLine(p.description)] : []), '', ...p.repos.map(r => `- ${r.machine}: ${r.path}`), '']) : ['No projects.', '']),
    ...(projects.rules.length ? ['## Filed folders', '', ...projects.rules.map(r => `- ${r.machine}: ${r.path} → ${nameOf.get(r.project) ?? r.project}`), ''] : [])].join('\n'));
  if (input.teams || input.tasks) await writeTeamsContext(dir, input, steps);
  const repoPaths = [...new Set(input.sessions.map(s => s.repoPath ?? s.cwd).filter(p => p && !coversHome(p)).map(p => resolve(p)))];
  return { dir, steps, repoPaths };
}

const STATE_FR: Record<Task['state'], string> = { open: 'open (not taken yet)', taken: 'taken', done: 'done', refused: 'refused', dropped: 'dropped (its owner ended)' };

/**
 * `roles.md`, `teams.md` and `tasks.md` (roles spec §3.8): the roles and templates Ledge may compose a team from (the
 * home's, and each live session's repository's), the live teams with their seats, and the open tasks and those closed today.
 */
async function writeTeamsContext(dir: string, input: ContextInput, steps: Map<string, ChatStep>): Promise<void> {
  const defsOf = input.definitions ?? (cwd => listDefinitions(cwd));
  const folders = [undefined, ...new Set(input.sessions.filter(s => s.state !== 'exited').map(s => s.repoPath ?? s.cwd))];
  const roles = new Map<string, Role & { folders: Set<string> }>(); const templates = new Map<string, TeamTemplate>();
  for (const f of folders) {
    let defs;
    try { defs = defsOf(f); } catch { continue; }
    for (const r of defs.roles) { const key = `${r.source}:${r.path}`; const cur = roles.get(key) ?? { ...r, folders: new Set<string>() }; if (f) cur.folders.add(f); roles.set(key, cur); }
    for (const t of defs.templates) templates.set(`${t.source}:${t.path}`, t);
  }
  const roleLines = ['# Roles', '', 'A team is composed only of these roles. A role from the home folder is available everywhere; a repository role only in that repository.', ''];
  if (!roles.size) roleLines.push('No roles yet. A role is a Markdown file `~/.ledge/roles/<id>.md` (or `<repo>/.ledge/roles/<id>.md`): a front matter with `label`, optionally `tool`, `model`, `effort`, `autonomy` (ask, edits, auto), then the role\'s prompt.', '');
  for (const r of roles.values()) {
    roleLines.push(`## @${r.id} — ${oneLine(r.label)}`, `- source: ${r.source === 'home' ? 'home (every folder)' : `repository ${[...r.folders].join(', ')}`}`,
      `- defaults: agent ${r.tool ?? '(launch form)'}, model ${r.model ?? '(default)'}, effort ${r.effort ?? '(default)'}, autonomy ${r.autonomy ?? 'ask'}`, `- prompt: ${oneLine(r.prompt).slice(0, 300) || '(none)'}`, '');
  }
  await writeFile(join(dir, 'roles.md'), roleLines.join('\n'));
  const nameOf = new Map(input.sessions.map(s => [s.id, s]));
  const teams = (input.teams ?? []).filter(t => t.state !== 'dissolved');
  const taskList = input.tasks ?? [];
  const teamLines = ['# Teams', '', '## Templates', '', ...(templates.size ? [...templates.values()].map(t => `- ${t.id} (« ${oneLine(t.name)} », ${t.source}): ${t.seats.map(x => `@${x.role}${x.tool ? ` ${x.tool}` : ''}`).join(', ')}`) : ['- (none: a template is `~/.ledge/teams/<id>.yaml`)']), '', '## Live teams', ''];
  if (!teams.length) teamLines.push('No live team.', '');
  for (const t of teams) {
    const mine = taskList.filter(x => x.team === t.id && x.giver === 'ledge');
    teamLines.push(`### ${oneLine(t.name)} (${t.id}) — ${t.state}`, `- folder: ${t.cwd}`, `- project: ${t.project ?? 'no project'}`, ...(t.template ? [`- template: ${t.template}`] : []),
      `- Ledge's tasks: ${mine.filter(x => x.state === 'done').length}/${mine.length} done`,
      ...t.seats.map(seat => { const s = seat.sessionId ? nameOf.get(seat.sessionId) : undefined; return `- @${seat.role}: ${s ? `${s.name} (${s.id}), ${STATE[s.state]}` : 'free'}`; }), '');
  }
  await writeFile(join(dir, 'teams.md'), teamLines.join('\n'));
  const day = new Date().toISOString().slice(0, 10);
  const shown = taskList.filter(t => !taskClosed(t) || t.updatedAt.slice(0, 10) === day);
  await writeFile(join(dir, 'tasks.md'), ['# Tasks', '', 'Open tasks and those closed today. A giver `Ledge` is the user, through you.', '',
    ...(shown.length ? shown.map(t => `- ${t.id} « ${oneLine(t.title)} » — giver ${t.giverName}, owner ${t.ownerName}${t.team ? `, team ${t.team}` : ''}, ${STATE_FR[t.state]}${t.result ? `: ${oneLine(t.result).slice(0, 200)}` : ''} (updated ${t.updatedAt})`) : ['- (none)']), ''].join('\n'));
  steps.set('roles.md', { kind: 'sessions' }); steps.set('teams.md', { kind: 'sessions' }); steps.set('tasks.md', { kind: 'sessions' });
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
