import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatTurn, ClientMessage, Task } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { mentionAt } from '../src/chat/LedgeHome';

const T0 = new Date().toISOString();
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'open', at: T0, updatedAt: T0, log: [{ at: T0, by: 'Ledge', what: 'confiée à Otto' }], ...extra });
const LOCAL = [{ id: 'local', label: 'Local' }];
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const point = () => within(screen.getByRole('region', { name: 'The point' }));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openHome(opts: Partial<Pick<Parameters<typeof boot>[0] & object, 'machines' | 'projects'>> = {}) {
  const env = await boot({ home: true, machines: LOCAL, projects: PROJECTS, ...opts, sessions: [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } }),
    fakeSession('pim', { name: 'Pim', cwd: '/w/ledge', state: 'working' })
  ] });
  await screen.findByRole('region', { name: 'The point' });
  return env;
}

describe('Ledge’s home view (ledge home spec)', () => {
  it('is where the app opens: header, tabs, « The point » built from the daemon’s state, the composer and its reminder', async () => {
    const { d } = await openHome();
    expect(home().getByText(/^Operator · sees 2 sessions, 1 machine · read only$/)).toBeVisible();
    expect(home().getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
    // What waits for the user, answerable in place.
    const yours = within(point().getByLabelText('Yours'));
    await yours.findByText('pnpm test');
    expect(yours.getByRole('button', { name: 'Yes' })).toBeVisible();
    d.push({ type: 'task.updated', task: task('t000001', { state: 'done', result: 'fait' }) });
    d.push({ type: 'task.updated', task: task('t000002', { state: 'taken' }) });
    // A closed task Ledge gave is an item of « Yours » until put away.
    await yours.findByText(/Otto finished “Tâche t000001”/);
    const given = within(point().getByLabelText('Given by Ledge'));
    expect(given.getByText('Tâche t000002')).toBeVisible();
    expect(home().getAllByRole('tab').map(x => x.textContent)).toEqual(['Conversation', 'Tasks · 1', 'History']);
    expect(home().getByText('read only · nothing without your click')).toBeVisible();
    expect(home().getByRole('button', { name: 'Who needs me?' })).toBeVisible();
  });

  it('« Dismiss » puts a closed Ledge task away; « See » opens it in the Tasks tab with its history', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'task.updated', task: task('t000001', { state: 'done', result: 'fait' }) });
    const row = await point().findByText(/Otto finished “Tâche t000001”/);
    // The sidebar's « Yours » has it too.
    expect(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByText(/Otto finished “Tâche t000001”/)).toBeVisible();
    await user.click(within(row.closest('.lp-row') as HTMLElement).getByRole('button', { name: 'See' }));
    expect(home().getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true');
    const detail = await screen.findByRole('region', { name: 'Tâche t000001' });
    expect(within(detail).getByText('fait')).toBeVisible();
    expect(within(detail).getByText(/confiée à Otto/)).toBeVisible();
    await user.click(home().getByRole('tab', { name: 'Conversation' }));
    await user.click(within((await point().findByText(/Otto finished/)).closest('.lp-row') as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'task.cmd', rid: expect.any(String), by: 'ledge', op: 'seen', task: 't000001' }));
  });

  it('a task card gives its task and follows it', async () => {
    const { d, user } = await openHome();
    await user.type(home().getByRole('textbox', { name: 'Ask Ledge' }), 'Confie les rôles à Otto{Enter}');
    await waitFor(() => expect(d.received.some(m => m.type === 'chat.ask')).toBe(true));
    const { qid } = d.received.find((m): m is Extract<ClientMessage, { type: 'chat.ask' }> => m.type === 'chat.ask')!;
    const proposed: ChatTurn = { qid, question: 'Confie les rôles à Otto', askedAt: T0, steps: [], answer: 'Une tâche.', answeredAt: T0,
      tasks: [{ to: 'otto', title: 'Implémenter les rôles' }] };
    d.push({ type: 'chat.history', turns: [proposed] });
    const tasks = await screen.findByRole('region', { name: 'Task to give' });
    await user.click(within(tasks).getByRole('button', { name: 'Give' }));
    await waitFor(() => expect(d.received).toContainEqual({ type: 'task.cmd', rid: expect.any(String), by: 'ledge', op: 'give', qid, row: 0 }));
    expect(within(tasks).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    const rid = (d.received.find(m => m.type === 'task.cmd' && m.op === 'give') as { rid: string }).rid;
    d.push({ type: 'task.result', rid });
    d.push({ type: 'chat.history', turns: [{ ...proposed, tasks: [{ ...proposed.tasks![0]!, taskId: 't91b0d4', ownerName: 'Otto', state: 'taken', givenAt: T0 }] }] });
    expect(await within(tasks).findByText(/Given to Otto · t91b0d4 · taken/)).toBeVisible();
  });

  it('@ completes a session in the composer', () => {
    expect(mentionAt('ask @ot')).toEqual({ query: 'ot', start: 4 });
    expect(mentionAt('#led')).toBeNull();
    expect(mentionAt('mail a@b')).toBeNull();
    expect(mentionAt('done ')).toBeNull();
  });
});
