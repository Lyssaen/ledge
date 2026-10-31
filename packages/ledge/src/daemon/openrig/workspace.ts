import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RigPlan } from '@ledge/protocol';
import type { Exec } from '../git.js';

/** `execGit` with room for `git worktree add` on a big repository (execGit stops at 3 s). */
export const execGitSlow: Exec = (file, args, cwd) => new Promise(res => {
  execFile(file, args, { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => res({ code: err ? 1 : 0, stdout: String(stdout) }));
});

/** The branch of each worktree `git worktree list --porcelain` names (null: detached), by absolute path. */
function worktrees(porcelain: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const block of porcelain.split(/\n\s*\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]; if (!path) continue;
    out.set(resolve(path), /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null);
  }
  return out;
}

/**
 * Makes the folder the rig works in: a git worktree on the plan's branch (reused when it is already that copy), the
 * own folder of an off-project rig, nothing for a rig in the repository itself. Never `--force`, never removes anything.
 * `git` runs argv only (no shell); a branch git could read as an option, or that git rejects, is refused before any change.
 */
export async function prepareWorkspace(plan: RigPlan, git: Exec): Promise<{ ok: true; created: boolean } | { ok: false; reason: string }> {
  const w = plan.where; const cwd = plan.cwd;
  if (w.kind === 'off-project') {
    const existed = existsSync(cwd);
    try { await mkdir(cwd, { recursive: true }); } catch (e) { return { ok: false, reason: `cannot create ${cwd}: ${(e as Error).message}` }; }
    return { ok: true, created: !existed };
  }
  if (!w.copy) return { ok: true, created: false };
  const branch = w.branch;
  if (branch.trim() === '' || branch.startsWith('-')) return { ok: false, reason: 'invalid branch' };
  if ((await git('git', ['check-ref-format', '--branch', branch], w.repo)).code !== 0) return { ok: false, reason: 'invalid branch' };
  const list = await git('git', ['-C', w.repo, 'worktree', 'list', '--porcelain'], w.repo);
  if (list.code !== 0) return { ok: false, reason: `git worktree list failed in ${w.repo}` };
  const known = worktrees(list.stdout);
  const here = resolve(cwd);
  if (known.has(here)) return known.get(here) === branch ? { ok: true, created: false } : { ok: false, reason: `folder exists: ${cwd}` };
  if (existsSync(cwd)) return { ok: false, reason: `folder exists: ${cwd}` };
  const exists = (await git('git', ['-C', w.repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], w.repo)).code === 0;
  const add = await git('git', ['-C', w.repo, 'worktree', 'add', ...(exists ? [cwd, branch] : ['-b', branch, cwd])], w.repo);
  return add.code === 0 ? { ok: true, created: true } : { ok: false, reason: `git worktree add failed for ${cwd}` };
}
