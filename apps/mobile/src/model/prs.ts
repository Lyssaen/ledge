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

/**
 * What blocks a merge, one entry per code of `mergeBlockers`, with what its sentence needs: the forge for a draft, the approvals, who
 * asked for changes, how the pipeline stands. A code the phone does not know is kept as is (Q59).
 */
export type Blocker =
  | { code: 'draft'; forge: ForgeKind }
  | { code: 'not_open' }
  | { code: 'approvals'; given: number; required: number }
  | { code: 'changes_requested'; who: string }
  | { code: 'pipeline'; pipeline: PipeStatus }
  | { code: 'pipeline_not_started' }
  | { code: 'unknown'; raw: string };

export function blockersOf(d: PrDetail): Blocker[] {
  return d.mergeBlockers.map((code): Blocker => {
    switch (code) {
      case 'draft': return { code, forge: d.pr.forge };
      case 'not_open': return { code };
      // GitHub does not give the number required: one more than given is what is missing.
      case 'approvals': return { code, given: d.pr.approvals.given, required: d.pr.approvals.required ?? d.pr.approvals.given + 1 };
      case 'changes_requested': return { code, who: d.reviewers.filter(r => r.state === 'changes').map(r => r.name).join(', ') };
      case 'pipeline': return { code, pipeline: d.pr.pipeline };
      case 'pipeline_not_started': return { code };
      default: return { code: 'unknown', raw: code };
    }
  });
}

/** A merge is offered when nothing blocks it and the request can still be merged (Q59). */
export const canMerge = (d: PrDetail): boolean => d.mergeBlockers.length === 0 && (d.pr.state === 'open' || d.pr.state === 'review');

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
