import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SettingsScreen, type SettingsTab } from '../src/settings/SettingsScreen';
import { createUpdater } from '../src/update/store';
import { resetDndForTests, resetSoundPrefsForTests } from '../src/notify/prefs';
import { resetAppearanceForTests } from '../src/shell/theme';
import type { DaemonUpdate } from '../src/update/daemon';
import { machine } from './launch-helpers';
import { fakeMachineFleet } from './settings-helpers';

const daemon: DaemonUpdate = { offer: 'none', journal: [], running: false, start: vi.fn() };
beforeEach(() => { localStorage.clear(); resetSoundPrefsForTests(); resetDndForTests(); resetAppearanceForTests(); });

function Harness({ first = 'display', localDown = false, testSound = () => 'played' as const, onBack = () => {}, onLang = () => {} }: { first?: SettingsTab; localDown?: boolean; testSound?: () => 'played' | 'dnd'; onBack?: () => void; onLang?: (l: 'fr' | 'en') => void }) {
  const [tab, setTab] = useState<SettingsTab>(first);
  return <SettingsScreen tab={tab} onTab={setTab} onBack={onBack} lang="en" onLang={onLang} machines={[machine('local')]} fleet={fakeMachineFleet()}
    localDown={localDown} testSound={testSound} updater={createUpdater({ check: async () => null, every: () => () => {} })} daemon={daemon} />;
}
const panel = () => screen.getByRole('region', { name: /^(Display|Machines|Notifications|Sounds|About)$/ });

describe('the settings screen', () => {
  it('has its heading, five sections and a way back', async () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['Display', 'Machines', 'Notifications', 'Sounds', 'About']);
    expect(within(nav).getByRole('button', { name: 'Display' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(nav).getByRole('button', { name: 'Sounds' }));
    expect(panel()).toHaveAccessibleName('Sounds');
    expect(within(nav).getByRole('button', { name: 'Sounds' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Display: language, harness, theme, scale and reduced motion apply and are kept', async () => {
    const onLang = vi.fn();
    render(<Harness onLang={onLang} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'fr');
    expect(onLang).toHaveBeenCalledWith('fr');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default harness' }), 'codex');
    expect(localStorage.getItem('desktop.tool')).toBe('"codex"');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light');
    expect(localStorage.getItem('desktop.theme')).toBe('light');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Interface scale' }), '1.5');
    expect(localStorage.getItem('desktop.panelScale')).toBe('1.5');
    await userEvent.click(screen.getByRole('switch', { name: 'Reduced motion' }));
    expect(localStorage.getItem('desktop.reducedMotion')).toBe('true');
  });

  it('Display: launch at start-up is off outside the installed app', async () => {
    render(<Harness />);
    expect(await screen.findByText('Available in the installed app.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Launch at start-up' })).toBeDisabled();
  });

  it('Display: a wrong colour is refused, a right one applied, Coral resets', async () => {
    render(<Harness />);
    const hex = screen.getByRole('textbox', { name: 'Hex code' });
    await userEvent.clear(hex);
    await userEvent.type(hex, '#zz');
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid colour: use # and six hexadecimal characters.');
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    await userEvent.clear(hex);
    await userEvent.type(hex, '#3366FF');
    expect(localStorage.getItem('desktop.accent')).toBe('#3366ff');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Coral' }));
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    expect(hex).toHaveValue('#e85d4a');
  });

  it('Notifications: do not disturb and the finish alert', async () => {
    render(<Harness first="notifications" />);
    await userEvent.click(screen.getByRole('switch', { name: 'Do not disturb' }));
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    const finished = screen.getByRole('combobox', { name: 'When a bot or Ledge is done' });
    expect(finished).toHaveValue('both');
    await userEvent.selectOptions(finished, 'bubble');
    expect(localStorage.getItem('desktop.notify')).toBe('bubble');
  });

  it('Sounds: off by default on Desktop, the options follow the switch, Test says when do not disturb is on', async () => {
    const testSound = vi.fn<() => 'played' | 'dnd'>(() => 'dnd');
    render(<Harness first="sounds" testSound={testSound} />);
    const on = screen.getByRole('switch', { name: 'Sounds' });
    expect(on).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Volume' })).toBeDisabled();
    await userEvent.click(on);
    expect(screen.getByRole('combobox', { name: 'Volume' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(testSound).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Do not disturb is on.');
    const team = screen.getByRole('checkbox', { name: 'A bot arrives or leaves' });
    expect(team).not.toBeChecked();
    await userEvent.click(team);
    expect(JSON.parse(localStorage.getItem('desktop.sounds')!)).toMatchObject({ enabled: true, categories: { team: true } });
  });

  it('opens while the local daemon is down, with its notice as a status and Machines frozen', async () => {
    render(<Harness first="machines" localDown />);
    expect(screen.getByRole('status')).toHaveTextContent('Local daemon unreachable');
    expect(screen.getByRole('button', { name: '＋ Add a machine' })).toBeDisabled();
  });
});
