import { Kbd } from '../ui/Kbd';
import { Button } from '../ui/Button';
import { transition } from '../motion';
import { useI18n } from '../i18n/lang';

const KEY = 'ledge.coachmarks';
export const COACHMARK_OPENS = 3;
/** Fixed card height, so the surface can place it under the panel without a layout pass. */
export const COACHMARK_H = 128;
/** Counts a keyboard open; true while it is one of the first three. Storage failures show nothing and count nothing. */
export function countCoachmarkOpen(): boolean {
  try {
    const n = Number(localStorage.getItem(KEY) ?? '0') || 0;
    if (n >= COACHMARK_OPENS) return false;
    localStorage.setItem(KEY, String(n + 1));
    return true;
  } catch { return false; }
}

export function Coachmark({ visible, top, left = 44, onDismiss }: { visible: boolean; top: number; left?: number; onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <div role="dialog" aria-label={t.coach.label} aria-hidden={!visible || undefined} inert={!visible} data-coachmark style={{ position: 'absolute', left, top, width: 300, height: COACHMARK_H, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8, padding: '12px 14px', background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--input)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-overlay)', opacity: visible ? 1 : 0, transform: `translateY(${visible ? 0 : -6}px)`, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut'], ['transform', 'grow', visible ? 140 : 0]]) }}>
      {/* Title and button share the first row; the caption gets a row of its own, so nothing wraps into the button. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, flexGrow: 1, minWidth: 0 }}>{t.coach.title}</span>
        <Button variant="secondary" size="sm" onClick={onDismiss} style={{ flexShrink: 0, whiteSpace: 'nowrap', height: 28, padding: '0 10px' }}>{t.coach.ok}</Button>
      </div>
      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
        <span><Kbd>J</Kbd> <Kbd>K</Kbd> {t.coach.upDown}</span><span><Kbd>Alt ←</Kbd> <Kbd>Alt →</Kbd> {t.coach.prevNext}</span><span><Kbd>Y</Kbd> <Kbd>N</Kbd> {t.coach.decide}</span><span><Kbd>{t.coach.esc}</Kbd> {t.coach.close}</span>
      </span>
      <span style={{ fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.coach.note}</span>
    </div>
  );
}
