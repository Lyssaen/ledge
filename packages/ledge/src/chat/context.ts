import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { ChatStep, Recent, Session } from '@ledge/protocol';

export interface ContextInput { sessions: Session[]; recents?: Recent[]; capture: (s: Session) => Promise<string[] | null>; git: (cwd: string) => Promise<string | null>; now: string }
export interface Context { dir: string; steps: Map<string, ChatStep>; repoPaths: string[] }

const STATE: Record<Session['state'], string> = {
  starting: 'starting', working: 'working', waiting_permission: "waiting for the user's approval", waiting_input: 'asking the user a question',
  idle: 'idle, waiting for instructions', error: 'in error', exited: 'exited'
};

/**
 * The folder Ledge reads before answering (spec 2026-10-11 §5.3): `sessions.md` names every session and the files that
 * describe it; `folders.md` lists the recent folders; `pane-<id>.txt`, `reply-<id>.md` and `git-<id>.txt` exist only where there is something to read.
 */
export async function writeContext(dir: string, input: ContextInput): Promise<Context> {
  await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  const steps = new Map<string, ChatStep>();
  const lines = [`# Ledge sessions at ${input.now}`, '', 'Each session below lists the files that describe it, in this folder.', ''];
  for (const s of input.sessions) {
    lines.push(`## ${s.name} (${s.tool}) — ${STATE[s.state]}`, `- id: ${s.id}`, `- topic: ${s.topic ?? '(none yet)'}`, `- folder: ${s.cwd}`,
      `- repository: ${s.repo ?? s.project}${s.branch ? `, branch ${s.branch}${s.worktree ? ' (linked worktree)' : ''}` : ''}`, `- started: ${s.startedAt}, last activity: ${s.lastActivityAt}`);
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
  const repoPaths = [...new Set(input.sessions.map(s => s.repoPath ?? s.cwd).filter(p => p && !coversHome(p)).map(p => resolve(p)))];
  return { dir, steps, repoPaths };
}

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
