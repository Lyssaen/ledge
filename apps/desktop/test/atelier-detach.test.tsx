import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { NavAction } from '../src/nav/state';

// The two windows talk through Tauri events: the test plays the other window with the handlers each one registers.
const win = vi.hoisted(() => ({
  hub: null as null | { action(a: NavAction): void; closed(): void },
  open: false,
  detach: null as unknown as Mock<() => Promise<boolean>>, attach: null as unknown as Mock<() => void>,
  show: null as unknown as Mock<() => void>, toMain: null as unknown as Mock<(a: NavAction) => void>, close: null as unknown as Mock<() => void>
}));
vi.mock('../src/atelier/detach', async importOriginal => {
  win.detach = vi.fn(async () => true); win.attach = vi.fn(); win.show = vi.fn(); win.toMain = vi.fn(); win.close = vi.fn();
  return {
    ...(await importOriginal<typeof import('../src/atelier/detach')>()),
    canDetach: () => true,
    detachAtelier: () => win.detach(),
    atelierOpen: async () => win.open,
    attachAtelier: () => win.attach(),
    onAtelier: (fn: NonNullable<typeof win.hub>) => { win.hub = fn; return () => { win.hub = null; }; },
    showMainWindow: () => win.show(),
    toMain: (a: NavAction) => win.toMain(a),
    closeAtelierWindow: () => win.close(),
    watchAtelierWindow: () => () => {}
  };
});

import { createDesktopFleet } from '../src/fleet/useFleet';
import { AtelierApp } from '../src/atelier/AtelierWindow';
import { boot, closeDaemons } from './helpers';

beforeEach(() => { localStorage.clear(); win.open = false; for (const f of [win.detach, win.attach, win.show, win.toMain, win.close]) f.mockClear(); });
afterEach(async () => { cleanup(); await closeDaemons(); });

const away = () => screen.queryByRole('region', { name: 'The Atelier is in its own window' });

describe('the main window with the Atelier detached (#21)', () => {
  it('« Detach the Atelier » opens its window and leaves a place holder; the sessions still open here', async () => {
    const { side, user } = await boot();
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Detach the Atelier' }));
    expect(win.detach).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('region', { name: 'The Atelier is in its own window' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Ledge table' })).toBeNull();
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Detach the Atelier' })).toBeNull();
    await user.click(side.getByRole('button', { name: /^Otto/ }));
    expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible();
  });

  it('a session the detached Atelier opens shows here, the window brought forward; the rest of its asks too', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Detach the Atelier' }));
    await screen.findByRole('region', { name: 'The Atelier is in its own window' });
    act(() => win.hub!.action({ type: 'open', id: 'local:nova' }));
    expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
    expect(win.show).toHaveBeenCalled();
    act(() => win.hub!.action({ type: 'modal', modal: { kind: 'launch' } }));
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
  });

  it('closing the detached window gives the Atelier back, and the session open here stays', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Detach the Atelier' }));
    await screen.findByRole('region', { name: 'The Atelier is in its own window' });
    act(() => win.hub!.action({ type: 'open', id: 'local:nova' }));
    act(() => win.hub!.closed());
    expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(away()).toBeNull();
    expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  });

  it('the place holder shows the window again or brings the Atelier back here', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Detach the Atelier' }));
    const holder = within(await screen.findByRole('region', { name: 'The Atelier is in its own window' }));
    await user.click(holder.getByRole('button', { name: 'Show the Atelier' }));
    expect(win.detach).toHaveBeenCalledTimes(2);
    await user.click(holder.getByRole('button', { name: 'Bring it back here' }));
    expect(win.attach).toHaveBeenCalledTimes(1);
    expect(away()).toBeNull();
    expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  });

  it('a window that failed to open leaves the Atelier here', async () => {
    win.detach.mockResolvedValueOnce(false);
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Detach the Atelier' }));
    await waitFor(() => expect(win.detach).toHaveBeenCalled());
    expect(away()).toBeNull();
    expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  });

  it('a main window reloaded while the Atelier is detached knows it', async () => {
    win.open = true;
    await boot({ sessions: [] });
    expect(await screen.findByRole('region', { name: 'The Atelier is in its own window' })).toBeVisible();
  });
});

describe('the detached Atelier’s window (#21)', () => {
  async function atelier() {
    const d = await createMockDaemon();
    d.machines([{ id: 'local', label: 'Local' }]);
    d.projects({ projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] });
    d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' }));
    d.upsert(fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' }));
    render(<AtelierApp client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    await screen.findByRole('button', { name: /^Otto,/ });
    return { d, user: userEvent.setup(), close: () => d.close() };
  }

  it('shows the Atelier alone: no sidebar, no session page; a seat opens its session in the main window', async () => {
    const { user, close } = await atelier();
    try {
      expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull();
      expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
      await user.click(screen.getByRole('button', { name: /^Otto,/ }));
      expect(win.toMain).toHaveBeenCalledWith({ type: 'open', id: 'local:otto' });
      expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
      await user.keyboard('n');
      expect(win.toMain).toHaveBeenCalledWith({ type: 'modal', modal: { kind: 'launch' } });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally { await close(); }
  });

  it('follows the agents live and filters on its own', async () => {
    const { d, user, close } = await atelier();
    try {
      d.upsert(fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'working' }));
      expect(await screen.findByRole('button', { name: /^Rio,/ })).toBeVisible();
      expect(screen.getByRole('region', { name: 'No project' })).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Conversations of project Ledge' }));
      expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
      expect(win.toMain).not.toHaveBeenCalled();
    } finally { await close(); }
  });

  it('« Bring it back here » closes the window', async () => {
    const { user, close } = await atelier();
    try {
      await user.click(screen.getByRole('button', { name: 'Bring it back here' }));
      expect(win.close).toHaveBeenCalledTimes(1);
    } finally { await close(); }
  });
});
