import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { Projects } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });

const projects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'pay', name: 'Payment Service Platform Migration Europe', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] }
  ],
  rules: []
};

/** Three agents: Otto (Ledge) needs approval, Nova (Payment…) works, Kit (no project) has a question. */
async function boot() {
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }]);
  d.projects(projects);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' }));
  d.upsert(fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' }));
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  const view = render(<App client={client} />);
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
  // The shell is ready once the three agents and both projects arrived.
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent('3'));
  await side.findByRole('button', { name: /^Ledge/ });
  return { d, side, view, client, user: userEvent.setup() };
}

describe('the Atelier shell', () => {
  it('sidebar: views, projects with their dots, Sans projet, machines, settings', async () => {
    const { side } = await boot();
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
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    const top = within(screen.getByRole('banner'));
    expect(top.getByText('Ledge')).toBeVisible();
    await user.click(top.getByRole('button', { name: 'Remove the filter: show every project' }));
    expect(top.getByText('Atelier')).toBeVisible();
  });

  it('the view tabs switch Atelier / List and the choice survives a remount', async () => {
    const { view, user, client } = await boot();
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(screen.getByRole('region', { name: 'List' })).toBeVisible();      // Pending
    expect(JSON.parse(localStorage.getItem('desktop.overview')!)).toMatchObject({ view: 'list' });
    view.unmount();
    render(<App client={client} />);
    expect(await screen.findByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
  });

  it('the view tabs follow the arrow keys', async () => {
    const { user } = await boot();
    screen.getByRole('tab', { name: 'Atelier' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'List' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'List' })).toBeVisible();
  });

  it('helpers and animation toggles are pressed buttons, remembered', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Hide subagents' }));
    expect(screen.getByRole('button', { name: 'Show subagents' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Freeze animations' }));
    expect(screen.getByRole('button', { name: 'Animate' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('desktop.overview')!)).toMatchObject({ helpers: false, paused: true });
  });

  it('a machine row opens Settings › Machines with its crumb', async () => {
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /Dev SSH/ }));
    const top = within(screen.getByRole('banner'));
    expect(top.getByText('Machines')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Machines' })).toBeVisible();
    expect(top.queryByRole('tab')).toBeNull();                               // view controls only on the overview
  });

  it('a filter naming a project the daemon removed falls back to every project', async () => {
    const { d, side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    d.projects({ projects: [], rules: [] });
    await waitFor(() => expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Remove the filter: show every project' })).toBeNull());
  });

  it('the footer says local and SSH sessions, and has no island state', async () => {
    await boot();
    const foot = within(screen.getByRole('contentinfo'));
    expect(foot.getByText('Local and SSH sessions')).toBeVisible();
    expect(foot.queryByText(/island/i)).toBeNull();
  });

  it('New session and the project + open their dialogs; Close and the backdrop close them', async () => {
    const { side, user } = await boot();
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
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /Chat Ledge/ }));
    const chat = screen.getByRole('complementary', { name: 'Chat Ledge' });
    await user.click(within(chat).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
  });

  it('full screen hides the sidebar', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(document.querySelector('.application')).toHaveClass('immersive');
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  });
});
