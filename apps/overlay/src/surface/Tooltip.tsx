import type { Ref } from 'react';
import type { HandleBot } from './Handle';
import { transition } from '../motion';
import { useI18n } from '../i18n/lang';
export function Tooltip({ bot, y, ref }: { bot: HandleBot | null; y: number; ref?: Ref<HTMLDivElement> }) {
  const on = bot !== null;
  const { t } = useI18n();
  return (
    <div ref={ref} role="tooltip" aria-hidden={!on} style={{ position: 'absolute', left: 36, top: y, transform: `translateY(-50%) translateX(${on ? 0 : -6}px)`, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: '16px', boxShadow: 'var(--shadow-overlay)', opacity: on ? 1 : 0, pointerEvents: 'none', transition: transition([['opacity', 'hover', 60], ['transform', 'grow', 60], ['top', 'hover']]) }}>
      <span><span style={{ fontWeight: 500 }}>{bot?.name}</span> <span style={{ color: 'var(--muted-foreground)' }}>· {bot?.tip}</span></span>
      <span className="mono" style={{ fontSize: 10, padding: '1px 5px', border: '1px solid var(--input)', borderRadius: 4, color: 'var(--muted-foreground)' }}>{t.clickToOpen}</span>
    </div>
  );
}
