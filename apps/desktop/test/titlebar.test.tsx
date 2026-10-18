import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { boot, closeDaemons, listSessions, TWO_PROJECTS } from './helpers';
import { resetDndForTests } from '../src/notify/prefs';

// The window exists only in Tauri: the test plays the bridge (what the buttons call, the maximised state, the resize event).
const win = vi.hoisted(() => ({ minimize: vi.fn(), toggle: vi.fn(), close: vi.fn(), maximized: false, resize: null as null | (() => void) }));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  minimizeWindow: () => win.minimize(),
  toggleMaximizeWindow: () => win.toggle(),
  closeWindow: () => win.close(),
  isWindowMaximized: async () => win.maximized,
  onWindowResized: (fn: () => void) => { win.resize = fn; return () => { win.resize = null; }; }
}));

beforeEach(() => { localStorage.clear(); resetDndForTests(); win.maximized = false; vi.clearAllMocks(); });
afterEach(async () => { cleanup(); await closeDaemons(); });
const bar = () => within(screen.getByRole('group', { name: 'Window bar' }));

describe('the « Commande » title bar', () => {
  it('shows the word mark, the search field and the window buttons; the sidebar has neither brand nor search', async () => {
    const { side } = await boot({ projects: TWO_PROJECTS });
    const el = screen.getByRole('group', { name: 'Window bar' });
    expect(el).toHaveAttribute('data-tauri-drag-region');
    expect(el.querySelector('[data-brand]')).toHaveTextContent('Ledge.');
    expect(bar().getByRole('button', { name: 'Go to a session, a project, a setting…' })).toHaveTextContent('Ctrl K');
    for (const n of ['Minimize', 'Maximize', 'Close']) expect(bar().getByRole('button', { name: n })).toBeVisible();
    expect(document.querySelector('.sidebar [data-brand]')).toBeNull();
    expect(document.querySelector('.side-brand')).toBeNull();
    expect(side.queryByRole('button', { name: /Search|Go to a session/ })).toBeNull();
    expect(side.getByRole('button', { name: /New session/ })).toBeVisible();
  });

  it('the search field opens the search palette, as Ctrl K does', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    const field = bar().getByRole('button', { name: 'Go to a session, a project, a setting…' });
    await user.click(field);
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(field).toHaveFocus();
  });

  it('the waiting pill counts the sessions that wait and opens the first one', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    // Otto (permission, 12 min) and Kit (question, now) wait; Rio is offline and Nova works.
    const pill = bar().getByRole('button', { name: /waiting/ });
    expect(pill).toHaveTextContent('2');
    await user.click(pill);
    expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible();
  });

  it('the waiting pill is absent when nothing waits', async () => {
    await boot({ sessions: listSessions().filter(s => s.state === 'working' || s.state === 'exited') });
    expect(bar().queryByRole('button', { name: /waiting/ })).toBeNull();
  });

  it('the bell toggles Do not disturb, shared with useDnd', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    const bell = bar().getByRole('button', { name: 'Do not disturb' });
    expect(bell).toHaveAttribute('aria-pressed', 'false');
    await user.click(bell);
    expect(bell).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    act(() => { localStorage.setItem('desktop.dnd', '0'); resetDndForTests(); });
    await waitFor(() => expect(bell).toHaveAttribute('aria-pressed', 'false'));
  });

  it('the chat button opens the chat', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.click(bar().getByRole('button', { name: 'Chat Ledge' }));
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
  });

  it('the window buttons call the bridge; the maximise icon becomes restore when maximised', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.click(bar().getByRole('button', { name: 'Minimize' }));
    expect(win.minimize).toHaveBeenCalledTimes(1);
    await user.click(bar().getByRole('button', { name: 'Maximize' }));
    expect(win.toggle).toHaveBeenCalledTimes(1);
    win.maximized = true;
    await act(async () => { win.resize!(); });
    expect(await bar().findByRole('button', { name: 'Restore' })).toBeVisible();
    expect(bar().queryByRole('button', { name: 'Maximize' })).toBeNull();
    await user.click(bar().getByRole('button', { name: 'Close' }));
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  it('the top bar no longer has search nor chat buttons', async () => {
    await boot({ projects: TWO_PROJECTS });
    const top = within(screen.getByRole('banner'));
    expect(top.queryByRole('button', { name: /Search|Chat/ })).toBeNull();
    expect(top.getByRole('button', { name: 'Full screen' })).toBeVisible();
    expect(top.getByRole('button', { name: /Keyboard shortcuts/ })).toBeVisible();
  });

  it('the title bar is hidden in full screen', async () => {
    const { user } = await boot({ projects: TWO_PROJECTS });
    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.queryByRole('group', { name: 'Window bar' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('group', { name: 'Window bar' })).toBeVisible();
  });

  it('behind a dialog or a pending confirmation, the search, the pill, the bell and the chat do nothing; the window buttons stay live', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    const field = bar().getByRole('button', { name: 'Go to a session, a project, a setting…' });
    await user.keyboard('n');
    expect(await screen.findByRole('dialog', { name: 'New session' })).toBeVisible();
    await user.click(field);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
    expect(field.closest('[inert]')).not.toBeNull();
    expect(bar().getByRole('button', { name: /waiting/ }).closest('[inert]')).not.toBeNull();
    expect(bar().getByRole('button', { name: 'Close' }).closest('[inert]')).toBeNull();
    await user.click(bar().getByRole('button', { name: 'Minimize' }));
    expect(win.minimize).toHaveBeenCalledTimes(1);
  });

  it('with a confirmation pending, the pill and the search field do nothing and the confirmation stays', async () => {
    const { user } = await boot({ sessions: listSessions(), daemon: { version: '0.7.0', install: 'npm', systemd: true, archive: true } });
    fireEvent.contextMenu(await screen.findByRole('button', { name: /^Bix,/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete Bix?' })).toBeVisible();
    await user.click(bar().getByRole('button', { name: /waiting/ }));
    await user.click(bar().getByRole('button', { name: 'Go to a session, a project, a setting…' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete Bix?' })).toBeVisible();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(within(screen.getByRole('banner')).queryByText('Otto')).toBeNull();
  });
});
