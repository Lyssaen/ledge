/** A terminal being dragged between the bottom panel and the dock: a panel tile (its ref, `shell:<n>` or `agent:<id>`) or a dock
 *  tab (its key). The browser's drag data cannot be read during dragover, so the dock and the panel read this instead; it is
 *  set at dragstart and cleared when the drag ends (its drop, its dragend, or a pointer let go). */
export type TermDrag = { from: 'panel'; ref: string } | { from: 'dock'; key: string };

/** The drag type a panel tile puts on its drag (a file manager or another app reads nothing of it). */
export const TERM_DRAG_TYPE = 'application/x-ledge-term';

let current: TermDrag | null = null;
const subs = new Set<() => void>();

export const termDrag = {
  get: (): TermDrag | null => current,
  set(d: TermDrag | null): void {
    if (d === current) return;
    current = d;
    for (const cb of [...subs]) cb();
  },
  subscribe(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
};

/** The ref of the panel tile being dragged, or null. */
export const panelDragRef = (): string | null => { const d = current; return d?.from === 'panel' ? d.ref : null; };
