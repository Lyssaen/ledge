import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { BrainStatus, ClientMessage, DaemonInfo } from '@ledge/protocol';
import { boot, closeDaemons, type MockDaemon } from './helpers';

const LOCAL = [{ id: 'local', label: 'Local' }];
const WITH: DaemonInfo = { version: '0.30.0', install: 'npm', systemd: true, openrig: true };
const WITHOUT: DaemonInfo = { version: '0.30.0', install: 'npm', systemd: true };
const home = () => within(screen.getByRole('region', { name: 'Home: Ledge, the operator' }));
const sets = (d: MockDaemon) => d.received.filter((m): m is Extract<ClientMessage, { type: 'brain.set' }> => m.type === 'brain.set');
const TEXT = /I can think continuously: I read the rigs’ escalations/;

beforeEach(() => localStorage.clear());
afterEach(async () => { vi.restoreAllMocks(); cleanup(); await closeDaemons(); });

async function openHome(daemon: DaemonInfo, status?: BrainStatus) {
  const env = await boot({ home: true, machines: LOCAL, sessions: [], daemon });
  await home().findByRole('tab', { name: 'Conversation' });
  if (status) env.d.push({ type: 'brain.status', status });
  return env;
}
const NEVER: BrainStatus = { state: 'off', tool: 'claude', enabled: null };

describe('the brain offer', () => {
  it('shows once with OpenRig and an unasked brain', async () => {
    await openHome(WITH, NEVER);
    expect(await home().findByText(TEXT)).toBeVisible();
    expect(home().getByRole('button', { name: 'Activate' })).toBeVisible();
    expect(home().getByRole('button', { name: 'Later' })).toBeVisible();
  });

  it('is absent once the brain was answered (enabled false), unknown, or without OpenRig', async () => {
    const a = await openHome(WITH, { state: 'off', tool: 'claude', enabled: false });
    await waitFor(() => expect(home().queryByText(TEXT)).toBeNull());
    a.view.unmount(); await closeDaemons();
    const b = await openHome(WITH, { state: 'off', tool: 'claude' });
    expect(home().queryByText(TEXT)).toBeNull();
    b.view.unmount(); await closeDaemons();
    await openHome(WITHOUT, NEVER);
    expect(home().queryByText(TEXT)).toBeNull();
  });

  it('« Activate » sends enabled true, first true, and hides the offer', async () => {
    const { d, user } = await openHome(WITH, NEVER);
    await user.click(await home().findByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(sets(d)).toEqual([{ type: 'brain.set', rid: expect.any(String), enabled: true, first: true }]));
    expect(home().queryByText(TEXT)).toBeNull();
  });

  it('« Later » sends enabled false', async () => {
    const { d, user } = await openHome(WITH, NEVER);
    await user.click(await home().findByRole('button', { name: 'Later' }));
    await waitFor(() => expect(sets(d)).toEqual([{ type: 'brain.set', rid: expect.any(String), enabled: false }]));
    expect(home().queryByText(TEXT)).toBeNull();
  });
});
