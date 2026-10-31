import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, Task } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS } from './helpers';
import { decisionOptions } from '../src/teams/useTeamsApi';

const T0 = new Date().toISOString();
/** A decision Otto put to the user (`ledge task give ledge …`): giver the session, owner Ledge. */
const decision = (extra: Partial<Task> = {}): Task => ({ id: 't00000d', title: 'Fusionner feat/roles ?', text: '- Oui, fusionne\n- Non, attends la revue', giver: 'otto', giverName: 'Otto', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: T0, updatedAt: T0, log: [{ at: T0, by: 'Otto', what: 'confiée à Ledge' }], ...extra });
const given = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'open', at: T0, updatedAt: T0, log: [], ...extra });
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const point = () => within(screen.getByRole('region', { name: 'The point' }));
const side = () => within(screen.getByRole('complementary', { name: 'Sidebar' }));
/** What « Répondre » may send: the registry action, never a task command. */
const answers = (received: readonly ClientMessage[]) => received.filter(m => m.type === 'action.run' || (m.type === 'task.cmd' && m.op !== 'list'));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

async function openHome() {
  const env = await boot({ home: true, machines: [{ id: 'local', label: 'Local' }], projects: PROJECTS, sessions: [fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' })] });
  await screen.findByRole('region', { name: 'The point' });
  env.d.push({ type: 'task.updated', task: decision() });
  await point().findByText('Fusionner feat/roles ?');
  return env;
}

describe('a decision a session puts to the user', () => {
  it('is in « Yours » of the point and of the sidebar, who asks, its title and options, and counts in their badges', async () => {
    await openHome();
    const yours = within(point().getByLabelText('Yours'));
    const row = yours.getByText('Fusionner feat/roles ?').closest('.lp-decision') as HTMLElement;
    expect(within(row).getByText('Otto')).toBeVisible();
    expect(row.querySelector('.lp-detail')?.textContent).toBe('- Oui, fusionne\n- Non, attends la revue');
    expect(within(row).getByRole('button', { name: 'Answer' })).toBeVisible();
    expect(yours.getByText('1')).toBeVisible();
    const bar = within(side().getByRole('region', { name: 'Your turn' }));
    const card = bar.getByText('Fusionner feat/roles ?').closest('.st-card') as HTMLElement;
    expect(within(card).getByText('Otto')).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Answer' })).toBeVisible();
    expect(bar.getByText('1')).toBeVisible();
    expect(side().getByText(/^1 yours ·/)).toBeVisible();
    // Not a task Ledge gave.
    expect(within(point().getByLabelText('Given by Ledge')).queryByText('Fusionner feat/roles ?')).toBeNull();
  });

  it('« Answer » shows the answer whole, asks for a confirmation, then sends task.answer and nothing else', async () => {
    const { d, user } = await openHome();
    const row = point().getByText('Fusionner feat/roles ?').closest('.lp-decision') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Answer' }));
    const form = within(within(row).getByRole('form', { name: 'Answer to “Fusionner feat/roles ?”' }));
    const field = form.getByRole('textbox', { name: 'Your answer' });
    expect(field).toHaveValue('');
    expect(form.getByRole('button', { name: 'Send the answer' })).toBeDisabled();
    // An option fills the field; the user still writes what goes.
    await user.click(form.getByRole('button', { name: 'Oui, fusionne' }));
    expect(field).toHaveValue('Oui, fusionne');
    await user.type(field, ' après la CI');
    await user.click(form.getByRole('button', { name: 'Send the answer' }));
    expect(form.getByText('Oui, fusionne après la CI')).toBeVisible();
    expect(form.getByText(/cannot be taken back/)).toBeVisible();
    expect(answers(d.received)).toEqual([]);
    d.onMessage(m => { if (m.type === 'action.run') d.push({ type: 'action.result', rid: m.rid, action: m.action, reason: 'task t00000d is closed', code: 'closed' }); });
    await user.click(form.getByRole('button', { name: 'Confirm and send' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Answer refused: task t00000d is closed');
    expect(answers(d.received)).toEqual([{ type: 'action.run', rid: expect.any(String), action: 'task.answer', args: { task: 't00000d', answer: 'Oui, fusionne après la CI' }, confirmed: true }]);
  });

  it('the sidebar answers in place; once done, the form closes', async () => {
    const { d, user } = await openHome();
    const card = side().getByText('Fusionner feat/roles ?').closest('.st-card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Answer' }));
    await user.type(within(card).getByRole('textbox', { name: 'Your answer' }), 'Non');
    await user.click(within(card).getByRole('button', { name: 'Send the answer' }));
    d.onMessage(m => { if (m.type === 'action.run') d.push({ type: 'action.result', rid: m.rid, action: m.action }); });
    await user.click(within(card).getByRole('button', { name: 'Confirm and send' }));
    await waitFor(() => expect(within(card).queryByRole('form')).toBeNull());
    expect(answers(d.received)).toEqual([{ type: 'action.run', rid: expect.any(String), action: 'task.answer', args: { task: 't00000d', answer: 'Non' }, confirmed: true }]);
    // Answered, the daemon closes it: it leaves « Yours ».
    d.push({ type: 'task.updated', task: decision({ state: 'done', result: 'Non' }) });
    await waitFor(() => expect(side().queryByText('Fusionner feat/roles ?')).toBeNull());
    expect(point().queryByText('Fusionner feat/roles ?')).toBeNull();
  });

  it('« Tasks »: « Decisions » keeps the decisions alone, « The seats » no longer has them; an open one offers « Answer »', async () => {
    const { d, user } = await openHome();
    d.push({ type: 'task.updated', task: given('t000001') });
    d.push({ type: 'task.updated', task: given('t000002', { giver: 'pim', giverName: 'Pim' }) });
    await user.click(home().getByRole('tab', { name: /Tasks/ }));
    const giver = home().getByRole('combobox', { name: 'Giver' });
    const titles = () => home().getAllByRole('button').filter(b => b.classList.contains('lp-task')).map(b => b.querySelector('strong')?.textContent);
    await waitFor(() => expect(titles()).toHaveLength(3));
    await user.selectOptions(giver, 'decisions');
    expect(titles()).toEqual(['Fusionner feat/roles ?']);
    await user.selectOptions(giver, 'seats');
    expect(titles()).toEqual(['Tâche t000002']);
    await user.selectOptions(giver, 'ledge');
    expect(titles()).toEqual(['Tâche t000001']);
    await user.selectOptions(giver, 'decisions');
    await user.click(home().getByText('Fusionner feat/roles ?'));
    const detail = within(await screen.findByRole('region', { name: 'Fusionner feat/roles ?' }));
    await user.click(detail.getByRole('button', { name: 'Answer' }));
    expect(detail.getByRole('textbox', { name: 'Your answer' })).toHaveValue('');
  });
});

describe('decisionOptions', () => {
  it('reads one option per line, list marks left out; a single line offers none', () => {
    expect(decisionOptions('1. Oui\n2) Non\n\n* Plus tard')).toEqual(['Oui', 'Non', 'Plus tard']);
    expect(decisionOptions('Oui ou non ?')).toEqual([]);
    expect(decisionOptions(undefined)).toEqual([]);
  });
});
