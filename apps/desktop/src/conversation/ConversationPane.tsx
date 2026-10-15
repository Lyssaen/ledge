import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

/** The selected session's conversation (mockup conversation.js). Never `data-session`: views count those. */
export function ConversationPane({ session, expanded, onExpand }: { session: Session; expanded: boolean; onExpand: (on: boolean) => void }) {
  const { t } = useI18n();
  return (
    <aside id="conversation-pane" className="detail conversation" data-conversation={session.id} aria-label={t.conversation.label(session.name)}>
      <header className="conversation-header">
        <div className="conversation-top">
          <span>{t.conversation.eyebrow}</span>
          <button type="button" data-expand-conversation aria-expanded={expanded} onClick={() => onExpand(!expanded)}>{expanded ? t.conversation.collapse : t.conversation.expand}</button>
        </div>
        <h3>{session.topic || session.title}</h3>
      </header>
    </aside>
  );
}
