import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
    expect(screen.getByRole('group', { name: 'Handle size' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /theme/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Reduced motion' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Do not disturb' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Sounds' })).toBeNull();
    tab('Notifications');
    expect(screen.getByRole('switch', { name: 'Do not disturb' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'When a bot finishes' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
    tab('Sounds');
    expect(screen.getByRole('switch', { name: 'Sounds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Do not disturb' })).toBeNull();
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
});

describe('<SettingsView> notifications and sounds', () => {
  beforeEach(() => localStorage.clear());
  it('offers the four finished modes and reports a choice', () => {
    const { onFinished } = view();
    tab('Notifications');
    expect(screen.getByRole('radio', { name: 'Bubble and sound' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Handle only' }));
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
