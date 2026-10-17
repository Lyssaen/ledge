import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import { boot, closeDaemons, recordToasts, savedNotices, TWO_PROJECTS } from './helpers';

// The Test button reaches the app's one player: here a spy, so nothing is played for real.
const played = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../src/notify/player', () => ({ appPlayer: () => ({ play: (...a: unknown[]) => { played.calls.push(a); } }) }));

import { getDnd, resetDndForTests, resetSoundPrefsForTests, setDnd } from '../src/notify/prefs';

let log: string[] = [];
beforeEach(() => { log = recordToasts(); localStorage.clear(); resetDndForTests(); resetSoundPrefsForTests(); played.calls = []; });
afterEach(async () => { cleanup(); await closeDaemons(); });

const nav = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));
const saved = () => savedNotices(log);
const sw = (name: string) => screen.getByRole('switch', { name });
const stored = () => JSON.parse(localStorage.getItem('desktop.sounds') ?? 'null');

async function open(section: 'Notifications' | 'Sounds') {
  const env = await boot({ projects: TWO_PROJECTS });
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(nav().getByRole('button', { name: new RegExp(`^${section}`) }));
  await screen.findByRole('heading', { level: 1, name: section });
  return env;
}

describe('Settings › Notifications', () => {
  it('Do not disturb follows the switch, and a change made elsewhere (the tray) shows in the page', async () => {
    const { user } = await open('Notifications');
    expect(sw('Do not disturb')).toHaveAttribute('aria-checked', 'false');
    expect(saved()).toEqual([]);
    await user.click(sw('Do not disturb'));
    expect(getDnd()).toBe(true);
    expect(sw('Do not disturb')).toHaveAttribute('aria-checked', 'true');
    expect(saved()).toEqual(['Setting saved · Do not disturb on']);
    act(() => setDnd(false));
    expect(sw('Do not disturb')).toHaveAttribute('aria-checked', 'false');
    act(() => setDnd(true));
    expect(sw('Do not disturb')).toHaveAttribute('aria-checked', 'true');
    expect(saved()).toHaveLength(1);
  });

  it('what a finished agent does: four choices, kept in desktop.notify, one notice', async () => {
    const { user } = await open('Notifications');
    const group = screen.getByRole('radiogroup', { name: 'When an agent is done' });
    expect(within(group).getAllByRole('radio').map(r => (r as HTMLInputElement).value)).toEqual(['both', 'bubble', 'sound', 'none']);
    expect(within(group).getByRole('radio', { name: 'Alert and sound' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Session state only' }));
    expect(localStorage.getItem('desktop.notify')).toBe('none');
    expect(saved()).toEqual(['Setting saved · When an agent is done: Session state only']);
    await user.click(within(group).getByRole('radio', { name: 'Session state only' }));
    expect(saved()).toHaveLength(1);
  });
});

describe('Settings › Sounds', () => {
  it('sounds are off by default, and the options are frozen while they are', async () => {
    await open('Sounds');
    expect(sw('Sounds')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Something fails/ })).toBeDisabled();
    expect(saved()).toEqual([]);
    expect(localStorage.getItem('desktop.sounds')).toBeNull();
  });

  it('unchecking « Something fails » keeps categories.errors = false, with one « Setting saved »', async () => {
    const { user } = await open('Sounds');
    await user.click(sw('Sounds'));
    expect(stored().enabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /Something fails/ }));
    expect(stored().categories.errors).toBe(false);
    expect(stored().categories.requests).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Something fails/ })).not.toBeChecked();
    expect(saved()).toEqual(['Setting saved · Sounds on', 'Setting saved · Something fails: off']);
  });

  it('volume and « only when the terminal is behind » are kept', async () => {
    const { user } = await open('Sounds');
    await user.click(sw('Sounds'));
    await user.click(within(screen.getByRole('radiogroup', { name: 'Volume' })).getByRole('radio', { name: 'Loud' }));
    expect(stored().volume).toBe('loud');
    await user.click(sw('Only when the terminal is behind'));
    expect(stored().onlyWhenTerminalBehind).toBe(false);
    await user.click(within(screen.getByRole('radiogroup', { name: 'Volume' })).getByRole('radio', { name: 'Loud' }));
    expect(saved()).toEqual(['Setting saved · Sounds on', 'Setting saved · Volume loud', 'Setting saved · Sounds even when the terminal is in front']);
  });

  it('Test plays the question cue at the chosen volume; under Do not disturb it says so and plays nothing', async () => {
    const { user } = await open('Sounds');
    await user.click(sw('Sounds'));
    await user.click(within(screen.getByRole('radiogroup', { name: 'Volume' })).getByRole('radio', { name: 'Loud' }));
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(played.calls).toEqual([['question', 1.8]]);
    expect(screen.queryByText('Do not disturb is on: no sound.')).toBeNull();
    act(() => setDnd(true));
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(played.calls).toHaveLength(1);
    expect(screen.getByText('Do not disturb is on: no sound.')).toBeVisible();
    act(() => setDnd(false));
    expect(screen.queryByText('Do not disturb is on: no sound.')).toBeNull();
    act(() => setDnd(true));
    expect(screen.queryByText('Do not disturb is on: no sound.')).toBeNull();
  });
});
