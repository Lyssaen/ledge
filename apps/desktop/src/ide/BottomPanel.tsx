import { Fragment, useEffect, useState, type DragEvent, type JSX, type ReactNode } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import type { ShellKind, ShellRow } from '../term/shells';
import { isTerminalRef, panelViewer, type Panel } from '../workspace/panel';
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
  /** A terminal tab of the dock (its key, `terminal:…`) dropped on the panel: it comes back as a tile. */
  onDockDrop(key: string): void;
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
  useEffect(() => termDrag.subscribe(() => { if (termDrag.get()?.from !== 'dock') setOver(false); }), []);
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
    termDrag.set({ from: 'panel', ref });
  };
  const onTileDragEnd = () => { if (termDrag.get()?.from === 'panel') termDrag.set(null); };
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
            {terms.length === 0 ? <span className="ide-bterms-none">{pt.noTerms}</span> : terms.map(ref => {
              const title = p.tileTitle(ref);
              // Its own place (R2): the agent's one screen and the shown terminals' budget follow tiles as they follow tabs.
              const place: TabPlace = { key: panelViewer(ref), group: '', visible: true, active: false };
              return (
                <section key={ref} className="ide-btile" role="group" aria-label={title}>
                  <div className="ide-btile-bar">
                    <div className="ide-btile-tab" draggable title={pt.drag} onDragStart={onTileDragStart(ref)} onDragEnd={onTileDragEnd}>{title}</div>
                    <div className="ide-btile-tools">
                      <span className="chip-k">{p.tileKind(ref)}</span>
                      <button type="button" aria-label={pt.close} title={pt.close} onClick={() => p.onClose(ref)}>×</button>
                    </div>
                  </div>
                  <div className="ide-btile-body"><TabPlaceContext.Provider value={place}>{p.tile(ref)}</TabPlaceContext.Provider></div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
