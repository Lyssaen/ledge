/**
 * The MR and PR states v27 does not draw (docs/mockups/ledge-ide-prs-states.html, validated by jde on 2026-11-09): what a
 * machine's forges and daemon let the view show, and the conditions of a merge. Pure: no React, no fleet.
 */
import type { FleetForgeStatus, FleetPullRequest } from '@ledge/fleet';
import type { PrDetail } from '@ledge/protocol';

/** How a machine's requests can be read and acted on: its daemon answers and serves them, is down (the local one) or offline
 *  (another machine), or is too old to serve them (no `daemon.forge`). */
export type MachineReach = 'ok' | 'daemonDown' | 'offline' | 'outdated';
export interface MachineLike { id: string; status: 'connecting' | 'open' | 'unreachable'; daemon?: { forge?: boolean } }

export function reachOf(m: MachineLike | undefined): MachineReach {
  if (!m || m.status !== 'open') return m?.id === 'local' || !m ? 'daemonDown' : 'offline';
  return m.daemon && !m.daemon.forge ? 'outdated' : 'ok';
}

/** One line at the head of the view (states 1, 3, 4): a forge that cannot be read on a machine, or a machine whose requests are
 *  as last read (offline, daemon down) or never read (too old). */
export type ForgeLine =
  | { kind: 'missing'; machine: string; forge: FleetForgeStatus['forge']; host: string }
  | { kind: 'unauthenticated'; machine: string; forge: FleetForgeStatus['forge']; host: string }
  | { kind: 'error'; machine: string; forge: FleetForgeStatus['forge']; host: string; since: string; retryAt?: string; readAt?: string; message?: string }
  | { kind: 'offline' | 'daemonDown'; machine: string; at: number | null }
  | { kind: 'outdated'; machine: string };

/** The lines of the view's head: each machine that is not reachable (once), then each forge not `ok` on a reachable machine. */
export function forgeLines(forges: readonly FleetForgeStatus[], machines: readonly MachineLike[], readAt: (machine: string) => number | null): ForgeLine[] {
  const out: ForgeLine[] = [];
  const reach = new Map(machines.map(m => [m.id, reachOf(m)]));
  for (const m of machines) {
    const r = reach.get(m.id)!;
    if (r === 'outdated') out.push({ kind: 'outdated', machine: m.id });
    // Offline or down: said only when something was read from it before (its requests stay, dimmed).
    else if (r !== 'ok' && readAt(m.id) !== null) out.push({ kind: r, machine: m.id, at: readAt(m.id) });
  }
  for (const f of forges) {
    if (reach.get(f.machineId) !== 'ok' || f.status === 'ok') continue;
    if (f.status === 'error') out.push({ kind: 'error', machine: f.machineId, forge: f.forge, host: f.host, since: f.since ?? f.at, ...(f.retryAt ? { retryAt: f.retryAt } : {}), ...(f.readAt ? { readAt: f.readAt } : {}), ...(f.message ? { message: f.message } : {}) });
    else out.push({ kind: f.status, machine: f.machineId, forge: f.forge, host: f.host });
  }
  return out;
}

/** The CLI of a forge, and the exact command that signs it in to `host` (state 1: copied, never run by Ledge). */
export const cliOf = (forge: FleetForgeStatus['forge']): 'gh' | 'glab' => (forge === 'github' ? 'gh' : 'glab');
export const loginCommand = (forge: FleetForgeStatus['forge'], host: string): string => `${cliOf(forge)} auth login --hostname ${host}`;

/** Whether no forge at all can be read now (state 10's second text). */
export const noForgeReadable = (forges: readonly FleetForgeStatus[]): boolean => forges.length > 0 && forges.every(f => f.status !== 'ok');

const KNOWN = new Set(['draft', 'not_open', 'approvals', 'changes_requested', 'pipeline', 'pipeline_not_started']);
/** A condition of a merge (state 6), met or not. */
export type MergeCondition =
  | { ok: true; key: 'pipeline' | 'noCi' | 'noChanges' }
  | { ok: true; key: 'approved'; given: number; required: number }
  | { ok: false; key: 'draft' | 'not_open' | 'pipeline_fail' | 'pipeline_run' | 'pipeline_wait' | 'pipeline_skip' | 'pipeline_not_started' }
  /** A code this front does not know: shown as is (the contract). */
  | { ok: false; key: 'raw'; code: string }
  | { ok: false; key: 'approvals'; given: number; required: number }
  | { ok: false; key: 'changes_requested'; who: string };

/** The conditions of a merge, refused ones first as the daemon gives them, then the met ones (state 6, 7). Every reason at
 *  once. `pipeline` is told by the pipeline's own state; `none` reaches the front only for a repository without any CI. */
export function mergeConditions(pr: Pick<FleetPullRequest, 'pipeline' | 'approvals'>, detail: Pick<PrDetail, 'mergeBlockers' | 'reviewers'>): MergeCondition[] {
  const b = new Set(detail.mergeBlockers);
  const required = Math.max(1, pr.approvals.required ?? 0);
  const out: MergeCondition[] = [];
  if (b.has('draft')) out.push({ ok: false, key: 'draft' });
  if (b.has('not_open')) out.push({ ok: false, key: 'not_open' });
  if (b.has('approvals')) out.push({ ok: false, key: 'approvals', given: pr.approvals.given, required });
  const asking = detail.reviewers.filter(r => r.state === 'changes').map(r => r.name);
  if (b.has('changes_requested')) out.push({ ok: false, key: 'changes_requested', who: asking.join(', ') });
  if (b.has('pipeline_not_started')) out.push({ ok: false, key: 'pipeline_not_started' });
  else if (b.has('pipeline') || (pr.pipeline !== 'ok' && pr.pipeline !== 'none')) {
    const p = pr.pipeline === 'run' ? 'pipeline_run' : pr.pipeline === 'wait' ? 'pipeline_wait' : pr.pipeline === 'skip' ? 'pipeline_skip' : 'pipeline_fail';
    out.push({ ok: false, key: p });
  } else out.push({ ok: true, key: pr.pipeline === 'none' ? 'noCi' : 'pipeline' });
  for (const code of b) if (!KNOWN.has(code)) out.push({ ok: false, key: 'raw', code });
  if (!b.has('approvals')) out.push({ ok: true, key: 'approved', given: pr.approvals.given, required });
  if (!b.has('changes_requested')) out.push({ ok: true, key: 'noChanges' });
  return out;
}

/** Mergeable now: every condition met. */
export const canMerge = (c: readonly MergeCondition[]): boolean => c.every(x => x.ok);
