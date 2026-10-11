import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitInfo, gitSummary } from '../src/daemon/git.js';

let root: string; let main: string; let linked: string;
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ledge-git-'))); main = join(root, 'repo'); linked = join(root, 'wt-feature');
  mkdirSync(main); git(main, 'init', '-q', '-b', 'main'); git(main, 'config', 'user.email', 't@t'); git(main, 'config', 'user.name', 't');
  writeFileSync(join(main, 'a.txt'), 'a'); git(main, 'add', '.'); git(main, 'commit', '-q', '-m', 'first');
  mkdirSync(join(main, 'sub')); git(main, 'worktree', 'add', '-q', '-b', 'worktree-feature', linked);
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('gitInfo', () => {
  it('reads the main worktree, from its root or a subfolder', async () => {
    expect(await gitInfo(main)).toEqual({ repo: 'repo', repoPath: main, branch: 'main', worktree: false });
    expect(await gitInfo(join(main, 'sub'))).toMatchObject({ repo: 'repo', repoPath: main, worktree: false });
  });
  it('reads a linked worktree back to its repository', async () => {
    expect(await gitInfo(linked)).toEqual({ repo: 'repo', repoPath: main, branch: 'worktree-feature', worktree: true });
  });
  it('shows the short sha on a detached head', async () => {
    git(linked, 'checkout', '-q', '--detach');
    expect((await gitInfo(linked))?.branch).toMatch(/^[0-9a-f]{7,}$/);
    git(linked, 'checkout', '-q', 'worktree-feature');
  });
  it('is null outside a repository and when git fails', async () => {
    expect(await gitInfo(root)).toBeNull();
    expect(await gitInfo(main, async () => ({ code: 1, stdout: '' }))).toBeNull();
  });
});

describe('gitSummary', () => {
  it('joins status, log and diff stat, null outside a repository', async () => {
    writeFileSync(join(main, 'a.txt'), 'changed');
    const s = await gitSummary(main);
    expect(s).toContain('## main'); expect(s).toContain('first'); expect(s).toContain('a.txt');
    expect(await gitSummary(root)).toBeNull();
  });
});
