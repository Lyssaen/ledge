import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoScale, loadScale, migrateLegacyScale, resolveScale, saveScale } from '../src/scale';

beforeEach(() => localStorage.clear());

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

  it('keeps each prefix apart', () => {
    saveScale('handle', 2, 'desktop');
    expect(loadScale('handle')).toBe('auto');
    expect(loadScale('handle', 'desktop')).toBe(2);
    expect(localStorage.getItem('desktop.handleScale')).toBe('2');
  });
});
