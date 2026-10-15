import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import type { TrayAction } from '../src/tauri/bridge';

// The tray exists only in Tauri: the test takes the listener the Shell registers and plays the menu with it.
const tray = vi.hoisted(() => ({ fire: null as null | ((a: TrayAction) => void) }));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  onTrayAction: (fn: (a: TrayAction) => void) => { tray.fire = fn; return () => { tray.fire = null; }; }
}));
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { recent } from './launch-helpers';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });
async function boot() {
  localStorage.clear();
  const d = await createMockDaemon(); daemons.push(d);
  d.recents([recent('/w/ledge', '2026-10-15T09:00:00.000Z')]);
  d.machines([{ id: 'local', label: 'Local' }]);
  const view = render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  await screen.findByRole('button', { name: 'Start a session' });
  return { d, view };
}
const form = () => screen.queryByRole('form', { name: 'New session settings' });

describe('tray « Nouvelle session »', () => {
  it('opens the launch screen; « open » and « dnd » change nothing', async () => {
    await boot();
    act(() => tray.fire!('open'));
    act(() => tray.fire!('dnd'));
    expect(form()).toBeNull();
    act(() => tray.fire!('new'));
    expect(form()).not.toBeNull();
    expect(screen.getByLabelText('Machine')).toHaveFocus();
  });

  it('leaves an open form or a start as it is', async () => {
    const user = userEvent.setup();
    const { d } = await boot();
    act(() => tray.fire!('new'));
    await user.type(screen.getByLabelText('First instruction'), 'Keep me');
    act(() => tray.fire!('new'));
    expect(screen.getByLabelText('First instruction')).toHaveValue('Keep me');
    await user.click(screen.getByRole('button', { name: 'Start the session' }));
    await vi.waitFor(() => expect(d.received.filter(m => m.type === 'session.launch')).toHaveLength(1));
    act(() => tray.fire!('new'));
    expect(screen.getByRole('region', { name: 'Starting the session' })).toBeInTheDocument();
  });

  it('a tray « new » while the screen is open keeps the opener the focus goes back to', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: 'Start a session' }));
    act(() => tray.fire!('new'));
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(screen.getByRole('button', { name: 'Start a session' })).toHaveFocus();
  });

  it('stops listening when the app goes away', async () => {
    const { view } = await boot();
    expect(tray.fire).not.toBeNull();
    view.unmount();
    expect(tray.fire).toBeNull();
  });
});

class DeadSocket { onopen = null; onmessage: unknown = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 3; constructor(public url: string) { setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }
describe('tray while the local daemon is down', () => {
  it('is ignored: everything is read-only (spec §6)', async () => {
    localStorage.clear();
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    await screen.findByText('Local daemon unreachable');
    act(() => tray.fire!('new'));
    expect(form()).toBeNull();
  });
});
