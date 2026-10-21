import { useState, type JSX, type ReactNode } from 'react';
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

/** The « Conversation » tab: its head (the pair, the count), then the messages of both agents, one bubble each, in the order
 *  they were sent. `buttons`: the pane's « Agrandir » / « Fermer ». */
export function ConversationTab({ self, view, buttons }: { self: Session; view: ConversationView; buttons: ReactNode }): JSX.Element {
  const { t } = useI18n();
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
              <BubbleRow key={b.key} b={b} first={bubbles[i - 1]?.from !== b.from} name={name(b.from)} to={name(b.from === 'a' ? 'b' : 'a')} bot={bot(b.from)} />
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}

/** One message: who wrote it (on the first of a run), its summary and body (clamped when long, as the thread's card), then
 *  its time and its delivery. A's on the right, filled, as « sent » in the thread; B's on the left. */
function BubbleRow({ b, first, name, to, bot }: { b: Bubble; first: boolean; name: string; to: string; bot: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const tc = t.session.conversation;
  const [more, setMore] = useState(false);
  const long = isLong(b.text);
  const mine = b.from === 'a';
  const status = b.status === 'read' ? tc.readBy(to) : b.status === 'delivered' ? tc.deliveredTo(to) : tm[b.status];
  return (
    <li className={cls('conv-row', mine ? 'mine' : 'theirs', first && 'first')}>
      <div className={cls('message-card conv-bubble', mine ? 'sent' : 'received')} role="article" data-bubble={b.key}>
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
        </span>
      </div>
    </li>
  );
}
