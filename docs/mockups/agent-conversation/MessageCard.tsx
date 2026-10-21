// apps/desktop/src/session/MessageCard.tsx with the two entry points of the « Conversation » tab, and nothing else changed:
// the conversation header's « Suivre à côté » pill (« Ouvert à côté » while its tab is the active one), and each card's
// « suivre la conversation » link. The build swaps it in for the thread (build.mjs); diff it against the app's to see the change.
import { useContext, useState, type JSX, type ReactNode } from 'react';
import type { SentItem } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../../apps/desktop/src/i18n/lang';
import { cls } from '../../../apps/desktop/src/shell/cls';
import { SHELL_ICONS } from '../../../apps/desktop/src/shell/icons';
import { SessionBot } from '../../../apps/desktop/src/shell/SessionBot';
import { firstLine, isLong, type MessageCardProps } from '../../../apps/desktop/src/session/MessageCard';
import { peerKey } from '../../../apps/desktop/src/session/exchanges';
import { conversationCopy } from './copy';
import { ConversationContext } from './context';

export { firstLine, isLong };

const STATUS_MARK: Record<SentItem['status'], string> = { delivered: '✓', read: '✓✓', sending: '…', failed: '✕' };

export function MessageCard({ item, self, peer, header, folded, lit, time, onFold, onOpenPeer }: MessageCardProps): JSX.Element {
  const { t, lang } = useI18n();
  const tm = t.session.message;
  const tc = conversationCopy(lang);
  const conv = useContext(ConversationContext);
  const [more, setMore] = useState(false);
  const sent = item.kind === 'sent';
  const peerName = peer?.name ?? (sent ? item.to : item.from);
  const me = { name: self.name, session: self }, them = { name: peerName, session: peer };
  const [from, to] = sent ? [me, them] : [them, me];
  const bot = (who: typeof me | typeof them, size: number): ReactNode => who.session ? <SessionBot session={who.session} size={size} /> : null;
  const paired = sent ? item.received : item.sent;
  const lineText = sent && item.summary ? item.summary : firstLine(item.text);
  const node = <span className="n node" aria-hidden="true"><Icon d={sent ? SHELL_ICONS.mail : SHELL_ICONS.restore} size={12} /></span>;
  const key = peerKey(item);
  const opened = conv.open === key;

  const head = header && (
    <li className="r message-head-row">
      <span className="n" />
      <div className={`message-head ${item.kind}`}>
        <Icon d={SHELL_ICONS.mail} size={12} /><span>{tm.conversation(peerName, header.count)}</span><span className="spacer" />
        {/* New: the conversation beside the thread. Pressed while its tab is the active one, as the plan card's button. */}
        <button type="button" className={cls('lnk message-fold conv-follow', opened && 'on')} aria-pressed={opened} title={tc.followTitle(peerName)} onClick={() => conv.onOpen(key)}>
          {opened ? tc.openBeside : tc.followBeside}<Icon d={ICONS.chevronRight.d} size={12} />
        </button>
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
          {/* New: every card opens its conversation (an unknown peer too: then one side only). */}
          {' · '}<button type="button" className="lnk message-link" title={tc.followTitle(peerName)} onClick={() => conv.onOpen(key)}>{tc.follow}</button>
        </span>
        {sent && item.summary && <p className="message-summary">{item.summary}</p>}
        <div className={cls('message-body', long && !more && 'clamped')}><ThreadMarkdown text={item.text} /></div>
        {long && <button type="button" className="lnk message-link" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? tm.showLess : tm.readAll}<Icon d={ICONS.chevronRight.d} size={12} /></button>}
      </div>
      <span className="tm">{time}</span>
    </li>
  </>;
}

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
