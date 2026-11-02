// Lot F, task 2: the Bureaux' tech room is the active engine's (spec §6.6), and a Ledge team at rest keeps its office, empty, with
// « Reprendre » (Review Focus 2). The Bureaux are Desktop's default view; the suite runs the legacy Atelier (MODE 'test'), so these
// tests leave that mode to draw the floor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MachineState } from '@ledge/fleet';
import type { OpenRigStatus, Projects, Rig, RigSeat, Session, Team, TeamsEngine } from '@ledge/protocol';
import type { TeamsApi } from '../src/teams/useTeamsApi';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { Atelier } from '../src/atelier/Atelier';
import { initialNav } from '../src/nav/state';
import { RigControlsContext, type RigControls } from '../src/rigs/useRigActions';
import { techCores } from '../src/rigs/engine';
import type { Filing } from '../src/atelier/filing';
import type { SessionActions } from '../src/manage/useSessionActions';
import type { SessionMenuState } from '../src/manage/useSessionMenu';

beforeEach(() => { localStorage.clear(); vi.stubEnv('MODE', 'development'); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

const PROJECTS: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };
const machine = (id: string, linked: boolean): MachineState => ({ id, label: id, status: linked ? 'open' : 'unreachable', ready: linked, recents: [], sessions: [], launcher: null });
const MACHINES = [machine('local', true), machine('nas', false)];
const seat = (role: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${role}@team-c3d4`, address: `@${role}`, name: role, runtime: 'claude', state: 'stopped', ...extra });
const RESTING: Rig = { id: 'team-c3d4', name: 'mobile', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'stopped', kernel: false, engine: 'ledge', repos: [],
  seats: [seat('build', { sessionId: 'arlo' })] };
const KERNEL: Rig = { id: 'k', name: 'openrig-kernel', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: true, repos: [], seats: [] };
const KERNEL_NAS: Rig = { ...KERNEL, machine: 'nas' };
const otto = fakeSession('local:otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', machineId: 'local' });

const filing = { dragging: null, over: null, seated: null, dragProps: () => ({}), dropProps: () => ({ onDragOver() {}, onDragLeave() {}, onDrop() {} }), file() {}, markSeated() {} } as unknown as Filing;
const actions: SessionActions = { request() {}, resume() {}, restore() {}, pending: null, confirm() {}, cancel() {}, allowed: () => true };
const menu = { menu: null, session: null, renaming: null, open: vi.fn(), close() {}, terminal() {}, rename() {}, closeRename() {}, sendRename() {} } as unknown as SessionMenuState;

function renderBureaux({ engine, rigs, openrig = [], lang = 'fr', sessions = [otto], busy = false, teams }: { engine: TeamsEngine; rigs: Rig[]; openrig?: OpenRigStatus[]; lang?: 'fr' | 'en'; sessions?: Session[]; busy?: boolean; teams?: TeamsApi }) {
  const act = vi.fn<RigControls['act']>(async () => ({ ok: true }));
  const controls = { act, adopt: vi.fn(), pending: new Set(), busy: () => busy, askStop() {}, paired: () => null, showRepos() {}, askAdopt() {} } as unknown as RigControls;
  const nav = { ...initialNav({ view: 'atelier', helpers: true, paused: true }), place: { kind: 'overview' as const, view: 'atelier' as const, project: 'all' } };
  render(
    <LangProvider lang={lang}><RigControlsContext.Provider value={controls}>
      <Atelier nav={nav} dispatch={() => {}} sessions={sessions} projects={PROJECTS} order={sessions} rigs={rigs} openrig={openrig} engine={engine} machines={MACHINES}
        projectIdOf={s => (s.cwd.startsWith('/w/ledge') ? 'ledge' : null)} filing={filing} actions={actions} menu={menu} {...(teams ? { teams } : {})} />
    </RigControlsContext.Provider></LangProvider>
  );
  return { act };
}
const racks = () => [...document.querySelectorAll<HTMLElement>('.bureaux-rack')].map(r => `${r.textContent} ${r.className.replace('bureaux-rack ', '')}`);

describe('the tech room of the active engine (spec §6.6)', () => {
  it('Ledge mode: « Équipes · Ledge », one bay per machine of the fleet, lit when its daemon is linked, dark when not', async () => {
    renderBureaux({ engine: 'ledge', rigs: [] });
    expect(await screen.findByText('Équipes · Ledge')).toBeInTheDocument();
    expect(racks()).toEqual(['local running', 'nas unreachable']);
    expect(screen.queryByText(/OpenRig · Salle technique/)).toBeNull();
  });

  it('OpenRig mode: « Équipes · OpenRig », the bays are the kernels with OpenRig’s state of their machine', async () => {
    renderBureaux({ engine: 'openrig', rigs: [KERNEL, KERNEL_NAS], openrig: [{ machine: 'local', state: 'running' }, { machine: 'nas', state: 'starting' }] });
    expect(await screen.findByText('Équipes · OpenRig')).toBeInTheDocument();
    expect(racks()).toEqual(['local running', 'nas starting']);
  });

  it('in English: « Teams · Ledge »', async () => {
    renderBureaux({ engine: 'ledge', rigs: [], lang: 'en' });
    expect(await screen.findByText('Teams · Ledge')).toBeInTheDocument();
  });
});

describe('techCores', () => {
  it('Ledge: a core per fleet machine, running when linked and ready, unreachable otherwise (connecting included)', () => {
    const connecting: MachineState = { ...machine('ec2', false), status: 'connecting' };
    expect(techCores('ledge', [KERNEL], [], [...MACHINES, connecting])).toEqual([
      { machine: 'local', state: 'running' }, { machine: 'nas', state: 'unreachable' }, { machine: 'ec2', state: 'unreachable' }
    ]);
  });
  it('OpenRig: a core per kernel; running, starting and unreachable kept, absent / error / unsupported / stopped as stopped, no status unreachable', () => {
    const k = (m: string): Rig => ({ ...KERNEL, machine: m });
    const status = (m: string, state: OpenRigStatus['state']): OpenRigStatus => ({ machine: m, state });
    expect(techCores('openrig', [k('a'), k('b'), k('c'), k('d'), k('e'), k('f'), k('g'), RESTING], [status('a', 'running'), status('b', 'starting'), status('c', 'unreachable'), status('d', 'absent'), status('e', 'error'), status('f', 'stopped')], MACHINES))
      .toEqual([['a', 'running'], ['b', 'starting'], ['c', 'unreachable'], ['d', 'stopped'], ['e', 'stopped'], ['f', 'stopped'], ['g', 'unreachable']].map(([machine, state]) => ({ machine, state })));
  });
});

describe('a Ledge team at rest in the Bureaux (Review Focus 2)', () => {
  it('keeps its office, empty, plated « mobile · au repos »; « Reprendre » sends rig.act up', async () => {
    const { act } = renderBureaux({ engine: 'ledge', rigs: [RESTING] });
    const plate = await screen.findByText('mobile · au repos');
    const office = plate.closest<HTMLElement>('.bureaux-room')!;
    expect(office.querySelectorAll('.bureaux-seat')).toHaveLength(0);
    await userEvent.setup().click(within(office).getByRole('button', { name: 'Reprendre' }));
    expect(act).toHaveBeenCalledWith('local', 'up', { rigId: 'team-c3d4' });
  });

  it('« Reprendre » waits while an action on the team is in flight', async () => {
    renderBureaux({ engine: 'ledge', rigs: [RESTING], busy: true });
    const office = (await screen.findByText('mobile · au repos')).closest<HTMLElement>('.bureaux-room')!;
    expect(within(office).getByRole('button', { name: 'Reprendre' })).toBeDisabled();
  });

  it('in English: « mobile · at rest »', async () => {
    renderBureaux({ engine: 'ledge', rigs: [RESTING], lang: 'en' });
    expect(await screen.findByText('mobile · at rest')).toBeInTheDocument();
  });
});

describe('a running Ledge team in the Bureaux (Review Focus 4)', () => {
  const lea = fakeSession('local:lea', { name: 'Lea', cwd: '/w/ledge', state: 'working', machineId: 'local', team: 'team-a1b2', role: 'leader' });
  const team = (state: RigSeat['state']): Rig => ({ id: 'team-a1b2', name: 'roles', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: state === 'stopped' ? 'partial' : 'running', kernel: false, engine: 'ledge', repos: [],
    seats: [{ ref: 'leader@team-a1b2', address: '@leader', name: 'Lea', runtime: 'claude', state, sessionId: 'local:lea' }] });
  const plates = () => [...document.querySelectorAll('.bureaux-plate')].map(p => p.textContent);

  it('gives exactly one office, its seat in it; the project’s office keeps its own sessions only', async () => {
    renderBureaux({ engine: 'ledge', rigs: [team('working')], sessions: [otto, lea] });
    await screen.findByText('Équipes · Ledge');
    expect(plates().filter(p => p?.startsWith('roles'))).toEqual(['roles · 1']);
    expect(plates()).toContain('Ledge · 1');
    expect(document.querySelectorAll('[data-agent="local:lea"]')).toHaveLength(1);
  });

  it('live with no seat running, it still keeps one empty office', async () => {
    renderBureaux({ engine: 'ledge', rigs: [team('stopped')], sessions: [otto] });
    await screen.findByText('Équipes · Ledge');
    expect(plates().filter(p => p?.startsWith('roles'))).toEqual(['roles · 0']);
  });
});

describe('« Ajouter une session… » in the Bureaux (lot F final review I5)', () => {
  const lea = fakeSession('local:lea', { name: 'Lea', cwd: '/w/ledge', state: 'working', machineId: 'local', team: 'team-a1b2', role: 'leader' });
  const TEAM: Team = { id: 'team-a1b2', name: 'roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active',
    seats: [{ role: 'leader', sessionId: 'lea' }, { role: 'qa', sessionId: null }], createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z' };
  const RIG: Rig = { id: 'team-a1b2', name: 'roles', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, engine: 'ledge', repos: [],
    seats: [{ ref: 'leader@team-a1b2', address: '@leader', name: 'Lea', runtime: 'claude', state: 'working', sessionId: 'local:lea' }] };
  const teamsApi = (team: Team): TeamsApi & { join: ReturnType<typeof vi.fn<TeamsApi['join']>> } => ({
    teams: [team], tasks: [], teamOf: s => (s.team === team.id ? team : undefined), join: vi.fn<TeamsApi['join']>(), leave: vi.fn(), resume: vi.fn(), dissolve: vi.fn(), seen: vi.fn(),
    roles: async () => ({ roles: [], templates: [], problems: [] }), answer: async () => undefined
  });

  it('the live team’s office has a « … »: « Ajouter une session… », the project’s standalone session, its role, then team.join', async () => {
    const teams = teamsApi(TEAM);
    renderBureaux({ engine: 'ledge', rigs: [RIG], sessions: [otto, lea], teams });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actions de l’équipe roles' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ajouter une session…' }));
    const pick = await screen.findByRole('menu', { name: 'Ajouter une session à roles' });
    expect(within(pick).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Otto']);
    await user.click(within(pick).getByRole('menuitem', { name: 'Otto' }));
    const roles = await screen.findByRole('menu', { name: 'Rôle de Otto dans roles' });
    await user.click(within(roles).getByRole('menuitem', { name: '@qa' }));
    expect(teams.join).toHaveBeenCalledWith('team-a1b2', 'local:otto', 'qa');
  });

  it('a resting team’s office has no « … »', async () => {
    renderBureaux({ engine: 'ledge', rigs: [RESTING], teams: teamsApi({ ...TEAM, id: 'team-c3d4', name: 'mobile', state: 'resting' }) });
    await screen.findByText('mobile · au repos');
    expect(screen.queryByRole('button', { name: 'Actions de l’équipe mobile' })).toBeNull();
  });
});
