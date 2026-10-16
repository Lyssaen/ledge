import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { ChatTrigger } from '../chat/ChatTrigger';
import { useTheme } from './theme';

/** No session on any machine, whatever the view (spec §9.1): talking to Ledge (spec §9.3) or a first launch (spec §9.2). */
export function EmptyWorkspace({ onNewSession, chat }: { onNewSession?: () => void; chat?: { open: boolean; onOpen: () => void } }) {
  const { t } = useI18n(); const theme = useTheme();
  return (
    <section className="workspace-empty">
      <Bot tool="claude" state="idle" pose={poseFor('empty', 'idle')} size={64} theme={theme} seed="empty" />
      <h3>{t.empty.title}</h3>
      <p>{t.empty.text}</p>
      <div className="workspace-empty-actions">
        {chat && <ChatTrigger open={chat.open} onOpen={chat.onOpen} place="empty" />}
        <button type="button" className="primary" data-open-launch="empty" disabled={!onNewSession} onClick={onNewSession}><span className="plus" aria-hidden="true">+</span>{t.empty.start}</button>
      </div>
    </section>
  );
}
