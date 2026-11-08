import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrDetailSchema, PullRequestSchema } from '@ledge/protocol';
import { githubReader, pipelineOf, rollup } from '../src/daemon/forge/github.js';
import { createForgeService } from '../src/daemon/forge/service.js';
import { Store } from '../src/daemon/store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    if (a.startsWith('pr view')) return out(fx('gh-pr-view-13506.json'));
    if (a.startsWith('repo view')) return out(JSON.stringify({ defaultBranchRef: { name: 'trunk' }, mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true }));
    if (a.startsWith('run list')) return out(fx('gh-run-list.json'));
    if (a.startsWith('run view')) return out(fx('gh-run-view-jobs.json'));
    if (a.startsWith('api graphql') && a.includes('closingIssuesReferences')) return out(fx('gh-graphql-13506.json'));
    // The list: the real answer of cli/cli for the four branches below (Task 0 bis, read only).
    if (a === 'api graphql --input -' && opts.input?.includes('pullRequests(headRefName')) return out(fx('gh-graphql-list-cli.json'));
    if (a.startsWith('api repos/cli/cli/pulls/13506/files')) return out(fx('gh-pr-files-13506.json'));
    if (/^api repos\/cli\/cli\/actions\/jobs\/\d+\/logs$/.test(a)) return out(fx('gh-job-log.txt'));
    return { code: 1, stdout: '', stderr: `unexpected: gh ${a}` };
  };
  return { run, calls };
}
const branches = ['bagtoad/triage-ghmock-skill', 'probe', 'dependabot/github_actions/codeql-actions-92276e7fb0', 'williammartin-multiaccount-draft-08-evaluation'];
/** Sessions whose branches are pushed to cli/cli itself. */
const targets = branches.map(branch => ({ branch, head: 'cli/cli' }));
type Node = Record<string, unknown>;
const node = (n: number, branch: string, head: string, extra: Node = {}): Node => ({ number: n, title: `PR ${n}`, url: `https://github.com/o/r/pull/${n}`, state: 'OPEN', isDraft: false,
  headRefName: branch, headRefOid: 'a'.repeat(40), baseRefName: 'main', updatedAt: '2026-11-08T10:00:00Z', reviewDecision: null, headRepository: { nameWithOwner: head },
  reviewRequests: { nodes: [] }, latestReviews: { nodes: [{ author: { login: 'lead' }, state: 'APPROVED' }] }, reviewThreads: { nodes: [] }, commits: { nodes: [] }, ...extra });

describe('GitHub list', () => {
  it('gives the fields from the real answer, in one query per repository', async () => {
    const { run, calls } = fakeGh();
    const prs = await githubReader(run).list(repo, targets);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(['api', 'graphql', '--input', '-']);
    const by = new Map(prs.map(p => [p.number, p]));
    expect(by.get(14976)).toMatchObject({ id: 'github.com/cli/cli#14976', ref: '#14976', state: 'merged', pipeline: 'ok', approvals: { given: 1 }, forge: 'github', target: 'trunk', head: 'cli/cli' });
    expect(by.get(14964)).toMatchObject({ state: 'review', mergeable: false, blockers: ['approvals'] });
    expect(by.get(14927)).toMatchObject({ state: 'draft', pipeline: 'fail', openThreads: 4, blockers: ['draft', 'approvals'] });
    for (const p of prs) expect(PullRequestSchema.safeParse({ ...p, sessions: [] }).success).toBe(true);
  });

  it('leaves out a request from another fork with the same branch (the real `probe`, from a fork of cli/cli)', async () => {
    const { run } = fakeGh();
    const reader = githubReader(run);
    expect((await reader.list(repo, targets)).map(p => p.number)).not.toContain(14974);
    // The same answer (the fixture's aliases follow the four branches), the session on `probe` pushing to that fork this time.
    const fromFork = targets.map(t => (t.branch === 'probe' ? { ...t, head: 'escaleraalcielo/tmp-cli-fork-delete-me' } : t));
    expect((await reader.list(repo, fromFork)).filter(p => p.branch === 'probe').map(p => [p.number, p.state])).toEqual([[14974, 'closed']]);
  });

  it('two forks, one branch name: each session gets its own fork\'s request, even when the other is open or newer', async () => {
    const answer = { data: { repository: { b0: { nodes: [node(2, 'feat/x', 'someone/ledge', { updatedAt: '2026-11-08T12:00:00Z' }), node(1, 'feat/x', 'charles331/ledge', { state: 'MERGED', updatedAt: '2026-11-01T10:00:00Z' })] } } } };
    const { run } = fakeGh(() => ({ stdout: JSON.stringify(answer) }));
    const prs = await githubReader(run).list(repo, [{ branch: 'feat/x', head: 'Charles331/Ledge' }]);
    expect(prs.map(p => [p.number, p.state, p.head])).toEqual([[1, 'merged', 'charles331/ledge']]);
  });

  it('asks the forge for the followed branch names only: a request older than any page of the whole list is still found', async () => {
    // 300 newer requests on other branches would fill the pages of a whole list; the query never sees them.
    const { run, calls } = fakeGh(c => {
      const q = JSON.parse(c.input!) as { query: string; variables: Record<string, string> };
      const nodes = q.variables.b0 === 'feat/old' ? [node(7, 'feat/old', 'cli/cli', { updatedAt: '2020-01-01T00:00:00Z' })] : [];
      return { stdout: JSON.stringify({ data: { repository: { b0: { nodes } } } }) };
    });
    const prs = await githubReader(run).list(repo, [{ branch: 'feat/old', head: 'cli/cli' }]);
    expect(prs.map(p => p.number)).toEqual([7]);
    const q = JSON.parse(calls[0]!.input!) as { query: string };
    expect(q.query).toContain('pullRequests(headRefName: $b0');
  });

  it('reads the pipeline from GitHub\'s summary over every check: a failure or a wait past the first 100 is never green (R5)', () => {
    const green = Array.from({ length: 100 }, () => ({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }));
    const more = { pageInfo: { hasNextPage: true }, nodes: green };
    expect(pipelineOf({ state: 'FAILURE', contexts: more })).toBe('fail');
    expect(pipelineOf({ state: 'ERROR', contexts: more })).toBe('fail');
    expect(pipelineOf({ state: 'PENDING', contexts: more })).toBe('wait');
    expect(pipelineOf({ state: 'PENDING', contexts: { nodes: [{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }] } })).toBe('run');
    expect(pipelineOf({ state: 'SUCCESS', contexts: more })).toBe('ok');
    // No summary: contexts not all read are never green.
    expect(pipelineOf({ state: null, contexts: more })).toBe('wait');
    expect(pipelineOf(null)).toBe('none');
  });

  it('follows each branch\'s pages: a request older than the first 50 of its name is found; past 20 pages the list is said incomplete', async () => {
    const others = Array.from({ length: 50 }, (_, i) => node(100 + i, 'feat/x', `fork${i}/ledge`));
    const { run, calls } = fakeGh(c => {
      const v = (JSON.parse(c.input!) as { variables: Record<string, string | null> }).variables;
      const conn = v.a0 === null ? { pageInfo: { hasNextPage: true, endCursor: 'p2' }, nodes: others } : { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(7, 'feat/x', 'cli/cli', { state: 'MERGED' })] };
      return { stdout: JSON.stringify({ data: { repository: { b0: conn } } }) };
    });
    expect((await githubReader(run).list(repo, [{ branch: 'feat/x', head: 'cli/cli' }])).map(p => p.number)).toEqual([7]);
    expect(calls.map(c => JSON.parse(c.input!).variables.a0)).toEqual([null, 'p2']);
    const endless = fakeGh(c => ({ stdout: JSON.stringify({ data: { repository: { b0: { pageInfo: { hasNextPage: true, endCursor: `c${c.input!.length}` }, nodes: [] } } } }) }));
    await expect(githubReader(endless.run).list(repo, [{ branch: 'feat/x', head: 'cli/cli' }])).rejects.toMatchObject({ status: 'error', message: expect.stringContaining('incomplete list') });
    expect(endless.calls).toHaveLength(20);
  });

  it('refuses an answer with errors, even with data: no merge runs on a pipeline it could not read', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-gh-partial-'));
    const store = new Store();
    const at = '2026-11-08T10:00:00.000Z';
    store.upsert({ id: 's', name: 's', tool: 'claude', cwd: '/nowhere', project: 'w', title: 's', tmuxSession: null, state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', repoId: 'github.com/cli/cli', branch: 'feat/x' });
    const greenApproved = node(9, 'feat/x', 'cli/cli', { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [] } } } }] } });
    let partial = false;
    const { run, calls } = fakeGh(c => {
      if (c.file === 'git') return { code: 1 };
      if (c.args[0] === 'repo') return { stdout: '{"defaultBranchRef":{"name":"trunk"},"mergeCommitAllowed":true}' };
      if (c.args[1] === 'merge') return { code: 0 };
      const n = partial ? { ...greenApproved, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } } : greenApproved;
      return { stdout: JSON.stringify({ data: { repository: { b0: { nodes: [n] } } }, ...(partial ? { errors: [{ message: 'statusCheckRollup: something went wrong' }] } : {}) }) };
    });
    const s = createForgeService({ store, run, readers: { gh: githubReader(run) } });
    await s.refresh();
    expect(s.state().prs.map(p => [p.number, p.pipeline, p.mergeable])).toEqual([[9, 'ok', true]]);
    partial = true;
    await expect(s.act('github.com/cli/cli#9', { kind: 'merge', headSha: 'a'.repeat(40) })).rejects.toMatchObject({ status: 'error', message: 'statusCheckRollup: something went wrong' });
    expect(calls.some(c => c.args[1] === 'merge')).toBe(false);
  });

  it('reads no check as pipeline none', () => {
    expect(rollup([])).toBe('none');
    expect(rollup(undefined)).toBe('none');
    expect(rollup([{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('run');
    expect(rollup([{ __typename: 'CheckRun', status: 'QUEUED', conclusion: '' }])).toBe('wait');
    expect(rollup([{ __typename: 'StatusContext', state: 'PENDING' }])).toBe('wait');
    expect(rollup([{ __typename: 'StatusContext', state: 'SUCCESS' }, { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }])).toBe('ok');
  });

  it('never puts a branch in the arguments nor in the query text: they travel as variables on standard input', async () => {
    const { run, calls } = fakeGh(() => ({ stdout: '{"data":{"repository":{"b0":{"nodes":[]},"b1":{"nodes":[]},"b2":{"nodes":[]}}}}' }));
    await githubReader(run).list(repo, [{ branch: '--exec', head: 'cli/cli' }, { branch: '$(touch /tmp/x)', head: 'cli/cli' }, { branch: 'x" } } evil { "', head: 'cli/cli' }]);
    for (const c of calls) for (const a of c.args) expect(a).not.toMatch(/--exec|\$\(|evil/);
    const q = JSON.parse(calls[0]!.input!) as { query: string; variables: Record<string, string> };
    expect(q.query).not.toMatch(/--exec|\$\(|evil/);
    expect(Object.values(q.variables)).toEqual(expect.arrayContaining(['--exec', '$(touch /tmp/x)', 'x" } } evil { "']));
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
