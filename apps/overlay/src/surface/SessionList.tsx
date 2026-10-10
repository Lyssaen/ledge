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

const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
export function rowHint(s: Session): string {
  if (s.pending) return s.pending.text;
  if (s.source === 'hook_only') return 'started without ledge';
  if (s.state === 'exited') return `exited ${s.exitCode ?? '?'}`;
  if (s.state === 'error') return s.lastError ?? 'error';
  if (s.state === 'idle') return 'available';
  return 'running';
}
const Icon = ({ d }: { d: string[] }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d.map((p, i) => <path key={i} d={p} />)}</svg>;
const BELL_OFF = ['M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5', 'M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7', 'M10.3 21a1.94 1.94 0 0 0 3.4 0', 'm2 2 20 20'];
const SLIDERS = ['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3', 'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4'];
const CHEVRON_LEFT = ['m15 18-6-6 6-6'];

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
  const waiting = sessions.filter(isPending).length;
  const oldestAsk = sessions.find(isPending)?.id ?? null;
  return (
    <div data-layer="list" inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 120 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 56, boxSizing: 'border-box', padding: '0 8px 0 16px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: 16, lineHeight: '20px', fontWeight: 600, letterSpacing: '-0.01em' }}>Ledge</span>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{sessions.length} bots · {waiting ? `${waiting} waiting for you` : 'nothing waiting'}</span>
        </div>
        <Button variant="ghost" size="icon" aria-label="Do not disturb" aria-pressed={dnd} onClick={onToggleDnd} style={{ color: dnd ? 'var(--sidebar-primary)' : undefined }}><Icon d={BELL_OFF} /></Button>
        <Button variant="ghost" size="icon" aria-label="Settings" onClick={onSettings}><Icon d={SLIDERS} /></Button>
        <Button variant="ghost" size="icon" aria-label="Collapse" onClick={onClose}><Icon d={CHEVRON_LEFT} /></Button>
      </div>
      <div data-scroll style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
        {sessions.map((s, i) => {
          const hi = s.id === oldestAsk; const delay = 150 + i * 24;
          const focused = focusedId === s.id; const actions = focused && isYesNo(s);
          const bg = hi ? 'var(--secondary)' : selectedId === s.id ? 'var(--sidebar-accent)' : 'transparent';
          return (
            <div key={s.id} data-row-id={s.id} style={{ flexShrink: 0, height: actions ? EXPANDED_ROW_H : SIZES.rowH, boxSizing: 'border-box', overflow: 'hidden', backgroundColor: bg, outline: focused ? '2px solid var(--ring)' : 'none', outlineOffset: -2, transition: transition([['height', 'grow', 0], ['background-color', 'hover']]) }}>
            <button type="button" data-row aria-label={`${s.project}, ${s.name}, open`} aria-current={selectedId === s.id ? 'true' : undefined} data-delay={delay} onClick={() => onOpen(s.id)} onMouseEnter={() => onHoverRow?.(s.id)} onMouseLeave={() => onHoverRow?.(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, height: SIZES.rowH, boxSizing: 'border-box', padding: `0 16px 0 ${numbered ? 10 : 14}px`, border: 'none', borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: hi ? 'var(--sidebar-primary)' : 'transparent', backgroundColor: bg, textAlign: 'left', color: 'var(--sidebar-foreground)', cursor: 'pointer', width: '100%', opacity: visible ? 1 : 0, transform: `translateX(${visible ? 0 : -10}px)`,
                transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? delay : 0], ['transform', visible ? 'grow' : 'fadeOut', visible ? delay : 0], ['background-color', 'hover'], ['border-color', 'hover']]) }}>
              {numbered && i < 9 && <Kbd accent={hi}>{i + 1}</Kbd>}
              <Bot seed={s.id} readOnly={s.source === 'hook_only'} tool={s.tool} state={botState(s)} pose={poseFor(s.id, s.state)} size={32} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, lineHeight: '18px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.project}</span>
                <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name} · {toolName(s.tool)} · {relativeTime(s.startedAt, now)} · {rowHint(s)}</span>
              </span>
              <Badge state={botState(s)} />
            </button>
            {actions && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: EXPANDED_ROW_H - SIZES.rowH, boxSizing: 'border-box', padding: `0 16px 4px ${numbered ? 40 : 58}px` }}>
                <Button variant="primary" size="sm" disabled={!canDecide(s)} onClick={() => onDecide?.(s.id, 'accept')} style={{ height: 28, padding: '0 8px' }}>Approve <Kbd accent>Y</Kbd></Button>
                <Button variant="outline" size="sm" disabled={!canDecide(s)} onClick={() => onDecide?.(s.id, 'deny')} style={{ height: 28, padding: '0 8px' }}>Deny <Kbd>N</Kbd></Button>
                <Button variant="ghost" size="sm" onClick={() => onOpen(s.id)} style={{ height: 28, padding: '0 8px' }}>Open <Kbd>↵</Kbd></Button>
              </div>
            )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 48, boxSizing: 'border-box', padding: '0 16px', borderTop: '1px solid var(--sidebar-border)' }}>
        <label className="dnd-switch" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted-foreground)', cursor: 'pointer' }}>
          <input type="checkbox" checked={dnd} onChange={onToggleDnd} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
          <span className="dnd-track" style={{ display: 'inline-block', width: 32, height: 18, borderRadius: 9999, background: dnd ? 'var(--sidebar-primary)' : 'var(--muted)', border: '1px solid var(--input)', boxSizing: 'border-box', position: 'relative', transition: transition([['background-color', 'hover']]) }}>
            <span style={{ position: 'absolute', left: dnd ? 16 : 2, top: 2, width: 12, height: 12, borderRadius: 9999, background: dnd ? 'var(--primary-foreground)' : 'var(--muted-foreground)', transition: transition([['left', 'hover']]) }} />
          </span>
          Do not disturb
        </label>
        <span style={{ flexGrow: 1 }} />
        <Kbd>Ctrl+Alt+L</Kbd>
        <Button variant="ghost" size="sm" aria-label="Keyboard shortcuts" onClick={onHelp} style={{ height: 28, padding: '0 8px' }}><Kbd>?</Kbd></Button>
      </div>
    </div>
  );
}
