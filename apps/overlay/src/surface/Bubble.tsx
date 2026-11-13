import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { OperatorNotice, Session } from '@ledge/protocol';
import { inline } from '@ledge/ui/chat/inline';
import { ledgeSentence } from './say.js';
import { ResidentMascot } from '../bots/ResidentMascot';
import { Button } from '../ui/Button';
import { transition } from '../motion';
import { SIZES } from './geometry';
import { useI18n } from '../i18n/lang';
import { FINISHED_BUBBLE_MS, type BubbleKind } from './machine';
import { Badge } from '../ui/Badge';
import { Kbd } from '../ui/Kbd';

/** Presentation of a decision taken in the bubble: sent and unconfirmed, confirmed by the daemon, or failed. */
export type BubbleAck = 'pending' | 'confirmed' | 'failed' | null;

interface BubbleProps {
  /** The tallest the card may be (base px, the open views' cap): past it, its choices scroll and its actions stay in view. */
  maxH?: number;
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
  /** The operator notice an `operator` bubble says (a point, or a rig's question). */
  notice?: OperatorNotice;
  /** « Plus tard » on a point. */
  onLater?: () => void;
  /** « Voir le point »: the point in Desktop's chat. */
  onSeePoint?: () => void;
  /** One of a rig question's options, by id; without options, the question opens in Ledge (`onOpen`). */
  onOption?: (id: string) => void;
  theme?: 'dark' | 'light';
  ref?: Ref<HTMLDivElement>;
}

export function Bubble({ session, moreCount, visible, paused, remainingMs, ack = null, kind = 'ask', preview, failure, deciding = false, quick = true, blocked = null, frozen = false, reducedMotion, onOpen, onDismiss, onDecide, onReply, notice: opNotice, onLater, onSeePoint, onOption, theme = 'dark', ref, maxH }: BubbleProps) {
  const pending = session?.pending;
  const notice = kind !== 'ask';
  const holdMs = FINISHED_BUBBLE_MS;
  const remaining = remainingMs ?? holdMs;
  const { t } = useI18n();
  const askKey = notice ? `${kind}:${preview ?? ''}` : session ? `${session.id}:${pending?.helperId ?? ''}:${pending?.text ?? ''}` : kind;
  const [lockedKey, setLockedKey] = useState<string | undefined>(undefined);
  if (!visible && lockedKey !== undefined) setLockedKey(undefined);
  // Taller than the open views' cap: the question's text joins the choices in a scrolling area under the title, the
  // actions stay at the bottom (design-ux, 2026-11-02). Decided once per ask and cap, so the layout never flips back and forth.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setRoot = (el: HTMLDivElement | null) => { rootRef.current = el; if (typeof ref === 'function') ref(el); else if (ref) (ref as { current: HTMLDivElement | null }).current = el; };
  const [tallKey, setTallKey] = useState<string | null>(null);
  const tall = !notice && !!maxH && tallKey === `${askKey}|${maxH}`;
  useLayoutEffect(() => {
    const el = rootRef.current, area = scrollRef.current;
    if (notice || !maxH || tall || !el) return;
    if (el.scrollHeight > el.clientHeight + 1 || (area && area.scrollHeight > area.clientHeight + 1)) setTallKey(`${askKey}|${maxH}`);
  });
  /** Content is left below the scrolling area: a hairline tops the actions until the end is reached. */
  const [more, setMore] = useState(false);
  /** Scrolled past the top: the same hairline under the title (mockup complement 6b040c85, proposed). */
  const [below, setBelow] = useState(false);
  const measureMore = () => { const a = scrollRef.current; setMore(!!a && a.scrollHeight > a.clientHeight + 1 && a.scrollTop + a.clientHeight < a.scrollHeight - 1); setBelow(!!a && a.scrollTop > 0); };
  useEffect(() => {
    const a = scrollRef.current;
    measureMore();
    if (!a || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureMore); ro.observe(a);
    return () => ro.disconnect();
  }, [tall, askKey, pending?.options?.length]); // eslint-disable-line react-hooks/exhaustive-deps
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
  /** The only notice left in the bubble: a machine dropped (sessions' finishes and errors reach the user through the point). */
  const title = kind === 'offline' ? (preview ?? t.bubble.offline) : '';
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


  const note = ack === 'failed' ? t.bubble.failed(failure ?? t.bubble.lostDefault)
    : ack === 'pending' ? t.bubble.pending : ack === 'confirmed' ? t.bubble.confirmed : blocked;

  /** The card's frame, shared by a request, a notice and an operator notice. */
  const shell = { position: 'absolute', left: 0, top: 0, width: SIZES.bubbleW, maxHeight: maxH, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 12px', opacity: visible ? 1 : 0, transform: `translateY(${visible ? 0 : -8}px)`, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut'], ['transform', visible ? 'grow' : 'fadeOut', visible ? 140 : 0]]) } as const;
  /** Ledge speaks for the operator: its mark (amber, something waits on the user), its sentence, the notice's own actions. */
  if (kind === 'operator') {
    const rig = opNotice?.kind === 'rig.ask';
    const decision = opNotice?.kind === 'decision';
    const options = rig ? opNotice?.options ?? [] : [];
    return (
      <div ref={setRoot} data-layer="bubble" data-kind="operator" data-notice={opNotice?.kind} data-ack="none" inert={!visible} style={shell}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span data-ledge-mark className="nt-mark" data-pending="question" />
          <span data-ledge-sentence style={{ fontSize: 14, lineHeight: '20px', minWidth: 0, overflowWrap: 'anywhere' }}>
            {!opNotice ? null : decision
              ? <><b style={{ fontWeight: 600 }}>{opNotice.who ?? t.resident.name}</b>{t.bubble.decision.asks}</>
              : rig
              ? <><b style={{ fontWeight: 600 }}>{opNotice.who ?? t.resident.name}</b>{opNotice.rig && <span style={{ color: 'var(--muted-foreground)' }}> · {opNotice.rig}</span>}{t.bubble.rigAsk.colon}{t.bubble.rigAsk.quote(opNotice.text)}</>
              : inline(opNotice.text)}
          </span>
        </div>
        {failure && <span role="status" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--danger-text)' }}>{failure}</span>}
        <div data-actions style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {decision ? (
            <Button variant="primary" size="sm" onClick={() => onOpen()}>{t.bubble.decision.see}</Button>
          ) : !rig ? (
            <>
              <Button variant="ghost" size="sm" disabled={blocked !== null} title={blocked ?? undefined} onClick={() => onLater?.()}>{t.bubble.point.later}</Button>
              <Button variant="primary" size="sm" disabled={blocked !== null} title={blocked ?? undefined} onClick={() => onSeePoint?.()}>{t.bubble.point.see}</Button>
            </>
          ) : options.length === 0 ? (
            <Button variant="primary" size="sm" onClick={() => onOpen()}>{t.bubble.rigAsk.open}</Button>
          ) : (
            // The first option is the rig's suggested answer: it is the primary button, at the right end where the eye lands.
            [...options.slice(1), options[0]!].map(o => (
              <Button key={o.id} variant={o === options[0] ? 'primary' : 'outline'} size="sm" disabled={deciding || blocked !== null} title={blocked ?? undefined} onClick={() => onOption?.(o.id)}>{o.label}</Button>
            ))
          )}
        </div>
      </div>
    );
  }
  /** A request's heading is Ledge's sentence: the session named in bold, then what it wants. */
  const sentence = !notice && session ? ledgeSentence(session, t) : null;
  /** Under the sentence: a diff's or a plan's own summary (its stat), which the sentence does not carry, then the project. */
  const subLine = [review ? pending?.text : undefined, session?.project].filter(Boolean).join(' · ');

  return (
    <div ref={setRoot} data-layer="bubble" data-tall={tall || undefined} data-kind={kind} data-ack={ack ?? 'none'} inert={!visible} style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {sentence ? <span data-ledge-mark className="nt-mark" data-pending={pending?.kind === 'permission' ? 'permission' : 'question'} /> : kind === 'offline' ? <ResidentMascot size={40} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} /> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          {sentence
            ? <span data-ledge-sentence style={{ fontSize: 14, lineHeight: '20px', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}><b style={{ fontWeight: 600 }}>{sentence.who}</b> {inline(sentence.rest)}</span>
            : <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600 }}>{title}</span>}
          {notice ? <span className="mono" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.bubble.offlineSub}</span>
            : !tall && subLine && <span className="mono" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{subLine}</span>}
          {moreCount > 0 && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.bubble.more(moreCount)}</span>}
        </div>
      </div>
      {(tall || (isQ && kind === 'ask' && quick && pending?.options)) && <div data-top-rule={below ? 'true' : 'false'} aria-hidden="true" style={{ flexShrink: 0, height: 1, margin: '-5px 0 -6px', background: below ? 'var(--border)' : 'transparent' }} />}
      {(tall || (isQ && kind === 'ask' && quick && pending?.options)) && <div ref={scrollRef} data-scroll-area className="ledge-scroll" onScroll={measureMore} style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '0 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      {tall && <span data-ask-text className="mono" style={{ flexShrink: 0, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{pending?.text}{session?.project ? ` · ${session.project}` : ''}</span>}
      {isQ && kind === 'ask' && quick && pending?.options && (
        <div role="radiogroup" data-choices aria-label={t.bubble.choices} style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          {pending.options.map((option, i) => (
            <button key={option} type="button" role="radio" aria-checked={choice === i} disabled={disabled} onFocus={e => e.currentTarget.scrollIntoView?.({ block: 'nearest' })} onClick={() => { if (disabled) return; setChoice(i); setReply(''); setNudge(false); }}
              style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8, textAlign: 'left', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--sidebar-border)', background: choice === i ? 'var(--sidebar-accent)' : 'transparent', color: 'inherit', cursor: 'pointer' }}>
              <Kbd>{i + 1}</Kbd><span style={{ flexGrow: 1 }}>{option}</span>
            </button>
          ))}
          <input data-reply type="text" onFocus={e => e.currentTarget.scrollIntoView?.({ block: 'nearest' })} maxLength={140} placeholder={t.bubble.short} value={reply} disabled={disabled} aria-label={t.bubble.shortLabel}
            onChange={e => { setReply(e.target.value); if (e.target.value) setChoice(null); setNudge(false); }}
            style={{ flexShrink: 0, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--sidebar-border)', background: 'var(--well)', color: 'inherit' }} />
        </div>
      )}
      </div>}
      {/* The hairline over the bottom that stays: shown while content is left below; its margins cancel it out of the gaps. */}
      {(tall || (isQ && kind === 'ask' && quick && pending?.options)) && <div data-more-rule={more ? "true" : "false"} aria-hidden="true" style={{ flexShrink: 0, height: 1, margin: '-5px 0 -6px', background: more ? 'var(--border)' : 'transparent' }} />}
      {note && <span role="status" style={{ flexShrink: 0, fontSize: 12, lineHeight: '16px', color: ack === 'failed' ? 'var(--danger-text)' : 'var(--muted-foreground)' }}>{note}</span>}
      {nudge && !locked && <span role="alert" style={{ flexShrink: 0, fontSize: 12, lineHeight: '16px', color: 'var(--danger-text)' }}>{t.bubble.choose}</span>}
      <div data-actions style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
        {notice ? (
          <>
            <Badge state="readonly" label={t.bubble.offlineBadge} />
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
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
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
