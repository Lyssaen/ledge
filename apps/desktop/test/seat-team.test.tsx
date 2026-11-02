import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Team } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { teamRoomFilter } from '../src/rigs/engine';

const T0 = '2026-10-26T08:00:00.000Z';
const team: Team = { id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'build', sessionId: 'otto' }], createdAt: T0, updatedAt: T0 };

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

describe('a seat in the sidebar and on its page (atelier rooms spec §3.4, §3.5; lot F)', () => {
  it('the tree: no team row any more (lot F, the team is a row of the Teams section); a seat not in a room yet keeps its role pill', async () => {
    const { d, side } = await boot({ projects: PROJECTS, sessions: [
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'build', roleLabel: 'Build' }),
      fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working' })
    ] });
    d.push({ type: 'teams', teams: [team] });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    // No projected rig for the team (yet): Otto stays in its project, as a session of its own, with its @role.
    const ottoRow = (await tree.findByRole('button', { name: /^Otto/ })).closest<HTMLElement>('[role="treeitem"]')!;
    expect(ottoRow).toHaveAttribute('aria-level', '2');
    expect(within(ottoRow).getByText('@build')).toBeVisible();
    expect(tree.getByRole('button', { name: /^Pim/ })).toBeVisible();
    expect(tree.queryByRole('button', { name: /^ledge-roles/ })).toBeNull();
    expect(tree.queryByRole('button', { name: 'common table' })).toBeNull();
    expect(tree.getByRole('button', { name: /^Ledge/ })).not.toHaveTextContent('tables');
  });

  it('the page: the team in the breadcrumb, the role pill, the meta line, and the current task pinned above the reply', async () => {
    const { d, user } = await boot({ projects: PROJECTS, sessions: [
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'build', roleLabel: 'Build', model: 'opus', autonomy: 'edits' })
    ] });
    d.push({ type: 'teams', teams: [team] });
    d.push({ type: 'task.updated', task: { id: 't5c7e2a', title: 'Relire le candidat', giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', team: 'team-a1b2', state: 'taken', at: T0, updatedAt: T0, log: [] } });
    await user.click(await screen.findByRole('button', { name: /^Otto,/ }));
    const banner = within(screen.getByRole('banner'));
    expect(banner.getByRole('button', { name: '⚑ ledge-roles' })).toBeVisible();
    expect(banner.getByText('@build')).toBeVisible();
    expect(document.querySelector('.pane-meta')).toHaveTextContent('⚑ ledge-roles · Claude Code · opus · edits without asking');
    const pinned = await screen.findByRole('note', { name: 'Current task' });
    expect(pinned).toHaveTextContent('t5c7e2a · Relire le candidat · given by Ledge · taken');
    // main's « Tasks » gave way (lot F): the link leads to the « Teams » tab.
    await user.click(within(pinned).getByRole('button', { name: 'See the team' }));
    expect(await screen.findByRole('tab', { name: /^Teams/, selected: true })).toBeVisible();
  });

  it('the breadcrumb’s ⚑ team opens the team’s own room (lot F)', async () => {
    const { d, user } = await boot({ projects: PROJECTS, sessions: [
      fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'build' }),
      fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working' })
    ] });
    d.push({ type: 'teams', teams: [team] });
    d.push({ type: 'rig.snapshot', machine: 'local', rigs: [{ id: 'team-a1b2', name: 'ledge-roles', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, engine: 'ledge', repos: [],
      seats: [{ ref: 'build@team-a1b2', address: '@build', name: 'Otto', runtime: 'claude', state: 'working', sessionId: 'otto' }] }] });
    // In the Teams section, the projected member's row keeps its @role pill.
    const seatRow = (await within(await screen.findByRole('tree', { name: 'Teams' })).findByRole('button', { name: /^Otto/ })).closest<HTMLElement>('[role="treeitem"]')!;
    expect(within(seatRow).getByText('@build')).toBeVisible();
    await user.click(within(await screen.findByRole('region', { name: 'ledge-roles room' })).getByRole('button', { name: /^Otto,/ }));
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: '⚑ ledge-roles' }));
    expect(await screen.findByRole('region', { name: 'ledge-roles room' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Ledge room' })).toBeNull();
  });
});

describe('teamRoomFilter', () => {
  it('the rig filter of the team’s projected rig, on its machine; the local one while the fleet lists none', () => {
    const rig = { id: 'team-a1b2', name: 'x', machine: 'nas', cwd: '/', projectId: null, offProject: true, lifecycle: 'running' as const, kernel: false, engine: 'ledge' as const, repos: [], seats: [] };
    expect(teamRoomFilter([rig], 'team-a1b2')).toBe('rig:nas/team-a1b2');
    expect(teamRoomFilter([], 'team-a1b2')).toBe('rig:local/team-a1b2');
  });
});
