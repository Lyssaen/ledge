import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DEFAULT_PROJECTS, MANDATE_CATEGORY_LABEL, projectOf, type ChatStep, type Escalation, type Projects, type Recent, type Rig, type Session } from '@ledge/protocol';
import { workingCount } from '@ledge/ui/rigs/model';

export interface ContextInput { sessions: Session[]; recents?: Recent[]; projects?: Projects;
  /** The OpenRig mirror (lot 4), only where the daemon has a bridge: `rigs.md` and `escalations.md`. */
  rigs?: Rig[]; escalations?: Escalation[];
  capture: (s: Session) => Promise<string[] | null>; git: (cwd: string) => Promise<string | null>; now: string }
export interface Context { dir: string; steps: Map<string, ChatStep>; repoPaths: string[] }

const STATE: Record<Session['state'], string> = {
  starting: 'starting', working: 'working', waiting_permission: "waiting for the user's approval", waiting_input: 'asking the user a question',
  idle: 'idle, waiting for instructions', error: 'in error', exited: 'exited'
};

/**
 * The folder Ledge reads before answering (spec 2026-10-11 §5.3): `sessions.md` names every session and the files that
 * describe it; `folders.md` lists the recent folders; `projects.md` the projects, their repositories and remembered folders (only where the daemon holds some); `pane-<id>.txt`, `reply-<id>.md` and `git-<id>.txt` exist only where there is something to read;
 * `rigs.md` and `escalations.md` (lot 4) only where the daemon mirrors OpenRig.
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
    // Its context (context handover spec §3.2): past 80 % the user may hand it over to a fresh session (« Passer le relais »).
    if (s.context) lines.push(`- context: ${Math.round((s.context.used / s.context.window) * 100)} % of ${s.context.window} tokens (the user's threshold decides when it is near its limit; a relief is started from its « ⋯ » menu)`);
    if (s.handover) lines.push(`- relief: ${s.handover.state}${s.handover.toName ? `, relieved by ${oneLine(s.handover.toName)}` : ''}${s.handover.reason ? ` (${oneLine(s.handover.reason)})` : ''}`);
    if (s.relieves) lines.push(`- relieves ${oneLine(s.relieves.name)} (its context was full)`);
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
  if (input.rigs) await writeFile(join(dir, 'rigs.md'), rigsMd(input.rigs));
  if (input.escalations) await writeFile(join(dir, 'escalations.md'), escalationsMd(input.escalations));
  const repoPaths = [...new Set(input.sessions.map(s => s.repoPath ?? s.cwd).filter(p => p && !coversHome(p)).map(p => resolve(p)))];
  return { dir, steps, repoPaths };
}

/** One line per rig outside the kernels: « factory · 4/6 au travail » (working seats / seats not stopped), then its place and seats. */
function rigsMd(rigs: Rig[]): string {
  const shown = rigs.filter(r => !r.kernel);
  return ['# Rigs OpenRig', '', 'Les rigs (équipes d\'agents OpenRig) de cette machine ; un siège s\'écrit @adresse.', '',
    ...(shown.length ? shown.map(r => `- ${oneLine(r.name)} · ${workingCount(r)}/${r.seats.filter(s => s.state !== 'stopped').length} au travail (${r.machine}, ${r.lifecycle}, ${r.cwd}${r.branch ? `, branche ${r.branch}` : ''}) : ${r.seats.map(s => `${s.address} ${s.state}`).join(', ') || 'aucun siège'}`) : ['- (aucun rig)']), ''].join('\n');
}

/** The escalations still waiting on a human (pending, or in their grace period): id, who asks, rig, summary and options. */
function escalationsMd(escalations: Escalation[]): string {
  const open = escalations.filter(e => e.state === 'pending' || e.state === 'grace');
  return ['# Escalades en attente', '', 'Les questions que les agents des rigs posent à l\'utilisateur, pas encore répondues.', '',
    ...(open.length ? open.map(e => {
      const options = e.questions.map(q => `${oneLine(q.question)} → ${q.options.map(o => oneLine(o.label)).join(' / ')}`).join(' ; ');
      return `- ${e.id} — de ${oneLine(e.from)}${e.rigId ? `, rig ${e.rigId}` : ''}${e.category ? `, ${MANDATE_CATEGORY_LABEL[e.category].fr}` : ''}${e.state === 'grace' ? ', en délai de grâce' : ''} : « ${oneLine(e.summary)} »${options ? `. Options : ${options}` : ''}`;
    }) : ['- (aucune)']), ''].join('\n');
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
