import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DaemonInfo } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, PROJECTS, type MockDaemon } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true };
const sent = (d: MockDaemon) => d.received.filter(m => m.type !== 'snapshot.request');
const archives = (d: MockDaemon) => sent(d).filter(m => m.type === 'session.archive');

const treeOf = (side: ReturnType<typeof within>) => within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));

const menuLabels = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map(i => i.getAttribute('aria-label'));

describe('archive and delete from the sidebar tree', () => {
  it('the … button and a right click open the same session menu; E archives a finished principal', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: listSessions(), daemon: CAN });
    const tree = treeOf(side);
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    expect(tree.getByRole('button', { name: /^Bix/ })).toBeVisible();

    // A subagent row has no archive and no delete: E and Suppr on Explore send nothing and ask nothing.
    await user.click(tree.getByRole('button', { name: /Show Otto.s subagents/ }));
    tree.getByRole('button', { name: /^Explore/ }).focus();
    await user.keyboard('e');
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(archives(d)).toEqual([]);
    expect(sent(d).some(m => m.type === 'session.delete')).toBe(false);

    // Suppr asks before it deletes a principal, and sends nothing until the dialog is confirmed.
    tree.getByRole('button', { name: /^Rio/ }).focus();
    await user.keyboard('{Delete}');
    expect(await screen.findByRole('alertdialog', { name: 'Delete Rio?' })).toBeVisible();
    expect(sent(d).some(m => m.type === 'session.delete')).toBe(false);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    tree.getByRole('button', { name: /^Bix/ }).focus();
    await user.keyboard('e');
    await waitFor(() => expect(archives(d)).toEqual([{ type: 'session.archive', id: 'bix' }]));
    expect(screen.getByRole('status')).toHaveTextContent('Bix is archived.');
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument();

    fireEvent.contextMenu(tree.getByRole('button', { name: /^Otto/ }));
    const fromPointer = await screen.findByRole('menu', { name: 'Manage Otto' });
    const labels = menuLabels(fromPointer);
    expect(labels).toEqual(['Open session', 'Terminal', 'Rename…', 'Move to…', 'End session', 'End and archive…', 'Delete…']);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    tree.getByRole('button', { name: /^Otto/ }).focus();
    await user.click(tree.getByRole('button', { name: /Manage Otto.s session/ }));
    const fromDots = await screen.findByRole('menu', { name: 'Manage Otto' });
    expect(menuLabels(fromDots)).toEqual(labels);
    await user.keyboard('{Escape}');

    // The row's terminal button is the menu's: openSessionTerminal tells the session it is focused.
    tree.getByRole('button', { name: /^Otto/ }).focus();
    await user.click(tree.getByRole('button', { name: /Open Otto.s terminal/ }));
    await waitFor(() => expect(sent(d)).toContainEqual({ type: 'session.focus', id: 'otto' }));
  });

  it('the +N finished row only shows the finished sessions: no group Archive button', async () => {
    const { d, side, user } = await boot({ projects: PROJECTS, sessions: listSessions(), daemon: CAN });
    const tree = treeOf(side);
    const more = tree.getByRole('button', { name: '+1 finished' }).closest('.st-more');
    expect(more).not.toBeNull();
    expect(within(more as HTMLElement).queryByRole('button', { name: /Archive/ })).toBeNull();
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    expect(tree.getByRole('button', { name: /^Bix/ })).toBeVisible();
    // Once shown, the row has nothing left to offer: it goes, and nothing was archived on the way.
    expect(tree.queryByRole('button', { name: '+1 finished' })).toBeNull();
    expect(side.getByRole('tree').querySelector('.st-more')).toBeNull();
    expect(archives(d)).toEqual([]);
  });

  it('a machine without daemon.archive sends nothing', async () => {
    const { d, side, user } = await boot({
      projects: PROJECTS, sessions: listSessions(),
      daemon: { version: '0.7.0', install: 'npm', systemd: true }
    });
    const tree = treeOf(side);
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    tree.getByRole('button', { name: /^Bix/ }).focus();
    await user.keyboard('e');
    expect(archives(d)).toEqual([]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('status')).not.toHaveTextContent(/archived/);
  });
});
