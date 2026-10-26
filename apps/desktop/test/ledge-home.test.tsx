import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatTurn, ClientMessage, Task, Team } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { mentionAt } from '../src/chat/LedgeHome';

const T0 = new Date().toISOString();
const team: Team = { id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'build', sessionId: 'otto' }, { role: 'review', sessionId: 'pim' }], createdAt: T0, updatedAt: T0 };
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', team: 'team-a1b2', state: 'open', at: T0, updatedAt: T0, log: [{ at: T0, by: 'Ledge', what: 'confiée à Otto' }], ...extra });
const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const point = () => within(screen.getByRole('region', { name: 'The point' }));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openHome() {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, sessions: [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', team: 'team-a1b2', role: 'build', pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } }),
    fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working', team: 'team-a1b2', role: 'review' })
  ] });
  await screen.findByRole('region', { name: 'The point' });
  return env;
}

describe('Ledge’s home view (ledge home spec)', () => {
  it('is where the app opens: header, tabs, « The point » built from the daemon’s state, the composer and its reminder', async () => {
    const { d } = await openHome();
    expect(home().getByText(/^Operator · sees 2 sessions, 0 teams, 1 machine · read only$/)).toBeVisible();
    expect(home().getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
    // What waits for the user, answerable in place.
    const yours = within(point().getByLabelText('Yours'));
    await yours.findByText('pnpm test');
    expect(yours.getByRole('button', { name: 'Yes' })).toBeVisible();
    d.push({ type: 'teams', teams: [team] });
    d.push({ type: 'task.updated', task: task('t000001', { state: 'done', result: 'fait' }) });
    d.push({ type: 'task.updated', task: task('t000002', { state: 'taken' }) });
    // A closed task Ledge gave is an item of « Yours » until put away.
    await yours.findByText(/Otto finished “Tâche t000001”/);
    const teams = within(point().getByLabelText('Teams'));
    expect(await teams.findByText('ledge-roles')).toBeVisible();
    expect(teams.getByText('1/2')).toBeVisible();
    const given = within(point().getByLabelText('Given by Ledge'));
    expect(given.getByText('Tâche t000002')).toBeVisible();
    expect(home().getByRole('tab', { name: 'Teams · 1' })).toBeVisible();
    expect(home().getByText('read only · nothing without your click')).toBeVisible();
    expect(home().getByRole('button', { name: 'Where is ledge-roles at?' })).toBeVisible();
  });

  it('« Dismiss » puts a closed Ledge task away; « See » opens it in the Tasks tab with its history', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'teams', teams: [team] });
    d.push({ type: 'task.updated', task: task('t000001', { state: 'done', result: 'fait' }) });
    const row = await screen.findByText(/Otto finished “Tâche t000001”/);
    await user.click(within(row.closest('.lp-row') as HTMLElement).getByRole('button', { name: 'See' }));
    expect(home().getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true');
    const detail = await screen.findByRole('region', { name: 'Tâche t000001' });
    expect(within(detail).getByText('fait')).toBeVisible();
    expect(within(detail).getByText(/confiée à Otto/)).toBeVisible();
    await user.click(home().getByRole('tab', { name: 'Conversation' }));
    await user.click(within((await screen.findByText(/Otto finished/)).closest('.lp-row') as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'task.cmd', rid: expect.any(String), by: 'ledge', op: 'seen', task: 't000001' }));
  });

  it('a team card launches its team and keeps the outcome; its task cards wait for it, then give and follow their task', async () => {
    const { d, user } = await openHome();
    await user.type(home().getByRole('textbox', { name: 'Ask Ledge' }), 'Monte une équipe{Enter}');
    await waitFor(() => expect(d.received.some(m => m.type === 'chat.ask')).toBe(true));
    const { qid } = d.received.find((m): m is Extract<ClientMessage, { type: 'chat.ask' }> => m.type === 'chat.ask')!;
    const proposed: ChatTurn = { qid, question: 'Monte une équipe', askedAt: T0, steps: [], answer: 'Une équipe.', answeredAt: T0,
      team: { cwd: '/w/ledge', project: 'ledge', projectName: 'Ledge', name: 'ledge-roles', seats: [{ role: 'build', label: 'Build', tool: 'claude', model: 'opus', autonomy: 'edits' }, { role: 'review', label: 'Relecteur', tool: 'codex', autonomy: 'auto' }] },
      tasks: [{ to: '@build', title: 'Implémenter les rôles' }] };
    d.push({ type: 'chat.history', turns: [proposed] });
    const card = await screen.findByRole('region', { name: 'Proposed team' });
    expect(within(card).getByText('new table in the Ledge room')).toBeVisible();
    expect(within(card).getByText('@review')).toBeVisible();
    expect(within(card).getByRole('note')).toHaveTextContent('@review will work without asking');
    const tasks = screen.getByRole('region', { name: 'Task to give' });
    expect(within(tasks).getByRole('button', { name: 'Give' })).toBeDisabled();
    expect(within(tasks).getByText('active once the team is launched')).toBeVisible();
    await user.click(within(card).getByRole('button', { name: /Launch the team/ }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'team.launch', rid: expect.any(String), qid }));
    const rid = (d.received.find(m => m.type === 'team.launch') as { rid: string }).rid;
    d.push({ type: 'team.launched', rid, team });
    d.push({ type: 'chat.history', turns: [{ ...proposed, team: { ...proposed.team!, teamId: team.id, launchedAt: T0 } }] });
    await within(card).findByText(/Team launched at/);
    expect(within(card).getByRole('button', { name: 'Open the table' })).toBeVisible();
    await user.click(within(tasks).getByRole('button', { name: 'Give' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'task.cmd', rid: expect.any(String), by: 'ledge', op: 'give', qid, row: 0 }));
    d.push({ type: 'chat.history', turns: [{ ...proposed, team: { ...proposed.team!, teamId: team.id, launchedAt: T0 }, tasks: [{ ...proposed.tasks![0]!, taskId: 't91b0d4', ownerName: 'Otto', state: 'taken', givenAt: T0 }] }] });
    expect(await within(tasks).findByText(/Given to Otto · t91b0d4 · taken/)).toBeVisible();
  });

  it('@ and # complete a session and a team in the composer', () => {
    expect(mentionAt('ask @ot')).toEqual({ sigil: '@', query: 'ot', start: 4 });
    expect(mentionAt('#led')).toEqual({ sigil: '#', query: 'led', start: 0 });
    expect(mentionAt('mail a@b')).toBeNull();
    expect(mentionAt('done ')).toBeNull();
  });
});
