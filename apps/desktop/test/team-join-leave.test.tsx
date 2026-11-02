// Lot F final review I5: joining and leaving a Ledge team without dragging, in the default view. « Ajouter une session… » in the team
// room's « … » (the Équipes tab card, the atelier room) picks one of the project's standalone sessions on the team's machine, then its
// role (RoleChooser), and sends team.join; the session's own menu says « Quitter l'équipe {team} » for a seat of a live Ledge team.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Rig, RigSeat, Role, Session, Team } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';
import { joinCandidates } from '../src/rigs/engine';
import { fr } from '../src/i18n/fr';
import { en } from '../src/i18n/en';

const T0 = '2026-11-01T08:00:00.000Z';
const TEAM: Team = { id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active',
  seats: [{ role: 'build', sessionId: 'otto' }, { role: 'qa', sessionId: null }], createdAt: T0, updatedAt: T0 };
const projected = (t: Team): Rig => ({
  id: t.id, name: t.name, machine: 'local', cwd: t.cwd, projectId: t.project, offProject: t.project === null, kernel: false, engine: 'ledge', repos: [],
  lifecycle: t.state === 'resting' ? 'stopped' : 'running',
  seats: t.seats.map((x): RigSeat => ({ ref: `${x.role}@${t.id}`, address: `@${x.role}`, name: x.role, runtime: 'claude',
    ...(x.sessionId ? { sessionId: x.sessionId } : {}), state: x.sessionId && t.state !== 'resting' ? 'working' : 'stopped' }))
});
const SESSIONS = (): Session[] => [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'build', roleLabel: 'Build' }),
  fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'idle' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' })
];
const role = (id: string): Role => ({ id, label: id.toUpperCase(), prompt: '', source: 'home', path: `/h/${id}.md` });

const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const room = (name: string) => screen.getByRole('region', { name: `${name} room` });

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function withTeam({ home: onHome = false, team = TEAM }: { home?: boolean; team?: Team } = {}) {
  const env = await boot({ sessions: SESSIONS(), projects: PROJECTS, home: onHome, machines: [{ id: 'local', label: 'Local' }] });
  env.d.push({ type: 'teams.engine', engine: 'ledge', openrigAvailable: false, running: true });
  env.d.push({ type: 'teams', teams: [team] });
  env.d.push({ type: 'rig.snapshot', machine: 'local', rigs: [projected(team)] });
  return env;
}
/** The chooser: the session first (Pim, the only standalone session of Ledge here), then its role; team.join goes out. */
async function chooseAndJoin(d: MockDaemon, user: Awaited<ReturnType<typeof withTeam>>['user']) {
  const pick = await screen.findByRole('menu', { name: 'Add a session to ledge-roles' });
  expect(within(pick).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Pim']);
  await user.click(within(pick).getByRole('menuitem', { name: 'Pim' }));
  const roles = await screen.findByRole('menu', { name: 'Pim\'s role in ledge-roles' });
  await user.click(within(roles).getByRole('menuitem', { name: '@qa' }));
  await waitFor(() => expect(d.received).toContainEqual({ type: 'team.join', team: 'team-a1b2', session: 'pim', role: 'qa' }));
  expect(screen.queryByRole('menu', { name: /role in ledge-roles/ })).toBeNull();
}

describe('joinCandidates', () => {
  const rig = projected(TEAM);
  const all: Session[] = [...SESSIONS(),
    fakeSession('far', { name: 'Far', cwd: '/w/ledge', state: 'idle', machineId: 'dev' }),
    fakeSession('gone', { name: 'Gone', cwd: '/w/ledge', state: 'exited' }),
    fakeSession('ro', { name: 'Ro', cwd: '/w/ledge', state: 'idle', source: 'hook_only' })];
  const projectOf = (s: Session) => (s.cwd.startsWith('/w/ledge') ? 'ledge' : s.cwd.startsWith('/w/pay') ? 'pay' : null);
  it('the project’s standalone sessions on the team’s machine: live, launched by Ledge, in no team', () => {
    expect(joinCandidates(rig, all, [rig], projectOf).map(s => s.id)).toEqual(['pim']);
  });
});

describe('« Add a session… » (join without dragging)', () => {
  it('the Teams tab card’s « … » of a live Ledge team: the session, its role, then team.join', async () => {
    const { d, user } = await withTeam({ home: true });
    d.onMessage(m => { if (m.type === 'roles.list') d.push({ type: 'roles.listing', requestId: m.requestId, roles: [role('build'), role('qa')], templates: [], problems: [] }); });
    await user.click(await within(home().getByRole('tablist', { name: 'Ledge views' })).findByRole('tab', { name: 'Teams · 1' }));
    const card = within(home().getByRole('tabpanel', { name: 'Teams' }).querySelector<HTMLElement>('[aria-label="ledge-roles"]')!);
    await user.click(card.getByRole('button', { name: 'More actions for ledge-roles' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add a session…' }));
    await chooseAndJoin(d, user);
  });

  it('the atelier room’s « … »: the same chooser, then team.join', async () => {
    const { d, user } = await withTeam();
    await screen.findByRole('region', { name: 'ledge-roles room' });
    await user.click(within(room('ledge-roles')).getByRole('button', { name: 'Actions of the ledge-roles team' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add a session…' }));
    await chooseAndJoin(d, user);
  });

  it('a team at rest is not offered « Add a session… »', async () => {
    const { user } = await withTeam({ team: { ...TEAM, state: 'resting', seats: [{ role: 'build', sessionId: null }] } });
    await screen.findByRole('region', { name: 'ledge-roles room' });
    await user.click(within(room('ledge-roles')).getByRole('button', { name: 'Actions of the ledge-roles team' }));
    expect(screen.queryByRole('menuitem', { name: 'Add a session…' })).toBeNull();
  });
});

describe('« Leave the team {team} » in the session’s menu', () => {
  it('a seat of a live Ledge team leaves it with team.leave; a standalone session has no such item', async () => {
    const { d, user } = await withTeam();
    const otto = await within(await screen.findByRole('region', { name: 'ledge-roles room' })).findByRole('button', { name: /^Otto,/ });
    fireEvent.contextMenu(otto, { clientX: 120, clientY: 80 });
    const menu = await screen.findByRole('menu', { name: 'Manage Otto' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Leave the team ledge-roles' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.leave', team: 'team-a1b2', session: 'otto' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Pim,/ }), { clientX: 120, clientY: 80 });
    const pims = await screen.findByRole('menu', { name: 'Manage Pim' });
    expect(within(pims).queryByRole('menuitem', { name: /Leave the team/ })).toBeNull();
  });
});

describe('the words', () => {
  it('fr and en', () => {
    expect(fr.rooms.addSession).toBe('Ajouter une session…');
    expect(en.rooms.addSession).toBe('Add a session…');
    expect(fr.session.leaveTeam('ledge-roles')).toBe('Quitter l\'équipe ledge-roles');
    expect(en.session.leaveTeam('ledge-roles')).toBe('Leave the team ledge-roles');
  });
});
