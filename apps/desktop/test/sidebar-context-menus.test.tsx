import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { DaemonInfo } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, PROJECTS } from './helpers';

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
