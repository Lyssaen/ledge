import { describe, it, expect } from 'vitest';
import { NAMES, ledgeTitleRest, pickName } from '../src/names.js';

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

describe('ledgeTitleRest', () => {
  it('a bare Ledge-shaped name is empty, « name - rest » gives the rest, any other title nothing', () => {
    for (const t of ['Otto', 'Pim', 'Pim-2', 'Foo', 'Pim - ', 'Foo -  ']) expect(ledgeTitleRest(t, 'Foo')).toBe('');
    expect(ledgeTitleRest('Pim - Refonte', 'Foo')).toBe('Refonte');
    expect(ledgeTitleRest('Max-12 - x', 'Foo')).toBe('x');
    expect(ledgeTitleRest('Foo - a - b', 'Foo')).toBe('a - b');
    for (const t of ['mon projet - x', 'Ottoman - x', 'Pimx', 'Pim-a', 'pim', '']) expect(ledgeTitleRest(t, 'Foo')).toBeUndefined();
  });
});
