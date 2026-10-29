import { fireEvent, render, screen } from '@testing-library/react';
import type { PhoneChecklist } from '@ledge/protocol';
import { describe, expect, it } from 'vitest';
import { Checklist } from '../../src/screens/Checklist';

type Status = 'pending' | 'in_progress' | 'completed';
const list = (statuses: Status[], extra: Partial<PhoneChecklist> = {}): PhoneChecklist => ({
  tasks: statuses.map((status, i) => ({ text: `Tâche ${i + 1}`, status })),
  done: statuses.filter(s => s === 'completed').length,
  total: statuses.length,
  ...extra
});
const seven = list(['completed', 'completed', 'completed', 'in_progress', 'pending', 'pending', 'pending']);
const head = () => screen.getByRole('button', { name: /Plan de travail/ });

describe('the checklist', () => {
  it('is folded by default: title, count, current task, no list', () => {
    render(<Checklist checklist={seven} />);
    expect(head()).toHaveAttribute('aria-expanded', 'false');
    expect(head()).toHaveTextContent('3/7');
    expect(head()).toHaveTextContent('Tâche 4');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('unfolds to every task with its box, and folds again', () => {
    render(<Checklist checklist={seven} />);
    fireEvent.click(head());
    expect(head()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getAllByRole('img', { name: 'Fait' })).toHaveLength(3);
    expect(screen.getAllByRole('img', { name: 'En cours' })).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'À faire' })).toHaveLength(3);
    fireEvent.click(head());
    expect(head()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('says everything is done when it is', () => {
    render(<Checklist checklist={list(['completed', 'completed'])} />);
    expect(head()).toHaveTextContent('Tout est fait');
  });

  it('says it is paused when nothing is in progress and work remains', () => {
    render(<Checklist checklist={list(['completed', 'pending'])} />);
    expect(head()).toHaveTextContent('En pause');
  });

  it('takes the first task in progress as current', () => {
    render(<Checklist checklist={list(['in_progress', 'in_progress'])} />);
    expect(head()).toHaveTextContent('Tâche 1');
    expect(head()).not.toHaveTextContent('Tâche 2');
  });

  it('says when the list was shortened, only when open', () => {
    render(<Checklist checklist={list(['pending'], { cut: true })} />);
    expect(screen.queryByText('Liste raccourcie : la suite est sur le PC')).not.toBeInTheDocument();
    fireEvent.click(head());
    expect(screen.getByText('Liste raccourcie : la suite est sur le PC')).toBeInTheDocument();
  });

  it('shows repeated texts both', () => {
    render(<Checklist checklist={{ tasks: [{ text: 'Lint', status: 'pending' }, { text: 'Lint', status: 'pending' }], done: 0, total: 2 }} />);
    fireEvent.click(head());
    expect(screen.getAllByText('Lint')).toHaveLength(2);
  });

  it('names the current task past the cap, when the capped list has none in progress', () => {
    // Gateway-style: 60 tasks, 55 done, task 56 in progress; the list holds the first 50 only.
    const capped = list(Array.from({ length: 50 }, () => 'completed' as Status), { done: 55, total: 60, cut: true });
    render(<Checklist checklist={capped} current="Tâche 56" />);
    expect(head()).toHaveTextContent('55/60');
    expect(head()).toHaveTextContent('Tâche 56');
    expect(head()).not.toHaveTextContent('En pause');
  });

  it('prefers a task in progress in the list to the given current', () => {
    render(<Checklist checklist={seven} current="Ailleurs" />);
    expect(head()).toHaveTextContent('Tâche 4');
    expect(head()).not.toHaveTextContent('Ailleurs');
  });
});
