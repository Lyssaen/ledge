import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clampPanel, panelBounds, stepPanel, type Bounds } from '../state/panel';
import { useI18n } from '../i18n/lang';

interface Drag { id: number; startX: number; startPct: number; width: number; el: HTMLElement }

/** The handle between sessions and conversation (mockup split-view.js): pointer with capture, ← → ±2 points, Home / End. */
export function Resizer({ value, bounds, bodyWidth, onChange }: { value: number; bounds: Bounds; bodyWidth: number; onChange: (pct: number) => void }) {
  const { t } = useI18n();
  const drag = useRef<Drag | null>(null);
  const finish = useCallback(() => {
    const d = drag.current; if (!d) return;
    drag.current = null;
    document.documentElement.classList.remove('resizing-conversation');
    if (d.el.hasPointerCapture?.(d.id)) d.el.releasePointerCapture(d.id);
  }, []);
  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => { window.removeEventListener('blur', finish); finish(); };
  }, [finish]);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current || bodyWidth <= 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { id: e.pointerId, startX: e.clientX, startPct: value, width: bodyWidth, el: e.currentTarget };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.documentElement.classList.add('resizing-conversation');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || e.pointerId !== d.id) return;
    onChange(clampPanel(d.startPct + ((d.startX - e.clientX) / d.width) * 100, panelBounds(d.width)));
  };
  const onEnd = (e: PointerEvent<HTMLDivElement>) => { if (drag.current && e.pointerId === drag.current.id) finish(); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepPanel(value, e.key, bounds); if (next === null) return;
    e.preventDefault(); onChange(next);
  };
  const now = Math.round(value);
  return (
    <div className="conversation-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t.conversation.panel.label}
      aria-controls="conversation-pane" aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={now}
      aria-valuetext={t.conversation.panel.valueText(now)} title={t.conversation.panel.title}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onEnd} onPointerCancel={onEnd} onLostPointerCapture={onEnd} onKeyDown={onKeyDown}>
      <span aria-hidden="true" />
    </div>
  );
}
