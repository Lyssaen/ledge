import { FINISHED_VALUES } from '@ledge/ui/sounds/preferences';
import { useI18n } from '../i18n/lang';
import { useDnd, useSoundPrefs } from '../notify/prefs';
import { SelectRow, Toggle } from './controls';

/** Settings › Notifications (spec §10; decisions 5, 6): do not disturb and how a finished task is announced. */
export function NotificationsPanel() {
  const { t } = useI18n();
  const c = t.settings.notifications;
  const [dnd, setDnd] = useDnd();
  const { finished, setFinished } = useSoundPrefs();
  return (
    <>
      <h3>{c.title}</h3>
      <Toggle label={c.dnd} hint={c.dndHint} checked={dnd} onChange={setDnd} />
      <SelectRow label={c.finished} hint={c.finishedHint} value={finished} options={FINISHED_VALUES.map(v => [v, c.modes[v]] as const)} onChange={setFinished} />
      <p className="settings-note">{c.note}</p>
    </>
  );
}
