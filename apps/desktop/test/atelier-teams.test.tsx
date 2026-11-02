// Lot F, task 2: a Ledge team arrives as a rig (`engine: 'ledge'`) and lives in the atelier as its own room, at rest included; main's
// team tables are gone (Review Focus 4). Dropping a session on the room still asks its role (RoleChooser) and joins; dragging a seat
// out of it leaves.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Rig, RigSeat, Role, Session, Team } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS, transfer } from './helpers';

const T0 = '2026-10-26T08:00:00.000Z';
const team = (extra: Partial<Team> = {}): Team => ({ id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active',
  seats: [{ role: 'build', sessionId: 'otto' }, { role: 'qa', sessionId: null }], createdAt: T0, updatedAt: T0, ...extra });
/** The team as the Ledge engine projects it (lot D): a free seat is `stopped`, a seat's session its `sessionId`. */
const projected = (t: Team): Rig => ({
  id: t.id, name: t.name, machine: 'local', cwd: t.cwd, projectId: t.project, offProject: t.project === null, kernel: false, engine: 'ledge', repos: [],
  lifecycle: t.state === 'resting' ? 'stopped' : 'partial',
  seats: t.seats.map((x): RigSeat => ({ ref: `${x.role}@${t.id}`, address: `@${x.role}`, name: x.role, runtime: 'claude',
    ...(x.sessionId ? { sessionId: x.sessionId } : {}), state: x.sessionId && t.state !== 'resting' ? 'working' : 'stopped' }))
});
const sessions = (): Session[] => [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'build', roleLabel: 'Build' }),
  fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'idle' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' })
];
const role = (id: string): Role => ({ id, label: id.toUpperCase(), prompt: '', source: 'home', path: `/h/${id}.md` });

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function withTeam(t: Team = team(), extra: Session[] = []) {
  const env = await boot({ sessions: [...sessions(), ...extra], projects: PROJECTS });
  env.d.push({ type: 'teams.engine', engine: 'ledge', openrigAvailable: false, running: true });
  env.d.push({ type: 'teams', teams: [t] });
  env.d.push({ type: 'rig.snapshot', machine: 'local', rigs: [projected(t)] });
  await screen.findByRole('region', { name: `${t.name} room` });
  return env;
}
const room = (name: string) => screen.getByRole('region', { name: `${name} room` });

describe('a Ledge team in the atelier: its own room (Review Focus 4)', () => {
  it('one room for the team with its seat; the project room keeps one table, no team table; the sidebar names the team once', async () => {
    const { side } = await withTeam();
    const teamRoom = within(room('ledge-roles'));
    expect(teamRoom.getByText('team · 1 seat')).toBeVisible();
    expect(teamRoom.getByRole('button', { name: /^Otto,/ })).toBeVisible();
    const project = within(room('Ledge'));
    expect(project.getByText('1 table · 1 session')).toBeVisible();
    expect(project.getByRole('button', { name: /^Pim,/ })).toBeVisible();
    expect(project.queryByRole('button', { name: /^Otto,/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Team ledge-roles' })).toBeNull();
    expect(screen.queryByText('common table')).toBeNull();
    // Each seat once in the whole atelier.
    expect(screen.getAllByRole('button', { name: /^Otto,/ })).toHaveLength(1);
    // The sidebar: one row, the Teams section's; no team row in the tree, Otto not in the tree.
    expect(side.getAllByText('ledge-roles')).toHaveLength(1);
    expect(document.querySelector('.st-team')).toBeNull();
    expect(within(side.getByRole('tree', { name: 'Projects, branches and sessions' })).queryByText('Otto')).toBeNull();
  });

  it('a seat dropped on the team’s room asks its role, then joins; dragged out of it to a project table, it leaves', async () => {
    const { d, user } = await withTeam();
    const pim = screen.getByRole('button', { name: /^Pim,/ });
    const target = room('ledge-roles');
    const dt = transfer();
    fireEvent.dragStart(pim, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    expect(within(target).getByText('Drop to join')).toBeVisible();
    fireEvent.drop(target, { dataTransfer: dt, clientX: 200, clientY: 200 });
    const menu = await screen.findByRole('menu', { name: 'Pim\'s role in ledge-roles' });
    // The free role first; « another role… » reads the folder's roles from the daemon.
    expect(within(menu).getByRole('menuitem', { name: '@qa' })).toBeVisible();
    d.onMessage(m => { if (m.type === 'roles.list') d.push({ type: 'roles.listing', requestId: m.requestId, roles: [role('build'), role('qa'), role('review')], templates: [], problems: [] }); });
    await user.click(within(menu).getByRole('menuitem', { name: 'another role…' }));
    await user.click(await within(menu).findByRole('menuitem', { name: /@review/ }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.join', team: 'team-a1b2', session: 'pim', role: 'review' }));
    // Otto, out of the team's room onto the Ledge project's table: it leaves the team.
    const otto = within(room('ledge-roles')).getByRole('button', { name: /^Otto,/ });
    const table = screen.getByRole('region', { name: 'Ledge table' });
    fireEvent.dragStart(otto, { dataTransfer: dt });
    fireEvent.dragOver(table, { dataTransfer: dt });
    expect(within(table).getByText('Drop to leave the team')).toBeVisible();
    fireEvent.drop(table, { dataTransfer: dt });
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.leave', team: 'team-a1b2', session: 'otto' }));
  });

  it('a seat dropped back on its own team’s room asks nothing', async () => {
    const { d } = await withTeam();
    const otto = within(room('ledge-roles')).getByRole('button', { name: /^Otto,/ });
    const dt = transfer();
    fireEvent.dragStart(otto, { dataTransfer: dt });
    fireEvent.dragOver(room('ledge-roles'), { dataTransfer: dt });
    fireEvent.drop(room('ledge-roles'), { dataTransfer: dt, clientX: 200, clientY: 200 });
    expect(screen.queryByRole('menu', { name: /role in ledge-roles/ })).toBeNull();
    expect(d.received.some(m => m.type === 'team.join' || m.type === 'team.leave')).toBe(false);
  });

  it('« Dissolve the team » in the room’s menu asks first', async () => {
    const { d, user } = await withTeam();
    await user.click(within(room('ledge-roles')).getByRole('button', { name: 'Actions of the ledge-roles team' }));
    await user.click(screen.getByRole('menuitem', { name: /Dissolve the team/ }));
    const confirm = screen.getByRole('alertdialog', { name: 'Dissolve team ledge-roles?' });
    expect(d.received.some(m => m.type === 'team.dissolve')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Dissolve the team' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.dissolve', team: 'team-a1b2' }));
  });
});

describe('a Ledge team at rest (Review Focus 2)', () => {
  it('keeps its room, empty, « at rest »; « Resume » sends rig.act up', async () => {
    const archived = fakeSession('arlo', { name: 'Arlo', cwd: '/w/ledge', state: 'exited', team: 'team-c3d4', role: 'build', archivedAt: T0 });
    const { d, user } = await withTeam(team({ id: 'team-c3d4', name: 'mobile', state: 'resting', seats: [{ role: 'build', sessionId: 'arlo' }] }), [archived]);
    const resting = room('mobile');
    expect(resting.querySelector('.room-plaque')).toHaveTextContent(/mobile.*at rest/);
    expect(resting.querySelectorAll('.agent-seat')).toHaveLength(0);
    await user.click(within(resting).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(d.received).toContainEqual(expect.objectContaining({ type: 'rig.act', machine: 'local', verb: 'up', rigId: 'team-c3d4' })));
    expect(d.received.some(m => m.type === 'team.resume')).toBe(false);
  });
});
