import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { RepoInfo } from '@ledge/protocol';

const GIT_TIMEOUT_MS = 2000;
/** The most git processes running at once. */
const MAX_GIT = 8;

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
  // At most MAX_GIT git at once, whatever the number of paths.
  let live = 0; const waiting: (() => void)[] = [];
  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    if (live >= MAX_GIT) await new Promise<void>(r => waiting.push(r));
    live++;
    try { return await job(); } finally { live--; waiting.shift()?.(); }
  };
  return Promise.all(paths.map(raw => slot(async (): Promise<RepoInfo> => {
    const input = raw.trim();
    const path = resolve(input === '~' ? home : input.startsWith('~/') ? resolve(home, input.slice(2)) : input);
    let isDir = false;
    try { isDir = (await stat(path)).isDirectory(); } catch { /* missing */ }
    if (!isDir) return { path: raw, exists: false, branch: null };
    // One deadline for the path, shared by its git calls, and a hard stop whatever the injected git does.
    const deadline = Date.now() + GIT_TIMEOUT_MS;
    const bounded = (args: string[]) => new Promise<string | null>(res => {
      const t = setTimeout(() => res(null), Math.max(0, deadline - Date.now()));
      git(path, args).then(v => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(null); });
    });
    let branch = await bounded(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') branch = (await bounded(['rev-parse', '--short=7', 'HEAD']))?.slice(0, 7) ?? null;
    return { path: raw, exists: true, branch };
  })));
}
