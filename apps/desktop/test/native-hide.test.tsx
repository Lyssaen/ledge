import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { DaemonInfo, Machines } from '@ledge/protocol';

// Native Windows mode's first round shows only the acceptance bar (spec 2026-11-03 §1): what is outside it is hidden.
const shell = vi.hoisted(() => ({ info: null as null | { mode: 'native' | 'wsl'; port: number } }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), nativeInfo: async () => shell.info }));

import { loadNativeInfo } from '../src/native/mode';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { DaemonOutdated } from '../src/shell/DaemonOutdated';
import { LangProvider } from '../src/i18n/lang';
import { openRigMachine } from '../src/openrig/OpenRigPage';
import { loadWorkspace } from '../src/session/lazy';
import { loadComposer } from '../src/launch/lazy';
import { loadSettings } from '../src/settings/lazy';
import { loadHome } from '../src/chat/lazy';
import { PROJECTS } from './helpers';
import { daemonOffer } from '../src/update/daemon';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
const DAEMON: DaemonInfo = { version: '0.41.0', install: 'npm', systemd: false, broadcast: true, archive: true, platform: 'win32' };
const MACHINES: Machines = [{ id: 'local', label: 'Local' }, { id: 'ec2', label: 'EC2', ssh: 'ec2' }];
const ctx = (used: number) => ({ used, window: 200_000, at: new Date().toISOString() });

beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'en'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); shell.info = null; await loadNativeInfo(); });

async function boot(native: boolean) {
  shell.info = native ? { mode: 'native', port: 47831 } : null;
  await loadNativeInfo();
  await loadWorkspace(); await loadComposer(); await loadSettings(); await loadHome();
  const d = await createMockDaemon(); daemons.push(d);
  d.machines(MACHINES); d.projects(PROJECTS); d.extras.daemon = DAEMON;
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle', context: ctx(170_000) }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'working' }));
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Sidebar' }));
  await side.findByRole('button', { name: /^Otto/ }, { timeout: 5000 });
  return { d, side, user: userEvent.setup() };
}

describe('native mode hides what its first round does not offer', () => {
  it('native: no chat entry, no chat icon, Ctrl+/ does nothing', async () => {
    const { side, user } = await boot(true);
    expect(side.queryByRole('button', { name: 'Home: Ledge, the operator' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chat Ledge' })).toBeNull();
    await user.keyboard('{Control>}/{/Control}');
    expect(document.querySelector('.chat-panel, [aria-label="Chat Ledge"]')).toBeNull();
  });

  it('native: no Atelier button, no Detach', async () => {
    const { side } = await boot(true);
    expect(within(side.getByRole('navigation', { name: 'Views' })).queryByRole('button', { name: /Atelier/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Detach the Atelier' })).toBeNull();
  });

  it('native: no broadcast ✉ on a project row even when the daemon offers broadcast', async () => {
    const { side } = await boot(true);
    await waitFor(() => expect(side.getAllByRole('button', { name: /^New session in/, hidden: true }).length).toBeGreaterThan(0));
    expect(side.queryAllByRole('button', { name: /^Write to/, hidden: true })).toEqual([]);
  });

  it('native: no handover card nor « Hand over » in the session menu', async () => {
    const { side, user } = await boot(true);
    expect(side.queryByText('Otto · context 85 %')).toBeNull();
    await user.click(side.getAllByRole('button', { name: /^Otto/ })[0]!);
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Manage Otto' }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: /Hand over/ })).toBeNull();
  });

  it('native: no shell tab nor + in the right panel', async () => {
    const { side, user } = await boot(true);
    await user.click(side.getAllByRole('button', { name: /^Otto/ })[0]!);
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /^Show the panel/ }));
    expect(screen.queryByRole('button', { name: 'New shell' })).toBeNull();
  });

  it('native: Settings lists neither the notch nor mobile access', async () => {
    const { user } = await boot(true);
    await user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' })).getAllByRole('button').map(b => b.textContent);
    expect(nav.some(x => /Notch|Mobile access/.test(x ?? ''))).toBe(false);
    expect(nav.some(x => /Machines/.test(x ?? ''))).toBe(true);
  });

  it('native: OpenRig opens the SSH machine by default', () => {
    const ms = [{ id: 'local' }, { id: 'ec2', ssh: 'ec2' }] as never;
    expect(openRigMachine(ms, undefined, true)?.id).toBe('ec2');
    expect(openRigMachine(ms, undefined, false)?.id).toBe('local');
    expect(openRigMachine(ms, 'local', true)?.id).toBe('local');
  });

  it('a Windows daemon is updated with Ledge Desktop: no npm offer for it; a Linux one keeps its offer', () => {
    const at = (platform?: string) => ({ id: 'local', daemon: { version: '0.40.0', install: 'npm', systemd: true, ...(platform ? { platform } : {}) } }) as never;
    expect(daemonOffer(at('win32'), '0.41.0')).toBe('none');
    expect(daemonOffer(at('linux'), '0.41.0')).toBe('offer');
  });

  it('native copy never says WSL', async () => {
    const { user } = await boot(true);
    await user.keyboard('{Control>},{/Control}');
    await user.click(await within(await screen.findByRole('navigation', { name: 'Settings sections' })).findByRole('button', { name: /Machines/ }));
    await screen.findByRole('heading', { level: 1, name: 'Machines' });
    expect(document.body.textContent).not.toMatch(/WSL/);
    cleanup();
    render(<LangProvider lang="en"><DaemonOutdated /></LangProvider>);
    expect(document.body.textContent).not.toMatch(/WSL/);
  });

  it.each([[true], [false]])('the project editor offers Ledge help (Ask Ledge, Let Ledge do it) only outside native mode (native %s)', async native => {
    const { side, user } = await boot(native);
    fireEvent.contextMenu((await side.findAllByRole('button', { name: /^Ledge\b/ }, { timeout: 4000 })).at(-1)!.closest('[role="treeitem"]')!);
    await user.click(await screen.findByRole('menuitem', { name: /^Edit project/ }));
    await screen.findByRole('textbox', { name: /Name/ });
    expect(!!screen.queryByRole('button', { name: 'Ask Ledge' })).toBe(!native);
    await user.keyboard('{Escape}');
    await user.click(side.getByRole('button', { name: 'New project' }));
    await screen.findByRole('textbox', { name: /Name/ });
    expect(!!screen.queryByRole('button', { name: 'Let Ledge do it' })).toBe(!native);
  });

  it('WSL mode is unchanged: chat, Atelier, broadcast and the notch are there', async () => {
    const { side, user } = await boot(false);
    expect(side.getByRole('button', { name: 'Home: Ledge, the operator' })).toBeVisible();
    expect(within(side.getByRole('navigation', { name: 'Views' })).getByRole('button', { name: /Atelier/ })).toBeVisible();
    await waitFor(() => expect(side.getAllByRole('button', { name: /^Write to/, hidden: true }).length).toBeGreaterThan(0));
    await user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    const nav = within(screen.getByRole('navigation', { name: 'Settings sections' })).getAllByRole('button').map(b => b.textContent);
    expect(nav.some(x => /Notch/.test(x ?? ''))).toBe(true);
  });
});
