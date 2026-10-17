import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listFolder, createFolder, gitBranchOf } from '../src/daemon/folders.js';

describe('folders: the launch form browser', () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-folders-')); });

  it('lists the subfolders by name, case-insensitive and numeric, without hidden ones or files', async () => {
    for (const d of ['web', 'Api', 'app10', 'app9', '.git']) mkdirSync(join(home, d));
    writeFileSync(join(home, 'README.md'), 'x');
    expect(await listFolder(home, home)).toEqual({ type: 'folder.listing', path: home, parent: join(home, '..'), entries: ['Api', 'app9', 'app10', 'web'], repos: [] });
  });
  it('follows a link to a folder and skips a dangling one', async () => {
    mkdirSync(join(home, 'real'));
    symlinkSync(join(home, 'real'), join(home, 'linked'));
    symlinkSync(join(home, 'gone'), join(home, 'dangling'));
    expect((await listFolder(home, home)).entries).toEqual(['linked', 'real']);
  });
  it('starts at home with no path, expands ~, and has no parent at the root', async () => {
    mkdirSync(join(home, 'w'));
    expect((await listFolder(undefined, home)).path).toBe(home);
    expect((await listFolder('', home)).path).toBe(home);
    expect((await listFolder('~/w', home)).path).toBe(join(home, 'w'));
    expect((await listFolder('/', home)).parent).toBeNull();
  });
  it('answers a bad path with the reason, keeping the asked path', async () => {
    expect(await listFolder('~/nope', home)).toEqual({ type: 'folder.listing', path: '~/nope', parent: null, entries: [], error: `no such folder: ${join(home, 'nope')}` });
    expect((await listFolder('relative', home)).error).toMatch(/not an absolute path/);
  });
  it('lists a folder whose name has edge whitespace and echoes its path exactly, never the trimmed sibling', async () => {
    for (const d of ['trail ', 'trail', ' lead']) mkdirSync(join(home, d));
    mkdirSync(join(home, 'trail ', 'inside'));
    expect((await listFolder(home, home)).entries).toEqual([' lead', 'trail', 'trail ']);
    expect(await listFolder(join(home, 'trail '), home)).toEqual({ type: 'folder.listing', path: join(home, 'trail '), parent: home, entries: ['inside'], repos: [] });
    expect((await listFolder(join(home, ' lead'), home)).path).toBe(join(home, ' lead'));
    // A refusal echoes the asked path byte for byte too, so the browser waiting for it stops waiting.
    expect(await listFolder(`${home}/gone `, home)).toMatchObject({ path: `${home}/gone `, error: `no such folder: ${home}/gone ` });
    expect((await listFolder('  ', home)).path).toBe('  ');
  });
  it('creates a folder and lists it', async () => {
    const got = await createFolder('~', ' new-project ', home);
    expect(got).toEqual({ type: 'folder.listing', path: join(home, 'new-project'), parent: home, entries: [], repos: [] });
    expect(statSync(join(home, 'new-project')).isDirectory()).toBe(true);
  });
  it('refuses an invalid name, an existing folder and a missing parent, listing the parent with the reason', async () => {
    mkdirSync(join(home, 'taken'));
    for (const bad of ['..', '.', 'a/b', '   ', 'a\0b']) {
      const got = await createFolder(home, bad, home);
      expect(got.error).toMatch(/invalid folder name/);
      expect(got).toMatchObject({ path: home, entries: ['taken'] });
    }
    expect((await createFolder(home, 'taken', home)).error).toBe('already exists: taken');
    expect((await createFolder('~/nope', 'x', home)).error).toMatch(/no such folder/);
    expect(existsSync(join(home, 'nope'))).toBe(false);
  });

  describe('Git repositories among the subfolders', () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
    const repo = (path: string, branch: string) => { mkdirSync(path); git(path, 'init', '-q', '-b', branch); git(path, 'commit', '-q', '--allow-empty', '-m', 'x'); };
    it('names each repository with its branch, in the order of the entries, and copies the requestId', async () => {
      repo(join(home, 'repo'), 'trunk'); mkdirSync(join(home, 'plain')); repo(join(home, 'detached'), 'main');
      const sha = git(join(home, 'detached'), 'rev-parse', 'HEAD'); git(join(home, 'detached'), 'checkout', '-q', '--detach');
      const l = await listFolder(home, home, 'req-1');
      expect(l.entries).toEqual(['detached', 'plain', 'repo']);
      expect(l.repos).toEqual([{ name: 'detached', branch: sha.slice(0, 7) }, { name: 'repo', branch: 'trunk' }]);
      expect(l.requestId).toBe('req-1');
    });
    it('has no requestId key when none was asked, and repos is empty without repositories', async () => {
      mkdirSync(join(home, 'plain'));
      const l = await listFolder(home, home);
      expect('requestId' in l).toBe(false);
      expect(l.repos).toEqual([]);
    });
    it('a refusal and a creation copy the requestId too', async () => {
      expect(await listFolder('~/nope', home, 'r')).toMatchObject({ requestId: 'r', error: expect.any(String) });
      expect(await createFolder(home, 'new', home, 'r2')).toMatchObject({ requestId: 'r2', path: join(home, 'new') });
    });
    it('gitBranchOf reads HEAD without git: a branch, a short sha, nothing', async () => {
      const d = join(home, 'x'); mkdirSync(join(d, '.git'), { recursive: true });
      writeFileSync(join(d, '.git', 'HEAD'), 'ref: refs/heads/feat/a\n');
      expect(await gitBranchOf(d)).toBe('feat/a');
      writeFileSync(join(d, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
      expect(await gitBranchOf(d)).toBe('0123456');
      expect(await gitBranchOf(join(home, 'nogit'))).toBeNull();
    });
    it('gitBranchOf asks git when .git is a file (a worktree)', async () => {
      repo(join(home, 'main'), 'trunk'); const wt = join(home, 'wt'); git(join(home, 'main'), 'worktree', 'add', '-q', '-b', 'side', wt);
      expect(await gitBranchOf(wt)).toBe('side');
    });
  });
});
