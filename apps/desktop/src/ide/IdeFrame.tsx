import { useState, useSyncExternalStore, type CSSProperties, type JSX, type ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import { RIGHT_WIDTH, rightShown, type IdeLayout, type LayoutAction } from '../workspace/layout';
import type { Tab } from '../workspace/model';
import { ActivityBar } from './ActivityBar';
import { IdeExplorer } from './IdeExplorer';
import { IdeStatusBar } from './IdeStatusBar';
import { IdeTitleBar } from './IdeTitleBar';
import '../styles/ide.css';

// The chunk's other entry: the editing area, drawn inside the frame (ide/lazy.tsx).
export { DockHost } from './DockHost';

export interface IdeFrameProps {
  layout: IdeLayout; onLayout(a: LayoutAction): void;
  /** The sidebar's view (Sidebar with `section`), the editing area (DockHost), the right panel's chat, the status bar's footer. */
  explorer: ReactNode; editor: ReactNode; chat: ReactNode; footer: ReactNode;
  /** The harnesses' limits, at the status bar's far right (not inside the footer, which starts it). */
  usage?: ReactNode;
  /** Above the editing area (« daemon outdated »). */
  notice?: ReactNode;
  onSearch(): void;
  /** A dialog is open: the frame takes neither clicks nor the focus. */
  blocked: boolean;
  /** The local daemon is down (`data-readonly`); an agent is dragged onto a project (`is-dragging`). */
  readOnly: boolean; dragging: boolean;
  onTab(t: Tab): void; activeTab: Tab | null; badge: { perm: number; ask: number };
  waiting: readonly Session[]; onNextWaiting(): void;
}

const onResize = (cb: () => void) => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb); };
const windowWidth = () => window.innerWidth;

/** The bottom panel's frame (mockup `bottomPanel()`): Terminaux and Sortie, « Masquer le panneau ». Their content comes with lot 5. */
function BottomPanel({ onLayout }: { onLayout(a: LayoutAction): void }): JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<'term' | 'out'>('term');
  const item = (k: 'term' | 'out', d: readonly string[], label: string, tip: string) => (
    <button role="tab" aria-selected={tab === k} aria-label={label} title={tip} className={tab === k ? 'on' : undefined} onClick={() => setTab(k)}><Icon d={d} size={15} /></button>
  );
  return (
    <section className="ide-bottom" aria-label={t.ide.bottomLabel}>
      <div className="ide-bp-tabs">
        <div role="tablist" aria-label={t.ide.bottomLabel}>
          {item('term', SHELL_ICONS.terminals, t.ide.terminals, t.ide.terminals)}
          {item('out', SHELL_ICONS.output, t.ide.output, t.ide.outputTip)}
        </div>
        <span className="ide-bp-sp" />
        <button aria-label={t.ide.hidePanel} title={t.ide.hidePanel} onClick={() => onLayout({ type: 'show', panel: 'bottom', on: false })}>×</button>
      </div>
      <div className="ide-bp-body" role="tabpanel" />
    </section>
  );
}

/** The IDE shell (mockup `titlebar()`, `activity()`, `sidebar()`, `editor()`, `bottomPanel()`, `rightPanel()`, `statusbar()`):
 *  the panels the layout shows, at the mockup's sizes. The right panel hides when the editing area would drop under its minimum. */
export function IdeFrame(p: IdeFrameProps): JSX.Element {
  const { t } = useI18n();
  const width = useSyncExternalStore(onResize, windowWidth, windowWidth);
  const { layout, onLayout } = p;
  const right = rightShown(layout, width);
  const columns = { '--ide-side': layout.sideOpen ? `${layout.sideWidth}px` : '0px', '--ide-right': right ? `${RIGHT_WIDTH}px` : '0px' } as CSSProperties;
  return (
    <div className={`ide${p.dragging ? ' is-dragging' : ''}`} data-readonly={p.readOnly ? 'true' : undefined}>
      <IdeTitleBar layout={layout} onLayout={onLayout} onSearch={p.onSearch} blocked={p.blocked} rightShown={right} />
      <div className="ide-body" style={columns} inert={p.blocked}>
        <ActivityBar layout={layout} onLayout={onLayout} onTab={p.onTab} activeTab={p.activeTab} badge={p.badge} />
        {layout.sideOpen && <IdeExplorer width={layout.sideWidth} onLayout={onLayout}>{p.explorer}</IdeExplorer>}
        <section className="ide-editor" aria-label={t.ide.editorLabel}>
          {p.notice}
          <div className="ide-dock-area">{p.editor}</div>
          {layout.bottom && <BottomPanel onLayout={onLayout} />}
        </section>
        {right && <div className="ide-right">{p.chat}</div>}
      </div>
      <div className="ide-status-row" inert={p.blocked}>
        <IdeStatusBar footer={p.footer} usage={p.usage} waiting={p.waiting} onNextWaiting={p.onNextWaiting} />
      </div>
    </div>
  );
}
