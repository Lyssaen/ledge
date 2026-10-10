import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsView } from '../src/surface/SettingsView';
import { LangProvider } from '../src/i18n/lang';
import { DEFAULT_SOUNDS, type SoundPatch } from '../src/sounds/preferences';

const base = { visible: true, theme: 'dark' as const, dnd: false, reduced: false, osReduced: false, onToggleDnd: () => {}, onReduced: () => {}, onBack: () => {}, onClose: () => {} };
const view = (extra = {}) => {
  const onFinished = vi.fn(); const onSounds = vi.fn<(p: SoundPatch) => void>(); const onTestSound = vi.fn();
  render(<LangProvider lang="en"><SettingsView {...base} finished="both" sounds={DEFAULT_SOUNDS} onFinished={onFinished} onSounds={onSounds} onTestSound={onTestSound} {...extra} /></LangProvider>);
  return { onFinished, onSounds, onTestSound };
};

describe('<SettingsView> notifications and sounds', () => {
  beforeEach(() => localStorage.clear());
  it('offers the four finished modes and reports a choice', () => {
    const { onFinished } = view();
    expect(screen.getByRole('radio', { name: 'Bubble and sound' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Handle only' }));
    expect(onFinished).toHaveBeenCalledWith('none');
  });
  it('the Sounds switch, the volume, the categories and the terminal rule each send one patch', () => {
    const { onSounds, onTestSound } = view();
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
    expect(screen.getByTestId('sound-sections')).toHaveStyle({ opacity: '0.5' });
    expect(screen.getByRole('radio', { name: 'Loud' })).not.toBeDisabled();
  });
});
