import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import WebSocket from 'ws';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import type { TrayAction, TrayLabels } from '../src/tauri/bridge';

// The tray exists only in Tauri: the test takes the listener the Shell registers and plays the menu with it.
const tray = vi.hoisted(() => ({ fire: null as null | ((a: TrayAction) => void), labels: [] as TrayLabels[] }));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  onTrayAction: (fn: (a: TrayAction) => void) => { tray.fire = fn; return () => { tray.fire = null; }; },
  setTrayLabels: (l: TrayLabels) => { tray.labels.push(l); }
}));
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { resetDndForTests } from '../src/notify/prefs';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });
async function boot() {
  localStorage.clear(); resetDndForTests(); tray.labels = [];
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  const view = render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  await screen.findByText('Local connected');
  return { d, view };
}

describe('tray', () => {
  it('ignores « new » and « open » (no launch screen yet) and switches do not disturb on « dnd »', async () => {
    await boot();
    act(() => tray.fire!('new')); act(() => tray.fire!('open'));
    expect(screen.getByRole('heading', { name: 'Ledge Desktop' })).toBeVisible();
    act(() => tray.fire!('dnd'));
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    expect(tray.labels.at(-1)).toEqual({ open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Resume alerts', quit: 'Quit Ledge Desktop' });
    act(() => tray.fire!('dnd'));
    expect(localStorage.getItem('desktop.dnd')).toBe('0');
    expect(tray.labels.at(-1)?.dnd).toBe('Do not disturb');
  });

  it('stops listening when the app goes away', async () => {
    const { view } = await boot();
    expect(tray.fire).not.toBeNull();
    view.unmount();
    expect(tray.fire).toBeNull();
  });
});
