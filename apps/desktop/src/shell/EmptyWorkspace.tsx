import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from './theme';

/** No session on any machine, whatever the view (spec §9.1). Talking to Ledge and launching a session come with later lots. */
export function EmptyWorkspace() {
  const { t } = useI18n(); const theme = useTheme();
  return (
    <section className="workspace-empty">
      <Bot tool="claude" state="idle" pose={poseFor('empty', 'idle')} size={64} theme={theme} seed="empty" />
      <h3>{t.empty.title}</h3>
      <p>{t.empty.text}</p>
    </section>
  );
}
