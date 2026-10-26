import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Team } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';

const T0 = '2026-10-26T08:00:00.000Z';
const team: Team = { id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'build', sessionId: 'otto' }], createdAt: T0, updatedAt: T0 };

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

describe('a seat in the sidebar and on its page (atelier rooms spec §3.4, §3.5)', () => {
  it('the tree: the project says its tables, « common table », then the team on one line with its seats and their role', async () => {
    const { d, side } = await boot({ projects: PROJECTS, sessions: [
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'build', roleLabel: 'Build' }),
      fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working' })
    ] });
    d.push({ type: 'teams', teams: [team] });
    const tree = within(side.getByRole('tree'));
    await waitFor(() => expect(tree.getByRole('button', { name: /^ledge-roles/ })).toHaveTextContent(/^ledge-rolesteam$/));
    expect(tree.getByRole('button', { name: /^Ledge/ })).toHaveTextContent('2 tables');
    expect(tree.getByRole('button', { name: 'common table' })).toBeVisible();
    const teamRow = tree.getByRole('button', { name: /^ledge-roles/ }).closest<HTMLElement>('[role="treeitem"]')!;
    const ottoRow = tree.getByRole('button', { name: /^Otto/ }).closest('[role="treeitem"]')!;
    expect(ottoRow).toHaveAttribute('aria-level', '3');
    expect(teamRow.compareDocumentPosition(ottoRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(ottoRow as HTMLElement).getByText('@build')).toBeVisible();
    // No « 0/0 » while Ledge has given the team nothing; its first task shows « 0/1 ».
    expect(teamRow).not.toHaveTextContent(/\d\/\d/);
    d.push({ type: 'task.updated', task: { id: 't5c7e2a', title: 'Relire le candidat', giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', team: 'team-a1b2', state: 'taken', at: T0, updatedAt: T0, log: [] } });
    expect(await within(teamRow).findByRole('progressbar', { name: '0/1 Ledge task' })).toHaveTextContent('0/1');
  });

  it('the page: the team in the breadcrumb, the role pill, the meta line, and the current task pinned above the reply', async () => {
    const { d, user } = await boot({ projects: PROJECTS, sessions: [
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'build', roleLabel: 'Build', model: 'opus', autonomy: 'edits' })
    ] });
    d.push({ type: 'teams', teams: [team] });
    d.push({ type: 'task.updated', task: { id: 't5c7e2a', title: 'Relire le candidat', giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', team: 'team-a1b2', state: 'taken', at: T0, updatedAt: T0, log: [] } });
    // Otto moves to its team's table once the teams are there.
    const table = await screen.findByRole('region', { name: 'Team ledge-roles' });
    await user.click(within(table).getByRole('button', { name: /^Otto,/ }));
    const banner = within(screen.getByRole('banner'));
    expect(banner.getByRole('button', { name: '⚑ ledge-roles' })).toBeVisible();
    expect(banner.getByText('@build')).toBeVisible();
    expect(document.querySelector('.pane-meta')).toHaveTextContent('⚑ ledge-roles · Claude Code · opus · edits without asking');
    const pinned = await screen.findByRole('note', { name: 'Current task' });
    expect(pinned).toHaveTextContent('t5c7e2a · Relire le candidat · given by Ledge · taken');
    await user.click(within(pinned).getByRole('button', { name: 'See the tasks' }));
    expect(await screen.findByRole('region', { name: 'Relire le candidat' })).toBeVisible();
  });
});
