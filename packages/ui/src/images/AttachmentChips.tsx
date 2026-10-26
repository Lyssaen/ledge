import { Icon, ICONS } from '../ui/icons';
import { formatBytes } from './encode';

export interface ChipItem { key: string; url: string; width: number; height: number; bytes: number; state: 'uploading' | 'ready' | 'refused'; reason?: string }

/** The images waiting under the composer: a thumbnail with its size and a ✕; a spinner while the image uploads, the reason once refused.
 *  A refused chip's reason is also shown under the field by the caller. */
export function AttachmentChips({ items, onRemove, size, removeLabel, lang }: { items: ChipItem[]; onRemove(key: string): void; size: { w: number; h: number }; removeLabel: string; lang: 'fr' | 'en' }) {
  if (items.length === 0) return null;
  return (
    <div data-attachment-chips style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map(it => (
        <div key={it.key} data-chip={it.state} title={it.reason} style={{ position: 'relative', width: size.w, height: size.h, flexShrink: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: `1px solid ${it.state === 'refused' ? 'var(--danger-text)' : 'var(--border)'}`, background: 'var(--well)' }}>
          <img src={it.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: it.state === 'ready' ? 1 : 0.45 }} />
          {it.state === 'uploading' && (
            <span role="status" aria-label="…" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ color: 'var(--foreground)' }}>
                <path d="M12 3a9 9 0 1 1-9 9" opacity="0.9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" /></path>
              </svg>
            </span>
          )}
          {it.state === 'refused' && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '2px 4px', fontSize: 10, lineHeight: 1.2, color: 'var(--danger-text)', background: 'var(--status-danger-soft)' }}>{it.reason}</span>}
          {it.state !== 'refused' && <span style={{ position: 'absolute', left: 4, bottom: 4, padding: '1px 5px', borderRadius: 4, fontSize: 10, lineHeight: 1.3, color: '#fff', background: 'rgba(0,0,0,0.6)' }}>{formatBytes(it.bytes, lang)}</span>}
          <button type="button" aria-label={removeLabel} title={removeLabel} onClick={() => onRemove(it.key)} style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: 'none', cursor: 'pointer', color: '#fff', background: 'rgba(0,0,0,0.6)' }}>
            <Icon {...ICONS.close} size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
