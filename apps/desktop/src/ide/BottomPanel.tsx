import { Fragment, useEffect, useRef, useState, type DragEvent, type JSX, type ReactNode } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import type { ShellKind, ShellRow } from '../term/shells';
import { activateTerm, besideTerm, isTerminalRef, joinTerm, panelViewer, stackTerm, stacksOf, type Panel } from '../workspace/panel';
import { TabPlaceContext, type TabPlace } from '../workspace/tabPlace';
import { TERM_DRAG_TYPE, termDrag } from './termDrag';

export interface BottomPanelProps {
  panel: Panel; onTab(t: 'term' | 'out'): void;
  /** Sortie: its entries' count and its view. */
  outputCount: number; output: ReactNode;
  /** « + ▾ »: the shells offered (shellMenu), one picked. */
  menu: readonly ShellRow[]; onNewShell(k: ShellKind): void;
  /** A terminal's screen, its title (`>_ …`) and its kind (the `.chip-k`). */
  tile(ref: string): ReactNode; tileTitle(ref: string): string; tileKind(ref: string): string;
  /** A tile's « × »; « Masquer le panneau ». */
  onClose(ref: string): void; onHide(): void;
  /** A terminal tab of the dock (its key, `terminal:…`) dropped on the panel: it comes back as its own column.
   *  Dropped on a column's tab (`onto`), it stacks there, in front of it; on that column's body (`end`), at its end; on its right
   *  edge (`beside`), it opens its own column after it. */
  onDockDrop(key: string, onto?: string, where?: 'beside' | 'end'): void;
  /** A terminal tab dropped on another, or on a column's right edge, or chosen: the panel, rearranged. */
  onArrange?(next: Panel): void;
  /** Any other dock tab dropped on the panel: refused (only terminals go there), said by the host. */
  onRefused(): void;
}

const SECTIONS = ['local', 'ledge', 'machines'] as const;
/** Strictly inside: a dragleave out of the window reports (0, 0) or the edge itself. */
const inside = (r: DOMRect, x: number, y: number) => x > r.left && x < r.right && y > r.top && y < r.bottom;

/** The IDE's bottom panel (mockup `bottomPanel()`): Terminaux, its count, and Sortie, its count; « + ▾ » (the shells) and « × »
 *  (hide). Terminaux are tiles side by side, each with its one tab (`>_ title`), its kind and its « × », then its screen. */
export function BottomPanel(p: BottomPanelProps): JSX.Element {
  const { t } = useI18n();
  const pt = t.ide.panel;
  const [menu, setMenu] = useState(false);
  const { tab, terms } = p.panel;
  // A dock tab carried over the panel: its frame outlined (mockup `.drop-on`) until it leaves, drops, or the drag ends.
  const [over, setOver] = useState(false);
  // The column a terminal tab is carried over: its tab (stack) or its right edge (its own column).
  const [spot, setSpot] = useState<{ ref: string; beside: boolean } | null>(null);
  const dragged = useRef(false);
  useEffect(() => termDrag.subscribe(() => { if (termDrag.get()?.from !== 'dock') setOver(false); if (!termDrag.get()) setSpot(null); }), []);
  const onDragOver = (e: DragEvent) => {
    if (termDrag.get()?.from !== 'dock') return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setOver(true);
  };
  // Left for a child of its own: still over. `relatedTarget` is null in some webviews: the pointer's place then decides.
  const onDragLeave = (e: DragEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to ? e.currentTarget.contains(to) : inside(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)) return;
    setOver(false);
  };
  const onDrop = (e: DragEvent) => {
    const d = termDrag.get();
    if (d?.from !== 'dock') return;
    e.preventDefault();
    setOver(false);
    termDrag.set(null);
    if (isTerminalRef(d.key)) p.onDockDrop(d.key); else p.onRefused();
  };
  // A tile picked up: the dock reads which one (the browser hides drag data until the drop).
  const onTileDragStart = (ref: string) => (e: DragEvent) => {
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData(TERM_DRAG_TYPE, ref); } catch { /* a webview may refuse it */ } }
    dragged.current = true;
    termDrag.set({ from: 'panel', ref });
  };
  const onTileDragEnd = () => {
    if (termDrag.get()?.from === 'panel') termDrag.set(null);
    // The click that follows a drag must not also activate the tab (it would undo the drop).
    setTimeout(() => { dragged.current = false; }, 0);
  };
  /** A panel tile, or a dock terminal tab: what can land on a column. A dock tab's ref, or null when it is not a terminal. */
  const carried = (): { panel?: string; dock?: string } | null => {
    const d = termDrag.get();
    if (d?.from === 'panel') return { panel: d.ref };
    if (d?.from === 'dock' && isTerminalRef(d.key)) return { dock: d.key.slice('terminal:'.length) };
    return null;
  };
  /** `front`: on `onto`'s tab, in front of it; `end`: on the body of `onto`'s column, at its end; `beside`: a column after it. */
  const land = (onto: string, where: 'front' | 'end' | 'beside') => {
    const c = carried();
    if (!c) return;
    setSpot(null);
    termDrag.set(null);
    if (c.dock !== undefined) {
      if (where === 'front') p.onDockDrop(`terminal:${c.dock}`, onto);
      else p.onDockDrop(`terminal:${c.dock}`, onto, where);
      return;
    }
    const ref = c.panel!;
    const next = where === 'beside' ? besideTerm(p.panel, ref, onto) : where === 'end' ? joinTerm(p.panel, ref, onto) : stackTerm(p.panel, ref, onto);
    if (next !== p.panel) p.onArrange?.(next);
  };
  const item = (k: 'term' | 'out', d: readonly string[], label: string, tip: string, count: number) => (
    <button type="button" role="tab" aria-selected={tab === k} aria-label={label} title={tip} className={tab === k ? 'on' : undefined} onClick={() => p.onTab(k)}>
      <Icon d={d} size={15} /><span className="ide-bp-count">{count}</span>
    </button>
  );
  const sectionLabel = { local: pt.shells.local, ledge: pt.shells.ledge, machines: pt.shells.machines };
  const sections = SECTIONS.filter(s => p.menu.some(r => r.section === s));
  return (
    <section className={`ide-bottom${over ? ' drop-on' : ''}`} aria-label={t.ide.bottomLabel} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="ide-bp-tabs">
        <div role="tablist" aria-label={t.ide.bottomLabel}>
          {item('term', SHELL_ICONS.terminals, t.ide.terminals, t.ide.terminals, terms.length)}
          {item('out', SHELL_ICONS.output, t.ide.output, t.ide.outputTip, p.outputCount)}
        </div>
        <span className="ide-bp-sp" />
        <Menu open={menu} onOpenChange={setMenu} label={pt.shells.title} className="ide-shell-menu-wrap" menuClassName="session-menu ide-shell-menu" flip
          trigger={tr => (
            <button type="button" ref={tr.ref} aria-haspopup={tr['aria-haspopup']} aria-expanded={tr['aria-expanded']} onClick={tr.onClick}
              aria-label={pt.newTerminal} title={pt.newTerminalTip}>+<span className="ide-bp-caret" aria-hidden="true">▾</span></button>
          )}>
          <div className="ide-shell-menu-title">{pt.shells.title}</div>
          {sections.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <hr />}
              <div className="ide-shell-menu-h">{sectionLabel[s]}</div>
              {p.menu.filter(r => r.section === s).map(r => (
                <MenuItem key={r.kind} onSelect={() => p.onNewShell(r.kind)}>
                  <span>{r.label}</span>{r.hint && <small className="r">{r.hint}</small>}
                </MenuItem>
              ))}
            </Fragment>
          ))}
        </Menu>
        <button type="button" aria-label={t.ide.hidePanel} title={t.ide.hidePanel} onClick={p.onHide}>×</button>
      </div>
      <div className="ide-bp-body" role="tabpanel" aria-label={tab === 'term' ? t.ide.terminals : t.ide.output}>
        {tab === 'out' ? p.output : (
          <div className="ide-bterms">
            {terms.length === 0 ? <span className="ide-bterms-none">{pt.noTerms}</span> : stacksOf(p.panel).map(stack => {
              const active = stack.refs[stack.active] ?? stack.refs[0]!;
              const title = p.tileTitle(active);
              // The column keeps its screens mounted (hidden tabs included): switching or stacking a tab does not
              // detach the one on show, which is what flashed the sessions' terminal views.
              const onColumn = (e: DragEvent, drop: boolean) => {
                if (!carried()) return;
                const beside = e.clientX > e.currentTarget.getBoundingClientRect().right - 28;
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                // The column's body (not one of its tabs): the terminal joins it at the end, as an editor group takes a tab.
                if (drop) land(active, beside ? 'beside' : 'end');
                else setSpot({ ref: active, beside });
              };
              return (
                <section key={stack.id ?? stack.refs[0]} className={`ide-btile${spot?.ref === active && spot.beside ? ' drop-beside' : ''}`} role="group" aria-label={title}
                  onDragOver={e => onColumn(e, false)} onDrop={e => onColumn(e, true)}>
                  <div className="ide-btile-bar">
                    <div className="ide-btile-tabs" role="tablist">
                      {stack.refs.map(ref => {
                        const on = ref === active;
                        const name = p.tileTitle(ref).replace(/^>_\s*/, '');
                        return (
                          <div key={ref} className={`ide-btile-tab${on ? ' on' : ''}${spot?.ref === ref && !spot.beside ? ' drop-on' : ''}`} role="tab" aria-selected={on} draggable title={pt.drag}
                            onDragStart={onTileDragStart(ref)} onDragEnd={onTileDragEnd}
                            onDragOver={e => { const c = carried(); if (!c || c.panel === ref) return; e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; setSpot({ ref, beside: false }); }}
                            onDrop={e => { e.preventDefault(); e.stopPropagation(); land(ref, 'front'); }}
                            onClick={() => { if (dragged.current) { dragged.current = false; return; } const next = activateTerm(p.panel, ref); if (next !== p.panel) p.onArrange?.(next); }}>
                            <span className="ide-tab">
                              <span className="tab-term" aria-hidden="true">&gt;_</span>
                              <span className="tab-name">{name}</span>
                            </span>
                            <button type="button" className="ide-tab-x" aria-label={pt.close} title={pt.close} onPointerDown={e => e.preventDefault()} onClick={e => { e.stopPropagation(); p.onClose(ref); }}>
                              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="ide-btile-tools">
                      <span className="chip-k">{p.tileKind(active)}</span>
                    </div>
                  </div>
                  <div className="ide-btile-body">
                    {stack.refs.map(ref => {
                      const on = ref === active;
                      const place: TabPlace = { key: panelViewer(ref), group: stack.id ?? '', visible: on, active: false };
                      return (
                        <div key={ref} className="ide-btile-screen" hidden={!on}>
                          <TabPlaceContext.Provider value={place}>{p.tile(ref)}</TabPlaceContext.Provider>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
