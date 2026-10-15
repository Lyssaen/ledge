import { useI18n } from '../i18n/lang';
import { ConversationHeader, type ConversationProps } from './Header';

/** The selected session's conversation (mockup conversation.js). Never `data-session`: views count those. */
export function ConversationPane(p: ConversationProps) {
  const { t } = useI18n();
  return (
    <aside id="conversation-pane" className="detail conversation" data-conversation={p.session.id} aria-label={t.conversation.label(p.session.name)}>
      <ConversationHeader key={p.session.id} {...p} />
    </aside>
  );
}
