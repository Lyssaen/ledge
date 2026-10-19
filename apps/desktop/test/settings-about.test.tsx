import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonInfo, Machines } from '@ledge/protocol';
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
const log_ = (label = 'Local') => screen.getByRole('list', { name: `Daemon log · ${label}` });
const steps = () => within(log_()).getAllByRole('listitem').map(li => li.textContent);

async function open(daemon?: DaemonInfo, machines?: Machines) {
  const env = await boot({ projects: TWO_PROJECTS, ...(daemon ? { daemon } : {}), ...(machines ? { machines } : {}) });
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(tab('About'));
  await screen.findByRole('heading', { level: 2, name: 'Versions' });
  return env;
}

describe('Settings › About', () => {
  it('shows Ledge, Desktop’s version and each machine’s daemon, « Update needed » on a daemon behind, then the latest version; a dot on About', async () => {
    await open(NPM_BEHIND);
    expect(screen.getByText('A new way of working with your agents. The notch and Ledge Desktop, one application.')).toBeVisible();
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

  it('Desktop updates a connected npm daemon behind it on its own (#48): update.daemon is sent once, the log says it is automatic, « Update » waits', async () => {
    const { d } = await open(NPM_BEHIND);
    await waitFor(() => expect(steps()).toEqual(['Automatic update of the daemon of Local: 0.6.0']));
    expect(d.received.filter(m => m.type === 'update.daemon')).toEqual([{ type: 'update.daemon', version: '0.6.0' }]);
    expect(screen.getByText('The daemon of Local moves to Ledge 0.6.0, then restarts.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
  });

  it('the logs sit in a polite live region, there before any step, so each step is heard', async () => {
    await open({ version: '0.6.0', install: 'npm', systemd: true });
    const live = document.querySelector('[aria-live="polite"].update-live');
    expect(live).not.toBeNull();
    expect(live).toBeEmptyDOMElement();
    cleanup(); await closeDaemons();
    await open(NPM_BEHIND);
    await waitFor(() => expect(document.querySelector('[aria-live="polite"].update-live')).toContainElement(log_()));
  });

  it('the log follows the daemon’s steps; a refusal shows with its command, is not retried on its own, and « Update » sends it again', async () => {
    const { d, user } = await open(NPM_BEHIND);
    await waitFor(() => expect(steps()).toHaveLength(1));
    act(() => d.push({ type: 'update.progress', version: '0.6.0', step: 'installing' }));
    await waitFor(() => expect(steps()).toEqual(['Automatic update of the daemon of Local: 0.6.0', 'Installing the new version…']));
    act(() => d.push({ type: 'update.failed', version: '0.6.0', reason: 'sessions-at-risk', command: 'ledge update --force' }));
    await waitFor(() => expect(steps()).toHaveLength(3));
    expect(steps()[2]).toBe('Your sessions run inside the daemon service: a restart would close them. Close them, or restart WSL, then retry.ledge update --force');
    expect(within(log_()).getByText('ledge update --force').tagName).toBe('CODE');
    expect(d.received.filter(m => m.type === 'update.daemon')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(steps()[3]).toBe('Request sent to the daemon of Local: 0.6.0'));
    expect(d.received.filter(m => m.type === 'update.daemon')).toHaveLength(2);
  });

  it('a daemon back with the version sent: the log says it is up to date', async () => {
    const { d } = await open(NPM_BEHIND);
    await waitFor(() => expect(steps()).toHaveLength(1));
    act(() => d.push({ type: 'update.progress', version: '0.6.0', step: 'restarting' }));
    await waitFor(() => expect(steps()).toHaveLength(2));
    d.extras.daemon = { version: '0.6.0', install: 'npm', systemd: true };
    await d.dropClients();
    await waitFor(() => expect(steps()).toEqual(['Automatic update of the daemon of Local: 0.6.0', 'Restarting the daemon…', 'Daemon up to date: 0.6.0']), { timeout: 8000 });
    await waitFor(() => expect(versions()[1]).toEqual(['Daemon · Local', '0.6.0· npm']));
  });

  it('a daemon away for its update is said updating in the sidebar, never offline, and Machines has no offline dot', async () => {
    const { d } = await open(NPM_BEHIND, [{ id: 'local', label: 'Local' }]);
    await waitFor(() => expect(steps()).toHaveLength(1));
    await d.close();
    const local = () => document.querySelector<HTMLElement>('.st-mach .machine-dot.updating')?.closest('button');
    await waitFor(() => expect(local()).toHaveAttribute('title', 'Local · daemon updating'), { timeout: 8000 });
    expect([...document.querySelectorAll<HTMLElement>('.st-mach')].map(b => b.title)).toEqual(['Local · daemon updating']);
    expect(tab('Machines').querySelector('.side-alert')).toBeNull();
    await userEvent.click(tab('Machines'));
    expect(within(await screen.findByRole('article', { name: 'Local' })).getByText('Connecting…')).toBeVisible();
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
      daemonUpdates: { of: () => ({ offer: 'none', journal: [], running: false }), updating: new Set(), start: () => {} },
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

  it('a remote machine’s daemon: its own button or manual command, its own log', async () => {
    const start = vi.fn();
    const ctx = {
      machines: [
        machine('local', { daemon: { version: '0.6.0', install: 'npm', systemd: true } }),
        machine('nas', { label: 'NAS', daemon: { version: '0.5.2', install: 'git', systemd: true, manual: 'cd ~/ledge && git pull' } }),
        machine('dev', { label: 'Dev', daemon: { version: '0.5.0', install: 'npm', systemd: true } })
      ],
      daemonUpdates: {
        of: (id: string) => id === 'nas' ? { offer: 'manual', journal: [], running: false }
          : id === 'dev' ? { offer: 'offer', journal: [{ kind: 'sent', version: '0.6.0', auto: true }, { kind: 'failed', reason: 'npm-failed', detail: 'EACCES' }], running: false }
          : { offer: 'none', journal: [], running: false },
        updating: new Set(), start
      },
      saved: () => {}, notify: () => {}, paused: true
    } as unknown as SettingsContext;
    render(<LangProvider lang="en"><About ctx={ctx} /></LangProvider>);
    expect(screen.getByText('cd ~/ledge && git pull').tagName).toBe('CODE');
    expect(screen.getByText('The daemon of Dev moves to Ledge 0.6.0, then restarts.')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Update' })).toHaveLength(1);
    expect(within(log_('Dev')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Automatic update of the daemon of Dev: 0.6.0', 'The daemon could not update. Nothing changed.EACCES']);
    expect(screen.queryByRole('list', { name: 'Daemon log · Local' })).toBeNull();
    screen.getByRole('button', { name: 'Update' }).click();
    expect(start).toHaveBeenCalledWith('dev');
  });
});
