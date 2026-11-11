import { describe, expect, it } from 'vitest';
import {
  approvalsText, atoiPrs, canMerge, canRerun, chipOf, diffTotal, duration, failedCount, failedJob, fileThreads, inFoot, isReady, logCut, mergeConditions,
  PIPE_DOT, prRouteId, shortSha, signInCommand, splitPrs, stagesOf, threadCounts, unreadable
} from '../../src/model/prs';
import { detail, forgeState, mr, pr } from './forge-fixtures';

const AT = '2026-11-11T14:12:00.000Z';

describe('the list', () => {
  it('gives each pipeline its dot, a skipped one plain grey and none hollow', () => {
    expect(PIPE_DOT).toEqual({ ok: 'idle', run: 'work', fail: 'perm', wait: 'ask', skip: 'plain', none: 'off' });
  });

  it('keeps the PC order and folds the merged and closed requests at the bottom', () => {
    const merged = pr({ id: 'm', state: 'merged' });
    const closed = pr({ id: 'c', state: 'closed' });
    const draft = pr({ id: 'd', state: 'draft' });
    const { open, closed: folded } = splitPrs([merged, mr(), closed, draft, pr()]);
    expect(open.map(p => p.id)).toEqual([mr().id, 'd', pr().id]);
    expect(folded.map(p => p.id)).toEqual(['m', 'c']);
  });

  it('says « prête à fusionner » only for an open request that can merge, its pipeline passed or absent', () => {
    expect(isReady(pr())).toBe(true);
    expect(isReady(pr({ state: 'review' }))).toBe(true);
    expect(isReady(pr({ pipeline: 'none' }))).toBe(true);
    expect(isReady(pr({ pipeline: 'run' }))).toBe(false);
    expect(isReady(pr({ mergeable: false }))).toBe(false);
    expect(isReady(pr({ state: 'draft' }))).toBe(false);
    expect(isReady(pr({ state: 'merged' }))).toBe(false);
  });

  it('counts the open failed pipelines for the badge, not a closed one', () => {
    expect(failedCount([mr(), mr({ id: 'x', state: 'closed' }), pr()])).toBe(1);
    expect(failedCount([])).toBe(0);
  });

  it('puts the failed pipelines first in « À toi », then the ready requests', () => {
    const ready = pr();
    const waiting = pr({ id: 'w', pipeline: 'run' });
    const failedReady = mr({ id: 'f', mergeable: true });
    expect(atoiPrs([ready, waiting, mr(), failedReady]).map(e => [e.pr.id, e.why])).toEqual([[mr().id, 'fail'], ['f', 'fail'], [ready.id, 'ready']]);
  });

  it('keeps the request id whole in a route', () => {
    const id = prRouteId(pr().id);
    expect(id).not.toMatch(/[/#]/);
    expect(decodeURIComponent(id)).toBe(pr().id);
  });
});

describe('a forge that cannot be read', () => {
  it('keeps the forges whose status is not ok: GitLab without glab is missing (decision 35)', () => {
    const forges = [
      { forge: 'github' as const, host: 'github.com', status: 'ok' as const, at: AT },
      { forge: 'gitlab' as const, host: 'gitlab.acme.dev', status: 'missing' as const, at: AT, since: AT }
    ];
    expect(unreadable(forges)).toEqual([forges[1]]);
  });

  it('writes the sign-in command with the CLI of the forge and its host (Q61)', () => {
    expect(signInCommand({ forge: 'gitlab', host: 'gitlab.acme.dev' })).toBe('glab auth login --hostname gitlab.acme.dev');
    expect(signInCommand({ forge: 'github', host: 'github.com' })).toBe('gh auth login --hostname github.com');
  });
});

describe('the pipeline', () => {
  it('groups the jobs by stage, in column order, keeping the PC order inside one', () => {
    const jobs = [
      { id: 'b', name: 'test-b', column: 1, columnName: 'test', status: 'ok' as const },
      { id: 'a', name: 'build', column: 0, columnName: 'build', status: 'ok' as const },
      { id: 'c', name: 'test-a', column: 1, columnName: 'test', status: 'fail' as const }
    ];
    expect(stagesOf(jobs).map(s => [s.name, s.jobs.map(j => j.id)])).toEqual([['build', ['a']], ['test', ['b', 'c']]]);
    expect(failedJob(jobs)?.id).toBe('c');
    expect(failedJob(jobs.slice(0, 2))).toBeNull();
  });

  it('writes durations m:ss under an hour and h:mm beyond', () => {
    expect(duration(undefined)).toBeNull();
    expect(duration(0)).toEqual({ text: '0:00', hours: false });
    expect(duration(122)).toEqual({ text: '2:02', hours: false });
    expect(duration(3599.6)).toEqual({ text: '1:00', hours: true });
    expect(duration(3840)).toEqual({ text: '1:04', hours: true });
  });

  it('tells a log the PC cut by its leading « … »', () => {
    expect(logCut('… last lines')).toBe(true);
    expect(logCut('whole log')).toBe(false);
  });

  it('offers rerun only on a failed pipeline of an open request', () => {
    expect(canRerun(mr())).toBe(true);
    expect(canRerun(mr({ state: 'review' }))).toBe(true);
    expect(canRerun(mr({ state: 'draft' }))).toBe(false);
    expect(canRerun(mr({ state: 'closed' }))).toBe(false);
    expect(canRerun(pr())).toBe(false);
  });
});

describe('merging', () => {
  it('lists the refused conditions first, as Desktop does, and keeps an unknown code as is', () => {
    const d = detail(mr(), {
      reviewers: [{ name: 'review-qa', state: 'changes' }, { name: 'tom', state: 'approved' }, { name: 'ana', state: 'changes' }],
      mergeBlockers: ['draft', 'not_open', 'approvals', 'changes_requested', 'pipeline', 'merge_queue']
    });
    expect(mergeConditions(d)).toEqual([
      { ok: false, key: 'draft' },
      { ok: false, key: 'not_open' },
      { ok: false, key: 'approvals', given: 0, required: 1 },
      { ok: false, key: 'changes_requested', who: 'review-qa, ana' },
      { ok: false, key: 'pipeline_fail' },
      { ok: false, key: 'raw', code: 'merge_queue' }
    ]);
  });

  it('says how the pipeline stands, and when none started yet', () => {
    const keys = (p: Parameters<typeof pr>[0], b: string[] = []) => mergeConditions(detail(pr(p), { mergeBlockers: b })).map(c => c.key);
    expect(keys({ pipeline: 'run' }, ['pipeline'])[0]).toBe('pipeline_run');
    expect(keys({ pipeline: 'wait' }, ['pipeline_not_started'])[0]).toBe('pipeline_not_started');
    expect(keys({ pipeline: 'none' })).toEqual(['noCi', 'approved', 'noChanges']);
  });

  it('counts one approval required when GitHub does not say, as Desktop does', () => {
    expect(mergeConditions(detail(pr({ approvals: { given: 1 } })))).toEqual([
      { ok: true, key: 'pipeline' }, { ok: true, key: 'approved', given: 1, required: 1 }, { ok: true, key: 'noChanges' }
    ]);
    expect(mergeConditions(detail(pr({ approvals: { given: 0 } }), { mergeBlockers: ['approvals'] }))[0]).toEqual({ ok: false, key: 'approvals', given: 0, required: 1 });
  });

  it('offers a merge only when every condition is met on an open request', () => {
    expect(canMerge(detail())).toBe(true);
    expect(canMerge(detail(pr({ state: 'review' })))).toBe(true);
    expect(canMerge(detail(pr(), { mergeBlockers: ['approvals'] }))).toBe(false);
    expect(canMerge(detail(pr({ pipeline: 'run' })))).toBe(false);
    expect(canMerge(detail(pr({ state: 'merged' })))).toBe(false);
  });

  it('writes the approvals and quotes a sentence in the footer', () => {
    expect(approvalsText(mr({ approvals: { given: 1, required: 1 } }))).toBe('1/1');
    expect(approvalsText(pr({ approvals: { given: 0 } }))).toBe('0');
    expect(inFoot('Le pipeline a échoué.', { ok: false, key: 'pipeline_fail' })).toBe('le pipeline a échoué');
    expect(inFoot('reviewer demande des changements.', { ok: false, key: 'changes_requested', who: 'reviewer' })).toBe('reviewer demande des changements');
    expect(inFoot('Tom demande des changements.', { ok: false, key: 'changes_requested', who: 'Tom' })).toBe('Tom demande des changements');
  });
});

describe('the detail', () => {
  const thread = (id: string, extra: { resolvable: boolean; resolved: boolean; file?: string }) => ({ id, comments: [{ id: `${id}c`, author: 'a', at: AT, body: 'b' }], ...extra });

  it('counts the open and resolved threads, leaving out the comments on the request', () => {
    const d = detail(pr(), {
      threads: [
        thread('1', { resolvable: true, resolved: false, file: 'a.ts' }),
        thread('2', { resolvable: true, resolved: false, file: 'a.ts' }),
        thread('3', { resolvable: true, resolved: true, file: 'b.ts' }),
        thread('4', { resolvable: false, resolved: false })
      ]
    });
    expect(threadCounts(d)).toEqual({ open: 2, resolved: 1 });
    expect(fileThreads(d, 'a.ts')).toBe(2);
    expect(fileThreads(d, 'c.ts')).toBe(0);
  });

  it('adds up the changed lines of all the files', () => {
    const d = detail(pr(), { files: [{ path: 'a', added: 48, removed: 12 }, { path: 'b', added: 2, removed: 0 }] });
    expect(diffTotal(d)).toEqual({ added: 50, removed: 12 });
    expect(diffTotal(detail(pr(), { files: [] }))).toEqual({ added: 0, removed: 0 });
  });

  it('shortens a sha to seven characters', () => {
    expect(shortSha(pr().headSha)).toBe('a3f9c1e');
  });
});

describe('a session’s chip (Q60)', () => {
  it('shows the open request of the session', () => {
    expect(chipOf(forgeState(), 's-front')).toEqual({ pr: pr() });
  });

  it('shows nothing for a session whose request is merged and whose forge reads', () => {
    expect(chipOf(forgeState({ prs: [pr({ state: 'merged' })] }), 's-front')).toBeNull();
  });

  it('shows « MR ? » when the session’s forge cannot be read', () => {
    const missing = { forge: 'gitlab' as const, host: 'gitlab.acme.dev', status: 'missing' as const, at: AT };
    const state = forgeState({ prs: [pr()], forges: [{ forge: 'github', host: 'github.com', status: 'ok', at: AT }, missing] });
    expect(chipOf(state, 's-tom')).toEqual({ unknown: missing, kind: 'gitlab' });
  });

  it('shows nothing for a session not followed, or before any state', () => {
    expect(chipOf(forgeState(), 's-other')).toBeNull();
    expect(chipOf(null, 's-front')).toBeNull();
  });
});
