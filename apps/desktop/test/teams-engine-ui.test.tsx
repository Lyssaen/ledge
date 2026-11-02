// Lot F, task 1: one « Teams » screen whatever the engine. A Ledge team arrives as a Rig with `engine: 'ledge'`; what is OpenRig's own
// (its banner, its specs, its launch by plan) shows in OpenRig mode only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { OpenRigStatus, Rig, RigSeat, Role } from '@ledge/protocol';
import { rigsModel } from '@ledge/ui/rigs/model';
import { boot, closeDaemons, PROJECTS, recordToasts, type MockDaemon } from './helpers';
import { LangProvider } from '../src/i18n/lang';
import { RigsLive } from '../src/rigs/RigsLive';
import { teamRoom } from '../src/rigs/engine';
import { visibleRigs } from '../src/rigs/RigsTab';
import { fr } from '../src/i18n/fr';
import { en } from '../src/i18n/en';

const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const homeTabs = () => within(home().getByRole('tablist', { name: 'Ledge views' }));
const side = () => within(screen.getByRole('complementary', { name: 'Sidebar' }));

const seat = (role: string, name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${role}@team-a1b2`, address: `@${role}`, name, runtime: 'claude', state: 'working', ...extra });
const LEDGE_TEAM: Rig = { id: 'team-a1b2', name: 'ledge-roles', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, spec: 'workshop', lifecycle: 'running',
  kernel: false, engine: 'ledge', repos: [], seats: [seat('leader', 'Otto', { sessionId: 'otto' }), seat('review', 'Pim', { sessionId: 'pim', runtime: 'codex', state: 'idle' })] };
const FACTORY: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, spec: 'factory', lifecycle: 'running', kernel: false, repos: [],
  seats: [{ ref: 'build@factory', address: '@build', name: 'build', runtime: 'claude-code', state: 'working' }] };
const ABSENT: OpenRigStatus = { machine: 'local', state: 'absent', install: 'npm i -g @openrig/cli' };
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };

const role = (id: string, extra: Partial<Role> = {}): Role => ({ id, label: id.toUpperCase(), prompt: '', source: 'repo', path: `/w/ledge/.ledge/roles/${id}.md`, ...extra });
/** Answers every `roles.list` with /w/ledge's catalog: a workshop template, and a file skipped for its missing leader. */
const listing = (d: MockDaemon) => d.onMessage(m => {
  if (m.type === 'roles.list') d.push({ type: 'roles.listing', requestId: m.requestId, roles: [role('leader'), role('build')],
    templates: [{ id: 'workshop', name: 'workshop', source: 'repo', path: '/w/ledge/.ledge/teams/workshop.yaml', seats: [{ role: 'leader' }, { role: 'build' }] }],
    problems: [{ path: '/w/ledge/.ledge/teams/solo.yaml', reason: 'il manque le siège @leader' }] });
});

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openHome(engine: 'ledge' | 'openrig', { rigs, openrig, projects = PROJECTS }: { rigs: Rig[]; openrig: OpenRigStatus; projects?: typeof PROJECTS }) {
  const env = await boot({ home: true, machines: LOCAL, projects, sessions: [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'leader' }),
    fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'idle', team: 'team-a1b2', role: 'review' })
  ] });
  await screen.findByRole('region', { name: 'Home: Ledge, the operator' });
  env.d.push({ type: 'teams.engine', engine, openrigAvailable: engine === 'openrig', running: rigs.length > 0 });
  env.d.push({ type: 'openrig.status', status: openrig });
  env.d.push({ type: 'rig.snapshot', machine: 'local', rigs });
  return env;
}
const toTeams = async (user: Awaited<ReturnType<typeof openHome>>['user'], n: number) => {
  await user.click(await homeTabs().findByRole('tab', { name: n > 0 ? `Teams · ${n}` : 'Teams' }));
  return home().getByRole('tabpanel', { name: 'Teams' });
};

describe('visibleRigs (Review Focus 1)', () => {
  it('keeps a Ledge team whatever OpenRig says of its machine; an OpenRig rig of a machine where OpenRig is down is left out', () => {
    expect(visibleRigs([LEDGE_TEAM, FACTORY], [ABSENT])).toEqual([LEDGE_TEAM]);
    expect(visibleRigs([LEDGE_TEAM, FACTORY], [{ machine: 'local', state: 'stopped' }])).toEqual([LEDGE_TEAM]);
    expect(visibleRigs([LEDGE_TEAM, FACTORY], [RUNNING])).toEqual([LEDGE_TEAM, FACTORY]);
  });
});

describe('the Ledge screen’s tabs (Review Focus 4)', () => {
  it('are Conversation · Teams · n · Templates · Mandate: one tab says « Teams », main’s live teams and tasks are gone', async () => {
    await openHome('ledge', { rigs: [LEDGE_TEAM], openrig: ABSENT });
    await homeTabs().findByRole('tab', { name: 'Teams · 1' });
    expect(homeTabs().getAllByRole('tab').map(t => t.textContent)).toEqual(['Conversation', 'Teams · 1', 'Templates', 'Mandate']);
    expect(homeTabs().getAllByRole('tab', { name: /Teams/ })).toHaveLength(1);
    expect(homeTabs().queryByRole('tab', { name: /Tasks/ })).toBeNull();
  });
});

describe('Ledge mode', () => {
  it('the team shows on a machine without OpenRig, with its template; no OpenRig banner, no Specs; the sidebar names it too', async () => {
    const { user } = await openHome('ledge', { rigs: [LEDGE_TEAM], openrig: ABSENT });
    const tab = within(await toTeams(user, 1));
    const card = within(tab.getByRole('article', { name: 'ledge-roles' }));
    expect(card.getByText(/^team · 2 seats · in Ledge · template workshop$/)).toBeVisible();
    expect(tab.queryByText('OpenRig is not installed')).toBeNull();
    expect(within(tab.getByRole('tablist', { name: 'Team views' })).getAllByRole('tab').map(t => t.textContent)).toEqual(['Running · 1', 'Agents · 2']);
    expect(side().getByRole('treeitem', { name: /ledge-roles/ })).toBeVisible();
    expect(side().queryByText('OpenRig is not installed')).toBeNull();
  });

  it('without any team, the sidebar invites to nothing of OpenRig either', async () => {
    await openHome('ledge', { rigs: [], openrig: ABSENT });
    await waitFor(() => expect(side().getByRole('region', { name: 'Teams' })).toBeVisible());
    expect(side().queryByText('OpenRig is not installed')).toBeNull();
    expect(home().queryByText('OpenRig is not installed')).toBeNull();
  });

  it('« Launch a team », from the Teams tab and from the sidebar, opens the team form with its objective (Review Focus 3)', async () => {
    const { d, user } = await openHome('ledge', { rigs: [LEDGE_TEAM], openrig: ABSENT });
    listing(d);
    const tab = within(await toTeams(user, 1));
    await user.click(tab.getByRole('button', { name: 'Launch a team' }));
    const form = await screen.findByRole('dialog', { name: 'New team · Ledge' });
    expect(await within(form).findByRole('textbox', { name: 'Objective' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(side().getByRole('button', { name: 'Launch a team' }));
    expect(await screen.findByRole('dialog', { name: 'New team · Ledge' })).toBeVisible();
  });

  it('« Launch a team » with no project holding a folder on this machine says so, and opens nothing', async () => {
    const log = recordToasts();
    const remoteOnly = { ...PROJECTS, projects: PROJECTS.projects.map(p => ({ ...p, repos: p.repos.map(r => ({ ...r, machine: 'nas' })) })) };
    const { user } = await openHome('ledge', { rigs: [LEDGE_TEAM], openrig: ABSENT, projects: remoteOnly });
    const tab = within(await toTeams(user, 1));
    await user.click(tab.getByRole('button', { name: 'Launch a team' }));
    await waitFor(() => expect(log).toContain('No project with a folder on this machine: create one to launch a team in it'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('teamRoom: the project asked for, else the first with a local folder; a stale id opens nothing', () => {
    expect(teamRoom(PROJECTS, 'pay')?.id).toBe('pay');
    expect(teamRoom(PROJECTS, undefined)?.id).toBe('ledge');
    expect(teamRoom(PROJECTS, 'gone')).toBeUndefined();
    expect(teamRoom(null, undefined)).toBeUndefined();
  });

  it('a Ledge team on another machine has no field: the fleet writes to the local daemon’s teams only', () => {
    const remote: Rig = { ...LEDGE_TEAM, id: 'team-c3d4', name: 'far-team', machine: 'nas' };
    const model = rigsModel([LEDGE_TEAM, remote], new Map(), PROJECTS);
    render(<LangProvider lang="en"><RigsLive model={model} openrig={[]} byId={new Map()} projects={PROJECTS} dispatch={() => {}} onTerminal={() => {}}
      onBroadcast={() => Promise.resolve({ sent: 1 })} /></LangProvider>);
    expect(within(screen.getByRole('article', { name: 'ledge-roles' })).getByRole('textbox', { name: 'Write to the whole team…' })).toBeVisible();
    expect(within(screen.getByRole('article', { name: 'far-team' })).queryByRole('textbox', { name: 'Write to the whole team…' })).toBeNull();
  });

  it('« Stop… » on a Ledge team says its sessions close and it rests, nothing of OpenRig’s snapshot', async () => {
    const { user } = await openHome('ledge', { rigs: [LEDGE_TEAM], openrig: ABSENT });
    const tab = within(await toTeams(user, 1));
    await user.click(within(tab.getByRole('article', { name: 'ledge-roles' })).getByRole('button', { name: 'Stop…' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Stop ledge-roles?' }));
    expect(dialog.getByText("The team's sessions close; the team stays at rest and resumes with one click.")).toBeVisible();
    expect(dialog.queryByText(/snapshot/)).toBeNull();
  });

  it('a live team’s card writes to the whole team: team.broadcast to the local daemon, then how many seats it reached, or why not', async () => {
    const { d, user } = await openHome('ledge', { rigs: [LEDGE_TEAM], openrig: ABSENT });
    let answer: { sent?: number; reason?: string } = { sent: 2 };
    d.onMessage(m => { if (m.type === 'team.broadcast') d.push({ type: 'team.broadcast.result', rid: m.rid, team: m.team, ...answer }); });
    const card = within(within(await toTeams(user, 1)).getByRole('article', { name: 'ledge-roles' }));
    const field = card.getByRole('textbox', { name: 'Write to the whole team…' });
    await user.type(field, 'On fait une pause{Enter}');
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.broadcast', rid: expect.any(String), team: 'team-a1b2', text: 'On fait une pause' }));
    expect(await card.findByText('Sent to 2 seats')).toBeVisible();
    expect(field).toHaveValue('');
    answer = { reason: 'no live seat' };
    await user.type(field, 'Encore{Enter}');
    expect(await card.findByText('Not sent: no live seat')).toBeVisible();
    expect(field).toHaveValue('Encore');
  });

  it('a team at rest has no field to write to it', async () => {
    const { user } = await openHome('ledge', { rigs: [{ ...LEDGE_TEAM, lifecycle: 'stopped', seats: LEDGE_TEAM.seats.map(s => ({ ...s, state: 'stopped' as const })) }], openrig: ABSENT });
    const card = within(within(await toTeams(user, 1)).getByRole('article', { name: 'ledge-roles' }));
    expect(card.getByRole('button', { name: 'Resume' })).toBeVisible();
    expect(card.queryByRole('textbox', { name: 'Write to the whole team…' })).toBeNull();
    expect(card.queryByRole('button', { name: 'More actions for ledge-roles' })).toBeNull();
  });
});

describe('OpenRig mode', () => {
  it('« Launch a team » opens OpenRig’s launch by plan; the Specs view is there; no broadcast field on a rig (Review Focus 3)', async () => {
    const { user } = await openHome('openrig', { rigs: [FACTORY], openrig: RUNNING });
    const tab = within(await toTeams(user, 1));
    expect(within(tab.getByRole('tablist', { name: 'Team views' })).getByRole('tab', { name: /^Specs/ })).toBeVisible();
    expect(within(tab.getByRole('article', { name: 'factory' })).getByText(/spec factory/)).toBeVisible();
    expect(tab.queryByRole('textbox', { name: 'Write to the whole team…' })).toBeNull();
    await user.click(tab.getByRole('button', { name: 'Launch a team' }));
    expect(await screen.findByRole('dialog', { name: 'New team' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'New team · Ledge' })).toBeNull();
  });

  it('the OpenRig banner still says OpenRig is absent', async () => {
    const { user } = await openHome('openrig', { rigs: [], openrig: ABSENT });
    const tab = within(await toTeams(user, 0));
    expect(tab.getByRole('status')).toHaveTextContent('OpenRig is not installed');
  });
});

describe('« Templates »: main’s catalog, its templates, roles and skipped files', () => {
  it('a template says the lead rule; a template without its leader is a skipped file, as before', async () => {
    const { d, user } = await openHome('ledge', { rigs: [LEDGE_TEAM], openrig: ABSENT });
    listing(d);
    await user.click(homeTabs().getByRole('tab', { name: 'Templates' }));
    const views = within(await home().findByRole('tablist', { name: 'Template views' }));
    // The counts come with definitions.listing, after the click: waited for, never read at once (branch review M6).
    await waitFor(() => expect(views.getAllByRole('tab').map(t => t.textContent)).toEqual(['Templates · 1', 'Roles · 2']));
    const tpl = within(await home().findByRole('region', { name: 'workshop' }));
    expect(tpl.getByText('A team has exactly one leader seat: its lead, who receives the objective.')).toBeVisible();
    await user.click(home().getByRole('button', { name: /1 file not read/ }));
    expect(within(home().getByRole('region', { name: 'Skipped files' })).getByText('il manque le siège @leader')).toBeVisible();
  });
});

describe('the words', () => {
  it('French and English, word for word', () => {
    expect([fr.home.tabs.rigs, fr.home.rigsCount(1), fr.home.tabs.models]).toEqual(['Équipes', 'Équipes · 1', 'Modèles']);
    expect([en.home.tabs.rigs, en.home.rigsCount(1), en.home.tabs.models]).toEqual(['Teams', 'Teams · 1', 'Templates']);
    expect(fr.rigActions.stopBodyLedge).toBe("Les sessions de l'équipe se ferment ; l'équipe reste au repos et se reprend d'un clic.");
    expect(en.rigActions.stopBodyLedge).toBe("The team's sessions close; the team stays at rest and resumes with one click.");
    expect([fr.rigsTab.broadcast, fr.rigsTab.broadcastSent(3)]).toEqual(["Écrire à toute l'équipe…", 'Envoyé à 3 sièges']);
    expect([en.rigsTab.broadcast, en.rigsTab.broadcastSent(3)]).toEqual(['Write to the whole team…', 'Sent to 3 seats']);
    expect(fr.home.catalog.leadRule).toBe("Une équipe a exactement un siège leader : son lead, qui reçoit l'objectif.");
    expect(en.home.catalog.leadRule).toBe('A team has exactly one leader seat: its lead, who receives the objective.');
    expect([fr.side.rigs.title, fr.side.rigs.launch, fr.modalTitles.rigLaunch]).toEqual(['Équipes', 'Lancer une équipe', 'Nouvelle équipe']);
    expect(fr.teamLaunch.noProject).toBe('Aucun projet avec un dossier sur cette machine : crée-en un pour y lancer une équipe');
    expect(en.teamLaunch.noProject).toBe('No project with a folder on this machine: create one to launch a team in it');
  });
});
