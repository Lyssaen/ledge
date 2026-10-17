import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { ClientMessage } from '@ledge/protocol';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import type { TrayLabels } from '../src/tauri/bridge';
import type { UiScale } from '@ledge/ui/scale';

// Launch at login, the tray and the WebView zoom exist only in Tauri: the test plays them. A language's strings can fail to load.
const bridge = vi.hoisted(() => ({
  getAutostart: null as unknown as () => Promise<boolean | null>,
  setAutostart: null as unknown as (on: boolean) => Promise<boolean | null>,
  labels: [] as TrayLabels[]
}));
vi.mock('../src/tauri/bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/tauri/bridge')>()),
  getAutostart: () => bridge.getAutostart(),
  setAutostart: (on: boolean) => bridge.setAutostart(on),
  setTrayLabels: (l: TrayLabels) => { bridge.labels.push(l); }
}));
const strings = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/i18n/messages', async importOriginal => {
  const real = await importOriginal<typeof import('../src/i18n/messages')>();
  return { ...real, loadMessages: (l: 'fr' | 'en') => (strings.fail ? Promise.reject(new Error('chunk failed')) : real.loadMessages(l)) };
});
// saveUiScale answers `resolved` at once, unless `held`: then each call waits for its own `answer`.
// `native`: the app's WebView zoom is there (Tauri), so a null answer is a refusal; without it (the browser) null is all there is.
const zoom = vi.hoisted(() => ({ calls: [] as unknown[], resolved: 1.25 as number | null, held: false, answers: [] as ((f: number | null) => void)[], native: false }));
vi.mock('../src/settings/scale', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/settings/scale')>()),
  zoomsNatively: () => zoom.native,
  saveUiScale: (s: UiScale) => {
    zoom.calls.push(s);
    return zoom.held ? new Promise<number | null>(r => { zoom.answers.push(r); }) : Promise.resolve(zoom.resolved);
  }
}));

import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { loadSettings } from '../src/settings/lazy';
import { loadChat } from '../src/chat/lazy';
import { applyUiScale, resetAppliedUiScaleForTests } from '../src/settings/scale';
import { saveReduced } from '../src/motionPreferences';
import { resetAppearanceForTests } from '../src/shell/theme';
import { boot, closeDaemons, recordToasts, savedNotices, TWO_PROJECTS, type MockDaemon } from './helpers';

let log: string[] = [];
beforeEach(async () => {
  log = recordToasts();
  saveReduced(false); resetAppliedUiScaleForTests();
  localStorage.clear(); resetAppearanceForTests();
  bridge.getAutostart = () => Promise.resolve(false);
  bridge.setAutostart = on => Promise.resolve(on);
  bridge.labels = [];
  strings.fail = false;
  zoom.calls = []; zoom.resolved = 1.25; zoom.held = false; zoom.answers = []; zoom.native = false;
  await loadChat();
});
const daemons: MockDaemon[] = [];
afterEach(async () => { for (const d of daemons.splice(0)) await d.close(); await closeDaemons(); });

const LOCAL = [{ id: 'local', label: 'Local' }];
const nav = (name: string) => within(screen.getByRole('navigation', { name }));
/** Every « Setting saved » said since the test began (the screen keeps only the last one, which cannot count them). */
const saved = () => savedNotices(log);
const sw = (name: string) => screen.getByRole('switch', { name });
const asks = (d: MockDaemon) => d.received.filter((m): m is Extract<ClientMessage, { type: 'chat.ask' }> => m.type === 'chat.ask');

/** The app in French (`desktop.lang` = 'fr'), on one local machine, opened on Settings › Général. */
async function bootFrench() {
  await loadSettings();
  localStorage.setItem('desktop.lang', 'fr');
  const d = await createMockDaemon(); daemons.push(d);
  d.machines(LOCAL);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  await screen.findByRole('complementary', { name: 'Barre latérale' });
  const user = userEvent.setup();
  await user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'Général' });
  return { d, user };
}

/** The app (English, the suite's language) on one local machine, opened on Settings › `section`. */
async function openSettings(section = 'General') {
  const env = await boot({ projects: TWO_PROJECTS, machines: LOCAL });
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  if (section !== 'General') {
    await env.user.click(nav('Settings sections').getByRole('button', { name: new RegExp(`^${section}`) }));
    await screen.findByRole('heading', { level: 1, name: section });
  }
  return env;
}

describe('Settings › General: the language', () => {
  it('English loads, then the whole app, <html lang> and the tray speak it; one « Setting saved », none at mount', async () => {
    const { user } = await bootFrench();
    expect(document.documentElement.lang).toBe('fr');
    expect(bridge.labels.at(-1)).toEqual({ open: 'Ouvrir Ledge Desktop', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', quit: 'Quitter Ledge Desktop' });
    expect(saved()).toEqual([]);
    const group = screen.getByRole('radiogroup', { name: 'Langue' });
    expect(within(group).getByRole('radio', { name: 'Français' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'English' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('desktop.lang')).toBe('en');
    await waitFor(() => expect(bridge.labels.at(-1)).toEqual({ open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge Desktop' }));
    expect(within(screen.getByRole('radiogroup', { name: 'Language' })).getByRole('radio', { name: 'English' })).toBeChecked();
    expect(saved()).toEqual(['Setting saved · English']);
    expect(saved()).toHaveLength(1);
  });

  it('English failing to load leaves the app in French, and says so; nothing is saved', async () => {
    const { user } = await bootFrench();
    strings.fail = true;
    await user.click(screen.getByRole('radio', { name: 'English' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Le français reste affiché : l’anglais n’a pas pu être chargé.');
    expect(screen.getByRole('heading', { level: 1, name: 'Général' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Français' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'English' })).not.toBeChecked();
    expect(document.documentElement.lang).toBe('fr');
    expect(localStorage.getItem('desktop.lang')).toBe('fr');
    expect(bridge.labels.at(-1)?.open).toBe('Ouvrir Ledge Desktop');
    expect(saved()).toEqual([]);
  });
});

describe('Settings › General: start with Windows', () => {
  it('disabled while Windows is asked; not offered here (null): disabled, with why', async () => {
    let answer!: (v: boolean | null) => void;
    bridge.getAutostart = () => new Promise(r => { answer = r; });
    await openSettings();
    expect(sw('Start with Windows')).toBeDisabled();
    answer(null);
    await waitFor(() => expect(sw('Start with Windows')).toHaveAccessibleDescription('Not offered here: only the installed app can start with Windows.'));
    expect(sw('Start with Windows')).toBeDisabled();
    expect(sw('Start with Windows')).toHaveAttribute('aria-checked', 'false');
  });

  it('a change Windows did not take keeps the previous state and says so; one that it took is saved once', async () => {
    const { user } = await openSettings();
    await waitFor(() => expect(sw('Start with Windows')).toBeEnabled());
    bridge.setAutostart = () => Promise.resolve(null);
    await user.click(sw('Start with Windows'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Windows did not take this setting.');
    expect(sw('Start with Windows')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Start with Windows')).toBeEnabled();
    expect(saved()).toEqual([]);
    const calls: boolean[] = [];
    bridge.setAutostart = on => { calls.push(on); return Promise.resolve(on); };
    await user.click(sw('Start with Windows'));
    await waitFor(() => expect(sw('Start with Windows')).toHaveAttribute('aria-checked', 'true'));
    expect(calls).toEqual([true]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(saved()).toEqual(['Setting saved · Start with Windows']);
  });
});

describe('Settings › General: the default agent', () => {
  it('Codex chosen: the chat’s next question goes out with Codex; changed while the chat is open, it follows', async () => {
    const { d, user } = await openSettings();
    const group = screen.getByRole('radiogroup', { name: 'Default agent' });
    expect(within(group).getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Codex' }));
    expect(localStorage.getItem('desktop.tool')).toBe('"codex"');
    expect(saved()).toEqual(['Setting saved · Default agent: Codex']);
    await user.click(within(screen.getByRole('complementary', { name: 'Sidebar' })).getByRole('button', { name: /^Chat Ledge/ }));
    const field = () => within(screen.getByRole('complementary', { name: 'Chat Ledge' })).getByRole('textbox', { name: 'Ask Ledge' });
    await user.type(field(), 'Who reviews?{Enter}');
    await waitFor(() => expect(asks(d)).toHaveLength(1));
    expect(asks(d)[0]).toMatchObject({ text: 'Who reviews?', tool: 'codex' });
    d.push({ type: 'chat.done', qid: asks(d)[0]!.qid, text: 'Otto.', at: new Date().toISOString() });   // the field takes a new question once the turn ends
    await screen.findByText('Otto.');
    await user.click(within(screen.getByRole('radiogroup', { name: 'Default agent' })).getByRole('radio', { name: 'Cursor Agent' }));
    await user.type(field(), 'And now?{Enter}');
    await waitFor(() => expect(asks(d)).toHaveLength(2));
    expect(asks(d)[1]).toMatchObject({ text: 'And now?', tool: 'cursor' });
  });

  it('an unknown stored value falls back to Claude Code', async () => {
    localStorage.setItem('desktop.tool', '"gemini"');
    await openSettings();
    expect(within(screen.getByRole('radiogroup', { name: 'Default agent' })).getByRole('radio', { name: 'Claude Code' })).toBeChecked();
  });
});

describe('Settings › General: updates', () => {
  it('the automatic check is a switch; Install shows only when a version is available', async () => {
    const { user } = await openSettings();
    const updates = within(screen.getByRole('region', { name: 'Updates' }));
    expect(updates.getByRole('switch', { name: 'Check for updates' })).toHaveAttribute('aria-checked', 'true');
    expect(updates.getByRole('button', { name: 'Check' })).toBeEnabled();
    expect(updates.queryByRole('button', { name: 'Install' })).toBeNull();
    await user.click(updates.getByRole('switch', { name: 'Check for updates' }));
    expect(updates.getByRole('switch', { name: 'Check for updates' })).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('desktop.update.auto')).toBe('0');
    expect(saved()).toEqual(['Setting saved · Manual update checks']);
  });
});

describe('Settings › Appearance', () => {
  it('an invalid hex (#12) changes nothing and says so; a valid one is saved once; Coral goes back to the default', async () => {
    const { user } = await openSettings('Appearance');
    const hex = screen.getByRole('textbox', { name: 'Hex code' });
    expect(hex).toHaveValue('#e85d4a');
    expect(screen.getByRole('button', { name: 'Coral' })).toBeDisabled();
    await user.clear(hex);
    await user.type(hex, '#12');
    expect(screen.queryByRole('alert')).toBeNull();                          // checked when the field is left
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid color: use # and six hexadecimal characters.');
    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    expect(saved()).toEqual([]);
    await user.clear(hex);
    await user.type(hex, '#12AB34');
    await user.tab();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(localStorage.getItem('desktop.accent')).toBe('#12ab34');
    expect(screen.getByLabelText('Custom color')).toHaveValue('#12ab34');
    expect(saved()).toEqual(['Setting saved · Ledge’s color #12ab34']);
    await user.click(screen.getByRole('button', { name: 'Coral' }));
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    expect(hex).toHaveValue('#e85d4a');
    expect(screen.getByRole('button', { name: 'Coral' })).toBeDisabled();
    expect(saved()).toEqual(['Setting saved · Ledge’s color #12ab34', 'Setting saved · Ledge’s color: Coral']);
  });

  it('Escape in the hex field puts the stored color back and stays in Settings; the next Escape leaves', async () => {
    const { user } = await openSettings('Appearance');
    const hex = screen.getByRole('textbox', { name: 'Hex code' });
    await user.clear(hex);
    await user.type(hex, '#12');
    await user.keyboard('{Escape}');
    expect(hex).toHaveValue('#e85d4a');
    expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
    await user.tab();                                                        // leaving the field keeps nothing
    expect(screen.queryByRole('alert')).toBeNull();
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    // An invalid value already said (the field left): Escape takes it back too.
    await user.clear(hex);
    await user.type(hex, '#zz');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid color');
    await user.keyboard('{Escape}');
    expect(hex).toHaveValue('#e85d4a');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
    expect(saved()).toEqual([]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
  });

  it('the picker keeps the color it lands on, not each one it passes over: one change, one notice', async () => {
    await openSettings('Appearance');
    const picker = screen.getByLabelText('Custom color');
    for (const v of ['#110000', '#111100', '#112233']) fireEvent.input(picker, { target: { value: v } });
    expect(screen.getByRole('textbox', { name: 'Hex code' })).toHaveValue('#112233');
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    expect(saved()).toEqual([]);
    fireEvent.change(picker);
    expect(localStorage.getItem('desktop.accent')).toBe('#112233');
    expect(saved()).toEqual(['Setting saved · Ledge’s color #112233']);
  });

  it('the scale goes through saveUiScale; « Auto » shows the factor it resolved to', async () => {
    const { user } = await openSettings('Appearance');
    const group = () => within(screen.getByRole('radiogroup', { name: 'Interface scale' }));
    expect(group().getByRole('radio', { name: 'Auto' })).toBeChecked();
    await user.click(group().getByRole('radio', { name: '150%' }));
    await waitFor(() => expect(zoom.calls).toEqual([1.5]));
    expect(group().getByRole('radio', { name: '150%' })).toBeChecked();
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Interface scale 150%']));
    await user.click(group().getByRole('radio', { name: 'Auto' }));
    await waitFor(() => expect(zoom.calls).toEqual([1.5, 'auto']));
    expect(await group().findByRole('radio', { name: 'Auto (125%)' })).toBeChecked();
  });

  it('in the app, a zoom the WebView refuses says so beside the scale, and nothing is said saved; the next one that takes clears it', async () => {
    zoom.native = true; zoom.resolved = null;
    const { user } = await openSettings('Appearance');
    const group = () => within(screen.getByRole('radiogroup', { name: 'Interface scale' }));
    await user.click(group().getByRole('radio', { name: '150%' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The scale could not be applied.');
    expect(saved()).toEqual([]);
    zoom.resolved = 2;
    await user.click(group().getByRole('radio', { name: '200%' }));
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Interface scale 200%']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('in the browser (no WebView zoom), the scale is kept and said saved as before', async () => {
    zoom.resolved = null;
    const { user } = await openSettings('Appearance');
    await user.click(within(screen.getByRole('radiogroup', { name: 'Interface scale' })).getByRole('radio', { name: '150%' }));
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Interface scale 150%']));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a late answer to an earlier choice is ignored: the notice and « Auto (…) » follow the last click', async () => {
    zoom.held = true;
    const { user } = await openSettings('Appearance');
    const group = () => within(screen.getByRole('radiogroup', { name: 'Interface scale' }));
    await user.click(group().getByRole('radio', { name: '150%' }));
    await user.click(group().getByRole('radio', { name: 'Auto' }));
    expect(zoom.calls).toEqual([1.5, 'auto']);
    await act(async () => { zoom.answers[1]!(1.25); });
    expect(await group().findByRole('radio', { name: 'Auto (125%)' })).toBeChecked();
    expect(saved()).toEqual(['Setting saved · Interface scale Auto']);
    await act(async () => { zoom.answers[0]!(1.5); });
    expect(group().getByRole('radio', { name: 'Auto (125%)' })).toBeChecked();
    expect(saved()).toEqual(['Setting saved · Interface scale Auto']);
  });

  it('« Auto » opens with the factor the start-up applied', async () => {
    await applyUiScale('auto', { setZoom: () => Promise.resolve(), screenHeight: () => Promise.resolve(3240) });
    await openSettings('Appearance');
    expect(within(screen.getByRole('radiogroup', { name: 'Interface scale' })).getByRole('radio', { name: 'Auto (150%)' })).toBeChecked();
    expect(saved()).toEqual([]);
  });

  it('the theme cards and reduced motion apply at once, each saved once', async () => {
    const { user } = await openSettings('Appearance');
    const themes = within(screen.getByRole('radiogroup', { name: 'Theme' }));
    expect(themes.getByRole('radio', { name: /^Dark/ })).toBeChecked();
    await user.click(themes.getByRole('radio', { name: /^Light/ }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('desktop.theme')).toBe('light');
    expect(saved()).toEqual(['Setting saved · Light theme · Pebble']);
    expect(sw('Reduced motion')).toHaveAttribute('aria-checked', 'false');
    await user.click(sw('Reduced motion'));
    expect(sw('Reduced motion')).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('desktop.reducedMotion')).toBe('true');
    expect(saved()).toEqual(['Setting saved · Light theme · Pebble', 'Setting saved · Reduced motion']);
  });
});
