import { DEFAULT_SOUNDS } from '../src/sounds/preferences';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { LangProvider } from '../src/i18n/lang';
import { SettingsView } from '../src/surface/SettingsView';
const soundProps = { finished: 'both' as const, sounds: DEFAULT_SOUNDS, onFinished: () => {}, onSounds: () => {}, onTestSound: () => {} };
import { App } from '../src/App';

describe('UI scales', () => {
  it('Settings shows the two sizes as radio groups; Auto shows the value it resolves to; each changes on its own', () => {
    const onScale = vi.fn();
    render(<SettingsView visible theme="dark" dnd={false} reduced={false} osReduced={false} onToggleDnd={() => {}} onReduced={() => {}} onBack={() => {}} onClose={() => {}} {...soundProps} scales={{ handle: 'auto', panel: 'auto' }} autoScales={{ handle: 2, panel: 1 }} onScale={onScale} />);
    const handle = screen.getByRole('group', { name: 'Island size' }); const win = screen.getByRole('group', { name: 'Window size' });
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
    expect(within(screen.getByRole('group', { name: 'Taille de l’île' })).getByRole('radio', { name: 'Auto (200%)' })).toBeChecked();
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
      // The 10 px filet at 2x hangs from the top edge, 20 px high.
      expect(document.querySelector('[data-surface]')).toHaveStyle({ top: '0px', height: '20px' });
      expect(localStorage.getItem('ledge.handleScale')).toBe('auto');
      expect(localStorage.getItem('ledge.panelScale')).toBe('auto');
      unmount();
      localStorage.setItem('ledge.handleScale', '1.5'); localStorage.setItem('ledge.panelScale', '1.25');
      render(<App />);
      expect((document.querySelector('[data-zoom="handle"]') as HTMLElement).style.zoom).toBe('1.5');
      expect((document.querySelector('[data-panel]') as HTMLElement).style.zoom).toBe('1.25');
      act(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 }); window.dispatchEvent(new Event('resize')); });
      expect(document.querySelector('[data-surface]')).toHaveStyle({ top: '0px', height: '15px' });
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
    }
  });
});
