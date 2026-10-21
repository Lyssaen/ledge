import { useState, type JSX, type MouseEvent, type ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot } from '../shell/SessionBot';
import type { Bubble } from './conversation';
import { clock } from './exchanges';
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
 *  each, in the order they were sent. */
export function ConversationTab({ self, view, buttons, onLight, onOpenPeer }: ConversationTabProps): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const tc = t.session.conversation;
  const { peer, name: peerName, bubbles } = view;
  const name = (from: Bubble['from']) => (from === 'a' ? self.name : peerName);
  const bot = (from: Bubble['from']) => (from === 'a' ? <SessionBot session={self} size={14} /> : peer ? <SessionBot session={peer} size={14} /> : null);

  return (
    <>
      <div className="side-head conv-head">
        <span className="side-title conv-title">
          <span className="conv-pair">
            <SessionBot session={self} size={18} /><strong>{self.name}</strong>
            <Icon d={SHELL_ICONS.exchange} size={13} />
            {peer && <SessionBot session={peer} size={18} />}<strong title={peerName}>{peerName}</strong>
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
        <div className="side-body conv-body">
          {view.loading && <p className="conv-loading muted">{tc.loadingPeer(peerName)}</p>}
          {bubbles.length === 0 && !view.loading && (
            <div className="changes-empty conv-empty"><Icon d={SHELL_ICONS.mail} size={22} /><strong>{tc.empty(self.name, peerName)}</strong><p>{tc.emptyHint}</p></div>
          )}
          {/* Mounted even when empty, so the first message that comes is announced. */}
          <ol className="conv-log" role="log" aria-label={tc.log(self.name, peerName)}>
            {bubbles.map((b, i) => (
              <BubbleRow key={b.key} b={b} first={bubbles[i - 1]?.from !== b.from} name={name(b.from)} to={name(b.from === 'a' ? 'b' : 'a')} bot={bot(b.from)}
                peerKnown={peer !== null} peerName={peerName} selfName={self.name} onLight={onLight} onOpenPeer={onOpenPeer} />
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}

/** One message: who wrote it (on the first of a run), its summary and body (clamped when long, as the thread's card), then
 *  its time, its delivery and where to find it. A's on the right, filled, as « sent » in the thread; B's on the left. */
function BubbleRow({ b, first, name, to, bot, peerKnown, peerName, selfName, onLight, onOpenPeer }: {
  b: Bubble; first: boolean; name: string; to: string; bot: ReactNode; peerKnown: boolean; peerName: string; selfName: string;
  onLight(id: string): void; onOpenPeer(item?: string): void;
}): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const tc = t.session.conversation;
  const [more, setMore] = useState(false);
  const long = isLong(b.text);
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
        {first && <span className="who conv-who" aria-hidden="true">{bot}<strong>{name}</strong></span>}
        {b.summary && <p className="message-summary">{b.summary}</p>}
        <div className={cls('message-body', long && !more && 'clamped')}><ThreadMarkdown text={b.text} /></div>
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
}
