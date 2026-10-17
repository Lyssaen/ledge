import { readdir as fsReaddir, readFile as fsReadFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { FoundRepo } from '@ledge/protocol';
import { headBranch, inspectRepos } from './repos.js';
import { repositoryId } from './git.js';

/** How deep under each root, how many folders read, how long, how many repositories: past any of them the list is partial (`truncated`). */
export const SCAN_DEPTH = 4, SCAN_DIRS = 5000, SCAN_MS = 4000, SCAN_REPOS = 500;
/** Folders read at once: a slow disk (a Windows drive under WSL) is not read one folder at a time, yet the scan never holds more
 *  than libuv's default pool (4 threads), so the daemon's other file operations are not queued behind a slow mount. */
const BATCH = 4;

/** Folders never entered: dependencies, build output, caches, system folders of a home. Every hidden folder is skipped too. */
export const SKIP: ReadonlySet<string> = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'target', 'vendor', '__pycache__', 'venv', '.venv', 'Library', 'AppData']);

type Entry = { name: string; isDirectory(): boolean; isFile(): boolean };
export type ScanOptions = {
  home: string;
  /** More roots, walked like home (`extraRoots`). */
  extra?: readonly string[];
  /** The clock the deadline is checked against (tests); a real timer also stops a folder that never answers. */
  now?: () => number;
  readdir?: (path: string) => Promise<Entry[]>;
  readFile?: (path: string) => Promise<string>;
  /** Tighter bounds (tests); the SCAN_* constants by default. */
  limits?: Partial<{ depth: number; dirs: number; ms: number; repos: number }>;
};

const under = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/** The roots to walk beside home for these folders (recent ones, live sessions'): the parent of each folder outside home, once.
 *  A folder right under the filesystem root stands for itself; the filesystem root is never walked. */
export function extraRoots(home: string, cwds: readonly string[]): string[] {
  const h = resolve(home); const out: string[] = [];
  for (const raw of cwds) {
    if (!isAbsolute(raw)) continue;
    const cwd = resolve(raw);
    if (under(cwd, h)) continue;
    const parent = dirname(cwd);
    const root = parent !== dirname(parent) ? parent : cwd !== parent ? cwd : null;
    if (root && !out.includes(root)) out.push(root);
  }
  return out;
}

/** The value of `url` in a Git config's `[remote "origin"]` section (the last one, as `git config --get` answers), unquoted, comment cut. */
export function originUrl(config: string): string | undefined {
  let inOrigin = false; let url: string | undefined;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) { const m = /^\[\s*([A-Za-z0-9.-]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/.exec(line); inOrigin = !!m && m[1]!.toLowerCase() === 'remote' && m[2] === 'origin'; continue; }
    if (!inOrigin) continue;
    const kv = /^url\s*=\s*(.*)$/i.exec(line); if (!kv) continue;
    let value = ''; let quoted = false;
    for (let i = 0; i < kv[1]!.length; i++) {
      const c = kv[1]![i]!;
      if (c === '\\' && i + 1 < kv[1]!.length) { value += kv[1]![++i]; continue; }
      if (c === '"') { quoted = !quoted; continue; }
      if (!quoted && (c === '#' || c === ';')) break;
      value += c;
    }
    url = value.trim();
  }
  return url || undefined;
}

/** The normalised origin of the repository at `dir`, read from its config without running git. A `.git` file (linked worktree,
 *  submodule) points to its git dir with `gitdir:`; a worktree's config is in the main repository (`commondir`). Never logged. */
async function remoteOf(dir: string, dotIsFile: boolean, readFile: (p: string) => Promise<string>): Promise<string | undefined> {
  try {
    let gitDir = join(dir, '.git');
    if (dotIsFile) {
      const m = /^gitdir:\s*(.+)$/m.exec(await readFile(gitDir)); if (!m) return undefined;
      gitDir = resolve(dir, m[1]!.trim());
      try { gitDir = resolve(gitDir, (await readFile(join(gitDir, 'commondir'))).trim()); } catch { /* a submodule: its own config */ }
    }
    const url = originUrl(await readFile(join(gitDir, 'config')));
    return url ? repositoryId(url) : undefined;
  } catch { return undefined; }
}

async function describe(dir: string, dotIsFile: boolean, home: string, readFile: (p: string) => Promise<string>): Promise<FoundRepo> {
  const [branch, remote] = await Promise.all([
    dotIsFile ? inspectRepos([dir], { home }).then(r => r[0]?.branch ?? null) : headBranch(join(dir, '.git')),
    remoteOf(dir, dotIsFile, readFile)
  ]);
  return { path: dir, branch, ...(remote ? { remote } : {}) };
}

/**
 * The Git repositories under home, then under each `extra` root, breadth first, SCAN_DEPTH levels under each root. Home is walked
 * first, whole, so a big extra root (a Windows drive) cannot spend home's budget. A folder holding `.git` (a folder, or a file for a
 * worktree or a submodule) is one, and is not entered; home is the exception (a home kept in Git, dotfiles, hides nothing).
 * Links are not followed; skip-listed and hidden folders are not entered; a folder that cannot be read is passed over.
 * Stops at SCAN_DIRS folders read, SCAN_MS or SCAN_REPOS repositories, and then says `truncated`. Writes nothing, runs git only
 * for a `.git` file's branch.
 */
export async function scanRepos(opts: ScanOptions): Promise<{ repos: FoundRepo[]; truncated: boolean }> {
  const now = opts.now ?? Date.now;
  const readdir = opts.readdir ?? ((p: string) => fsReaddir(p, { withFileTypes: true }));
  const readFile = opts.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));
  const depth = opts.limits?.depth ?? SCAN_DEPTH, maxDirs = opts.limits?.dirs ?? SCAN_DIRS, ms = opts.limits?.ms ?? SCAN_MS, maxRepos = opts.limits?.repos ?? SCAN_REPOS;
  const deadline = now() + ms;
  // The hard stop, in real time: a folder or a git that never answers cannot hold the walk past its time.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'expired'>(res => { timer = setTimeout(() => res('expired'), ms); });
  const home = resolve(opts.home);
  const seen = new Set<string>();
  const repos: FoundRepo[] = []; let read = 0; let truncated = false;
  try {
    walk: for (const root of [home, ...(opts.extra ?? []).map(p => resolve(p))]) {
      if (seen.has(root)) continue; // listed twice, or already walked under an earlier root
      seen.add(root);
      const queue = [{ path: root, depth: 0 }];
      while (queue.length) {
        if (read >= maxDirs || repos.length >= maxRepos || now() >= deadline) { truncated = true; break walk; }
        const batch = queue.splice(0, Math.min(BATCH, maxDirs - read));
        read += batch.length;
        const listed = await Promise.race([Promise.all(batch.map(d => readdir(d.path).catch(() => null))), expired]);
        if (listed === 'expired') { truncated = true; break walk; }
        const found: Promise<FoundRepo>[] = [];
        batch.forEach((d, i) => {
          const entries = listed[i]; if (!entries) return;
          const dot = entries.find(e => e.name === '.git' && (e.isDirectory() || e.isFile()));
          if (dot) found.push(describe(d.path, dot.isFile(), opts.home, readFile));
          if ((dot && d.path !== home) || d.depth >= depth) return;
          const names = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map(e => e.name).sort();
          for (const name of names) { const path = join(d.path, name); if (!seen.has(path)) { seen.add(path); queue.push({ path, depth: d.depth + 1 }); } }
        });
        const described = await Promise.race([Promise.all(found), expired]);
        if (described === 'expired') { truncated = true; break walk; }
        for (const r of described) { if (repos.length >= maxRepos) { truncated = true; break walk; } repos.push(r); }
      }
    }
  } finally { clearTimeout(timer); }
  return { repos, truncated };
}
