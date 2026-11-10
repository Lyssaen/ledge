// « À toi » completed with what « Le point » showed (lot 12, docs/mockups/ledge-ide-tasks-history.html, cards 10 to 13).
import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import type { HumanAsk, HumanChannel, Session, Task } from '@ledge/protocol';
import { LangProvider } from '../../../src/i18n/lang';
import { AtoiPage, type AtoiPageProps } from '../../../src/ide/atoi/AtoiPage';
import type { TasksApi } from '../../../src/tasks/useTasksApi';

const T0 = '2026-11-09T09:12:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'open', at: T0, updatedAt: T0, log: [], ...extra });
const api = (tasks: Task[]): TasksApi => ({ tasks, seen: vi.fn(), handover: vi.fn(), later: new Map(), near: 0.8, putLater: vi.fn(), answer: vi.fn(() => Promise.resolve(undefined)), answerNote: vi.fn() });
const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: id, tool: 'claude', cwd: '/w', state: 'idle', startedAt: T0, updatedAt: T0, ...extra } as Session);
const ask = (id: string, o: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: `Ask ${id}`, body: 'The body.', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q1', question: 'Merge?', options: [{ id: 'now', label: 'Merge now', recommended: true }, { id: 'wait', label: 'Wait', recommended: false }], answer: null }],
  createdAt: T0, updatedAt: T0, ...o
});
const ready: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };
const asks = (list: HumanAsk[], o: Partial<OpenRigAsksView> = {}): OpenRigAsksView => ({ channel: ready, asks: list, truncated: false, partial: false, answer: vi.fn(), ...o } as OpenRigAsksView);

const show = (p: Partial<AtoiPageProps>) => render(<LangProvider lang="en"><AtoiPage waiting={[]} sessions={[]} where={() => ''} onOpen={() => {}} onDecide={() => {}} onAnswer={() => {}}
  prs={[]} agentOf={() => null} onOpenPr={() => {}} onAskFix={() => {}} fleet={{} as never} machineLabel={id => id} notify={() => {}} {...p} /></LangProvider>);
const block = (name: string) => document.querySelector(`[data-block="${name}"]`) as HTMLElement | null;

it('the added blocks show only when they have something: nothing asked, no Decisions, Rigs or Context block', () => {
  show({ tasks: api([task('t-1')]), asks: asks([]) });
  expect(block('decisions')).toBeNull();
  expect(block('rigs')).toBeNull();
  expect(block('near')).toBeNull();
});

it('Decisions: who asks and the title, « Answer » unfolds the form under it', () => {
  show({ tasks: api([task('t-13', { giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', title: 'Pick the folder' })]) });
  const b = block('decisions')!;
  expect(b).toHaveTextContent('Decisions1 · what sessions ask you through Ledge');
  expect(b).toHaveTextContent('Nova Pick the folder');
  fireEvent.click(within(b).getByRole('button', { name: 'Answer' }));
  expect(within(b).getByRole('textbox')).toBeInTheDocument();
});

it('Context nearly full: « Hand over » and « Later »; a failed relief: « Retry » only', () => {
  const onHandover = vi.fn(); const onLater = vi.fn();
  const otto = session('otto', { name: 'Otto', context: { used: 82, window: 100 } } as Partial<Session>);
  const lu = session('lu', { name: 'Lu', context: { used: 90, window: 100 }, handover: { state: 'failed', reason: 'no brief' } } as Partial<Session>);
  show({ sessions: [otto, lu], tasks: api([]), onHandover, onLater });
  const b = block('near')!;
  expect(b).toHaveTextContent('Context nearly full2');
  const line = b.querySelector('[data-near="otto"]') as HTMLElement;
  expect(line).toHaveTextContent('Otto · context 82 %');
  fireEvent.click(within(line).getByRole('button', { name: 'Hand over' }));
  expect(onHandover).toHaveBeenCalledWith('otto');
  fireEvent.click(within(line).getByRole('button', { name: 'Later' }));
  expect(onLater).toHaveBeenCalledWith(otto);
  const failed = b.querySelector('[data-near="lu"]') as HTMLElement;
  expect(within(failed).getAllByRole('button').map(x => x.textContent)).toEqual(['Retry']);
});

it('the closed tasks Ledge gave join « Finished since your last visit », with See and Dismiss', () => {
  const onSeeTask = vi.fn();
  const tasks = api([task('t-12', { state: 'done', ownerName: 'Pim', title: 'Write the test' }), task('t-9', { state: 'refused', ownerName: 'Lu', title: 'Migrate' }), task('t-8', { state: 'done', seen: true })]);
  show({ tasks, onSeeTask });
  const fin = screen.getByText('Finished since your last visit').closest('.fg-blk') as HTMLElement;
  expect(fin.querySelector('.fg-blk-h')).toHaveTextContent('2');
  const done = fin.querySelector('[data-task="t-12"]') as HTMLElement;
  expect(done).toHaveTextContent('✓Pim finished “Write the test” · Ledge’s task');
  expect(fin.querySelector('[data-task="t-9"]')).toHaveTextContent('!Lu refused “Migrate”');
  expect(fin.querySelector('[data-task="t-8"]')).toBeNull();
  fireEvent.click(within(done).getByRole('button', { name: 'See' }));
  expect(onSeeTask).toHaveBeenCalledWith('t-12');
  fireEvent.click(within(done).getByRole('button', { name: 'Dismiss' }));
  expect(tasks.seen).toHaveBeenCalledWith('t-12');
});

it('« Summarise the day » at the top asks; off while it cannot be asked', () => {
  const onSummarize = vi.fn();
  const { rerender } = show({ onSummarize });
  fireEvent.click(screen.getByRole('button', { name: 'Summarise the day' }));
  expect(onSummarize).toHaveBeenCalledTimes(1);
  rerender(<LangProvider lang="en"><AtoiPage waiting={[]} sessions={[]} where={() => ''} onOpen={() => {}} onDecide={() => {}} onAnswer={() => {}}
    prs={[]} agentOf={() => null} onOpenPr={() => {}} onAskFix={() => {}} fleet={{} as never} machineLabel={id => id} notify={() => {}} onSummarize={onSummarize} summarizeOff /></LangProvider>);
  expect(screen.getByRole('button', { name: 'Summarise the day' })).toBeDisabled();
});

it('Rigs: a line each; « Open » unfolds the whole card under it, one at a time, « Fold » folds it', () => {
  show({ asks: asks([ask('a1', { priority: 'urgent' }), ask('a2', { questions: [] })]) });
  const b = block('rigs')!;
  expect(b.querySelector('.fg-blk-h')).toHaveTextContent('OpenRig rigs2 · what the rigs ask you');
  const l1 = b.querySelector('[data-ask="a1"]') as HTMLElement;
  expect(l1.querySelector('.atoi-line')).toHaveTextContent('urgentdecisionpilot · ledge-dev — Ask a1Open');
  expect(b.querySelector('[data-ask="a2"] .atoi-line')).toHaveTextContent('question');
  fireEvent.click(within(l1).getByRole('button', { name: 'Open' }));
  expect(l1.querySelector('.atoi-askc')).not.toBeNull();
  const l2 = b.querySelector('[data-ask="a2"]') as HTMLElement;
  fireEvent.click(within(l2).getByRole('button', { name: 'Open' }));
  expect(l1.querySelector('.atoi-askc')).toBeNull();
  expect(l2.querySelector('.atoi-askc')).not.toBeNull();
  fireEvent.click(within(l2).getByRole('button', { name: 'Fold' }));
  expect(b.querySelector('.atoi-askc')).toBeNull();
});

it('Rigs: the sidebar\'s « See » unfolds that card, ringed a moment', async () => {
  vi.useFakeTimers();
  try {
    show({ asks: asks([ask('a1'), ask('a2')]), askFocus: { id: 'a2', n: 1 } });
    const card = document.querySelector('[data-ask="a2"] .atoi-askc') as HTMLElement;
    expect(card).toHaveClass('lit');
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(card).not.toHaveClass('lit');
    expect(document.querySelector('[data-ask="a1"] .atoi-askc')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('Rigs: shown without a request when the rigs cannot write (the channel\'s banner), and with the partial line', () => {
  const { unmount } = show({ asks: asks([], { channel: { state: 'openrig_stopped' } as HumanChannel }) });
  expect(block('rigs')).not.toBeNull();
  expect(block('rigs')!.querySelector('[data-channel="openrig_stopped"]')).not.toBeNull();
  unmount();
  show({ asks: asks([ask('a1')], { partial: true }) });
  expect(block('rigs')!.querySelector('.atoi-partial')).not.toBeNull();
});
