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
  const list = JSON.parse(fx('gl-mr-list.json')) as Array<{ iid: number }>;
  const run: ForgeRun = async (file, args, opts = {}) => {
    const c = { file, args, input: opts.input };
    calls.push(c);
    const path = args.find((a, i) => i > 0 && !a.startsWith('-') && args[i - 1] !== '--hostname' && args[i - 1] !== '--method' && args[i - 1] !== '-H' && args[i - 1] !== '--input') ?? '';
    const o = over(path, c);
    if (typeof o === 'string') return { code: 0, stdout: o, stderr: '' };
    if (o) return { code: o.code ?? 0, stdout: o.stdout ?? '', stderr: o.stderr ?? '' };
    const out = (s: string) => ({ code: 0, stdout: s, stderr: '' });
    const p = path.replace(/[?&]per_page=100&page=\d+$/, '');
    if (p.startsWith(`${P}/merge_requests?state=all`)) return out(fx('gl-mr-list.json'));
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
  it('gives the fields from the real answers, one list call per repository', async () => {
    const { run, calls } = fakeGlab();
    const prs = await gitlabReader(run).list(repo, ['8709-add-include-descendants-to-milestone-list', 'duo/feature/8337-8338-device-flow-enhancements', 'nobody']);
    expect(calls.filter(c => c.args.some(a => a.includes('merge_requests?state=all')))).toHaveLength(1);
    const by = new Map(prs.map(p => [p.number, p]));
    expect([...by.keys()].sort()).toEqual([3357, 4340]);
    expect(by.get(4340)).toMatchObject({ id: 'gitlab.com/gitlab-org/cli#4340', ref: '!4340', state: 'review', pipeline: 'ok', approvals: { given: 0, required: 2 }, openThreads: 3,
      mergeable: false, blockers: ['approvals', 'changes_requested'], url: 'https://gitlab.com/gitlab-org/cli/-/merge_requests/4340' });
    expect(by.get(3357)).toMatchObject({ state: 'draft', pipeline: 'none' });
    for (const p of prs) expect(PullRequestSchema.safeParse({ ...p, sessions: [] }).success).toBe(true);
  });

  it('never puts a branch in the arguments', async () => {
    const { run, calls } = fakeGlab();
    await gitlabReader(run).list(repo, ['--exec', '$(id)']);
    for (const c of calls) for (const a of c.args) expect(a).not.toMatch(/--exec|\$\(/);
  });

  it('encodes a subgroup path', async () => {
    const { run, calls } = fakeGlab(() => '[]');
    await gitlabReader(run).list(forgeOf('git@gitlab.example.com:a/b/c.git')!, ['x']);
    expect(calls[0]!.args).toEqual(['api', '--hostname', 'gitlab.example.com', 'projects/a%2Fb%2Fc/merge_requests?state=all&per_page=100&order_by=updated_at']);
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
    await expect(gitlabReader(run).list(repo, ['x'])).rejects.toMatchObject({ status: 'error', message: expect.stringContaining('404') });
  });
});
