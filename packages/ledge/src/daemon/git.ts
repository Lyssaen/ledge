import { execFile } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

export interface GitInfo { repo: string; repoPath: string; branch: string; worktree: boolean; repoId?: string }
/** Transport-neutral identity. User/password/query are never returned to the overlay. */
export function repositoryId(remote: string): string | undefined {
  const value = remote.trim();
  try {
    const url = new URL(value);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return undefined;
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '')}`;
  } catch {
    const scp = value.match(/^(?:[^@\s]+@)?([a-zA-Z0-9.-]+):([^\s]+)$/);
    return scp ? `${scp[1]!.toLowerCase()}/${scp[2]!.replace(/\.git$/, '').replace(/\/$/, '')}` : undefined;
  }
}
/** Runs `file args` in `cwd`; a missing binary or a non-zero exit is a non-zero `code`, never a throw. */
export type Exec = (file: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string }>;
export const execGit: Exec = (file, args, cwd) => new Promise(res => {
  execFile(file, args, { cwd, timeout: 3000, maxBuffer: 1024 * 1024 }, (err, stdout) => res({ code: err ? 1 : 0, stdout: String(stdout) }));
});

/**
 * The repository a folder belongs to: its main worktree (name and absolute path), the checked-out branch (the short sha
 * on a detached head) and whether the folder is a linked worktree. Null outside a repository, before the first commit,
 * or without git.
 */
export async function gitInfo(cwd: string, exec: Exec = execGit): Promise<GitInfo | null> {
  const r = await exec('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--abbrev-ref', 'HEAD'], cwd);
  if (r.code !== 0) return null;
  const [toplevel = '', common = '', abbrev = ''] = r.stdout.split('\n').map(l => l.trim());
  if (!toplevel || !common || !abbrev) return null;
  const worktree = resolve(common) !== resolve(toplevel, '.git');
  const repoPath = worktree ? dirname(resolve(common)) : resolve(toplevel);
  let branch = abbrev;
  if (abbrev === 'HEAD') { // detached: the short sha stands for the branch
    const sha = await exec('git', ['rev-parse', '--short', 'HEAD'], cwd);
    if (sha.code !== 0 || !sha.stdout.trim()) return null;
    branch = sha.stdout.trim();
  }
  const remote = await exec('git', ['config', '--get', 'remote.origin.url'], cwd);
  const repoId = remote.code === 0 ? repositoryId(remote.stdout) : undefined;
  return { repo: basename(repoPath), repoPath, branch, worktree, ...(repoId ? { repoId } : {}) };
}

/** What a reader needs to know about the folder's work: status with the branch line, the last commits, the uncommitted diff stat. */
export async function gitSummary(cwd: string, exec: Exec = execGit): Promise<string | null> {
  const status = await exec('git', ['status', '--short', '--branch'], cwd);
  if (status.code !== 0) return null;
  const log = await exec('git', ['log', '--oneline', '-10'], cwd);
  const diff = await exec('git', ['diff', '--stat'], cwd);
  return [`# git status --short --branch`, status.stdout.trimEnd(), '', '# git log --oneline -10', log.stdout.trimEnd(), '', '# git diff --stat', diff.stdout.trimEnd() || '(clean)'].join('\n');
}
