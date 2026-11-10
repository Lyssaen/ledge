// The IDE's right panel tabs, « Tâches » and « Historique » (lot 12, docs/mockups/ledge-ide-tasks-history.html, cards 2 to 9).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatTurn, Task } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { HistoryPane, RightTabStrip, TasksPane, type ListState } from '../src/chat/RightTabs';
import type { TasksApi } from '../src/tasks/useTasksApi';

const T0 = '2026-11-09T09:12:00.000Z';
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'open', at: T0, updatedAt: T0, log: [{ at: T0, by: 'Ledge', what: 'given to Otto' }], ...extra });
// Oldest first, as the fleet keeps them: the list shows the latest first.
const TASKS = [
  task('t-9', { state: 'refused', owner: 'lu', ownerName: 'Lu', result: 'Not mine.' }),
  task('t-12', { state: 'done', owner: 'pim', ownerName: 'Pim', text: 'Fail first.', result: 'Test added.' }),
  task('t-13', { giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', title: 'Pick the folder' }),
  task('t-14', { state: 'taken' })
];
const api = (tasks: Task[] = TASKS): TasksApi => ({ tasks, seen: vi.fn(), handover: vi.fn(), later: new Map(), near: 0.8, putLater: vi.fn(), answer: vi.fn(() => Promise.resolve(undefined)), answerNote: vi.fn() });

function Tasks({ tasks = TASKS, state = 'ready' as ListState, seen = 0, onShow = vi.fn() as (id: string | null) => void, task: shown = null as string | null }) {
  return <LangProvider lang="en"><TasksPane api={api(tasks)} task={shown} seen={seen} state={state} onShow={onShow} /></LangProvider>;
}
const rows = () => screen.queryAllByRole('button').filter(b => b.classList.contains('rt-trow'));

describe('« Tâches »', () => {
  it('the latest first, a mark each (? a decision awaited, ✓ done, ! refused, ○ open), then « id · from X to Y · state »', () => {
    render(<Tasks />);
    expect(rows().map(r => r.dataset.task)).toEqual(['t-14', 't-13', 't-12', 't-9']);
    expect(rows().map(r => r.querySelector('.mk')!.textContent)).toEqual(['○', '?', '✓', '!']);
    expect(rows()[1]).toHaveTextContent('t-13 · from Nova to Ledge · decision');
    expect(rows()[2]).toHaveTextContent('t-12 · from Ledge to Pim · done');
  });

  it('a click asks for the detail; the detail replaces the list: text, result, its history, « ‹ Tasks » back', () => {
    const onShow = vi.fn();
    const { rerender } = render(<Tasks onShow={onShow} />);
    fireEvent.click(rows()[2]!);
    expect(onShow).toHaveBeenCalledWith('t-12');
    rerender(<Tasks onShow={onShow} task="t-12" />);
    expect(rows()).toHaveLength(0);
    const detail = screen.getByRole('region', { name: 'Task t-12' });
    expect(within(detail).getByRole('heading', { level: 3 })).toHaveTextContent('t-12 · Task t-12');
    expect(detail).toHaveTextContent('from Ledge to Pim · done');
    expect(detail).toHaveTextContent('Fail first.');
    expect(detail).toHaveTextContent('Result : Test added.');
    expect(within(detail).getByRole('listitem')).toHaveTextContent('Ledge : given to Otto');
    fireEvent.click(screen.getByRole('button', { name: '‹ Tasks' }));
    expect(onShow).toHaveBeenLastCalledWith(null);
  });

  it('the filters are kept across a detail, and go back to All / Anyone with a « See » from elsewhere', () => {
    const { rerender } = render(<Tasks />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filters' }), { target: { value: 'closed' } });
    expect(rows().map(r => r.dataset.task)).toEqual(['t-12', 't-9']);
    rerender(<Tasks task="t-12" />);
    rerender(<Tasks />);
    expect(screen.getByRole('combobox', { name: 'Filters' })).toHaveValue('closed');
    rerender(<Tasks seen={1} />);
    expect(screen.getByRole('combobox', { name: 'Filters' })).toHaveValue('all');
    expect(rows()).toHaveLength(4);
  });

  it('empty: « No task. »; filters leaving nothing: said, with « Clear filters »', () => {
    const { unmount } = render(<Tasks tasks={[]} />);
    expect(screen.getByText('No task.')).toBeInTheDocument();
    unmount();
    render(<Tasks tasks={[task('t-1')]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Giver' }), { target: { value: 'decisions' } });
    expect(screen.getByText('No task matches these filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rows()).toHaveLength(1);
  });

  it('before the local daemon\'s first state: « Connecting… » in place of the list; offline: the last list dimmed under a banner, rows still open, Answer off', () => {
    const onShow = vi.fn();
    const { rerender } = render(<Tasks state="connecting" />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the local daemon…');
    expect(rows()).toHaveLength(0);
    rerender(<Tasks state="offline" onShow={onShow} />);
    expect(screen.getByRole('status')).toHaveTextContent('Local daemon offline: this is the last list received.');
    expect(document.querySelector('.rt-list')).toHaveClass('dim');
    fireEvent.click(rows()[0]!);
    expect(onShow).toHaveBeenCalledWith('t-14');
    rerender(<Tasks state="offline" task="t-13" />);
    expect(screen.getByRole('button', { name: 'Answer' })).toBeDisabled();
  });

  it('a decision awaited: its detail says who asks, « Answer » opens the answer form', () => {
    render(<Tasks task="t-13" />);
    expect(screen.getByRole('region', { name: 'Pick the folder' })).toHaveTextContent('Nova');
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(screen.queryByRole('textbox')).toBeInTheDocument();
  });
});

describe('the tab strip', () => {
  it('Conversation · Tasks (its open tasks) · History; a click asks for the tab', () => {
    const onTab = vi.fn();
    render(<LangProvider lang="en"><RightTabStrip tab="tasks" open={3} onTab={onTab} /></LangProvider>);
    expect(screen.getAllByRole('tab').map(x => x.textContent)).toEqual(['Conversation', 'Tasks3', 'History']);
    expect(screen.getByRole('tab', { name: 'Tasks · 3' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(onTab).toHaveBeenCalledWith('history');
  });
});

describe('« Historique »', () => {
  const turn = (qid: string, at: string, question: string): ChatTurn => ({ qid, question, askedAt: at, steps: [] });
  it('the day\'s questions, the latest first, their hour; a click opens it; none: « No conversation today. »', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<LangProvider lang="en"><HistoryPane chat={[turn('q1', '2026-11-09T09:15:00.000Z', 'Launch Codex'), turn('q2', '2026-11-09T13:58:00.000Z', 'Who needs me?')]} state="ready" onOpen={onOpen} /></LangProvider>);
    const qs = screen.getAllByRole('button', { name: /Launch Codex|Who needs me/ });
    expect(qs.map(b => b.querySelector('span')!.textContent)).toEqual(['Who needs me?', 'Launch Codex']);
    fireEvent.click(qs[1]!);
    expect(onOpen).toHaveBeenCalledWith('q1');
    rerender(<LangProvider lang="en"><HistoryPane chat={[]} state="ready" onOpen={onOpen} /></LangProvider>);
    expect(screen.getByText('No conversation today.')).toBeInTheDocument();
  });
});
