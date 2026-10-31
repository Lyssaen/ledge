import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { NavAction } from '../src/nav/state';

// The two windows talk through Tauri events: the test plays the other window with the handlers each one registers.
const win = vi.hoisted(() => ({
  hub: null as null | { action(a: NavAction): void; terminal(id: string): void; closed(): void },
  open: false,
  detach: null as unknown as Mock<() => Promise<boolean>>, attach: null as unknown as Mock<() => void>,
  show: null as unknown as Mock<() => void>, toMain: null as unknown as Mock<(a: NavAction) => void>, close: null as unknown as Mock<() => void>,
  terminalToMain: null as unknown as Mock<(id: string) => void>
}));
vi.mock('../src/atelier/detach', async importOriginal => {
  win.detach = vi.fn(async () => true); win.attach = vi.fn(); win.show = vi.fn(); win.toMain = vi.fn(); win.close = vi.fn(); win.terminalToMain = vi.fn();
  return {
    ...(await importOriginal<typeof import('../src/atelier/detach')>()),
    canDetach: () => true,
    detachAtelier: () => win.detach(),
    atelierOpen: async () => win.open,
    attachAtelier: () => win.attach(),
    onAtelier: (fn: NonNullable<typeof win.hub>) => { win.hub = fn; return () => { win.hub = null; }; },
    showMainWindow: () => win.show(),
    toMain: (a: NavAction) => win.toMain(a),
    terminalToMain: (id: string) => win.terminalToMain(id),
    closeAtelierWindow: () => win.close(),
    watchAtelierWindow: () => () => {}
  };
});

// The window buttons go through the bridge, which acts on the current window (here, the detached one).
const caps = vi.hoisted(() => ({ minimize: vi.fn(), toggle: vi.fn(), maximized: false, resize: null as null | (() => void) }));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  minimizeWindow: () => caps.minimize(),
  toggleMaximizeWindow: () => caps.toggle(),
  isWindowMaximized: async () => caps.maximized,
  onWindowResized: (fn: () => void) => { caps.resize = fn; return () => { caps.resize = null; }; }
}));

// Full screen acts on the current window (here, the detached one): the test plays the window leaving it by itself.
const full = vi.hoisted(() => ({ set: vi.fn(async (_on: boolean) => {}), left: null as null | (() => void) }));
vi.mock('../src/shell/fullscreen', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/shell/fullscreen')>()),
  setWindowFullscreen: (on: boolean) => full.set(on),
  onFullscreenLeft: (cb: () => void) => { full.left = cb; return () => { full.left = null; }; }
}));

import { createDesktopFleet } from '../src/fleet/useFleet';
import { AtelierApp } from '../src/atelier/AtelierWindow';
import { boot, closeDaemons } from './helpers';

beforeEach(() => { localStorage.clear(); win.open = false; caps.maximized = false; for (const f of [win.detach, win.attach, win.show, win.toMain, win.close, win.terminalToMain, caps.minimize, caps.toggle, full.set]) f.mockClear(); });
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

  it('a « Terminal » from the detached Atelier shows the session here with its pane, the window brought forward', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Detach the Atelier' }));
    await screen.findByRole('region', { name: 'The Atelier is in its own window' });
    act(() => win.hub!.terminal('local:nova'));
    expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
    expect(JSON.parse(localStorage.getItem('desktop.session')!)).toMatchObject({ terminal: true });
    expect(win.show).toHaveBeenCalled();
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
    d.projects({ projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] });
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

  it('its menu\'s « Terminal » asks the main window for the session with its pane', async () => {
    const { user, close } = await atelier();
    try {
      fireEvent.contextMenu(screen.getByRole('button', { name: /^Otto,/ }));
      const menu = await screen.findByRole('menu', { name: 'Manage Otto' });
      await user.click(within(menu).getByRole('menuitem', { name: 'Terminal' }));
      expect(win.terminalToMain).toHaveBeenCalledWith('local:otto');
      expect(win.toMain).not.toHaveBeenCalled();
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

  it('has the Ledge window bar in place of Windows\' (#30): the word mark, « Atelier », « Bring it back here » and the window buttons', async () => {
    const { close } = await atelier();
    try {
      const el = screen.getByRole('group', { name: 'Window bar' });
      expect(el).toHaveClass('titlebar');
      expect(el).toHaveAttribute('data-tauri-drag-region');
      expect(el.querySelector('[data-brand]')).toHaveTextContent('Ledge.');
      const bar = within(el);
      expect(bar.getByText('Atelier')).toBeVisible();
      expect(bar.getByRole('button', { name: 'Bring it back here' })).toBeVisible();
      for (const n of ['Minimize', 'Maximize', 'Close']) expect(bar.getByRole('button', { name: n })).toBeVisible();
      expect(document.querySelector('.atelier-alone-bar')).toBeNull();
      expect(document.querySelectorAll('.titlebar')).toHaveLength(1);
    } finally { await close(); }
  });

  it('its window buttons minimise, maximise and restore it; its × closes it, which gives the Atelier back', async () => {
    const { user, close } = await atelier();
    try {
      const bar = within(screen.getByRole('group', { name: 'Window bar' }));
      await user.click(bar.getByRole('button', { name: 'Minimize' }));
      expect(caps.minimize).toHaveBeenCalledTimes(1);
      await user.click(bar.getByRole('button', { name: 'Maximize' }));
      expect(caps.toggle).toHaveBeenCalledTimes(1);
      caps.maximized = true;
      await act(async () => { caps.resize!(); });
      expect(await bar.findByRole('button', { name: 'Restore' })).toBeVisible();
      await user.click(bar.getByRole('button', { name: 'Close' }));
      expect(win.close).toHaveBeenCalledTimes(1);
    } finally { await close(); }
  });

  it('goes full screen on its own (#41): no window bar, a way out, and nothing asked of the main window', async () => {
    const { user, close } = await atelier();
    try {
      await user.click(within(screen.getByRole('group', { name: 'Window bar' })).getByRole('button', { name: 'Full screen' }));
      expect(full.set).toHaveBeenLastCalledWith(true);
      expect(screen.queryByRole('group', { name: 'Window bar' })).toBeNull();
      expect(document.querySelector('.atelier-alone')).toHaveClass('immersive');
      expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Exit full screen' }));
      expect(full.set).toHaveBeenLastCalledWith(false);
      expect(screen.getByRole('group', { name: 'Window bar' })).toBeVisible();
      expect(document.querySelector('.atelier-alone')).not.toHaveClass('immersive');
      expect(screen.queryByRole('button', { name: 'Exit full screen' })).toBeNull();
      expect(win.toMain).not.toHaveBeenCalled();
    } finally { await close(); }
  });

  it('Escape, or the window leaving full screen by itself, brings its bar back', async () => {
    const { user, close } = await atelier();
    try {
      await user.click(screen.getByRole('button', { name: 'Full screen' }));
      await user.keyboard('{Escape}');
      expect(full.set).toHaveBeenLastCalledWith(false);
      expect(screen.getByRole('group', { name: 'Window bar' })).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Full screen' }));
      act(() => full.left!());
      expect(screen.getByRole('group', { name: 'Window bar' })).toBeVisible();
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
