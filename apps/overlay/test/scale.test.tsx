import { DEFAULT_SOUNDS } from '../src/sounds/preferences';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { autoScale, loadScale, migrateLegacyScale, resolveScale, saveScale } from '../src/scale';
import { LangProvider } from '../src/i18n/lang';
import { SettingsView } from '../src/surface/SettingsView';
const soundProps = { finished: 'both' as const, sounds: DEFAULT_SOUNDS, onFinished: () => {}, onSounds: () => {}, onTestSound: () => {} };
import { App } from '../src/App';

describe('UI scales', () => {
  it('handle Auto follows the work area from 1080p, window Auto only from 2160p; both to the nearest quarter, 100-200 %', () => {
    expect(autoScale(1080, 'handle')).toBe(1);
    expect(autoScale(1440, 'handle')).toBe(1.25);
    expect(autoScale(1600, 'handle')).toBe(1.5);
    expect(autoScale(2160, 'handle')).toBe(2);
    expect(autoScale(900, 'handle')).toBe(1);
    expect(autoScale(4320, 'handle')).toBe(2);
    expect(autoScale(0, 'handle')).toBe(1);
    expect(autoScale(1080, 'panel')).toBe(1);
    expect(autoScale(2160, 'panel')).toBe(1);
    expect(autoScale(2700, 'panel')).toBe(1.25);
    expect(autoScale(4320, 'panel')).toBe(2);
    expect(resolveScale('auto', 2160, 'handle')).toBe(2);
    expect(resolveScale('auto', 2160, 'panel')).toBe(1);
    expect(resolveScale(1.5, 2160, 'panel')).toBe(1.5);
  });

  it('each is persisted on its own, defaults to auto, and survives an unavailable or corrupt storage', () => {
    localStorage.clear();
    expect(loadScale('handle')).toBe('auto'); expect(loadScale('panel')).toBe('auto');
    saveScale('handle', 1.25); expect(localStorage.getItem('ledge.handleScale')).toBe('1.25');
    expect(loadScale('handle')).toBe(1.25); expect(loadScale('panel')).toBe('auto');
    localStorage.setItem('ledge.panelScale', '3'); expect(loadScale('panel')).toBe('auto');
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadScale('handle')).toBe('auto');
    expect(() => saveScale('panel', 2)).not.toThrow();
    expect(() => migrateLegacyScale()).not.toThrow();
    get.mockRestore(); set.mockRestore();
  });

  it('a stored single Size migrates to both, once; an existing value is kept', () => {
    localStorage.clear();
    localStorage.setItem('ledge.uiScale', '1.5');
    localStorage.setItem('ledge.panelScale', '1');
    migrateLegacyScale();
    expect(loadScale('handle')).toBe(1.5);
    expect(loadScale('panel')).toBe(1);
    expect(localStorage.getItem('ledge.uiScale')).toBeNull();
  });

  it('Settings shows the two sizes as radio groups; Auto shows the value it resolves to; each changes on its own', () => {
    const onScale = vi.fn();
    render(<SettingsView visible theme="dark" dnd={false} reduced={false} osReduced={false} onToggleDnd={() => {}} onReduced={() => {}} onBack={() => {}} onClose={() => {}} {...soundProps} scales={{ handle: 'auto', panel: 'auto' }} autoScales={{ handle: 2, panel: 1 }} onScale={onScale} />);
    const handle = screen.getByRole('group', { name: 'Handle size' }); const win = screen.getByRole('group', { name: 'Window size' });
    expect(within(handle).getByRole('radio', { name: 'Auto (200%)' })).toBeChecked();
    expect(within(win).getByRole('radio', { name: 'Auto (100%)' })).toBeChecked();
    for (const n of ['100%', '125%', '150%', '200%']) expect(within(handle).getByRole('radio', { name: n })).not.toBeChecked();
    fireEvent.click(within(handle).getByRole('radio', { name: '150%' }));
    expect(onScale).toHaveBeenLastCalledWith('handle', 1.5);
    fireEvent.click(within(win).getByRole('radio', { name: '125%' }));
    expect(onScale).toHaveBeenLastCalledWith('panel', 1.25);
  });

  it('the French labels', () => {
    render(<LangProvider lang="fr"><SettingsView visible theme="dark" dnd={false} reduced={false} osReduced={false} onToggleDnd={() => {}} onReduced={() => {}} onBack={() => {}} onClose={() => {}} {...soundProps} scales={{ handle: 'auto', panel: 2 }} autoScales={{ handle: 2, panel: 1 }} onScale={() => {}} /></LangProvider>);
    expect(within(screen.getByRole('group', { name: 'Taille de la poignée' })).getByRole('radio', { name: 'Auto (200%)' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: 'Taille des fenêtres' })).getByRole('radio', { name: '200%' })).toBeChecked();
  });
});

class SilentSocket {
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: (() => void) | null = null;
  readyState = 0; send() {} close() {} addEventListener() {} removeEventListener() {}
}

describe('App UI scales (browser)', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', SilentSocket); localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the page is never zoomed; each layer gets its own zoom and the surface lays out in the real height', () => {
    const h = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 2160 });
    try {
      const { unmount } = render(<App />);
      expect(document.querySelector('[data-ui-zoom]')).toBeNull();
      expect(document.documentElement.dataset.handleScale).toBe('2');
      expect(document.documentElement.dataset.panelScale).toBe('1');
      expect((document.querySelector('[data-zoom="handle"]') as HTMLElement).style.zoom).toBe('2');
      expect((document.querySelector('[data-panel]') as HTMLElement).style.zoom).toBe('1');
      // The 36 px mascot notch at 2x remains centered in the real 2160 px.
      expect(document.querySelector('[data-surface]')).toHaveStyle({ top: `${2160 / 2 - 36}px`, height: '72px' });
      expect(localStorage.getItem('ledge.handleScale')).toBe('auto');
      expect(localStorage.getItem('ledge.panelScale')).toBe('auto');
      unmount();
      localStorage.setItem('ledge.handleScale', '1.5'); localStorage.setItem('ledge.panelScale', '1.25');
      render(<App />);
      expect((document.querySelector('[data-zoom="handle"]') as HTMLElement).style.zoom).toBe('1.5');
      expect((document.querySelector('[data-panel]') as HTMLElement).style.zoom).toBe('1.25');
      act(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 }); window.dispatchEvent(new Event('resize')); });
      expect(document.querySelector('[data-surface]')).toHaveStyle({ top: `${1200 / 2 - 27}px` });
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
    }
  });
});
