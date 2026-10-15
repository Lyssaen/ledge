import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from './theme';

/** No session on any machine, whatever the view (spec §9.1): the way to a first launch (spec §9.2). Talking to Ledge comes with a later lot. */
export function EmptyWorkspace({ onNewSession }: { onNewSession?: () => void }) {
  const { t } = useI18n(); const theme = useTheme();
  return (
    <section className="workspace-empty">
      <Bot tool="claude" state="idle" pose={poseFor('empty', 'idle')} size={64} theme={theme} seed="empty" />
      <h3>{t.empty.title}</h3>
      <p>{t.empty.text}</p>
      <button type="button" className="primary" data-open-launch="empty" disabled={!onNewSession} onClick={onNewSession}><span className="plus" aria-hidden="true">+</span>{t.empty.start}</button>
    </section>
  );
}
