import { prIdOf, type ForgeAction, type PipeStatus, type PrFile, type PrJob, type PrReviewer, type PrState, type PrThread } from '@ledge/protocol';
import { logTail, type ForgeRepo, type ForgeRun } from './run.js';
import { blockersOf, mergeBlockersOf, pickFor, ForgeError, ForgeRefusal, iso, JOB_ID, lastLine, ok, okJson, PATCH_BUDGET, seconds, SHA, shellJoin, THREAD_ID, type ForgeReader, type PrCore, type ReadDetail, type ReadPr } from './types.js';

/**
 * GitHub pull requests through `gh` (R3): `pr list/view --json`, `run list/view`, and `gh api graphql` for the review threads
 * (their « resolved » state) and the tickets a request closes (`pr view` of gh 2.45 has no `closingIssuesReferences`). A job's
 * log comes from `gh api …/actions/jobs/:id/logs`: `run view --log-failed` of gh 2.45 prints nothing (Task 0).
 */

const VIEW_FIELDS = 'number,title,url,state,isDraft,headRefName,headRefOid,baseRefName,updatedAt,reviewDecision,reviewRequests,latestReviews,statusCheckRollup,headRepository,headRepositoryOwner,body,author,labels,commits,comments,reviews';

/**
 * The list (R1, review of d266f114): the requests of the followed branch names only, by `pullRequests(headRefName:)`, one
 * aliased field per branch in one query per repository. The branch names travel as GraphQL variables on standard input; only
 * their index is written in the query. Each request carries its head repository, so two forks with the same branch are told apart.
 */
/**
 * The checks of a head (R5, review of 190032f7): `state` is GitHub's own summary over every check, whatever their number; the
 * first contexts only tell running from waiting.
 */
const ROLLUP = 'statusCheckRollup { state contexts(first: 100) { pageInfo { hasNextPage } nodes { __typename ... on CheckRun { status conclusion } ... on StatusContext { state } } } }';
interface GqlRollup { state?: string | null; contexts?: { pageInfo?: { hasNextPage: boolean }; nodes: GhCheck[] } | null }
const LIST_NODE = `number title url state isDraft headRefName headRefOid baseRefName updatedAt reviewDecision headRepository { nameWithOwner }
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Team { name slug } } } }
  latestReviews(first: 20) { nodes { author { login } state } }
  reviewThreads(first: 100) { nodes { isResolved } }
  commits(last: 1) { nodes { commit { ${ROLLUP} } } }`;
/** Requests per branch name and per page; the pages are followed to the end (R1, review of 190032f7). */
const PER_BRANCH = 50;
/** Past this many pages for one round of branch names, the list is reported incomplete rather than cut silently. */
const MAX_PAGES = 20;
interface GqlPr {
  number: number; title: string; url: string; state: string; isDraft: boolean; headRefName: string; headRefOid: string; baseRefName: string; updatedAt: string;
  reviewDecision?: string | null; headRepository?: { nameWithOwner: string } | null;
  reviewRequests?: { nodes: Array<{ requestedReviewer?: GhReviewer | null }> }; latestReviews?: { nodes: Array<{ author?: { login?: string } | null; state?: string }> };
  reviewThreads?: { nodes: Array<{ isResolved: boolean }> };
  commits?: { nodes: Array<{ commit?: { statusCheckRollup?: GqlRollup | null } }> };
}

interface GhCheck { __typename?: string; status?: string; conclusion?: string; state?: string }
interface GhReviewer { __typename?: string; login?: string; name?: string; slug?: string }
interface GhPr {
  number: number; title: string; url: string; state: string; isDraft: boolean; headRefName: string; headRefOid: string; baseRefName: string;
  updatedAt: string; reviewDecision?: string; reviewRequests?: GhReviewer[]; latestReviews?: Array<{ author?: { login?: string }; state?: string }>;
  statusCheckRollup?: GhCheck[];
}
interface GhPrView extends GhPr {
  headRepository?: { name?: string } | null; headRepositoryOwner?: { login?: string } | null;
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
/**
 * A head's pipeline from GitHub's summary: FAILURE or ERROR is `fail`, SUCCESS is `ok`, PENDING or EXPECTED is `run` when a
 * check seen runs, else `wait`. No rollup at all: `none`. Without a summary, contexts that were not all read are never green.
 */
export function pipelineOf(r: GqlRollup | null | undefined): PipeStatus {
  if (!r) return 'none';
  const seen = rollup(r.contexts?.nodes);
  switch ((r.state ?? '').toUpperCase()) {
    case 'FAILURE': case 'ERROR': return 'fail';
    case 'SUCCESS': return 'ok';
    case 'PENDING': case 'EXPECTED': return seen === 'fail' ? 'fail' : seen === 'run' ? 'run' : 'wait';
    default: return r.contexts?.pageInfo?.hasNextPage && (seen === 'ok' || seen === 'none') ? 'wait' : seen;
  }
}
/** A GraphQL answer with errors is refused whole, even with data: a field left null by an error must never read as « nothing ». */
function noErrors<T extends { errors?: Array<{ message?: string }> }>(j: T): T {
  if (j.errors?.length) throw new ForgeError('error', j.errors.map(e => e.message ?? '').join('; ').slice(0, 400) || 'GitHub answered with errors');
  return j;
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

  function core(repo: ForgeRepo, p: GhPr, openThreads: number, head: string, pipeline: PipeStatus): ReadPr {
    const state = stateOf(p), given = approvalsOf(p);
    const blockers = blockersOf({ state, approvals: { given }, changesRequested: p.reviewDecision === 'CHANGES_REQUESTED', approvalsMissing: p.reviewDecision === 'REVIEW_REQUIRED' });
    return {
      id: prIdOf(repo.host, repo.path, p.number), forge: 'github', host: repo.host, repo: repo.path, number: p.number, ref: `#${p.number}`,
      url: p.url, title: p.title, state, branch: p.headRefName, target: p.baseRefName, headSha: p.headRefOid,
      pipeline, approvals: { given }, mergeable: blockers.length === 0, openThreads, updatedAt: iso(p.updatedAt), blockers, head
    };
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

    async list(repo, targets) {
      const names = [...new Set(targets.map(t => t.branch))];
      if (!names.length) return [];
      const nodes: GqlPr[] = [];
      // Each branch name's pages, newest first, followed to the end: a request older than any first page is still found.
      let pending = names.map((b, i) => ({ i, b, after: null as string | null }));
      for (let page = 0; pending.length; page++) {
        if (page >= MAX_PAGES) throw new ForgeError('error', `incomplete list: more than ${MAX_PAGES * PER_BRANCH} pull requests for a followed branch name in ${repo.path}`);
        const fields = pending.map(p => `b${p.i}: pullRequests(headRefName: $b${p.i}, first: ${PER_BRANCH}, after: $a${p.i}, orderBy: { field: UPDATED_AT, direction: DESC }) { pageInfo { hasNextPage endCursor } nodes { ${LIST_NODE} } }`).join(' ');
        const query = `query($o: String!, $r: String!, ${pending.map(p => `$b${p.i}: String!, $a${p.i}: String`).join(', ')}) { repository(owner: $o, name: $r) { ${fields} } }`;
        const variables: Record<string, string | null> = { o: ownerOf(repo), r: nameOf(repo) };
        for (const p of pending) { variables[`b${p.i}`] = p.b; variables[`a${p.i}`] = p.after; }
        const j = noErrors(okJson<{ data?: { repository?: Record<string, { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlPr[] } | null> | null }; errors?: Array<{ message?: string }> }>(
          await api(repo, ['graphql', '--input', '-'], JSON.stringify({ query, variables })), 'gh'));
        const r = j.data?.repository;
        if (!r) throw new ForgeError('error', `${repo.path} not found`);
        const next: typeof pending = [];
        for (const p of pending) {
          const conn = r[`b${p.i}`];
          if (!conn) throw new ForgeError('error', `incomplete answer for ${repo.path}`);
          nodes.push(...conn.nodes);
          if (conn.pageInfo?.hasNextPage && conn.pageInfo.endCursor) next.push({ ...p, after: conn.pageInfo.endCursor });
        }
        pending = next;
      }
      const all = nodes.map(n => ({ n, branch: n.headRefName, head: n.headRepository?.nameWithOwner ?? '', open: n.state === 'OPEN', updatedAt: n.updatedAt }));
      const out: ReadPr[] = [];
      for (const t of targets) {
        const hit = pickFor(t, all);
        if (!hit) continue;
        const n = hit.n;
        const pr: GhPr = { ...n, reviewDecision: n.reviewDecision ?? undefined,
          reviewRequests: (n.reviewRequests?.nodes ?? []).flatMap(r => (r.requestedReviewer ? [r.requestedReviewer] : [])),
          latestReviews: (n.latestReviews?.nodes ?? []).map(r => ({ author: r.author ?? undefined, state: r.state })) };
        const open = hit.open ? (n.reviewThreads?.nodes ?? []).filter(x => !x.isResolved).length : 0;
        if (!out.some(o => o.number === n.number)) out.push(core(repo, pr, open, hit.head, pipelineOf(n.commits?.nodes[0]?.commit?.statusCheckRollup)));
      }
      return out;
    },

    async detail(repo, n, opts) {
      const v = okJson<GhPrView>(await run('gh', ['pr', 'view', String(n), '-R', repo.repo, '--json', VIEW_FIELDS]), 'gh');
      const q = `query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { pullRequest(number: $n) { commits(last: 1) { nodes { commit { ${ROLLUP} } } } closingIssuesReferences(first: 20) { nodes { number } } reviewThreads(first: 100) { nodes { id isResolved path line originalLine comments(first: 50) { nodes { id author { login } body createdAt diffHunk } } } } } } }`;
      const g = noErrors(okJson<{ data?: { repository?: { pullRequest?: { commits?: { nodes: Array<{ commit?: { statusCheckRollup?: GqlRollup | null } }> }; closingIssuesReferences?: { nodes: Array<{ number: number }> }; reviewThreads?: { nodes: GhThread[] } } | null } | null }; errors?: Array<{ message?: string }> }>(
        await api(repo, ['graphql', '-f', `query=${q}`, '-f', `o=${ownerOf(repo)}`, '-f', `r=${nameOf(repo)}`, '-F', `n=${Math.trunc(n)}`]), 'gh'));
      const gp = g.data?.repository?.pullRequest;
      if (!gp) throw new ForgeError('error', `pull request ${n} not found in ${repo.path}`);
      const reviewThreads: PrThread[] = (gp?.reviewThreads?.nodes ?? []).filter(t => t.comments.nodes.length).map(t => ({
        id: t.id, resolvable: true, resolved: t.isResolved, file: t.path, line: t.line ?? t.originalLine ?? undefined, code: lastLine(t.comments.nodes[0]!.diffHunk),
        comments: t.comments.nodes.map(c => ({ id: c.id, author: c.author?.login ?? 'ghost', at: iso(c.createdAt), body: c.body }))
      }));
      const talk: PrThread[] = [
        ...(v.comments ?? []).map(c => ({ id: c.id, resolvable: false, resolved: false, comments: [{ id: c.id, author: c.author?.login ?? 'ghost', at: iso(c.createdAt), body: c.body }] })),
        ...(v.reviews ?? []).filter(r => r.body.trim()).map(r => ({ id: r.id, resolvable: false, resolved: false, comments: [{ id: r.id, author: r.author?.login ?? 'ghost', at: iso(r.submittedAt), body: r.body }] }))
      ].sort((a, b) => a.comments[0]!.at.localeCompare(b.comments[0]!.at));
      const head = v.headRepositoryOwner?.login && v.headRepository?.name ? `${v.headRepositoryOwner.login}/${v.headRepository.name}` : '';
      // The pipeline as the list reads it (GitHub's summary over every check), never from the first contexts of `pr view`.
      const pr = core(repo, v, reviewThreads.filter(t => !t.resolved).length, head, pipelineOf(gp.commits?.nodes[0]?.commit?.statusCheckRollup));
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
        mergeBlockers: mergeBlockersOf(pr)
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
      // A review thread id is a global node id: the mutation would act on any thread the machine's account can reach.
      // Only one of this pull request's threads, in this repository, is acted on (the GitLab path binds it already).
      const ownThread = async (threadId: string): Promise<void> => {
        if (!THREAD_ID.test(threadId)) throw new ForgeRefusal('invalid', 'not a thread id');
        const args = repo.host === 'github.com' ? ['api', 'graphql', '--input', '-'] : ['api', '--hostname', repo.host, 'graphql', '--input', '-'];
        const query = 'query($t: ID!) { node(id: $t) { ... on PullRequestReviewThread { pullRequest { number repository { nameWithOwner } } } } }';
        const j = okJson<{ data?: { node?: { pullRequest?: { number?: number; repository?: { nameWithOwner?: string } } } | null } }>(
          await run('gh', args, { input: JSON.stringify({ query, variables: { t: threadId } }) }), 'gh');
        const of = j.data?.node?.pullRequest;
        if (!of || of.number !== pr.number || of.repository?.nameWithOwner?.toLowerCase() !== repo.path.toLowerCase()) {
          throw new ForgeRefusal('invalid', 'not a thread of this pull request');
        }
      };
      switch (action.kind) {
        case 'comment': return runGh(['pr', 'comment', n, '-R', repo.repo, '--body-file', '-'], action.body);
        case 'reply':
          await ownThread(action.threadId);
          return graphql('mutation($t: ID!, $b: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $t, body: $b }) { comment { id } } }', { t: action.threadId, b: action.body }, 'addPullRequestReviewThreadReply');
        case 'resolve':
          await ownThread(action.threadId);
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
