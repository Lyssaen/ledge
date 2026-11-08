import type { ForgeAction, PipeStatus, PrDetail, PrState, PullRequest, RefusalCode } from '@ledge/protocol';
import { classify, errorText, type ForgeRepo, type ForgeRunResult } from './run.js';

/** A request as a reader gives it: no sessions yet, and why it could not be merged apart from its pipeline (R5). */
export type PrCore = Omit<PullRequest, 'sessions'>;
/** `head`: the repository path its source branch lives in (a fork's, for a request from a fork). */
export type ReadPr = PrCore & { blockers: MergeBlocker[]; head: string };
/**
 * What a session follows (R1): its branch, in the repository the branch is pushed to (`head`: the branch's push remote or
 * upstream, `origin` by default), on the same host as the repository listed. Two forks with the same branch name are two targets.
 */
export interface BranchTarget { branch: string; head: string }
export const targetKey = (t: BranchTarget): string => `${t.head.toLowerCase()}\n${t.branch}`;
/** The request of a target among those a branch name gives: the one whose head is the target's, open first, else the latest. */
export function pickFor<T extends { branch: string; head: string; open: boolean; updatedAt: string }>(t: BranchTarget, all: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const p of all) {
    if (p.branch !== t.branch || p.head.toLowerCase() !== t.head.toLowerCase()) continue;
    if (!best || (p.open && !best.open) || (p.open === best.open && Date.parse(p.updatedAt) > Date.parse(best.updatedAt))) best = p;
  }
  return best;
}
export type ReadDetail = Omit<PrDetail, 'pr'> & { pr: ReadPr };

/**
 * Why a merge is refused (R5), as `mergeBlockers` carries them: not open (merged or closed), a draft, the pipeline not green,
 * an approval missing, changes requested.
 */
export const MERGE_BLOCKERS = ['not_open', 'draft', 'pipeline', 'approvals', 'changes_requested'] as const;
export type MergeBlocker = (typeof MERGE_BLOCKERS)[number];
const BLOCKER_TEXT: Record<MergeBlocker, string> = {
  not_open: 'the request is not open', draft: 'the request is a draft', pipeline: 'the pipeline is not green',
  approvals: 'an approval is missing', changes_requested: 'changes are requested'
};
/** R5 as decided on 2026-11-08: a pipeline that failed, runs or waits blocks a merge; none at all (a repository without CI) does not. */
export const pipelineBlocks = (p: PipeStatus): boolean => p !== 'ok' && p !== 'none';
/** Every reason a merge is refused now: the request's own, then its pipeline. */
export const mergeBlockersOf = (pr: Pick<ReadPr, 'blockers' | 'pipeline'>): MergeBlocker[] => [...pr.blockers, ...(pipelineBlocks(pr.pipeline) ? ['pipeline' as const] : [])];
export const blockerText = (b: readonly MergeBlocker[]): string => b.map(x => BLOCKER_TEXT[x]).join('; ');

/** R5 apart from the pipeline: what `mergeable` sums up. */
export function blockersOf(p: { state: PrState; approvals: { given: number; required?: number }; changesRequested: boolean; approvalsMissing?: boolean }): MergeBlocker[] {
  const out: MergeBlocker[] = [];
  if (p.state === 'draft') out.push('draft');
  else if (p.state !== 'open' && p.state !== 'review') out.push('not_open');
  if (p.approvalsMissing || p.approvals.given < Math.max(1, p.approvals.required ?? 0)) out.push('approvals');
  if (p.changesRequested) out.push('changes_requested');
  return out;
}

export interface ForgeReader {
  /**
   * The requests of `targets` in `repo`: one query for the repository, asking only for the followed branch names (so none is lost
   * past a page of the whole list); per target the request whose head repository is its own, open first, else the latest.
   */
  list(repo: ForgeRepo, targets: readonly BranchTarget[]): Promise<ReadPr[]>;
  /** One request in full; `log`: also that job's log. */
  detail(repo: ForgeRepo, number: number, opts: { log?: string }): Promise<ReadDetail>;
  /** Runs the action (the caller has applied R5 and R6); `command`: what ran, the body left out. Throws ForgeRefusal or ForgeError. */
  act(repo: ForgeRepo, pr: PrCore, action: ForgeAction): Promise<{ command: string }>;
  /** The repository's default branch, read once (R1). */
  defaultBranch(repo: ForgeRepo): Promise<string | null>;
}

/** A refusal before anything ran on the forge. */
export class ForgeRefusal extends Error {
  constructor(public readonly code: RefusalCode, message: string) { super(message); }
}
/** The forge could not be read or written: its CLI missing, not signed in, or another error (message redacted). */
export class ForgeError extends Error {
  constructor(public readonly status: 'missing' | 'unauthenticated' | 'error', message: string) { super(message); }
}

/** The run's stdout, or a ForgeError. */
export function ok(r: ForgeRunResult, cli: string): string {
  const s = classify(r);
  if (s !== 'ok') throw new ForgeError(s, errorText(r, cli));
  return r.stdout;
}
/** The run's stdout as JSON, or a ForgeError. */
export function okJson<T>(r: ForgeRunResult, cli: string): T {
  const out = ok(r, cli);
  try { return JSON.parse(out) as T; } catch { throw new ForgeError('error', `${cli} did not answer JSON`); }
}

/** The ids a command may carry, checked before use: a thread, a job, a commit. */
export const THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9_=-]{0,99}$/;
export const JOB_ID = /^\d{1,20}$/;
export const SHA = /^[0-9a-f]{7,64}$/;
/** The total size of the patches of one request's files. */
export const PATCH_BUDGET = 200 * 1024;

/** Seconds between two dates, when both are real. */
export function seconds(from?: string | null, to?: string | null): number | undefined {
  const a = from ? Date.parse(from) : NaN, b = to ? Date.parse(to) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && b >= a && a > 0 ? Math.round((b - a) / 1000) : undefined;
}
/** A date the protocol accepts (`datetime`, UTC), or the epoch. */
export const iso = (d: unknown): string => {
  const t = typeof d === 'string' ? Date.parse(d) : NaN;
  return new Date(Number.isFinite(t) ? t : 0).toISOString();
};
/** The diff line a review comment is on: the last line of its hunk. */
export const lastLine = (hunk?: string | null): string | undefined => (hunk ? hunk.split('\n').filter(Boolean).pop() : undefined);
export const shellJoin = (file: string, args: readonly string[]): string => [file, ...args.map(a => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`))].join(' ');
