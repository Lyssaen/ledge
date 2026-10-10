import type { BotState } from '../bots/poseFor';
import { transition } from '../motion';
export const BADGE: Record<BotState, { bg: string; fg: string; word: string; pulse?: boolean }> = {
  approval: { bg: 'var(--status-danger-soft)', fg: 'var(--danger-text)', word: 'Approval' },
  question: { bg: 'var(--status-warning-soft)', fg: 'var(--warning)', word: 'Question' },
  starting: { bg: 'var(--status-info-soft)', fg: 'var(--info)', word: 'Starting' },
  idle: { bg: 'var(--status-success-soft)', fg: 'var(--success)', word: 'Available' },
  working: { bg: 'var(--status-info-soft)', fg: 'var(--info)', word: 'Running' },
  done: { bg: 'var(--status-success-soft)', fg: 'var(--success)', word: 'Done' },
  error: { bg: 'var(--status-danger-soft)', fg: 'var(--danger-text)', word: 'Error' },
  readonly: { bg: 'transparent', fg: 'var(--muted-foreground)', word: 'Read only' }
};
export function Badge({ state, label }: { state: BotState; label?: string }) {
  const b = BADGE[state];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 20, padding: '0 8px', borderRadius: 9999, background: b.bg, color: b.fg, border: state === 'readonly' ? '1px solid var(--border)' : '1px solid transparent', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', transition: transition([['background-color', 'hover'], ['color', 'hover']]) }}>
      <span style={{ width: 8, height: 8, borderRadius: 9999, background: 'currentColor', animation: b.pulse ? 'ledge-blink 1.2s ease-in-out infinite' : undefined }} />
      {label ?? b.word}
    </span>
  );
}
