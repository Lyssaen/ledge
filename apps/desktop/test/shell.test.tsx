import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { App } from '../src/App';
import { boot, closeDaemons, declarations, TWO_PROJECTS } from './helpers';
import { LangProvider } from '../src/i18n/lang';
import { initialNav } from '../src/nav/state';
import { TopBar } from '../src/shell/TopBar';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

describe('the Atelier shell', () => {
  it('sidebar: views, projects with their dots, Sans projet, machines, settings', async () => {
    const { side } = await boot({ projects: TWO_PROJECTS });
    expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent('3');          // active main agents
    const ledge = side.getByRole('button', { name: /^Ledge/ });
    expect(ledge.querySelectorAll('.side-dots i.dot-approval')).toHaveLength(1);
    expect(side.getByRole('button', { name: /Payment Service Platform/ }).querySelector('span')).toHaveAttribute('title', 'Payment Service Platform Migration Europe');
    expect(side.getByRole('button', { name: /No project/ })).toHaveTextContent('1');
    expect(side.getByRole('button', { name: /No project/ }).querySelector('.side-alert')).not.toBeNull();   // Kit has a question
    expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('3 agents');
    expect(side.getByRole('button', { name: /Settings/ })).toBeVisible();
  });

  it('a project row filters the overview; the crumb shows it and clears it', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS });
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    const top = within(screen.getByRole('banner'));
    expect(top.getByText('Ledge')).toBeVisible();
    await user.click(top.getByRole('button', { name: 'Remove the filter: show every project' }));
    expect(top.getByText('Atelier')).toBeVisible();
  });

  it('the view tabs switch Atelier / List and the choice survives a remount', async () => {
    const { view, user, client } = await boot({ projects: TWO_PROJECTS });
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(screen.getByRole('tabpanel', { name: 'List' })).toBeVisible();
    expect(JSON.parse(localStorage.getItem('desktop.overview')!)).toMatchObject({ view: 'list' });
    view.unmount();
    render(<App client={client} />);
    expect(await screen.findByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  });

  it('the view tabs follow the arrow keys', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    screen.getByRole('tab', { name: 'Atelier' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'List' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'List' })).toBeVisible();
  });

  it('helpers and animation toggles are pressed buttons, remembered', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.click(screen.getByRole('button', { name: 'Hide subagents' }));
    expect(screen.getByRole('button', { name: 'Show subagents' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Freeze animations' }));
    expect(screen.getByRole('button', { name: 'Animate' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('desktop.overview')!)).toMatchObject({ helpers: false, paused: true });
  });

  it('a machine row opens Settings › Machines with its crumb', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS });
    await user.click(side.getByRole('button', { name: /Dev SSH/ }));
    const top = within(screen.getByRole('banner'));
    expect(top.getByText('Machines')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Machines' })).toBeVisible();
    expect(top.queryByRole('tab')).toBeNull();                               // view controls only on the overview
  });

  it('a filter naming a project the daemon removed falls back to every project', async () => {
    const { d, side, user } = await boot({ projects: TWO_PROJECTS });
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    d.projects({ projects: [], rules: [] });
    await waitFor(() => expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Remove the filter: show every project' })).toBeNull());
    expect(within(screen.getByRole('banner')).getByText('Atelier')).toBeVisible();
  });

  it('the footer says local and SSH sessions, and has no island state', async () => {
    await boot({ projects: TWO_PROJECTS });
    const foot = within(screen.getByRole('contentinfo'));
    expect(foot.getByText('Local and SSH sessions')).toBeVisible();
    expect(foot.queryByText(/island/i)).toBeNull();
  });

  it('New session and the project + open their dialogs; Close and the backdrop close them', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS });
    await user.click(side.getByRole('button', { name: /New session/ }));
    const dialog = screen.getByRole('dialog', { name: 'New session' });
    expect(within(dialog).getByRole('region', { name: 'New session' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(side.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
    await user.click(document.querySelector('.modal-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Chat Ledge opens a side panel that closes', async () => {
    const { side, user } = await boot({ projects: TWO_PROJECTS });
    await user.click(side.getByRole('button', { name: /Chat Ledge/ }));
    const chat = screen.getByRole('complementary', { name: 'Chat Ledge' });
    await user.click(within(chat).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
  });

  it('full screen hides the sidebar', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(document.querySelector('.application')).toHaveClass('immersive');
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  });

  it('an agent in error has its own dot in its project row', async () => {
    const { d, side } = await boot({ projects: TWO_PROJECTS });
    d.upsert(fakeSession('rio', { name: 'Rio', cwd: '/w/pay', state: 'error' }));
    await waitFor(() => expect(side.getByRole('button', { name: /Payment Service Platform/ }).querySelectorAll('.side-dots i.dot-error')).toHaveLength(1));
    // Red as the error badge, without the halo that marks an approval.
    expect(declarations('sidebar.css', '.side-dots .dot-error')).toBe('background:var(--danger-text)');
  });

  it('the toast sits above a dialog and the narrow chat', () => {
    expect(declarations('shell.css', '.toast-region')).toBe('position:fixed;width:0;height:0;z-index:10');
  });
  it('a long project name truncates in the session crumb, full name in its title', () => {
    const nova = fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working', topic: 'Migrate the ledger' });
    const nav = { ...initialNav({ view: 'atelier', helpers: true, paused: false }), place: { kind: 'session' as const, id: 'nova', view: 'atelier' as const, project: 'all' } };
    render(<LangProvider lang="en"><TopBar nav={nav} dispatch={() => {}} session={nova} projects={TWO_PROJECTS} projectIdOf={() => 'pay'} helper={null} terminal={false} onTerminal={() => {}} /></LangProvider>);
    const link = within(screen.getByRole('banner')).getByRole('button', { name: 'Payment Service Platform Migration Europe' });
    expect(link).toHaveClass('crumb-link');
    expect(link).toHaveAttribute('title', 'Payment Service Platform Migration Europe');
    // The top bar never wraps: a crumb link stays on one line and ends with « … ».
    const rule = declarations('shell.css', '.breadcrumb .crumb-link');
    for (const d of ['white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis', 'min-width:0', 'max-width:180px']) expect(rule).toContain(d);
    expect(within(screen.getByRole('banner')).getByText('Migrate the ledger')).toHaveAttribute('title', 'Migrate the ledger');
  });
  it('leaving full screen from outside (the browser, the OS) leaves the immersive layout', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(document.querySelector('.application')).toHaveClass('immersive');
    document.dispatchEvent(new Event('fullscreenchange'));
    await waitFor(() => expect(document.querySelector('.application')).not.toHaveClass('immersive'));
  });
  it('the rules lot 3 ported for nothing are gone', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/shell.css'), 'utf8');
    expect(css).not.toMatch(/workspace-footer > span|data-variant=outline\]|\(lot 5\)/);
  });
});
