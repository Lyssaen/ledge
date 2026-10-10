import { useEffect, useRef, useState, type Ref } from 'react';
import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Button } from '../ui/Button';
import { transition } from '../motion';
import { SIZES } from './geometry';

export const BUBBLE_HOLD_MS = 4000;
/** Presentation of a decision taken in the bubble: sent and unconfirmed, confirmed by the daemon, or failed. */
export type BubbleAck = 'pending' | 'confirmed' | 'failed' | null;

interface BubbleProps {
  session: Session | null;
  moreCount: number;
  visible: boolean;
  /** The controller holds the countdown (hover, focus, hidden document, acknowledgement): the bar stops where it is. */
  paused: boolean;
  /** The controller's real remaining time (ms) for this request; the bar drains exactly that, never a fresh 4 s. */
  remainingMs?: number;
  ack?: BubbleAck;
  /** Why the last decision failed (shown only with `ack === 'failed'`). */
  failure?: string;
  /** A decision for this request is in flight (sent from any path): the actions stay locked until the daemon answers. */
  deciding?: boolean;
  /** Null when the actions may be used; otherwise why they are disabled (offline, read-only). */
  blocked?: string | null;
  frozen?: boolean;
  reducedMotion?: boolean;
  onOpen: () => void;
  /** "Later" on a diff or plan: fold the bubble, the request stays pending. */
  onDismiss?: () => void;
  onDecide: (decision: 'accept' | 'deny') => void;
  onReply: (text: string) => void;
  theme?: 'dark' | 'light';
  ref?: Ref<HTMLDivElement>;
}

export function Bubble({ session, moreCount, visible, paused, remainingMs = BUBBLE_HOLD_MS, ack = null, failure, deciding = false, blocked = null, frozen = false, reducedMotion, onOpen, onDismiss, onDecide, onReply, theme = 'dark', ref }: BubbleProps) {
  const pending = session?.pending;
  const askKey = session ? `${session.id}:${pending?.helperId ?? ''}:${pending?.text ?? ''}` : undefined;
  // A click locks this request until the daemon answers; a failure unlocks it, a new request starts unlocked.
  const [lockedKey, setLockedKey] = useState<string | undefined>(undefined);
  if (!visible && lockedKey !== undefined) setLockedKey(undefined);
  const locked = ((lockedKey === askKey || deciding) && ack !== 'failed') || ack === 'pending' || ack === 'confirmed';
  const disabled = locked || blocked !== null;
  const isQ = pending?.kind === 'question';
  // A diff or a plan opens its review before any decision (spec §5): the bubble offers Review, never Approve.
  const review = pending?.kind === 'diff' || pending?.kind === 'plan';
  const first = pending?.options?.[0];
  const title = !session ? '' : isQ ? `${session.name} has a question` : review ? `${session.name} has a ${pending!.kind} to review` : `${session.name} needs your approval`;
  const act = (fn: () => void) => () => { if (disabled) return; setLockedKey(askKey); fn(); };

  // The bar restarts per request and per pause/resume segment, from the remainder the controller reports.
  const running = visible && !paused && ack !== 'pending' && ack !== 'confirmed';
  const seg = `${askKey ?? ''}|${running}`;
  const [clock, setClock] = useState({ seg, ms: remainingMs });
  if (clock.seg !== seg) setClock({ seg, ms: remainingMs });
  const left = Math.max(0, Math.round(clock.seg === seg ? clock.ms : remainingMs));
  const pct = (left / BUBBLE_HOLD_MS) * 100;

  // One nod when the daemon confirms the decision: it acknowledges receipt, never that the work succeeded.
  const [nod, setNod] = useState(0);
  const prevAck = useRef(ack);
  useEffect(() => { if (ack === 'confirmed' && prevAck.current !== 'confirmed') setNod(n => n + 1); prevAck.current = ack; }, [ack]);

  const note = ack === 'failed' ? `${failure ?? 'The decision was not delivered'}. Try again or open the session.`
    : ack === 'pending' ? 'Sent, waiting for the terminal' : ack === 'confirmed' ? 'Received' : blocked;
  return (
    <div ref={ref} data-layer="bubble" data-ack={ack ?? 'none'} inert={!visible} style={{ position: 'absolute', left: 0, top: 0, width: SIZES.bubbleW, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 12px', opacity: visible ? 1 : 0, transform: `translateX(${visible ? 0 : -12}px)`, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut'], ['transform', visible ? 'grow' : 'fadeOut', visible ? 140 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {session && <Bot seed={session.id} readOnly={session.source === 'hook_only'} tool={session.tool} state={botState(session)} pose={poseFor(session.id, session.state)} size={48} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} askKey={askKey} nodKey={nod} />}
        <a href="#open" onClick={e => { e.preventDefault(); onOpen(); }} style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
          <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>{title}</span>
          <span className="mono" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{pending?.text} · {session?.project}</span>
          {moreCount > 0 && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>+{moreCount} more</span>}
        </a>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </div>
      {note && <span role="status" style={{ fontSize: 12, lineHeight: '16px', color: ack === 'failed' ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>{note}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        {review ? (
          <>
            <Button variant="outline" size="sm" onClick={() => onDismiss?.()}>Later</Button>
            <Button variant="primary" size="sm" onClick={() => onOpen()}>Review</Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" disabled={isQ ? locked : disabled} onClick={isQ ? () => onOpen() : act(() => onDecide('deny'))}>{isQ ? 'Later' : 'Deny'}</Button>
            <Button variant="primary" size="sm" disabled={disabled} onClick={act(() => { if (isQ) onReply('1'); else onDecide('accept'); })}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              {isQ ? `Answer: ${first ?? 'first option'}` : 'Approve'}
            </Button>
          </>
        )}
      </div>
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 0, height: 2, borderRadius: 9999, background: 'var(--muted)', overflow: 'hidden' }}>
        {/* A functional countdown, so it ignores VITE_LEDGE_MOTION and reduced motion: it drains the controller's real remainder. */}
        <div key={seg} data-timer data-paused={running ? 'false' : 'true'} data-remaining={left}
          style={{ width: `${pct}%`, height: '100%', background: 'var(--ring)', ['--ledge-from' as string]: `${pct}%`, animation: running ? `ledge-drain ${left}ms linear forwards` : 'none' }} />
      </div>
    </div>
  );
}
