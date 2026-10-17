import { useState, type JSX } from 'react';
import { CATEGORIES, VOLUMES } from '@ledge/ui/sounds/preferences';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { useDnd, useSoundPrefs } from '../notify/prefs';
import { Card, Row, Segmented, SwitchRow } from './controls';
import type { SettingsContext } from './SettingsPage';

/** Settings › Sounds (settings.tsx, `sounds`): off by default on Desktop; the options are frozen while sounds are off. Test goes
 *  through the alerts (the question cue at the chosen volume), which answer 'dnd' under Do not disturb. */
export function Sounds({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.sounds;
  const { sounds, setSounds } = useSoundPrefs();
  const [dnd] = useDnd();
  const [refused, setRefused] = useState(false);
  const { saved } = ctx;
  return (
    <>
      <Card>
        <SwitchRow label={c.enabled} hint={c.enabledHint} checked={sounds.enabled} onChange={on => { setSounds({ enabled: on }); saved(c.enabledSaved(on)); }} />
        <fieldset className="set-fieldset" disabled={!sounds.enabled}>
          <legend className="visually-hidden">{c.custom}</legend>
          <Row label={c.volume} hint={c.volumeHint}>
            <div className="set-inline">
              <Segmented label={c.volume} value={sounds.volume} disabled={!sounds.enabled} options={VOLUMES.map(v => ({ value: v, label: c.volumes[v] }))}
                onChange={v => { if (v === sounds.volume) return; setSounds({ volume: v }); saved(c.volumeSaved(c.volumes[v])); }} />
              <Button size="sm" variant="outline" onClick={() => setRefused(ctx.alerts.test() === 'dnd')}>{c.test}</Button>
            </div>
            {refused && dnd && <span className="set-hint" role="status"><strong className="set-warn">{c.dndOn}</strong></span>}
          </Row>
          <div className="set-row stack">
            <span className="set-label" id="play-when">{c.when}</span>
            <div className="check-list" role="group" aria-labelledby="play-when">
              {CATEGORIES.map(k => (
                <label key={k}>
                  <input type="checkbox" checked={sounds.categories[k]} onChange={e => { setSounds({ categories: { [k]: e.target.checked } }); saved(c.categories[k]); }} />{c.categories[k]}
                </label>
              ))}
            </div>
          </div>
          <SwitchRow label={c.behind} hint={c.behindHint} checked={sounds.onlyWhenTerminalBehind} disabled={!sounds.enabled}
            onChange={on => { setSounds({ onlyWhenTerminalBehind: on }); saved(c.behindSaved(on)); }} />
        </fieldset>
      </Card>
      <p className="set-footnote">{c.note}</p>
    </>
  );
}
