import { describe, expect, it } from 'vitest';
import type { PullRequest } from '@ledge/protocol';
import { mergedPrs, openPrs, prOfSession, prsFailing, prsWaitingForYou } from '../src/forge';

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
  });
  it('finds a session\'s request, the open one first', () => {
    expect(prOfSession(MOCKUP, 'server:tom')?.number).toBe(1);
    expect(prOfSession(MOCKUP, 'local:ida')?.number).toBe(9);
    expect(prOfSession([pr(9, { state: 'merged', sessions: ['s'] }), pr(4, { sessions: ['s'] })], 's')?.number).toBe(4);
    expect(prOfSession(MOCKUP, 'nobody')).toBeUndefined();
  });
});
