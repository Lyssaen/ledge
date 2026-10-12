import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createMockDaemon, fakeSession } from './mockDaemon';
import { createDaemonClient } from '../src/daemon/client';
import { attachClient, daemonStore } from '../src/daemon/store';
import { useUpdate } from '../src/update/useUpdate';

let cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.reverse()) await c(); cleanup = []; daemonStore.reset(); localStorage.clear(); });

async function setup(daemonVersion = '0.2.2', check?: () => Promise<null>) {
  const daemon = await createMockDaemon();
  daemon.extras.daemon = { version: daemonVersion, install: 'npm', systemd: true };
  daemon.sessions.set('a', fakeSession('a', { name: 'Otto' }));
  const client = createDaemonClient({ url: daemon.url, minBackoffMs: 20, maxBackoffMs: 50 });
  const off = attachClient(client); client.connect();
  cleanup.push(() => { off(); client.close(); }, () => daemon.close());
  const install = vi.fn(async (p: (d: number, t: number | null) => void) => { p(5, 10); p(10, 10); });
  const relaunch = vi.fn(async () => {});
  const hook = renderHook(() => useUpdate(client, { version: async () => '0.2.2', check: check ?? (async () => ({ version: '0.3.0', notes: '- Une', downloadAndInstall: install })), relaunch, waitMs: 200 }));
  await waitFor(() => expect(hook.result.current.card.kind).toBe('available'));
  return { daemon, hook, install, relaunch, client };
}

describe('useUpdate', () => {
  it('asks the daemon, then installs the app once it is back with every session', async () => {
    const { daemon, hook, install, relaunch } = await setup();
    act(() => hook.result.current.start());
    await waitFor(() => expect(daemon.received).toContainEqual({ type: 'update.daemon', version: '0.3.0' }));
    // The daemon restarts: the socket drops, then the new daemon answers with 0.3.0 and the same sessions.
    daemon.extras.daemon = { version: '0.3.0', install: 'npm', systemd: true };
    await daemon.dropClients();
    await waitFor(() => expect(install).toHaveBeenCalledOnce());
    await waitFor(() => expect(relaunch).toHaveBeenCalledOnce());
    expect(localStorage.getItem('ledge.update.from')).toBe('0.2.2');
  });
  it('never installs the app when a session did not come back', async () => {
    const { daemon, hook, install } = await setup();
    act(() => hook.result.current.start());
    await waitFor(() => expect(daemon.received).toContainEqual({ type: 'update.daemon', version: '0.3.0' }));
    daemon.extras.daemon = { version: '0.3.0', install: 'npm', systemd: true };
    daemon.sessions.delete('a');
    await daemon.dropClients();
    await waitFor(() => expect(hook.result.current.card).toMatchObject({ kind: 'failed', reason: 'sessions-lost', missing: ['Otto'] }));
    expect(install).not.toHaveBeenCalled();
  });
  it('remembers "later" across reloads', async () => {
    const { hook } = await setup();
    act(() => hook.result.current.later());
    expect(hook.result.current.card.kind).toBe('hidden');
    expect(localStorage.getItem('ledge.update.dismissed')).toBe('0.3.0');
  });
  it('gives up when the daemon does not answer in time', async () => {
    const { daemon, hook } = await setup();
    act(() => hook.result.current.start());
    await waitFor(() => expect(daemon.received).toContainEqual({ type: 'update.daemon', version: '0.3.0' }));
    await daemon.dropClients(); // it restarts but still reports 0.2.2
    await waitFor(() => expect(hook.result.current.card).toMatchObject({ kind: 'failed', reason: 'daemon-timeout' }), { timeout: 4000 });
  });
  it('fails instead of hanging when the daemon is at the target but no update is held', async () => {
    const { hook, install } = await setup('0.3.0', async () => null);
    act(() => hook.result.current.start());
    await waitFor(() => expect(hook.result.current.card).toMatchObject({ kind: 'failed', reason: 'download' }));
    expect(install).not.toHaveBeenCalled();
  });
  it('does nothing when the daemon socket is not open', async () => {
    const { daemon, hook, client } = await setup();
    vi.spyOn(client, 'status').mockReturnValue('connecting');
    const before = daemon.received.length;
    act(() => hook.result.current.start());
    expect(hook.result.current.card.kind).toBe('available');
    expect(daemon.received.slice(before)).not.toContainEqual({ type: 'update.daemon', version: '0.3.0' });
  });
});
