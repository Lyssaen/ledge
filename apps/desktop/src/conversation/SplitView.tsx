import { useRef, type CSSProperties, type ReactNode } from 'react';
import { clampPanel, panelBounds, type PanelState } from '../state/panel';
import { useNarrow, useWidth } from './layout';
import { Resizer } from './Resizer';

/** The view body: the sessions, the handle and the conversation side by side (spec §9.1), stacked under 760 px. */
export function SplitView({ panel, onPanel, list, pane }: { panel: PanelState; onPanel: (fn: (p: PanelState) => PanelState) => void; list: ReactNode; pane: ReactNode | null }) {
  const body = useRef<HTMLDivElement>(null);
  const width = useWidth(body);
  const narrow = useNarrow();
  const bounds = panelBounds(width);
  const pct = clampPanel(panel.width, bounds);
  const expanded = !!pane && panel.expanded;
  const style = pane ? ({ '--conversation-width': `${pct}%` } as CSSProperties) : undefined;
  return (
    <div ref={body} className={expanded ? 'view-body conversation-expanded' : 'view-body'} style={style}>
      {list}
      {pane && !narrow && !expanded && <Resizer value={pct} bounds={bounds} bodyWidth={width} onChange={w => onPanel(p => (p.width === w ? p : { ...p, width: w }))} />}
      {pane}
    </div>
  );
}
