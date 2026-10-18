import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { App } from '../src/App';
import { setFallbackLang } from '../src/i18n/lang';

const updates = vi.hoisted(() => ({ check: vi.fn(async () => null) }));
vi.mock('../src/update/bridge', async orig => ({ ...(await orig<typeof import('../src/update/bridge')>()), checkForUpdate: updates.check }));

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
  beforeEach(() => { vi.stubGlobal('WebSocket', SilentSocket); localStorage.clear(); updates.check.mockClear(); });
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

  it('never checks for updates itself', async () => {
    render(<App />);
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    expect(updates.check).not.toHaveBeenCalled();
  });
});
