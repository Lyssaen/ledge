import { beforeEach, describe, expect, it } from 'vitest';
import type { TermSurface } from '../src/term/surface';
import { TermStore } from '../src/term/store';
import { webglPick } from '../src/term/webgl';
import { loadWebglMax, saveWebglMax } from '../src/term/webglPrefs';

type Fake = TermSurface & { webgl: boolean; calls: boolean[]; lose(): void };
function fake(): Fake {
  const lost: (() => void)[] = [];
  const s: Fake = {
    host: document.createElement('div'), webgl: false, calls: [],
    write: () => {}, onInput: () => {}, onResize: () => {}, size: () => ({ cols: 80, rows: 24 }), fit: () => {}, focus: () => {},
    setReadOnly: () => {}, setTheme: () => {}, dispose: () => {},
    setWebgl: on => { s.webgl = on; s.calls.push(on); },
    onWebglLost: fn => { lost.push(fn); },
    lose: () => { s.webgl = false; for (const fn of lost) fn(); }
  };
  return s;
}

describe('webglPick', () => {
  it('keeps the last `max` shown', () => { expect([...webglPick(['a', 'b', 'c'], 2)].sort()).toEqual(['b', 'c']); });
  it('bounds max to 1..16', () => {
    expect([...webglPick(['a', 'b'], 0)]).toEqual(['b']);
    expect([...webglPick(['a', 'b'], -3)]).toEqual(['b']);
    expect(webglPick(Array.from({ length: 20 }, (_, i) => String(i)), 99).size).toBe(16);
  });
});

describe('the store’s WebGL budget', () => {
  /** Three shells of one session, each with its own fake surface (a shell's surface is made when it starts). */
  function setup(max: number) {
    const backend = { open: () => Promise.resolve({ write: () => {}, resize: () => {}, close: () => {} }) };
    const st = new TermStore({ backend, surface: fake, agentArgv: () => null, shellArgv: () => ['sh'], shellPlace: () => ({ dir: '/', remote: false }) });
    st.setWebglMax(max);
    const ids = [1, 2, 3].map(() => st.addShell('s', '/', false));
    for (const id of ids) st.select('s', id);
    return { st, ids, surf: ids.map(id => st.surface(id) as Fake) };
  }

  it('3 shown with max 2: the first is DOM, the other two WebGL', () => {
    const { st, ids, surf } = setup(2);
    for (const id of ids) st.setShown(id, true);
    expect(surf.map(s => s.webgl)).toEqual([false, true, true]);
    expect(surf[0]!.calls.at(-1)).toBe(false);
  });

  it('a surface that stops being shown frees its slot for the next in the list', () => {
    const { st, ids, surf } = setup(2);
    for (const id of ids) st.setShown(id, true);
    st.setShown(ids[1]!, false);
    expect(surf.map(s => s.webgl)).toEqual([true, false, true]);
  });

  it('setWebglMax(1) leaves WebGL to the last one shown', () => {
    const { st, ids, surf } = setup(3);
    for (const id of ids) st.setShown(id, true);
    expect(surf.map(s => s.webgl)).toEqual([true, true, true]);
    st.setWebglMax(1);
    expect(surf.map(s => s.webgl)).toEqual([false, false, true]);
  });

  it('a lost context leaves the terminal on the DOM and the next one in the list takes the slot', () => {
    const { st, ids, surf } = setup(2);
    for (const id of ids) st.setShown(id, true);
    surf[2]!.lose();
    expect(surf.map(s => s.webgl)).toEqual([true, true, false]);
    // Shown again, it asks for WebGL again.
    st.setShown(ids[2]!, false); st.setShown(ids[2]!, true);
    expect(surf.map(s => s.webgl)).toEqual([false, true, true]);
  });

  it('a surface made after it was shown joins the budget', () => {
    const { st } = setup(2);
    const id = st.addShell('s', '/', false);
    st.setShown(id, true);
    st.select('s', id);
    expect((st.surface(id) as Fake).webgl).toBe(true);
  });
});

describe('the stored budget', () => {
  beforeEach(() => { localStorage.clear(); });
  it('is 12 by default, kept, and clamped', () => {
    expect(loadWebglMax()).toBe(12);
    saveWebglMax(5);
    expect(loadWebglMax()).toBe(5);
    localStorage.setItem('ledge.ide.webgl', '99'); expect(loadWebglMax()).toBe(16);
    localStorage.setItem('ledge.ide.webgl', '"x"'); expect(loadWebglMax()).toBe(12);
  });
});
