import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent, type ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot } from '../shell/SessionBot';
import type { Bubble } from './conversation';
import { atEnd, clock } from './exchanges';
import { isLong, STATUS_MARK } from './MessageCard';
import type { ConversationView } from './useConversations';

export interface ConversationTabProps {
  self: Session; view: ConversationView;
  /** The pane's « Agrandir » / « Fermer ». */
  buttons: ReactNode;
  /** « dans le fil », or a click on the bubble: the message lit in this page's thread. */
  onLight(id: string): void;
  /** « voir son fil » in the head, or on a message only the peer's thread holds (`item`): the peer's page. */
  onOpenPeer(item?: string): void;
}

/** The « Conversation » tab: its head (the pair, the count, the peer's thread), then the messages of both agents, one bubble
 *  each, in the order they were sent; live, following the end while the reader is there. */
export function ConversationTab({ self, view, buttons, onLight, onOpenPeer }: ConversationTabProps): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const tc = t.session.conversation;
  const { peer, name: peerName, bubbles, withPeer } = view;
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const count = useRef(bubbles.length);
  const merged = useRef(withPeer);
  const [fresh, setFresh] = useState(0);
  // Opened at the end (the latest message is what one comes for); a message that comes keeps the end in view while the
  // reader is there, else it is counted on the « n nouveaux messages » pill. A status changing in place is not one, nor
  // B's thread coming at last: its messages are the past, sorted in among those already shown.
  useLayoutEffect(() => {
    const el = scroller.current;
    const added = bubbles.length - count.current;
    const arrived = withPeer && !merged.current;
    count.current = bubbles.length;
    merged.current = withPeer;
    if (!el) return;
    if (follow.current) el.scrollTop = el.scrollHeight;
    else if (added > 0 && !arrived) setFresh(f => f + added);
  }, [bubbles, withPeer]);
  // The pane or a bubble changed size without a scroll (the pane resized, « Lire tout le message », the narrow layout): a
  // reader at the end stays there, as in the thread. The size it last saw is kept for onScroll.
  const resized = useRef<ResizeObserver | null>(null);
  const laid = useRef<{ height: number; client: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      laid.current = { height: el.scrollHeight, client: el.clientHeight };
      if (follow.current) el.scrollTop = el.scrollHeight;
    });
    resized.current = ro;
    ro.observe(el);
    return () => { ro.disconnect(); resized.current = null; };
  }, []);
  // After each render, what the body holds is watched too (observing twice is a no-op).
  useLayoutEffect(() => {
    const el = scroller.current; const ro = resized.current;
    if (el && ro) for (const child of el.children) ro.observe(child);
  });
  // A scroll the browser reports on a size the observer has not seen yet comes from the layout (the narrow layout wrapping
  // the bubbles taller moves or resets the position before the observer runs), not from the reader: following is left
  // alone, and the observer then keeps the end.
  const onScroll = () => {
    const el = scroller.current;
    const size = laid.current;
    if (!el || (size !== null && (size.height !== el.scrollHeight || size.client !== el.clientHeight))) return;
    follow.current = atEnd(el);
    if (follow.current) setFresh(0);
  };
  const toLatest = () => {
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  };
  // The rows are memoised: they get the page's callbacks through stable wrappers (the latest ones, read when clicked).
  const handlers = useRef({ onLight, onOpenPeer });
  handlers.current = { onLight, onOpenPeer };
  const light = useCallback((id: string) => handlers.current.onLight(id), []);
  const openPeer = useCallback((item?: string) => handlers.current.onOpenPeer(item), []);
  const name = (from: Bubble['from']) => (from === 'a' ? self.name : peerName);

  return (
    <>
      <div className="side-head conv-head">
        <span className="side-title conv-title">
          <span className="conv-pair">
            <span className="conv-bot" aria-hidden="true"><SessionBot session={self} size={18} /></span><strong>{self.name}</strong>
            <span className="conv-exchange" aria-hidden="true"><Icon d={SHELL_ICONS.exchange} size={13} /></span>
            {peer && <span className="conv-bot" aria-hidden="true"><SessionBot session={peer} size={18} /></span>}<strong title={peerName}>{peerName}</strong>
          </span>
          {bubbles.length > 0 && <span className="conv-count">{tc.count(bubbles.length)}</span>}
        </span>
        {peer && <button type="button" className="lnk message-link conv-peer" title={tm.seeIn(peerName)} onClick={() => onOpenPeer()}>{tm.seeTheirs}</button>}
        {buttons}
      </div>
      {/* Said once and kept in view, above the messages: the reader comes in at the end. */}
      {!peer && (
        <div className="conv-note" role="note">
          <Icon d={SHELL_ICONS.offline} size={15} />
          <span><strong>{tc.oneSidedLead}</strong> · {tc.oneSided(peerName, self.name)}</span>
        </div>
      )}
      <div className="conv-wrap">
        <div className="side-body conv-body" ref={scroller} onScroll={onScroll}>
          {view.loading && <p className="conv-loading muted">{tc.loadingPeer(peerName)}</p>}
          {bubbles.length === 0 && !view.loading && (
            <div className="changes-empty conv-empty"><Icon d={SHELL_ICONS.mail} size={22} /><strong>{tc.empty(self.name, peerName)}</strong><p>{tc.emptyHint}</p></div>
          )}
          {/* Mounted even when empty, so the first message that comes is announced. */}
          <ol className="conv-log" role="log" aria-label={tc.log(self.name, peerName)}>
            {bubbles.map((b, i) => (
              <BubbleRow key={b.key} b={b} first={bubbles[i - 1]?.from !== b.from} name={name(b.from)} to={name(b.from === 'a' ? 'b' : 'a')}
                who={b.from === 'a' ? self : peer} peerKnown={peer !== null} peerName={peerName} selfName={self.name} onLight={light} onOpenPeer={openPeer} />
            ))}
          </ol>
        </div>
        {fresh > 0 && <button type="button" className="to-latest" onClick={toLatest}><Icon d={SHELL_ICONS.arrowDown} size={13} />{tc.fresh(fresh)}</button>}
      </div>
    </>
  );
}

/** One message: who wrote it (on the first of a run), its summary and body (clamped when long, as the thread's card), then
 *  its time, its delivery and where to find it. A's on the right, filled, as « sent » in the thread; B's on the left.
 *  Memoised, its Markdown parsed again only when its text changes: the page's clock and the store's changes elsewhere
 *  leave it alone. `who`: the author's session, for its bot (none for a peer Ledge does not know). */
const BubbleRow = memo(function BubbleRow({ b, first, name, to, who, peerKnown, peerName, selfName, onLight, onOpenPeer }: {
  b: Bubble; first: boolean; name: string; to: string; who: Session | null; peerKnown: boolean; peerName: string; selfName: string;
  onLight(id: string): void; onOpenPeer(item?: string): void;
}): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const tc = t.session.conversation;
  const [more, setMore] = useState(false);
  const long = isLong(b.text);
  const body = useMemo(() => <ThreadMarkdown text={b.text} />, [b.text]);
  const mine = b.from === 'a';
  const status = b.status === 'read' ? tc.readBy(to) : b.status === 'delivered' ? tc.deliveredTo(to) : tm[b.status];
  const inA = b.inA;
  // A click on the bubble (not on its links, not over a selection) does what « dans le fil » does.
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (inA === undefined || (e.target as Element).closest('button, a') || String(window.getSelection() ?? '') !== '') return;
    onLight(inA);
  };
  return (
    <li className={cls('conv-row', mine ? 'mine' : 'theirs', first && 'first')}>
      <div className={cls('message-card conv-bubble', mine ? 'sent' : 'received', inA !== undefined && 'can-light')} role="article" data-bubble={b.key} onClick={click}>
        <span className="visually-hidden">{tc.kicker(name, to)}</span>
        {first && <span className="who conv-who" aria-hidden="true">{who && <SessionBot session={who} size={14} />}<strong>{name}</strong></span>}
        {b.summary && <p className="message-summary">{b.summary}</p>}
        <div className={cls('message-body', long && !more && 'clamped')}>{body}</div>
        {long && <button type="button" className="lnk message-link" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? tm.showLess : tm.readAll}<Icon d={ICONS.chevronRight.d} size={12} /></button>}
        <span className="who conv-meta">
          <time dateTime={b.at}>{clock(b.at)}</time>
          {' · '}
          <span className={cls('message-read', b.status === 'read' && 'is-read')} title={status}>
            <i aria-hidden="true">{STATUS_MARK[b.status]}</i>{b.status === 'read' ? tm.seen : b.status === 'delivered' ? tm.delivered : status}
          </span>
          {inA !== undefined
            ? <>{' · '}<button type="button" className="lnk message-link" title={tc.inThreadTitle(selfName)} onClick={() => onLight(inA)}>{tc.inThread}</button></>
            : peerKnown && b.inB !== undefined && <>{' · '}<button type="button" className="lnk message-link" title={tm.seeIn(peerName)} onClick={() => onOpenPeer(b.inB)}>{tm.seeTheirs}</button></>}
        </span>
      </div>
    </li>
  );
});
