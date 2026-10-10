import { describe, it, expect } from 'vitest';
import { NAMES, pickName } from '../src/names.js';

describe('names', () => {
  it('has 64 unique short names', () => {
    expect(NAMES.length).toBe(64);
    expect(new Set(NAMES).size).toBe(64);
    for (const n of NAMES) expect(n.length).toBeLessThanOrEqual(5);
  });
  it('picks the first free name in list order', () => {
    expect(pickName([])).toBe(NAMES[0]);
    expect(pickName([NAMES[0]!, NAMES[1]!])).toBe(NAMES[2]);
  });
  it('honours a preferred name, capitalised', () => {
    expect(pickName(['Otto'], 'otto')).toBe('Otto-2');
    expect(pickName([], 'zed')).toBe('Zed');
  });
  it('treats a blank preferred name as no preference', () => {
    expect(pickName([], '   ')).toBe(NAMES[0]);
    expect(pickName([NAMES[0]!], '')).toBe(NAMES[1]);
    expect(pickName([], '  zed  ')).toBe('Zed');
  });
  it('suffixes when all 64 are taken', () => {
    expect(pickName(NAMES)).toBe(NAMES[0] + '-2');
  });
});
