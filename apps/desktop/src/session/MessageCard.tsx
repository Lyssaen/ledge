import { useState, type JSX, type ReactNode } from 'react';
import type { ReceivedItem, SentItem, Session } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot } from '../shell/SessionBot';

const STATUS_MARK: Record<SentItem['status'], string> = { delivered: '✓', read: '✓✓', sending: '…', failed: '✕' };

/** Longer than this many characters or lines, a message's body is clamped until « Lire tout le message ». */
const LONG_CHARS = 200;
const LONG_LINES = 3;
export const isLong = (text: string): boolean => text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;
/** A folded line's text: the first line, without Markdown's `*` and backticks. */
export const firstLine = (text: string): string => text.split('\n')[0]!.replace(/[`*]/g, '');

export interface MessageCardProps {
  item: SentItem | ReceivedItem;
  /** The session whose thread this is. */
  self: Session;
  /** The other agent's session; null: not one Ledge knows (its raw name, no bot). */
  peer: Session | null;
  /** The conversation's header, on its first message when the thread holds two or more with that peer; null: none. */
  header: { count: number } | null;
  folded: boolean;
  onFold(): void;
  /** « Voir dans le fil de X »: the peer's session. */
  onOpenPeer(): void;
}

/** A message between this agent and another (the mockup's ExchangeCard): who wrote to whom, the summary and delivery of a
 *  sent one, its body clamped when long, a way to the peer's thread when the paired message is there; folded, one line. */
export function MessageCard({ item, self, peer, header, folded, onFold, onOpenPeer }: MessageCardProps): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const [more, setMore] = useState(false);
  const sent = item.kind === 'sent';
  const peerName = peer?.name ?? (sent ? item.to : item.from);
  const me = { name: self.name, session: self }, them = { name: peerName, session: peer };
  const [from, to] = sent ? [me, them] : [them, me];
  const bot = (who: typeof me | typeof them, size: number): ReactNode => who.session ? <SessionBot session={who.session} size={size} /> : null;
  const paired = sent ? item.received : item.sent;
  const lineText = sent && item.summary ? item.summary : firstLine(item.text);

  const head = header && (
    <div className={`message-head ${item.kind}`}>
      <Icon d={SHELL_ICONS.mail} size={12} /><span>{tm.conversation(peerName, header.count)}</span><span className="spacer" />
      <button type="button" className="message-fold" aria-expanded={!folded} onClick={onFold}>{folded ? tm.unfold : tm.fold}<Icon d={SHELL_ICONS.chevronDown} size={12} /></button>
    </div>
  );

  if (folded) return <>{head}
    <button type="button" className={`message-line ${item.kind}`} data-message={item.id} onClick={onFold}>
      <span className="message-route">{bot(from, 14)}<strong>{from.name}</strong><Icon d={SHELL_ICONS.arrowRight} size={11} /><strong>{to.name}</strong></span>
      <span className="message-line-text">{lineText}</span>
      {sent && <Status item={item} peer={peerName} short />}
    </button>
  </>;

  const long = isLong(item.text);
  return <>{head}
    <div className={`message-card ${item.kind}`} data-message={item.id} role="article">
      <div className="message-card-head">
        <span className="message-kicker"><Icon d={SHELL_ICONS.mail} size={12} />{sent ? tm.sent : tm.received}</span>
        <span className="message-route">{bot(from, 18)}<strong>{from.name}</strong><Icon d={SHELL_ICONS.arrowRight} size={12} />{bot(to, 18)}<strong>{to.name}</strong></span>
        <span className="spacer" />
        {sent && <Status item={item} peer={peerName} />}
      </div>
      {sent && item.summary && <p className="message-summary">{item.summary}</p>}
      <div className={cls('message-body', long && !more && 'clamped')}><ThreadMarkdown text={item.text} /></div>
      <div className="message-foot">
        {long && <button type="button" className="message-link" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? tm.showLess : tm.readAll}</button>}
        {peer && paired && <><span className="spacer" /><button type="button" className="message-link" onClick={onOpenPeer}>{tm.seeIn(peerName)}<Icon d={ICONS.chevronRight.d} size={12} /></button></>}
      </div>
    </div>
  </>;
}

/** A sent message's delivery: its mark, and in full (not `short`) what it means. */
function Status({ item, peer, short }: { item: SentItem; peer: string; short?: boolean }): JSX.Element {
  const { t } = useI18n();
  const tm = t.session.message;
  const label = item.status === 'read' ? tm.readBy(peer) : tm[item.status];
  return (
    <span className={cls('message-read', item.status === 'read' && 'is-read')} title={label}>
      <i aria-hidden="true">{STATUS_MARK[item.status]}</i>{short ? <span className="visually-hidden">{label}</span> : label}
    </span>
  );
}
