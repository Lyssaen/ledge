import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { autoScale, loadUiScale, resolveScale, saveUiScale } from '../src/scale';
import { SettingsView } from '../src/surface/SettingsView';
import { App } from '../src/App';

describe('UI scale', () => {
  it('auto follows the work-area height to the nearest quarter, between 100 % and 200 %', () => {
    expect(autoScale(1080)).toBe(1);
    expect(autoScale(1440)).toBe(1.25);
    expect(autoScale(1600)).toBe(1.5);
    expect(autoScale(2160)).toBe(2);
    expect(autoScale(900)).toBe(1);
    expect(autoScale(4320)).toBe(2);
    expect(autoScale(0)).toBe(1);
    expect(resolveScale('auto', 2160)).toBe(2);
    expect(resolveScale(1.5, 2160)).toBe(1.5);
  });

  it('is persisted, defaults to auto, and survives an unavailable or corrupt storage', () => {
    localStorage.clear();
    expect(loadUiScale()).toBe('auto');
    saveUiScale(1.25); expect(localStorage.getItem('ledge.uiScale')).toBe('1.25'); expect(loadUiScale()).toBe(1.25);
    localStorage.setItem('ledge.uiScale', '3'); expect(loadUiScale()).toBe('auto');
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadUiScale()).toBe('auto');
    expect(() => saveUiScale(2)).not.toThrow();
    get.mockRestore(); set.mockRestore();
  });

  it('the Size setting is a radio group; Auto shows the value it resolves to', () => {
    const onUiScale = vi.fn();
    render(<SettingsView visible theme="dark" dnd={false} reduced={false} osReduced={false} onToggleDnd={() => {}} onReduced={() => {}} onBack={() => {}} onClose={() => {}} uiScale="auto" autoScale={2} onUiScale={onUiScale} />);
    const group = screen.getByRole('group', { name: 'Size' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Auto (200%)' })).toBeChecked();
    for (const n of ['100%', '125%', '150%', '200%']) expect(screen.getByRole('radio', { name: n })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: '150%' }));
    expect(onUiScale).toHaveBeenCalledWith(1.5);
  });
});

class SilentSocket {
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: (() => void) | null = null;
  readyState = 0; send() {} close() {} addEventListener() {} removeEventListener() {}
}

describe('App UI scale (browser)', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', SilentSocket); localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('zooms the app root and lays the surface out in the zoomed height; a stored size applies, a resize follows', () => {
    const h = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 2160 });
    try {
      const { unmount } = render(<App />);
      const root = document.querySelector('[data-ui-zoom]') as HTMLElement;
      expect(root.style.zoom).toBe('2');
      expect(document.documentElement.dataset.uiScale).toBe('2');
      // The empty handle (a 60 px strip) is centered in 2160 / 2 = 1080 CSS px.
      expect(document.querySelector('[data-surface]')).toHaveStyle({ top: `${1080 / 2 - 30}px` });
      expect(localStorage.getItem('ledge.uiScale')).toBe('auto');
      unmount();
      localStorage.setItem('ledge.uiScale', '1.5');
      render(<App />);
      expect((document.querySelector('[data-ui-zoom]') as HTMLElement).style.zoom).toBe('1.5');
      act(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 }); window.dispatchEvent(new Event('resize')); });
      expect(document.querySelector('[data-surface]')).toHaveStyle({ top: `${1200 / 1.5 / 2 - 30}px` });
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
    }
  });
});
