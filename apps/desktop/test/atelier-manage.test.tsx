import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DaemonInfo } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, type MockDaemon } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true };
const OLD: DaemonInfo = { version: '0.6.0', install: 'npm', systemd: true };

const otto = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list', helpers: [{ id: 'h1', kind: 'Explore', task: 'Read the code', state: 'working' }] });
const bix = fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'exited', topic: 'Review the PR' });
const cleo = fakeSession('cleo', { name: 'Cleo', cwd: '/w/ledge', state: 'exited', topic: 'Old task' });
const nova = fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' });
const kit = fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' });
const SESSIONS = [otto, bix, cleo, nova, kit];

const sent = (d: MockDaemon) => d.received.filter(m => m.type !== 'snapshot.request');
/** J walks the agents; stops on the one named. */
async function walkTo(user: { keyboard(k: string): Promise<void> }, name: string) {
  for (let i = 0; i < 6 && document.activeElement !== seat(name); i++) await user.keyboard('j');
  expect(seat(name)).toHaveFocus();
}
const seat = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) });

describe('the session menu in the atelier', () => {
  it('right click on a seat opens the session menu at the pointer; Archiver on a finished agent archives it', async () => {
    const { d, user } = await boot({ sessions: SESSIONS, daemon: CAN });
    fireEvent.contextMenu(seat('Bix'), { clientX: 120, clientY: 80 });
    const menu = await screen.findByRole('menu', { name: 'Manage Bix' });
    expect(menu).toHaveStyle({ position: 'fixed' });
    expect(within(menu).getAllByRole('menuitem').map(i => i.getAttribute('aria-label'))).toEqual([
      'Open session', 'Terminal', 'Rename…', 'Move to…', 'Resume session', 'Archive', 'Delete…'
    ]);
    await user.click(within(menu).getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.archive', id: 'bix' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a live agent offers End and End and archive; the sub-agent note says who leaves with it', async () => {
    const { user } = await boot({ sessions: SESSIONS, daemon: CAN });
    fireEvent.contextMenu(seat('Otto'));
    const menu = await screen.findByRole('menu', { name: 'Manage Otto' });
    expect(within(menu).getAllByRole('menuitem').map(i => i.getAttribute('aria-label'))).toEqual([
      'Open session', 'Terminal', 'Rename…', 'Move to…', 'End session', 'End and archive…', 'Delete…'
    ]);
    expect(within(menu).getByText('1 subagent leaves with Otto.')).toBeVisible();
    await user.click(within(menu).getByRole('menuitem', { name: /^End and archive/ }));
    expect(await screen.findByRole('alertdialog', { name: 'End and archive Otto?' })).toBeVisible();
  });

  it('the seat « … » opens the same menu; Escape closes it and gives the focus back', async () => {
    const { user } = await boot({ sessions: SESSIONS, daemon: CAN });
    const more = screen.getByRole('button', { name: 'Manage Bix' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(more);
    const menu = await screen.findByRole('menu', { name: 'Manage Bix' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Open session' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('E archives, Del asks to delete, F2 renames and T opens the terminal of the focused agent; a sub-agent seat has no menu', async () => {
    const { d, user } = await boot({ sessions: SESSIONS, daemon: CAN });
    await walkTo(user, 'Bix');
    await user.keyboard('e');
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.archive', id: 'bix' }));
    await walkTo(user, 'Cleo');
    await user.keyboard('t');
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.focus', id: 'cleo' }));
    await user.keyboard('{Delete}');
    expect(await screen.findByRole('alertdialog', { name: 'Delete Cleo?' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sent(d).some(m => m.type === 'session.delete')).toBe(false);

    // F2 on a live agent: a small dialog, whose answer is session.rename.
    await walkTo(user, 'Otto');
    await user.keyboard('{F2}');
    const dialog = await screen.findByRole('dialog', { name: /Rename/ });
    const field = within(dialog).getByRole('textbox');
    expect(field).toHaveValue(otto.topic);
    await user.clear(field);
    await user.type(field, 'Wire the atelier{Enter}');
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.rename', id: 'otto', topic: 'Wire the atelier' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // A sub-agent seat opens no menu.
    const helper = screen.getByRole('button', { name: /^Explore, subagent of Otto/ });
    fireEvent.contextMenu(helper);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: /Manage Explore/ })).toBeNull();
  });

  it('Rename… is disabled for a finished session', async () => {
    await boot({ sessions: SESSIONS, daemon: CAN });
    fireEvent.contextMenu(seat('Bix'));
    expect(await screen.findByRole('menuitem', { name: 'Rename…' })).toBeDisabled();
  });

  it('the table menu archives every finished principal of that table', async () => {
    const { d, user } = await boot({ sessions: SESSIONS, daemon: CAN });
    await user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive finished' }));
    await waitFor(() => expect(sent(d).filter(m => m.type === 'session.archive')).toEqual([{ type: 'session.archive', id: 'bix' }, { type: 'session.archive', id: 'cleo' }]));
  });

  it('Move to… files the session into the chosen project', async () => {
    const { d, user } = await boot({ sessions: SESSIONS, daemon: CAN });
    fireEvent.contextMenu(seat('Bix'));
    const menu = await screen.findByRole('menu', { name: 'Manage Bix' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to…' }));
    expect(within(menu).queryByRole('menuitem', { name: 'Ledge' })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Docs' }));
    await waitFor(() => expect(d.received.some(m => m.type === 'projects.set')).toBe(true));
    expect(d.received.find(m => m.type === 'projects.set')).toMatchObject({ projects: { rules: [{ machine: 'local', path: '/w/ledge', project: 'docs' }] } });
  });

  it('a card of No project has the menu too', async () => {
    await boot({ sessions: SESSIONS, daemon: CAN });
    fireEvent.contextMenu(within(screen.getByRole('region', { name: 'No project' })).getByRole('button', { name: /^Kit,/ }));
    expect(await screen.findByRole('menu', { name: 'Manage Kit' })).toBeVisible();
  });

  it('a machine that cannot archive: Archive, Delete and Resume are disabled and say to update Ledge there', async () => {
    const { d } = await boot({ sessions: SESSIONS, daemon: OLD });
    fireEvent.contextMenu(seat('Bix'));
    const menu = await screen.findByRole('menu', { name: 'Manage Bix' });
    for (const name of ['Resume session', 'Archive', 'Delete…']) {
      const item = within(menu).getByRole('menuitem', { name });
      expect(item).toBeDisabled();
      expect(item).toHaveAttribute('title', 'Update Ledge on Local');
    }
    expect(within(menu).getByRole('menuitem', { name: 'Open session' })).toBeEnabled();
    expect(sent(d)).toEqual([]);
  });
});
