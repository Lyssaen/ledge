import { useEffect, useRef, useState, type Ref } from 'react';
import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { ResidentMascot } from '../bots/ResidentMascot';
import { botState, poseFor } from '../bots/poseFor';
import { Button } from '../ui/Button';
import { transition } from '../motion';
import { SIZES } from './geometry';
import { useI18n } from '../i18n/lang';
import { FINISHED_BUBBLE_MS, type BubbleKind } from './machine';
import { duration } from '../format';
import { Badge } from '../ui/Badge';
import { Kbd } from '../ui/Kbd';

/** Presentation of a decision taken in the bubble: sent and unconfirmed, confirmed by the daemon, or failed. */
export type BubbleAck = 'pending' | 'confirmed' | 'failed' | null;

interface BubbleProps {
  session: Session | null;
  moreCount: number;
  visible: boolean;
  /** The controller holds a notice countdown (hover, focus, hidden document). An ask has no countdown. */
  paused: boolean;
  /** The controller's real remaining time (ms) for a notice; the bar drains exactly that. */
  remainingMs?: number;
  ack?: BubbleAck;
  /** `ask` (default) is a request to decide; the other kinds are notices. */
  kind?: BubbleKind;
  /** The work time of a finished notice (ms), when known. */
  elapsedMs?: number;
  /** A Ledge chat finish, or the line under an offline machine. */
  preview?: string;
  /** Why the last decision failed (shown only with `ack === 'failed'`). */
  failure?: string;
  /** A decision for this request is in flight (sent from any path): the actions stay locked until the daemon answers. */
  deciding?: boolean;
  /** Allow, deny or answer from the card (Desktop's « quick »); off, an ask only offers Open in Ledge and Later. */
  quick?: boolean;
  /** Null when the actions may be used; otherwise why they are disabled (offline, read-only). */
  blocked?: string | null;
  frozen?: boolean;
  reducedMotion?: boolean;
  onOpen: () => void;
  /** Later on an ask (it stays pending), or OK on a notice. */
  onDismiss?: () => void;
  onDecide: (decision: 'accept' | 'deny') => void;
  onReply: (text: string) => void;
  theme?: 'dark' | 'light';
  ref?: Ref<HTMLDivElement>;
}

export function Bubble({ session, moreCount, visible, paused, remainingMs, ack = null, kind = 'ask', elapsedMs, preview, failure, deciding = false, quick = true, blocked = null, frozen = false, reducedMotion, onOpen, onDismiss, onDecide, onReply, theme = 'dark', ref }: BubbleProps) {
  const pending = session?.pending;
  const notice = kind !== 'ask';
  const holdMs = FINISHED_BUBBLE_MS;
  const remaining = remainingMs ?? holdMs;
  const { t } = useI18n();
  const ledge = kind === 'finished' && !session;
  const askKey = ledge ? 'ledge:finished' : session ? (notice ? `${session.id}:${kind}` : `${session.id}:${pending?.helperId ?? ''}:${pending?.text ?? ''}`) : kind;
  const [lockedKey, setLockedKey] = useState<string | undefined>(undefined);
  if (!visible && lockedKey !== undefined) setLockedKey(undefined);
  const locked = ((lockedKey === askKey || deciding) && ack !== 'failed') || ack === 'pending' || ack === 'confirmed';
  const disabled = locked || blocked !== null;
  const isQ = pending?.kind === 'question';
  const review = pending?.kind === 'diff' || pending?.kind === 'plan';
  /** Decided in Ledge Desktop, not here: a diff or a plan, or any ask once the quick answers are off. */
  const handOff = review || !quick;
  const [choice, setChoice] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  const [nudge, setNudge] = useState(false);
  if (askKey !== undefined && lockedKey !== askKey && (choice !== null || reply !== '') && !visible) { /* a hidden bubble keeps nothing */ }
  const title = ledge ? t.bubble.finished(t.resident.name)
    : kind === 'offline' ? (preview ?? t.bubble.offline)
    : !session ? ''
    : kind === 'error' ? t.bubble.failedTitle(session.name)
    : kind === 'finished' ? t.bubble.finished(session.name)
    : isQ ? t.bubble.question(session.name)
    : review ? t.bubble.review(session.name, pending!.kind)
    : t.bubble.approval(session.name);
  const finishedSub = preview ?? (elapsedMs !== undefined ? t.bubble.finishedSub(duration(elapsedMs, t), session?.project ?? '') : t.bubble.finishedSubNoTime(session?.project ?? ''));
  const act = (fn: () => void) => () => { if (disabled) return; setLockedKey(askKey); fn(); };
  const answer = () => {
    const text = reply.trim() || (choice !== null ? pending?.options?.[choice] : '');
    if (!text) { setNudge(true); return; }
    act(() => onReply(text))();
  };

  const running = visible && notice && !paused && ack !== 'pending' && ack !== 'confirmed';
  const seg = `${askKey ?? ''}|${running}`;
  const [clock, setClock] = useState({ seg, ms: remaining });
  if (notice && clock.seg !== seg) setClock({ seg, ms: remaining });
  const left = Math.max(0, Math.round(clock.seg === seg ? clock.ms : remaining));
  const pct = (left / holdMs) * 100;

  const [nod, setNod] = useState(0);
  const prevAck = useRef(ack);
  useEffect(() => { if (ack === 'confirmed' && prevAck.current !== 'confirmed') setNod(n => n + 1); prevAck.current = ack; }, [ack]);

  const note = ack === 'failed' ? t.bubble.failed(failure ?? t.bubble.lostDefault)
    : ack === 'pending' ? t.bubble.pending : ack === 'confirmed' ? t.bubble.confirmed : blocked;

  return (
    <div ref={ref} data-layer="bubble" data-kind={kind} data-ack={ack ?? 'none'} inert={!visible} style={{ position: 'absolute', left: 0, top: 0, width: kind === 'ask' ? SIZES.bubbleW : SIZES.bubbleW, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 12px', opacity: visible ? 1 : 0, transform: `translateY(${visible ? 0 : -8}px)`, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut'], ['transform', visible ? 'grow' : 'fadeOut', visible ? 140 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {ledge || kind === 'offline' ? <ResidentMascot size={40} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} /> : session && <Bot seed={session.id} readOnly={session.source === 'hook_only'} tool={session.tool} state={kind === 'error' ? 'error' : botState(session)} pose={poseFor(session.id, session.state)} size={40} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} askKey={String(askKey)} nodKey={nod} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600 }}>{title}</span>
          {notice ? <span className="mono" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{kind === 'offline' ? (session ? finishedSub : t.bubble.offlineSub) : kind === 'error' ? (session?.lastError || t.bubble.errorSub) : finishedSub}</span>
            : <span className="mono" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{pending?.text}{session?.project ? ` · ${session.project}` : ''}</span>}
          {moreCount > 0 && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.bubble.more(moreCount)}</span>}
        </div>
      </div>
      {isQ && kind === 'ask' && quick && pending?.options && (
        <div role="radiogroup" aria-label={t.bubble.choices} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pending.options.map((option, i) => (
            <button key={option} type="button" role="radio" aria-checked={choice === i} disabled={disabled} onClick={() => { if (disabled) return; setChoice(i); setReply(''); setNudge(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--sidebar-border)', background: choice === i ? 'var(--sidebar-accent)' : 'transparent', color: 'inherit', cursor: 'pointer' }}>
              <Kbd>{i + 1}</Kbd><span style={{ flexGrow: 1 }}>{option}</span>
            </button>
          ))}
          <input data-reply type="text" maxLength={140} placeholder={t.bubble.short} value={reply} disabled={disabled} aria-label={t.bubble.shortLabel}
            onChange={e => { setReply(e.target.value); if (e.target.value) setChoice(null); setNudge(false); }}
            style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--sidebar-border)', background: 'var(--well)', color: 'inherit' }} />
        </div>
      )}
      {note && <span role="status" style={{ fontSize: 12, lineHeight: '16px', color: ack === 'failed' ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>{note}</span>}
      {nudge && !locked && <span role="alert" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--danger-text)' }}>{t.bubble.choose}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        {notice ? (
          <>
            <Badge state={kind === 'finished' ? 'idle' : kind === 'error' ? 'error' : 'readonly'} label={kind === 'offline' ? t.bubble.offlineBadge : undefined} />
            <span style={{ flexGrow: 1 }} />
            <Button variant="outline" size="sm" onClick={() => onDismiss?.()}>{t.bubble.ok}</Button>
            <Button variant="primary" size="sm" onClick={() => onOpen()}>{t.bubble.openSession}</Button>
          </>
        ) : handOff ? (
          <>
            <Button variant="outline" size="sm" onClick={() => onDismiss?.()}>{t.bubble.later}</Button>
            <Button variant="primary" size="sm" onClick={() => onOpen()}>{review ? t.bubble.reviewAction : t.bubble.openSession}</Button>
          </>
        ) : isQ ? (
          <Button variant="primary" size="sm" disabled={disabled} onClick={answer}>{t.bubble.reply}</Button>
        ) : (
          <>
            <Button variant="outline" size="sm" disabled={disabled} onClick={act(() => onDecide('deny'))}>{t.bubble.deny}</Button>
            <Button variant="primary" size="sm" disabled={disabled} onClick={act(() => onDecide('accept'))}>{t.bubble.approve}</Button>
          </>
        )}
      </div>
      {kind === 'ask' && !handOff && !locked && (
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" onClick={() => onOpen()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 12 }}>{t.bubble.openSession}<Kbd>O</Kbd></button>
          <button type="button" onClick={() => onDismiss?.()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: 12 }}>{moreCount > 0 ? t.bubble.laterNext : t.bubble.later}<Kbd>Esc</Kbd></button>
        </div>
      )}
      {notice && (
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 0, height: 2, borderRadius: 9999, background: 'var(--muted)', overflow: 'hidden' }}>
          <div key={seg} data-timer data-paused={running ? 'false' : 'true'} data-remaining={left}
            style={{ width: `${pct}%`, height: '100%', background: 'var(--ring)', ['--ledge-from' as string]: `${pct}%`, animation: running ? `ledge-drain ${left}ms linear forwards` : 'none' }} />
        </div>
      )}
    </div>
  );
}
