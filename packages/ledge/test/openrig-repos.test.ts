import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rig, RigRepo, Session } from '@ledge/protocol';
import { attributeRepos, findRigRepos, REPO_SCAN_MS, watchRigRepos } from '../src/daemon/openrig/repos.js';

const dirs: string[] = [];
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'ledge-repos-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'ignore' });
const repo = (path: string, remote?: string) => { mkdirSync(path, { recursive: true }); git(path, 'init', '-q', '-b', 'main'); if (remote) git(path, 'remote', 'add', 'origin', remote); };

describe('findRigRepos', () => {
  it('finds ledge (modified, remote) and wsl-notes (no remote) within 3 levels, skips node_modules', async () => {
    const root = tmp();
    repo(join(root, 'ledge'), 'https://github.com/paradow/ledge.git'); writeFileSync(join(root, 'ledge', 'a.txt'), 'x'); writeFileSync(join(root, 'ledge', 'b.txt'), 'y');
    repo(join(root, 'a', 'b', 'wsl-notes'));
    repo(join(root, 'node_modules', 'dep'));
    const found = await findRigRepos(root);
    expect(found.map(r => r.name).sort()).toEqual(['ledge', 'wsl-notes']);
    const ledge = found.find(r => r.name === 'ledge')!;
    expect(ledge).toMatchObject({ path: join(root, 'ledge'), branch: 'main', remote: 'https://github.com/paradow/ledge.git', modified: 2 });
    const notes = found.find(r => r.name === 'wsl-notes')!;
    expect(notes.remote).toBeUndefined(); expect(notes.modified).toBe(0);
  });
  it('does not enter the 4th level', async () => {
    const root = tmp(); repo(join(root, 'a', 'b', 'c', 'deep'));
    expect(await findRigRepos(root)).toEqual([]);
    expect((await findRigRepos(root, { depth: 4 })).map(r => r.name)).toEqual(['deep']);
  });
});

const T0 = Date.parse('2026-10-31T10:00:00Z');
const RIG = { id: 'r1', name: 'studio', machine: 'local', cwd: '/rigs/studio', projectId: null, offProject: true, lifecycle: 'running', kernel: false, repos: [],
  seats: ['build', 'advisor', 'design'].map(n => ({ ref: `${n}@studio`, address: `@${n}`, name: n, runtime: 'claude-code', state: 'ready' })) } as Rig;
const sess = (seat: string, at: string, cwd: string, repoPath?: string) => ({ id: `s-${seat}`, cwd, ...(repoPath ? { repoPath } : {}), startedAt: at,
  rig: { machine: 'local', rigId: 'r1', rigName: 'studio', seat: `${seat}@studio`, pod: 'p', member: seat } }) as unknown as Session;

describe('attributeRepos', () => {
  const found = [
    { path: '/rigs/studio/ledge', name: 'ledge', remote: 'https://x/ledge', modified: 1 },
    { path: '/rigs/studio/openrig', name: 'openrig', remote: 'https://x/openrig', modified: 0 },
    { path: '/rigs/studio/wsl-notes', name: 'wsl-notes', modified: 0 },
    { path: '/rigs/studio/orphan', name: 'orphan', remote: 'https://x/o', modified: 0 }];
  const sessions = [
    sess('advisor', '2026-10-31T10:05:00Z', '/rigs/studio/openrig'),
    sess('design', '2026-10-31T10:06:00Z', '/rigs/studio', '/rigs/studio/wsl-notes'),
    sess('build', '2026-10-31T10:07:00Z', '/rigs/studio/ledge/src'),
    sess('design', '2026-10-31T10:01:00Z', '/elsewhere')];
  const birth = (p: string) => (p.endsWith('ledge') ? T0 + 60_000 : T0 - 60_000);
  it('ledge cloned by build, openrig opened by advisor, wsl-notes created by design; no seat leaves by/how out', () => {
    const out = attributeRepos(found, RIG, sessions, T0, birth);
    expect(out.slice(0, 3).map(r => [r.name, r.by, r.how])).toEqual([['ledge', 'build', 'cloned'], ['openrig', 'advisor', 'opened'], ['wsl-notes', 'design', 'created']]);
    expect(out[3]).toEqual({ path: '/rigs/studio/orphan', name: 'orphan', remote: 'https://x/o', modified: 0 });
  });
  it('the earliest session decides, a path prefix is not a match', () => {
    const s = [sess('build', '2026-10-31T10:09:00Z', '/rigs/studio/ledger'), sess('design', '2026-10-31T10:02:00Z', '/rigs/studio/ledge'), sess('advisor', '2026-10-31T10:03:00Z', '/rigs/studio/ledge')];
    const out = attributeRepos([found[0]!], RIG, s, T0, () => null);
    expect([out[0]!.by, out[0]!.how]).toEqual(['design', 'opened']);
  });
});

describe('watchRigRepos', () => {
  beforeEach(() => { vi.useFakeTimers(); }); afterEach(() => { vi.useRealTimers(); });
  it('one scan every 30 s, project rigs ignored, patch only when changed', async () => {
    const inProject = { ...RIG, id: 'r2', offProject: false } as Rig;
    const annotate = vi.fn(); const list: Omit<RigRepo, 'by' | 'how'>[] = [{ path: '/rigs/studio/a', name: 'a', modified: 0 }];
    const find = vi.fn(async () => list);
    const stop = watchRigRepos({ bridge: { rigs: () => [RIG, inProject], annotate }, sessions: () => [], find });
    expect(REPO_SCAN_MS).toBe(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(find).toHaveBeenCalledTimes(1); expect(find).toHaveBeenCalledWith('/rigs/studio');
    expect(annotate).toHaveBeenCalledTimes(1); expect(annotate).toHaveBeenCalledWith('r1', { repos: [{ path: '/rigs/studio/a', name: 'a', modified: 0 }] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(find).toHaveBeenCalledTimes(2); expect(annotate).toHaveBeenCalledTimes(1);
    list[0] = { path: '/rigs/studio/a', name: 'a', modified: 3 };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(annotate).toHaveBeenCalledTimes(2);
    find.mockRejectedValueOnce(new Error('boom'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(annotate).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(60_000);
    expect(find).toHaveBeenCalledTimes(4);
  });
});
