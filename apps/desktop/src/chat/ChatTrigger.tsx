import { ResidentMascot } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';

/** « Parler à Ledge » (mockup ledge-chat.js, app.js): opens the chat, never closes it (choosing a session does). */
export function ChatTrigger({ open, onOpen, place }: { open: boolean; onOpen: () => void; place: 'heading' | 'empty' }) {
  const { t } = useI18n(); const theme = useTheme();
  return (
    <button type="button" className="ledge-chat-trigger" data-open-ledge={place} aria-pressed={open} onClick={onOpen}>
      <span aria-hidden="true"><ResidentMascot size={22} theme={theme} paused /></span>{t.chat.trigger}
    </button>
  );
}
