import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RepoInfo } from '@ledge/protocol';

const GIT_TIMEOUT_MS = 2000;
/** The most git processes running at once. */
const MAX_GIT = 8;
const MIN_LEFT_MS = 100;

/** Runs `git -C cwd <args>`: its trimmed output, or null (not a repository, git absent, too slow). */
function runGit(cwd: string, args: string[]): Promise<string | null> {
  return new Promise(res => {
    execFile('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err, out) => res(err ? null : out.trim() || null));
  });
}

/** At most MAX_GIT paths being inspected at once, across every call (a listing's worktrees and the launch form's inspections together).
 *  A freed slot is handed to the first one waiting, `live` unchanged: a call arriving before that one resumes cannot take it. */
let live = 0; const waiting: (() => void)[] = [];
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (live >= MAX_GIT) await new Promise<void>(r => waiting.push(r));
  else live++;
  try { return await job(); } finally { const next = waiting.shift(); if (next) next(); else live--; }
}

/** The branch named by a `.git` folder's HEAD (the short commit when detached), read without running git: an empty repository has
 *  its branch there before any commit. Null when HEAD is missing or names no local branch. */
export async function headBranch(dotGit: string): Promise<string | null> {
  let head: string;
  try { head = (await readFile(join(dotGit, 'HEAD'), 'utf8')).trim(); } catch { return null; }
  const ref = /^ref: refs\/heads\/(.+)$/.exec(head);
  if (ref) return ref[1]!;
  return /^[0-9a-f]{7,}$/i.test(head) ? head.slice(0, 7) : null;
}

/** For each path, echoed as asked (`~`, `..`, a trailing `/` are resolved only to look and to run git: the front finds its answer by the path it sent):
 *  whether it is a folder and its Git branch (the short commit when HEAD is detached; null when not a repository). A `.git` folder is
 *  read as the browser reads it (`headBranch`); git runs only for a `.git` file (worktree, submodule) or a folder without `.git`
 *  (a folder inside a repository). */
export async function inspectRepos(paths: readonly string[], opts: { home?: string; git?: (cwd: string, args: string[]) => Promise<string | null> } = {}): Promise<RepoInfo[]> {
  const home = opts.home ?? homedir();
  const git = opts.git ?? runGit;
  return Promise.all(paths.map(raw => slot(async (): Promise<RepoInfo> => {
    const input = raw.trim();
    const path = resolve(input === '~' ? home : input.startsWith('~/') ? resolve(home, input.slice(2)) : input);
    let isDir = false;
    try { isDir = (await stat(path)).isDirectory(); } catch { /* missing */ }
    if (!isDir) return { path: raw, exists: false, branch: null };
    let dotDir = false;
    try { dotDir = (await stat(join(path, '.git'))).isDirectory(); } catch { /* no .git here */ }
    if (dotDir) return { path: raw, exists: true, branch: await headBranch(join(path, '.git')) };
    // One deadline for the path, shared by its git calls, and a hard stop whatever the injected git does.
    const deadline = Date.now() + GIT_TIMEOUT_MS;
    const bounded = (args: string[]) => new Promise<string | null>(res => {
      const t = setTimeout(() => res(null), Math.max(0, deadline - Date.now()));
      git(path, args).then(v => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(null); });
    });
    let branch = await bounded(['rev-parse', '--abbrev-ref', 'HEAD']);
    // Under MIN_LEFT_MS of the deadline left, a second git could not answer: no branch rather than a wasted process.
    if (branch === 'HEAD') branch = deadline - Date.now() < MIN_LEFT_MS ? null : (await bounded(['rev-parse', '--short=7', 'HEAD']))?.slice(0, 7) ?? null;
    return { path: raw, exists: true, branch };
  })));
}
