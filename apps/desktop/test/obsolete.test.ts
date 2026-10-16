import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OBSOLETE_KEYS, purgeObsolete } from '../src/state/obsolete';

describe('purgeObsolete', () => {
  beforeEach(() => localStorage.clear());
  it('removes the old Team / Meeting keys and keeps every other desktop key', () => {
    expect(OBSOLETE_KEYS).toEqual(['desktop.view', 'desktop.selected', 'desktop.panel', 'desktop.drafts', 'desktop.thread', 'desktop.launch']);
    for (const k of OBSOLETE_KEYS) localStorage.setItem(k, '{"view":"room"}');
    const kept = ['desktop.lang', 'desktop.theme', 'desktop.accent', 'desktop.panelScale', 'desktop.sounds', 'desktop.notify', 'desktop.dnd', 'desktop.tool', 'desktop.update.auto', 'desktop.machines', 'ledge.lang'];
    for (const k of kept) localStorage.setItem(k, 'x');
    purgeObsolete();
    for (const k of OBSOLETE_KEYS) expect(localStorage.getItem(k)).toBeNull();
    for (const k of kept) expect(localStorage.getItem(k)).toBe('x');
  });
  it('never throws when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => purgeObsolete()).not.toThrow();
    spy.mockRestore();
  });
});
