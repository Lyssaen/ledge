import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { DaemonInfo } from '@ledge/protocol';
import { boot, closeDaemons, recordToasts, savedNotices, TWO_PROJECTS } from './helpers';
import { machine } from './fleet-helpers';
import { LangProvider } from '../src/i18n/lang';
import { updater } from '../src/update/store';
import { About } from '../src/settings/About';
import type { SettingsContext } from '../src/settings/SettingsPage';

// The app is Ledge 0.6.0, and the release feed has nothing newer: the daemons follow 0.6.0.
vi.mock('../src/update/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/update/bridge')>()),
  appVersion: () => Promise.resolve('0.6.0'),
  checkForUpdate: () => Promise.resolve(null)
}));

let log: string[] = [];
beforeAll(async () => { await updater.start(); });
afterAll(() => updater.stop());
beforeEach(() => { log = recordToasts(); localStorage.clear(); });
afterEach(async () => { cleanup(); await closeDaemons(); });

const NPM_BEHIND: DaemonInfo = { version: '0.5.0', install: 'npm', systemd: true };
const saved = () => savedNotices(log);
const nav = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));
const tab = (name: string) => nav().getByRole('button', { name: new RegExp(`^${name}`) });
const versions = () => [...document.querySelectorAll('.version-list > div')].map(row => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent]);
const log_ = () => screen.getByRole('list', { name: 'Daemon log' });
const steps = () => within(log_()).getAllByRole('listitem').map(li => li.textContent);

async function open(daemon?: DaemonInfo) {
  const env = await boot({ projects: TWO_PROJECTS, ...(daemon ? { daemon } : {}) });
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(tab('About'));
  await screen.findByRole('heading', { level: 2, name: 'Versions' });
  return env;
}

describe('Settings › About', () => {
  it('shows Ledge, Desktop’s version and each machine’s daemon, « Update needed » on a daemon behind, then the latest version; a dot on About', async () => {
    await open(NPM_BEHIND);
    expect(screen.getByText('A new way of working with your agents. The island and Ledge Desktop, one application.')).toBeVisible();
    await waitFor(() => expect(versions()).toEqual([
      ['Ledge Desktop', '0.6.0'],
      ['Daemon · Local', '0.5.0· npmUpdate needed'],
      ['Daemon · Dev SSH', 'Unknown version'],
      ['Latest version', '0.6.0']
    ]));
    expect(within(screen.getByRole('region', { name: 'Versions' })).getByText('Local does not have the latest version.')).toBeVisible();
    expect(within(tab('About')).getByRole('img', { name: 'An update is available' })).toHaveClass('side-alert');
    // The app's own updates: the same card as in General.
    expect(within(screen.getByRole('region', { name: 'Updates' })).getByText('Ledge 0.6.0')).toBeVisible();
    expect(saved()).toEqual([]);
  });

  it('a daemon up to date: no « Update needed », no daemon update, no dot', async () => {
    await open({ version: '0.6.0', install: 'npm', systemd: true });
    await waitFor(() => expect(versions()[1]).toEqual(['Daemon · Local', '0.6.0· npm']));
    expect(screen.queryByText('Update needed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(tab('About').querySelector('.side-alert')).toBeNull();
  });

  it('« Update » sends update.daemon to the local daemon, then the log says so and the button waits', async () => {
    const { d, user } = await open(NPM_BEHIND);
    const update = await screen.findByRole('button', { name: 'Update' });
    expect(screen.getByText('The local daemon moves to Ledge 0.6.0, then restarts.')).toBeVisible();
    await user.click(update);
    await waitFor(() => expect(d.received.filter(m => m.type === 'update.daemon')).toEqual([{ type: 'update.daemon', version: '0.6.0' }]));
    expect(steps()).toEqual(['Request sent to the local daemon: 0.6.0']);
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
  });

  it('the log follows the daemon’s steps; a refusal shows with its command, and « Update » can be used again', async () => {
    const { d, user } = await open(NPM_BEHIND);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    act(() => d.push({ type: 'update.progress', version: '0.6.0', step: 'installing' }));
    await waitFor(() => expect(steps()).toEqual(['Request sent to the local daemon: 0.6.0', 'Installing the new version…']));
    act(() => d.push({ type: 'update.failed', version: '0.6.0', reason: 'sessions-at-risk', command: 'ledge update --force' }));
    await waitFor(() => expect(steps()).toHaveLength(3));
    expect(steps()[2]).toBe('Your sessions run inside the daemon service: a restart would close them. Close them, or restart WSL, then retry.ledge update --force');
    expect(within(log_()).getByText('ledge update --force').tagName).toBe('CODE');
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
  });

  it('a daemon from a git clone: the note and its command, no button', async () => {
    await open({ version: '0.5.0', install: 'git', systemd: true, manual: 'cd ~/ledge && git pull && pnpm build && ledge setup' });
    expect(await screen.findByText('Your daemon runs from a git clone: update it yourself.')).toBeVisible();
    expect(screen.getByText('cd ~/ledge && git pull && pnpm build && ledge setup').tagName).toBe('CODE');
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(versions()[1]).toEqual(['Daemon · Local', '0.5.0· git cloneUpdate needed']);
    expect(within(tab('About')).getByRole('img', { name: 'An update is available' })).toBeVisible();
  });

  it('every machine’s daemon: its version and install, « Update needed » only on the one behind', () => {
    const ctx = {
      machines: [
        machine('local', { daemon: { version: '0.6.0', install: 'npm', systemd: true } }),
        machine('nas', { label: 'NAS', daemon: { version: '0.5.2', install: 'git', systemd: true } }),
        machine('dev', { label: 'Dev', status: 'unreachable', ready: false })
      ],
      daemonUpdate: { offer: 'none', journal: [], running: false, start: () => {} },
      saved: () => {}, notify: () => {}, paused: true
    } as unknown as SettingsContext;
    render(<LangProvider lang="en"><About ctx={ctx} /></LangProvider>);
    expect(versions()).toEqual([
      ['Ledge Desktop', '0.6.0'],
      ['Daemon · Local', '0.6.0· npm'],
      ['Daemon · NAS', '0.5.2· git cloneUpdate needed'],
      ['Daemon · Dev', 'Unknown version'],
      ['Latest version', '0.6.0']
    ]);
    expect(screen.getByText('NAS does not have the latest version.')).toBeVisible();
  });
});
