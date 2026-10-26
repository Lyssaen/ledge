import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Role, Team } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS, transfer } from './helpers';

const T0 = '2026-10-26T08:00:00.000Z';
const team = (extra: Partial<Team> = {}): Team => ({ id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active',
  seats: [{ role: 'build', sessionId: 'otto' }, { role: 'qa', sessionId: null }], createdAt: T0, updatedAt: T0, ...extra });
const sessions = () => [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'build', roleLabel: 'Build' }),
  fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'idle' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' })
];
const role = (id: string): Role => ({ id, label: id.toUpperCase(), prompt: '', source: 'home', path: `/h/${id}.md` });

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function withTeam(t: Team = team()) {
  const env = await boot({ sessions: sessions(), projects: PROJECTS });
  env.d.push({ type: 'teams', teams: [t] });
  await screen.findByRole('region', { name: 'Team ledge-roles' });
  return env;
}

describe('the atelier’s rooms (atelier rooms spec)', () => {
  it('a room per project with its plaque; a table per team, the others at the common table; the role pill on a seat', async () => {
    await withTeam();
    const room = screen.getByRole('region', { name: 'Ledge room' });
    expect(within(room).getByText('2 tables · 2 sessions')).toBeVisible();
    expect(within(room).getByText('ENTRANCE')).toBeInTheDocument();
    const teamTable = within(room).getByRole('region', { name: 'Team ledge-roles' });
    expect(within(teamTable).getByText('team · operator Ledge · 0/0 tasks')).toBeVisible();
    const otto = within(teamTable).getByRole('button', { name: /^Otto,/ });
    expect(within(otto).getByText('@build')).toBeVisible();
    const common = within(room).getByRole('region', { name: 'Ledge table' });
    expect(within(common).getByText('common table')).toBeVisible();
    expect(within(common).getByRole('button', { name: /^Pim,/ })).toBeVisible();
    // A room with no team looks as before, inside its walls: no « common table ».
    const pay = screen.getByRole('region', { name: /Payment Service Platform Migration Europe room/ });
    expect(within(pay).queryByText('common table')).toBeNull();
  });

  it('the team’s sheets are its open tasks; its heading counts Ledge’s', async () => {
    const { d } = await withTeam();
    d.push({ type: 'task.updated', task: { id: 't5c7e2a', title: 'Relire le candidat', giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', team: 'team-a1b2', state: 'taken', at: T0, updatedAt: T0, log: [] } });
    const teamTable = screen.getByRole('region', { name: 'Team ledge-roles' });
    await waitFor(() => expect(within(teamTable).getByText('t5c7e2a · Relire le candidat · Ledge')).toBeVisible());
    expect(within(teamTable).getByText('team · operator Ledge · 0/1 task')).toBeVisible();
  });

  it('a seat dropped on a team table asks its role, then joins; dropped back on the common table, it leaves', async () => {
    const { d, user } = await withTeam();
    const pim = screen.getByRole('button', { name: /^Pim,/ });
    const teamTable = screen.getByRole('region', { name: 'Team ledge-roles' });
    const dt = transfer();
    fireEvent.dragStart(pim, { dataTransfer: dt });
    fireEvent.dragOver(teamTable, { dataTransfer: dt });
    expect(within(teamTable).getByText('Drop to join')).toBeVisible();
    fireEvent.drop(teamTable, { dataTransfer: dt, clientX: 200, clientY: 200 });
    const menu = await screen.findByRole('menu', { name: 'Pim\'s role in ledge-roles' });
    // The free role first; « another role… » reads the folder's roles from the daemon.
    expect(within(menu).getByRole('menuitem', { name: '@qa' })).toBeVisible();
    d.onMessage(m => { if (m.type === 'roles.list') d.push({ type: 'roles.listing', requestId: m.requestId, roles: [role('build'), role('qa'), role('review')], templates: [], problems: [] }); });
    await user.click(within(menu).getByRole('menuitem', { name: 'another role…' }));
    await user.click(await within(menu).findByRole('menuitem', { name: /@review/ }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.join', team: 'team-a1b2', session: 'pim', role: 'review' }));
    // Otto, back to the common table: it leaves the team.
    const otto = screen.getByRole('button', { name: /^Otto,/ });
    const common = screen.getByRole('region', { name: 'Ledge table' });
    fireEvent.dragStart(otto, { dataTransfer: dt });
    fireEvent.dragOver(common, { dataTransfer: dt });
    fireEvent.drop(common, { dataTransfer: dt });
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.leave', team: 'team-a1b2', session: 'otto' }));
  });

  it('a resting team is drawn dimmed with « Resume »; « Dissolve the team » asks first', async () => {
    const archived = fakeSession('arlo', { name: 'Arlo', cwd: '/w/ledge', state: 'exited', team: 'team-c3d4', role: 'build', archivedAt: T0 });
    const env = await boot({ sessions: [...sessions(), archived], projects: PROJECTS });
    env.d.push({ type: 'teams', teams: [team({ id: 'team-c3d4', name: 'mobile', state: 'resting', seats: [{ role: 'build', sessionId: 'arlo' }] })] });
    const table = await screen.findByRole('region', { name: 'Team mobile' });
    expect(table).toHaveClass('table-resting');
    expect(within(table).getByText('team resting')).toBeVisible();
    expect(within(table).getByRole('button', { name: /^Arlo,/ })).not.toHaveAttribute('draggable');
    await env.user.click(within(table).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(env.d.received).toContainEqual({ type: 'team.resume', team: 'team-c3d4' }));
    await env.user.click(within(table).getByRole('button', { name: 'Actions of team mobile' }));
    await env.user.click(screen.getByRole('menuitem', { name: /Dissolve the team/ }));
    const confirm = screen.getByRole('alertdialog', { name: 'Dissolve team mobile?' });
    expect(env.d.received.some(m => m.type === 'team.dissolve')).toBe(false);
    await env.user.click(within(confirm).getByRole('button', { name: 'Dissolve the team' }));
    await waitFor(() => expect(env.d.received).toContainEqual({ type: 'team.dissolve', team: 'team-c3d4' }));
  });
});
