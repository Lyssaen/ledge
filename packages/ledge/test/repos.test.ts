import { describe, it, expect, vi, onTestFinished } from 'vitest';
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectRepos, readGitFile } from '../src/daemon/repos.js';
import { listFolder } from '../src/daemon/folders.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ledge-repos-'));

describe('inspectRepos', () => {
  it('reports a missing path, and resolves ~ against the given home (the path answered is the one asked)', async () => {
    const home = dir(); const seen: string[] = [];
    const out = await inspectRepos(['~', join(home, 'nope')], { home, git: async cwd => { seen.push(cwd); return 'main'; } });
    expect(out).toEqual([{ path: '~', exists: true, branch: 'main' }, { path: join(home, 'nope'), exists: false, branch: null }]);
    expect(seen).toEqual([home]);
  });
  it('echoes each path as asked (~/x, a trailing slash, ..): the front looks its answer up by the path it sent', async () => {
    const home = dir(); mkdirSync(join(home, 'x')); const seen: string[] = [];
    const asked = ['~/x', join(home, 'x') + '/', `${home}/x/../x`, '~/gone/'];
    const out = await inspectRepos(asked, { home, git: async cwd => { seen.push(cwd); return 'main'; } });
    expect(out.map(r => r.path)).toEqual(asked);
    expect(out.map(r => r.exists)).toEqual([true, true, true, false]);
    expect(seen).toEqual([join(home, 'x'), join(home, 'x'), join(home, 'x')]);
  });
  it('a detached HEAD gives the short commit', async () => {
    const d = dir();
    const git = async (_cwd: string, args: string[]) => (args.includes('--short=7') ? 'abc1234' : 'HEAD');
    expect((await inspectRepos([d], { git }))[0]).toEqual({ path: d, exists: true, branch: 'abc1234' });
  });
  it('a git that is absent or not a repository gives no branch', async () => {
    const d = dir();
    expect((await inspectRepos([d], { git: async () => null }))[0]!.branch).toBeNull();
  });
  it('a git that takes over 2 s gives no branch', async () => {
    const d = dir();
    const t0 = Date.now();
    const out = await inspectRepos([d], { git: () => new Promise(() => {}) });
    expect(out[0]).toEqual({ path: d, exists: true, branch: null });
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 10000);
  it('runs at most 8 git at once', async () => {
    const paths = Array.from({ length: 20 }, () => dir()); let live = 0, peak = 0;
    const git = async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 15)); live--; return 'main'; };
    const out = await inspectRepos(paths, { git });
    expect(peak).toBe(8); expect(out).toHaveLength(20); expect(out.every(r => r.branch === 'main')).toBe(true);
  });
  it('hands a freed slot to the one waiting: inspections arriving meanwhile and a listing never run more than 8 git at once', async () => {
    let live = 0, peak = 0; const pending: (() => void)[] = [];
    const git = () => new Promise<string>(r => { live++; peak = Math.max(peak, live); pending.push(() => { live--; r('main'); }); });
    const home = dir();
    for (let i = 0; i < 4; i++) { mkdirSync(join(home, `w${i}`)); writeFileSync(join(home, `w${i}`, '.git'), 'gitdir: /elsewhere\n'); }
    const all: Promise<unknown>[] = [inspectRepos(Array.from({ length: 10 }, () => dir()), { git })];
    await vi.waitFor(() => expect(live).toBe(8));
    all.push(listFolder(home, home, undefined, git));
    // One git ends; new inspections arrive at every microtask depth while its slot is handed over.
    pending.shift()!();
    for (let depth = 0; depth < 40; depth++) {
      let p = Promise.resolve();
      for (let i = 0; i < depth; i++) p = p.then(() => {});
      all.push(p.then(() => inspectRepos([dir()], { git })));
    }
    await new Promise(r => setTimeout(r, 100));
    expect(peak).toBe(8);
    // Let everything finish, one git at a time.
    let done = false; void Promise.all(all).then(() => { done = true; });
    while (!done) { pending.shift()?.(); await new Promise(r => setTimeout(r, 5)); expect(live).toBeLessThanOrEqual(8); }
    expect(peak).toBe(8);
  });
  it('a detached HEAD stays within 2 s in all for one path', async () => {
    const d = dir(); const t0 = Date.now();
    const git = (_c: string, args: string[]) => args.includes('--short=7') ? new Promise<string | null>(() => {}) : new Promise<string>(r => setTimeout(() => r('HEAD'), 1500));
    const out = await inspectRepos([d], { git });
    expect(out[0]).toEqual({ path: d, exists: true, branch: null });
    expect(Date.now() - t0).toBeLessThan(2400);
  }, 6000);
  it('does not spawn the second git once the path\'s deadline has passed', async () => {
    const d = dir(); const calls: string[][] = [];
    const git = async (_c: string, args: string[]) => { calls.push(args); await new Promise(r => setTimeout(r, 1990)); return 'HEAD'; };
    const t0 = Date.now(); const out = await inspectRepos([d], { git });
    expect(out[0]).toEqual({ path: d, exists: true, branch: null });
    expect(calls).toHaveLength(1); expect(Date.now() - t0).toBeLessThan(2400);
  }, 6000);
  it.skipIf(process.platform === 'win32')('a HEAD that is a FIFO, or too long, gives no branch and leaves a sound repository answered at once', async () => {
    const fifos: string[] = [];
    const repo = (head: string | 'fifo') => {
      const d = dir(); mkdirSync(join(d, '.git'));
      if (head === 'fifo') { execFileSync('mkfifo', [join(d, '.git', 'HEAD')]); fifos.push(join(d, '.git', 'HEAD')); }
      else writeFileSync(join(d, '.git', 'HEAD'), head);
      return d;
    };
    const stalled = Array.from({ length: 8 }, () => repo('fifo'));
    const long = repo('ref: refs/heads/' + 'x'.repeat(1 << 20) + '\n');
    const sound = repo('ref: refs/heads/main\n');
    // Should a read get stuck on a FIFO, a writer opening and closing it lets it go once the test ends, timed out or not.
    onTestFinished(() => { for (const f of fifos) { try { closeSync(openSync(f, constants.O_WRONLY | constants.O_NONBLOCK)); } catch { /* no reader */ } } });
    const t0 = Date.now();
    const first = await inspectRepos([...stalled, long], {});
    expect(first.map(r => r.branch)).toEqual(Array(9).fill(null));
    expect(await inspectRepos([sound], {})).toEqual([{ path: sound, exists: true, branch: 'main' }]);
    expect(Date.now() - t0).toBeLessThan(1000);
  }, 10000);
});

describe('readGitFile', () => {
  it.skipIf(process.platform === 'win32')('reads a regular file; refuses a FIFO (without waiting for a writer), a folder, a file over its bound', async () => {
    const d = dir();
    writeFileSync(join(d, 'config'), '[remote "origin"]\n');
    execFileSync('mkfifo', [join(d, 'fifo')]);
    writeFileSync(join(d, 'big'), 'x'.repeat(65));
    expect(await readGitFile(join(d, 'config'))).toBe('[remote "origin"]\n');
    await expect(readGitFile(join(d, 'fifo'))).rejects.toThrow(/not a regular file/);
    await expect(readGitFile(d)).rejects.toThrow(/not a regular file/);
    await expect(readGitFile(join(d, 'big'), 64)).rejects.toThrow(/over 64 bytes/);
    expect(await readGitFile(join(d, 'big'), 65)).toHaveLength(65);
  });
});
