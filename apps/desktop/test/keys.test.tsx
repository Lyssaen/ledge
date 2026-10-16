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

/** Same fleet as the shell tests: Otto (Ledge), Nova (Payment…), Kit (no project). */
async function boot() {
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }]);
  d.projects(projects);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' }));
  d.upsert(fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' }));
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  render(<App client={client} />);
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent('3'));
  await side.findByRole('button', { name: /^Ledge/ });
  return { d, side, user: userEvent.setup() };
}
const banner = () => within(screen.getByRole('banner'));

describe('global shortcuts', () => {
  it('Ctrl K opens the search from anywhere, even while typing', async () => {
    const { user } = await boot();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Go to a session' })).toBeVisible();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('single keys do nothing while typing in a field; Escape still closes', async () => {
    const { user } = await boot();
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('n/?');
    expect(screen.getByRole('combobox')).toHaveValue('n/?');
    expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    await user.keyboard('{Alt>}1{/Alt}');
    expect(screen.getByRole('dialog', { name: 'Go to a session' })).toBeVisible();   // Alt 1 does nothing inside the search
    expect(banner().queryByText('Otto')).toBeNull();
  });

  it('a field of the page (not a dialog) also swallows the single keys and Alt 1', async () => {
    const { user } = await boot();
    const field = document.createElement('input');
    document.body.append(field); field.focus();
    await user.keyboard('n/?{Alt>}1{/Alt}');
    expect(field).toHaveValue('n/?');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Chat Ledge' })).toBeNull();
    expect(banner().queryByText('Otto')).toBeNull();
    await user.keyboard('{Control>}k{/Control}');                         // Ctrl K still works there
    expect(screen.getByRole('dialog', { name: 'Go to a session' })).toBeVisible();
    field.remove();
  });

  it('N opens New session, ? the shortcuts, / the chat', async () => {
    const { user } = await boot();
    await user.keyboard('n'); expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible(); await user.keyboard('{Escape}');
    await user.keyboard('?'); expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible(); await user.keyboard('{Escape}');
    await user.keyboard('/'); expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
  });

  it('Alt 1…9 open the main agents in order; Alt → / ← walk them, wrapping', async () => {
    const { user } = await boot();
    await user.keyboard('{Alt>}1{/Alt}');
    expect(banner().getByText('Otto')).toBeVisible();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(banner().getByText('Nova')).toBeVisible();
    await user.keyboard('{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}');
    expect(banner().getByText('Kit')).toBeVisible();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(banner().getByText('Otto')).toBeVisible();
    await user.keyboard('{Alt>}9{/Alt}');                                 // no ninth agent: nothing changes
    expect(banner().getByText('Otto')).toBeVisible();
  });

  it('Ctrl , opens settings; Escape walks back one layer at a time', async () => {
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    await user.keyboard('{Alt>}1{/Alt}{Control>},{/Control}');
    expect(banner().getByText('General')).toBeVisible();
    await user.keyboard('{Escape}'); expect(banner().getByText('Otto')).toBeVisible();
    await user.keyboard('{Escape}'); expect(banner().getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
    await user.keyboard('{Escape}'); expect(banner().getByText('Atelier')).toBeVisible();
  });

  it('with every layer open, each Escape closes exactly one', async () => {
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Ledge/ }));       // filter
    await user.keyboard('{Alt>}1{/Alt}');                                 // session
    await user.keyboard('{Control>},{/Control}');                         // settings
    await user.keyboard('/');                                             // chat
    await user.keyboard('{Control>}k{/Control}');                         // modal
    const chat = () => screen.queryByRole('complementary', { name: 'Chat Ledge' });
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull(); expect(chat()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(chat()).toBeNull(); expect(banner().getByText('General')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(banner().getByText('Otto')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(banner().getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
  });

  it('Escape leaves full screen last of all', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(document.querySelector('.application')).toHaveClass('immersive');
    await user.keyboard('{Escape}');
    expect(document.querySelector('.application')).not.toHaveClass('immersive');
  });

  it('focus goes back to the opener when the search closes, with the button or with Ctrl K', async () => {
    const { side, user } = await boot();
    const btn = side.getByRole('button', { name: 'Search a session' });
    await user.click(btn);
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(btn).toHaveFocus();
    btn.focus();
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Escape}');
    expect(btn).toHaveFocus();
  });
});

describe('the fleet corrects the place', () => {
  it('an open agent that disappears sends the crumb back to the filtered overview; an offline one stays open', async () => {
    const { d, side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    await user.keyboard('{Alt>}1{/Alt}');
    expect(banner().getByText('Otto')).toBeVisible();
    d.remove('otto');
    await waitFor(() => expect(banner().getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible());
    expect(banner().queryByText('Otto')).toBeNull();
    await user.click(side.getByRole('button', { name: /Atelier/ }));
    await user.keyboard('{Alt>}1{/Alt}');
    expect(banner().getByText('Nova')).toBeVisible();
    d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working', offline: true }));
    await new Promise(r => setTimeout(r, 200));
    expect(banner().getByText('Nova')).toBeVisible();
  });

  it('a daemon that never sends projects still gives a working shell', async () => {
    const d = await createMockDaemon(); daemons.push(d);
    d.machines([{ id: 'local', label: 'Local' }]);
    d.upsert(fakeSession('otto', { name: 'Otto' }));
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
    await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent('1'));
    expect(banner().getByText('Atelier')).toBeVisible();
  });
});
