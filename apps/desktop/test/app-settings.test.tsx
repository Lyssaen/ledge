import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { TrayAction, TrayLabels } from '../src/tauri/bridge';

// The tray exists only in Tauri: the test takes the Shell's listener and records the labels it sends.
const tray = vi.hoisted(() => ({ fire: null as null | ((a: TrayAction) => void), labels: [] as TrayLabels[] }));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  onTrayAction: (fn: (a: TrayAction) => void) => { tray.fire = fn; return () => { tray.fire = null; }; },
  setTrayLabels: (l: TrayLabels) => { tray.labels.push(l); }
}));
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { resetDndForTests, resetSoundPrefsForTests } from '../src/notify/prefs';
import { resetAppearanceForTests } from '../src/shell/theme';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); document.documentElement.lang = ''; for (const d of daemons.splice(0)) await d.close(); });

/** Two sessions waiting on local; the team view with the attention filter on and Luna selected. */
async function boot() {
  localStorage.clear(); resetDndForTests(); resetSoundPrefsForTests(); resetAppearanceForTests(); tray.labels.length = 0;
  localStorage.setItem('desktop.view', JSON.stringify({ view: 'team', attentionOnly: true }));
  localStorage.setItem('desktop.selected', 'local:luna');
  const d = await createMockDaemon(); daemons.push(d);
  d.upsert(fakeSession('otto', { name: 'Otto', state: 'waiting_permission' }));
  d.upsert(fakeSession('luna', { name: 'Luna', state: 'waiting_input' }));
  d.machines([{ id: 'local', label: 'Local' }]);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  await waitFor(() => expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:luna'));
  return d;
}
const settingsTitle = () => screen.queryByRole('heading', { level: 2, name: 'Settings' });
const lastLabels = () => tray.labels[tray.labels.length - 1];

describe('the settings screen in the Shell', () => {
  it('replaces the heading and the sessions, then gives back the view, the filter, the selection and the focus', async () => {
    const user = userEvent.setup();
    await boot();
    const stored = localStorage.getItem('desktop.view');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(settingsTitle()).toBeInTheDocument();
    expect(document.querySelector('[data-view]')).toBeNull();
    expect(document.querySelector('#conversation-pane')).toBeNull();
    expect(screen.getByRole('button', { name: 'Display' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Machines' }));
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(settingsTitle()).toBeNull();
    expect(document.querySelector('[data-view="team"]')).toHaveAttribute('aria-pressed', 'true');
    expect(document.getElementById('attention')).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:luna');
    expect(localStorage.getItem('desktop.view')).toBe(stored);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
    // The section is remembered for the session: ⚙ opens Machines again.
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Machines' })).toHaveAttribute('aria-current', 'page');
  });

  it('applies the language at once: the screen, the document and the tray', async () => {
    const user = userEvent.setup();
    await boot();
    expect(lastLabels()).toEqual({ open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge Desktop' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'fr');
    expect(screen.getByRole('heading', { level: 2, name: 'Paramètres' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('fr');
    expect(localStorage.getItem('desktop.lang')).toBe('fr');
    expect(lastLabels()).toEqual({ open: 'Ouvrir Ledge Desktop', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', quit: 'Quitter Ledge Desktop' });
    await user.click(screen.getByRole('button', { name: 'Retour aux sessions' }));
    expect(screen.getByRole('button', { name: 'Paramètres' })).toHaveFocus();
  });

  it('tray « Do not disturb » with the window hidden: nothing opens, the label and the switch follow', async () => {
    const user = userEvent.setup();
    await boot();
    act(() => tray.fire!('dnd'));
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    expect(settingsTitle()).toBeNull();
    expect(screen.queryByRole('form', { name: 'New session settings' })).toBeNull();
    expect(lastLabels()).toMatchObject({ dnd: 'Resume alerts' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    const sw = screen.getByRole('switch', { name: 'Do not disturb' });
    expect(sw).toBeChecked();
    act(() => tray.fire!('dnd'));
    expect(sw).not.toBeChecked();
    expect(localStorage.getItem('desktop.dnd')).toBe('0');
    expect(lastLabels()).toMatchObject({ dnd: 'Do not disturb' });
  });

  it('tray « New session » closes the settings and opens the launch screen', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    act(() => tray.fire!('new'));
    expect(settingsTitle()).toBeNull();
    expect(await screen.findByRole('form', { name: 'New session settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(screen.getByRole('button', { name: 'New session' })).toHaveFocus();
  });

  it('Sounds › Test goes through the app’s alerts: do not disturb is said, nothing plays', async () => {
    const user = userEvent.setup();
    await boot();
    act(() => tray.fire!('dnd'));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Sounds' }));
    await user.click(screen.getByRole('switch', { name: 'Sounds' }));
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(screen.getByRole('status')).toHaveTextContent('Do not disturb is on.');
  });
});
