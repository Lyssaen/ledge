import type { ReactNode } from 'react';
import { useLedgeThreadCopy } from './copy';
import { hhmm } from './threadModel';

/** Ledge's bubble, on the left: « Ledge · 16:44 » over the text and whatever card follows it; `avatar` is the app's mascot. */
export function LedgeBubble({ at, avatar, children }: { at: string; avatar?: ReactNode; children?: ReactNode }) {
  const copy = useLedgeThreadCopy();
  return (
    <div className="lt-row" data-author="ledge">
      {avatar && <div className="lt-avatar">{avatar}</div>}
      <div className="lt-col">
        <div className="lt-meta"><strong>{copy.bubbles.ledge}</strong><span aria-hidden> · </span><time dateTime={at}>{hhmm(at)}</time></div>
        <div className="lt-bubble">{children}</div>
      </div>
    </div>
  );
}

/** The user's message, on the right: the text, then « Toi · 16:45 ». `to` (« @build ») when it went to a seat. */
export function UserBubble({ at, text, to }: { at: string; text: string; to?: string }) {
  const copy = useLedgeThreadCopy();
  return (
    <div className="lt-row" data-author="user">
      <div className="lt-col">
        <div className="lt-bubble" data-author="user">{to && <span className="lt-to mono">{to} </span>}{text}</div>
        <div className="lt-meta"><span>{copy.bubbles.you}</span><span aria-hidden> · </span><time dateTime={at}>{hhmm(at)}</time></div>
      </div>
    </div>
  );
}
