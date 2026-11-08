import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrDetailSchema, PullRequestSchema } from '@ledge/protocol';
import { githubReader, rollup } from '../src/daemon/forge/github.js';
import { forgeOf, type ForgeRun } from '../src/daemon/forge/run.js';
import { ForgeRefusal } from '../src/daemon/forge/types.js';

const FX = join(import.meta.dirname, 'fixtures', 'forge');
const fx = (f: string): string => readFileSync(join(FX, f), 'utf8');
const repo = forgeOf('https://github.com/cli/cli.git')!;

type Call = { file: string; args: string[]; input?: string };
/** A `gh` answering from the Task 0 fixtures (real answers, redacted), recording every call. */
function fakeGh(over: (c: Call) => { code?: number; stdout?: string; stderr?: string } | undefined = () => undefined) {
  const calls: Call[] = [];
  const run: ForgeRun = async (file, args, opts = {}) => {
    const c = { file, args, input: opts.input };
    calls.push(c);
    const o = over(c);
    if (o) return { code: o.code ?? 0, stdout: o.stdout ?? '', stderr: o.stderr ?? '' };
    const a = args.join(' ');
    const out = (s: string) => ({ code: 0, stdout: s, stderr: '' });
    if (a.startsWith('pr list')) return out(fx('gh-pr-list-cli.json'));
    if (a.startsWith('pr view')) return out(fx('gh-pr-view-13506.json'));
    if (a.startsWith('repo view')) return out(JSON.stringify({ defaultBranchRef: { name: 'trunk' }, mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true }));
    if (a.startsWith('run list')) return out(fx('gh-run-list.json'));
    if (a.startsWith('run view')) return out(fx('gh-run-view-jobs.json'));
    if (a.startsWith('api graphql') && a.includes('closingIssuesReferences')) return out(fx('gh-graphql-13506.json'));
    if (a.startsWith('api graphql')) return out(JSON.stringify({ data: { repository: { p14964: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } }, p14927: { reviewThreads: { nodes: [] } } } } }));
    if (a.startsWith('api repos/cli/cli/pulls/13506/files')) return out(fx('gh-pr-files-13506.json'));
    if (/^api repos\/cli\/cli\/actions\/jobs\/\d+\/logs$/.test(a)) return out(fx('gh-job-log.txt'));
    return { code: 1, stdout: '', stderr: `unexpected: gh ${a}` };
  };
  return { run, calls };
}
const branches = ['bagtoad/triage-ghmock-skill', 'probe', 'dependabot/github_actions/codeql-actions-92276e7fb0', 'williammartin-multiaccount-draft-08-evaluation'];

describe('GitHub list', () => {
  it('gives the fields from the real answers, one pr list per repository', async () => {
    const { run, calls } = fakeGh();
    const prs = await githubReader(run).list(repo, branches);
    expect(calls.filter(c => c.args[0] === 'pr' && c.args[1] === 'list')).toHaveLength(1);
    const by = new Map(prs.map(p => [p.number, p]));
    expect(by.get(14976)).toMatchObject({ id: 'github.com/cli/cli#14976', ref: '#14976', state: 'merged', pipeline: 'ok', approvals: { given: 1 }, forge: 'github', target: 'trunk' });
    expect(by.get(14974)).toMatchObject({ state: 'closed' });
    expect(by.get(14964)).toMatchObject({ state: 'review', openThreads: 1, mergeable: false, blockers: ['approvals'] });
    expect(by.get(14927)).toMatchObject({ state: 'draft', pipeline: 'fail', blockers: ['draft', 'approvals'] });
    for (const p of prs) expect(PullRequestSchema.safeParse({ ...p, sessions: [] }).success).toBe(true);
  });

  it('reads no check as pipeline none', () => {
    expect(rollup([])).toBe('none');
    expect(rollup(undefined)).toBe('none');
    expect(rollup([{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('run');
    expect(rollup([{ __typename: 'CheckRun', status: 'QUEUED', conclusion: '' }])).toBe('wait');
    expect(rollup([{ __typename: 'StatusContext', state: 'PENDING' }])).toBe('wait');
    expect(rollup([{ __typename: 'StatusContext', state: 'SUCCESS' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }])).toBe('ok');
  });

  it('never puts a branch in the arguments: branches only filter, in Node', async () => {
    const { run, calls } = fakeGh();
    await githubReader(run).list(repo, ['--exec', '$(touch /tmp/x)', 'probe']);
    for (const c of calls) for (const a of c.args) expect(a).not.toMatch(/--exec|\$\(/);
  });
});

describe('GitHub detail', () => {
  it('gives the threads, reviewers, issues, files, commits, jobs and the log', async () => {
    const { run } = fakeGh();
    const d = await githubReader(run).detail(repo, 13506, { log: '128667644610' });
    const parsed = PrDetailSchema.safeParse({ ...d, pr: { ...d.pr, sessions: [] } });
    expect(parsed.success ? [] : parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
    expect(d.pr).toMatchObject({ state: 'review', number: 13506 });
    expect(d.reviewers).toContainEqual({ name: 'babakks', state: 'changes' });
    expect(d.labels).toEqual(['external', 'ready-for-review']);
    const review = d.threads.filter(t => t.resolvable);
    expect(review).toHaveLength(7);
    expect(review.filter(t => t.resolved)).toHaveLength(3);
    expect(review[0]).toMatchObject({ id: 'PRRT_kwDODKw3uc6EXf8h', file: 'script/gen-winres.ps1', line: 36 });
    expect(review[0]!.code).toBeTruthy();
    expect(d.threads.filter(t => !t.resolvable)).toHaveLength(2);
    expect(d.files.map(f => f.path)).toHaveLength(3);
    expect(d.files[0]!.patch).toMatch(/^@@/);
    expect(d.commits).toHaveLength(4);
    for (const c of d.commits) expect(c.author).not.toMatch(/@/);
    // One column per workflow: the run of the fixture is « Release » (production failed).
    expect(d.jobs.map(j => [j.columnName, j.name, j.status])).toContainEqual(['Release', 'production', 'fail']);
    expect(d.log?.text.split('\n').length).toBeLessThanOrEqual(60);
    expect(d.log?.text).not.toMatch(/##\[debug\]|\d{4}-\d\d-\d\dT\d\d:\d\d/);
    // R5: no pipeline at all (none, this request has no check) does not block a merge.
    expect(d.pr.pipeline).toBe('none');
    expect(d.mergeBlockers).toEqual(['approvals', 'changes_requested']);
    // R5: the repository's default method (here merge commits are off: squash).
    expect(d.mergeCommand).toBe('gh pr merge 13506 -R cli/cli --squash --match-head-commit fdb4e47437a3140146e76d12c0f3b5dd23df34a1');
  });

  it('refuses a log id that is not a job id', async () => {
    const { run } = fakeGh();
    await expect(githubReader(run).detail(repo, 13506, { log: '--web' })).rejects.toBeInstanceOf(ForgeRefusal);
  });
});

describe('GitHub actions', () => {
  const pr = { id: 'github.com/cli/cli#13506', forge: 'github' as const, host: 'github.com', repo: 'cli/cli', number: 13506, ref: '#13506', url: 'https://github.com/cli/cli/pull/13506', title: 't',
    state: 'open' as const, branch: '--exec', target: 'trunk', headSha: 'fdb4e47437a3140146e76d12c0f3b5dd23df34a1', pipeline: 'ok' as const, approvals: { given: 1 }, mergeable: true, openThreads: 0, updatedAt: '2026-11-08T10:00:00.000Z' };

  it('merges with --match-head-commit and the default method', async () => {
    const { run, calls } = fakeGh(c => (c.args[0] === 'pr' && c.args[1] === 'merge' ? { code: 0 } : undefined));
    const r = await githubReader(run).act(repo, pr, { kind: 'merge', headSha: pr.headSha });
    const merge = calls.find(c => c.args[1] === 'merge')!;
    expect(merge.args).toEqual(['pr', 'merge', '13506', '-R', 'cli/cli', '--squash', '--match-head-commit', pr.headSha]);
    expect(r.command).toContain('--match-head-commit');
  });

  it('sends a body on standard input, never in the arguments', async () => {
    const body = 'see $(rm -rf ~)\n--admin';
    const { run, calls } = fakeGh(c => (c.args[0] === 'pr' || c.args.includes('graphql') ? { code: 0, stdout: '{"data":{}}' } : undefined));
    const reader = githubReader(run);
    await reader.act(repo, pr, { kind: 'comment', body });
    await reader.act(repo, pr, { kind: 'reply', threadId: 'PRRT_kwDODKw3uc6EXf8h', body });
    await reader.act(repo, pr, { kind: 'resolve', threadId: 'PRRT_kwDODKw3uc6EXf8h' });
    expect(calls[0]!.args).toEqual(['pr', 'comment', '13506', '-R', 'cli/cli', '--body-file', '-']);
    expect(calls[0]!.input).toBe(body);
    expect(JSON.parse(calls[1]!.input!).variables).toEqual({ t: 'PRRT_kwDODKw3uc6EXf8h', b: body });
    expect(JSON.parse(calls[2]!.input!).query).toMatch(/resolveReviewThread/);
    for (const c of calls) for (const a of c.args) expect(a).not.toContain('rm -rf');
  });

  it('refuses a thread id that is not one, before running anything', async () => {
    const { run, calls } = fakeGh();
    await expect(githubReader(run).act(repo, pr, { kind: 'resolve', threadId: '--hostname=evil' })).rejects.toBeInstanceOf(ForgeRefusal);
    expect(calls).toHaveLength(0);
  });

  it('reruns the failed latest run of each workflow of the head commit, only those', async () => {
    const runs = [{ databaseId: 7, workflowName: 'CI', status: 'completed', conclusion: 'failure' }, { databaseId: 8, workflowName: 'Lint', status: 'completed', conclusion: 'success' },
      { databaseId: 6, workflowName: 'Lint', status: 'completed', conclusion: 'failure' }];
    const { run, calls } = fakeGh(c => (c.args[1] === 'rerun' ? { code: 0 } : c.args[1] === 'list' && c.args[0] === 'run' ? { stdout: JSON.stringify(runs) } : c.args[1] === 'view' && c.args[0] === 'run' ? { stdout: '{"jobs":[]}' } : undefined));
    const r = await githubReader(run).act(repo, pr, { kind: 'rerun' });
    expect(calls.find(c => c.args[0] === 'run' && c.args[1] === 'list')!.args).toEqual(expect.arrayContaining(['--commit', pr.headSha]));
    expect(calls.filter(c => c.args[1] === 'rerun').map(c => c.args)).toEqual([['run', 'rerun', '7', '-R', 'cli/cli', '--failed']]);
    expect(r.command).toBe('gh run rerun 7 -R cli/cli --failed');
  });

  it('refuses a rerun when the latest runs are green (the fixture: Release failed, then passed)', async () => {
    const { run, calls } = fakeGh();
    await expect(githubReader(run).act(repo, pr, { kind: 'rerun' })).rejects.toMatchObject({ code: 'not_offered' });
    expect(calls.some(c => c.args[1] === 'rerun')).toBe(false);
  });
});
