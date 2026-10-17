import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { RepoInfo } from '@ledge/protocol';

const GIT_TIMEOUT_MS = 2000;

/** Runs `git -C cwd <args>`: its trimmed output, or null (not a repository, git absent, too slow). */
function runGit(cwd: string, args: string[]): Promise<string | null> {
  return new Promise(res => {
    execFile('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err, out) => res(err ? null : out.trim() || null));
  });
}

/** For each path, echoed as asked (`~`, `..`, a trailing `/` are resolved only to look and to run git: the front finds its answer by the path it sent):
 *  whether it is a folder and its Git branch (the short commit when HEAD is detached; null when not a repository). */
export async function inspectRepos(paths: readonly string[], opts: { home?: string; git?: (cwd: string, args: string[]) => Promise<string | null> } = {}): Promise<RepoInfo[]> {
  const home = opts.home ?? homedir();
  const git = opts.git ?? runGit;
  // A hard stop too, whatever the injected git does.
  const bounded = (cwd: string, args: string[]) => new Promise<string | null>(res => {
    const t = setTimeout(() => res(null), GIT_TIMEOUT_MS);
    git(cwd, args).then(v => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(null); });
  });
  return Promise.all(paths.map(async (raw): Promise<RepoInfo> => {
    const input = raw.trim();
    const path = resolve(input === '~' ? home : input.startsWith('~/') ? resolve(home, input.slice(2)) : input);
    let isDir = false;
    try { isDir = (await stat(path)).isDirectory(); } catch { /* missing */ }
    if (!isDir) return { path: raw, exists: false, branch: null };
    let branch = await bounded(path, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') branch = (await bounded(path, ['rev-parse', '--short=7', 'HEAD']))?.slice(0, 7) ?? null;
    return { path: raw, exists: true, branch };
  }));
}
