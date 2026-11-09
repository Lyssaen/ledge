import { describe, expect, it } from 'vitest';
import type { FleetForgeStatus, FleetPullRequest } from '@ledge/fleet';
import { canMerge, forgeLines, loginCommand, mergeConditions, noForgeReadable, reachOf } from '../../src/forge/states';
import { foldForge } from '../../src/forge/useForge';

// docs/mockups/ledge-ide-prs-states.html (validated by jde, 2026-11-09).
const AT = '2026-11-09T10:42:00.000Z';
const fs = (o: Partial<FleetForgeStatus>): FleetForgeStatus => ({ forge: 'github', host: 'github.com', status: 'ok', at: AT, machineId: 'local', ...o });
const pr = (o: Partial<FleetPullRequest>): FleetPullRequest => ({
  id: 'github.com/ledge#225', forge: 'github', host: 'github.com', repo: 'ledge', number: 225, ref: '#225', url: 'https://example.invalid/225', title: 't',
  state: 'open', branch: 'b', target: 'main', headSha: '3f9c2ab', pipeline: 'ok', approvals: { given: 1, required: 1 }, mergeable: true, openThreads: 0,
  updatedAt: AT, sessions: [], machineId: 'local', ...o
});

describe('reachOf', () => {
  it('open with forge: ok; open without it: outdated; down: daemonDown (local) or offline (another)', () => {
    expect(reachOf({ id: 'local', status: 'open', daemon: { forge: true } })).toBe('ok');
    expect(reachOf({ id: 'build-02', status: 'open', daemon: {} })).toBe('outdated');
    expect(reachOf({ id: 'local', status: 'unreachable' })).toBe('daemonDown');
    expect(reachOf({ id: 'srv-build', status: 'connecting' })).toBe('offline');
  });
});

describe('forgeLines (states 1, 3, 4)', () => {
  const machines = [
    { id: 'local', status: 'open' as const, daemon: { forge: true } },
    { id: 'srv-build', status: 'unreachable' as const },
    { id: 'build-02', status: 'open' as const, daemon: {} },
    { id: 'never', status: 'unreachable' as const }
  ];
  const readAt = (m: string) => (m === 'srv-build' ? 1000 : null);
  it('machines first (offline only when read before, too old), then each forge not ok on a reachable machine', () => {
    const lines = forgeLines([
      fs({ status: 'unauthenticated', forge: 'gitlab', host: 'gitlab.corp.lan' }),
      fs({ status: 'missing' }),
      fs({ status: 'error', message: 'HTTP 502' }),
      fs({ status: 'ok', forge: 'gitlab' }),
      fs({ status: 'missing', machineId: 'srv-build' })
    ], machines, readAt);
    expect(lines).toEqual([
      { kind: 'offline', machine: 'srv-build', at: 1000 },
      { kind: 'outdated', machine: 'build-02' },
      { kind: 'unauthenticated', machine: 'local', forge: 'gitlab', host: 'gitlab.corp.lan' },
      { kind: 'missing', machine: 'local', forge: 'github', host: 'github.com' },
      { kind: 'error', machine: 'local', forge: 'github', host: 'github.com', since: AT, message: 'HTTP 502' }
    ]);
  });
  it('the exact sign-in command, per CLI; no forge readable', () => {
    expect(loginCommand('gitlab', 'gitlab.corp.lan')).toBe('glab auth login --hostname gitlab.corp.lan');
    expect(loginCommand('github', 'github.com')).toBe('gh auth login --hostname github.com');
    expect(noForgeReadable([fs({ status: 'unauthenticated' })])).toBe(true);
    expect(noForgeReadable([fs({ status: 'unauthenticated' }), fs({ forge: 'gitlab' })])).toBe(false);
    expect(noForgeReadable([])).toBe(false);
  });
});

describe('mergeConditions (states 6, 7)', () => {
  it('every reason at once, refused first, then the met ones', () => {
    const c = mergeConditions(pr({ pipeline: 'fail', approvals: { given: 0, required: 1 } }), {
      mergeBlockers: ['draft', 'approvals', 'changes_requested', 'pipeline'], reviewers: [{ name: 'reviewer', state: 'changes' }, { name: 'lead', state: 'pending' }]
    });
    expect(c).toEqual([
      { ok: false, key: 'draft' }, { ok: false, key: 'approvals', given: 0, required: 1 },
      { ok: false, key: 'changes_requested', who: 'reviewer' }, { ok: false, key: 'pipeline_fail' }
    ]);
    expect(canMerge(c)).toBe(false);
  });
  it('all met: pipeline passed, approved, no changes requested; a repository without CI says so', () => {
    const c = mergeConditions(pr({}), { mergeBlockers: [], reviewers: [] });
    expect(c).toEqual([{ ok: true, key: 'pipeline' }, { ok: true, key: 'approved', given: 1, required: 1 }, { ok: true, key: 'noChanges' }]);
    expect(canMerge(c)).toBe(true);
    expect(mergeConditions(pr({ pipeline: 'none' }), { mergeBlockers: [], reviewers: [] })[0]).toEqual({ ok: true, key: 'noCi' });
  });
  it('the pipeline\'s own state names the reason; GitHub without a required count asks for one', () => {
    for (const [p, key] of [['run', 'pipeline_run'], ['wait', 'pipeline_wait'], ['skip', 'pipeline_skip']] as const)
      expect(mergeConditions(pr({ pipeline: p }), { mergeBlockers: ['pipeline'], reviewers: [] })[0]).toEqual({ ok: false, key });
    expect(mergeConditions(pr({ approvals: { given: 0 } }), { mergeBlockers: ['approvals'], reviewers: [] })[0]).toEqual({ ok: false, key: 'approvals', given: 0, required: 1 });
  });
});

describe('foldForge: a machine that falls keeps its last read', () => {
  it('a machine heard is replaced and timed; one dropped keeps what it had', () => {
    const a = pr({ machineId: 'local' }), b = pr({ id: 'x', machineId: 'srv-build' });
    const one = foldForge(new Map(), [a, b], [], 100);
    expect(one.get('srv-build')).toEqual({ prs: [b], at: 100 });
    const two = foldForge(one, [a], [], 200);
    expect(two.get('local')!.at).toBe(200);
    expect(two.get('srv-build')).toEqual({ prs: [b], at: 100 });
  });
});

describe('the lot 8b contract (dev-back, 31194680)', () => {
  it('no pipeline started yet, and a code this front does not know, shown as is', () => {
    const c = mergeConditions(pr({ pipeline: 'wait' }), { mergeBlockers: ['pipeline_not_started', 'locked_by_admin'], reviewers: [] });
    expect(c.slice(0, 2)).toEqual([{ ok: false, key: 'pipeline_not_started' }, { ok: false, key: 'raw', code: 'locked_by_admin' }]);
  });
  it('a forge in error: since when, its next try and its last read', () => {
    const lines = forgeLines([fs({ status: 'error', since: '2026-11-09T10:42:00.000Z', retryAt: '2026-11-09T10:50:00.000Z', readAt: '2026-11-09T10:40:00.000Z' })], [{ id: 'local', status: 'open', daemon: { forge: true } }], () => null);
    expect(lines).toEqual([{ kind: 'error', machine: 'local', forge: 'github', host: 'github.com', since: '2026-11-09T10:42:00.000Z', retryAt: '2026-11-09T10:50:00.000Z', readAt: '2026-11-09T10:40:00.000Z' }]);
  });
});
