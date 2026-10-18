import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, listSessions, PROJECTS } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const banner = () => within(screen.getByRole('banner'));

describe('the sidebar tree', () => {
  it('lists projects, folds a single branch, and hides Bix behind +1 finished', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    expect(tree.getByRole('button', { name: /^Ledge/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Payment/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^No project/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Otto/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Nova/ })).toBeVisible();
    expect(tree.getByRole('button', { name: /^Rio/ })).toBeVisible();
    expect(tree.queryByRole('button', { name: /^Bix/ })).toBeNull();
    // Payment and No project have one branch, so the session sits on the project (level 2). Ledge has desktop and main, so Otto sits under a branch (level 3).
    expect(tree.getByRole('treeitem', { name: /Nova/ })).toHaveAttribute('aria-level', '2');
    expect(tree.getByRole('treeitem', { name: /Otto/ })).toHaveAttribute('aria-level', '3');
    await user.click(tree.getByRole('button', { name: '+1 finished' }));
    expect(tree.getByRole('button', { name: /^Bix/ })).toBeVisible();
    expect(tree.getByRole('button', { name: 'Archive' })).toBeVisible();
  });

  it('opens a session from its row and filters the atelier from the project row', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    expect(banner().getByText('Otto')).toBeVisible();
    await user.click(side.getByRole('button', { name: /^Payment/ }));
    expect(banner().getByText('Payment Service Platform Migration Europe')).toBeVisible();
  });

  it('unfolds two branches of the same project', async () => {
    const sessions = [...listSessions(), fakeSession('wren', { name: 'Wren', cwd: '/w/ledge', state: 'working', branch: 'release-0.6', worktree: true })];
    const { side } = await boot({ projects: PROJECTS, sessions });
    const tree = within(side.getByRole('tree', { name: 'Projects, branches and sessions' }));
    expect(tree.getByRole('button', { name: 'desktop' })).toBeVisible();
    expect(tree.getByRole('button', { name: 'release-0.6' })).toBeVisible();
    expect(tree.getByText('wt')).toBeVisible();
  });

  it('a right click on Otto opens the session menu', async () => {
    const { side } = await boot({ projects: PROJECTS, sessions: listSessions() });
    fireEvent.contextMenu(side.getByRole('button', { name: /^Otto/ }));
    expect(await screen.findByRole('menuitem', { name: /^Open/ })).toBeVisible();
  });

  it('H hides finished ones; the open session stays in view', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    expect(side.queryByRole('button', { name: /^Bix/ })).toBeNull();
    side.getByRole('button', { name: /^Otto/ }).focus();
    await user.keyboard('h');
    await user.click(side.getByRole('button', { name: /^Bix/ }));
    const row = side.getByRole('treeitem', { name: /Bix/ });
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).toHaveAttribute('aria-current', 'true');
    side.getByRole('button', { name: /^Bix/ }).focus();
    await user.keyboard('h');
    expect(side.getByRole('button', { name: /^Bix/ })).toBeVisible();
    expect(side.getByRole('treeitem', { name: /Bix/ })).toHaveAttribute('aria-selected', 'true');
  });
});
