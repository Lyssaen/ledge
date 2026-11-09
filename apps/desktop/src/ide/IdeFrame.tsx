import { useSyncExternalStore, type CSSProperties, type JSX, type ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { RIGHT_WIDTH, rightShown, type IdeLayout, type LayoutAction } from '../workspace/layout';
import type { Tab } from '../workspace/model';
import { ActivityBar } from './ActivityBar';
import { BottomEdge } from './BottomEdge';
import { IdeExplorer } from './IdeExplorer';
import { IdeStatusBar } from './IdeStatusBar';
import { IdeTitleBar } from './IdeTitleBar';
import '../styles/ide.css';

// The chunk's other entries: the editing area and the bottom panel, drawn inside the frame (ide/lazy.tsx).
export { DockHost } from './DockHost';
export { BottomPanel } from './BottomPanel';
export { OutputView } from './OutputView';
export { AtelierBar } from './AtelierBar';
export { RigsView } from './rigs/RigsView';
export { RigView } from './rig/RigView';
export { RigLaunchModal } from './launch-rig/RigLaunchModal';
export { OpenRigView } from './openrig/OpenRigView';
export { PrsView } from '../forge/PrsView';
export { PrPage } from '../forge/PrPage';
export { PrsStatus } from '../forge/PrsStatus';
export { PrTabLabel } from '../forge/PrTabLabel';

export interface IdeFrameProps {
  layout: IdeLayout; onLayout(a: LayoutAction): void;
  /** The sidebar's view (Sidebar with `section`), the editing area (DockHost), the right panel's chat, the status bar's footer. */
  explorer: ReactNode; editor: ReactNode; chat: ReactNode; footer: ReactNode;
  /** The bottom panel (BottomPanel), under the editing area while the layout shows it. */
  bottom: ReactNode;
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
  /** Lot 8b: the activity bar's badge (open requests whose pipeline failed) and the status bar's count. */
  prsFailing?: number; prsStatus?: ReactNode;
}

const onResize = (cb: () => void) => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb); };
const windowWidth = () => window.innerWidth;

/** The IDE shell (mockup `titlebar()`, `activity()`, `sidebar()`, `editor()`, `bottomPanel()`, `rightPanel()`, `statusbar()`):
 *  the panels the layout shows, at the mockup's sizes. The right panel hides when the editing area would drop under its minimum. */
export function IdeFrame(p: IdeFrameProps): JSX.Element {
  const { t } = useI18n();
  const width = useSyncExternalStore(onResize, windowWidth, windowWidth);
  const { layout, onLayout } = p;
  const right = rightShown(layout, width);
  const columns = {
    '--ide-side': layout.sideOpen ? `${layout.sideWidth}px` : '0px',
    '--ide-right': right ? `${RIGHT_WIDTH}px` : '0px',
    '--ide-bottom': `${layout.bottomHeight}px`
  } as CSSProperties;
  return (
    <div className={`ide${p.dragging ? ' is-dragging' : ''}`} data-readonly={p.readOnly ? 'true' : undefined}>
      <IdeTitleBar layout={layout} onLayout={onLayout} onSearch={p.onSearch} blocked={p.blocked} rightShown={right} />
      <div className="ide-body" style={columns} inert={p.blocked}>
        <ActivityBar layout={layout} onLayout={onLayout} onTab={p.onTab} activeTab={p.activeTab} badge={p.badge} prsFailing={p.prsFailing} />
        {layout.sideOpen && <IdeExplorer width={layout.sideWidth} onLayout={onLayout}>{p.explorer}</IdeExplorer>}
        <section className="ide-editor" aria-label={t.ide.editorLabel}>
          {p.notice}
          <div className="ide-dock-area">{p.editor}</div>
          {layout.bottom && <div className="ide-bottom-host"><BottomEdge onLayout={onLayout} />{p.bottom}</div>}
        </section>
        {right && <div className="ide-right">{p.chat}</div>}
      </div>
      <div className="ide-status-row" inert={p.blocked}>
        <IdeStatusBar footer={p.footer} usage={p.usage} waiting={p.waiting} onNextWaiting={p.onNextWaiting} prs={p.prsStatus} />
      </div>
    </div>
  );
}
