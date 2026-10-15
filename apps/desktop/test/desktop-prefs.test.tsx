import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { getDnd, loadNotifyMode, loadSounds, resetDndForTests, resetSoundPrefsForTests, setDnd, setNotifyMode, useDnd } from '../src/notify/prefs';
import { resetAppearanceForTests, setAccent, setTheme, useAppearance, useTheme } from '../src/shell/theme';
import { loadTool, saveTool } from '../src/launch/form';
import { applyUiScale, loadUiScale, saveUiScale, type ZoomDeps } from '../src/settings/scale';

beforeEach(() => {
  localStorage.clear();
  resetSoundPrefsForTests(); resetDndForTests(); resetAppearanceForTests();
  document.documentElement.removeAttribute('style');
});

describe('sounds and the finish alert (spec §10)', () => {
  it('starts with sounds off and the finish alert on both, without touching the island keys', () => {
    expect(loadSounds().enabled).toBe(false);
    expect(loadNotifyMode()).toBe('both');
    setNotifyMode('none');
    expect(localStorage.getItem('desktop.notify')).toBe('none');
    expect(localStorage.getItem('ledge.finished')).toBeNull();
  });
});

describe('Do not disturb (desktop.dnd)', () => {
  function Probe() { const [dnd] = useDnd(); return <p>{dnd ? 'dnd on' : 'dnd off'}</p>; }
  it('is shared and stored as the island stores it', () => {
    render(<Probe />);
    expect(screen.getByText('dnd off')).toBeInTheDocument();
    act(() => setDnd(true));
    expect(screen.getByText('dnd on')).toBeInTheDocument();
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    expect(getDnd()).toBe(true);
    localStorage.setItem('desktop.dnd', '0'); resetDndForTests();
    expect(getDnd()).toBe(false);
  });
});

describe('theme and accent, live', () => {
  function Mascot() { return <p>{useTheme()}</p>; }
  function Root() { useAppearance(); return null; }
  it('every reader follows the switch; the root carries the theme and the accent', () => {
    render(<><Root /><Mascot /></>);
    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => setTheme('light'));
    expect(screen.getByText('light')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('desktop.theme')).toBe('light');
    act(() => setAccent('#3366FF'));
    expect(localStorage.getItem('desktop.accent')).toBe('#3366ff');
    expect(document.documentElement.style.getPropertyValue('--primary')).not.toBe('');
    act(() => setAccent(null));
    expect(localStorage.getItem('desktop.accent')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });
});

describe('default harness', () => {
  it('is what the next launch form starts with', () => {
    saveTool('codex');
    expect(localStorage.getItem('desktop.tool')).toBe('"codex"');
    expect(loadTool()).toBe('codex');
  });
});

describe('interface scale (WebView zoom)', () => {
  const deps = (h: number | null): ZoomDeps & { setZoom: ReturnType<typeof vi.fn> } => ({ setZoom: vi.fn(async () => {}), screenHeight: vi.fn(async () => h) });
  it('Auto follows the screen height, a fixed scale does not ask for it', async () => {
    const d = deps(4320);
    expect(await applyUiScale('auto', d)).toBe(2);
    expect(d.setZoom).toHaveBeenCalledWith(2);
    const f = deps(4320);
    expect(await applyUiScale(1.5, f)).toBe(1.5);
    expect(f.screenHeight).not.toHaveBeenCalled();
    expect(await applyUiScale('auto', deps(null))).toBe(1);
  });
  it('stores desktop.panelScale; outside the app or on failure nothing breaks', async () => {
    await saveUiScale(1.25, deps(1080));
    expect(localStorage.getItem('desktop.panelScale')).toBe('1.25');
    expect(loadUiScale()).toBe(1.25);
    expect(await applyUiScale(2, null)).toBeNull();
    expect(await applyUiScale(2, { setZoom: async () => { throw new Error('denied'); }, screenHeight: async () => 1080 })).toBeNull();
  });
});
