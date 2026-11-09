import type { TermStore } from '../term/store';
import { place } from '../workspace/model';
import { panelViewer, removeTerm, type PanelStore } from '../workspace/panel';
import type { WorkspaceStore } from '../workspace/store';

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

/** A panel tile dropped in the dock: its terminal tab placed there (`place`), then — only once that took — the tile leaves the
 *  panel and an agent's screen passes to the tab as it is (`handOver`: the tile goes before the tab mounts, which would
 *  otherwise reconnect). A drop the model cannot take (its group gone meanwhile) leaves the tile where it was. Says whether it
 *  moved and whether the panel is left empty. */
export function tileToDock(
  d: { ws: WorkspaceStore; panel: PanelStore; terms: Pick<TermStore, 'handOver'> },
  ref: string, to: { group: string; index?: number } | { rightOf: string } | { window: 'new' }
): { moved: boolean; empty: boolean } {
  const w = d.ws.get();
  const next = place(w, { kind: 'terminal', ref }, to);
  if (next === w) return { moved: false, empty: d.panel.get().terms.length === 0 };
  if (ref.startsWith('agent:')) d.terms.handOver(ref.slice('agent:'.length), panelViewer(ref), `terminal:${ref}`);
  d.panel.update(p => removeTerm(p, ref));
  d.ws.update(() => next);
  return { moved: true, empty: d.panel.get().terms.length === 0 };
}
