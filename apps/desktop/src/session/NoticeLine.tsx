import type { JSX } from 'react';
import type { NoticeItem, Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';

/** The notices that tell of something gone wrong: said in a warning tone. */
const WARN = new Set(['held', 'denied', 'expired', 'refused', 'dropped']);

export interface NoticeLineProps {
  item: NoticeItem;
  /** The session the notice is about, when Ledge knows it; null: its quoted name only. */
  peer: Session | null;
  /** « Ouvrir Nova »: that session's page. */
  onOpenPeer(): void;
}

/** A notice of the agent's harness about messages between sessions (Claude Code's `[Cross-session idle notice]`,
 *  `[Cross-session delivery notice]`): a quiet system line — who finished and when, with what its harness reported, or
 *  what became of a message — never a prompt nor a message. Its original text is the line's tooltip. */
export function NoticeLine({ item, peer, onOpenPeer }: NoticeLineProps): JSX.Element {
  const { t } = useI18n();
  const tn = t.session.notice;
  const name = peer?.name ?? item.name ?? tn.anotherSession;
  let title: string;
  switch (item.notice) {
    case 'idle': title = tn.idle(name, item.time); break;
    case 'exited': title = tn.exited(name, item.time); break;
    case 'unavailable': title = tn.unavailable(name); break;
    case 'expired': title = tn.expired(name); break;
    case 'delivery': {
      const count = item.count ?? 1;
      const to = item.recipients?.length ? item.recipients.join(', ') : tn.anotherSession;
      title = `${tn.messages(count, to)} ${tn.status[item.status ?? 'unknown'](count > 1)}`;
      break;
    }
    // Any other notice, an old task or team one included: its own text, as a quiet line.
    default: title = tn.other;
  }
  const warn = item.notice === 'unavailable' || item.notice === 'expired' || (item.notice === 'delivery' && WARN.has(item.status ?? ''));
  return (
    <div className={cls('notice-line', warn && 'warn')} data-notice={item.id} role="note" title={item.text}>
      <div className="notice-head">
        <span className="notice-kicker"><Icon d={SHELL_ICONS.mail} size={12} />{tn.kicker}</span>
        <span className="notice-title">{title}</span>
        {peer && item.notice !== 'delivery' && <span className="spacer" />}
        {peer && item.notice !== 'delivery' && <button type="button" className="message-link" onClick={onOpenPeer}>{tn.open(peer.name)}<Icon d={ICONS.chevronRight.d} size={12} /></button>}
      </div>
      {item.summary && <blockquote className="notice-summary">{item.summary}</blockquote>}
    </div>
  );
}
