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
    expect(screen.getByText('4 bots · 1 waiting for you')).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveStyle({ backgroundColor: 'var(--secondary)', borderLeftColor: 'var(--sidebar-primary)' });
    expect(within(rows[0]!).getByText('Approval')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/started without ledge/)).toBeInTheDocument();
    expect(within(rows[3]!).getByText(/exited 0/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Do not disturb' })); expect(onToggleDnd).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Do not disturb' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' })); expect(onClose).toHaveBeenCalled();
  });
  it('rows cascade with increasing delays', () => {
    render(<SessionList sessions={sessions} visible numbered={false} selectedId={null} dnd={false} onToggleDnd={() => {}} onOpen={() => {}} onClose={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /open/ });
    expect(rows[0]!.style.transition).toContain('0ms');
    expect(rows[0]!.getAttribute('data-delay')).toBe('150');
    expect(rows[3]!.getAttribute('data-delay')).toBe('222');
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
});
