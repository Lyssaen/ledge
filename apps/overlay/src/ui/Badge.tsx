import type { BotState } from '@ledge/client';
import { transition } from '../motion';
import { useI18n } from '../i18n/lang';
/** Calm, static status labels: no badge pulses. `fg` is the state's colour (text, the handle tick); the badge's
 *  background is a 10 % tint of that same colour. */
export const BADGE: Record<BotState, { fg: string }> = {
  approval: { fg: 'var(--danger-text)' },
  question: { fg: 'var(--warning)' },
  starting: { fg: 'var(--info)' },
  idle: { fg: 'var(--success)' },
  working: { fg: 'var(--info)' },
  done: { fg: 'var(--muted-foreground)' },
  error: { fg: 'var(--danger-text)' },
  readonly: { fg: 'var(--muted-foreground)' }
};
/** A rounded rectangle, no dot: coloured text on a tint of the same colour. `tone` borrows another state's colour
 *  (a read-only session keeps the colour of what it is doing); `caps` is the eyebrow variant of the session view. */
export function Badge({ state, label, tone, caps = false }: { state: BotState; label?: string; tone?: BotState; caps?: boolean }) {
  const { t } = useI18n();
  const fg = BADGE[tone ?? state].fg;
  return (
    <span data-badge={state} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, height: caps ? 24 : 22, padding: caps ? '0 9px' : '0 8px', boxSizing: 'border-box', borderRadius: 5, color: fg, background: 'color-mix(in srgb, currentColor 10%, transparent)', fontSize: caps ? 11 : 12, lineHeight: 1, fontWeight: 500, letterSpacing: caps ? '0.08em' : undefined, textTransform: caps ? 'uppercase' : undefined, whiteSpace: 'nowrap', transition: transition([['background-color', 'hover'], ['color', 'hover']]) }}>
      {label ?? t.state[state]}
    </span>
  );
}
