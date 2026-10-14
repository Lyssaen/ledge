import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamView } from '../src/team/TeamView';
import { Heading } from '../src/shell/Heading';
import { DEFAULT_VIEW } from '../src/state/view';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';

const list = [
  fakeSession('local:otto', { name: 'Otto', project: 'ledge', repoId: 'github.com/o/ledge', state: 'waiting_permission', machineId: 'local', machineName: 'Local' }),
  fakeSession('devbox:nova', { name: 'Nova', project: 'ledge', repoId: 'github.com/o/ledge', state: 'working', machineId: 'devbox', machineName: 'Devbox', offline: true }),
  fakeSession('local:luna', { name: 'Luna', project: 'website', cwd: '/w/website', state: 'waiting_input', machineId: 'local', machineName: 'Local' })
];

describe('TeamView', () => {
  it('lists cards by project, marks the selection and the offline one', async () => {
    const onSelect = vi.fn();
    render(<TeamView sessions={list} selected="local:otto" onSelect={onSelect} attentionOnly={false} />);
    expect(screen.getByText('Whole team · 3')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['ledge', 'website']);
    expect(screen.getByRole('button', { name: /Otto/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Nova/ })).toHaveAttribute('data-offline', 'true');
    expect(screen.getByRole('button', { name: /Nova/ }).querySelector('[data-readonly="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Otto/ }).querySelector('[data-readonly="false"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Luna/ }));
    expect(onSelect).toHaveBeenCalledWith('local:luna');
  });
  it('with the filter on, the toolbar says so and only waiting sessions show', () => {
    render(<TeamView sessions={list.filter(s => s.state.startsWith('waiting'))} selected={null} onSelect={() => {}} attentionOnly />);
    expect(screen.getByText('Needs you', { selector: '.toolbar' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /·/ })).toHaveLength(2);
  });
  it('a filter that empties the view says nothing is waiting', () => {
    render(<TeamView sessions={[]} selected={null} onSelect={() => {}} attentionOnly />);
    expect(screen.getByText('No requests waiting.')).toHaveClass('empty-sessions');
    expect(screen.queryByText('Your team starts here')).toBeNull();
  });
});

describe('Heading', () => {
  it('shows the title, the attention count and toggles the view and the filter', async () => {
    const dispatch = vi.fn();
    render(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={dispatch} attentionCount={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Your team, your way.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Meeting' })).toHaveAttribute('aria-pressed', 'false');
    const filter = screen.getByRole('button', { name: /Needs you/ });
    expect(filter).toHaveTextContent('2'); expect(filter).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Meeting' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'view', view: 'room' });
    await userEvent.click(filter);
    expect(dispatch).toHaveBeenCalledWith({ type: 'attention', on: true });
  });
  it('reflects an active filter', () => {
    render(<Heading state={{ ...DEFAULT_VIEW, attentionOnly: true }} dispatch={() => {}} attentionCount={0} />);
    expect(screen.getByRole('button', { name: /Needs you/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
