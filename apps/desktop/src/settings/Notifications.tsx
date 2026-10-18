import type { JSX } from 'react';
import { FINISHED_VALUES } from '@ledge/ui/sounds/preferences';
import { useI18n } from '../i18n/lang';
import { useDnd, useSoundPrefs } from '../notify/prefs';
import { Card, Row, Segmented, SwitchRow } from './controls';
import type { SettingsContext } from './SettingsPage';

/** Settings › Notifications (settings.tsx, `notifications`): do not disturb (the tray's too: one store) and what a finished
 *  agent does. Each accepted change says « Setting saved » once. */
export function Notifications({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const n = t.settings.notifications;
  const [dnd, setDnd] = useDnd();
  const { finished, setFinished } = useSoundPrefs();
  return (
    <>
      <Card>
        <SwitchRow label={n.dnd} hint={n.dndHint} checked={dnd} onChange={on => { setDnd(on); ctx.saved(n.dndSaved(on)); }} />
        <Row label={n.finished} hint={n.finishedHint} stack>
          <Segmented label={n.finished} value={finished} options={FINISHED_VALUES.map(v => ({ value: v, label: n.modes[v] }))}
            onChange={v => { if (v === finished) return; setFinished(v); ctx.saved(n.finishedSaved(n.modes[v])); }} />
        </Row>
      </Card>
      <p className="set-footnote">{n.note}</p>
    </>
  );
}
