import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { SettingsView } from '../src/surface/SettingsView';
import { LangProvider } from '../src/i18n/lang';
import { DEFAULT_SOUNDS, type SoundPatch } from '../src/sounds/preferences';

const base = { visible: true, theme: 'dark' as const, dnd: false, reduced: false, osReduced: false, onToggleDnd: () => {}, onReduced: () => {}, onBack: () => {}, onClose: () => {} };
const view = (extra = {}) => {
  const onFinished = vi.fn(); const onSounds = vi.fn<(p: SoundPatch) => void>(); const onTestSound = vi.fn();
  render(<LangProvider lang="en"><SettingsView {...base} finished="both" sounds={DEFAULT_SOUNDS} onFinished={onFinished} onSounds={onSounds} onTestSound={onTestSound} {...extra} /></LangProvider>);
  return { onFinished, onSounds, onTestSound };
};

const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('<SettingsView> tabs', () => {
  beforeEach(() => localStorage.clear());
  it('opens on Display: language, screen sizes, theme and motion; the other groups wait in their tabs', () => {
    view();
    expect(screen.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: 'Display' });
    expect(panel).toHaveAttribute('id', 'ledge-settings-panel-display');
    expect(screen.getByRole('group', { name: 'Default harness' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Island size' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /theme/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Reduced motion' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Do not disturb' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Sounds' })).toBeNull();
    tab('Notifications');
    expect(screen.getByRole('switch', { name: 'Do not disturb' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'When a bot or Ledge finishes' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
    tab('Sounds');
    expect(screen.getByRole('switch', { name: 'Sounds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Do not disturb' })).toBeNull();
  });
  it('offers the island position and the discreet switch, applied live', () => {
    const onIslandPosition = vi.fn(), onDiscreet = vi.fn();
    view({ islandPosition: 'center', onIslandPosition, discreet: true, onDiscreet });
    const group = screen.getByRole('group', { name: 'Island position' });
    expect(within(group).getByRole('radio', { name: 'Centre' })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: 'Left' }));
    expect(onIslandPosition).toHaveBeenCalledWith('left');
    const sw = screen.getByRole('switch', { name: 'Discreet under a window' });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(onDiscreet).toHaveBeenCalledWith(false);
  });
  it('offers launch at startup only when the shell does, and reports a flip', () => {
    view();
    expect(screen.queryByRole('switch', { name: 'Launch at startup' })).toBeNull(); // browser, `tauri dev`
    cleanup();
    const onAutostart = vi.fn();
    view({ autostart: true, onAutostart });
    const sw = screen.getByRole('switch', { name: 'Launch at startup' });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(onAutostart).toHaveBeenCalledWith(false);
  });
  it('the chosen tab is remembered for the next opening; a stale value falls back to Display', () => {
    view();
    tab('Sounds');
    expect(localStorage.getItem('ledge.settings.tab')).toBe('sounds');
    cleanup();
    view();
    expect(screen.getByRole('tab', { name: 'Sounds' })).toHaveAttribute('aria-selected', 'true');
    cleanup();
    localStorage.setItem('ledge.settings.tab', 'nope');
    view();
    expect(screen.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-selected', 'true');
  });
  it('the default harness is Claude Code, reports a choice, and a stored value is shown', () => {
    const onDefaultTool = vi.fn();
    view({ onDefaultTool });
    fireEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    expect(onDefaultTool).toHaveBeenCalledWith('codex');
    cleanup();
    view({ defaultTool: 'cursor' });
    expect(screen.getByRole('radio', { name: 'Cursor Agent' })).toBeChecked();
  });
  it('offers a colour picker on Display and reports a choice', () => {
    const onAccent = vi.fn();
    view({ onAccent });
    const picker = screen.getByLabelText('Ledge color');
    expect(picker).toHaveAttribute('type', 'color');
    fireEvent.change(picker, { target: { value: '#3366ff' } });
    expect(onAccent).toHaveBeenCalledWith('#3366ff');
  });
  it('shows the stored colour and Coral restores the factory look', () => {
    const onAccent = vi.fn();
    view({ accent: '#3366ff', onAccent });
    expect(screen.getByLabelText('Ledge color')).toHaveValue('#3366ff');
    fireEvent.click(screen.getByRole('button', { name: 'Coral' }));
    expect(onAccent).toHaveBeenCalledWith(null);
  });
  it('the hex field reports a valid colour and ignores garbage', () => {
    const onAccent = vi.fn();
    view({ onAccent });
    const hex = screen.getByLabelText('Hex');
    fireEvent.change(hex, { target: { value: '#AABBCC' } });
    fireEvent.blur(hex);
    expect(onAccent).toHaveBeenCalledWith('#aabbcc');
    onAccent.mockClear();
    fireEvent.change(hex, { target: { value: 'nope' } });
    fireEvent.blur(hex);
    expect(onAccent).not.toHaveBeenCalled();
  });
});

describe('<SettingsView> notifications and sounds', () => {
  beforeEach(() => localStorage.clear());
  it('offers the four finished modes and reports a choice', () => {
    const { onFinished } = view();
    tab('Notifications');
    expect(screen.getByRole('radio', { name: 'Bubble and sound' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Island only' }));
    expect(onFinished).toHaveBeenCalledWith('none');
  });
  it('the Sounds switch, the volume, the categories and the terminal rule each send one patch', () => {
    const { onSounds, onTestSound } = view();
    tab('Sounds');
    fireEvent.click(screen.getByRole('switch', { name: 'Sounds' }));
    expect(onSounds).toHaveBeenLastCalledWith({ enabled: false });
    fireEvent.click(screen.getByRole('radio', { name: 'Loud' }));
    expect(onSounds).toHaveBeenLastCalledWith({ volume: 'loud' });
    fireEvent.click(screen.getByRole('checkbox', { name: /A bot joins or leaves/ }));
    expect(onSounds).toHaveBeenLastCalledWith({ categories: { team: true } });
    fireEvent.click(screen.getByRole('switch', { name: 'Only when the terminal is behind' }));
    expect(onSounds).toHaveBeenLastCalledWith({ onlyWhenTerminalBehind: false });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(onTestSound).toHaveBeenCalled();
  });
  it('with sounds off the sound sections are dimmed but still reachable', () => {
    view({ sounds: { ...DEFAULT_SOUNDS, enabled: false } });
    tab('Sounds');
    expect(screen.getByTestId('sound-sections')).toHaveStyle({ opacity: '0.5' });
    expect(screen.getByRole('radio', { name: 'Loud' })).not.toBeDisabled();
  });
});

describe('<SettingsView> About tab', () => {
  beforeEach(() => localStorage.clear());
  const about = (extra = {}) => ({ app: '0.2.2', daemon: { version: '0.3.0', install: 'npm' as const, systemd: true }, latest: '0.3.0', auto: true, checkedAt: Date.now() - 12 * 60_000, onAuto: () => {}, onCheck: () => {}, ...extra });
  it('has no About tab without about props', () => {
    view();
    expect(screen.queryByRole('tab', { name: 'About' })).toBeNull();
  });
  it('shows both versions, flags a mismatch and checks on demand', () => {
    localStorage.setItem('ledge.settings.tab', 'about');
    const onCheck = vi.fn(), onAuto = vi.fn();
    view({ about: about({ onCheck, onAuto }) });
    expect(screen.getByText('0.2.2')).toBeTruthy();
    expect(screen.getByText('0.3.0 · npm')).toBeTruthy();
    expect(screen.getByText('The two halves are not on the same version.')).toBeTruthy();
    expect(screen.getByText('Checked 12m ago')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onCheck).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('switch', { name: 'Check for updates' }));
    expect(onAuto).toHaveBeenCalledWith(false);
  });
  it('shows the calm hint when both halves match, and a never-checked state', () => {
    localStorage.setItem('ledge.settings.tab', 'about');
    view({ about: about({ app: '0.3.0', checkedAt: null }) });
    expect(screen.getByText('Both halves of Ledge must run the same version.')).toBeTruthy();
    expect(screen.getByText('Never checked')).toBeTruthy();
  });
});
