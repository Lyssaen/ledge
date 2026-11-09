// The review of lot 8b (review-qa2, 2026-11-09): P1 and P2, after its probes.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { FleetPullRequest } from '@ledge/fleet';
import type { PrDetail } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { PrPage } from '../../src/forge/PrPage';
import { useForge } from '../../src/forge/useForge';

const pr = (headSha: string, pipeline: FleetPullRequest['pipeline'] = 'ok'): FleetPullRequest => ({
  id: 'github.com/o/r#226', forge: 'github', host: 'github.com', repo: 'o/r', number: 226, ref: '#226', url: 'https://github.com/o/r/pull/226',
  title: 'T', state: 'open', branch: 'feat', target: 'main', headSha, pipeline, approvals: { given: 1 }, mergeable: true, openThreads: 0,
  updatedAt: `2026-11-09T10:0${headSha === 'aaaaaaaa' ? 0 : 1}:00.000Z`, sessions: [], machineId: 'local'
});
const detail = (p: FleetPullRequest, blockers: string[] = []): PrDetail => ({
  pr: p, description: 'd', author: 'a', reviewers: [], labels: [], issues: [], jobs: [], threads: [], files: [], commits: [],
  mergeCommand: `gh pr merge 226 --squash --match-head-commit ${p.headSha}`, mergeBlockers: blockers
});
const page = (current: () => FleetPullRequest, blockers: () => string[] = () => []) => {
  const prAct = vi.fn(() => Promise.resolve({ command: '' }));
  const fleet = { prDetail: vi.fn(() => Promise.resolve(detail(current(), blockers()))), prAct } as never;
  const props = { fleet, agent: null, onAskAgent: () => false, onOpenAgent: () => {}, onOpenUrl: () => {}, notify: () => {} };
  const r = render(<LangProvider lang="en"><PrPage pr={current()} {...props} /></LangProvider>);
  return { prAct, again: () => r.rerender(<LangProvider lang="en"><PrPage pr={current()} {...props} /></LangProvider>) };
};
const confirm = () => screen.getByRole('group', { name: 'Merge #226 into main?' });

describe('the merge confirmation while the request moves', () => {
  it('P1: sends the head shown when it opened; a push meanwhile turns it to « Reload », nothing merged', async () => {
    let current = pr('aaaaaaaa');
    const { prAct, again } = page(() => current);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(confirm()).toHaveTextContent('--match-head-commit aaaaaaaa');
    current = pr('bbbbbbbb');
    again();
    await act(async () => {});
    expect(confirm()).toHaveTextContent('The branch moved since you read it (new commit bbbbbbb). Read it again before merging.');
    expect(screen.queryAllByRole('button', { name: 'Merge' }).filter(b => confirm().contains(b))).toHaveLength(0);
    expect(prAct).not.toHaveBeenCalled();
  });

  it('P1: with no push, the head sent is the one shown', async () => {
    const { prAct } = page(() => pr('aaaaaaaa'));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Merge' }).at(-1)!);
    await act(async () => {});
    expect(prAct).toHaveBeenCalledWith('github.com/o/r#226', 'local', { kind: 'merge', headSha: 'aaaaaaaa' });
  });

  it('P2: a condition failing while open turns its Merge off; the review\'s Merge stays as it was (remark)', async () => {
    let current = pr('aaaaaaaa');
    let blockers: string[] = [];
    const { again } = page(() => current, () => blockers);
    await act(async () => {});
    const head = screen.getByRole('button', { name: 'Merge' });
    fireEvent.click(head);
    expect(head).toBeEnabled();
    current = { ...pr('aaaaaaaa', 'fail'), updatedAt: '2026-11-09T10:05:00.000Z' }; blockers = ['pipeline'];
    again();
    await act(async () => {});
    const inConfirm = screen.getAllByRole('button', { name: 'Merge' }).filter(b => confirm().contains(b));
    expect(inConfirm).toHaveLength(1);
    expect(inConfirm[0]).toBeDisabled();
  });
});

it('P2: a reachable machine whose forge.state empties keeps nothing; a machine down keeps its last read, stale', () => {
  let prs: unknown[] = [{ id: 'github.com/o/r#12', machineId: 'srv', ref: '#12' }];
  let forges: unknown[] = [{ forge: 'github', host: 'github.com', status: 'ok', at: '2026-11-09T10:00:00.000Z', machineId: 'srv' }];
  let status: 'open' | 'unreachable' = 'open';
  const cbs = new Set<() => void>();
  const fleet = { prs: () => prs, forges: () => forges, machines: () => [{ id: 'srv', status, daemon: { forge: true } }], onForge: (cb: () => void) => { cbs.add(cb); return () => { cbs.delete(cb); }; } };
  const { result } = renderHook(() => useForge(fleet as never));
  expect(result.current.prs).toHaveLength(1);
  // The session on that branch ends: the daemon, still online, follows nothing.
  act(() => { prs = []; forges = []; cbs.forEach(cb => cb()); });
  expect(result.current.prs).toHaveLength(0);
  // Read again, then the machine falls: the fleet marks it down, then drops its requests; they stay, stale.
  act(() => { prs = [{ id: 'github.com/o/r#12', machineId: 'srv', ref: '#12' }]; cbs.forEach(cb => cb()); });
  act(() => { status = 'unreachable'; prs = []; cbs.forEach(cb => cb()); });
  expect(result.current.prs).toEqual([{ id: 'github.com/o/r#12', machineId: 'srv', ref: '#12', stale: true }]);
});
