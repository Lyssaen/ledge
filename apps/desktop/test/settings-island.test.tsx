import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_ISLAND_PREFS, type ClientMessage, type IslandPrefs } from '@ledge/protocol';
import { boot, closeDaemons, recordToasts, savedNotices, TWO_PROJECTS, type MockDaemon } from './helpers';
import { comboOf, shownKeys } from '../src/settings/Island';
import { sameIsland, useIslandSave } from '../src/settings/useIslandSave';
import { UNCONFIRMED_MS } from '../src/projects/useProjectSave';

let log: string[] = [];
beforeEach(() => { log = recordToasts(); localStorage.clear(); });
afterEach(async () => { vi.useRealTimers(); cleanup(); await closeDaemons(); });

type IslandSet = Extract<ClientMessage, { type: 'island.set' }>;
const setsOf = (d: MockDaemon) => d.received.filter((m): m is IslandSet => m.type === 'island.set');
const saved = () => savedNotices(log);
const nav = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));
const sw = (name: string) => screen.getByRole('switch', { name });
const group = (name: string) => within(screen.getByRole('radiogroup', { name }));
const recorder = () => screen.getByRole('button', { name: /^Shortcut to open the island: / });
const caption = () => document.querySelector('.island-preview figcaption > span')!.textContent;

/** Plays the daemon: the last `island.set` it received comes back as its `island` broadcast. */
async function confirm(d: MockDaemon, count: number): Promise<IslandPrefs> {
  await waitFor(() => expect(setsOf(d)).toHaveLength(count));
  const prefs = setsOf(d).at(-1)!.prefs;
  d.push({ type: 'island', prefs });
  return prefs;
}

/** The app on a daemon that holds `prefs` for the island (null: none set; 'unknown': a daemon that never speaks of them), then Settings › Island. */
async function open(prefs: IslandPrefs | null | 'unknown' = null) {
  const env = await boot({ projects: TWO_PROJECTS });
  if (prefs !== 'unknown') env.d.push({ type: 'island', prefs });
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(nav().getByRole('button', { name: /^Island/ }));
  await screen.findByRole('heading', { level: 1, name: 'Island' });
  return env;
}

describe('Settings › Island', () => {
  it('sits between Appearance and Notifications; the banner, then the mockup’s rows in order, the defaults while none was set', async () => {
    await open();
    expect(nav().getAllByRole('button').map(b => b.textContent).slice(1, 5)).toEqual(['General', 'Appearance', 'Island', 'Notifications']);
    expect(screen.getByRole('region', { name: 'Island' })).toHaveTextContent('The island at the top of the screen: where it sits and what it signals.');
    expect(screen.getByRole('note')).toHaveTextContent('The island has no settings of its own any more.');
    expect([...document.querySelectorAll('.set-card .set-label')].map(l => l.textContent)).toEqual([
      'Show the island', 'Screen', 'Island position', 'Discreet under a window', 'Island size', 'Island windows size',
      'Allow and answer from the island', 'Bubble when an agent is done', 'Agents’ words', 'Subagents in the island', 'Shortcut to open the island'
    ]);
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['What the island does']);
    for (const name of ['Show the island', 'Discreet under a window', 'Allow and answer from the island', 'Bubble when an agent is done', 'Agents’ words', 'Subagents in the island']) expect(sw(name)).toHaveAttribute('aria-checked', 'true');
    expect(group('Screen').getByRole('radio', { name: 'Main' })).toBeChecked();
    expect(group('Island position').getByRole('radio', { name: 'Centre' })).toBeChecked();
    expect(group('Island position').getAllByRole('radio').map(r => r.parentElement!.textContent)).toEqual(['Left', 'Centre', 'Right']);
    // Auto at the main screen's size (the browser's stand-in, 2560 × 1440): the island 125 %, its windows 100 %.
    expect(group('Island size').getAllByRole('radio').map(r => r.parentElement!.textContent)).toEqual(['Auto (125%)', '100%', '125%', '150%', '200%']);
    expect(group('Island windows size').getByRole('radio', { name: 'Auto (100%)' })).toBeChecked();
    expect(screen.getByText('The island sits at the top of this screen (2560 × 1440).')).toBeVisible();
    expect(recorder()).toHaveAccessibleName('Shortcut to open the island: Ctrl Alt L. Edit');
    // The preview: both screens, the island on the main one, centred, with its bubble.
    expect([...document.querySelectorAll('.preview-caption')].map(c => c.textContent)).toEqual(['Main 2560 × 1440', 'Screen 2 1920 × 1080']);
    expect(document.querySelector('.preview-screen.here .preview-notch.pos-center')).not.toBeNull();
    expect(document.querySelector('.preview-bubble')).toHaveTextContent('Otto needs your approval');
    expect(caption()).toBe('The island at rest, three agents living in it.');
    expect(document.querySelector('.set-well')).toBeNull();
    expect(saved()).toEqual([]);
  });

  it('« Show the island » off: island.set carries visible false, « Setting saved » only once the daemon broadcasts it, and every other control is disabled', async () => {
    const { d, user } = await open();
    await user.click(sw('Show the island'));
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    expect(setsOf(d)[0]!.prefs).toEqual({ ...DEFAULT_ISLAND_PREFS, visible: false });
    expect(saved()).toEqual([]);
    await confirm(d, 1);
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Island hidden']));
    expect(sw('Show the island')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Show the island')).toBeEnabled();
    for (const name of ['Discreet under a window', 'Allow and answer from the island', 'Bubble when an agent is done', 'Agents’ words', 'Subagents in the island']) expect(sw(name)).toBeDisabled();
    for (const name of ['Screen', 'Island position', 'Island size', 'Island windows size']) {
      expect(screen.getByRole('radiogroup', { name })).toHaveAttribute('aria-disabled', 'true');
      for (const r of group(name).getAllByRole('radio')) expect(r).toBeDisabled();
    }
    expect(recorder()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Simulate a maximised window' })).toBeDisabled();
    expect(document.querySelector('.preview-screen.here')).toBeNull();
    expect(caption()).toBe('The island is hidden. Ledge Desktop still lets you know.');
    // Back on: everything comes back.
    await user.click(sw('Show the island'));
    await confirm(d, 2);
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Island hidden', 'Setting saved · Island shown']));
    expect(sw('Agents’ words')).toBeEnabled();
  });

  it('screen, position, discreet, sizes and what the island does: each change sends the whole settings and is said once confirmed; the preview follows', async () => {
    const { d, user } = await open();
    await user.click(group('Island position').getByRole('radio', { name: 'Right' }));
    expect((await confirm(d, 1)).position).toBe('right');
    await waitFor(() => expect(document.querySelector('.preview-notch.pos-right')).not.toBeNull());
    expect(document.querySelector('.preview-bubble.pos-right')).not.toBeNull();
    await user.click(group('Screen').getByRole('radio', { name: 'Screen 2' }));
    expect((await confirm(d, 2))).toMatchObject({ screen: 'second', position: 'right' });
    await waitFor(() => expect(screen.getByText('The island sits at the top of this screen (1920 × 1080).')).toBeVisible());
    expect(document.querySelector('.preview-screen.here .preview-caption')).toHaveTextContent('Screen 2 1920 × 1080');
    // Auto now reads the 1080 px screen.
    expect(group('Island size').getByRole('radio', { name: 'Auto (100%)' })).toBeChecked();
    await user.click(group('Island size').getByRole('radio', { name: '150%' }));
    expect((await confirm(d, 3)).islandScale).toBe(1.5);
    await user.click(group('Island windows size').getByRole('radio', { name: '125%' }));
    expect((await confirm(d, 4)).panelScale).toBe(1.25);
    await user.click(sw('Agents’ words'));
    expect((await confirm(d, 5)).shows).toEqual({ quick: true, finished: true, say: false, helpers: true });
    await waitFor(() => expect(document.querySelector('.preview-bubble')).toBeNull());
    await user.click(sw('Subagents in the island'));
    await confirm(d, 6);
    await user.click(sw('Allow and answer from the island'));
    await confirm(d, 7);
    await user.click(sw('Bubble when an agent is done'));
    expect((await confirm(d, 8)).shows).toEqual({ quick: false, finished: false, say: false, helpers: false });
    // Discreet: covered by a maximised window, the island is a line; without it, it stays whole.
    await user.click(screen.getByRole('button', { name: 'Simulate a maximised window' }));
    expect(document.querySelector('.preview-notch.strip')).not.toBeNull();
    expect(caption()).toBe('Discreet mode: a simple line under the maximised window.');
    await user.click(sw('Discreet under a window'));
    expect((await confirm(d, 9)).discreet).toBe(false);
    await waitFor(() => expect(document.querySelector('.preview-notch.strip')).toBeNull());
    expect(caption()).toBe('Discreet mode off: the island stays whole above the window.');
    expect(screen.getByRole('button', { name: 'Remove the window' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(saved()).toHaveLength(9));
    expect(saved()).toEqual([
      'Setting saved · Position: Right', 'Setting saved · Screen 2', 'Setting saved · Island size 150%', 'Setting saved · Windows size 125%',
      'Setting saved · Words hidden', 'Setting saved · Subagents hidden', 'Setting saved · Answers in Ledge Desktop only', 'Setting saved · No task finished bubble',
      'Setting saved · Island always whole'
    ]);
  });

  it('the shortcut recorder: Edit listens, a key without Ctrl, Alt or ⊞ says why, Escape cancels without leaving Settings, Ctrl Alt K is saved', async () => {
    const { d, user } = await open();
    await user.click(recorder());
    expect(recorder()).toHaveTextContent('Press…Cancel');
    expect(screen.getByText('Press the combination you want. Esc to cancel.')).toBeVisible();
    await user.keyboard('k');
    expect(log).toContain('Add Ctrl, Alt or ⊞: the shortcut has to work anywhere in Windows.');
    await user.keyboard('{Escape}');
    expect(recorder()).toHaveTextContent('Ctrl Alt LEdit');
    expect(screen.getByRole('heading', { level: 1, name: 'Island' })).toBeVisible();
    expect(setsOf(d)).toHaveLength(0);
    await user.click(recorder());
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
    expect((await confirm(d, 1)).shortcut).toBe('Ctrl Alt K');
    await waitFor(() => expect(saved()).toEqual(['Setting saved · Open the island: Ctrl Alt K']));
    expect(recorder()).toHaveAccessibleName('Shortcut to open the island: Ctrl Alt K. Edit');
    // Ctrl K was taken by the recorder, not by the search.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a daemon that never speaks of the island: said at the top, and a change is refused under its row, nothing sent', async () => {
    const { d, user } = await open('unknown');
    expect(document.querySelector('.set-well[role=status]')).toHaveTextContent('The local daemon is too old for the island’s settings: update it.');
    await user.click(sw('Agents’ words'));
    expect(screen.getByRole('alert')).toHaveTextContent('The local daemon is too old for the island’s settings: update it.');
    expect(sw('Agents’ words')).toHaveAttribute('aria-checked', 'true');
    expect(setsOf(d)).toHaveLength(0);
    expect(saved()).toEqual([]);
  });

  it('the daemon’s settings are shown as it holds them, and follow its broadcasts (set from elsewhere)', async () => {
    const { d } = await open({ ...DEFAULT_ISLAND_PREFS, position: 'left', shortcut: 'Ctrl Shift Win J' });
    expect(group('Island position').getByRole('radio', { name: 'Left' })).toBeChecked();
    expect(recorder()).toHaveAccessibleName('Shortcut to open the island: Ctrl Shift ⊞ J. Edit');
    act(() => d.push({ type: 'island', prefs: { ...DEFAULT_ISLAND_PREFS, visible: false } }));
    await waitFor(() => expect(sw('Show the island')).toHaveAttribute('aria-checked', 'false'));
    expect(saved()).toEqual([]);
  });
});

describe('the overview’s footer', () => {
  it('shows the island’s state once the daemon speaks of it; « Island hidden » opens Settings › Island', async () => {
    const { d, user } = await boot({ projects: TWO_PROJECTS });
    const footer = within(screen.getByRole('contentinfo'));
    expect(footer.queryByRole('button', { name: /^Island/ })).toBeNull();
    act(() => d.push({ type: 'island', prefs: null }));
    expect(await footer.findByRole('button', { name: 'Island active' })).toBeVisible();
    act(() => d.push({ type: 'island', prefs: { ...DEFAULT_ISLAND_PREFS, visible: false } }));
    const hidden = await footer.findByRole('button', { name: 'Island hidden' });
    expect(hidden).toHaveClass('off');
    await user.click(hidden);
    expect(await screen.findByRole('heading', { level: 1, name: 'Island' })).toBeVisible();
    expect(nav().getByRole('button', { name: /^Island/ })).toHaveAttribute('aria-current', 'page');
  });
});

describe('useIslandSave', () => {
  const fleet = (error?: string) => ({ sent: [] as IslandPrefs[], setIsland(next: IslandPrefs) { if (error) throw Object.assign(new Error(error), { name: error }); this.sent.push(next); } });

  it('shows the change while it waits, says it once the broadcast holds it; two quick changes build on each other', () => {
    const f = fleet();
    const said: string[] = [];
    const { result, rerender } = renderHook(({ island }) => useIslandSave(f, island, w => said.push(w)), { initialProps: { island: null as IslandPrefs | null } });
    expect(result.current.shown).toEqual(DEFAULT_ISLAND_PREFS);
    act(() => result.current.send('position', { ...result.current.shown, position: 'left' }, 'left'));
    act(() => result.current.send('discreet', { ...result.current.shown, discreet: false }, 'whole'));
    expect(f.sent.at(-1)).toMatchObject({ position: 'left', discreet: false });
    expect(result.current.shown).toMatchObject({ position: 'left', discreet: false });
    expect(said).toEqual([]);
    // Both broadcasts reach one render: the second holds the first too.
    rerender({ island: { ...DEFAULT_ISLAND_PREFS, position: 'left', discreet: false } });
    expect(said).toEqual(['left', 'whole']);
    expect(result.current.saving).toBe(false);
  });

  it('a refusal names its reason under its key; a silence of UNCONFIRMED_MS is a timeout, and the daemon’s settings come back', () => {
    vi.useFakeTimers();
    for (const [name, reason] of [['DaemonOffline', 'offline'], ['DaemonOutdated', 'outdated'], ['ZodError', 'invalid']] as const) {
      const { result } = renderHook(() => useIslandSave(fleet(name), null, () => {}));
      act(() => result.current.send('say', { ...DEFAULT_ISLAND_PREFS, visible: false }, 'x'));
      expect(result.current.refused).toEqual({ key: 'say', reason });
      expect(result.current.shown).toEqual(DEFAULT_ISLAND_PREFS);
    }
    const said: string[] = [];
    const { result } = renderHook(() => useIslandSave(fleet(), null, w => said.push(w)));
    act(() => result.current.send('visible', { ...DEFAULT_ISLAND_PREFS, visible: false }, 'hidden'));
    expect(result.current.shown.visible).toBe(false);
    act(() => { vi.advanceTimersByTime(UNCONFIRMED_MS); });
    expect(result.current.refused).toEqual({ key: 'visible', reason: 'timeout' });
    expect(result.current.shown.visible).toBe(true);
    expect(said).toEqual([]);
  });

  it('compares the settings whatever their keys’ order', () => {
    const { shows, ...rest } = DEFAULT_ISLAND_PREFS;
    expect(sameIsland(DEFAULT_ISLAND_PREFS, { shows: { helpers: true, say: true, finished: true, quick: true }, ...rest })).toBe(true);
    expect(sameIsland(DEFAULT_ISLAND_PREFS, { ...DEFAULT_ISLAND_PREFS, shows: { ...shows, say: false } })).toBe(false);
  });
});

describe('the shortcut’s keys', () => {
  const ev = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it('stores the modifiers in order and the letter by its place on the keyboard; shows them in the language', () => {
    expect(comboOf(ev('€', 'KeyE', { ctrlKey: true, altKey: true }))).toBe('Ctrl Alt E');
    expect(comboOf(ev('!', 'Digit1', { shiftKey: true, metaKey: true, ctrlKey: true }))).toBe('Ctrl Win Shift 1');
    expect(comboOf(ev('F5', 'F5', { altKey: true }))).toBe('Alt F5');
    expect(comboOf(ev(' ', 'Space', { ctrlKey: true }))).toBe('Ctrl Space');
    expect(comboOf(ev('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull();
    expect(shownKeys('Ctrl Win Shift L', { Shift: 'Maj', Win: '⊞' })).toBe('Ctrl ⊞ Maj L');
  });
});
