import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { App } from '../src/App';
import { boot, closeDaemons, declarations, openProjectEditor, TWO_PROJECTS } from './helpers';

// « Open in Ledge » from the island, delivered by hand: the shell's event never fires outside Tauri.
const island = vi.hoisted(() => ({ open: null as null | ((raw: string) => void) }));
vi.mock('../src/tauri/bridge', async orig => ({
  ...(await orig<typeof import('../src/tauri/bridge')>()),
  onOpenTarget: (fn: (raw: string) => void) => { island.open = fn; return () => { island.open = null; }; }
}));

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const frontTab = () => screen.queryAllByRole('tab').filter(t => t.closest('.dv-tabs-container')).find(t => t.getAttribute('aria-selected') === 'true');
/** The IDE's Atelier tab bar: « Atelier », then the project filter with its clear button. */
const abar = () => within(screen.getByRole('toolbar', { name: 'Atelier' }));

describe('the Atelier shell', () => {
  it('« Voir l\'onglet du terminal » from the island opens the session on its Terminal view, the agent\'s screen', async () => {
    await boot({ projects: TWO_PROJECTS });
    await waitFor(() => expect(island.open).not.toBeNull());
    act(() => island.open!('{"kind":"terminal","id":"local:otto"}'));
    // The IDE: Otto's tab in front, on its own Terminal view (a tab's view, never the stored preference).
    await waitFor(() => expect(frontTab()).toHaveAccessibleName('Otto'));
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
  });

  it('the explorer: projects with their tallies, Sans projet', async () => {
    const { side } = await boot({ projects: TWO_PROJECTS });
    const ledge = side.getByRole('button', { name: /^Ledge/ }).closest('[role="treeitem"]')!;
    expect(ledge.querySelectorAll('.st-tally .t-need')).toHaveLength(1);
    expect(ledge.querySelector('.st-tally .t-need')).toHaveAttribute('title', '1 to decide');
    expect(side.getByRole('button', { name: /^Otto/ }).closest('[role="treeitem"]')!.querySelector('.st-time')).toHaveClass('t-approval');
    const pay = side.getByRole('button', { name: /^Payment Service Platform Migration Europe/ });
    expect(pay).toHaveTextContent('Payment Service Platform Migration Europe');
    expect(pay).toHaveAttribute('title', 'Show only Payment Service Platform Migration Europe in the atelier');
    const none = side.getByRole('button', { name: /^No project/ }).closest('[role="treeitem"]')!;
    expect(none.querySelector('.st-tally .t-need')).toHaveTextContent('1');
    expect(side.getByRole('button', { name: /^Kit/ }).closest('[role="treeitem"]')!.querySelector('.st-time')).toHaveClass('t-question');
  });

  it('a project row filters the Atelier tab; its bar shows the filter and clears it', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS });
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    await waitFor(() => expect(abar().getByText('Ledge')).toBeVisible());
    await user.click(abar().getByRole('button', { name: 'Remove the filter: show every project' }));
    expect(abar().queryByText('Ledge')).toBeNull();
  });

  it('there is no List tab; booting on a stored list shows the atelier', async () => {
    const { view, client } = await boot({ projects: TWO_PROJECTS, list: true });
    expect(screen.queryByRole('tab', { name: 'List' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
    expect(JSON.parse(localStorage.getItem('desktop.overview')!)).toMatchObject({ view: 'atelier' });
    view.unmount();
    localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false }));
    render(<App client={client} />);
    // The IDE opens on its Atelier tab again, never a list.
    expect(await screen.findByRole('region', { name: 'Ledge table' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'List' })).toBeNull();
  });

  it('helpers and animation toggles are pressed buttons, remembered', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    // The Atelier tab's bar (IDE): the subagents' button says what it does next; the animations' one is pressed while frozen.
    await user.click(screen.getByRole('button', { name: 'Hide subagents' }));
    expect(screen.getByRole('button', { name: 'Show subagents' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Freeze animations' }));
    expect(screen.getByRole('button', { name: 'Animate' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('desktop.overview')!)).toMatchObject({ helpers: false, paused: true });
  });

  it('a filter naming a project the daemon removed falls back to every project', async () => {
    const { d, side, user } = await boot({ projects: TWO_PROJECTS });
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    await waitFor(() => expect(abar().getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible());
    d.projects({ projects: [], rules: [] });
    await waitFor(() => expect(abar().queryByRole('button', { name: 'Remove the filter: show every project' })).toBeNull());
  });

  it('the footer says local and SSH sessions, and has no island state', async () => {
    await boot({ projects: TWO_PROJECTS });
    const foot = within(screen.getByRole('contentinfo'));
    expect(foot.getByText('Local and SSH sessions')).toBeVisible();
    expect(foot.queryByText(/island/i)).toBeNull();
  });

  it('the footer has no shortcut reminders: they live behind the sidebar\'s ?', async () => {
    await boot({ projects: TWO_PROJECTS });
    const footer = screen.getByRole('contentinfo');
    expect(footer.querySelector('kbd')).toBeNull();
    expect(footer.querySelector('.keyboard-footer')).toBeNull();
    expect(within(footer).queryByRole('button', { name: /Ctrl K|A session|Shortcuts/ })).toBeNull();
  });

  it('N and the project + open their dialogs; Close and the backdrop close them', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.keyboard('n');
    const dialog = screen.getByRole('dialog', { name: 'New session' });
    expect(await within(dialog).findByRole('textbox', { name: 'First message' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await openProjectEditor(user);
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
    await user.click(document.querySelector('.modal-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Ledge\'s chat is the right panel: Ctrl+/ hides it, and shows it again', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    expect(await screen.findByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    await user.keyboard('{Control>}/{/Control}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull());
    await user.keyboard('{Control>}/{/Control}');
    expect(await screen.findByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
  });

  it('an agent in error has its own mark in its project row', async () => {
    const { d, side } = await boot({ projects: TWO_PROJECTS });
    d.upsert(fakeSession('rio', { name: 'Rio', cwd: '/w/pay', state: 'error' }));
    await waitFor(() => expect(side.getByRole('button', { name: /^Rio/ }).closest('[role="treeitem"]')!.querySelector('.st-time')).toHaveClass('t-error'));
    const pay = side.getByRole('treeitem', { name: /Payment Service Platform Migration Europe/ });
    expect(pay.querySelectorAll('.st-tally .t-need')).toHaveLength(1);
    expect(pay.querySelector('.st-tally .t-need')).toHaveAttribute('title', '1 to decide');
  });

  it('an error session’s time is danger-text, without the approval halo', () => {
    expect(declarations('sidebar.css', '.st-time.t-error')).toBe('color:var(--danger-text)');
  });

  it('the toast sits above a dialog and the narrow chat', () => {
    expect(declarations('shell.css', '.toast-region')).toBe('position:fixed;width:0;height:0;z-index:10');
  });
  it('the rules lot 3 ported for nothing are gone', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/shell.css'), 'utf8');
    expect(css).not.toMatch(/workspace-footer > span|data-variant=outline\]|\(lot 5\)|keyboard-footer/);
  });
});
