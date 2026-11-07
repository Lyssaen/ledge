import { useRef } from 'react';
import { useI18n } from '../i18n/lang';
import type { LayoutAction } from '../workspace/layout';

/** The bottom panel's top edge (the sidebar's `.ide-resize`, turned): drag sets the height, a double click restores 240 px. */
export function BottomEdge(p: { onLayout(a: LayoutAction): void }) {
  const { t } = useI18n();
  const latest = useRef(p.onLayout);
  latest.current = p.onLayout;
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const editor = (e.currentTarget as HTMLElement).closest('.ide-editor');
    const heightAt = (y: number) => (editor?.getBoundingClientRect().bottom ?? 0) - y;
    const move = (m: MouseEvent) => latest.current({ type: 'dragBottom', height: heightAt(m.clientY) });
    const up = (m: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('ide-resizing-y');
      latest.current({ type: 'dragBottom', height: heightAt(m.clientY) });
    };
    document.body.classList.add('ide-resizing-y');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return <div className="ide-bottom-resize" title={t.ide.resizeBottom} onMouseDown={start} onDoubleClick={() => p.onLayout({ type: 'resetBottom' })} />;
}
