import { prIdOf, type ForgeAction, type PipeStatus, type PrFile, type PrJob, type PrReviewer, type PrState, type PrThread } from '@ledge/protocol';
import { logTail, type ForgeRepo, type ForgeRun } from './run.js';
import { blockersOf, ForgeError, ForgeRefusal, iso, JOB_ID, lastLine, ok, okJson, PATCH_BUDGET, seconds, SHA, shellJoin, THREAD_ID, type ForgeReader, type PrCore, type ReadDetail, type ReadPr } from './types.js';

/**
 * GitHub pull requests through `gh` (R3): `pr list/view --json`, `run list/view`, and `gh api graphql` for the review threads
 * (their « resolved » state) and the tickets a request closes (`pr view` of gh 2.45 has no `closingIssuesReferences`). A job's
 * log comes from `gh api …/actions/jobs/:id/logs`: `run view --log-failed` of gh 2.45 prints nothing (Task 0).
 */

const LIST_FIELDS = 'number,title,url,state,isDraft,headRefName,headRefOid,baseRefName,updatedAt,reviewDecision,reviewRequests,latestReviews,statusCheckRollup';
const VIEW_FIELDS = `${LIST_FIELDS},body,author,labels,commits,comments,reviews`;

interface GhCheck { __typename?: string; status?: string; conclusion?: string; state?: string }
interface GhReviewer { __typename?: string; login?: string; name?: string; slug?: string }
interface GhPr {
  number: number; title: string; url: string; state: string; isDraft: boolean; headRefName: string; headRefOid: string; baseRefName: string;
  updatedAt: string; reviewDecision?: string; reviewRequests?: GhReviewer[]; latestReviews?: Array<{ author?: { login?: string }; state?: string }>;
  statusCheckRollup?: GhCheck[];
}
interface GhPrView extends GhPr {
  body?: string; author?: { login?: string }; labels?: Array<{ name: string }>;
  commits?: Array<{ oid: string; messageHeadline: string; committedDate: string; authors?: Array<{ login?: string; name?: string }> }>;
  comments?: Array<{ id: string; author?: { login?: string }; body: string; createdAt: string }>;
  reviews?: Array<{ id: string; author?: { login?: string }; body: string; submittedAt?: string; state?: string }>;
}
interface GhThread { id: string; isResolved: boolean; path?: string; line?: number | null; originalLine?: number | null; comments: { nodes: Array<{ id: string; author?: { login?: string } | null; body: string; createdAt: string; diffHunk?: string }> } }
interface GhRun { databaseId: number; workflowName: string; status: string; conclusion: string; headSha?: string }
interface GhJob { databaseId: number; name: string; status: string; conclusion: string; startedAt?: string; completedAt?: string }
interface GhFile { filename: string; additions: number; deletions: number; patch?: string }
interface RepoInfo { defaultBranch: string | null; method: 'merge' | 'squash' | 'rebase' }

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
const WAITING = new Set(['QUEUED', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED']);
/** The rollup of a request's checks (Task 3): a failure, else one running, else one waiting, else green; none at all: `none`. */
export function rollup(checks: readonly GhCheck[] | undefined): PipeStatus {
  if (!checks?.length) return 'none';
  const st = checks.map(c => (c.__typename === 'StatusContext' || c.state ? { status: c.state === 'PENDING' || c.state === 'EXPECTED' ? 'PENDING' : 'COMPLETED', conclusion: c.state ?? '' } : { status: c.status ?? '', conclusion: c.conclusion ?? '' }));
  if (st.some(c => FAILED.has(c.conclusion.toUpperCase()))) return 'fail';
  if (st.some(c => c.status.toUpperCase() === 'IN_PROGRESS')) return 'run';
  if (st.some(c => WAITING.has(c.status.toUpperCase()))) return 'wait';
  return 'ok';
}
/** A job's or a run's status for the graph. */
export function jobStatus(status: string, conclusion: string): PipeStatus {
  const s = status.toLowerCase(), c = conclusion.toLowerCase();
  if (s === 'in_progress') return 'run';
  if (s !== 'completed') return 'wait';
  if (c === 'success') return 'ok';
  if (c === 'skipped' || c === 'neutral') return 'skip';
  return c ? 'fail' : 'none';
}

const reviewerName = (r: GhReviewer): string => r.login ?? r.name ?? r.slug ?? '?';
function stateOf(p: GhPr): PrState {
  if (p.state === 'MERGED') return 'merged';
  if (p.state === 'CLOSED') return 'closed';
  if (p.isDraft) return 'draft';
  return (p.reviewRequests?.length ?? 0) > 0 || p.reviewDecision === 'CHANGES_REQUESTED' ? 'review' : 'open';
}
function approvalsOf(p: GhPr): number {
  return new Set((p.latestReviews ?? []).filter(r => r.state === 'APPROVED').map(r => r.author?.login ?? '?')).size;
}

export function githubReader(run: ForgeRun): ForgeReader {
  const infos = new Map<string, Promise<RepoInfo>>();
  const api = (repo: ForgeRepo, args: string[], input?: string) => run('gh', repo.host === 'github.com' ? ['api', ...args] : ['api', '--hostname', repo.host, ...args], { input });
  const [ownerOf, nameOf] = [(r: ForgeRepo) => r.path.split('/')[0]!, (r: ForgeRepo) => r.path.split('/').slice(1).join('/')];

  function info(repo: ForgeRepo): Promise<RepoInfo> {
    let p = infos.get(repo.repo);
    if (!p) {
      p = run('gh', ['repo', 'view', repo.repo, '--json', 'defaultBranchRef,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed']).then(r => {
        const j = okJson<{ defaultBranchRef?: { name?: string }; mergeCommitAllowed?: boolean; squashMergeAllowed?: boolean }>(r, 'gh');
        return { defaultBranch: j.defaultBranchRef?.name ?? null, method: j.mergeCommitAllowed !== false ? 'merge' : j.squashMergeAllowed !== false ? 'squash' : 'rebase' } as RepoInfo;
      });
      p.catch(() => infos.delete(repo.repo));
      infos.set(repo.repo, p);
    }
    return p;
  }

  function core(repo: ForgeRepo, p: GhPr, openThreads: number): ReadPr {
    const state = stateOf(p), given = approvalsOf(p);
    const blockers = blockersOf({ state, approvals: { given }, changesRequested: p.reviewDecision === 'CHANGES_REQUESTED', approvalsMissing: p.reviewDecision === 'REVIEW_REQUIRED' });
    return {
      id: prIdOf(repo.host, repo.path, p.number), forge: 'github', host: repo.host, repo: repo.path, number: p.number, ref: `#${p.number}`,
      url: p.url, title: p.title, state, branch: p.headRefName, target: p.baseRefName, headSha: p.headRefOid,
      pipeline: rollup(p.statusCheckRollup), approvals: { given }, mergeable: blockers.length === 0, openThreads, updatedAt: iso(p.updatedAt), blockers
    };
  }

  /** The unresolved review threads of each open request, in one GraphQL call (numbers are integers: nothing else is interpolated). */
  async function openThreads(repo: ForgeRepo, numbers: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!numbers.length) return out;
    const fields = numbers.map(n => `p${n}: pullRequest(number: ${Math.trunc(n)}) { reviewThreads(first: 100) { nodes { isResolved } } }`).join(' ');
    const r = await api(repo, ['graphql', '-f', `query=query($o: String!, $r: String!) { repository(owner: $o, name: $r) { ${fields} } }`, '-f', `o=${ownerOf(repo)}`, '-f', `r=${nameOf(repo)}`]);
    const j = okJson<{ data?: { repository?: Record<string, { reviewThreads?: { nodes?: Array<{ isResolved: boolean }> } } | null> } }>(r, 'gh');
    for (const n of numbers) out.set(n, (j.data?.repository?.[`p${n}`]?.reviewThreads?.nodes ?? []).filter(t => !t.isResolved).length);
    return out;
  }

  async function jobs(repo: ForgeRepo, headSha: string): Promise<{ jobs: PrJob[]; runs: GhRun[] }> {
    if (!SHA.test(headSha)) return { jobs: [], runs: [] };
    const runs = okJson<GhRun[]>(await run('gh', ['run', 'list', '-R', repo.repo, '--commit', headSha, '--limit', '50', '--json', 'databaseId,workflowName,status,conclusion,headSha']), 'gh');
    // The latest run of each workflow (the list is newest first); one column per workflow (R7), by name.
    const firsts = new Map<string, GhRun>();
    for (const r of runs) if (!firsts.has(r.workflowName)) firsts.set(r.workflowName, r);
    const cols = [...firsts.values()].sort((a, b) => a.workflowName.localeCompare(b.workflowName));
    const out: PrJob[] = [];
    await Promise.all(cols.map(async (wf, column) => {
      const v = okJson<{ jobs?: GhJob[] }>(await run('gh', ['run', 'view', String(wf.databaseId), '-R', repo.repo, '--json', 'jobs']), 'gh');
      for (const j of v.jobs ?? []) out.push({ id: String(j.databaseId), name: j.name, column, columnName: wf.workflowName, status: jobStatus(j.status, j.conclusion), durationS: seconds(j.startedAt, j.completedAt) });
    }));
    out.sort((a, b) => a.column - b.column);
    return { jobs: out, runs: [...firsts.values()] };
  }

  async function files(repo: ForgeRepo, n: number): Promise<PrFile[]> {
    const out: PrFile[] = [];
    let budget = PATCH_BUDGET;
    for (let page = 1; page <= 30; page++) {
      const batch = okJson<GhFile[]>(await api(repo, [`repos/${repo.path}/pulls/${n}/files?per_page=100&page=${page}`]), 'gh');
      for (const f of batch) {
        const fits = f.patch !== undefined && f.patch.length <= budget;
        if (fits) budget -= f.patch!.length;
        out.push({ path: f.filename, added: f.additions, removed: f.deletions, ...(fits ? { patch: f.patch } : {}) });
      }
      if (batch.length < 100) break;
    }
    return out;
  }

  return {
    async defaultBranch(repo) { return (await info(repo)).defaultBranch; },

    async list(repo, branches) {
      const wanted = new Set(branches);
      if (!wanted.size) return [];
      const all = okJson<GhPr[]>(await run('gh', ['pr', 'list', '-R', repo.repo, '--state', 'all', '--limit', '100', '--json', LIST_FIELDS]), 'gh');
      const pick = new Map<string, GhPr>();
      for (const p of all) {
        if (!wanted.has(p.headRefName)) continue;
        const had = pick.get(p.headRefName);
        const open = p.state === 'OPEN', hadOpen = had?.state === 'OPEN';
        const better = !had || (open && !hadOpen) || (open === hadOpen && Date.parse(p.updatedAt) > Date.parse(had.updatedAt));
        if (better) pick.set(p.headRefName, p);
      }
      const chosen = [...pick.values()];
      const threads = await openThreads(repo, chosen.filter(p => p.state === 'OPEN').map(p => p.number));
      return chosen.map(p => core(repo, p, threads.get(p.number) ?? 0));
    },

    async detail(repo, n, opts) {
      const v = okJson<GhPrView>(await run('gh', ['pr', 'view', String(n), '-R', repo.repo, '--json', VIEW_FIELDS]), 'gh');
      const q = `query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { pullRequest(number: $n) { closingIssuesReferences(first: 20) { nodes { number } } reviewThreads(first: 100) { nodes { id isResolved path line originalLine comments(first: 50) { nodes { id author { login } body createdAt diffHunk } } } } } } }`;
      const g = okJson<{ data?: { repository?: { pullRequest?: { closingIssuesReferences?: { nodes: Array<{ number: number }> }; reviewThreads?: { nodes: GhThread[] } } } } }>(
        await api(repo, ['graphql', '-f', `query=${q}`, '-f', `o=${ownerOf(repo)}`, '-f', `r=${nameOf(repo)}`, '-F', `n=${Math.trunc(n)}`]), 'gh');
      const gp = g.data?.repository?.pullRequest;
      const reviewThreads: PrThread[] = (gp?.reviewThreads?.nodes ?? []).filter(t => t.comments.nodes.length).map(t => ({
        id: t.id, resolvable: true, resolved: t.isResolved, file: t.path, line: t.line ?? t.originalLine ?? undefined, code: lastLine(t.comments.nodes[0]!.diffHunk),
        comments: t.comments.nodes.map(c => ({ id: c.id, author: c.author?.login ?? 'ghost', at: iso(c.createdAt), body: c.body }))
      }));
      const talk: PrThread[] = [
        ...(v.comments ?? []).map(c => ({ id: c.id, resolvable: false, resolved: false, comments: [{ id: c.id, author: c.author?.login ?? 'ghost', at: iso(c.createdAt), body: c.body }] })),
        ...(v.reviews ?? []).filter(r => r.body.trim()).map(r => ({ id: r.id, resolvable: false, resolved: false, comments: [{ id: r.id, author: r.author?.login ?? 'ghost', at: iso(r.submittedAt), body: r.body }] }))
      ].sort((a, b) => a.comments[0]!.at.localeCompare(b.comments[0]!.at));
      const pr = core(repo, v, reviewThreads.filter(t => !t.resolved).length);
      const reviewers = new Map<string, PrReviewer['state']>();
      for (const r of v.latestReviews ?? []) if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') reviewers.set(r.author?.login ?? '?', r.state === 'APPROVED' ? 'approved' : 'changes');
      for (const r of v.reviewRequests ?? []) reviewers.set(reviewerName(r), 'pending');
      const [{ jobs: js }, fs, inf] = await Promise.all([jobs(repo, v.headRefOid), files(repo, n), info(repo)]);
      let log: ReadDetail['log'];
      if (opts.log !== undefined) {
        if (!JOB_ID.test(opts.log)) throw new ForgeRefusal('invalid', 'not a job id');
        log = { jobId: opts.log, text: logTail(ok(await api(repo, [`repos/${repo.path}/actions/jobs/${opts.log}/logs`]), 'gh')) };
      }
      return {
        pr, description: v.body ?? '', author: v.author?.login ?? 'ghost',
        reviewers: [...reviewers].map(([name, state]) => ({ name, state })),
        labels: (v.labels ?? []).map(l => l.name), issues: (gp?.closingIssuesReferences?.nodes ?? []).map(i => `#${i.number}`),
        jobs: js, ...(log ? { log } : {}), threads: [...reviewThreads, ...talk], files: fs,
        commits: (v.commits ?? []).map(c => ({ sha: c.oid, title: c.messageHeadline, author: c.authors?.[0]?.login || c.authors?.[0]?.name || '?', at: iso(c.committedDate) })),
        mergeCommand: shellJoin('gh', mergeArgs(repo, n, inf.method, SHA.test(v.headRefOid) ? v.headRefOid : '<head>')),
        mergeBlockers: [...pr.blockers, ...(pr.pipeline === 'ok' ? [] : ['pipeline' as const])]
      };
    },

    async act(repo, pr, action) {
      const n = String(Math.trunc(pr.number));
      const runGh = async (args: string[], input?: string, shown?: string[]): Promise<{ command: string }> => {
        ok(await run('gh', args, { input }), 'gh');
        return { command: shellJoin('gh', shown ?? args) };
      };
      const graphql = async (query: string, variables: Record<string, string>, label: string): Promise<{ command: string }> => {
        const args = repo.host === 'github.com' ? ['api', 'graphql', '--input', '-'] : ['api', '--hostname', repo.host, 'graphql', '--input', '-'];
        const r = await run('gh', args, { input: JSON.stringify({ query, variables }) });
        const j = okJson<{ errors?: Array<{ message?: string }> }>(r, 'gh');
        if (j.errors?.length) throw new ForgeError('error', j.errors.map(e => e.message ?? '').join('; ').slice(0, 400));
        return { command: `${shellJoin('gh', args)}  # ${label}` };
      };
      switch (action.kind) {
        case 'comment': return runGh(['pr', 'comment', n, '-R', repo.repo, '--body-file', '-'], action.body);
        case 'reply':
          if (!THREAD_ID.test(action.threadId)) throw new ForgeRefusal('invalid', 'not a thread id');
          return graphql('mutation($t: ID!, $b: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $t, body: $b }) { comment { id } } }', { t: action.threadId, b: action.body }, 'addPullRequestReviewThreadReply');
        case 'resolve':
          if (!THREAD_ID.test(action.threadId)) throw new ForgeRefusal('invalid', 'not a thread id');
          return graphql('mutation($t: ID!) { resolveReviewThread(input: { threadId: $t }) { thread { id } } }', { t: action.threadId }, 'resolveReviewThread');
        case 'rerun': {
          const { runs } = await jobs(repo, pr.headSha);
          const failed = runs.filter(r => r.status === 'completed' && jobStatus(r.status, r.conclusion) === 'fail');
          if (!failed.length) throw new ForgeRefusal('not_offered', 'no failed run on the head commit');
          const cmds: string[] = [];
          for (const r of failed) cmds.push((await runGh(['run', 'rerun', String(r.databaseId), '-R', repo.repo, '--failed'])).command);
          return { command: cmds.join(' && ') };
        }
        case 'merge': {
          if (!SHA.test(action.headSha)) throw new ForgeRefusal('invalid', 'not a commit');
          return runGh(mergeArgs(repo, pr.number, (await info(repo)).method, action.headSha));
        }
      }
    }
  };
}

/** The merge (R5): the repository's default method, the branch kept, and only if the head is still the one the person saw. */
function mergeArgs(repo: ForgeRepo, n: number, method: RepoInfo['method'], headSha: string): string[] {
  return ['pr', 'merge', String(Math.trunc(n)), '-R', repo.repo, `--${method}`, '--match-head-commit', headSha];
}

export type { ForgeAction, PrCore };
