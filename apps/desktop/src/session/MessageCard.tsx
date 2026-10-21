import { useState, type JSX, type ReactNode } from 'react';
import type { ReceivedItem, SentItem, Session } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot } from '../shell/SessionBot';

/** A delivery's mark: on the card, its folded line, and the Conversation tab's bubbles. */
export const STATUS_MARK: Record<SentItem['status'], string> = { delivered: '✓', read: '✓✓', sending: '…', failed: '✕' };

/** Longer than this many characters or lines, a message's body is clamped until « Lire tout le message ». */
const LONG_CHARS = 200;
const LONG_LINES = 3;
export const isLong = (text: string): boolean => text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;
/** A folded line's text: the first line, without Markdown's `*` and backticks. */
export const firstLine = (text: string): string =>
  (text.split('\n').map(l => l.trim()).find(Boolean) ?? '').replace(/^(?:#+|>|-|\*)\s*/, '').replace(/[`*]/g, '');

export interface MessageCardProps {
  item: SentItem | ReceivedItem;
  /** The session whose thread this is. */
  self: Session;
  /** The other agent's session; null: not one Ledge knows (its raw name, no bot). */
  peer: Session | null;
  /** The conversation's header, on its first message when the thread holds two or more with that peer; null: none. */
  header: { count: number } | null;
  folded: boolean;
  /** Brought into view from the other agent's thread: lit for a moment. */
  lit?: boolean;
  /** Its time on the rail (HH:MM). */
  time: string;
  onFold(): void;
  /** « voir son fil »: the peer's session. */
  onOpenPeer(): void;
  /** This conversation's tab is the pane's active one (the header's « Ouvert à côté »). */
  following: boolean;
  /** « suivre la conversation »: its tab beside the thread; absent: no way to it (a subagent's page). */
  onFollow?(): void;
}

/** A message between this agent and another, as rail rows (the mockup's bubbles): the conversation's header when it opens
 *  one, then the bubble — received on the left, « De Iris · voir son fil »; sent on the right, « À Nova · lu » — its body
 *  clamped when long; folded, one line. The direction's node sits on the rail: an envelope out, a reply in. */
export function MessageCard({ item, self, peer, header, folded, lit, time, onFold, onOpenPeer, following, onFollow }: MessageCardProps): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const tc = t.session.conversation;
  const [more, setMore] = useState(false);
  const sent = item.kind === 'sent';
  const peerName = peer?.name ?? (sent ? item.to : item.from);
  const me = { name: self.name, session: self }, them = { name: peerName, session: peer };
  const [from, to] = sent ? [me, them] : [them, me];
  const bot = (who: typeof me | typeof them, size: number): ReactNode => who.session ? <SessionBot session={who.session} size={size} /> : null;
  const paired = sent ? item.received : item.sent;
  const lineText = sent && item.summary ? item.summary : firstLine(item.text);
  const node = <span className="n node" aria-hidden="true"><Icon d={sent ? SHELL_ICONS.mail : SHELL_ICONS.restore} size={12} /></span>;

  const head = header && (
    <li className="r message-head-row">
      <span className="n" />
      <div className={`message-head ${item.kind}`}>
        <Icon d={SHELL_ICONS.mail} size={12} /><span>{tm.conversation(peerName, header.count)}</span><span className="spacer" />
        {/* The conversation beside the thread; pressed while its tab is the active one, as the plan card's button. */}
        {onFollow && (
          <button type="button" className="lnk message-fold conv-follow" aria-pressed={following} title={tc.followTitle(peerName)} onClick={onFollow}>
            {following ? tc.openBeside : tc.followBeside}<Icon d={ICONS.chevronRight.d} size={12} />
          </button>
        )}
        <button type="button" className="lnk message-fold" aria-expanded={!folded} onClick={onFold}>{folded ? tm.unfold : tm.fold}<Icon d={SHELL_ICONS.chevronDown} size={12} /></button>
      </div>
      <span className="tm" />
    </li>
  );

  if (folded) return <>{head}
    <li className={`r message-row ${item.kind}`}>
      {node}
      <button type="button" className={cls('message-line', item.kind, lit && 'lit')} data-message={item.id} onClick={onFold}>
        <span className="message-route">{bot(from, 14)}<strong>{from.name}</strong><Icon d={SHELL_ICONS.arrowRight} size={11} /><strong>{to.name}</strong></span>
        <span className="message-line-text">{lineText}</span>
        {sent && <Status item={item} peer={peerName} short />}
      </button>
      <span className="tm">{time}</span>
    </li>
  </>;

  const long = isLong(item.text);
  return <>{head}
    <li className={`r message-row ${item.kind}`}>
      {node}
      <div className={cls('message-card', item.kind, lit && 'lit')} data-message={item.id} role="article">
        <span className="visually-hidden message-kicker">{sent ? tm.sent : tm.received}</span>
        <span className="who message-route">
          {sent ? tm.to : tm.from} {bot(sent ? to : from, 14)}<strong>{peerName}</strong>
          {sent && <> · <Status item={item} peer={peerName} /></>}
          {peer && (!sent || paired) && <> · <button type="button" className="lnk message-link" title={tm.seeIn(peerName)} onClick={onOpenPeer}>{tm.seeTheirs}</button></>}
          {onFollow && <> · <button type="button" className="lnk message-link" title={tc.followTitle(peerName)} onClick={onFollow}>{tc.follow}</button></>}
        </span>
        {sent && item.summary && <p className="message-summary">{item.summary}</p>}
        <div className={cls('message-body', long && !more && 'clamped')}><ThreadMarkdown text={item.text} /></div>
        {long && <button type="button" className="lnk message-link" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? tm.showLess : tm.readAll}<Icon d={ICONS.chevronRight.d} size={12} /></button>}
      </div>
      <span className="tm">{time}</span>
    </li>
  </>;
}

/** A sent message's delivery: its mark and a word (« lu », « Envoi… »), its full meaning as the tooltip; `short` (a folded
 *  line): the mark, the meaning for screen readers. */
function Status({ item, peer, short }: { item: SentItem; peer: string; short?: boolean }): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const label = item.status === 'read' ? tm.readBy(peer) : tm[item.status];
  return (
    <span className={cls('message-read', item.status === 'read' && 'is-read')} title={label}>
      <i aria-hidden="true">{STATUS_MARK[item.status]}</i>{short ? <span className="visually-hidden">{label}</span> : item.status === 'read' ? tm.seen : label}
    </span>
  );
}
