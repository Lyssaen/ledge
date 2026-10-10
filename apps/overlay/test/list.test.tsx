import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SessionList, rowHint } from '../src/surface/SessionList';
import { fakeSession } from './mockDaemon';

const sessions = [
  fakeSession('a', { state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }),
  fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z' }),
  fakeSession('c', { name: 'Bix', source: 'hook_only', tmuxSession: null, startedAt: '2026-10-09T18:02:00.000Z' }),
  fakeSession('d', { name: 'Lu', state: 'exited', exitCode: 0, startedAt: '2026-10-09T18:03:00.000Z' })
];

describe('<SessionList>', () => {
  it('shows counts, rows with badges, and highlights the oldest ask', () => {
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.getByText('4 sessions · 1 waiting for you')).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveStyle({ backgroundColor: 'var(--secondary)', borderLeftColor: 'var(--sidebar-primary)' });
    expect(within(rows[0]!).getByText('Approval')).toBeInTheDocument();
    // The secondary line is "Name · Tool · age" only; the badge carries the state.
    expect(within(rows[1]!).getByText(/^Pim · Codex · /)).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Read only')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Done')).toBeInTheDocument();
  });
  it('numbers rows when opened from the keyboard', () => {
    render(<SessionList sessions={sessions} visible numbered selectedId="b" dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /speos-api/ })).toHaveAttribute('aria-current', 'true');
  });
  it('clicks open a row, toggle dnd and collapse', () => {
    const onOpen = vi.fn(), onToggleDnd = vi.fn(), onClose = vi.fn();
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd onToggleDnd={onToggleDnd} onOpen={onOpen} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /speos-api/ })); expect(onOpen).toHaveBeenCalledWith('b');
    // Do not disturb is both the header icon and the footer text toggle, as in the mockup.
    const dnd = screen.getAllByRole('button', { name: 'Do not disturb' });
    expect(dnd).toHaveLength(2);
    fireEvent.click(dnd[1]!); expect(onToggleDnd).toHaveBeenCalled();
    for (const b of dnd) expect(b).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' })); expect(onClose).toHaveBeenCalled();
  });
  it('rows cascade with increasing delays', () => {
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows[0]!.style.transition).toContain('0ms');
    expect(rows[0]!.getAttribute('data-delay')).toBe('150');
    expect(rows[3]!.getAttribute('data-delay')).toBe('222');
  });
  it('the cascade follows the layer\'s own entry delay', () => {
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} enterDelay={280} />);
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows[0]!.getAttribute('data-delay')).toBe('310');
    expect(rows[3]!.getAttribute('data-delay')).toBe('382');
  });
});

describe('rowHint', () => {
  it('matches the badge: idle reads available, working reads running; pending, read-only, exited and error keep theirs', () => {
    expect(rowHint(fakeSession('i', { state: 'idle' }))).toBe('available');
    expect(rowHint(fakeSession('w', { state: 'working' }))).toBe('running');
    expect(rowHint(sessions[0]!)).toBe('npm test');
    expect(rowHint(sessions[2]!)).toBe('started without ledge');
    expect(rowHint(sessions[3]!)).toBe('exited 0');
    expect(rowHint(fakeSession('e', { state: 'error', lastError: 'boom' }))).toBe('boom');
  });
  describe('remove from list', () => {
    const props = { visible: true, numbered: false, selectedId: null, dnd: false, onToggleDnd: () => {}, onClose: () => {} };
    it('only finished and read-only rows carry the button; it dismisses without opening the row', () => {
      const onOpen = vi.fn(); const onDismiss = vi.fn();
      render(<SessionList {...props} sessions={sessions} onOpen={onOpen} onDismiss={onDismiss} />);
      const buttons = screen.getAllByRole('button', { name: /^Remove from list/ });
      expect(buttons.map(b => b.closest('[data-row-id]')!.getAttribute('data-row-id'))).toEqual(['c', 'd']);
      expect(buttons[1]).toHaveAccessibleName(`Remove from list: ${sessions[3]!.project}, Lu`);
      expect(buttons[1]).toHaveAttribute('title', 'Remove from list');
      // A real button, reachable with the keyboard, outside the row's open button.
      expect(buttons[1]!.tagName).toBe('BUTTON'); expect(buttons[1]).not.toHaveAttribute('tabindex', '-1');
      expect(buttons[1]!.closest('button[data-row]')).toBeNull();
      fireEvent.click(buttons[1]!);
      expect(onDismiss).toHaveBeenCalledWith('d'); expect(onOpen).not.toHaveBeenCalled();
    });
    it('is disabled offline, and absent without a handler', () => {
      const { rerender } = render(<SessionList {...props} sessions={sessions} onOpen={() => {}} onDismiss={() => {}} offline />);
      for (const b of screen.getAllByRole('button', { name: /^Remove from list/ })) expect(b).toBeDisabled();
      rerender(<SessionList {...props} sessions={sessions} onOpen={() => {}} />);
      expect(screen.queryAllByRole('button', { name: /^Remove from list/ })).toHaveLength(0);
    });
  });
});
