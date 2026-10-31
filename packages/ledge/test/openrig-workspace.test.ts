import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RigLaunchWhere, RigPlan } from '@ledge/protocol';
import type { Exec } from '../src/daemon/git.js';
import { prepareWorkspace } from '../src/daemon/openrig/workspace.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'ledge-ws-')); dirs.push(d); return d; };

/** A git that answers from a script and records every argv. */
function fakeGit(o: { worktrees?: { path: string; branch?: string }[]; branchExists?: boolean; badRef?: boolean; addFails?: boolean } = {}) {
  const calls: string[][] = [];
  const git = (async (file, args) => {
    calls.push([file, ...args]);
    const a = args.join(' ');
    if (a.includes('worktree list --porcelain'))
      return { code: 0, stdout: (o.worktrees ?? []).map(w => `worktree ${w.path}\nHEAD abc\n${w.branch ? `branch refs/heads/${w.branch}` : 'detached'}\n`).join('\n') };
    if (args[0] === 'check-ref-format') return { code: o.badRef ? 1 : 0, stdout: args[2] ?? '' };
    if (a.includes('rev-parse --verify')) return { code: o.branchExists ? 0 : 1, stdout: '' };
    if (a.includes('worktree add')) return { code: o.addFails ? 1 : 0, stdout: '' };
    return { code: 1, stdout: '' };
  }) as Exec;
  return { git, calls };
}

const plan = (where: RigLaunchWhere, cwd: string): RigPlan => ({ id: 'plan-1', machine: 'local', spec: 'factory', goal: 'G', where, cwd, seats: [], writes: [], command: '', required: false });
const copy = (repo: string, branch = 'feat/rigs'): RigPlan =>
  plan({ kind: 'project', projectId: 'ledge', repo, branch, copy: true }, `${repo}/.worktrees/rig-factory`);

describe('prepareWorkspace', () => {
  it('copie : worktree add -b feat/rigs …/.worktrees/rig-factory, sans --force', async () => {
    const repo = tmp(); const { git, calls } = fakeGit({ worktrees: [{ path: repo, branch: 'main' }] });
    expect(await prepareWorkspace(copy(repo), git)).toEqual({ ok: true, created: true });
    expect(calls).toContainEqual(['git', '-C', repo, 'worktree', 'add', '-b', 'feat/rigs', `${repo}/.worktrees/rig-factory`]);
    expect(calls.flat()).not.toContain('--force');
  });
  it('copie, branche déjà là : worktree add <cwd> <branch>', async () => {
    const repo = tmp(); const { git, calls } = fakeGit({ branchExists: true });
    expect(await prepareWorkspace(copy(repo), git)).toEqual({ ok: true, created: true });
    expect(calls).toContainEqual(['git', '-C', repo, 'worktree', 'add', `${repo}/.worktrees/rig-factory`, 'feat/rigs']);
  });
  it('copie déjà sur la branche : réutilisée, aucun worktree add', async () => {
    const repo = tmp(); const cwd = `${repo}/.worktrees/rig-factory`; mkdirSync(cwd, { recursive: true });
    const { git, calls } = fakeGit({ worktrees: [{ path: repo, branch: 'main' }, { path: cwd, branch: 'feat/rigs' }] });
    expect(await prepareWorkspace(copy(repo), git)).toEqual({ ok: true, created: false });
    expect(calls.some(c => c.includes('add'))).toBe(false);
  });
  it('dossier présent qui n’est pas la copie → folder exists', async () => {
    const repo = tmp(); const cwd = `${repo}/.worktrees/rig-factory`; mkdirSync(cwd, { recursive: true });
    const { git, calls } = fakeGit({ worktrees: [{ path: repo, branch: 'main' }] });
    expect(await prepareWorkspace(copy(repo), git)).toEqual({ ok: false, reason: `folder exists: ${cwd}` });
    expect(calls.some(c => c.includes('add'))).toBe(false);
  });
  it('a worktree on another branch at that folder → folder exists', async () => {
    const repo = tmp(); const cwd = `${repo}/.worktrees/rig-factory`; mkdirSync(cwd, { recursive: true });
    const { git } = fakeGit({ worktrees: [{ path: cwd, branch: 'other' }] });
    expect(await prepareWorkspace(copy(repo), git)).toEqual({ ok: false, reason: `folder exists: ${cwd}` });
  });
  it.each(['-x', '--force'])('branch « %s » refused before any git call', async b => {
    const repo = tmp(); const { git, calls } = fakeGit();
    expect(await prepareWorkspace(copy(repo, b), git)).toEqual({ ok: false, reason: 'invalid branch' });
    expect(calls).toEqual([]);
  });
  it('a branch git check-ref-format rejects → invalid branch, no worktree call', async () => {
    const repo = tmp(); const { git, calls } = fakeGit({ badRef: true });
    expect(await prepareWorkspace(copy(repo, 'a..b'), git)).toEqual({ ok: false, reason: 'invalid branch' });
    expect(calls).toEqual([['git', 'check-ref-format', '--branch', 'a..b']]);
  });
  it('worktree add failing → refused', async () => {
    const repo = tmp(); const { git } = fakeGit({ addFails: true });
    expect(await prepareWorkspace(copy(repo), git)).toMatchObject({ ok: false, reason: expect.stringContaining('worktree') });
  });
  it('hors projet : mkdir -p du dossier', async () => {
    const home = tmp(); const cwd = join(home, 'rigs', 'reprise'); const { git, calls } = fakeGit();
    expect(await prepareWorkspace(plan({ kind: 'off-project', name: 'reprise' }, cwd), git)).toEqual({ ok: true, created: true });
    expect(existsSync(cwd)).toBe(true); expect(calls).toEqual([]);
    expect(await prepareWorkspace(plan({ kind: 'off-project', name: 'reprise' }, cwd), git)).toEqual({ ok: true, created: false });
  });
  it('projet sans copie : rien', async () => {
    const repo = tmp(); const { git, calls } = fakeGit();
    expect(await prepareWorkspace(plan({ kind: 'project', projectId: 'ledge', repo, branch: '', copy: false }, repo), git)).toEqual({ ok: true, created: false });
    expect(calls).toEqual([]);
  });
});
