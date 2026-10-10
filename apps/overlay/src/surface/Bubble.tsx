import { useEffect, useState } from 'react';
import type { Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Button } from '../ui/Button';
import { transition } from '../motion';

export const BUBBLE_HOLD_MS = 4000;

interface BubbleProps {
  session: Session | null;
  moreCount: number;
  visible: boolean;
  /** The controller cancelled the countdown (hover, focus, hidden document): the bar stays full. */
  paused: boolean;
  onOpen: () => void;
  onDecide: (decision: 'accept' | 'deny') => void;
  onReply: (text: string) => void;
  theme?: 'dark' | 'light';
}

export function Bubble({ session, moreCount, visible, paused, onOpen, onDecide, onReply, theme = 'dark' }: BubbleProps) {
  const [decided, setDecided] = useState(false);
  const sessionId = session?.id;
  useEffect(() => { setDecided(false); }, [sessionId, visible]);
  const pending = session?.pending;
  const isQ = pending?.kind === 'question';
  const first = pending?.options?.[0];
  const title = session ? `${session.name} ${isQ ? 'has a question' : 'needs your approval'}` : '';
  const running = visible && !paused;
  const askKey = session ? `${session.id}:${pending?.helperId ?? ''}:${pending?.text ?? ''}` : undefined;
  return (
    <div data-layer="bubble" inert={!visible} style={{ position: 'absolute', left: 0, top: 0, width: 336, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 12px', opacity: visible ? 1 : 0, transform: `translateX(${visible ? 0 : -12}px)`, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut'], ['transform', visible ? 'grow' : 'fadeOut', visible ? 140 : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {session && <Bot seed={session.id} readOnly={session.source === 'hook_only'} tool={session.tool} state={botState(session)} pose={poseFor(session.id, session.state)} size={48} theme={theme} paused={!visible} askKey={askKey} />}
        <a href="#open" onClick={e => { e.preventDefault(); onOpen(); }} style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
          <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>{title}</span>
          <span className="mono" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pending?.text} · {session?.project}</span>
          {moreCount > 0 && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>+{moreCount} more</span>}
        </a>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="outline" size="sm" disabled={decided} onClick={() => { setDecided(true); if (isQ) onOpen(); else onDecide('deny'); }}>{isQ ? 'Later' : 'Deny'}</Button>
        <Button variant="primary" size="sm" disabled={decided} onClick={() => { setDecided(true); if (isQ) onReply('1'); else onDecide('accept'); }}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {isQ ? `Answer: ${first ?? 'first option'}` : 'Approve'}
        </Button>
      </div>
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 0, height: 2, borderRadius: 9999, background: 'var(--muted)', overflow: 'hidden' }}>
        {/* A keyframe animation (not a transition) so the drain starts from full on mount and restarts per session; it is a functional countdown, so it ignores VITE_LEDGE_MOTION. */}
        <div key={sessionId} data-timer data-paused={paused ? 'true' : 'false'} style={{ width: running ? '0%' : '100%', height: '100%', background: 'var(--ring)', animation: running ? `ledge-drain ${BUBBLE_HOLD_MS}ms linear` : 'none' }} />
      </div>
    </div>
  );
}
