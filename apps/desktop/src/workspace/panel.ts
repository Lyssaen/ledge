import { useSyncExternalStore } from 'react';

/** One column of the bottom panel: terminal tabs stacked like an editor group's, the one at `active` on show.
 *  Absent `stacks` means one column per terminal (how a panel is until a tab is dropped on another). */
export interface TermStack { refs: readonly string[]; active: number; /** Stable while tabs move in and out, so the column's screens stay mounted. */ id?: string }

/** The bottom panel (mockup `bottomPanel()`): its terminals, and the tab in front (Terminaux / Sortie).
 *  `terms` is every terminal, in column order. Pure; its store is not saved (R15): a restart opens the panel empty. */
export interface Panel { terms: readonly string[]; tab: 'term' | 'out'; stacks?: readonly TermStack[] }

export const EMPTY_PANEL: Panel = { terms: [], tab: 'term' };

/** The columns. No `stacks`: each terminal is its own column, the way a new shell opens. */
export function stacksOf(p: Panel): readonly TermStack[] {
  return p.stacks ?? p.terms.map(ref => ({ refs: [ref], active: 0 }));
}

function same(a: readonly TermStack[], b: readonly TermStack[]): boolean {
  return a.length === b.length && a.every((s, i) => {
    const o = b[i]!;
    return (s.id ?? '') === (o.id ?? '') && s.active === o.active && s.refs.length === o.refs.length && s.refs.every((r, j) => r === o.refs[j]);
  });
}

function pack(tab: Panel['tab'], stacks: readonly TermStack[]): Panel {
  const clean = stacks.filter(s => s.refs.length > 0).map(s => {
    const row: TermStack = { refs: s.refs, active: Math.max(0, Math.min(s.active, s.refs.length - 1)) };
    if (s.id) row.id = s.id;
    return row;
  });
  return { tab, stacks: clean, terms: clean.flatMap(s => [...s.refs]) };
}

function clone(p: Panel): { id?: string; refs: string[]; active: number }[] {
  return stacksOf(p).map(s => ({ ...(s.id ? { id: s.id } : {}), refs: [...s.refs], active: s.active }));
}

/** `stacks` once arranged, or `p` itself when the arrangement is the one it already has. */
function arranged(p: Panel, stacks: TermStack[], tab: Panel['tab'] = p.tab): Panel {
  const next = pack(tab, stacks);
  return same(stacksOf(p), next.stacks!) && p.tab === next.tab ? p : next;
}

function dropRef(stacks: { refs: string[]; active: number }[], ref: string): void {
  for (let i = 0; i < stacks.length; i++) {
    const s = stacks[i]!;
    const at = s.refs.indexOf(ref);
    if (at < 0) continue;
    s.refs.splice(at, 1);
    if (s.active > at) s.active -= 1;
    else if (s.active === at) s.active = Math.min(at, Math.max(0, s.refs.length - 1));
    if (s.refs.length === 0) stacks.splice(i, 1);
    return;
  }
}

/** At the end, its own column, Terminaux in front; already there: the same terminals.
 *  A dock tab dropped on the panel (not on a column) comes back this way. « + » uses `openTerm`. */
export function addTerm(p: Panel, ref: string): Panel {
  if (p.terms.includes(ref)) return p.tab === 'term' ? p : { ...p, tab: 'term' };
  if (!p.stacks) return { terms: [...p.terms, ref], tab: 'term' };
  return pack('term', [...p.stacks, { refs: [ref], active: 0 }]);
}

/** « + »: a tab at the end of the existing group, then shown. No group yet: that one tab. Already there: shown.
 *  A panel not yet arranged (one column per terminal) becomes that one group, so a new shell does not open a column. */
export function openTerm(p: Panel, ref: string): Panel {
  if (p.terms.includes(ref)) {
    const on = activateTerm(p, ref);
    return on.tab === 'term' ? on : { ...on, tab: 'term' };
  }
  if (!p.stacks) {
    const refs = [...p.terms, ref];
    return pack('term', [{ id: p.terms[0] ?? ref, refs, active: refs.length - 1 }]);
  }
  const stacks = clone(p);
  const g = stacks[0];
  if (!g) return pack('term', [{ id: ref, refs: [ref], active: 0 }]);
  if (!g.id) g.id = g.refs[0] ?? ref;
  g.refs.push(ref);
  g.active = g.refs.length - 1;
  return arranged(p, stacks, 'term');
}

/** Absent: the same object. The column it leaves, emptied, goes. */
export function removeTerm(p: Panel, ref: string): Panel {
  if (!p.terms.includes(ref)) return p;
  if (!p.stacks) return { ...p, terms: p.terms.filter(x => x !== ref) };
  const stacks = clone(p);
  dropRef(stacks, ref);
  return pack(p.tab, stacks);
}

/** `ref` dropped on `onto`'s tab: into that column, in front of `onto`, and shown. A new ref (a dock tab) joins it.
 *  Already just there and shown: the same object. */
export function stackTerm(p: Panel, ref: string, onto: string): Panel {
  if (ref === onto) return p;
  const stacks = clone(p);
  if (!stacks.some(s => s.refs.includes(onto))) return p;
  dropRef(stacks, ref);
  for (const s of stacks) {
    const at = s.refs.indexOf(onto);
    if (at < 0) continue;
    s.refs.splice(at, 0, ref);
    s.active = at;
  }
  return arranged(p, stacks, 'term');
}

/** `ref` dropped on the right edge of the column `after` is in: its own column just after that one. Already there: the same object. */
export function besideTerm(p: Panel, ref: string, after: string): Panel {
  const stacks = clone(p);
  const afterAt = stacks.findIndex(s => s.refs.includes(after));
  if (afterAt < 0) return p;
  const from = stacks.findIndex(s => s.refs.includes(ref));
  if (ref === after && stacks[afterAt]!.refs.length === 1) return p;
  if (from >= 0 && stacks[from]!.refs.length === 1 && from === afterAt + 1) return p;
  if (from >= 0) dropRef(stacks, ref);
  const at = stacks.findIndex(s => s.refs.includes(after));
  if (at < 0) return p;
  stacks.splice(at + 1, 0, { id: ref, refs: [ref], active: 0 });
  return arranged(p, stacks, 'term');
}

/** That terminal's tab, in front of its column. Already in front, or absent: the same object. */
export function activateTerm(p: Panel, ref: string): Panel {
  const stacks = clone(p);
  const i = stacks.findIndex(s => s.refs.includes(ref));
  if (i < 0 || stacks[i]!.refs[stacks[i]!.active] === ref) return p;
  stacks[i] = { ...stacks[i]!, active: stacks[i]!.refs.indexOf(ref) };
  return arranged(p, stacks);
}

/** The view key of a tile (its TabPlace): the agent's one screen (R2) is held by a tile as by a tab (`terminal:<ref>`). */
export const panelViewer = (ref: string): string => `panel:${ref}`;

/** A terminal tab's key: a bottom-panel shell's (`terminal:shell:<n>`) or an agent's (`terminal:agent:<id>`). */
export const isTerminalRef = (key: string): boolean => key.startsWith('terminal:shell:') || key.startsWith('terminal:agent:');

export interface PanelStore { get(): Panel; update(fn: (p: Panel) => Panel): void; subscribe(cb: () => void): () => void }

export function createPanelStore(initial: Panel = EMPTY_PANEL): PanelStore {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    update(fn) {
      const next = fn(state);
      if (next === state) return;
      state = next;
      for (const cb of [...subs]) cb();
    },
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; }
  };
}

export function usePanel(store: PanelStore): Panel {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
