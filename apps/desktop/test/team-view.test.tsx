import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamView } from '../src/team/TeamView';
import { Heading } from '../src/shell/Heading';
import { DEFAULT_VIEW } from '../src/state/view';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';

const list = [
  fakeSession('local:otto', { name: 'Otto', project: 'ledge', repoId: 'github.com/o/ledge', state: 'waiting_permission', machineId: 'local', machineName: 'Local', topic: 'Prepare the release', pending: { kind: 'permission', text: 'Allow the build command?', source: 'hook' } }),
  fakeSession('devbox:nova', { name: 'Nova', tool: 'codex', project: 'ledge', repoId: 'github.com/o/ledge', state: 'working', machineId: 'devbox', machineName: 'Devbox', offline: true, topic: 'Harden the SSH link' }),
  fakeSession('local:luna', { name: 'Luna', project: 'website', cwd: '/w/website', state: 'waiting_input', machineId: 'local', machineName: 'Local' })
];

describe('TeamView', () => {
  it('lists cards by project, marks the selection and the offline one', async () => {
    const onSelect = vi.fn();
    render(<TeamView sessions={list} selected="local:otto" onSelect={onSelect} attentionOnly={false} />);
    expect(document.querySelector('.toolbar > span:first-child')).toHaveTextContent('All participants · 3');
    expect(document.querySelector('.toolbar > .right')).toHaveTextContent('By project');
    // the mockup's section label: project dot, project, rule, participant count
    const labels = [...document.querySelectorAll('.section-label')];
    expect(labels.map(l => l.querySelector('b')?.textContent)).toEqual(['ledge', 'website']);
    expect(labels.map(l => l.textContent)).toEqual(['ledge2 PARTICIPANTS', 'website1 PARTICIPANT']);
    expect(labels.map(l => l.className)).toEqual(['section-label', 'section-label second-project']);
    expect(labels[0]!.querySelector('.project-dot.project-primary')).not.toBeNull();
    expect(labels[1]!.querySelector('.project-dot.project-secondary')).not.toBeNull();
    // the card: topic first (the project when there is none), then the person, the request, the machine
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Prepare the release', 'Harden the SSH link', 'website']);
    const otto = screen.getByRole('button', { name: 'Prepare the release, Otto, Your approval, Allow the build command?, Local' });
    expect(otto).toHaveAttribute('aria-pressed', 'true'); expect(otto).toHaveClass('session-card', 'selected');
    expect(otto.querySelector('.card-person > .avatar svg')).not.toBeNull();
    expect(otto.querySelector('.card-identity .person-name')).toHaveTextContent('Otto');
    expect(otto.querySelector('.card-identity .person-tool')).toHaveTextContent('Claude Code');
    expect(otto.querySelector('.card-person > .state.waiting_permission')).toHaveTextContent('Your approval');
    expect(otto.querySelector('p.card-request.waiting_permission')).toHaveTextContent('Allow the build command?');
    expect(otto.querySelector('.card-foot .dot.green')).not.toBeNull();
    expect(otto.querySelector('.card-foot span')).toHaveTextContent('Local');
    const nova = screen.getByRole('button', { name: 'Harden the SSH link, Nova, Machine disconnected, Devbox' });
    expect(nova).toHaveAttribute('data-offline', 'true'); expect(nova).toHaveClass('session-card', 'offline');
    expect(nova.querySelector('.person-tool')).toHaveTextContent('Codex');
    expect(nova.querySelector('.state.offline')).toHaveTextContent('Disconnected');
    expect(nova.querySelector('.card-request')).toBeNull();
    expect(nova.querySelector('.card-foot .dot.offline-dot')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Luna/ }).querySelector('.state.waiting_input')).toHaveTextContent('A question');
    expect(screen.getByRole('button', { name: /Nova/ }).querySelector('[data-readonly="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Otto/ }).querySelector('[data-readonly="false"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Luna/ }));
    expect(onSelect).toHaveBeenCalledWith('local:luna');
  });
  it('with the filter on, the toolbar says so and only waiting sessions show', () => {
    render(<TeamView sessions={list.filter(s => s.state.startsWith('waiting'))} selected={null} onSelect={() => {}} attentionOnly />);
    expect(document.querySelector('.toolbar > span:first-child')).toHaveTextContent('Needs you · 2');
    expect(document.querySelectorAll('.session-card')).toHaveLength(2);
  });
  it('a filter that empties the view says nothing is waiting', () => {
    render(<TeamView sessions={[]} selected={null} onSelect={() => {}} attentionOnly />);
    expect(screen.getByText('No requests waiting.')).toHaveClass('empty-sessions');
    expect(screen.queryByText('Your team starts here')).toBeNull();
  });
});

describe('Heading', () => {
  it('Talk to Ledge sits before New session and says when the chat is open', async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={vi.fn()} attentionCount={0} chat={{ open: false, onOpen }} />);
    const trigger = screen.getByRole('button', { name: 'Talk to Ledge' });
    expect(trigger).toHaveAttribute('data-open-ledge', 'heading');
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    expect(trigger.nextElementSibling).toHaveTextContent('New session');
    await userEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
    rerender(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={vi.fn()} attentionCount={0} chat={{ open: true, onOpen }} />);
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('shows the title, the attention count and toggles the view and the filter', async () => {
    const dispatch = vi.fn();
    render(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={dispatch} attentionCount={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'The team' })).toBeInTheDocument();
    expect(document.querySelector('.view-heading p')).toHaveTextContent('What everyone is doing, and what is waiting for your answer.');
    expect(screen.getByRole('group', { name: 'Session view' })).toHaveClass('view-toggle');
    expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Team' }).querySelector('span[aria-hidden="true"]')).toHaveTextContent('▦');
    expect(screen.getByRole('button', { name: 'Meeting' }).querySelector('span[aria-hidden="true"]')).toHaveTextContent('◯');
    expect(screen.getByRole('button', { name: 'Meeting' })).toHaveAttribute('aria-pressed', 'false');
    const filter = screen.getByRole('button', { name: /Needs you/ });
    expect(filter).toHaveClass('attention-filter'); expect(filter.querySelector('.attention-count')).toHaveTextContent('2');
    expect(filter).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New session' }).querySelector('.plus')).toHaveTextContent('+');
    await userEvent.click(screen.getByRole('button', { name: 'Meeting' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'view', view: 'room' });
    await userEvent.click(filter);
    expect(dispatch).toHaveBeenCalledWith({ type: 'attention', on: true });
  });

  it('New session opens the launch screen when the Shell allows it', async () => {
    const onNewSession = vi.fn();
    render(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={vi.fn()} attentionCount={0} onNewSession={onNewSession} />);
    const button = screen.getByRole('button', { name: 'New session' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('data-open-launch', 'heading');
    await userEvent.click(button);
    expect(onNewSession).toHaveBeenCalledOnce();
  });
  it('reflects an active filter, and the room has its own title', () => {
    render(<Heading state={{ ...DEFAULT_VIEW, attentionOnly: true }} dispatch={() => {}} attentionCount={0} />);
    expect(screen.getByRole('button', { name: /Needs you/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'The meeting room' })).toBeInTheDocument();
    expect(document.querySelector('.view-heading p')).toHaveTextContent('Tables by machine or by story, with the same sessions.');
  });
});
