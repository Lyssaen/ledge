import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { AgentStatus, DaemonInfo } from '@ledge/protocol';

// Agents on demand (spec 2026-11-03 §4.2.6): on native Windows, Settings shows whether Claude Code and Codex are installed
// and installs one; the launch form says what is missing.
const shell = vi.hoisted(() => ({ info: null as null | { mode: 'native' | 'wsl'; port: number } }));
vi.mock('../src/tauri/bridge', async orig => ({ ...(await orig<typeof import('../src/tauri/bridge')>()), nativeInfo: async () => shell.info }));

import { loadNativeInfo } from '../src/native/mode';
import { forgetAgents } from '../src/native/agents';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { loadComposer } from '../src/launch/lazy';
import { loadSettings } from '../src/settings/lazy';
import { loadWorkspace } from '../src/session/lazy';
import { PROJECTS } from './helpers';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'en'); });
afterEach(async () => { cleanup(); forgetAgents(); for (const d of daemons.splice(0)) await d.close(); shell.info = null; await loadNativeInfo(); });

const CLAUDE: AgentStatus = { tool: 'claude', found: true, path: 'C:\\Users\\po\\.local\\bin\\claude.exe', version: '2.1.302 (Claude Code)' };
const NO_CODEX: AgentStatus = { tool: 'codex', found: false };

async function boot(opts: { agents: boolean; native?: boolean; statuses?: () => AgentStatus[]; installing?: 'claude' | 'codex' }) {
  shell.info = opts.native ? { mode: 'native', port: 47831 } : null;
  await loadNativeInfo(); await loadSettings(); await loadComposer(); await loadWorkspace();
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]); d.projects(PROJECTS);
  const daemon: DaemonInfo = { version: '0.41.0', install: 'npm', systemd: false, models: true, ...(opts.agents ? { agents: true, platform: 'win32' } : {}) };
  d.extras.daemon = daemon;
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'idle' }));
  const statuses = opts.statuses ?? (() => [CLAUDE, NO_CODEX]);
  d.onMessage(m => { if (m.type === 'agents.status') d.push({ type: 'agents.listing', requestId: m.requestId, agents: statuses(), ...(opts.installing ? { installing: opts.installing } : {}) }); });
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  await screen.findByRole('complementary', { name: 'Sidebar' });
  const user = userEvent.setup();
  return { d, user };
}
const openGeneral = async (user: ReturnType<typeof userEvent.setup>) => { await user.keyboard('{Control>},{/Control}'); await screen.findByRole('heading', { level: 1, name: 'General' }); };

describe('the Agents card', () => {
  it('the card shows only when the local daemon offers it', async () => {
    const { d, user } = await boot({ agents: false });
    await openGeneral(user);
    expect(screen.queryByRole('region', { name: 'Agents' })).toBeNull();
    expect(d.received.some(m => m.type === 'agents.status')).toBe(false);
  });

  it('lists Claude Code and Codex with their state', async () => {
    const { user } = await boot({ agents: true });
    await openGeneral(user);
    const card = within(await screen.findByRole('region', { name: 'Agents' }));
    expect(await card.findByText('2.1.302 (Claude Code)')).toBeVisible();
    expect(card.getByText('Not installed')).toBeVisible();
    expect(card.getAllByRole('button', { name: /^Install/ })).toHaveLength(1);
  });

  it('Install sends agents.install, shows progress, then the new state and the login hint', async () => {
    let codex = NO_CODEX;
    const { d, user } = await boot({ agents: true, statuses: () => [CLAUDE, codex] });
    let installRid = '';
    d.onMessage(m => { if (m.type === 'agents.install') installRid = m.requestId; });
    await openGeneral(user);
    const card = within(await screen.findByRole('region', { name: 'Agents' }));
    await user.click(await card.findByRole('button', { name: 'Install Codex' }));
    await waitFor(() => expect(installRid).not.toBe(''));
    expect(card.getByText('Installing…')).toBeVisible();
    codex = { tool: 'codex', found: true, version: 'codex-cli 0.166.0' };
    d.push({ type: 'agents.installed', requestId: installRid, tool: 'codex', ok: true });
    expect(await card.findByText('codex-cli 0.166.0')).toBeVisible();
    expect(card.getByText(/sign in from the session’s terminal/)).toBeVisible();
  });

  it('a listing saying an install runs shows it (a Desktop reconnected mid-install), and the Install buttons wait', async () => {
    const { user } = await boot({ agents: true, installing: 'codex' });
    await openGeneral(user);
    const card = within(await screen.findByRole('region', { name: 'Agents' }));
    expect(await card.findByText('Installing…')).toBeVisible();
    expect(card.getByRole('button', { name: 'Install Codex' })).toBeDisabled();
  });

  it('the status is asked again when the local daemon comes back', async () => {
    const { d, user } = await boot({ agents: true });
    await openGeneral(user);
    await within(await screen.findByRole('region', { name: 'Agents' })).findByText('Not installed');
    const asked = () => d.received.filter(m => m.type === 'agents.status').length;
    const before = asked();
    await d.dropClients();
    await waitFor(() => expect(asked()).toBeGreaterThan(before), { timeout: 8000 });
  }, 12000);

  it('a failure shows the output tail and the manual command', async () => {
    const { d, user } = await boot({ agents: true });
    d.onMessage(m => { if (m.type === 'agents.install') d.push({ type: 'agents.installed', requestId: m.requestId, tool: 'codex', ok: false, code: 1, output: 'Access denied by policy', error: 'failed' }); });
    await openGeneral(user);
    const card = within(await screen.findByRole('region', { name: 'Agents' }));
    await user.click(await card.findByRole('button', { name: 'Install Codex' }));
    expect(await card.findByText('Access denied by policy')).toBeVisible();
    expect(card.getByText(/chatgpt\.com\/codex\/install\.ps1/)).toBeVisible();
  });
});

describe('the launch form on native Windows', () => {
  it('offers only Claude Code and Codex', async () => {
    const { user } = await boot({ agents: true, native: true });
    await user.click(await screen.findByRole('button', { name: 'Launch a session' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: /Change/ }));
    expect(dialog.queryByText('Cursor Agent')).toBeNull();
    expect(dialog.queryByText('OMP')).toBeNull();
    expect(dialog.getAllByText('Codex').length).toBeGreaterThan(0);
  });

  it('says Codex is missing and links to the card; Launch is disabled', async () => {
    const { user } = await boot({ agents: true, native: true });
    await user.click(await screen.findByRole('button', { name: 'Launch a session' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: /Change/ }));
    await user.click(dialog.getAllByText('Codex')[0]!);
    expect(await dialog.findByText('Codex is not installed on this PC.')).toBeVisible();
    expect(dialog.getByRole('button', { name: /^Launch/ })).toHaveAttribute('aria-disabled', 'true');
    await user.click(dialog.getByRole('button', { name: 'Install it' }));
    expect(await screen.findByRole('region', { name: 'Agents' })).toBeVisible();
  });
});
