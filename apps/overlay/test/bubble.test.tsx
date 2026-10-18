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
  it('offers the choices and a short answer for a question, and shows +N more', () => {
    const onReply = vi.fn();
    const onDismiss = vi.fn();
    render(<Bubble session={q} moreCount={2} visible paused={false} onOpen={() => {}} onDismiss={onDismiss} onDecide={() => {}} onReply={onReply} />);
    expect(screen.getByText('Pim has a question')).toBeInTheDocument();
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Later, next/ }));
    expect(onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /Backfill/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith('Backfill');
  });
  it('Open in Ledge is a button, not the title', () => {
    const onOpen = vi.fn();
    render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={onOpen} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.queryByRole('link', { name: /Otto needs your approval/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open in Ledge/ }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('an ask has no timer; a notice drains for 6 s unless paused', () => {
    const { container, rerender } = render(<Bubble session={perm} moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toBeNull();
    const idle = fakeSession('a', { state: 'idle' });
    rerender(<Bubble session={idle} kind="finished" moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect((container.querySelector('[data-timer]') as HTMLElement).style.animation).toContain('ledge-drain 6000ms linear');
    rerender(<Bubble session={idle} kind="finished" moreCount={0} visible paused onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(container.querySelector('[data-timer]')).toHaveAttribute('data-paused', 'true');
  });
  it('the bar drains the controller remainder, holds it while paused, and restarts per notice rather than per session', () => {
    const idle = fakeSession('a', { state: 'idle' });
    const base = { moreCount: 0, visible: true, kind: 'finished' as const, onOpen: () => {}, onDecide: () => {}, onReply: () => {} };
    const { container, rerender } = render(<Bubble {...base} session={idle} paused={false} remainingMs={6000} />);
    const bar = () => container.querySelector('[data-timer]') as HTMLElement;
    const first = bar();
    rerender(<Bubble {...base} session={perm} paused remainingMs={2500} />);
    expect(bar()).toHaveAttribute('data-remaining', '2500');
    expect(parseFloat(bar().style.width)).toBeCloseTo((2500 / 6000) * 100, 5);
    expect(bar().style.animation).toBe('none');
    rerender(<Bubble {...base} session={idle} paused={false} remainingMs={2500} />);
    expect(bar().style.animation).toContain('ledge-drain 2500ms linear');
    expect(parseFloat(bar().style.getPropertyValue('--ledge-from'))).toBeCloseTo((2500 / 6000) * 100, 5);
    const running = bar();
    rerender(<Bubble {...base} session={idle} paused={false} remainingMs={1200} />);
    expect(bar()).toBe(running);
    expect(bar()).toHaveAttribute('data-remaining', '2500');
    rerender(<Bubble {...base} session={fakeSession('c', { state: 'idle' })} paused={false} remainingMs={6000} />);
    expect(bar()).not.toBe(running);
    expect(bar()).not.toBe(first);
    expect(bar()).toHaveAttribute('data-remaining', '6000');
  });
  it('an acknowledgement locks the actions; a failure unlocks them and says why; no success is invented', () => {
    const base = { moreCount: 0, visible: true, paused: false, onOpen: () => {}, onDecide: () => {}, onReply: () => {} };
    const { rerender } = render(<Bubble {...base} session={perm} ack="pending" />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Sent, waiting for the terminal');
    rerender(<Bubble {...base} session={perm} ack="failed" failure="nothing to decide" />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('nothing to decide. Try again or open the session.');
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
  it('blocked: a question can be set aside, and its answer stays disabled', () => {
    const onDismiss = vi.fn();
    render(<Bubble session={q} moreCount={0} visible paused={false} blocked="Read only: started without Ledge, answer in its terminal" onOpen={() => {}} onDismiss={onDismiss} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Later/ }));
    expect(onDismiss).toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole('button', { name: 'Open in Ledge' }));
    expect(onOpen).toHaveBeenCalled();
    expect(document.querySelector('[data-timer]')).toHaveAttribute('data-remaining', '6000');
  });
  it('a finished notice without a known work time shows the project alone', () => {
    render(<Bubble session={fakeSession('a', { state: 'idle' })} kind="finished" moreCount={0} visible paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByText('harness-assistant')).toBeInTheDocument();
  });
  it('a finished bubble survives its session being removed from under it', () => {
    expect(() => render(<Bubble session={null} kind="finished" moreCount={0} visible={false} paused={false} onOpen={() => {}} onDecide={() => {}} onReply={() => {}} />)).not.toThrow();
  });
  it('a Ledge finish (no session) speaks in its name, shows the answer, and offers OK and Open', () => {
    const onOpen = vi.fn(); const onDismiss = vi.fn();
    render(<Bubble session={null} kind="finished" preview="Deux bots travaillent." elapsedMs={80_000} moreCount={0} visible paused={false} onOpen={onOpen} onDismiss={onDismiss} onDecide={() => {}} onReply={() => {}} />);
    expect(screen.getByText('Ledge finished')).toBeInTheDocument();
    expect(screen.getByText('Deux bots travaillent.')).toBeInTheDocument();
    expect(document.querySelector('svg.resident')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Ledge' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
