import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, ICONS } from '../ui/icons';

/** A full-window view of one of a message's images. Esc or ✕ closes, ←/→ move within `images`; focus goes in and returns to what had it. */
export function Lightbox({ images, index, onIndex, onClose, title, actions, closeLabel }: { images: Array<{ url: string | null; meta: string }>; index: number; onIndex(i: number): void; onClose(): void; title: string; actions?: ReactNode; closeLabel: string }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  // Latest props for the one key listener, which must not re-run (and re-steal focus) on every render.
  const live = useRef({ index, count: images.length, onIndex, onClose });
  live.current = { index, count: images.length, onIndex, onClose };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const { index: i, count, onIndex: go, onClose: close } = live.current;
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' && i < count - 1) go(i + 1);
      else if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); opener?.focus?.(); };
  }, []);
  const current = images[index];
  const nav = (to: number, d: readonly string[], side: 'left' | 'right') => to >= 0 && to < images.length && (
    <button type="button" aria-hidden tabIndex={-1} onClick={() => onIndex(to)} style={{ position: 'absolute', top: '50%', [side]: 16, transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: 18, border: 'none', cursor: 'pointer', color: '#fff', background: 'rgba(255,255,255,0.15)' }}><Icon d={d} size={20} /></button>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-lightbox style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.85)', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', fontSize: 13 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          {current && <div style={{ opacity: 0.7, fontSize: 12 }}>{current.meta}{images.length > 1 ? ` · ${index + 1}/${images.length}` : ''}</div>}
        </div>
        {actions}
        <button ref={closeBtn} type="button" aria-label={closeLabel} title={closeLabel} onClick={onClose} style={{ width: 32, height: 32, borderRadius: 16, border: 'none', cursor: 'pointer', color: '#fff', background: 'rgba(255,255,255,0.15)' }}><Icon {...ICONS.close} /></button>
      </div>
      <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        {current?.url && <img src={current.url} alt={title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }} />}
        {nav(index - 1, ICONS.chevronLeft.d, 'left')}
        {nav(index + 1, ICONS.chevronRight.d, 'right')}
      </div>
    </div>
  );
}
