import { describe, expect, it } from 'vitest';
import type { PullRequest } from '@ledge/protocol';
import { mergedPrs, openPrs, prOfSession, prsFailing, prsWaitingForYou, sessionForge, type FleetFollowedSession, type FleetForgeStatus } from '../src/forge';

const pr = (n: number, extra: Partial<PullRequest> = {}): PullRequest => ({ id: `github.com/o/r#${n}`, forge: 'github', host: 'github.com', repo: 'o/r', number: n, ref: `#${n}`,
  url: `https://github.com/o/r/pull/${n}`, title: 't', state: 'open', branch: `b${n}`, target: 'main', headSha: 'a'.repeat(40), pipeline: 'ok', approvals: { given: 1 },
  mergeable: true, openThreads: 0, updatedAt: `2026-11-08T10:0${n % 10}:00.000Z`, sessions: [], ...extra });

/** The mockup's list: gh-226 draft running, gh-222 in review green not mergeable, gh-225 green and approved, gl-41 failed, gh-219 merged. */
const MOCKUP = [pr(6, { state: 'draft', pipeline: 'run', mergeable: false }), pr(2, { state: 'review', mergeable: false, sessions: ['local:front'] }),
  pr(5, { sessions: ['local:back'] }), pr(1, { pipeline: 'fail', sessions: ['server:tom'] }), pr(9, { state: 'merged', sessions: ['local:ida'] }), pr(3, { state: 'closed', pipeline: 'fail' })];

describe('the view of the requests', () => {
  it('splits open and merged, most recent first', () => {
    expect(openPrs(MOCKUP).map(p => p.number)).toEqual([6, 5, 2, 1]);
    expect(mergedPrs(MOCKUP).map(p => p.number)).toEqual([9]);
  });
  it('counts the open requests whose pipeline failed, for the badge (a closed one does not count)', () => {
    expect(prsFailing(MOCKUP)).toBe(1);
  });
  it('waits for you: failed, or green and mergeable', () => {
    expect(prsWaitingForYou(MOCKUP).map(p => p.number)).toEqual([5, 1]);
    // R5: no CI at all and mergeable is ready to merge too; running is not.
    expect(prsWaitingForYou([pr(7, { pipeline: 'none' }), pr(8, { pipeline: 'run' }), pr(4, { pipeline: 'none', mergeable: false })]).map(p => p.number)).toEqual([7]);
  });
  it('finds a session\'s request, the open one first', () => {
    expect(prOfSession(MOCKUP, 'server:tom')?.number).toBe(1);
    expect(prOfSession(MOCKUP, 'local:ida')?.number).toBe(9);
    expect(prOfSession([pr(9, { state: 'merged', sessions: ['s'] }), pr(4, { sessions: ['s'] })], 's')?.number).toBe(4);
    expect(prOfSession(MOCKUP, 'nobody')).toBeUndefined();
  });
});

// Lot 8b, state 2: the chip « PR ? » for a session followed on a forge that cannot be read on its machine.
describe('sessionForge', () => {
  const st = (machineId: string, status: FleetForgeStatus['status'], host = 'github.com'): FleetForgeStatus => ({ forge: 'github', host, status, at: '2026-11-08T10:00:00.000Z', machineId });
  const fol = (session: string, machineId: string, host = 'github.com'): FleetFollowedSession => ({ session, forge: 'github', host, repo: 'o/r', machineId });
  it('gives the unreadable forge of a followed session without request, nothing otherwise', () => {
    const forges = [st('local', 'unauthenticated'), st('server', 'ok'), st('local', 'ok', 'gitlab.com')];
    const followed = [fol('local:a', 'local'), fol('server:b', 'server'), fol('local:c', 'local', 'gitlab.com'), fol('local:d', 'local')];
    expect(sessionForge([], forges, followed, 'local:a')).toMatchObject({ status: 'unauthenticated', host: 'github.com', machineId: 'local' });
    expect(sessionForge([], forges, followed, 'server:b')).toBeUndefined();
    expect(sessionForge([], forges, followed, 'local:c')).toBeUndefined();
    expect(sessionForge([pr(4, { sessions: ['local:d'] })], forges, followed, 'local:d')).toBeUndefined();
    expect(sessionForge([], forges, followed, 'local:nobody')).toBeUndefined();
  });
});
