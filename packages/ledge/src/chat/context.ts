import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DEFAULT_PROJECTS, type Goal, type HarnessUsage, type HumanAsk, isArchived, projectOf, seatsByRole, taskClosed, type ChatStep, type OpenRigState, type Projects, type Recent, type Session, type Task } from '@ledge/protocol';
import { LEDGE_MD, writeLedgeMd, type LedgeInfo } from './guide.js';
import { writeNotes } from './notes.js';
import type { JournalEvent } from '../operator/journal.js';

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
  /** What rigs ask the user (OpenRig's « À toi »): the rig part of `attentes.md`. */
  asks?: readonly HumanAsk[];
  /** The operator's journal events for this thread: `journal.md`, none when left out. */
  journal?: readonly JournalEvent[];
  /** Max's goals: `rigs.md` lists the open ones. */
  goals?: readonly Goal[];
  /** The queue rows not closed, per rig name: `rigs.md`. */
  queue?: ReadonlyMap<string, Array<{ id: string; from: string; to: string; summary: string; state: string }>>;
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
  const replies = new Set<string>();
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
    if (s.lastReply?.text.trim()) { const f = `reply-${s.id}.md`; await writeFile(join(dir, f), s.lastReply.text); replies.add(s.id); steps.set(f, { kind: 'reply', id: s.id, name: s.name }); lines.push(`- last reply (${s.lastReply.at}): ${f}`); }
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
  await writeFile(join(dir, 'attentes.md'), attentesMd(live, input.asks ?? [], input.tasks ?? [], input.now)); steps.set('attentes.md', { kind: 'sessions' });
  if (input.journal) { await writeFile(join(dir, 'journal.md'), journalMd(input.journal, replies)); steps.set('journal.md', { kind: 'sessions' }); }
  if (input.rigs?.installed) { await writeFile(join(dir, 'rigs.md'), rigsMd(input.rigs, { sessions: input.sessions, ...(input.goals ? { goals: input.goals } : {}), ...(input.queue ? { queue: input.queue } : {}) })); steps.set('rigs.md', { kind: 'sessions' }); }
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

/** What `rigs.md` adds to the seats: Max's goals, the queue rows not closed per rig, and the sessions that tell what a seat does. */
export interface RigsExtra { sessions?: readonly Session[]; goals?: readonly Goal[]; queue?: ContextInput['queue'] }

/** `rigs.md`: OpenRig on this PC as Ledge last read it, what rig.act and rig.seats name (a rig by its name, a role as `pod.member`). */
export function rigsMd(st: OpenRigState, extra: RigsExtra = {}): string {
  const lines = [`# OpenRig on this PC, read at ${st.at}`, '', `- OpenRig ${st.version ?? '(version unknown)'}, daemon ${st.daemon.state}, kernel ${st.kernel.state}`, ''];
  const byName = new Map((extra.sessions ?? []).filter(s => !isArchived(s)).map(s => [s.name, s]));
  for (const r of st.rigs) {
    lines.push(`## ${oneLine(r.name)} — ${oneLine(r.status)}`, `- seats: ${r.running} of ${r.seats} running${r.attention ? `, ${r.attention} need attention` : ''}`);
    for (const [role, ids] of seatsByRole(r.nodes)) lines.push(`- role ${role}: ${ids.length} seat${ids.length > 1 ? 's' : ''} (${ids.join(', ')})`);
    // A seat that is not stopped on purpose and whose session is not running does not answer.
    const lost = r.nodes.filter(n => !n.stopped && n.sessionStatus !== 'running');
    if (lost.length) lines.push(`- unreachable: ${lost.map(n => `${n.logicalId} (${oneLine(n.sessionStatus)})`).join(', ')}`);
    for (const n of r.nodes) {
      const s = byName.get(n.logicalId);
      if (s) lines.push(`- ${n.logicalId}: ${STATE[s.state]}${s.topic ? `, ${oneLine(s.topic)}` : ''}`);
    }
    const rows = extra.queue?.get(r.name) ?? [];
    if (rows.length) lines.push('- queue, rows not closed:', ...rows.map(q => `  - ${q.id} ${oneLine(q.from)} → ${oneLine(q.to)} (${oneLine(q.state)}): ${oneLine(q.summary)}`));
    lines.push('');
  }
  if (!st.rigs.length) lines.push('- (no rig)', '');
  const open = (extra.goals ?? []).filter(g => g.state !== 'done' && g.state !== 'closed');
  if (open.length) lines.push('## Open goals', '', ...open.map(g => `- ${g.goalId} (${g.state}): ${oneLine(g.text)}`), '');
  return lines.join('\n');
}

/** `attentes.md`: everything that waits for the user, each line starting with the id its card needs. */
export function attentesMd(live: readonly Session[], asks: readonly HumanAsk[], taskList: readonly Task[], now: string): string {
  const out: string[] = [];
  for (const s of live) {
    if (!s.pending) continue;
    out.push(`- ${s.id} — ${oneLine(s.name)}, pending ${s.pending.kind}: ${oneLine(s.pending.text)}`);
    if (s.pending.body?.trim()) out.push(`  - body: ${oneLine(s.pending.body)}`);
    if (s.pending.options?.length) out.push(`  - options: ${s.pending.options.map(oneLine).join('; ')}`);
  }
  for (const a of asks) {
    out.push(`- ${a.id} — ${a.kind} from ${oneLine(a.from.seat)}${a.from.rig ? ` (rig ${oneLine(a.from.rig)})` : ''}, ${a.priority}: ${oneLine(a.summary)}`);
    if (a.body.trim()) out.push(`  - body: ${oneLine(a.body)}`);
    for (const q of a.questions) out.push(`  - ${q.id} « ${oneLine(q.question)} »: ${q.options.map(o => `${o.id} = ${oneLine(o.label)}${o.recommended ? ' (recommended)' : ''}`).join('; ')}`);
  }
  for (const t of taskList.filter(t => t.owner === 'ledge' && !taskClosed(t))) {
    out.push(`- ${t.id} « ${oneLine(t.title)} » — from ${oneLine(t.giverName)}, ${STATE_FR[t.state]}`, ...detail(t));
    if (t.brain) out.push(`  - brain proposal: ${t.brain.kind === 'flag' ? 'flag' : t.brain.create ? 'create' : 'add to'} note ${t.brain.note}: ${oneLine(t.brain.fact)}`);
  }
  return ['# What waits for the user', '', `At ${now}. Each line starts with the id its card needs.`, '', ...(out.length ? out : ['Nothing waits for the user.']), ''].join('\n');
}

/** What an event says, from the key its detector fills: a reply or request text, an ask's summary, a command, a rig's move, a seat's
 *  status, a pull request's ref. */
function eventText(p: Record<string, unknown>): string | undefined {
  const s = (k: string) => (typeof p[k] === 'string' && (p[k] as string).trim() ? (p[k] as string) : undefined);
  return s('text') ?? s('summary') ?? s('command') ?? (s('from') && s('to') ? `${s('from')} → ${s('to')}` : undefined) ?? s('status') ?? s('ref');
}

/** `journal.md`: one line per event, `HH:MM kind subject — text`; a finished session whose reply was written points to it. */
export function journalMd(events: readonly JournalEvent[], replies: ReadonlySet<string>): string {
  const lines = events.map(e => {
    const said = eventText(e.payload);
    const text = said ? ` — ${oneLine(said)}` : '';
    const reply = e.kind === 'session.finished' && replies.has(e.subjectId) ? ` reply: reply-${e.subjectId}.md` : '';
    return `${e.at.slice(11, 16)} ${e.kind} ${oneLine(e.subjectName)}${text}${reply}`;
  });
  return ['# Journal', '', 'What happened, oldest first.', '', ...(lines.length ? lines : ['(nothing)']), ''].join('\n');
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
