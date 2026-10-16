import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, listSessions, type MockDaemon } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const row = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) });
const decides = (d: MockDaemon) => d.received.filter(m => m.type === 'session.decide');
/** Only « Ouvrir » (its name also holds the Kbd hint). */
const onlyOpen = (el: HTMLElement) => {
  expect(within(el).queryByRole('button', { name: /^(Allow|Deny|Reply|Move to…)$/ })).toBeNull();
  expect(within(el).getByRole('button', { name: /^Open/ })).toBeInTheDocument();
};

describe('the List quick actions', () => {
  it('Allow sends one decision; the buttons wait; the row moves once the daemon says the agent resumed', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    const allow = within(row('Otto')).getByRole('button', { name: 'Allow' });
    await user.dblClick(allow);
    await waitFor(() => expect(decides(d)).toEqual([{ type: 'session.decide', id: 'otto', decision: 'accept' }]));
    expect(allow).toBeDisabled();
    expect(within(row('Otto')).getByRole('button', { name: 'Deny' })).toBeDisabled();
    d.upsert({ ...listSessions()[0]!, state: 'working', pending: undefined });
    await waitFor(() => expect(within(row('Otto')).getByText('Running')).toBeVisible());
    expect(within(row('Otto')).queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(row('Otto')).toHaveClass('flash');
  });
  it('a refusal from the daemon is said in plain words and gives the buttons back', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    await user.click(within(row('Otto')).getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(decides(d)).toHaveLength(1));
    d.push({ type: 'error', id: 'otto', message: 'no pending request' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not send the decision to Otto: Local: no pending request'));
    expect(within(row('Otto')).getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(within(row('Otto')).getByText('Approval')).toBeVisible();
  });
  it('a question offers Reply, which opens the session; offline, a plan, a subagent offer only Open', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    onlyOpen(row('Rio'));
    d.upsert(fakeSession('pia', { name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'plan', text: 'Plan', source: 'hook' } }));
    onlyOpen(await screen.findByRole('listitem', { name: /^Pia,/ }));
    await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
    onlyOpen(screen.getByRole('listitem', { name: /subagent of Otto/ }));
    await user.click(within(row('Kit')).getByRole('button', { name: 'Reply' }));
    expect(within(screen.getByRole('banner')).getByText('Kit')).toBeVisible();
  });
  it('Open shows the Enter hint only where no decision or reply is offered; a subagent opens its parent', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    expect(within(row('Otto')).getByRole('button', { name: /^Open/ })).toHaveAccessibleName('Open');
    expect(within(row('Kit')).getByRole('button', { name: /^Open/ })).toHaveAccessibleName('Open');
    expect(within(row('Nova')).getByRole('button', { name: /^Open/ })).toHaveAccessibleName('Open Enter');
    expect(within(row('Nova')).getByRole('button', { name: /^Open/ })).toHaveAttribute('title', 'Open the session (Enter)');
    await user.click(within(row('Otto')).getByRole('button', { name: 'Show 1 subagent' }));
    await user.click(within(screen.getByRole('listitem', { name: /subagent of Otto/ })).getByRole('button', { name: /^Open/ }));
    expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible();
  });
  it('clicking a row button chooses the row: once the decision lands and the buttons go, the focus is on that row', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    await user.keyboard('jjjj'); expect(row('Nova')).toHaveFocus();
    await user.click(within(row('Otto')).getByRole('button', { name: 'Allow' }));
    expect(row('Otto')).toHaveClass('keyboard-selected');
    expect(row('Nova')).not.toHaveClass('keyboard-selected');
    await waitFor(() => expect(decides(d)).toHaveLength(1));
    d.upsert({ ...listSessions()[0]!, state: 'working', pending: undefined });
    await waitFor(() => expect(within(row('Otto')).queryByRole('button', { name: 'Allow' })).toBeNull());
    await waitFor(() => expect(row('Otto')).toHaveFocus());
  });
});
