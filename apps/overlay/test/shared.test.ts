import { describe, it, expect, beforeEach } from 'vitest';
import { DND_KEY, loadDesktopUpdate, loadDnd, onStorageKey } from '../src/shared';

describe('what the notch reads from Desktop', () => {
  beforeEach(() => localStorage.clear());
  it('reads and follows Desktop’s do-not-disturb', () => {
    localStorage.setItem('desktop.dnd', '1');
    expect(loadDnd()).toBe(true);
    const seen: (string | null)[] = [];
    const off = onStorageKey(DND_KEY, v => seen.push(v));
    window.dispatchEvent(new StorageEvent('storage', { key: 'desktop.dnd', newValue: '0' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'ledge.theme', newValue: 'light' }));
    off();
    expect(seen).toEqual(['0']);
  });
  it('reads the update Desktop found', () => {
    expect(loadDesktopUpdate()).toBeNull();
    localStorage.setItem('desktop.update.available', '0.7.1');
    expect(loadDesktopUpdate()).toBe('0.7.1');
  });
});
