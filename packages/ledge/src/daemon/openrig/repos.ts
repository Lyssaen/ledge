import { readdir, readFile, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import type { Rig, RigRepo, Session } from '@ledge/protocol';
import { log } from '../../log.js';
import { execGit, type Exec } from '../git.js';
import { headBranch } from '../repos.js';
import { originUrl, SKIP } from '../scan.js';
import type { Bridge } from './bridge.js';

export const REPO_SCAN_MS = 30_000, REPO_DEPTH = 3;
type Found = Omit<RigRepo, 'by' | 'how'>;

/** The origin as written in `.git/config`, minus any `user:password@` of an http(s) URL (never shown to the fronts). */
const cleanRemote = (url: string): string => url.replace(/^(https?:\/\/)[^/@\s]*@/i, '$1');

/** The Git repositories under `root`, at most `depth` levels down (the repository's own folder counts as a level), `SKIP` folders left out;
 *  a repository is not entered. `modified` counts the lines of `git status --porcelain`. */
export async function findRigRepos(root: string, opts: { depth?: number; git?: Exec } = {}): Promise<Found[]> {
  const depth = opts.depth ?? REPO_DEPTH; const git = opts.git ?? execGit; const out: Found[] = [];
  const isDir = async (p: string) => { try { return (await stat(p)).isDirectory(); } catch { return false; } };
  const walk = async (dir: string, level: number): Promise<void> => {
    if (level > 0 && await stat(join(dir, '.git')).then(() => true, () => false)) {
      const dotGit = join(dir, '.git'); let remote: string | undefined;
      if (await isDir(dotGit)) { try { const url = originUrl(await readFile(join(dotGit, 'config'), 'utf8')); if (url) remote = cleanRemote(url); } catch { /* no config */ } }
      const branch = await headBranch(dotGit);
      const st = await git('git', ['status', '--porcelain'], dir);
      out.push({ path: dir, name: dir.split(/[\\/]/).filter(Boolean).pop() ?? dir, ...(branch ? { branch } : {}), ...(remote ? { remote } : {}),
        modified: st.code === 0 ? st.stdout.split('\n').filter(l => l.trim() !== '').length : 0 });
      return;
    }
    if (level >= depth) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries.filter(e => e.isDirectory() && !SKIP.has(e.name)).sort((a, b) => a.name.localeCompare(b.name))) await walk(join(dir, e.name), level + 1);
  };
  await walk(root, 0);
  return out;
}

const within = (path: string | undefined, repo: string): boolean => !!path && (path === repo || path.startsWith(repo.replace(/[\\/]$/, '') + (repo.includes('\\') ? '\\' : '/')));

/** Who worked in each repository: the first seat (by its session's `startedAt`) whose paired session's `cwd` or `repoPath` is inside it.
 *  `how`: `created` without a remote; `cloned` when `.git` was born after the rig launched; `opened` otherwise. No seat: `by` and `how` left out. */
export function attributeRepos(repos: readonly Found[], rig: Rig, sessions: readonly Session[], rigStartedAt: number, gitBirth: (path: string) => number | null): RigRepo[] {
  const mine = sessions.filter(s => s.rig?.rigId === rig.id).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return repos.map(r => {
    const s = mine.find(x => within(x.cwd, r.path) || within(x.repoPath, r.path) || within(x.workdir, r.path));
    if (!s) return { ...r };
    const seat = rig.seats.find(x => x.ref === s.rig!.seat);
    const birth = r.remote ? gitBirth(r.path) : null;
    return { ...r, by: seat?.name ?? s.rig!.member, how: !r.remote ? 'created' : birth !== null && birth > rigStartedAt ? 'cloned' : 'opened' };
  });
}

const birthOf = (path: string): number | null => { try { return statSync(join(path, '.git')).birthtimeMs; } catch { return null; } };

/** Every `every` ms (30 s), looks for the repositories of each off-project rig and annotates the rig when the list changed.
 *  A failed walk is logged and keeps the old list. Returns the stop function. */
export function watchRigRepos(d: { bridge: Pick<Bridge, 'rigs' | 'annotate'>; sessions(): Session[]; every?: number; find?: typeof findRigRepos }): () => void {
  const find = d.find ?? findRigRepos; const last = new Map<string, RigRepo[]>(); let busy = false;
  const scan = async () => {
    if (busy) return; busy = true;
    try {
      const sessions = d.sessions();
      for (const rig of d.bridge.rigs()) {
        if (!rig.offProject || !rig.cwd) continue;
        try {
          const own = sessions.filter(s => s.rig?.rigId === rig.id);
          const started = rig.launch ? Date.parse(rig.launch.startedAt) : Math.min(Infinity, ...own.map(s => Date.parse(s.startedAt)));
          const repos = attributeRepos(await find(rig.cwd), rig, sessions, Number.isFinite(started) ? started : Date.now(), birthOf);
          if (isDeepStrictEqual(last.get(rig.id), repos)) continue;
          last.set(rig.id, repos); d.bridge.annotate(rig.id, { repos });
        } catch (e) { log(`openrig: repo scan of ${rig.name}: ${(e as Error).message}`); }
      }
    } finally { busy = false; }
  };
  const t = setInterval(() => void scan(), d.every ?? REPO_SCAN_MS); t.unref();
  return () => clearInterval(t);
}
