// What the MR/PR tab derives from the PC's requests (docs/mockups/ledge-mobile-refonte/m5-mr-pr.html): the dot of a pipeline, « prête
// à fusionner », what blocks a merge, the stages of a pipeline, a job's duration, the tab's badge, « À toi » and a session's chip.
// Words are not made here: the screens take them from the catalogue.
import type { ForgeKind, PhoneForgeState, PhoneForgeStatus, PipeStatus, PrDetail, PrJob, PullRequest } from '@ledge/protocol';
import type { DotState } from '../ui/kit/marks';

/** The dot of a pipeline (M5 §1): red failed, blue running, green passed, amber waiting, grey skipped, hollow without CI. */
export const PIPE_DOT: Record<PipeStatus, DotState> = { ok: 'idle', run: 'work', fail: 'perm', wait: 'ask', skip: 'plain', none: 'off' };

/** Merged and closed requests are folded at the bottom of the list; the others are open (draft, open, in review). */
export const isOpen = (p: PullRequest): boolean => p.state !== 'merged' && p.state !== 'closed';

/** « Prête à fusionner »: open (not a draft), all a merge needs, and the pipeline passed or there is none (M5 §1). */
export const isReady = (p: PullRequest): boolean => (p.state === 'open' || p.state === 'review') && p.mergeable && (p.pipeline === 'ok' || p.pipeline === 'none');

/** The list in the PC's order (newest change first), split: the open ones, then the merged and closed ones. */
export function splitPrs(prs: readonly PullRequest[]): { open: PullRequest[]; closed: PullRequest[] } {
  return { open: prs.filter(isOpen), closed: prs.filter(p => !isOpen(p)) };
}

/** The tab's red badge: the open requests whose pipeline failed (M0, M5 §1). */
export const failedCount = (prs: readonly PullRequest[]): number => prs.filter(p => isOpen(p) && p.pipeline === 'fail').length;

/** « À toi » › MR et PR: the failed pipelines first, then the requests ready to merge, each in the PC's order (M1 Q14, M5 §9). */
export function atoiPrs(prs: readonly PullRequest[]): { pr: PullRequest; why: 'fail' | 'ready' }[] {
  const open = prs.filter(isOpen);
  return [...open.filter(p => p.pipeline === 'fail').map(pr => ({ pr, why: 'fail' as const })), ...open.filter(p => p.pipeline !== 'fail' && isReady(p)).map(pr => ({ pr, why: 'ready' as const }))];
}

/** A forge that cannot be read, for its strip above the list: missing CLI, not signed in, or failing reads (M5 §2). */
export const unreadable = (forges: readonly PhoneForgeStatus[]): PhoneForgeStatus[] => forges.filter(f => f.status !== 'ok');

/** The CLI a forge is read with on the PC. */
export const cliOf = (forge: ForgeKind): 'gh' | 'glab' => (forge === 'github' ? 'gh' : 'glab');

/** The command the phone writes for a CLI not signed in to a host (Q61): the PC never sends one. */
export const signInCommand = (f: Pick<PhoneForgeStatus, 'forge' | 'host'>): string => `${cliOf(f.forge)} auth login --hostname ${f.host}`;

/** A request's id in a route (`#/prs/<id>`): it holds `/` and `#`. */
export const prRouteId = (id: string): string => encodeURIComponent(id);

/** A stage of the graph: the jobs of one `column`, in the PC's order, with its name. */
export interface Stage { column: number; name: string; jobs: PrJob[] }

/** The pipeline's stages, left to right (or top to bottom on a phone): one per `column`, in its order. */
export function stagesOf(jobs: readonly PrJob[]): Stage[] {
  const by = new Map<number, Stage>();
  for (const j of jobs) {
    const s = by.get(j.column) ?? { column: j.column, name: j.columnName, jobs: [] };
    s.jobs.push(j);
    by.set(j.column, s);
  }
  return [...by.values()].sort((a, b) => a.column - b.column);
}

/** The job whose log opens under the graph: the first failed one (Q58); null when none failed. */
export const failedJob = (jobs: readonly PrJob[]): PrJob | null => jobs.find(j => j.status === 'fail') ?? null;

/** A job's duration: m:ss under an hour (1:31), h:mm beyond (1:04, the screen adds « h »); null without one. */
export function duration(s: number | undefined): { text: string; hours: boolean } | null {
  if (s === undefined) return null;
  const t = Math.round(s);
  if (t < 3600) return { text: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, hours: false };
  return { text: `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`, hours: true };
}

/** A log the PC cut: it keeps the end and starts with « … » (contract §3). */
export const logCut = (text: string): boolean => text.startsWith('…');

const KNOWN = new Set(['draft', 'not_open', 'approvals', 'changes_requested', 'pipeline', 'pipeline_not_started']);

/**
 * A condition of a merge, met or not, as Desktop lists them under « Pour fusionner » (apps/desktop/src/forge/states.ts): the
 * refused ones first, in the PC's order, then the met ones. A code the phone does not know is shown as is (Q59).
 */
export type MergeCondition =
  | { ok: true; key: 'pipeline' | 'noCi' | 'noChanges' }
  | { ok: true; key: 'approved'; given: number; required: number }
  | { ok: false; key: 'draft' | 'not_open' | 'pipeline_fail' | 'pipeline_run' | 'pipeline_wait' | 'pipeline_skip' | 'pipeline_not_started' }
  | { ok: false; key: 'raw'; code: string }
  | { ok: false; key: 'approvals'; given: number; required: number }
  | { ok: false; key: 'changes_requested'; who: string };

/** Desktop's conditions, the same on the phone: GitHub gives no number of approvals required, which counts as one. */
export function mergeConditions(d: Pick<PrDetail, 'pr' | 'mergeBlockers' | 'reviewers'>): MergeCondition[] {
  const { pr } = d;
  const b = new Set(d.mergeBlockers);
  const required = Math.max(1, pr.approvals.required ?? 0);
  const out: MergeCondition[] = [];
  if (b.has('draft')) out.push({ ok: false, key: 'draft' });
  if (b.has('not_open')) out.push({ ok: false, key: 'not_open' });
  if (b.has('approvals')) out.push({ ok: false, key: 'approvals', given: pr.approvals.given, required });
  if (b.has('changes_requested')) out.push({ ok: false, key: 'changes_requested', who: d.reviewers.filter(r => r.state === 'changes').map(r => r.name).join(', ') });
  if (b.has('pipeline_not_started')) out.push({ ok: false, key: 'pipeline_not_started' });
  else if (b.has('pipeline') || (pr.pipeline !== 'ok' && pr.pipeline !== 'none')) {
    out.push({ ok: false, key: pr.pipeline === 'run' ? 'pipeline_run' : pr.pipeline === 'wait' ? 'pipeline_wait' : pr.pipeline === 'skip' ? 'pipeline_skip' : 'pipeline_fail' });
  } else out.push({ ok: true, key: pr.pipeline === 'none' ? 'noCi' : 'pipeline' });
  for (const code of b) if (!KNOWN.has(code)) out.push({ ok: false, key: 'raw', code });
  if (!b.has('approvals')) out.push({ ok: true, key: 'approved', given: pr.approvals.given, required });
  if (!b.has('changes_requested')) out.push({ ok: true, key: 'noChanges' });
  return out;
}

/** A merge is offered when every condition is met and the request can still be merged (Q59). */
export const canMerge = (d: Pick<PrDetail, 'pr' | 'mergeBlockers' | 'reviewers'>): boolean =>
  (d.pr.state === 'open' || d.pr.state === 'review') && mergeConditions(d).every(c => c.ok);

/** The approvals as the footer writes them: « 1/1 » when the forge says how many are required (GitLab), else « 0 ». */
export const approvalsText = (p: Pick<PullRequest, 'approvals'>): string =>
  `${p.approvals.given}${p.approvals.required !== undefined ? `/${p.approvals.required}` : ''}`;

/**
 * A condition's sentence as the footer quotes it after « · » (« 1/1 approbation · le pipeline a échoué »): its final period dropped,
 * and its first letter lowered unless it starts with a name (`changes_requested`) or is a code shown as is.
 */
export const inFoot = (s: string, c: MergeCondition): string => {
  const cut = s.replace(/\.$/, '');
  return c.key === 'changes_requested' || c.key === 'raw' ? cut : cut.charAt(0).toLowerCase() + cut.slice(1);
};

/** Rerun shows only on a failed pipeline of an open request that is not a draft: the PC reruns the failed jobs (Q58, M5 behaviours). */
export const canRerun = (p: PullRequest): boolean => p.pipeline === 'fail' && (p.state === 'open' || p.state === 'review');

/** The discussions that can be resolved and are not, then the resolved ones (the « 2 ouverts · 1 résolu » line). */
export function threadCounts(d: PrDetail): { open: number; resolved: number } {
  return { open: d.threads.filter(t => t.resolvable && !t.resolved).length, resolved: d.threads.filter(t => t.resolvable && t.resolved).length };
}

/** The added and removed lines of all the files (« +48 −12 »). */
export const diffTotal = (d: PrDetail): { added: number; removed: number } =>
  d.files.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 });

/** The discussions on a file (« 1 discussion » under it in Modifications). */
export const fileThreads = (d: PrDetail, path: string): number => d.threads.filter(t => t.file === path).length;

/** A sha as the screens show it. */
export const shortSha = (sha: string): string => sha.slice(0, 7);

/**
 * A session's chip in its foot (Q60): its open request (the newest), « unknown » when its repository's forge cannot be read on the PC
 * (« MR ? »), or nothing.
 */
export function chipOf(state: PhoneForgeState | null, session: string): { pr: PullRequest } | { unknown: PhoneForgeStatus; kind: ForgeKind } | null {
  if (!state) return null;
  const pr = state.prs.find(p => isOpen(p) && p.sessions.includes(session));
  if (pr) return { pr };
  const followed = state.followed.find(f => f.session === session);
  if (!followed) return null;
  const status = state.forges.find(f => f.forge === followed.forge && f.host === followed.host);
  return status && status.status !== 'ok' ? { unknown: status, kind: followed.forge } : null;
}
