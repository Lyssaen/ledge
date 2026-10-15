import { useI18n } from '../i18n/lang';
import { ConversationHeader, type ConversationProps } from './Header';
import { Thread } from './Thread';
import { useThreadRequest } from './useThreadRequest';

/** The selected session's conversation (mockup conversation.js). Never `data-session`: views count those. */
export function ConversationPane(p: ConversationProps) {
  const { t } = useI18n();
  const items = useThreadRequest(p.client, p.session);
  return (
    <aside id="conversation-pane" className="detail conversation" data-conversation={p.session.id} aria-label={t.conversation.label(p.session.name)}>
      <ConversationHeader key={p.session.id} {...p} />
      <Thread key={`thread-${p.session.id}`} session={p.session} items={items} api={p.api} />
    </aside>
  );
}
