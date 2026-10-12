import { describe, it, expect, beforeEach } from 'vitest';
import { loadIslandPosition, saveIslandPosition, loadDiscreet, saveDiscreet } from '../src/island';

describe('island settings', () => {
  beforeEach(() => localStorage.clear());
  it('position: centre by default, remembered, invalid values fall back', () => {
    expect(loadIslandPosition()).toBe('center');
    saveIslandPosition('right');
    expect(localStorage.getItem('ledge.islandPosition')).toBe('right');
    expect(loadIslandPosition()).toBe('right');
    localStorage.setItem('ledge.islandPosition', 'top');
    expect(loadIslandPosition()).toBe('center');
  });
  it('discreet mode: on by default, remembered off', () => {
    expect(loadDiscreet()).toBe(true);
    saveDiscreet(false);
    expect(localStorage.getItem('ledge.discreet')).toBe('0');
    expect(loadDiscreet()).toBe(false);
    saveDiscreet(true);
    expect(loadDiscreet()).toBe(true);
  });
});
