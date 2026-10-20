import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    expect(tree.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('a stored list preference opens the atelier', async () => {
    localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false }));
    await boot({ projects: PROJECTS, sessions: listSessions() });
    expect(screen.queryByRole('tab', { name: 'List' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
    expect(JSON.parse(localStorage.getItem('desktop.overview')!).view).toBe('atelier');
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

  it('the tree tab stop is the open session, or the first row when none is open', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const stops = () => [...side.getByRole('tree').querySelectorAll('[data-tree-key]')]
      .flatMap(el => el instanceof HTMLElement && el.tabIndex === 0 ? [el.dataset.treeKey] : []);
    expect(stops()).toEqual(['p:ledge']);
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    expect(stops()).toEqual(['local:otto']);
  });

  it('the subagents pill unfolds the open session in the tree and scrolls to its row', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    expect(side.queryByRole('button', { name: /^Explore/ })).toBeNull();
    const row = side.getByRole('button', { name: /^Otto/ });
    const scrolled = vi.fn();
    row.scrollIntoView = scrolled;
    await user.click(await screen.findByRole('button', { name: '1 subagent' }));
    expect(await side.findByRole('button', { name: /^Explore/ })).toBeVisible();
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
  });

  it('the Projects heading has hide, compact, fold-all and new-project', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    const projects = within(side.getByRole('region', { name: 'Projects' }));
    const hide = projects.getByRole('button', { name: 'Hide finished sessions (H)' });
    const compact = projects.getByRole('button', { name: 'Compact mode (D)' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    expect(compact).toHaveAttribute('aria-pressed', 'false');
    expect(projects.getByRole('button', { name: 'Fold all' })).toBeVisible();
    expect(projects.getByRole('button', { name: 'New project' })).toBeVisible();

    await user.click(hide);
    expect(side.getByRole('button', { name: /^Bix/ })).toBeVisible();
    expect(hide).toHaveAttribute('aria-pressed', 'false');

    await user.click(compact);
    expect(screen.getByRole('complementary', { name: /sidebar/i })).toHaveClass('st-dense');
    expect(compact).toHaveAttribute('aria-pressed', 'true');

    await user.click(projects.getByRole('button', { name: 'Fold all' }));
    expect(side.queryByRole('button', { name: /^Otto/ })).toBeNull();
    expect(side.getByRole('button', { name: /^Ledge/ })).toBeVisible();

    await user.click(projects.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
  });

  it('+N finished shows them with no link to hide them; H hides them again', async () => {
    const { side, user } = await boot({ projects: PROJECTS, sessions: listSessions() });
    await user.click(side.getByRole('button', { name: '+1 finished' }));
    expect(side.getByRole('button', { name: /^Bix/ })).toBeVisible();
    expect(side.queryByRole('button', { name: '+1 finished' })).toBeNull();
    expect(side.queryByRole('button', { name: /^Hide (the finished one|finished)$/ })).toBeNull();
    side.getByRole('button', { name: /^Otto/ }).focus();
    await user.keyboard('hh');
    expect(side.queryByRole('button', { name: /^Bix/ })).toBeNull();
    expect(side.getByRole('button', { name: '+1 finished' })).toBeVisible();
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
