import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import { App } from '../src/App';
import { setFallbackLang } from '../src/i18n/lang';

class SilentSocket {
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: (() => void) | null = null;
  readyState = 0;
  send() {} close() {} addEventListener() {} removeEventListener() {}
}
/** Desktop writing a key in its own window: the notch hears it as a `storage` event. */
const desktopSets = (key: string, value: string | null) => act(() => {
  if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
});
/** The folded island's Ledge mark goes grey under do-not-disturb. */
const quiet = () => (document.querySelector('[data-ledge-mark]') as HTMLElement).style.background === 'var(--muted-foreground)';
const pip = () => document.querySelector('[data-update-pip]');

describe('App follows what Desktop decides', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', SilentSocket); localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); setFallbackLang('en'); });

  it('takes Desktop’s do-not-disturb, at start and live', () => {
    localStorage.setItem('desktop.dnd', '1');
    render(<App />);
    expect(quiet()).toBe(true);
    desktopSets('desktop.dnd', '0');
    expect(quiet()).toBe(false);
    desktopSets('desktop.dnd', '1');
    expect(quiet()).toBe(true);
  });

  it('writes the notch’s own do-not-disturb toggle to Desktop’s key, ‘1’ then ‘0’', () => {
    render(<App />);
    expect(localStorage.getItem('desktop.dnd')).toBe('0');
    act(() => { fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true }); });
    expect(document.querySelector('[data-surface]')).toHaveAttribute('data-mode', 'chat');
    fireEvent.click(screen.getByRole('button', { name: 'Ledge menu' }));
    fireEvent.click(screen.getByRole('switch', { name: /Do not disturb/ }));
    expect(localStorage.getItem('desktop.dnd')).toBe('1');
    fireEvent.click(screen.getByRole('switch', { name: /Do not disturb/ }));
    expect(localStorage.getItem('desktop.dnd')).toBe('0');
  });

  it('speaks Desktop’s language, and follows it; anything else is ignored', () => {
    localStorage.setItem('desktop.lang', 'en');
    render(<App />);
    expect(document.documentElement.lang).toBe('en');
    desktopSets('desktop.lang', 'fr');
    expect(document.documentElement.lang).toBe('fr');
    desktopSets('desktop.lang', 'de');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('shows the pip for the update Desktop found, and drops it when Desktop does', () => {
    localStorage.setItem('desktop.lang', 'en');
    localStorage.setItem('desktop.update.available', '0.7.1');
    render(<App />);
    expect(pip()).toHaveAttribute('data-update-pip', 'new');
    expect(pip()?.closest('button') ?? pip()).toHaveAccessibleName('Ledge 0.7.1 is ready');
    desktopSets('desktop.update.available', null);
    expect(pip()).toBeNull();
  });
});
