import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../src/i18n/lang';
import { AboutPanel } from '../src/settings/AboutPanel';
import { createUpdater, type Updater } from '../src/update/store';
import type { AvailableUpdate } from '../src/update/bridge';
import type { DaemonUpdate } from '../src/update/daemon';
import { machine } from './launch-helpers';

const npm = { version: '0.5.1', install: 'npm' as const, systemd: true };
const machines = [machine('local', { daemon: npm }), machine('devbox', { daemon: { version: '0.5.2', install: 'git', systemd: true } })];
const idle: DaemonUpdate = { offer: 'none', journal: [], running: false, start: vi.fn() };
const release = (install = vi.fn(async () => {})): AvailableUpdate => ({ version: '0.6.0', notes: '', downloadAndInstall: install });
let u: Updater;
beforeEach(() => localStorage.clear());
afterEach(() => u?.stop());
async function started(check: () => Promise<AvailableUpdate | null>) {
  u = createUpdater({ check, version: async () => '0.5.1', relaunch: vi.fn(async () => {}), now: () => Date.UTC(2026, 9, 15, 9, 0), every: () => () => {} });
  await u.start();
  return u;
}

describe('About', () => {
  it('shows the app, each daemon and the latest version', async () => {
    render(<AboutPanel machines={machines} updater={await started(async () => null)} daemon={idle} />);
    expect(screen.getByRole('definition', { name: 'Desktop app' })).toHaveTextContent('0.5.1');
    expect(screen.getByRole('definition', { name: 'Daemon · Local' })).toHaveTextContent('0.5.1 · npm');
    expect(screen.getByRole('definition', { name: 'Daemon · Devbox' })).toHaveTextContent('0.5.2 · git clone');
    expect(screen.getByRole('definition', { name: 'Latest version' })).toHaveTextContent('Desktop is up to date');
    expect(screen.getByRole('button', { name: 'Update the app' })).toBeDisabled();
  });

  it('installs nothing until the click, then one download for a double click (Review Focus 5)', async () => {
    const install = vi.fn(async () => {});
    render(<AboutPanel machines={machines} updater={await started(async () => release(install))} daemon={idle} />);
    expect(screen.getByRole('definition', { name: 'Latest version' })).toHaveTextContent('0.6.0');
    expect(install).not.toHaveBeenCalled();
    await userEvent.dblClick(screen.getByRole('button', { name: 'Update the app' }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('says when the check failed and lets the user check again', async () => {
    let fail = true;
    render(<AboutPanel machines={machines} updater={await started(async () => { if (fail) throw new Error('offline'); return null; })} daemon={idle} />);
    expect(screen.getByText('The check failed. Check your connection.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Desktop is up to date.')).toBeInTheDocument();
  });

  it('turns the automatic check off', async () => {
    render(<AboutPanel machines={machines} updater={await started(async () => null)} daemon={idle} />);
    const toggle = screen.getByRole('switch', { name: 'Check for updates' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem('desktop.update.auto')).toBe('0');
  });

  it('offers the local daemon update and follows its journal', async () => {
    const start = vi.fn();
    const updater = await started(async () => release());
    const { rerender } = render(<AboutPanel machines={machines} updater={updater} daemon={{ offer: 'offer', journal: [], running: false, start }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Update the daemon' }));
    expect(start).toHaveBeenCalledTimes(1);
    rerender(<AboutPanel machines={machines} updater={updater} daemon={{ offer: 'offer', running: false, start, journal: [{ kind: 'sent', version: '0.6.0' }, { kind: 'installing' }, { kind: 'failed', reason: 'sessions-at-risk' }] }} />);
    const log = screen.getByRole('list', { name: 'Daemon log' });
    expect(log).toHaveTextContent('Request sent to the local daemon: 0.6.0');
    expect(log).toHaveTextContent('Installing the new version…');
    expect(log).toHaveTextContent('Your sessions run inside the daemon service');
    rerender(<AboutPanel machines={machines} updater={updater} daemon={{ offer: 'offer', running: true, start, journal: [{ kind: 'sent', version: '0.6.0' }] }} />);
    expect(screen.getByRole('button', { name: 'Update the daemon' })).toBeDisabled();
  });

  it('gives the manual command for a daemon it cannot update', async () => {
    const git = [machine('local', { daemon: { version: '0.5.1', install: 'git', systemd: true, manual: 'cd ~/ledge && git pull && pnpm install && pnpm build' } })];
    render(<AboutPanel machines={git} updater={await started(async () => release())} daemon={{ ...idle, offer: 'manual' }} />);
    expect(screen.queryByRole('button', { name: 'Update the daemon' })).toBeNull();
    expect(screen.getByText('Your daemon runs from a git clone: update it yourself.')).toBeInTheDocument();
    expect(screen.getByText('cd ~/ledge && git pull && pnpm install && pnpm build')).toBeInTheDocument();
  });

  it('never says "no systemd" for an install it cannot identify (parked T7)', async () => {
    const updater = await started(async () => release());
    const unknown = [machine('local', { daemon: { version: '0.5.1', install: 'unknown', systemd: true } })];
    const { unmount } = render(<AboutPanel machines={unknown} updater={updater} daemon={{ ...idle, offer: 'manual' }} />);
    expect(screen.getByText('Ledge cannot tell how your daemon was installed: update it yourself.')).toBeInTheDocument();
    expect(screen.queryByText(/does not run as a service/)).toBeNull();
    unmount();
    const { unmount: gone } = render(<LangProvider lang="fr"><AboutPanel machines={unknown} updater={updater} daemon={{ ...idle, offer: 'manual' }} /></LangProvider>);
    expect(screen.getByText('Ledge ne sait pas comment votre daemon a été installé : mettez-le à jour vous-même.')).toBeInTheDocument();
    gone();
    // an npm daemon without systemd still gets the systemd text
    render(<AboutPanel machines={[machine('local', { daemon: { version: '0.5.1', install: 'npm', systemd: false } })]} updater={updater} daemon={{ ...idle, offer: 'manual' }} />);
    expect(screen.getByText('The daemon does not run as a service: it cannot restart itself.')).toBeInTheDocument();
  });

  it('shows the download progress', async () => {
    let progress: (done: number, total: number | null) => void = () => {};
    const install = vi.fn((on: (done: number, total: number | null) => void) => { progress = on; return new Promise<void>(() => {}); });
    render(<AboutPanel machines={machines} updater={await started(async () => release(install))} daemon={idle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Update the app' }));
    act(() => progress(40, 100));
    expect(screen.getByRole('button', { name: 'Installing… 40%' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
  });
});
