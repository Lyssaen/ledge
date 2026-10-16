import { useI18n } from '../i18n/lang';
import { Composer } from './Composer';
import { ConversationHeader, type ConversationProps } from './Header';
import { blocked } from './sends';
import { Thread } from './Thread';
import { useThreadRequest } from './useThreadRequest';

/** The selected session's conversation (mockup conversation.js l. 50-58). Never `data-session`: views count those. The
 *  read-only banner is a `status`, never an `alert` (the local daemon's alert stays the only one, e2e/offline.spec.ts). */
export function ConversationPane(p: ConversationProps) {
  const { t } = useI18n();
  const items = useThreadRequest(p.client, p.session);
  const frozen = blocked(p.session);
  return (
    <aside id="conversation-pane" className="detail conversation" data-conversation={p.session.id} aria-label={t.conversation.label(p.session.name)}>
      <ConversationHeader key={p.session.id} {...p} />
      {frozen && <div className="conversation-offline" role="status">{t.conversation[frozen]}</div>}
      <Thread key={`thread-${p.session.id}`} session={p.session} items={items} api={p.api} />
      <Composer key={`composer-${p.session.id}`} session={p.session} api={p.api} />
    </aside>
  );
}
