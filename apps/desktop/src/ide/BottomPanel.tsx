import { Fragment, useState, type JSX, type ReactNode } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import type { ShellKind, ShellRow } from '../term/shells';
import type { Panel } from '../workspace/panel';

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
}

const SECTIONS = ['local', 'ledge', 'machines'] as const;

/** The IDE's bottom panel (mockup `bottomPanel()`): Terminaux, its count, and Sortie, its count; « + ▾ » (the shells) and « × »
 *  (hide). Terminaux are tiles side by side, each with its one tab (`>_ title`), its kind and its « × », then its screen. */
export function BottomPanel(p: BottomPanelProps): JSX.Element {
  const { t } = useI18n();
  const pt = t.ide.panel;
  const [menu, setMenu] = useState(false);
  const { tab, terms } = p.panel;
  const item = (k: 'term' | 'out', d: readonly string[], label: string, tip: string, count: number) => (
    <button type="button" role="tab" aria-selected={tab === k} aria-label={label} title={tip} className={tab === k ? 'on' : undefined} onClick={() => p.onTab(k)}>
      <Icon d={d} size={15} /><span className="ide-bp-count">{count}</span>
    </button>
  );
  const sectionLabel = { local: pt.shells.local, ledge: pt.shells.ledge, machines: pt.shells.machines };
  const sections = SECTIONS.filter(s => p.menu.some(r => r.section === s));
  return (
    <section className="ide-bottom" aria-label={t.ide.bottomLabel}>
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
              return (
                <section key={ref} className="ide-btile" role="group" aria-label={title}>
                  <div className="ide-btile-bar">
                    {/* The drag itself (to a group) is lot 5's next task. */}
                    <div className="ide-btile-tab" draggable title={pt.drag}>{title}</div>
                    <div className="ide-btile-tools">
                      <span className="chip-k">{p.tileKind(ref)}</span>
                      <button type="button" aria-label={pt.close} title={pt.close} onClick={() => p.onClose(ref)}>×</button>
                    </div>
                  </div>
                  <div className="ide-btile-body">{p.tile(ref)}</div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
