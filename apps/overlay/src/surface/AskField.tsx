import { useState } from 'react';
import { ResidentMascot } from '../bots/ResidentMascot';
import { Kbd } from '../ui/Kbd';
import { useI18n } from '../i18n/lang';

/**
 * "Ask Ledge…" above the sessions, matching the notch's mascot above the bots: Enter on a non-empty question sends it and
 * clears the field (spec 2026-10-11 §5.5).
 * `onOpen` is the way in without asking: Enter on the empty field, or a click on the mascot, opens the day's conversation.
 */
export function AskField({ onAsk, onOpen, onTyping, disabled = false, theme = 'dark', reducedMotion }: { onAsk: (text: string) => void; onOpen?: () => void; onTyping?: (on: boolean) => void; disabled?: boolean; theme?: 'dark' | 'light'; reducedMotion?: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const submit = () => { const q = text.trim(); if (!q) return onOpen?.(); onAsk(q); setText(''); onTyping?.(false); };
  const mascot = <ResidentMascot size={18} theme={theme} reducedMotion={reducedMotion} paused={disabled} />;
  return (
    <div data-ask-field style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, margin: '10px 12px', padding: '0 10px', boxSizing: 'border-box', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', background: 'var(--well)', opacity: disabled ? 0.5 : 1 }}>
      {/* Out of the tab order: Enter on the empty field is the keyboard's way to the same place. */}
      {onOpen ? <button type="button" tabIndex={-1} aria-label={t.chat.open} title={t.chat.open} onClick={onOpen} style={{ display: 'inline-flex', border: 0, background: 'transparent', padding: 0, margin: 0, cursor: 'pointer' }}>{mascot}</button> : mascot}
      <input data-ask-input type="text" aria-label={t.chat.ask} placeholder={t.chat.askPlaceholder} value={text} disabled={disabled}
        onChange={e => { setText(e.target.value); onTyping?.(e.target.value.length > 0); }} onFocus={() => onTyping?.(true)} onBlur={() => onTyping?.(text.length > 0)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } }}
        style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'var(--sidebar-foreground)', fontSize: 13, outline: 'none' }} />
      <Kbd>/</Kbd>
    </div>
  );
}
