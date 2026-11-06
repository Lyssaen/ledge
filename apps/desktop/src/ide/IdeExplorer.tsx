import { useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/lang';
import type { LayoutAction } from '../workspace/layout';
import '../styles/ide.css';

/** The IDE's sidebar shell: the explorer's content, its resizable right edge (mockup `.resize`) and the « Réduire » foot. The reducer clamps the widths. */
export function IdeExplorer(p: { width: number; onLayout(a: LayoutAction): void; children: ReactNode }) {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const latest = useRef(p.onLayout);
  latest.current = p.onLayout;
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const widthAt = (x: number) => x - (root.current?.getBoundingClientRect().left ?? 0);
    const move = (m: MouseEvent) => latest.current({ type: 'drag', width: widthAt(m.clientX) });
    const up = (m: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('ide-resizing');
      latest.current({ type: 'drop', width: widthAt(m.clientX) });
    };
    document.body.classList.add('ide-resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <aside ref={root} className="ide-explorer" style={{ width: p.width }}>
      <div className="ide-explorer-body">{p.children}</div>
      <div className="ide-explorer-foot">
        <button type="button" title={t.ide.collapseTip} onClick={() => p.onLayout({ type: 'show', panel: 'side', on: false })}>{t.ide.collapse}</button>
      </div>
      <div className="ide-resize" title={t.ide.resizeEdge} onMouseDown={start} onDoubleClick={() => p.onLayout({ type: 'resetWidth' })} />
    </aside>
  );
}
