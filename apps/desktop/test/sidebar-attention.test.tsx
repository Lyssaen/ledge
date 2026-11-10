import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { pendingKey } from '@ledge/protocol';
import { boot, closeDaemons, listSessions } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

/** The IDE's tab in front of its group (the old top bar named the place: the IDE's tabs do). */
const activeTab = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container')).find(t => t.getAttribute('aria-selected') === 'true');
/** « Your turn » is the IDE's « For you » side view: the activity bar shows it. */
async function yours(side: ReturnType<typeof within>) {
  if (!side.queryByRole('region', { name: 'Your turn' })) fireEvent.click(within(screen.getByRole('navigation', { name: 'Activity bar' })).getByRole('button', { name: /^For you/ }));
  return within(await side.findByRole('region', { name: 'Your turn' }));
}
const cards = (region: ReturnType<typeof within>) => region.getAllByRole('button', { name: /^Open / });

describe('Your turn', () => {
  it('Your turn lists Otto then Kit; Yes sends allow; Reply opens Kit on the field', async () => {
    const sessions = listSessions();
    const otto = sessions[0]!;
    const { d, side, user } = await boot({ sessions });
    const region = await yours(side);
    expect(region.getByText('2')).toBeVisible();
    expect(cards(region).map((b: HTMLElement) => b.textContent)).toEqual(['Otto', 'Kit']);
    await user.click(region.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(d.received).toContainEqual({
      type: 'session.decide', id: otto.id, decision: 'accept',
      expect: { kind: 'permission', text: 'npm test', key: pendingKey(otto.pending!) }
    }));
    await user.click(region.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Reply to the agent' })).toHaveFocus());
  });

  it('No sends deny', async () => {
    const sessions = listSessions();
    const otto = sessions[0]!;
    const { d, side, user } = await boot({ sessions });
    await user.click((await yours(side)).getByRole('button', { name: 'No' }));
    await waitFor(() => expect(d.received).toContainEqual({
      type: 'session.decide', id: otto.id, decision: 'deny',
      expect: { kind: 'permission', text: 'npm test', key: pendingKey(otto.pending!) }
    }));
  });

  it('Alt ↓ cycles the waiting sessions', async () => {
    const { side, user } = await boot({ sessions: listSessions() });
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Otto'));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Kit'));
    expect(activeTab()).not.toHaveAccessibleName('Otto');
  });

  it('a helper-routed request shows ↳ parent', async () => {
    const otto = fakeSession('otto', {
      name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission',
      pending: { kind: 'permission', text: 'npm test', source: 'hook', helperId: 'h1' },
      helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire', state: 'waiting_permission' }]
    });
    const { side } = await boot({ sessions: [otto] });
    const region = await yours(side);
    expect(region.getByRole('button', { name: /^Open Explore/ })).toHaveTextContent('Explore');
    expect(region.getByText('↳ Otto')).toBeVisible();
    fireEvent.contextMenu(region.getByText('↳ Otto'));
    expect(await screen.findByRole('menu', { name: 'Manage Otto' })).toBeVisible();
  });

  it('a plan shows View, not Yes or No', async () => {
    const plan = fakeSession('pia', {
      name: 'Pia', cwd: '/w/ledge', state: 'waiting_permission',
      pending: { kind: 'plan', text: '# Plan', source: 'hook' }
    });
    const { d, side, user } = await boot({ sessions: [plan] });
    const region = await yours(side);
    expect(region.queryByRole('button', { name: 'Yes' })).toBeNull();
    expect(region.queryByRole('button', { name: 'No' })).toBeNull();
    await user.click(region.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Pia'));
    expect(d.received.filter(m => m.type === 'session.decide')).toEqual([]);
  });

  it('a read-only permission shows View, not Yes or No', async () => {
    const ro = fakeSession('ro', {
      name: 'Ro', cwd: '/tmp', source: 'hook_only', state: 'waiting_permission',
      pending: { kind: 'permission', text: 'npm test', source: 'hook' }
    });
    const { d, side, user } = await boot({ sessions: [ro] });
    const region = await yours(side);
    expect(region.queryByRole('button', { name: 'Yes' })).toBeNull();
    expect(region.queryByRole('button', { name: 'No' })).toBeNull();
    await user.click(region.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Ro'));
    expect(d.received.filter(m => m.type === 'session.decide')).toEqual([]);
  });

  it('View opens an error', async () => {
    const err = fakeSession('err', { name: 'Err', cwd: '/tmp', state: 'error' });
    const { side, user } = await boot({ sessions: [err] });
    await user.click((await yours(side)).getByRole('button', { name: 'View' }));
    await waitFor(() => expect(activeTab()).toHaveAccessibleName('Err'));
  });

  it('shows four cards and the rest behind See the other N', async () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const five = [5, 4, 3, 2, 1].map((min, i) => fakeSession(`q${i}`, {
      name: `Q${i}`, cwd: '/tmp', state: 'waiting_input',
      pending: { kind: 'question', text: '?', source: 'hook' },
      lastActivityAt: ago(min)
    }));
    const { side, user } = await boot({ sessions: five });
    const region = await yours(side);
    expect(region.getByText('5')).toBeVisible();
    expect(cards(region).map((b: HTMLElement) => b.textContent)).toEqual(['Q0', 'Q1', 'Q2', 'Q3']);
    expect(region.queryByRole('button', { name: /^Open Q4/ })).toBeNull();
    await user.click(region.getByRole('button', { name: 'See the other 1' }));
    expect(cards(region).map((b: HTMLElement) => b.textContent)).toEqual(['Q0', 'Q1', 'Q2', 'Q3', 'Q4']);
    expect(region.getByRole('button', { name: 'Show less' })).toBeVisible();
  });

  it('Alt ↓ does not open the next waiter while a delete confirmation is open', async () => {
    const { side, user } = await boot({
      sessions: listSessions(),
      daemon: { version: '0.7.0', install: 'npm', systemd: true, archive: true }
    });
    fireEvent.contextMenu(within(side.getByRole('tree', { name: 'Projects, branches and sessions' })).getByRole('button', { name: /^Otto/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete Otto?' })).toBeVisible();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(screen.getByRole('alertdialog', { name: 'Delete Otto?' })).toBeVisible();
    expect(activeTab()).toHaveAccessibleName('Atelier');
  });

  it('Ctrl ⇧ E focuses the open session in the tree, else the first row', async () => {
    const { side, user } = await boot({ sessions: listSessions() });
    await user.keyboard('{Control>}{Shift>}e{/Shift}{/Control}');
    expect(document.activeElement).toHaveAttribute('data-tree-key', 'p:ledge');
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Control>}{Shift>}e{/Shift}{/Control}');
    expect(document.activeElement).toHaveAttribute('data-tree-key', 'local:otto');
  });
});
