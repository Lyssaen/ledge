import { ResidentMascot } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';

/** « Parler à Ledge » (mockup ledge-chat.js, app.js): opens the chat, never closes it (choosing a session does; plan decision 4).
 *  Not a toggle, so no `aria-pressed` (the mockup's): `aria-current` says the chat is the place shown, without promising that
 *  a second press closes it. */
export function ChatTrigger({ open, onOpen, place }: { open: boolean; onOpen: () => void; place: 'heading' | 'empty' }) {
  const { t } = useI18n(); const theme = useTheme();
  return (
    <button type="button" className="ledge-chat-trigger" data-open-ledge={place} aria-current={open ? 'true' : undefined} onClick={onOpen}>
      <span aria-hidden="true"><ResidentMascot size={22} theme={theme} paused /></span>{t.chat.trigger}
    </button>
  );
}
