import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { ResidentMascot } from '../bots/ResidentMascot';
import { botState, liveHelpers, poseFor } from '../bots/poseFor';
import { Badge } from '../ui/Badge';
import { BranchChip } from '../ui/BranchChip';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { relativeTime, toolName } from '../format';
import { transition } from '../motion';
import { SIZES } from './geometry';
import { groupSessions, tildePath } from './groups';
import { isYesNo } from '../keyboard/useKeyboard';
import { Icon, ICONS } from '../ui/icons';
import { messagesFor, useI18n, type Messages } from '../i18n/lang';

/** A finished or read-only session can leave the list (`session.dismiss`); a live launcher session cannot. */
export const canDismiss = (s: Session) => s.state === 'exited' || s.source === 'hook_only';
const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
/** The context of a session in one phrase (the handle's tooltip): the pending text, or what the bot is doing. */
export function rowHint(s: Session, t: Messages = messagesFor()): string {
  if (s.pending) return s.pending.text;
  if (s.source === 'hook_only') return t.hint.startedWithoutLedge;
  if (s.state === 'exited') return t.hint.exited(String(s.exitCode ?? '?'));
  if (s.state === 'error') return s.lastError ?? t.hint.error;
  if (s.state === 'idle') { const n = liveHelpers(s).length; return n ? t.hint.helpersRunning(n) : t.hint.available; }
  return t.hint.running;
}

/** Height of a repository header in the list. */
export const GROUP_H = SIZES.groupH;

/** Height of a focused row carrying the inline Approve / Deny / Open actions. */
export const EXPANDED_ROW_H = 100;

/** A line shown under the header for a few seconds (a session the overlay just started), with an optional action. */
export interface ListNotice { text: string; action?: { label: string; onClick: () => void } }

export interface ListProps {
  sessions: Session[]; visible: boolean; numbered: boolean; selectedId: string | null; focusedId?: string | null; dnd: boolean;
  /** When the layer's fade-in starts, in ms (see `enterDelay` in motion); the rows cascade from there. */
  enterDelay?: number;
  onToggleDnd: () => void; onOpen: (id: string) => void; onDecide?: (id: string, d: 'accept' | 'deny') => void; onClose: () => void;
  onSettings?: () => void; onHelp?: () => void; onHoverRow?: (id: string | null) => void;
  /** Opens the "New session" form (the header's + and the empty state's button). */
  onLaunch?: () => void; notice?: ListNotice | null;
  /** Whether a session's decisions may be sent now (reachable daemon, not read-only, nothing in flight). */
  canDecide?: (s: Session) => boolean;
  /** Removes an eligible row (see canDismiss); `offline` disables the button like every other send. */
  onDismiss?: (id: string) => void; offline?: boolean;
  theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean; now?: number;
}

export function SessionList({ sessions, visible, numbered, selectedId, focusedId = null, dnd, onToggleDnd, onOpen, onDecide, onClose, onSettings, onHelp, onHoverRow, onLaunch, notice = null, canDecide = () => true, onDismiss, offline = false, theme = 'dark', frozen = false, reducedMotion, now = Date.now(), enterDelay = 120 }: ListProps) {
  const { t } = useI18n();
  const waiting = sessions.filter(isPending).length;
  const oldestAsk = sessions.find(isPending)?.id ?? null;
  /** A plain function, not a component: rows keep their identity across renders (enter cascade, focus). */
  const renderRow = (s: Session, i: number) => {
  const hi = s.id === oldestAsk; const delay = enterDelay + 30 + i * 24;
          const focused = focusedId === s.id; const actions = focused && isYesNo(s);
          const bg = hi ? 'var(--secondary)' : selectedId === s.id ? 'var(--sidebar-accent)' : 'transparent';
          const st = botState(s); const readOnly = s.source === 'hook_only';
          return (
            <div key={s.id} data-row-id={s.id} className="ledge-row" style={{ position: 'relative', flexShrink: 0, height: actions ? EXPANDED_ROW_H : SIZES.rowH, boxSizing: 'border-box', overflow: 'hidden', backgroundColor: bg, outline: focused ? '2px solid var(--ring)' : 'none', outlineOffset: -2, transition: transition([['height', 'grow', 0], ['background-color', 'hover']]) }}>
            <button type="button" data-row aria-label={t.list.row(s.project, s.name)} title={t.list.rowTitle(toolName(s.tool), s.cwd)} aria-current={selectedId === s.id ? 'true' : undefined} data-delay={delay} onClick={() => onOpen(s.id)} onMouseEnter={() => onHoverRow?.(s.id)} onMouseLeave={() => onHoverRow?.(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, height: SIZES.rowH, boxSizing: 'border-box', padding: `0 17px 0 ${numbered ? 8 : 15}px`, border: 'none', borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: hi ? 'var(--sidebar-primary)' : 'transparent', backgroundColor: bg, textAlign: 'left', color: 'var(--sidebar-foreground)', cursor: 'pointer', width: '100%', opacity: visible ? 1 : 0, transform: `translateX(${visible ? 0 : -10}px)`,
                transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? delay : 0], ['transform', visible ? 'grow' : 'fadeOut', visible ? delay : 0], ['background-color', 'hover'], ['border-color', 'hover']]) }}>
              {numbered && i < 9 && <Kbd accent={hi}>{i + 1}</Kbd>}
              <Bot seed={s.id} readOnly={readOnly} tool={s.tool} state={st} pose={poseFor(s.id, s.state)} size={32} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}>
                <span data-topic style={{ fontSize: 14, lineHeight: '18px', fontWeight: s.topic ? 600 : 500, color: s.topic ? undefined : 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.topic ?? t.list.noTopic}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
                  <span style={{ flexShrink: 0 }}>{s.name}</span>
                  {s.branch && <><span aria-hidden="true">·</span><BranchChip session={s} /></>}
                  <span aria-hidden="true">·</span><span style={{ flexShrink: 0 }}>{relativeTime(s.startedAt, now, t)}</span>
                  <span style={{ flexGrow: 1 }} />
                  {readOnly ? <Badge state="readonly" tone={st} /> : <Badge state={st} />}
                </span>
              </span>
            </button>
            {onDismiss && canDismiss(s) && (
              // A sibling of the row button, not inside it: a click removes the row and does not open it.
              <Button variant="secondary" size="icon" data-dismiss className="ledge-row-dismiss" aria-label={t.list.dismissRow(s.project, s.name)} title={t.list.dismiss} disabled={offline}
                onClick={() => onDismiss(s.id)} style={{ position: 'absolute', right: 12, top: (SIZES.rowH - 28) / 2, width: 28, height: 28, padding: 0, color: 'var(--sidebar-foreground)' }}><Icon size={14} {...ICONS.listRemove} /></Button>
            )}
            {actions && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: EXPANDED_ROW_H - SIZES.rowH, boxSizing: 'border-box', padding: `0 17px 4px ${numbered ? 40 : 59}px` }}>
                <Button variant="primary" size="sm" disabled={!canDecide(s)} onClick={() => onDecide?.(s.id, 'accept')} style={{ height: 28, padding: '0 8px' }}>{t.list.approve} <Kbd accent>Y</Kbd></Button>
                <Button variant="outline" size="sm" disabled={!canDecide(s)} onClick={() => onDecide?.(s.id, 'deny')} style={{ height: 28, padding: '0 8px' }}>{t.list.deny} <Kbd>N</Kbd></Button>
                <Button variant="ghost" size="sm" onClick={() => onOpen(s.id)} style={{ height: 28, padding: '0 8px' }}>{t.list.openRow} <Kbd>↵</Kbd></Button>
              </div>
            )}
            </div>
          );
  };
  return (
    <div data-layer="list" data-delay={enterDelay} inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: SIZES.headerH, flexShrink: 0, boxSizing: 'border-box', padding: '4px 10px 0 17px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          <span data-brand style={{ fontSize: 18, lineHeight: '22px', fontWeight: 650, letterSpacing: '-0.02em' }}>Ledge<span style={{ color: 'var(--sidebar-primary)' }}>.</span></span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.list.summary(sessions.length, waiting)}</span>
        </div>
        {onLaunch && <Button variant="outline" size="icon" data-launch aria-label={t.list.newSession} title={t.list.newSession} onClick={onLaunch} style={{ width: 32, height: 32, color: 'var(--sidebar-foreground)' }}><Icon size={16} {...ICONS.plus} /></Button>}
        <Button variant="ghost" size="icon" aria-label={t.list.dnd} title={t.list.dnd} aria-pressed={dnd} onClick={onToggleDnd} style={{ color: dnd ? 'var(--sidebar-primary)' : 'var(--sidebar-foreground)' }}><Icon size={18} {...ICONS.dnd} /></Button>
        <Button variant="ghost" size="icon" aria-label={t.list.settings} title={t.list.settings} onClick={onSettings} style={{ color: 'var(--sidebar-foreground)' }}><Icon size={18} {...ICONS.gear} /></Button>
        <Button variant="ghost" size="icon" aria-label={t.list.collapse} title={t.list.collapse} onClick={onClose} style={{ color: 'var(--sidebar-foreground)' }}><Icon {...ICONS.chevronLeft} /></Button>
      </div>
      {notice && (
        <div role="status" data-notice style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 12px 0', padding: '8px 12px', boxSizing: 'border-box', borderRadius: 'var(--radius-lg)', background: 'var(--status-info-soft)', border: '1px solid color-mix(in srgb, var(--info) 25%, transparent)', fontSize: 13, lineHeight: '18px' }}>
          <span style={{ color: 'var(--info)', display: 'inline-flex', flexShrink: 0 }}><Icon size={16} {...ICONS.rocket} /></span>
          <span style={{ flexGrow: 1, minWidth: 0 }}>{notice.text}</span>
          {notice.action && <button type="button" onClick={notice.action.onClick} className="ledge-text-btn" style={{ border: 'none', background: 'transparent', padding: '2px 0', fontSize: 13, fontWeight: 500, color: 'var(--info)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{notice.action.label} ↗</button>}
        </div>
      )}
      <div data-scroll className="ledge-scroll" style={{ display: 'flex', flexDirection: 'column', padding: sessions.length ? '8px 0' : 0, flexGrow: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {sessions.length === 0 && (
          // The permanent Ledge resident also greets the empty list.
          <div data-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, height: SIZES.emptyH, boxSizing: 'border-box', padding: '18px 24px 16px', borderTop: '1px solid var(--sidebar-border)' }}>
            <span className="resident-halo-stage" data-dnd={String(dnd)} data-frozen={String(frozen)}>
              <ResidentMascot size={44} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} dnd={dnd} />
            </span>
            <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600, marginTop: 2 }}>{t.list.emptyTitle}</span>
            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', maxWidth: 300 }}>{t.list.emptyHint} <code className="mono" style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: 'var(--well)', border: '1px solid var(--border)', color: 'var(--sidebar-foreground)' }}>ledge claude</code> {t.list.emptyHintAfter}</span>
            {onLaunch && <Button variant="primary" size="sm" data-launch-empty onClick={onLaunch} style={{ marginTop: 8 }}><Icon size={14} {...ICONS.plus} />{t.list.newSession}</Button>}
          </div>
        )}
        {(() => { let i = -1; return groupSessions(sessions).map(g => (
          <div key={g.key} data-group-of={g.key} style={{ display: 'contents' }}>
            <div data-group style={{ display: 'flex', alignItems: 'baseline', gap: 8, height: GROUP_H, flexShrink: 0, boxSizing: 'border-box', padding: '10px 17px 0', fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', opacity: visible ? 1 : 0, transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay + 20 : 0]]) }}>
              <span style={{ fontWeight: 600, color: 'var(--sidebar-foreground)', flexShrink: 0 }}>{g.label}</span>
              <span className="mono" style={{ fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tildePath(g.path)}</span>
              <span style={{ flexGrow: 1 }} />
              <span style={{ flexShrink: 0 }}>{t.list.groupCount(g.sessions.length)}</span>
            </div>
            {g.sessions.map(s => { i++; return renderRow(s, i); })}
          </div>
        )); })()}
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
