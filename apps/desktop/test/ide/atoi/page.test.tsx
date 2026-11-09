// The review of the page « À toi » (review-qa2, 2026-11-09): P2 and R2, after its probe.
import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { prsWaitingForYou, type FleetPullRequest } from '@ledge/fleet';
import type { PrDetail } from '@ledge/protocol';
import { LangProvider } from '../../../src/i18n/lang';
import { AtoiPage } from '../../../src/ide/atoi/AtoiPage';

const pr = (o: Partial<FleetPullRequest & { stale: boolean }> = {}) => ({
  id: 'github.com/o/r#225', forge: 'github', host: 'github.com', repo: 'o/r', number: 225, ref: '#225', url: 'https://github.com/o/r/pull/225', title: 'T',
  state: 'open', branch: 'b', target: 'main', headSha: 'aaaaaaaa', pipeline: 'ok', approvals: { given: 1 }, mergeable: true, openThreads: 0,
  updatedAt: '2026-11-09T10:00:00.000Z', sessions: [], machineId: 'srv', ...o
}) as FleetPullRequest & { stale?: boolean };
const detail = (blockers: string[]): PrDetail => ({ pr: pr(), description: '', author: '', reviewers: [], labels: [], issues: [], jobs: [], threads: [], files: [], commits: [], mergeCommand: 'gh pr merge 225 --squash --match-head-commit aaaaaaaa', mergeBlockers: blockers });
const show = (prs: ReturnType<typeof pr>[], fleet: object) => render(<LangProvider lang="en"><AtoiPage waiting={[]} sessions={[]} where={() => ''} onOpen={() => {}} onDecide={() => {}} onAnswer={() => {}}
  prs={prsWaitingForYou(prs)} agentOf={() => ({ name: 'Tom' })} onOpenPr={() => {}} onAskFix={() => {}} fleet={fleet as never} machineLabel={id => (id === 'srv' ? 'srv-build' : id)} notify={() => {}} /></LangProvider>);

it('P2: a request of a fallen machine is dimmed, its actions off with the reason, as in its tab', async () => {
  const fleet = { prDetail: vi.fn(), prAct: vi.fn() };
  show([pr({ stale: true }), pr({ id: 'x', ref: '!41', pipeline: 'fail', stale: true })], fleet);
  const merge = screen.getByRole('button', { name: 'Merge' });
  expect(merge).toBeDisabled();
  expect(merge).toHaveAttribute('title', 'srv-build is offline');
  expect(screen.getByRole('button', { name: 'Ask Tom to fix it' })).toBeDisabled();
  fireEvent.click(merge);
  expect(fleet.prDetail).not.toHaveBeenCalled();
});

it('P2: the detail read at the click refuses the merge: its confirmation\'s Merge is off; R2: the row\'s stays as it was', async () => {
  const fleet = { prDetail: vi.fn(() => Promise.resolve(detail(['pipeline_not_started']))), prAct: vi.fn() };
  show([pr()], fleet);
  const row = screen.getByRole('button', { name: 'Merge' });
  fireEvent.click(row);
  await act(async () => {});
  const group = screen.getByRole('group', { name: 'Merge #225 into main?' });
  const inside = screen.getAllByRole('button', { name: 'Merge' }).filter(b => group.contains(b));
  expect(inside[0]).toBeDisabled();
  expect(row).toBeEnabled();
  fireEvent.click(row);
  expect(fleet.prDetail).toHaveBeenCalledTimes(1);
});

it('a repository without any CI (design-ux, 2026-11-09): « no CI, approved », a grey dot, « Merge » kept', () => {
  show([pr({ pipeline: 'none' })], { prDetail: vi.fn(), prAct: vi.fn() });
  expect(screen.getByText(/no CI, approved/)).toBeInTheDocument();
  expect(document.querySelector('.atoi-pr .fg-dot')!.className).toBe('fg-dot none');
  expect(screen.getByRole('button', { name: 'Merge' })).toBeEnabled();
});
