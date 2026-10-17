import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectRepos } from '../src/daemon/repos.js';

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
});
