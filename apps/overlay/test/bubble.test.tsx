import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Bubble } from '../src/surface/Bubble';
import { fakeSession } from './mockDaemon';

const perm = fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', tool: 'Bash', source: 'hook' } });
const q = fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow'], source: 'hook' } });

describe('<Bubble>', () => {
  it('speaks in the bot name and offers Deny/Approve for a permission', () => {
    const onDecide = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={onDecide} onReply={() => {}} />);
    expect(screen.getByText('Otto needs your approval')).toBeInTheDocument();
    expect(screen.getByText(/npm test · harness-assistant/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).toHaveBeenCalledWith('accept');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
  it('offers Later and the first option for a question, and shows +N more', () => {
    const onReply = vi.fn();
    render(<Bubble session={q} moreCount={2} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={onReply} />);
    expect(screen.getByText('Pim has a question')).toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Answer: Backfill' }));
    expect(onReply).toHaveBeenCalledWith('1');
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
  });
  it('clicking the text opens the session', () => {
    const onOpen = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={onOpen} onDecide={() => {}} onReply={() => {}} />);
    fireEvent.click(screen.getByRole('link', { name: /Otto needs your approval/ }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('the timer bar runs when visible and not paused', () => {
    const { container, rerender } = render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toHaveStyle({ width: '0%' });
    rerender(<Bubble session={perm} moreCount={0} visible paused onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'true');
  });
  it('is inert when hidden and re-arms the buttons for a new session', () => {
    const props = { moreCount: 0, paused: false, onOpen: () => {}, onDecide: () => {}, onReply: () => {} };
    const { container, rerender } = render(<Bubble session={perm} visible={false} {...props} />);
    expect(container.firstChild).toHaveAttribute('inert');
    rerender(<Bubble session={perm} visible {...props} />);
    expect(container.firstChild).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    rerender(<Bubble session={fakeSession('c', { state: 'waiting_permission', pending: { kind: 'permission', text: 'ls', tool: 'Bash', source: 'hook' } })} visible {...props} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});
