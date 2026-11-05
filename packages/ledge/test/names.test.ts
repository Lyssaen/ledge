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
  it('keeps the case the user typed after the first letter: PrixMat, ForKJo', () => {
    expect(pickName([], 'PrixMat')).toBe('PrixMat');
    expect(pickName([], 'forKJo')).toBe('ForKJo');
  });
  it('a name taken in another case is taken', () => {
    expect(pickName(['Otto'], 'OTTO')).toBe('OTTO-2');
    expect(pickName(['PrixMat'], 'prixmat')).toBe('Prixmat-2');
  });
  it('drops what would break the name as an address (spaces, commas, @, brackets), and keeps it short', () => {
    expect(pickName([], 'Prix Mat')).toBe('PrixMat');
    expect(pickName([], '@Pim,Nova')).toBe('PimNova');
    expect(pickName([], 'Max [ab12]')).toBe('Maxab12');
    expect(pickName([], 'Élodie_2-b')).toBe('Élodie_2-b');
    expect(pickName([], 'A'.repeat(40))).toBe('A'.repeat(24));
    expect(pickName([], ' ,@ ')).toBe(NAMES[0]);
  });
  it('never hands out « Ledge », the address of Ledge itself', () => {
    expect(pickName([], 'ledge')).toBe('Ledge-2');
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
