import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ForgeAction, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { CI_TTL_MS, createForgeService, FAST_MS, SLOW_MS } from '../src/daemon/forge/service.js';
import { ForgeError, type BranchTarget, type ForgeReader, type PrCore, type ReadPr } from '../src/daemon/forge/types.js';
import { headOf } from '../src/daemon/forge/service.js';
import { forgeOf, type ForgeRun } from '../src/daemon/forge/run.js';
import type { ForgeRepo } from '../src/daemon/forge/run.js';
/** Git configs by folder, as `git config -z --get-regexp` prints them; a folder not listed answers nothing (code 1). */
const gitConfigs = new Map<string, string>();
const fakeGit: ForgeRun = async (_file, _args, opts = {}) => {
  const c = gitConfigs.get(opts.cwd ?? '');
  return c === undefined ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: c, stderr: '' };
};
const cfg = (entries: Record<string, string>) => Object.entries(entries).map(([k, v]) => `${k}\n${v}\0`).join('');

const T0 = Date.parse('2026-11-08T10:00:00.000Z');
let clock = T0;
const at = (ms: number) => new Date(T0 + ms).toISOString();
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: id, tool: 'claude', cwd: '/w', project: 'w', title: id, tmuxSession: null, state: 'idle', helpers: [], startedAt: at(0), lastActivityAt: at(0), source: 'launcher',
  repoId: 'github.com/Lyssaen/ledge', branch: 'feat/x', ...extra
});
const pr = (n: number, branch: string, extra: Partial<ReadPr> = {}): ReadPr => ({
  id: `github.com/Lyssaen/ledge#${n}`, forge: 'github', host: 'github.com', repo: 'Lyssaen/ledge', number: n, ref: `#${n}`, url: `https://github.com/Lyssaen/ledge/pull/${n}`, title: `PR ${n}`,
  state: 'open', branch, target: 'main', headSha: 'a'.repeat(40), pipeline: 'ok', approvals: { given: 1 }, mergeable: true, openThreads: 0, updatedAt: at(0), blockers: [], head: 'Lyssaen/ledge', ...extra
});

type Fake = ForgeReader & { lists: Array<{ repo: string; branches: readonly string[] }>; targets: BranchTarget[][]; acts: Array<{ number: number; action: ForgeAction }>; prs: ReadPr[]; fail?: ForgeError;
  /** Whether the repository has CI (true by default); an error: the forge cannot tell. */
  ci?: boolean | Error; ciReads: number };
function fakeReader(prs: ReadPr[] = []): Fake {
  const r: Fake = {
    prs, lists: [], acts: [], targets: [], ciReads: 0,
    async list(repo: ForgeRepo, targets: readonly BranchTarget[]) {
      r.lists.push({ repo: repo.repo, branches: targets.map(t => t.branch) });
      r.targets.push([...targets]);
      if (r.fail) throw r.fail;
      return r.prs.filter(p => targets.some(t => t.branch === p.branch && t.head.toLowerCase() === p.head.toLowerCase()));
    },
    async detail(_repo, n) {
      const p = r.prs.find(x => x.number === n)!;
      return { pr: p, description: '', author: 'a', reviewers: [], labels: [], issues: [], jobs: [], threads: [], files: [], commits: [], mergeCommand: 'gh pr merge', mergeBlockers: [] };
    },
    async act(_repo, p: PrCore, action) { r.acts.push({ number: p.number, action }); return { command: `gh ${action.kind}` }; },
    async defaultBranch() { return 'main'; },
    async hasCi() { r.ciReads++; if (r.ci instanceof Error) throw r.ci; return r.ci ?? true; }
  };
  return r;
}

let store: Store;
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-forge-')); store = new Store(); clock = T0; gitConfigs.clear(); });
const service = (gh: Fake, glab: Fake = fakeReader(), signed = ['github.com', 'gitlab.com']) => createForgeService({ store, now: () => clock, run: fakeGit, readers: { gh, glab }, signedIn: async () => new Set(signed) });

describe('where a branch is pushed (R1, review of d266f114)', () => {
  const listed = forgeOf('git@github.com:Lyssaen/ledge.git')!;
  const remotes = { 'remote.origin.url': 'git@github.com:Lyssaen/ledge.git', 'remote.fork.url': 'git@github.com:charles331/ledge.git' };
  it('reads the push remote, then the upstream, then origin', () => {
    expect(headOf(cfg({ ...remotes, 'branch.feat/x.pushremote': 'fork', 'branch.feat/x.remote': 'origin' }), 'feat/x', listed)).toEqual({ head: 'charles331/ledge', branch: 'feat/x' });
    expect(headOf(cfg({ ...remotes, 'remote.pushdefault': 'fork' }), 'feat/x', listed)).toEqual({ head: 'charles331/ledge', branch: 'feat/x' });
    expect(headOf(cfg({ ...remotes, 'branch.feat/x.remote': 'fork', 'branch.feat/x.merge': 'refs/heads/feat/other' }), 'feat/x', listed)).toEqual({ head: 'charles331/ledge', branch: 'feat/other' });
    expect(headOf(cfg(remotes), 'feat/x', listed)).toEqual({ head: 'Lyssaen/ledge', branch: 'feat/x' });
    expect(headOf('', 'feat/x', listed)).toEqual({ head: 'Lyssaen/ledge', branch: 'feat/x' });
    // A remote on another host says nothing of this forge: the listed repository.
    expect(headOf(cfg({ ...remotes, 'remote.gl.url': 'https://gitlab.com/a/b.git', 'branch.feat/x.pushremote': 'gl' }), 'feat/x', listed)).toEqual({ head: 'Lyssaen/ledge', branch: 'feat/x' });
  });

  it('two forks, one branch: the session pushing to its fork gets that fork\'s request, not the other one', async () => {
    gitConfigs.set('/w-fork', cfg({ ...remotes, 'branch.feat/x.pushremote': 'fork' }));
    store.upsert(mk('mine', { cwd: '/w-fork' }));
    store.upsert(mk('upstream', { cwd: '/w' }));
    const gh = fakeReader([pr(1, 'feat/x', { head: 'charles331/ledge' }), pr(2, 'feat/x', { head: 'someone/ledge', updatedAt: at(9000) }), pr(3, 'feat/x', { head: 'Lyssaen/ledge' })]);
    const s = service(gh);
    await s.refresh();
    expect(gh.lists).toHaveLength(1);
    expect(gh.targets[0]!.map(t => t.head).sort()).toEqual(['Lyssaen/ledge', 'charles331/ledge']);
    expect(s.state().prs.map(p => [p.number, p.sessions])).toEqual([[1, ['mine']], [3, ['upstream']]]);
    expect(s.state().prs[0]).not.toHaveProperty('head');
  });

  it('acts on the request of the session\'s own fork', async () => {
    gitConfigs.set('/w-fork', cfg({ ...remotes, 'branch.feat/x.pushremote': 'fork' }));
    store.upsert(mk('mine', { cwd: '/w-fork' }));
    const gh = fakeReader([pr(1, 'feat/x', { head: 'charles331/ledge' }), pr(2, 'feat/x', { head: 'someone/ledge' })]);
    const s = service(gh);
    await s.refresh();
    await s.act('github.com/Lyssaen/ledge#1', { kind: 'comment', body: 'ok' });
    expect(gh.acts.map(a => a.number)).toEqual([1]);
    await expect(s.act('github.com/Lyssaen/ledge#2', { kind: 'comment', body: 'no' })).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('what is followed (R1, R12)', () => {
  it('gives one request with both sessions on the same branch, most recently active first, from one list call', async () => {
    store.upsert(mk('old', { lastActivityAt: at(0) }));
    store.upsert(mk('new', { lastActivityAt: at(5000) }));
    const gh = fakeReader([pr(226, 'feat/x')]);
    const s = service(gh);
    await s.refresh();
    expect(gh.lists).toEqual([{ repo: 'Lyssaen/ledge', branches: ['feat/x'] }]);
    expect(s.state().prs).toHaveLength(1);
    expect(s.state().prs[0]!.sessions).toEqual(['new', 'old']);
    expect(s.state().prs[0]).not.toHaveProperty('blockers');
  });

  it('reads one list per repository, whatever the number of sessions and branches', async () => {
    store.upsert(mk('a', { branch: 'feat/a' }));
    store.upsert(mk('b', { branch: 'feat/b' }));
    store.upsert(mk('c', { branch: 'feat/c', rig: { seat: 'dev-back@ledge-dev', name: 'ledge-dev' } }));
    const gh = fakeReader([pr(1, 'feat/a'), pr(2, 'feat/b'), pr(3, 'feat/c')]);
    const s = service(gh);
    await s.refresh();
    expect(gh.lists).toHaveLength(1);
    expect(gh.lists[0]!.branches.slice().sort()).toEqual(['feat/a', 'feat/b', 'feat/c']);
    expect(s.state().prs.map(p => p.number).sort()).toEqual([1, 2, 3]);
  });

  it('leaves out default branches, detached heads and sessions without a repository', async () => {
    store.upsert(mk('m', { branch: 'main' }));
    store.upsert(mk('d', { branch: 'a41c9e2' }));
    store.upsert(mk('n', { repoId: undefined }));
    const gh = fakeReader();
    await service(gh).refresh();
    expect(gh.lists).toEqual([]);
  });

  it('drops the request of an archived session, and follows a session that changes branch', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x'), pr(227, 'feat/y')]);
    const s = service(gh);
    let changes = 0;
    s.onChange(() => changes++);
    await s.refresh();
    expect(s.state().prs.map(p => p.number)).toEqual([226]);
    store.patch('a', { branch: 'feat/y' });
    await s.refresh();
    expect(s.state().prs.map(p => p.number)).toEqual([227]);
    store.archive('a', at(1000));
    await s.refresh();
    expect(s.state().prs).toEqual([]);
    expect(changes).toBe(3);
  });

  it('calls onChange only when something changed', async () => {
    store.upsert(mk('a'));
    const s = service(fakeReader([pr(226, 'feat/x')]));
    let changes = 0;
    s.onChange(() => changes++);
    await s.refresh(); await s.refresh(); await s.refresh();
    expect(changes).toBe(1);
  });
});

describe('only the hosts the CLI is signed in to (security review of the push)', () => {
  it('never reads a host gh or glab is not signed in to: a repository cloned from anywhere makes no call there', async () => {
    store.upsert(mk('a'));
    store.upsert(mk('evil', { repoId: 'evil.example/x/y', branch: 'feat/x' }));
    store.upsert(mk('ghe', { repoId: 'code.github.attacker.example/x/y', branch: 'feat/x' }));
    const gh = fakeReader([pr(226, 'feat/x')]), glab = fakeReader();
    const s = service(gh, glab);
    await s.refresh();
    expect(gh.lists.map(l => l.repo)).toEqual(['Lyssaen/ledge']);
    expect(glab.lists).toEqual([]);
    expect(s.state().prs.map(p => p.number)).toEqual([226]);
    expect(s.state().forges).toEqual(expect.arrayContaining([
      expect.objectContaining({ forge: 'gitlab', host: 'evil.example', status: 'unauthenticated', message: 'glab is not signed in to evil.example on this machine: Ledge does not read it' }),
      expect.objectContaining({ forge: 'github', host: 'code.github.attacker.example', status: 'unauthenticated' })]));
  });

  it('reads a self-hosted host once the CLI is signed in to it', async () => {
    store.upsert(mk('g', { repoId: 'gitlab.example.com/team/app', branch: 'fix/x' }));
    const glab = fakeReader();
    await service(fakeReader(), glab, ['gitlab.example.com']).refresh();
    expect(glab.lists.map(l => l.repo)).toEqual(['https://gitlab.example.com/team/app']);
  });
});

describe('forges', () => {
  it('a missing glab shows as missing, and the GitHub requests still arrive', async () => {
    store.upsert(mk('a'));
    store.upsert(mk('g', { repoId: 'gitlab.com/synapse/synapse', branch: 'fix/s3-timeout' }));
    const glab = fakeReader();
    glab.fail = new ForgeError('missing', 'glab is not installed on this machine');
    const s = service(fakeReader([pr(226, 'feat/x')]), glab);
    await s.refresh();
    expect(s.state().prs.map(p => p.number)).toEqual([226]);
    expect(s.state().forges).toEqual(expect.arrayContaining([
      expect.objectContaining({ forge: 'gitlab', host: 'gitlab.com', status: 'missing', message: 'glab is not installed on this machine' }),
      expect.objectContaining({ forge: 'github', host: 'github.com', status: 'ok' })]));
  });

  it('waits 2, 4, 8 then 10 minutes after errors in a row, its host alone', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader();
    gh.fail = new ForgeError('error', 'HTTP 502');
    const s = service(gh);
    const callsAt = (ms: number) => { clock = T0 + ms; return s.refresh().then(() => gh.lists.length); };
    expect(await callsAt(0)).toBe(1);
    expect(await callsAt(119_000)).toBe(1);
    expect(await callsAt(120_000)).toBe(2);
    expect(await callsAt(120_000 + 239_000)).toBe(2);
    expect(await callsAt(360_000)).toBe(3);
    expect(await callsAt(360_000 + 479_000)).toBe(3);
    expect(await callsAt(840_000)).toBe(4);
    expect(await callsAt(840_000 + 599_000)).toBe(4);
    expect(await callsAt(1_440_000)).toBe(5);
    expect(await callsAt(1_440_000 + 600_000)).toBe(6);
    gh.fail = undefined;
    expect(s.state().forges[0]!.status).toBe('error');
    await callsAt(2_040_000 + 600_000);
    expect(s.state().forges[0]!.status).toBe('ok');
  });
});

// Lot 8b contract (N2): « le relevé échoue depuis 10:42. Nouvel essai à 10:50. », « relevé 10:42 ».
describe('a forge in error: since, retryAt, readAt', () => {
  it('keeps the start of the failure across messages, gives the next read and the last good one, drops them once read again', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x')]);
    const s = service(gh);
    await s.refresh();
    expect(s.state().forges[0]).toEqual({ forge: 'github', host: 'github.com', status: 'ok', at: at(0) });
    gh.fail = new ForgeError('error', 'HTTP 502');
    clock = T0 + 60_000; await s.refresh();
    expect(s.state().forges[0]).toMatchObject({ status: 'error', message: 'HTTP 502', since: at(60_000), retryAt: at(180_000), readAt: at(0) });
    expect(s.state().prs.map(p => p.number)).toEqual([226]);
    gh.fail = new ForgeError('error', 'HTTP 503');
    clock = T0 + 180_000; await s.refresh();
    expect(s.state().forges[0]).toMatchObject({ status: 'error', message: 'HTTP 503', at: at(180_000), since: at(60_000), retryAt: at(420_000), readAt: at(0) });
    gh.fail = undefined;
    clock = T0 + 420_000; await s.refresh();
    expect(s.state().forges[0]).toEqual({ forge: 'github', host: 'github.com', status: 'ok', at: at(420_000) });
  });
  it('a host never read: since, and no readAt', async () => {
    store.upsert(mk('g', { repoId: 'gitlab.example.com/team/app', branch: 'fix/x' }));
    const s = service(fakeReader(), fakeReader(), []);
    await s.refresh();
    const f = s.state().forges[0]!;
    expect(f).toMatchObject({ status: 'unauthenticated', since: at(0) });
    expect(f).not.toHaveProperty('readAt');
    expect(f).not.toHaveProperty('retryAt');
  });
});

// Lot 8b contract (N2): the chip « PR ? » needs the forge of each followed session, with or without a request.
describe('followed sessions', () => {
  it('lists each followed session with its forge, host and repository; a default branch is not followed', async () => {
    store.upsert(mk('a'));
    store.upsert(mk('b', { branch: 'feat/y' }));
    store.upsert(mk('g', { repoId: 'gitlab.com/synapse/synapse', branch: 'fix/s3' }));
    store.upsert(mk('m', { branch: 'main' }));
    const s = service(fakeReader([pr(226, 'feat/x')]), fakeReader(), ['github.com']);
    await s.refresh();
    expect(s.state().followed).toEqual([
      { session: 'a', forge: 'github', host: 'github.com', repo: 'Lyssaen/ledge' },
      { session: 'b', forge: 'github', host: 'github.com', repo: 'Lyssaen/ledge' },
      { session: 'g', forge: 'gitlab', host: 'gitlab.com', repo: 'synapse/synapse' }]);
    expect(s.state().forges).toEqual(expect.arrayContaining([expect.objectContaining({ forge: 'gitlab', host: 'gitlab.com', status: 'unauthenticated' })]));
  });
});

describe('the pace (R2)', () => {
  it('reads every 15 s while a pipeline runs, 60 s once it is green', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x', { pipeline: 'run' })]);
    const timers: number[] = [];
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms: number) => { timers.push(ms); return { unref() {} } as unknown as NodeJS.Timeout; }) as unknown as typeof setTimeout;
    try {
      const s = service(gh);
      s.start();
      await s.refresh();
      // start() schedules after its first read: the delay asked for is the last one.
      await new Promise(r => real(r, 10));
      expect(timers.at(-1)).toBe(FAST_MS);
      gh.prs = [pr(226, 'feat/x', { pipeline: 'ok' })];
      await s.refresh();
      s.stop();
      s.start();
      await new Promise(r => real(r, 10));
      expect(timers.at(-1)).toBe(SLOW_MS);
      s.stop();
    } finally { globalThis.setTimeout = real; }
  });
});

describe('actions (R5, R6)', () => {
  it('refuses a merge whose pipeline is not green, with the blockers, and runs no merge', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x', { pipeline: 'fail' })]);
    const s = service(gh);
    await s.refresh();
    await expect(s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'not_offered', message: 'the pipeline is not green' });
    gh.prs = [pr(226, 'feat/x', { state: 'draft', blockers: ['draft', 'approvals'] })];
    await expect(s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'not_offered', message: 'the request is a draft; an approval is missing' });
    expect(gh.acts).toEqual([]);
  });

  it('merges a request without CI (pipeline none, a repository without any CI), refuses one that runs or waits (R5)', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x', { pipeline: 'none' })]);
    gh.ci = false;
    const s = service(gh);
    await s.refresh();
    await s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) });
    expect(gh.acts.map(a => a.action.kind)).toEqual(['merge']);
    for (const pipeline of ['run', 'wait'] as const) {
      gh.prs = [pr(226, 'feat/x', { pipeline })];
      await expect(s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'not_offered', message: 'the pipeline is not green' });
    }
    expect(gh.acts).toHaveLength(1);
  });

  // Review of #230, finding 1, decided by the user on 2026-11-09: « without CI » only for a repository with no CI at all.
  it('in a repository with CI, a head without a pipeline waits: never mergeable, not « ready » for À toi', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x', { pipeline: 'none' })]);
    const s = service(gh);
    await s.refresh();
    expect(s.state().prs[0]).toMatchObject({ pipeline: 'wait', mergeable: true });
    expect(s.state().prs[0]).not.toHaveProperty('notStarted');
    await expect(s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'not_offered', message: 'no pipeline has started yet on the last commit' });
    const d = await s.detail('github.com/Lyssaen/ledge#226', {});
    expect(d.pr.pipeline).toBe('wait');
    expect(d.pr).not.toHaveProperty('notStarted');
    // Lot 8b contract: its own code, apart from a pipeline that exists and waits.
    expect(d.mergeBlockers).toEqual(['pipeline_not_started']);
    gh.prs = [pr(226, 'feat/x', { pipeline: 'wait' })];
    await expect(s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) })).rejects.toMatchObject({ message: 'the pipeline is not green' });
    expect(gh.acts).toEqual([]);
  });

  it('when the forge cannot tell whether the repository has CI, a head without a pipeline waits too', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x', { pipeline: 'none' })]);
    gh.ci = new ForgeError('error', 'HTTP 500');
    const s = service(gh);
    await s.refresh();
    expect(s.state().prs[0]?.pipeline).toBe('wait');
    await expect(s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'not_offered' });
  });

  it('reads whether a repository has CI once per 10 minutes: a workflow added makes a pipeline-less head wait', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x', { pipeline: 'none' })]);
    gh.ci = false;
    const s = service(gh);
    await s.refresh();
    expect(s.state().prs[0]?.pipeline).toBe('none');
    gh.ci = true;
    clock += 60_000; await s.refresh();
    expect(gh.ciReads).toBe(1);
    expect(s.state().prs[0]?.pipeline).toBe('none');
    clock += CI_TTL_MS; await s.refresh();
    expect(gh.ciReads).toBe(2);
    expect(s.state().prs[0]?.pipeline).toBe('wait');
  });

  it('refuses a merge with stale when the head moved, and runs no merge', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x')]);
    const s = service(gh);
    await s.refresh();
    gh.prs = [pr(226, 'feat/x', { headSha: 'b'.repeat(40) })];
    await expect(s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'stale' });
    expect(gh.acts).toEqual([]);
  });

  it('merges a green, approved request, then reads the list again', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x')]);
    const s = service(gh);
    await s.refresh();
    const before = gh.lists.length;
    expect(await s.act('github.com/Lyssaen/ledge#226', { kind: 'merge', headSha: 'a'.repeat(40) })).toEqual({ command: 'gh merge' });
    await s.refresh();
    expect(gh.acts).toEqual([{ number: 226, action: { kind: 'merge', headSha: 'a'.repeat(40) } }]);
    expect(gh.lists.length).toBeGreaterThan(before + 1);
  });

  it('refuses a rerun while the pipeline runs', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x', { pipeline: 'run' })]);
    const s = service(gh);
    await s.refresh();
    await expect(s.act('github.com/Lyssaen/ledge#226', { kind: 'rerun' })).rejects.toMatchObject({ code: 'busy' });
    expect(gh.acts).toEqual([]);
  });

  it('answers unavailable for a request it does not follow', async () => {
    const s = service(fakeReader());
    await expect(s.detail('github.com/x/y#1', {})).rejects.toMatchObject({ code: 'unavailable' });
    await expect(s.act('github.com/x/y#1', { kind: 'rerun' })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('keeps a detail 30 s, with the sessions', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x')]);
    let reads = 0;
    const detail = gh.detail.bind(gh);
    gh.detail = async (...a) => { reads++; return detail(...a); };
    const s = service(gh);
    await s.refresh();
    const d = await s.detail('github.com/Lyssaen/ledge#226', {});
    expect(d.pr.sessions).toEqual(['a']);
    expect(d.pr).not.toHaveProperty('blockers');
    clock += 29_000; await s.detail('github.com/Lyssaen/ledge#226', {});
    clock += 2_000; await s.detail('github.com/Lyssaen/ledge#226', {});
    expect(reads).toBe(2);
  });

  // Review of #230, finding 4: neither cache grows without bound on a long-running daemon.
  it('drops the detail of a request no longer followed: followed again, it is read again', async () => {
    store.upsert(mk('a'));
    const gh = fakeReader([pr(226, 'feat/x')]);
    let reads = 0;
    const detail = gh.detail.bind(gh);
    gh.detail = async (...a) => { reads++; return detail(...a); };
    const s = service(gh);
    await s.refresh();
    await s.detail('github.com/Lyssaen/ledge#226', {});
    store.remove('a');
    await s.refresh();
    store.upsert(mk('a'));
    await s.refresh();
    clock += 1_000; await s.detail('github.com/Lyssaen/ledge#226', {});
    expect(reads).toBe(2);
  });

  it('forgets where a session gone from the store pushes: back, its git config is read again', async () => {
    let gitReads = 0;
    const s = createForgeService({ store, now: () => clock, run: async (...a) => { gitReads++; return fakeGit(...a); }, readers: { gh: fakeReader(), glab: fakeReader() }, signedIn: async () => new Set(['github.com']) });
    store.upsert(mk('a'));
    await s.refresh();
    expect(gitReads).toBe(1);
    store.remove('a');
    await s.refresh();
    store.upsert(mk('a'));
    await s.refresh();
    expect(gitReads).toBe(2);
  });
});
