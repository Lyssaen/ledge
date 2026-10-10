import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { relativeTime, toolName } from '../format';
import { transition } from '../motion';
import { SIZES } from './geometry';
import { isYesNo } from '../keyboard/useKeyboard';
import { Icon, ICONS } from '../ui/icons';
import { messagesFor, useI18n, type Messages } from '../i18n/lang';

const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
/** The context of a session in one phrase (the handle's tooltip): the pending text, or what the bot is doing. */
export function rowHint(s: Session, t: Messages = messagesFor()): string {
  if (s.pending) return s.pending.text;
  if (s.source === 'hook_only') return t.hint.startedWithoutLedge;
  if (s.state === 'exited') return t.hint.exited(String(s.exitCode ?? '?'));
  if (s.state === 'error') return s.lastError ?? t.hint.error;
  if (s.state === 'idle') return t.hint.available;
  return t.hint.running;
}

/** Height of a focused row carrying the inline Approve / Deny / Open actions. */
export const EXPANDED_ROW_H = 100;

export interface ListProps {
  sessions: Session[]; visible: boolean; numbered: boolean; selectedId: string | null; focusedId?: string | null; dnd: boolean;
  onToggleDnd: () => void; onOpen: (id: string) => void; onDecide?: (id: string, d: 'accept' | 'deny') => void; onClose: () => void;
  onSettings?: () => void; onHelp?: () => void; onHoverRow?: (id: string | null) => void;
  /** Whether a session's decisions may be sent now (reachable daemon, not read-only, nothing in flight). */
  canDecide?: (s: Session) => boolean;
  theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean; now?: number;
}

export function SessionList({ sessions, visible, numbered, selectedId, focusedId = null, dnd, onToggleDnd, onOpen, onDecide, onClose, onSettings, onHelp, onHoverRow, canDecide = () => true, theme = 'dark', frozen = false, reducedMotion, now = Date.now() }: ListProps) {
  const { t } = useI18n();
  const waiting = sessions.filter(isPending).length;
  const oldestAsk = sessions.find(isPending)?.id ?? null;
  return (
    <div data-layer="list" inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 120 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: SIZES.headerH, flexShrink: 0, boxSizing: 'border-box', padding: '4px 10px 0 17px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          <span data-brand style={{ fontSize: 18, lineHeight: '22px', fontWeight: 650, letterSpacing: '-0.02em' }}>Ledge<span style={{ color: 'var(--sidebar-primary)' }}>.</span></span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.list.summary(sessions.length, waiting)}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label={t.list.dnd} title={t.list.dnd} aria-pressed={dnd} onClick={onToggleDnd} style={{ color: dnd ? 'var(--sidebar-primary)' : 'var(--sidebar-foreground)' }}><Icon size={18} {...ICONS.dnd} /></Button>
        <Button variant="ghost" size="icon" aria-label={t.list.settings} title={t.list.settings} onClick={onSettings} style={{ color: 'var(--sidebar-foreground)' }}><Icon size={18} {...ICONS.gear} /></Button>
        <Button variant="ghost" size="icon" aria-label={t.list.collapse} title={t.list.collapse} onClick={onClose} style={{ color: 'var(--sidebar-foreground)' }}><Icon {...ICONS.chevronLeft} /></Button>
      </div>
      <div data-scroll className="ledge-scroll" style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', flexGrow: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {sessions.map((s, i) => {
          const hi = s.id === oldestAsk; const delay = 150 + i * 24;
          const focused = focusedId === s.id; const actions = focused && isYesNo(s);
          const bg = hi ? 'var(--secondary)' : selectedId === s.id ? 'var(--sidebar-accent)' : 'transparent';
          const st = botState(s); const readOnly = s.source === 'hook_only';
          return (
            <div key={s.id} data-row-id={s.id} style={{ flexShrink: 0, height: actions ? EXPANDED_ROW_H : SIZES.rowH, boxSizing: 'border-box', overflow: 'hidden', backgroundColor: bg, outline: focused ? '2px solid var(--ring)' : 'none', outlineOffset: -2, transition: transition([['height', 'grow', 0], ['background-color', 'hover']]) }}>
            <button type="button" data-row aria-label={t.list.row(s.project, s.name)} aria-current={selectedId === s.id ? 'true' : undefined} data-delay={delay} onClick={() => onOpen(s.id)} onMouseEnter={() => onHoverRow?.(s.id)} onMouseLeave={() => onHoverRow?.(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, height: SIZES.rowH, boxSizing: 'border-box', padding: `0 17px 0 ${numbered ? 8 : 15}px`, border: 'none', borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: hi ? 'var(--sidebar-primary)' : 'transparent', backgroundColor: bg, textAlign: 'left', color: 'var(--sidebar-foreground)', cursor: 'pointer', width: '100%', opacity: visible ? 1 : 0, transform: `translateX(${visible ? 0 : -10}px)`,
                transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? delay : 0], ['transform', visible ? 'grow' : 'fadeOut', visible ? delay : 0], ['background-color', 'hover'], ['border-color', 'hover']]) }}>
              {numbered && i < 9 && <Kbd accent={hi}>{i + 1}</Kbd>}
              <Bot seed={s.id} readOnly={readOnly} tool={s.tool} state={st} pose={poseFor(s.id, s.state)} size={32} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.project}</span>
                <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name} · {toolName(s.tool)} · {relativeTime(s.startedAt, now, t)}</span>
              </span>
              {readOnly ? <Badge state="readonly" tone={st} /> : <Badge state={st} />}
            </button>
            {actions && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: EXPANDED_ROW_H - SIZES.rowH, boxSizing: 'border-box', padding: `0 17px 4px ${numbered ? 40 : 59}px` }}>
                <Button variant="primary" size="sm" disabled={!canDecide(s)} onClick={() => onDecide?.(s.id, 'accept')} style={{ height: 28, padding: '0 8px' }}>{t.list.approve} <Kbd accent>Y</Kbd></Button>
                <Button variant="outline" size="sm" disabled={!canDecide(s)} onClick={() => onDecide?.(s.id, 'deny')} style={{ height: 28, padding: '0 8px' }}>{t.list.deny} <Kbd>N</Kbd></Button>
                <Button variant="ghost" size="sm" onClick={() => onOpen(s.id)} style={{ height: 28, padding: '0 8px' }}>{t.list.openRow} <Kbd>↵</Kbd></Button>
              </div>
            )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: SIZES.footerH, flexShrink: 0, boxSizing: 'border-box', padding: '0 17px', borderTop: '1px solid var(--sidebar-border)' }}>
        <button type="button" data-dnd-footer aria-pressed={dnd} onClick={onToggleDnd} className="ledge-text-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 0', border: 'none', background: 'transparent', fontSize: 13, lineHeight: '18px', cursor: 'pointer', color: dnd ? 'var(--sidebar-primary)' : 'var(--muted-foreground)', transition: transition([['color', 'hover']]) }}>
          <Icon size={13} {...ICONS.dnd} />{t.list.dnd}
        </button>
        <span style={{ flexGrow: 1 }} />
        <Kbd>{t.shortcut}</Kbd>
        <Button variant="ghost" size="sm" aria-label={t.list.help} title={t.list.help} onClick={onHelp} style={{ height: 26, width: 26, padding: 0 }}><Kbd>?</Kbd></Button>
      </div>
    </div>
  );
}
