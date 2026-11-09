import { beforeEach, describe, expect, it } from 'vitest';
import { atelierOnly, bootWorkspace, capture, cleanName, groupCount, loadBoot, loadDispositions, parseBoot, parseDispositions, remove, saveBoot, saveDispositions, upsert, BOOT_KEY, DISPOSITIONS_KEY } from '../../src/workspace/dispositions';
import { empty, MAIN, move, open, type Tab, type Workspace } from '../../src/workspace/model';

const ATELIER: Tab = { kind: 'atelier', ref: 'main' };
const pim: Tab = { kind: 'session', ref: 'pim', view: 'thread' };
const nova: Tab = { kind: 'session', ref: 'nova', view: 'thread' };

/** Two tabs in the main window, a third torn out into a window of its own (lot 9). */
function withWindow(): Workspace {
  let w = open(empty(), pim, 'active');
  w = open(w, nova, 'right');
  w = open(w, ATELIER, 'active');
  return move(w, 'atelier:main', { window: 'new' });
}

beforeEach(() => { localStorage.clear(); });

describe('dispositions', () => {
  it('keep the windows, the groups and the panels', () => {
    const ws = withWindow();
    const d = capture('Revue', ws, { bottom: true, right: false });
    expect(d).toEqual({ name: 'Revue', ws, bottom: true, right: false });
    expect(ws.windows.length).toBe(2);
    expect(groupCount(d)).toBe(ws.groups.length);
  });

  it('replace one saved under the same name, where it was', () => {
    const a = capture('A', empty(), { bottom: false, right: true });
    const b = capture('B', empty(), { bottom: false, right: true });
    const a2 = capture('A', withWindow(), { bottom: true, right: true });
    const list = upsert(upsert(upsert([], a), b), a2);
    expect(list.map(x => x.name)).toEqual(['A', 'B']);
    expect(list[0]).toBe(a2);
    expect(remove(list, 'A').map(x => x.name)).toEqual(['B']);
  });

  it('take a trimmed name; an empty one saves nothing', () => {
    expect(cleanName('  Revue  ')).toBe('Revue');
    expect(cleanName('   ')).toBeNull();
  });

  it('come back as saved, and the unreadable ones are dropped', () => {
    const ws = withWindow();
    saveDispositions([capture('Revue', ws, { bottom: true, right: false })]);
    expect(loadDispositions()).toEqual([{ name: 'Revue', ws, bottom: true, right: false }]);
    expect(loadDispositions()).toBe(loadDispositions());
    const good = JSON.parse(localStorage.getItem(DISPOSITIONS_KEY)!)[0];
    expect(parseDispositions([good, { name: 'x', ws: '{"version":2}' }, { name: '', ws: good.ws }, 'nope', { ...good }]).map(x => x.name)).toEqual(['Revue']);
    expect(parseDispositions({})).toEqual([]);
  });
});

describe('the start (« Au démarrage »)', () => {
  const last = open(empty(), pim, 'active');
  const saved = capture('Revue', withWindow(), { bottom: true, right: false });

  it('is the last disposition by default, and anything unknown reads so', () => {
    expect(loadBoot()).toEqual({ kind: 'last' });
    for (const raw of [null, 'atelier', { kind: 'fixed' }, { kind: 'fixed', name: '' }, { kind: 'other' }]) expect(parseBoot(raw)).toEqual({ kind: 'last' });
    saveBoot({ kind: 'fixed', name: 'Revue' });
    expect(JSON.parse(localStorage.getItem(BOOT_KEY)!)).toEqual({ kind: 'fixed', name: 'Revue' });
    expect(loadBoot()).toEqual({ kind: 'fixed', name: 'Revue' });
  });

  it('opens the last workspace as it was', () => {
    expect(bootWorkspace({ kind: 'last' }, last, [saved], ATELIER)).toEqual({ ws: last, panels: null });
  });

  it('opens a fixed disposition with its panels; gone, the last workspace', () => {
    expect(bootWorkspace({ kind: 'fixed', name: 'Revue' }, last, [saved], ATELIER)).toEqual({ ws: saved.ws, panels: { bottom: true, right: false }, current: 'Revue' });
    expect(bootWorkspace({ kind: 'fixed', name: 'Gone' }, last, [saved], ATELIER)).toEqual({ ws: last, panels: null });
  });

  it('opens the atelier alone, in the main window', () => {
    const r = bootWorkspace({ kind: 'atelier' }, last, [saved], ATELIER);
    expect(r.ws).toEqual(atelierOnly(ATELIER));
    expect(r.ws.windows).toEqual([MAIN]);
    expect(r.ws.groups[0]!.tabs).toEqual([ATELIER]);
    expect(r.current).toBeNull();
  });
});
