import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCAN_DEPTH, SCAN_DIRS, SCAN_MS, SCAN_REPOS, SKIP, extraRoots, scanRepos } from '../src/daemon/scan.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ledge-scan-'));
const git = (...args: string[]) => execFileSync('git', args, { stdio: 'ignore' });
/** A real repository on `branch`, with `remote` as its origin when given. */
function repo(path: string, opts: { branch?: string; remote?: string; commit?: boolean } = {}) {
  mkdirSync(path, { recursive: true });
  git('init', '-q', '-b', opts.branch ?? 'main', path);
  if (opts.remote) git('-C', path, 'remote', 'add', 'origin', opts.remote);
  if (opts.commit) git('-C', path, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one');
}
/** The real readdir, recording each folder read. */
function spy() {
  const read: string[] = [];
  return { read, readdir: (p: string) => { read.push(p); return readdir(p, { withFileTypes: true }); } };
}

describe('scanRepos', () => {
  it('finds a repository with its branch and normalised remote; skips plain folders, skip-listed and hidden ones, and never enters a repository', async () => {
    const home = tmp();
    repo(join(home, 'w/ledge'), { remote: 'git@github.com:paradow/ledge.git' });
    mkdirSync(join(home, 'w/notes/drafts'), { recursive: true });
    repo(join(home, 'w/ledge/sub/inner'));
    repo(join(home, 'node_modules/x'));
    repo(join(home, '.hidden/r'));
    const s = spy();
    const out = await scanRepos({ home, readdir: s.readdir });
    expect(out).toEqual({ repos: [{ path: join(home, 'w/ledge'), branch: 'main', remote: 'github.com/paradow/ledge' }], truncated: false });
    expect(s.read).toContain(join(home, 'w/notes'));
    expect(s.read).not.toContain(join(home, 'w/ledge/sub'));
    expect(s.read.some(p => p.startsWith(join(home, 'node_modules')) || p.startsWith(join(home, '.hidden')))).toBe(false);
  });

  it('reads at most two folders at once: a stalled mount never holds libuv\'s whole pool (4 threads)', async () => {
    const home = tmp();
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) mkdirSync(join(home, n, 'x'), { recursive: true });
    let now = 0, most = 0;
    const out = await scanRepos({ home, readdir: async p => { now++; most = Math.max(most, now); try { await new Promise(r => setTimeout(r, 5)); return await readdir(p, { withFileTypes: true }); } finally { now--; } } });
    expect(out.truncated).toBe(false);
    expect(most).toBe(2);
  });

  it('skips the usual heavy and system folders, and every hidden one', () => {
    for (const n of ['node_modules', '.git', '.cache', 'dist', 'build', 'target', 'vendor', '__pycache__', 'venv', '.venv', 'Library', 'AppData']) expect(SKIP.has(n)).toBe(true);
    expect([SCAN_DEPTH, SCAN_DIRS, SCAN_MS, SCAN_REPOS]).toEqual([4, 5000, 4000, 500]);
  });

  it('goes SCAN_DEPTH levels under the root, not further', async () => {
    const home = tmp();
    repo(join(home, 'a/b/c/d'));
    repo(join(home, 'a/b/c/x/y'));
    const out = await scanRepos({ home });
    expect(out.repos.map(r => r.path)).toEqual([join(home, 'a/b/c/d')]);
    expect(out.truncated).toBe(false);
  });

  it('a repository without commits has its branch, and one without origin has no remote', async () => {
    const home = tmp();
    repo(join(home, 'fresh'), { branch: 'trunk' });
    expect((await scanRepos({ home })).repos).toEqual([{ path: join(home, 'fresh'), branch: 'trunk' }]);
  });

  it('a .git file (a linked worktree): the branch through inspectRepos, the remote from the main repository config', async () => {
    const home = tmp();
    repo(join(home, 'w/main'), { remote: 'https://github.com/paradow/ledge.git', commit: true });
    git('-C', join(home, 'w/main'), 'worktree', 'add', '-q', '-b', 'feature', join(home, 'w/wt'));
    const out = await scanRepos({ home });
    expect(out.repos).toEqual([
      { path: join(home, 'w/main'), branch: 'main', remote: 'github.com/paradow/ledge' },
      { path: join(home, 'w/wt'), branch: 'feature', remote: 'github.com/paradow/ledge' }
    ]);
  });

  it('a root that is itself a repository (a dotfiles home) is listed and still walked', async () => {
    const home = tmp();
    repo(home, { branch: 'dots' });
    repo(join(home, 'w/app'));
    expect((await scanRepos({ home })).repos).toEqual([{ path: home, branch: 'dots' }, { path: join(home, 'w/app'), branch: 'main' }]);
  });

  it('an extra root that is itself a repository is listed but not entered: only home is walked past its own .git', async () => {
    const home = tmp(); const other = tmp();
    repo(other, { branch: 'top' });
    repo(join(other, 'inner'));
    const s = spy();
    expect((await scanRepos({ home, extra: [other], readdir: s.readdir })).repos).toEqual([{ path: other, branch: 'top' }]);
    expect(s.read).not.toContain(join(other, 'inner'));
  });

  it('home comes first in the budget: a big extra root cannot starve home\'s deeper levels', async () => {
    const home = tmp(); const big = tmp();
    repo(join(home, 'a/b/r'));
    for (let i = 0; i < 20; i++) mkdirSync(join(big, `f${i}`));
    const out = await scanRepos({ home, extra: [big], limits: { dirs: 4 } });
    expect(out).toEqual({ repos: [{ path: join(home, 'a/b/r'), branch: 'main' }], truncated: true });
  });

  it('a folder that never answers cannot hold the walk past its time (the real-time stop)', async () => {
    const home = tmp(); mkdirSync(join(home, 'dead')); repo(join(home, 'ok'));
    const started = Date.now();
    const out = await scanRepos({ home, limits: { ms: 50 }, readdir: p => p.endsWith('dead') ? new Promise(() => {}) : readdir(p, { withFileTypes: true }) });
    expect(Date.now() - started).toBeLessThan(500);
    expect(out.truncated).toBe(true);
  }, 2000);

  it('never follows a symbolic link', async () => {
    const home = tmp(); const away = tmp();
    repo(join(away, 'r'));
    symlinkSync(away, join(home, 'link'));
    expect((await scanRepos({ home })).repos).toEqual([]);
  });

  it('strips credentials from a remote', async () => {
    const home = tmp();
    repo(join(home, 'secret'), { remote: 'https://user:tok@host/a/b.git' });
    const out = await scanRepos({ home });
    expect(out.repos).toEqual([{ path: join(home, 'secret'), branch: 'main', remote: 'host/a/b' }]);
    expect(JSON.stringify(out)).not.toMatch(/tok|user/);
  });

  it('reads the origin section only, whatever its spacing, case and quotes', async () => {
    const home = tmp();
    mkdirSync(join(home, 'r/.git'), { recursive: true });
    writeFileSync(join(home, 'r/.git/HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(home, 'r/.git/config'), '[core]\n\turl = https://wrong/x\n[remote "upstream"]\n\turl = https://wrong/y\n[Remote "origin"]\n  fetch = +refs/heads/*:refs/remotes/origin/*\n  URL=\"git@gitlab.com:team/app.git\" ; a comment\n[branch "dev"]\n\turl = https://wrong/z\n');
    expect((await scanRepos({ home })).repos).toEqual([{ path: join(home, 'r'), branch: 'dev', remote: 'gitlab.com/team/app' }]);
  });

  it('stops at the folder budget and says so', async () => {
    const home = tmp();
    for (const n of ['a', 'b', 'c', 'd', 'e']) mkdirSync(join(home, n, 'deeper'), { recursive: true });
    repo(join(home, 'e/deeper/r'));
    const s = spy();
    const out = await scanRepos({ home, readdir: s.readdir, limits: { dirs: 3 } });
    expect(out.truncated).toBe(true);
    expect(s.read).toHaveLength(3);
    expect(out.repos).toEqual([]);
  });

  it('a walk that ends exactly on the budget is complete', async () => {
    const home = tmp(); mkdirSync(join(home, 'a'));
    expect(await scanRepos({ home, limits: { dirs: 2 } })).toEqual({ repos: [], truncated: false });
  });

  it('stops at the deadline (an injected clock) and keeps what it found', async () => {
    const home = tmp();
    repo(join(home, 'first'));
    mkdirSync(join(home, 'later/deep'), { recursive: true });
    repo(join(home, 'later/deep/r'));
    // Reading home takes all but 1 ms of the time; each later folder takes 1 ms more.
    let t = 0; const read: string[] = [];
    const out = await scanRepos({ home, now: () => t, readdir: async p => { read.push(p); t += p === home ? SCAN_MS - 1 : 1; return readdir(p, { withFileTypes: true }); } });
    expect(out.truncated).toBe(true);
    expect(read).toContain(join(home, 'first'));
    expect(read).not.toContain(join(home, 'later/deep'));
    expect(out.repos.map(r => r.path)).toEqual([join(home, 'first')]);
  });

  it('stops at the repository cap and says so', async () => {
    const home = tmp();
    for (const n of ['a', 'b', 'c']) repo(join(home, n));
    const out = await scanRepos({ home, limits: { repos: 2 } });
    expect(out).toEqual({ repos: [{ path: join(home, 'a'), branch: 'main' }, { path: join(home, 'b'), branch: 'main' }], truncated: true });
  });

  it('a folder it cannot read is passed over', async () => {
    const home = tmp(); mkdirSync(join(home, 'locked')); repo(join(home, 'open'));
    const out = await scanRepos({ home, readdir: async p => { if (p.endsWith('locked')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return readdir(p, { withFileTypes: true }); } });
    expect(out).toEqual({ repos: [{ path: join(home, 'open'), branch: 'main' }], truncated: false });
  });

  it('walks the extra roots too, each folder once', async () => {
    const home = tmp(); const other = tmp();
    repo(join(other, 'proj'));
    repo(join(home, 'mine'));
    const s = spy();
    const out = await scanRepos({ home, extra: [other, home, other], readdir: s.readdir });
    expect(out.repos.map(r => r.path)).toEqual([join(home, 'mine'), join(other, 'proj')]);
    expect(new Set(s.read).size).toBe(s.read.length);
    expect(readdirSync(other)).toEqual(['proj']);
  });
});

describe('extraRoots', () => {
  it('the parents of folders outside home, once each; nothing for folders under home', () => {
    expect(extraRoots('/home/u', ['/home/u/w/a', '/mnt/c/dev/ledge', '/mnt/c/dev/notes', '/srv/app/', '/home/u'])).toEqual(['/mnt/c/dev', '/srv']);
  });
  it('a folder whose parent is the filesystem root stands for itself; the root itself is never walked', () => {
    expect(extraRoots('/home/u', ['/opt', '/'])).toEqual(['/opt']);
  });
  it('a sibling of home whose name starts like it is not under home', () => {
    expect(extraRoots('/home/u', ['/home/u2/x'])).toEqual(['/home/u2']);
  });
});
