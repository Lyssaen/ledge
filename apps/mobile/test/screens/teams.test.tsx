import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneTask, PhoneTeam } from '@ledge/protocol';
import { getAssertion } from '../../src/link/webauthn';
import { Agents } from '../../src/screens/Agents';
import { Chat } from '../../src/screens/Chat';
import { Inbox } from '../../src/screens/Inbox';
import { tablesOf } from '../../src/model/teams';
import { pending, session } from '../model/fixtures';
import { chat, snapshot } from '../state/helpers';
import { app } from './app-setup';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));
afterEach(() => { vi.mocked(getAssertion).mockReset(); });

const QID = '0b1e8f7a-4c1d-4a55-9d0e-2f3a4b5c6d7e';
const NOW = new Date().toISOString();
const ON = { confirm: true, chat: true as const };
const team = (extra: Partial<PhoneTeam> = {}): PhoneTeam => ({ id: 'team-a1b2', name: 'ledge-roles', project: 'Ledge', state: 'active', seats: [{ role: 'build', sessionId: 'otto' }, { role: 'qa', sessionId: 'mila' }, { role: 'review', sessionId: null }], done: 1, given: 2, ...extra });
const task = (id: string, extra: Partial<PhoneTask> = {}): PhoneTask => ({ id, title: `Tâche ${id}`, owner: 'otto', ownerName: 'Otto', ownerRole: 'build', team: 'team-a1b2', teamName: 'ledge-roles', state: 'taken', at: NOW, updatedAt: NOW, ...extra });
const sessions = () => [
  session('mila', { name: 'Mila', repo: 'ledge', role: 'qa', team: 'team-a1b2', state: 'waiting_permission', pending: pending() }),
  session('otto', { name: 'Otto', repo: 'ledge', role: 'build', team: 'team-a1b2' }),
  session('pim', { name: 'Pim', repo: 'ledge' }),
  session('arlo', { name: 'Arlo', repo: 'ledge', role: 'build', team: 'team-c3d4', state: 'exited' })
];

/** A PC that knows teams: the snapshot, then its teams and Ledge's tasks. */
function withTeams(tasks: PhoneTask[] = [task('t3fa21c', { state: 'done', result: '41 tests verts' }), task('t91b0d4', { owner: 'mila', ownerName: 'Mila', ownerRole: 'qa' })]) {
  const t = setup();
  t.deliver(snapshot(sessions(), 'PC-Desan', undefined, ON));
  t.deliver({ type: 'teams', teams: [team(), team({ id: 'team-c3d4', name: 'mobile', state: 'resting', seats: [{ role: 'build', sessionId: 'arlo' }], done: 0, given: 0 })] });
  t.deliver({ type: 'tasks', tasks });
  return t;
}

describe('« Ledge » on the phone (ledge home spec §2.4)', () => {
  it('opens on « Le point »: À toi with Oui / Non and Voir, Équipes with progress and Reprendre, Confiées par Ledge', async () => {
    const t = withTeams();
    render(<Chat store={t.store} />);
    expect(screen.getByText('Opérateur · 4 agents, 2 équipes')).toBeInTheDocument();
    const point = screen.getByRole('region', { name: 'Le point' });
    const yours = within(within(point).getByRole('group', { name: 'À toi' }));
    expect(yours.getByText('À TOI · 2')).toBeInTheDocument();
    expect(yours.getByText('pnpm test')).toBeInTheDocument();
    expect(yours.getByText('a fini sa tâche')).toBeInTheDocument();
    fireEvent.click(yours.getByRole('button', { name: 'Oui' }));
    expect(t.of('session.decide')).toMatchObject([{ id: 'mila', decision: 'accept', expect: { key: 'p1' } }]);
    const teams = within(within(point).getByRole('group', { name: 'Équipes' }));
    expect(teams.getByText('ledge-roles')).toBeInTheDocument();
    expect(teams.getByText('3 postes')).toBeInTheDocument();
    expect(teams.getByText('1/2')).toBeInTheDocument();
    fireEvent.click(teams.getByRole('button', { name: 'Reprendre' }));
    expect(t.of('team.resume')).toMatchObject([{ team: 'team-c3d4' }]);
    const given = within(within(point).getByRole('group', { name: 'Confiées par Ledge' }));
    expect(given.getByText('t91b0d4')).toBeInTheDocument();
    expect(given.getByText('prise')).toBeInTheDocument();
    // The suggestions above the composer.
    expect(screen.getByRole('button', { name: 'Monte une équipe…' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Où en est ledge-roles ?' }));
    expect(screen.getByRole('textbox')).toHaveValue('Où en est ledge-roles ?');
    // « Voir » on a finished task opens its owner's thread and puts the task away.
    fireEvent.click(yours.getByRole('button', { name: 'Voir' }));
    expect(t.of('task.seen')).toMatchObject([{ task: 't3fa21c' }]);
    expect(globalThis.location.hash).toBe('#/thread/otto');
  });

  it('a PC without teams keeps the old empty thread', () => {
    const t = setup();
    t.deliver(snapshot([session('a', { name: 'Bix', repo: 'ledge' })], 'Atelier', undefined, ON));
    render(<Chat store={t.store} />);
    expect(screen.queryByRole('region', { name: 'Le point' })).toBeNull();
    expect(screen.getByText(/Fil du téléphone/)).toBeInTheDocument();
  });

  it('the team card: its seats and autonomy, the device check on launch, then « Équipe lancée … confirmé avec la clé de l’appareil »', async () => {
    const t = withTeams([]);
    const card = { project: 'Ledge', name: 'ledge-roles', seats: [{ role: 'build', label: 'Builder', tool: 'claude' as const, model: 'opus', autonomy: 'edits' as const }, { role: 'qa', label: 'QA', tool: 'claude' as const, autonomy: 'auto' as const }] };
    t.deliver(chat.history(chat.turn(QID, { answer: 'Je propose l’équipe.', answeredAt: NOW, team: card, tasks: [{ to: '@build', title: 'Implémenter les rôles' }] })));
    render(<Chat store={t.store} />);
    const region = screen.getByRole('region', { name: 'Équipe proposée' });
    expect(within(region).getByText('nouvelle table dans la pièce Ledge')).toBeInTheDocument();
    expect(within(region).getByText('@qa')).toBeInTheDocument();
    expect(within(region).getByRole('note')).toHaveTextContent('@qa travaillera sans demander.');
    const taskCard = screen.getByRole('region', { name: 'Tâche à confier' });
    expect(within(taskCard).getByRole('button', { name: 'Confier' })).toBeDisabled();
    expect(within(taskCard).getByText('active une fois l’équipe lancée')).toBeInTheDocument();
    vi.mocked(getAssertion).mockResolvedValue({ id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' });
    fireEvent.click(within(region).getByRole('button', { name: 'Lancer l’équipe' }));
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'launch', qid: QID }]);
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'launch', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('chat.team')).toMatchObject([{ qid: QID, assertion: { id: 'a' } }]));
    act(() => t.deliver(chat.history(chat.turn(QID, { answer: 'Je propose l’équipe.', answeredAt: NOW, team: { ...card, teamId: 'team-a1b2', launchedAt: NOW }, tasks: [{ to: '@build', title: 'Implémenter les rôles' }] }))));
    expect(await within(region).findByText(/Équipe lancée à/)).toBeInTheDocument();
    expect(within(region).getByText(/confirmé avec la clé de l’appareil/)).toBeInTheDocument();
    fireEvent.click(within(taskCard).getByRole('button', { name: 'Confier' }));
    expect(t.of('chat.task')).toMatchObject([{ qid: QID, row: 0 }]);
    act(() => t.deliver(chat.history(chat.turn(QID, { answer: 'Je propose l’équipe.', answeredAt: NOW, team: { ...card, teamId: 'team-a1b2', launchedAt: NOW }, tasks: [{ to: '@build', title: 'Implémenter les rôles', taskId: 't91b0d4', ownerName: 'Otto', state: 'taken' }] }))));
    expect(await within(taskCard).findByText('Confiée à Otto · t91b0d4 · prise')).toBeInTheDocument();
  });

  it('the app opens on « Ledge » once paired, but a link to a screen stays put', async () => {
    const a = app('ready', { hash: '#/' });
    act(() => a.deliver(snapshot(sessions(), 'PC-Desan', undefined, ON)));
    await waitFor(() => expect(globalThis.location.hash).toBe('#/chat'));
  });
});

describe('« À traiter » and « Agents » with teams', () => {
  it('« À traiter » counts the closed tasks, has a « Tâches » filter and a card per closed Ledge task', () => {
    const t = withTeams();
    render(<Inbox store={t.store} />);
    expect(screen.getByText('1 demande et 1 tâche finie. Choisissez par où commencer.')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation')).getByText('2')).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'A fini « Tâche t3fa21c »' });
    expect(within(card).getByText('@build')).toBeInTheDocument();
    expect(within(card).getByText('ledge-roles')).toBeInTheDocument();
    expect(within(card).getByText(/Tâche de Ledge · .*41 tests verts/)).toBeInTheDocument();
    expect(within(card).getByText('✓ Tâche finie')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tâches' }));
    expect(screen.queryByText('pnpm test')).toBeNull();
    expect(screen.getByRole('article', { name: 'A fini « Tâche t3fa21c »' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Autorisations' }));
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: /Voir le résultat/ }));
    expect(t.of('task.seen')).toMatchObject([{ task: 't3fa21c' }]);
    // The PC's answer puts it away.
    act(() => t.deliver({ type: 'task.updated', task: task('t3fa21c', { state: 'done', seen: true }) }));
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('« Agents » groups a project by table: ⚑ the team with its progress, the common table, the resting team with « Reprendre »; role pills', () => {
    const t = withTeams();
    render(<Agents store={t.store} />);
    expect(screen.getByText('4 sessions · 1 projet sur ce PC · 1 équipe au travail')).toBeInTheDocument();
    expect(screen.getByText('LEDGE · 3 TABLES')).toBeInTheDocument();
    const groups = screen.getAllByRole('group');
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['Équipe ledge-roles', 'table commune', 'Équipe mobile']);
    const active = within(groups[0]!);
    expect(active.getByText('équipe · opérateur Ledge')).toBeInTheDocument();
    expect(active.getByText('1/2')).toBeInTheDocument();
    expect(active.getByText('@qa')).toBeInTheDocument();
    expect(within(groups[1]!).getByText('Pim')).toBeInTheDocument();
    fireEvent.click(within(groups[2]!).getByRole('button', { name: 'Reprendre' }));
    expect(t.of('team.resume')).toMatchObject([{ team: 'team-c3d4' }]);
  });

  it('a team none of whose sessions the phone knows sits in its project\'s group (any case), else in a group of its own', () => {
    const groups = tablesOf([session('pim', { repo: 'ledge' })], [team({ seats: [] }), team({ id: 'team-c3d4', state: 'resting', seats: [] }), team({ id: 'team-e5f6', project: 'Site', seats: [] })]);
    expect(groups.map(g => [g.label, g.tables.map(t => (t.kind === 'team' ? t.team.id : 'common'))])).toEqual([['ledge', ['team-a1b2', 'common', 'team-c3d4']], ['Site', ['team-e5f6']]]);
  });
});
