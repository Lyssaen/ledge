import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonInfo } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import type { ContextMenuState } from '../src/manage/useContextMenu';
import type { SessionActions } from '../src/manage/useSessionActions';
import { SidebarMenuHost } from '../src/shell/sidebar/SidebarMenus';
import { boot, closeDaemons, listSessions, PROJECTS, recordToasts, type MockDaemon } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true };
const treeOf = (side: ReturnType<typeof within>) => within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
const menuLabels = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map(i => i.getAttribute('aria-label'));
/** The row of a project or « No project »: the tree item that holds its main button. */
const rowOf = (el: HTMLElement) => el.closest<HTMLElement>('[role="treeitem"]')!;

async function bootTree(daemon: DaemonInfo = { ...CAN, broadcast: true }) {
  const booted = await boot({ projects: PROJECTS, sessions: listSessions(), daemon });
  return { ...booted, tree: treeOf(booted.side) };
}

describe('the menu of a project row', () => {
  it('right click on a project lists New session here, Write to the whole project…, Add a folder…, Edit project…, Fold, Delete project…', async () => {
    const { tree } = await bootTree();
    fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^Ledge/ })));
    const menu = screen.getByRole('menu', { name: 'Actions for Ledge' });
    expect(menuLabels(menu)).toEqual(['New session here', 'Write to the whole project…', 'Add a folder…', 'Edit project…', 'Fold', 'Delete project…']);
  });

  it('a daemon that does not take a broadcast: no Write to the whole project…', async () => {
    const { tree } = await bootTree(CAN);
    fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^Ledge/ })));
    expect(screen.queryByRole('menuitem', { name: 'Write to the whole project…' })).toBeNull();
  });

  it('New session here opens the launcher on that project', async () => {
    const { tree, user } = await bootTree();
    fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^Payment Service/ })));
    await user.click(screen.getByRole('menuitem', { name: 'New session here' }));
    const form = within(await screen.findByRole('dialog', { name: 'New session' }));
    expect(form.getByRole('radio', { name: 'Payment Service Platform Migration Europe' })).toBeChecked();
  });

  it('Add a folder… opens the editor of that project on its folder browser', async () => {
    const { tree, user } = await bootTree();
    fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^Ledge/ })));
    await user.click(screen.getByRole('menuitem', { name: 'Add a folder…' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit Ledge' }));
    expect(await editor.findByRole('radiogroup', { name: 'Machine to browse' })).toBeInTheDocument();
  });

  it('Fold folds the project; the menu then says Unfold', async () => {
    const { tree, user } = await bootTree();
    const row = () => rowOf(tree.getByRole('button', { name: /^Ledge/ }));
    expect(row()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.contextMenu(row());
    await user.click(screen.getByRole('menuitem', { name: 'Fold' }));
    expect(row()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.contextMenu(row());
    expect(screen.getByRole('menuitem', { name: 'Unfold' })).toBeInTheDocument();
  });

  it('Delete project… opens the editor on its deletion view', async () => {
    const { tree, user } = await bootTree();
    fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^Ledge/ })));
    await user.click(screen.getByRole('menuitem', { name: 'Delete project…' }));
    expect(await screen.findByRole('dialog', { name: 'Delete Ledge' })).toBeVisible();
  });

  it('the native menu is prevented on a project row', async () => {
    const { tree } = await bootTree();
    expect(fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^Ledge/ })))).toBe(false);
  });

  it('a right click on a project while a session menu is open replaces it; Escape gives the focus back to the project row', async () => {
    const { tree, user } = await bootTree();
    fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^Nova/ })));
    expect(screen.getByRole('menu', { name: 'Manage Nova' })).toBeInTheDocument();
    const project = tree.getByRole('button', { name: /^Ledge/ });
    fireEvent.contextMenu(rowOf(project));
    expect(screen.queryByRole('menu', { name: 'Manage Nova' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Actions for Ledge' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(project).toHaveFocus();
  });

  it('Shift+F10 on a focused project row opens its menu', async () => {
    const { tree, user } = await bootTree();
    tree.getByRole('button', { name: /^Ledge/ }).focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(screen.getByRole('menu', { name: 'Actions for Ledge' })).toBeInTheDocument();
  });
});

describe('the menu of No project', () => {
  it('right click on No project lists New session…, New project…, Fold', async () => {
    const { tree } = await bootTree();
    fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^No project/ })));
    const menu = screen.getByRole('menu', { name: 'Actions for No project' });
    expect(menuLabels(menu)).toEqual(['New session…', 'New project…', 'Fold']);
  });

  it('New project… opens the editor to create one', async () => {
    const { tree, user } = await bootTree();
    fireEvent.contextMenu(rowOf(tree.getByRole('button', { name: /^No project/ })));
    await user.click(screen.getByRole('menuitem', { name: 'New project…' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible());
  });
});

const ARCHIVED_AT = '2026-10-18T10:00:00.000Z';
const archived = (id: string, name: string) =>
  fakeSession(id, { name, cwd: '/w/pay', state: 'exited', archivedAt: ARCHIVED_AT, topic: name, agentSessionId: 'u-1' });
const otto = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });
const sent = (d: MockDaemon) => d.received.filter(m => m.type !== 'snapshot.request');
const archivesOf = (side: ReturnType<typeof within>) => within(side.getByRole('region', { name: 'Archives' }));
const archivesHeader = (side: ReturnType<typeof within>) => archivesOf(side).getByRole('button', { name: /Archives/ });

describe('the menu of the Archives', () => {
  it('right click on Archives: Delete all (2)… asks once for the two, confirmed sends two session.delete', async () => {
    const { d, side, user } = await boot({ sessions: [otto, archived('a1', 'Nia'), archived('a2', 'Ned')], daemon: CAN });
    fireEvent.contextMenu(archivesHeader(side));
    const menu = screen.getByRole('menu', { name: 'Actions for Archives' });
    expect(menuLabels(menu)).toEqual(['Delete all (2)…', 'Restore all', 'Unfold']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete all (2)…' }));
    const confirm = within(screen.getByRole('alertdialog'));
    expect(confirm.getByText('Delete these 2 sessions?')).toBeVisible();
    await user.click(confirm.getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(sent(d).filter(m => m.type === 'session.delete')).toEqual([{ type: 'session.delete', id: 'a1' }, { type: 'session.delete', id: 'a2' }]));
  });

  it('with no allowed archive, Delete all and Restore all are disabled', async () => {
    const { side } = await boot({ sessions: [otto, archived('a1', 'Nia')], daemon: { version: '0.6.0', install: 'npm', systemd: true } });
    fireEvent.contextMenu(archivesHeader(side));
    expect(screen.getByRole('menuitem', { name: 'Delete all (0)…' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Restore all' })).toBeDisabled();
  });

  it('the filter shows one of five archives; Delete all (5)… still asks for the five', async () => {
    const five = ['Nia', 'Ned', 'Noa', 'Nim', 'Nox'].map((name, i) => archived(`a${i}`, name));
    const { side, user } = await boot({ sessions: [otto, ...five], daemon: CAN });
    await user.click(archivesHeader(side));
    await user.type(archivesOf(side).getByRole('searchbox', { name: 'Filter the archives' }), 'nox');
    expect(archivesOf(side).queryByRole('button', { name: /Reread Nia/ })).toBeNull();
    fireEvent.contextMenu(archivesHeader(side));
    await user.click(screen.getByRole('menuitem', { name: 'Delete all (5)…' }));
    expect(within(screen.getByRole('alertdialog')).getByText('Delete these 5 sessions?')).toBeVisible();
  });

  it('Restore all sends one session.restore per archive and says it once', async () => {
    const toasts = recordToasts();
    const { d, side, user } = await boot({ sessions: [otto, archived('a1', 'Nia'), archived('a2', 'Ned')], daemon: CAN });
    fireEvent.contextMenu(archivesHeader(side));
    await user.click(screen.getByRole('menuitem', { name: 'Restore all' }));
    await waitFor(() => expect(sent(d).filter(m => m.type === 'session.restore')).toEqual([{ type: 'session.restore', id: 'a1' }, { type: 'session.restore', id: 'a2' }]));
    expect(toasts.filter(x => x === '2 sessions put back at their table.')).toHaveLength(1);
  });

  it('Unfold opens the section', async () => {
    const { side, user } = await boot({ sessions: [otto, archived('a1', 'Nia')], daemon: CAN });
    fireEvent.contextMenu(archivesHeader(side));
    await user.click(screen.getByRole('menuitem', { name: 'Unfold' }));
    expect(archivesHeader(side)).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('the menu of an archive row', () => {
  it('right click on an archive row: Read, Restore, Resume, Delete…; Read opens it', async () => {
    const { side, user } = await boot({ sessions: [otto, archived('a1', 'Nia')], daemon: CAN });
    await user.click(archivesHeader(side));
    fireEvent.contextMenu(archivesOf(side).getByRole('button', { name: /Reread Nia/ }));
    const menu = screen.getByRole('menu', { name: 'Actions for Nia' });
    expect(menuLabels(menu)).toEqual(['Read', 'Put back at the table', 'Resume session', 'Delete…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Read' }));
    expect(await screen.findByText('Archived session')).toBeVisible();
  });

  it('an archive deleted elsewhere while its menu is open closes the menu', async () => {
    const { d, side, user } = await boot({ sessions: [otto, archived('a1', 'Nia')], daemon: CAN });
    await user.click(archivesHeader(side));
    fireEvent.contextMenu(archivesOf(side).getByRole('button', { name: /Reread Nia/ }));
    expect(screen.getByRole('menu', { name: 'Actions for Nia' })).toBeInTheDocument();
    act(() => d.remove('a1'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('SidebarMenuHost on the Archives, some on a machine that cannot archive', () => {
  it('an archive on a machine that cannot archive is left out: Delete all (1)…, and 1 kept is said', async () => {
    const list = [archived('a1', 'Nia'), archived('a2', 'Ned')];
    const request = vi.fn();
    const actions = { request, resume: vi.fn(), restore: vi.fn(), pending: null, confirm: vi.fn(), cancel: vi.fn(), allowed: (id: string) => id === 'a1' } as unknown as SessionActions;
    const state = { menu: { target: { kind: 'archives' }, at: { x: 0, y: 0 }, opener: null }, session: null, renaming: null, open: vi.fn(), openOn: vi.fn(), close: vi.fn(), terminal: vi.fn(), rename: vi.fn(), closeRename: vi.fn(), sendRename: vi.fn() } as ContextMenuState;
    const user = userEvent.setup();
    render(<LangProvider lang="en"><SidebarMenuHost state={state} projects={PROJECTS} groups={[]} archived={list} actions={actions} dispatch={vi.fn()} broadcast={false}
      closed={new Set()} onClosed={vi.fn()} archivesOpen={false} onArchivesOpen={vi.fn()} notify={vi.fn()} /></LangProvider>);
    const item = screen.getByRole('menuitem', { name: 'Delete all (1)…' });
    expect(item).toHaveTextContent('1 kept: their machine must update Ledge');
    await user.click(item);
    expect(request).toHaveBeenCalledWith('delete', ['a1']);
  });
});
