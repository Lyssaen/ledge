import { useRef, type JSX } from 'react';
import type { MediaAction, NowPlaying } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { transition } from '../motion';
import { MUSIC } from './geometry';

const LEAVE_MS = 250;

export interface MusicSlotProps {
  now: NowPlaying;
  hover: 'controls' | 'controls-title';
  open: boolean;
  onOpen(): void;
  onClose(): void;
  onControl(a: MediaAction): void;
  reducedMotion?: boolean;
  /** The notch already draws the rule. Set when the slot is shown on its own. */
  rule?: boolean;
}

/** The cover and, while open, previous / play-pause / next. */
export function MusicSlot(p: MusicSlotProps): JSX.Element {
  const { t } = useI18n();
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => { clearTimeout(leave.current); };
  const arm = () => { cancel(); leave.current = setTimeout(() => p.onClose(), LEAVE_MS); };
  const ask = () => { cancel(); p.onOpen(); };
  const withTitle = p.open && p.hover === 'controls-title';
  const label = t.music.cover(p.now.title, p.now.artist);
  return (
    <span data-music-slot data-open={p.open || undefined} onMouseLeave={arm} onMouseEnter={cancel}
      onFocus={ask} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) arm(); }}
      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, transition: transition([['width', 'hover']]) }}>
      {p.rule !== false && <span data-music-rule aria-hidden="true" style={{ display: 'block', width: 1, height: 16, marginRight: MUSIC.sepGap, background: 'var(--sidebar-border)' }} />}
      <button type="button" data-music-cover title={label} aria-label={label} onMouseEnter={ask} onFocus={ask}
        style={{ position: 'relative', flexShrink: 0, width: MUSIC.cover, height: MUSIC.cover, padding: 0, border: 0, borderRadius: MUSIC.coverRadius, overflow: 'hidden', cursor: 'pointer', backgroundColor: 'var(--sidebar-accent)', backgroundImage: p.now.cover ? `url("${p.now.cover}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', filter: p.now.playing ? undefined : 'grayscale(1)', opacity: p.now.playing ? 1 : 0.72 }}
        data-paused={p.now.playing ? undefined : ''}>
        {!p.now.cover && <svg data-music-note aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block', margin: 'auto', color: 'var(--sidebar-foreground)' }}><path d="M9 18V6l10-2v12" /><circle cx="7" cy="18" r="2.2" /><circle cx="17" cy="16" r="2.2" /></svg>}
        {p.now.playing && !p.open && <span data-eq aria-hidden="true" style={{ position: 'absolute', right: 2, bottom: 2, display: 'flex', alignItems: 'flex-end', gap: 1, height: 8 }}>
          {[0, 1, 2].map(i => <span key={i} style={{ width: 2, height: 4 + i * 2, background: 'var(--sidebar-primary)', transformOrigin: 'bottom', animation: p.reducedMotion ? undefined : `ledge-pulse 0.8s ease-in-out ${i * 0.12}s infinite` }} />)}
        </span>}
        {!p.now.playing && <span data-pause-mark aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="2.2" height="7" rx="0.4" fill="white" /><rect x="6.3" y="1.5" width="2.2" height="7" rx="0.4" fill="white" /></svg>
        </span>}
      </button>
      {withTitle && <span data-music-title style={{ display: 'flex', flexDirection: 'column', width: MUSIC.title, marginLeft: MUSIC.coverGap, minWidth: 0 }}>
        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, lineHeight: '14px' }}>{p.now.title}</strong>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, lineHeight: '13px', color: 'var(--muted-foreground)' }}>{p.now.artist}</span>
      </span>}
      {p.open && <span data-music-controls style={{ display: 'inline-flex', alignItems: 'center', marginLeft: MUSIC.coverGap }}>
        <Ctl label={t.music.prev} disabled={!p.now.canPrev} onClick={() => p.onControl('prev')}>⏮</Ctl>
        <Ctl label={p.now.playing ? t.music.pause : t.music.play} onClick={() => p.onControl('toggle')}>{p.now.playing ? '⏸' : '▶'}</Ctl>
        <Ctl label={t.music.next} disabled={!p.now.canNext} onClick={() => p.onControl('next')}>⏭</Ctl>
      </span>}
    </span>
  );
}

function Ctl({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick(): void; children: string }): JSX.Element {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
    style={{ width: MUSIC.ctl, height: MUSIC.ctl, padding: 0, border: 0, borderRadius: 999, background: 'transparent', color: 'inherit', cursor: disabled ? 'default' : 'pointer', fontSize: 14 }}>{children}</button>;
}
