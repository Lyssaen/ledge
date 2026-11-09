import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrDetailSchema, PullRequestSchema } from '@ledge/protocol';
import { diffLine, gitlabReader, glStatus } from '../src/daemon/forge/gitlab.js';
import { forgeOf, type ForgeRun } from '../src/daemon/forge/run.js';
import { ForgeRefusal } from '../src/daemon/forge/types.js';

const FX = join(import.meta.dirname, 'fixtures', 'forge');
const fx = (f: string): string => readFileSync(join(FX, f), 'utf8');
const repo = forgeOf('https://gitlab.com/gitlab-org/cli.git')!;
const P = 'projects/gitlab-org%2Fcli';

type Call = { file: string; args: string[]; input?: string };
/** A `glab api` answering from the Task 0 fixtures (gitlab.com, gitlab-org/cli, read only), recording every call. */
function fakeGlab(over: (path: string, c: Call) => string | { code?: number; stdout?: string; stderr?: string } | undefined = () => undefined) {
  const calls: Call[] = [];
  const list = JSON.parse(fx('gl-mr-list.json')) as Array<{ iid: number; state: string; source_branch: string; updated_at: string; project_id: number; source_project_id: number }>;
  /** The source project of each real merge request: gitlab-org/cli itself, or the community fork (45049979). */
  const sourceOf = (m: { project_id: number; source_project_id: number }) => (m.source_project_id === m.project_id ? 'gitlab-org/cli' : m.source_project_id === 45049979 ? 'gitlab-community/gitlab-org/cli' : `fork-${m.source_project_id}`);
  const run: ForgeRun = async (file, args, opts = {}) => {
    const c = { file, args, input: opts.input };
    calls.push(c);
    const path = args.find((a, i) => i > 0 && !a.startsWith('-') && args[i - 1] !== '--hostname' && args[i - 1] !== '--method' && args[i - 1] !== '-H' && args[i - 1] !== '--input') ?? '';
    const o = over(path, c);
    if (typeof o === 'string') return { code: 0, stdout: o, stderr: '' };
    if (o) return { code: o.code ?? 0, stdout: o.stdout ?? '', stderr: o.stderr ?? '' };
    const out = (s: string) => ({ code: 0, stdout: s, stderr: '' });
    const p = path.replace(/[?&]per_page=100&page=\d+$/, '');
    // The list: the merge requests of the branch names asked, as the GraphQL query answers (built from the real REST list).
    if (p === 'graphql') {
      const b = (JSON.parse(c.input!) as { variables: { b: string[] } }).variables.b;
      const nodes = list.filter(m => b.includes(m.source_branch)).map(m => ({ iid: String(m.iid), state: m.state, sourceBranch: m.source_branch, updatedAt: m.updated_at, sourceProject: { fullPath: sourceOf(m) } }));
      return out(JSON.stringify({ data: { project: { mergeRequests: { nodes } } } }));
    }
    if (p === 'projects/45049979') return out('{"path_with_namespace":"gitlab-community/gitlab-org/cli"}');
    const m = /^projects\/gitlab-org%2Fcli\/merge_requests\/(\d+)(\/.*)?$/.exec(p);
    if (m && !m[2]) return out(m[1] === '4340' ? fx('gl-mr-4340.json') : JSON.stringify(list.find(x => String(x.iid) === m[1])));
    if (m?.[2] === '/approvals') return out(fx('gl-mr-4340-approvals.json'));
    if (m?.[2] === '/discussions') return out(fx('gl-mr-4340-discussions.json'));
    if (m?.[2] === '/diffs') return out(fx('gl-mr-4340-diffs.json'));
    if (m?.[2] === '/commits') return out(fx('gl-mr-4340-commits.json'));
    if (m?.[2] === '/closes_issues') return out(fx('gl-mr-4340-closes.json'));
    if (m?.[2] === '/reviewers') return out(fx('gl-mr-4340-reviewers.json'));
    if (p.startsWith('projects/45049979/pipelines/3041001851/jobs')) return out(fx('gl-pipeline-jobs.json'));
    if (/^projects\/45049979\/jobs\/\d+\/trace$/.test(p)) return out(fx('gl-job-trace.txt'));
    if (p === P) return out(fx('gl-project.json'));
    return { code: 0, stdout: '{"message":"404 Not Found"}', stderr: `glab: 404 Not Found (HTTP 404) — unexpected ${path}` };
  };
  return { run, calls };
}

describe('GitLab statuses', () => {
  it('translates the pipeline and job statuses', () => {
    expect(['success', 'running', 'pending', 'manual', 'failed', 'canceled', 'skipped', undefined].map(glStatus)).toEqual(['ok', 'run', 'wait', 'wait', 'fail', 'skip', 'skip', 'none']);
  });
});

describe('GitLab list', () => {
  const mine = (branch: string) => ({ branch, head: sourceOfBranch(branch) });
  const sourceOfBranch = (branch: string) => {
    const m = (JSON.parse(fx('gl-mr-list.json')) as Array<{ source_branch: string; project_id: number; source_project_id: number }>).find(x => x.source_branch === branch)!;
    return m.source_project_id === m.project_id ? 'gitlab-org/cli' : m.source_project_id === 45049979 ? 'gitlab-community/gitlab-org/cli' : `fork-${m.source_project_id}`;
  };

  it('gives the fields from the real answers, one list query per repository', async () => {
    const { run, calls } = fakeGlab();
    const prs = await gitlabReader(run).list(repo, [mine('8709-add-include-descendants-to-milestone-list'), mine('duo/feature/8337-8338-device-flow-enhancements'), { branch: 'nobody', head: 'gitlab-org/cli' }]);
    const lists = calls.filter(c => c.args.includes('graphql'));
    expect(lists).toHaveLength(1);
    expect(lists[0]!.args).toEqual(['api', '--hostname', 'gitlab.com', '--method', 'POST', '-H', 'Content-Type: application/json', 'graphql', '--input', '-']);
    const by = new Map(prs.map(p => [p.number, p]));
    expect([...by.keys()].sort()).toEqual([3357, 4340]);
    expect(by.get(4340)).toMatchObject({ id: 'gitlab.com/gitlab-org/cli#4340', ref: '!4340', state: 'review', pipeline: 'ok', approvals: { given: 0, required: 2 }, openThreads: 3,
      mergeable: false, blockers: ['approvals', 'changes_requested'], url: 'https://gitlab.com/gitlab-org/cli/-/merge_requests/4340', head: 'gitlab-community/gitlab-org/cli' });
    expect(by.get(3357)).toMatchObject({ state: 'draft', pipeline: 'none' });
    for (const p of prs) expect(PullRequestSchema.safeParse({ ...p, sessions: [] }).success).toBe(true);
  });

  it('reads the real list answer: !4340 comes from the community fork, so a session pushing to gitlab-org/cli does not get it', async () => {
    const { run } = fakeGlab(p => (p === 'graphql' ? fx('gl-graphql-list.json') : undefined));
    const reader = gitlabReader(run);
    const b = '8709-add-include-descendants-to-milestone-list';
    expect(await reader.list(repo, [{ branch: b, head: 'gitlab-org/cli' }])).toEqual([]);
    expect((await reader.list(repo, [{ branch: b, head: 'gitlab-community/gitlab-org/cli' }])).map(p => p.number)).toEqual([4340]);
  });

  it('two forks, one branch name: each session gets its own fork\'s merge request', async () => {
    const nodes = [{ iid: '9', state: 'opened', sourceBranch: 'fix/x', updatedAt: '2026-11-08T12:00:00Z', sourceProject: { fullPath: 'someone/cli' } },
      { iid: '8', state: 'merged', sourceBranch: 'fix/x', updatedAt: '2026-11-01T10:00:00Z', sourceProject: { fullPath: 'gitlab-org/cli' } }];
    const { run, calls } = fakeGlab(p => (p === 'graphql' ? JSON.stringify({ data: { project: { mergeRequests: { nodes } } } }) : p === `${P}/merge_requests/8` ? fx('gl-mr-4340.json').replace('"iid": 4340', '"iid": 8').replace('"state": "opened"', '"state": "merged"') : undefined));
    const prs = await gitlabReader(run).list(repo, [{ branch: 'fix/x', head: 'gitlab-org/cli' }]);
    expect(prs.map(p => [p.number, p.state, p.head])).toEqual([[8, 'merged', 'gitlab-org/cli']]);
    expect(calls.some(c => c.args.some(a => a.includes('merge_requests/9')))).toBe(false);
  });

  it('asks for the followed branch names only, as variables on standard input', async () => {
    const { run, calls } = fakeGlab();
    await gitlabReader(run).list(repo, [{ branch: '--exec', head: 'gitlab-org/cli' }, { branch: '$(id)', head: 'gitlab-org/cli' }]);
    for (const c of calls) for (const a of c.args) expect(a).not.toMatch(/--exec|\$\(/);
    const q = JSON.parse(calls[0]!.input!) as { query: string; variables: { p: string; b: string[] } };
    expect(q.query).toContain('mergeRequests(sourceBranches: $b');
    expect(q.variables).toEqual({ p: 'gitlab-org/cli', b: ['--exec', '$(id)'], a: null });
  });

  it('names a subgroup by its full path', async () => {
    const { run, calls } = fakeGlab(() => '{"data":{"project":{"mergeRequests":{"nodes":[]}}}}');
    await gitlabReader(run).list(forgeOf('git@gitlab.example.com:a/b/c.git')!, [{ branch: 'x', head: 'a/b/c' }]);
    expect(calls[0]!.args).toContain('gitlab.example.com');
    expect(JSON.parse(calls[0]!.input!).variables.p).toBe('a/b/c');
  });

  it('follows the pages: a merge request past the first 100 is found; past 20 pages the list is said incomplete', async () => {
    const other = (i: number) => ({ iid: String(1000 + i), state: 'opened', sourceBranch: 'busy', updatedAt: '2026-11-08T12:00:00Z', sourceProject: { fullPath: 'gitlab-org/cli' } });
    const target = { iid: '8', state: 'merged', sourceBranch: 'old/x', updatedAt: '2020-01-01T00:00:00Z', sourceProject: { fullPath: 'gitlab-org/cli' } };
    const answer = (nodes: unknown[], next: string | null) => JSON.stringify({ data: { project: { mergeRequests: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } } } });
    const { run, calls } = fakeGlab((p, c) => {
      if (p !== 'graphql') return p === `${P}/merge_requests/8` ? fx('gl-mr-4340.json').replace('"iid": 4340', '"iid": 8').replace('"state": "opened"', '"state": "merged"') : undefined;
      const a = (JSON.parse(c.input!) as { variables: { a: string | null } }).variables.a;
      return a === null ? answer(Array.from({ length: 100 }, (_, i) => other(i)), 'page2') : answer([target], null);
    });
    const prs = await gitlabReader(run).list(repo, [{ branch: 'busy', head: 'someone/else' }, { branch: 'old/x', head: 'gitlab-org/cli' }]);
    expect(prs.map(p => p.number)).toEqual([8]);
    expect(calls.filter(c => c.args.includes('graphql')).map(c => JSON.parse(c.input!).variables.a)).toEqual([null, 'page2']);
    const endless = fakeGlab((p, c) => (p === 'graphql' ? answer([other(0)], `c${calls.length}${c.input!.length}`) : undefined));
    await expect(gitlabReader(endless.run).list(repo, [{ branch: 'old/x', head: 'gitlab-org/cli' }])).rejects.toMatchObject({ status: 'error', message: expect.stringContaining('incomplete list') });
    expect(endless.calls.filter(c => c.args.includes('graphql'))).toHaveLength(20);
  });

  it('refuses an answer with errors, even with data', async () => {
    const { run, calls } = fakeGlab(p => (p === 'graphql' ? JSON.stringify({ data: { project: { mergeRequests: { nodes: [{ iid: '4340', state: 'opened', sourceBranch: 'b', updatedAt: '2026-11-08T12:00:00Z', sourceProject: null }] } } }, errors: [{ message: 'sourceProject: timeout' }] }) : undefined));
    await expect(gitlabReader(run).list(repo, [{ branch: 'b', head: 'gitlab-org/cli' }])).rejects.toMatchObject({ status: 'error', message: 'sourceProject: timeout' });
    expect(calls).toHaveLength(1);
  });

  it('a project the forge does not know is an error, not an empty list', async () => {
    const { run } = fakeGlab(() => '{"data":{"project":null}}');
    await expect(gitlabReader(run).list(repo, [{ branch: 'x', head: 'gitlab-org/cli' }])).rejects.toMatchObject({ status: 'error' });
  });
});

describe('GitLab detail', () => {
  it('gives the threads with their diff line, reviewers, files, commits, jobs and the log', async () => {
    const { run } = fakeGlab();
    const d = await gitlabReader(run).detail(repo, 4340, { log: '17828897871' });
    const parsed = PrDetailSchema.safeParse({ ...d, pr: { ...d.pr, sessions: [] } });
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(d.threads).toHaveLength(6);
    const diff = d.threads.filter(t => t.file);
    expect(diff.map(t => [t.file, t.line, t.resolved])).toEqual([
      ['internal/commands/milestone/list/list.go', 188, false], ['internal/commands/milestone/list/list.go', 207, false], ['internal/commands/milestone/list/list_test.go', 331, false]]);
    for (const t of diff) expect(t.code).toMatch(/^[+ -]/);
    expect(d.threads.filter(t => t.resolvable && t.resolved)).toHaveLength(1);
    expect(d.reviewers).toEqual([{ name: 'jay_mccure', state: 'pending' }, { name: 'GitLabDuo', state: 'changes' }]);
    expect(d.issues).toEqual(['#8709']);
    expect(d.labels).toContain('type::feature');
    expect(d.files.map(f => f.path)).toEqual(['docs/source/milestone/list.md', 'internal/commands/milestone/list/list.go', 'internal/commands/milestone/list/list_test.go']);
    expect(d.files.every(f => f.added + f.removed > 0)).toBe(true);
    expect(d.commits[0]!.author).not.toMatch(/@/);
    // 17 jobs in 5 stages, columns in the order the jobs were created.
    expect(new Set(d.jobs.map(j => j.columnName))).toEqual(new Set(['application-security-testing', 'checks', 'documentation', 'test']));
    expect(d.jobs.find(j => j.name === 'tests:coverage')).toMatchObject({ status: 'fail', column: 3, durationS: 54 });
    expect(d.log?.text).toMatch(/ERROR: Job failed: exit code 2$/);
    expect(d.log?.text).not.toMatch(/^section_(?:start|end):|\u001b|^\d\d[OE]\b|^\d{4}-\d\d-/m);
    expect(d.mergeBlockers).toEqual(['approvals', 'changes_requested']);
  });

  it('draws the mockup gl-41: build ok, test fail, deploy:staging skip, three columns', async () => {
    const jobs = [{ id: 8813, name: 'deploy:staging', stage: 'deploy', status: 'skipped' }, { id: 8812, name: 'test', stage: 'test', status: 'failed', duration: 91 }, { id: 8810, name: 'build', stage: 'build', status: 'success', duration: 122 }];
    const { run } = fakeGlab(p => (p.includes('/pipelines/3041001851/jobs') ? JSON.stringify(jobs) : undefined));
    const d = await gitlabReader(run).detail(repo, 4340, {});
    expect(d.jobs.map(j => [j.name, j.column, j.status])).toEqual([['build', 0, 'ok'], ['test', 1, 'fail'], ['deploy:staging', 2, 'skip']]);
  });
});

describe('the merge command shown', () => {
  it('leaves out a head that is not a commit id (it comes from the forge)', async () => {
    const evil = { ...JSON.parse(fx('gl-mr-4340.json')), sha: 'abc"}\nrm -rf ~ #' };
    const { run } = fakeGlab(p => (p === `${P}/merge_requests/4340` ? JSON.stringify(evil) : undefined));
    const d = await gitlabReader(run).detail(repo, 4340, {});
    expect(d.mergeCommand).not.toMatch(/rm -rf|\n/);
    expect(d.mergeCommand).toBe(`glab api --hostname gitlab.com --method PUT ${P}/merge_requests/4340/merge -H 'Content-Type: application/json' --input -`);
  });
});

describe('diffLine', () => {
  it('finds a new line and an old line', () => {
    const diff = '@@ -10,3 +10,4 @@\n a\n-b\n+c\n+d\n e\n';
    expect(diffLine(diff, 11)).toBe('+c');
    expect(diffLine(diff, 13)).toBe(' e');
    expect(diffLine(diff, null, 11)).toBe('-b');
  });
});

describe('GitLab actions', () => {
  const pr = { id: 'gitlab.com/gitlab-org/cli#4340', forge: 'gitlab' as const, host: 'gitlab.com', repo: 'gitlab-org/cli', number: 4340, ref: '!4340', url: 'https://gitlab.com/x', title: 't',
    state: 'open' as const, branch: 'b', target: 'main', headSha: '68f7d609d53c29b92e9a7905d63ab5efc96080d4', pipeline: 'ok' as const, approvals: { given: 2, required: 2 }, mergeable: true, openThreads: 0, updatedAt: '2026-11-08T10:00:00.000Z' };
  const writes = (calls: Call[]) => calls.filter(c => c.args.includes('--method'));

  it('sends bodies as JSON on standard input, with an explicit method', async () => {
    const body = 'see $(rm -rf ~)\n--admin';
    const { run, calls } = fakeGlab((_p, c) => (c.args.includes('--method') ? '{}' : undefined));
    const r = gitlabReader(run);
    await r.act(repo, pr, { kind: 'comment', body });
    await r.act(repo, pr, { kind: 'reply', threadId: '6ac7ce837a42aaaa', body });
    await r.act(repo, pr, { kind: 'resolve', threadId: '6ac7ce837a42aaaa' });
    const w = writes(calls);
    expect(w.map(c => c.args.slice(3, 6))).toEqual([['--method', 'POST', `${P}/merge_requests/4340/notes`], ['--method', 'POST', `${P}/merge_requests/4340/discussions/6ac7ce837a42aaaa/notes`],
      ['--method', 'PUT', `${P}/merge_requests/4340/discussions/6ac7ce837a42aaaa?resolved=true`]]);
    expect(JSON.parse(w[0]!.input!)).toEqual({ body });
    expect(JSON.parse(w[1]!.input!)).toEqual({ body });
    expect(w[2]!.input).toBeUndefined();
    for (const c of calls) for (const a of c.args) expect(a).not.toContain('rm -rf');
  });

  it('merges with the head sha, the project method and the branch kept', async () => {
    const { run, calls } = fakeGlab((_p, c) => (c.args.includes('--method') ? '{}' : undefined));
    await gitlabReader(run).act(repo, pr, { kind: 'merge', headSha: pr.headSha });
    const w = writes(calls);
    expect(w[0]!.args).toEqual(['api', '--hostname', 'gitlab.com', '--method', 'PUT', `${P}/merge_requests/4340/merge`, '-H', 'Content-Type: application/json', '--input', '-']);
    expect(JSON.parse(w[0]!.input!)).toEqual({ sha: pr.headSha, should_remove_source_branch: false });
  });

  it('retries a failed pipeline in its own project, refuses a green one', async () => {
    const failed = { ...JSON.parse(fx('gl-mr-4340.json')), head_pipeline: { id: 3039572350, project_id: 34675721, status: 'failed' } };
    const { run, calls } = fakeGlab((p, c) => (c.args.includes('--method') ? '{}' : p === `${P}/merge_requests/4340` ? JSON.stringify(failed) : undefined));
    await gitlabReader(run).act(repo, pr, { kind: 'rerun' });
    expect(writes(calls)[0]!.args.slice(3, 6)).toEqual(['--method', 'POST', 'projects/34675721/pipelines/3039572350/retry']);
    const green = fakeGlab();
    await expect(gitlabReader(green.run).act(repo, pr, { kind: 'rerun' })).rejects.toMatchObject({ code: 'not_offered' });
    expect(writes(green.calls)).toHaveLength(0);
  });

  it('refuses a discussion id that is not one, before running anything', async () => {
    const { run, calls } = fakeGlab();
    await expect(gitlabReader(run).act(repo, pr, { kind: 'resolve', threadId: '../../projects' })).rejects.toBeInstanceOf(ForgeRefusal);
    expect(calls).toHaveLength(0);
  });

  it('reads a 404 answered with code 0 as an error', async () => {
    const { run } = fakeGlab(() => ({ code: 0, stdout: '{"message":"404 Project Not Found"}', stderr: 'glab: 404 Project Not Found (HTTP 404)' }));
    await expect(gitlabReader(run).list(repo, [{ branch: 'x', head: 'gitlab-org/cli' }])).rejects.toMatchObject({ status: 'error', message: expect.stringContaining('404') });
  });
});

// Review of #230, finding 1: « without CI » only for a project with no CI file on its default branch.
describe('GitLab: whether the project has CI', () => {
  const NF = { code: 0, stdout: '{"message":"404 File Not Found"}', stderr: 'glab: 404 File Not Found (HTTP 404)' };
  it('true with a .gitlab-ci.yml on the default branch, false without', async () => {
    const yes = fakeGlab(p => (p === P ? '{"default_branch":"main","ci_config_path":""}' : p === `${P}/repository/files/.gitlab-ci.yml?ref=main` ? '{"file_name":".gitlab-ci.yml"}' : undefined));
    expect(await gitlabReader(yes.run).hasCi(repo)).toBe(true);
    const no = fakeGlab(p => (p === P ? '{"default_branch":"main","ci_config_path":null}' : p.includes('/repository/files/') ? NF : undefined));
    expect(await gitlabReader(no.run).hasCi(repo)).toBe(false);
  });
  it('true with a CI config path of its own, without reading any file', async () => {
    const f = fakeGlab(p => (p === P ? '{"default_branch":"main","ci_config_path":"ci/pipeline.yml"}' : undefined));
    expect(await gitlabReader(f.run).hasCi(repo)).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
  it('an error other than 404 throws: the caller assumes CI', async () => {
    const f = fakeGlab(p => (p === P ? '{"default_branch":"main"}' : p.includes('/repository/files/') ? { code: 0, stdout: '', stderr: 'glab: 500 Internal Server Error (HTTP 500)' } : undefined));
    await expect(gitlabReader(f.run).hasCi(repo)).rejects.toThrow();
  });
});
