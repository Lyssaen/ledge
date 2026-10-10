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
    expect((container.querySelector('[data-timer]') as HTMLElement).style.animation).toContain('ledge-drain 4000ms linear');
    rerender(<Bubble session={perm} moreCount={0} visible paused onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'true');
  });
  it('the bar drains the controller remainder, holds it while paused, and restarts per request rather than per session', () => {
    const base = { moreCount: 0, visible: true, onOpen: () => {}, onDecide: () => {}, onReply: () => {} };
    const { container, rerender } = render(<Bubble {...base} session={perm} paused={false} remainingMs={4000} />);
    const bar = () => container.querySelector('[data-timer]') as HTMLElement;
    const first = bar();
    rerender(<Bubble {...base} session={perm} paused remainingMs={2500} />);
    expect(bar()).toHaveAttribute('data-remaining', '2500');
    expect(bar()).toHaveStyle({ width: '62.5%' });
    expect(bar().style.animation).toBe('none');
    rerender(<Bubble {...base} session={perm} paused={false} remainingMs={2500} />);
    expect(bar().style.animation).toContain('ledge-drain 2500ms linear');
    expect(bar().style.getPropertyValue('--ledge-from')).toBe('62.5%');
    // An unrelated re-render while running keeps the same segment (no restart from a later snapshot).
    const running = bar();
    rerender(<Bubble {...base} session={perm} paused={false} remainingMs={1200} />);
    expect(bar()).toBe(running);
    expect(bar()).toHaveAttribute('data-remaining', '2500');
    // Same session, a new request: a fresh segment.
    rerender(<Bubble {...base} session={{ ...perm, pending: { ...perm.pending!, text: 'npm run build' } }} paused={false} remainingMs={4000} />);
    expect(bar()).not.toBe(running);
    expect(bar()).not.toBe(first);
    expect(bar()).toHaveAttribute('data-remaining', '4000');
  });
  it('an acknowledgement locks the actions and holds the bar; a failure unlocks them and says why; no success is invented', () => {
    const base = { moreCount: 0, visible: true, paused: false, onOpen: () => {}, onDecide: () => {}, onReply: () => {} };
    const { container, rerender } = render(<Bubble {...base} session={perm} ack="pending" />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(container.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Sent, waiting for the terminal');
    rerender(<Bubble {...base} session={perm} ack="failed" failure="nothing to decide" />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('nothing to decide. Try again or open the session.');
    expect(container.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'false'); // the retry clock drains again
    expect(screen.queryByText('Received')).toBeNull();
  });
  it('offline or read-only: both actions are disabled and the reason shows', () => {
    const onDecide = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} blocked="Offline: reconnecting to the daemon" frozen onOpen={() => {}} onDecide={onDecide} onReply={() => {}} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(screen.getByText('Offline: reconnecting to the daemon')).toBeInTheDocument();
    expect(document.querySelector('svg.bot')).toHaveAttribute('data-frozen', 'true');
  });
  it('blocked: a question keeps Later (it only opens the session) but not the answer', () => {
    const onOpen = vi.fn();
    render(<Bubble session={q} moreCount={0} visible paused={false} blocked="Read only: started without Ledge, answer in its terminal" onOpen={onOpen} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByRole('button', { name: 'Answer: Backfill' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(onOpen).toHaveBeenCalled();
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
  it('a finished notice speaks in the bot name, shows the work time and the project, and offers OK and Open', () => {
    const onOpen = vi.fn(); const onDismiss = vi.fn();
    const idle = fakeSession('a', { state: 'idle' });
    render(<Bubble session={idle} kind="finished" elapsedMs={160_000} moreCount={0} visible paused={false} onOpen={onOpen} onDismiss={onDismiss} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByText('Otto finished')).toBeInTheDocument();
    expect(screen.getByText('2m 40s of work · harness-assistant')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalled();
    expect(document.querySelector('[data-timer]')).toHaveAttribute('data-remaining', '6000');
  });
  it('a finished notice without a known work time shows the project alone', () => {
    render(<Bubble session={fakeSession('a', { state: 'idle' })} kind="finished" moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByText('harness-assistant')).toBeInTheDocument();
  });
});
