import { prIdOf, type PipeStatus, type PrFile, type PrJob, type PrReviewer, type PrState, type PrThread } from '@ledge/protocol';
import { logTail, type ForgeRepo, type ForgeRun } from './run.js';
import { blockersOf, ForgeRefusal, iso, JOB_ID, ok, okJson, PATCH_BUDGET, SHA, shellJoin, THREAD_ID, type ForgeReader, type ReadDetail, type ReadPr } from './types.js';

/**
 * GitLab merge requests through `glab api` (REST v4, R3): `glab mr list` of glab 1.36 has no JSON output. `glab api` exits 0 on
 * an HTTP error, which `classify` reads in stderr (Task 0). A body goes as JSON on standard input (`--input -`), always with an
 * explicit `--method` (an input turns a GET into a POST).
 */

interface GlUser { username?: string }
interface GlMr {
  iid: number; title: string; web_url: string; state: string; draft?: boolean; work_in_progress?: boolean;
  source_branch: string; target_branch: string; sha: string; updated_at: string; reviewers?: GlUser[]; author?: GlUser;
  description?: string | null; labels?: string[]; detailed_merge_status?: string;
  head_pipeline?: { id: number; project_id?: number; status: string } | null;
}
interface GlApprovals { approved?: boolean; approvals_required?: number; approvals_left?: number; approved_by?: Array<{ user?: GlUser }> }
interface GlNote { id: number; type?: string | null; body: string; author?: GlUser; created_at: string; system?: boolean; resolvable?: boolean; resolved?: boolean;
  position?: { new_path?: string; old_path?: string; new_line?: number | null; old_line?: number | null } | null }
interface GlDiscussion { id: string; individual_note?: boolean; notes: GlNote[] }
interface GlDiff { new_path: string; old_path: string; diff: string }
interface GlJob { id: number; name: string; stage: string; status: string; duration?: number | null }

/** GitLab's statuses for the pipeline and its jobs (Task 4). */
export function glStatus(s: string | undefined | null): PipeStatus {
  switch (s) {
    case 'success': return 'ok';
    case 'running': return 'run';
    case 'pending': case 'created': case 'waiting_for_resource': case 'preparing': case 'scheduled': case 'manual': case 'waiting_for_callback': return 'wait';
    case 'failed': return 'fail';
    case 'canceled': case 'canceling': case 'skipped': return 'skip';
    default: return 'none';
  }
}

/** The text of the diff line a comment is on: the new line (or the old one for a removed line), with its +/-/space prefix. */
export function diffLine(diff: string, newLine?: number | null, oldLine?: number | null): string | undefined {
  let o = 0, n = 0;
  for (const l of diff.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { o = Number(h[1]); n = Number(h[2]); continue; }
    if (l.startsWith('\\')) continue;
    const c = l[0];
    if (c === '+') { if (newLine && n === newLine) return l; n++; }
    else if (c === '-') { if (!newLine && oldLine && o === oldLine) return l; o++; }
    else { if ((newLine && n === newLine) || (!newLine && oldLine && o === oldLine)) return l; o++; n++; }
  }
  return undefined;
}

/** A diff's added and removed lines. */
function counts(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of diff.split('\n')) { if (l.startsWith('+') && !l.startsWith('+++')) added++; else if (l.startsWith('-') && !l.startsWith('---')) removed++; }
  return { added, removed };
}

const notesOf = (d: GlDiscussion): GlNote[] => d.notes.filter(n => !n.system);
/** A discussion still open: one of its notes can be resolved and is not. */
const isOpen = (d: GlDiscussion): boolean => notesOf(d).some(n => n.resolvable && !n.resolved);

export function gitlabReader(run: ForgeRun): ForgeReader {
  const project = (repo: ForgeRepo): string => `projects/${encodeURIComponent(repo.path)}`;
  const get = (repo: ForgeRepo, path: string) => run('glab', ['api', '--hostname', repo.host, path]);
  const getJson = async <T>(repo: ForgeRepo, path: string): Promise<T> => okJson<T>(await get(repo, path), 'glab');
  /** Every page of a list, 100 at a time, up to `max` pages. */
  async function pages<T>(repo: ForgeRepo, path: string, max = 10): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= max; page++) {
      const batch = await getJson<T[]>(repo, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }
  const defaults = new Map<string, Promise<string | null>>();

  async function read(repo: ForgeRepo, m: GlMr, open: boolean): Promise<{ pr: ReadPr; mr: GlMr; approvals: GlApprovals; discussions: GlDiscussion[] }> {
    const base = `${project(repo)}/merge_requests/${Math.trunc(m.iid)}`;
    const [mr, approvals, discussions] = await Promise.all([
      getJson<GlMr>(repo, base),
      open ? getJson<GlApprovals>(repo, `${base}/approvals`) : Promise.resolve({} as GlApprovals),
      open ? pages<GlDiscussion>(repo, `${base}/discussions`) : Promise.resolve([] as GlDiscussion[])
    ]);
    const given = approvals.approved_by?.length ?? 0, required = approvals.approvals_required;
    const changesRequested = mr.detailed_merge_status === 'requested_changes';
    const draft = mr.draft ?? mr.work_in_progress ?? false;
    const state: PrState = mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? (draft ? 'draft' : (mr.reviewers?.length ?? 0) > 0 && approvals.approved !== true ? 'review' : 'open') : 'closed';
    const blockers = blockersOf({ state, approvals: { given, required }, changesRequested, approvalsMissing: approvals.approved === false || (approvals.approvals_left ?? 0) > 0 });
    const pr: ReadPr = {
      id: prIdOf(repo.host, repo.path, mr.iid), forge: 'gitlab', host: repo.host, repo: repo.path, number: mr.iid, ref: `!${mr.iid}`,
      url: mr.web_url, title: mr.title, state, branch: mr.source_branch, target: mr.target_branch, headSha: mr.sha,
      pipeline: glStatus(mr.head_pipeline?.status), approvals: { given, ...(required !== undefined ? { required } : {}) },
      mergeable: blockers.length === 0, openThreads: discussions.filter(isOpen).length, updatedAt: iso(mr.updated_at), blockers
    };
    return { pr, mr, approvals, discussions };
  }

  /** A JSON body on standard input, with an explicit method. */
  async function send(repo: ForgeRepo, method: 'POST' | 'PUT', path: string, body?: Record<string, unknown>): Promise<{ command: string }> {
    const args = ['api', '--hostname', repo.host, '--method', method, path, ...(body ? ['-H', 'Content-Type: application/json', '--input', '-'] : [])];
    ok(await run('glab', args, body ? { input: JSON.stringify(body) } : {}), 'glab');
    return { command: shellJoin('glab', args) };
  }
  const mergePath = (repo: ForgeRepo, iid: number): string => `${project(repo)}/merge_requests/${Math.trunc(iid)}/merge`;

  return {
    defaultBranch(repo) {
      let p = defaults.get(repo.repo);
      if (!p) {
        p = getJson<{ default_branch?: string }>(repo, project(repo)).then(j => j.default_branch ?? null);
        p.catch(() => defaults.delete(repo.repo));
        defaults.set(repo.repo, p);
      }
      return p;
    },

    async list(repo, branches) {
      const wanted = new Set(branches);
      if (!wanted.size) return [];
      const all = await getJson<GlMr[]>(repo, `${project(repo)}/merge_requests?state=all&per_page=100&order_by=updated_at`);
      const pick = new Map<string, GlMr>();
      for (const m of all) {
        if (!wanted.has(m.source_branch)) continue;
        const had = pick.get(m.source_branch);
        const open = m.state === 'opened', hadOpen = had?.state === 'opened';
        if (!had || (open && !hadOpen) || (open === hadOpen && Date.parse(m.updated_at) > Date.parse(had.updated_at))) pick.set(m.source_branch, m);
      }
      return Promise.all([...pick.values()].map(async m => (await read(repo, m, m.state === 'opened')).pr));
    },

    async detail(repo, iid, opts) {
      const base = `${project(repo)}/merge_requests/${Math.trunc(iid)}`;
      const { pr, mr, approvals, discussions } = await read(repo, { iid } as GlMr, true);
      const pipeProject = mr.head_pipeline ? `projects/${Math.trunc(mr.head_pipeline.project_id ?? 0) || encodeURIComponent(repo.path)}` : null;
      const [diffs, commits, closes, reviewers, rawJobs] = await Promise.all([
        pages<GlDiff>(repo, `${base}/diffs`, 30),
        pages<{ id: string; title: string; author_name?: string; committed_date?: string; created_at?: string }>(repo, `${base}/commits`),
        getJson<Array<{ iid: number }>>(repo, `${base}/closes_issues`),
        getJson<Array<{ user?: GlUser; state?: string }>>(repo, `${base}/reviewers`).catch(() => [] as Array<{ user?: GlUser; state?: string }>),
        mr.head_pipeline && pipeProject ? pages<GlJob>(repo, `${pipeProject}/pipelines/${Math.trunc(mr.head_pipeline.id)}/jobs?include_retried=false`) : Promise.resolve([] as GlJob[])
      ]);
      // The API gives jobs newest first: the stages' order is that of the jobs' creation (Task 0).
      const sorted = [...rawJobs].sort((a, b) => a.id - b.id);
      const stages: string[] = [];
      for (const j of sorted) if (!stages.includes(j.stage)) stages.push(j.stage);
      const jobs: PrJob[] = sorted.map(j => ({ id: String(j.id), name: j.name, column: stages.indexOf(j.stage), columnName: j.stage, status: glStatus(j.status), ...(typeof j.duration === 'number' ? { durationS: Math.round(j.duration) } : {}) }));
      let log: ReadDetail['log'];
      if (opts.log !== undefined) {
        if (!JOB_ID.test(opts.log) || !pipeProject) throw new ForgeRefusal('invalid', 'not a job of this pipeline');
        log = { jobId: opts.log, text: logTail(ok(await get(repo, `${pipeProject}/jobs/${opts.log}/trace`), 'glab')) };
      }
      const byPath = new Map(diffs.map(d => [d.new_path, d.diff] as const));
      const threads: PrThread[] = discussions.flatMap(d => {
        const notes = notesOf(d);
        if (!notes.length) return [];
        const pos = notes[0]!.position;
        const file = pos?.new_path ?? pos?.old_path;
        const line = pos?.new_line ?? pos?.old_line ?? undefined;
        const code = file && pos ? diffLine(byPath.get(file) ?? '', pos.new_line, pos.old_line) : undefined;
        const resolvable = notes.some(n => n.resolvable);
        return [{ id: d.id, resolvable, resolved: resolvable && !isOpen(d), ...(file ? { file } : {}), ...(line ? { line } : {}), ...(code ? { code } : {}),
          comments: notes.map(n => ({ id: String(n.id), author: n.author?.username ?? '?', at: iso(n.created_at), body: n.body })) }];
      });
      let budget = PATCH_BUDGET;
      const files: PrFile[] = diffs.map(d => {
        const fits = d.diff.length <= budget;
        if (fits) budget -= d.diff.length;
        return { path: d.new_path, ...counts(d.diff), ...(fits && d.diff ? { patch: d.diff } : {}) };
      });
      const approvedBy = new Set((approvals.approved_by ?? []).map(a => a.user?.username));
      const rv: PrReviewer[] = (reviewers.length ? reviewers.map(r => ({ name: r.user?.username ?? '?', st: r.state })) : (mr.reviewers ?? []).map(u => ({ name: u.username ?? '?', st: undefined })))
        .map(r => ({ name: r.name, state: approvedBy.has(r.name) || r.st === 'approved' ? 'approved' : r.st === 'requested_changes' ? 'changes' : 'pending' }));
      return {
        pr, description: mr.description ?? '', author: mr.author?.username ?? '?', reviewers: rv, labels: mr.labels ?? [],
        issues: closes.map(i => `#${i.iid}`), jobs, ...(log ? { log } : {}), threads, files,
        commits: commits.map(c => ({ sha: c.id, title: c.title, author: c.author_name ?? '?', at: iso(c.committed_date ?? c.created_at) })),
        mergeCommand: shellJoin('glab', ['api', '--hostname', repo.host, '--method', 'PUT', mergePath(repo, iid), '-H', 'Content-Type: application/json', '--input', '-']) + `  # {"sha":"${mr.sha}"}`,
        mergeBlockers: [...pr.blockers, ...(pr.pipeline === 'ok' ? [] : ['pipeline' as const])]
      };
    },

    async act(repo, pr, action) {
      const base = `${project(repo)}/merge_requests/${Math.trunc(pr.number)}`;
      switch (action.kind) {
        case 'comment': return send(repo, 'POST', `${base}/notes`, { body: action.body });
        case 'reply':
          if (!THREAD_ID.test(action.threadId)) throw new ForgeRefusal('invalid', 'not a discussion id');
          return send(repo, 'POST', `${base}/discussions/${action.threadId}/notes`, { body: action.body });
        case 'resolve':
          if (!THREAD_ID.test(action.threadId)) throw new ForgeRefusal('invalid', 'not a discussion id');
          return send(repo, 'PUT', `${base}/discussions/${action.threadId}?resolved=true`);
        case 'rerun': {
          const mr = await getJson<GlMr>(repo, base);
          const p = mr.head_pipeline;
          if (!p) throw new ForgeRefusal('not_offered', 'the request has no pipeline');
          if (glStatus(p.status) !== 'fail') throw new ForgeRefusal('not_offered', 'the pipeline has not failed');
          return send(repo, 'POST', `projects/${Math.trunc(p.project_id ?? 0) || encodeURIComponent(repo.path)}/pipelines/${Math.trunc(p.id)}/retry`);
        }
        case 'merge':
          if (!SHA.test(action.headSha)) throw new ForgeRefusal('invalid', 'not a commit');
          // The project's own method (merge commit, fast-forward, squash option): nothing chosen here; the branch is kept (R5).
          return send(repo, 'PUT', mergePath(repo, pr.number), { sha: action.headSha, should_remove_source_branch: false });
      }
    }
  };
}
