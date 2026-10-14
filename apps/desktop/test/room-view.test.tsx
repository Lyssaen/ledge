import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomView } from '../src/room/RoomView';
import { OfflineNotice } from '../src/shell/OfflineNotice';
import { StatusBar } from '../src/shell/StatusBar';
import { LangProvider } from '../src/i18n/lang';
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
    expect(screen.getByText('Everyone around a single table.')).toHaveClass('grouping-hint');
  });
  it('a seat: avatar disc, raised hand, name and a coloured state badge', () => {
    render(<RoomView sessions={eight} grouping="all" selected="local:otto" onSelect={() => {}} onGrouping={() => {}} />);
    const otto = screen.getByRole('button', { name: 'otto, Your approval, Local' });
    expect(otto).toHaveClass('seat', 'selected');
    expect(otto.querySelector(':scope > .avatar svg')).not.toBeNull();
    expect(otto.querySelector(':scope > .raised.waiting_permission')).toHaveTextContent('!');
    expect(otto.querySelector(':scope > .person-name')).toHaveTextContent('otto');
    expect(otto.querySelector(':scope > .state.waiting_permission')).toHaveTextContent('Your approval');
    expect(otto.querySelector('.seat-machine')).toBeNull();
    const nova = screen.getByRole('button', { name: 'nova, Machine disconnected, Devbox' });
    expect(nova).toHaveClass('seat', 'offline');
    expect(nova.querySelector('.state.offline')).toHaveTextContent('Disconnected');
    expect(screen.getByRole('button', { name: /pim/ }).querySelector('.state.working')).toHaveTextContent('Working');
  });
  it('by Jira story every seat names its machine, and the hint says the keys are only detected', () => {
    render(<RoomView sessions={eight} grouping="jira" selected={null} onSelect={() => {}} onGrouping={() => {}} />);
    expect(screen.getByText('Keys detected in branches and subjects · no Jira connection.')).toHaveClass('grouping-hint');
    expect([...document.querySelectorAll('.seat')].map(s => s.querySelector('.seat-machine')?.textContent)).toEqual(eight.map(s => s.machineName));
  });
  it('by machine makes two tables and a frozen seat still selects', async () => {
    const onSelect = vi.fn();
    render(<RoomView sessions={eight} grouping="machine" selected={null} onSelect={onSelect} onGrouping={() => {}} />);
    expect(screen.getAllByRole('region').map(r => r.getAttribute('data-table'))).toEqual(['local', 'devbox']);
    expect(screen.getByText('One table per machine, all projects together.')).toHaveClass('grouping-hint');
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
    expect(screen.getByRole('status')).toHaveClass('connection-notice');
    expect(screen.getByText(/Remote sessions show their last known state/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    expect(screen.queryByText(/Local is disconnected/)).toBeNull();
    expect(screen.queryByText(/Edge is disconnected/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('devbox');
  });
  it('the status bar counts sessions and states each machine', () => {
    render(<StatusBar sessions={eight} machines={[{ id: 'local', label: 'Local', status: 'open' }, { id: 'devbox', label: 'Devbox', status: 'unreachable' }] as never} />);
    expect(screen.getByText(/8 sessions/)).toBeInTheDocument();
    expect(screen.getByText('Local connected')).toBeInTheDocument();
    expect(screen.getByText('Devbox disconnected')).toBeInTheDocument();
  });
  it('in French, every machine is feminine, as in the mockup', () => {
    render(<LangProvider lang="fr"><StatusBar sessions={eight} machines={[{ id: 'local', label: 'Local', status: 'open' }, { id: 'devbox', label: 'Devbox', status: 'unreachable' }, { id: 'edge', label: 'Edge', status: 'open' }] as never} /><OfflineNotice machines={[{ id: 'devbox', label: 'Devbox', status: 'unreachable' }] as never} onRetry={() => {}} /></LangProvider>);
    expect(screen.getByText('Local connectée')).toBeInTheDocument();
    expect(screen.getByText('Edge connectée')).toBeInTheDocument();
    expect(screen.getByText('Devbox déconnectée')).toBeInTheDocument();
    expect(screen.getByText('Devbox est déconnectée')).toBeInTheDocument();
    expect(screen.getByText('Les sessions distantes affichent leur dernier état connu. Les échanges reprendront après la reconnexion ; les sessions locales restent disponibles.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toHaveClass('settings-button');
  });
});
