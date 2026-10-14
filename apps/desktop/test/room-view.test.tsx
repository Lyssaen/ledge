import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomView } from '../src/room/RoomView';
import { OfflineNotice } from '../src/shell/OfflineNotice';
import { StatusBar } from '../src/shell/StatusBar';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';

const eight = ['otto', 'nova', 'pim', 'bix', 'luna', 'milo', 'echo', 'rio'].map((n, i) => fakeSession(`${i % 3 === 1 ? 'devbox' : 'local'}:${n}`, { name: n, machineId: i % 3 === 1 ? 'devbox' : 'local', machineName: i % 3 === 1 ? 'Devbox' : 'Local', state: i === 0 ? 'waiting_permission' : 'working', offline: i % 3 === 1 }));

describe('RoomView', () => {
  it('one table for everyone, with the pending count and frozen seats', () => {
    render(<RoomView sessions={eight} grouping="all" selected="local:otto" onSelect={() => {}} onGrouping={() => {}} />);
    const table = screen.getByRole('region', { name: /Whole team/ });
    expect(table).toHaveAttribute('data-participants', '8');
    expect(screen.getByText('1 request waiting')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /nova|luna|rio/ }).every(b => b.dataset.offline === 'true')).toBe(true);
    expect(screen.getByRole('button', { name: /otto/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('by machine makes two tables and a frozen seat still selects', async () => {
    const onSelect = vi.fn();
    render(<RoomView sessions={eight} grouping="machine" selected={null} onSelect={onSelect} onGrouping={() => {}} />);
    expect(screen.getAllByRole('region').map(r => r.getAttribute('data-table'))).toEqual(['local', 'devbox']);
    await userEvent.click(screen.getByRole('button', { name: /nova/ }));
    expect(onSelect).toHaveBeenCalledWith('devbox:nova');
  });
  it('a filter that empties the room says nothing is waiting', () => {
    render(<RoomView sessions={[]} grouping="machine" selected={null} onSelect={() => {}} onGrouping={() => {}} />);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.getByText('No requests waiting.')).toHaveClass('empty-sessions');
  });
  it('changing the select reports the grouping', async () => {
    const onGrouping = vi.fn();
    render(<RoomView sessions={eight} grouping="all" selected={null} onSelect={() => {}} onGrouping={onGrouping} />);
    await userEvent.selectOptions(screen.getByLabelText('Group the tables'), 'jira');
    expect(onGrouping).toHaveBeenCalledWith('jira');
  });
});

describe('OfflineNotice and StatusBar', () => {
  const machines = [{ id: 'local', label: 'Local', status: 'unreachable' }, { id: 'devbox', label: 'Devbox', status: 'unreachable' }, { id: 'edge', label: 'Edge', status: 'connecting' }] as never;
  it('names only unreachable remote machines and offers a retry', async () => {
    const onRetry = vi.fn();
    render(<OfflineNotice machines={machines} onRetry={onRetry} />);
    expect(screen.getByText('Devbox is disconnected')).toBeInTheDocument();
    expect(screen.queryByText(/Local is disconnected/)).toBeNull();
    expect(screen.queryByText(/Edge is disconnected/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('devbox');
  });
  it('the status bar counts sessions and states each machine', () => {
    render(<StatusBar sessions={eight} machines={[{ id: 'local', label: 'Local', status: 'open' }, { id: 'devbox', label: 'Devbox', status: 'unreachable' }] as never} />);
    expect(screen.getByText(/8 sessions/)).toBeInTheDocument();
    expect(screen.getByText('Local connected')).toBeInTheDocument();
    expect(screen.getByText('Devbox unreachable')).toBeInTheDocument();
  });
});
