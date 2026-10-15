import { useState } from 'react';
import { CATEGORIES, VOLUMES } from '@ledge/ui/sounds/preferences';
import { useI18n } from '../i18n/lang';
import { useSoundPrefs } from '../notify/prefs';
import { SelectRow, Toggle } from './controls';

/** Settings › Sounds (spec §10; decision 15): off by default on Desktop; the options are frozen while sounds are off. */
export function SoundsPanel({ testSound }: { testSound(): 'played' | 'dnd' }) {
  const { t } = useI18n();
  const c = t.settings.sounds;
  const { sounds, setSounds } = useSoundPrefs();
  const [dndNote, setDndNote] = useState(false);
  return (
    <>
      <h3>{c.title}</h3>
      <Toggle label={c.enabled} hint={c.enabledHint} checked={sounds.enabled} onChange={on => setSounds({ enabled: on })} />
      <fieldset className="sound-options" disabled={!sounds.enabled}>
        <legend>{c.custom}</legend>
        <SelectRow label={c.volume} hint={c.volumeHint} value={sounds.volume} options={VOLUMES.map(v => [v, c.volumes[v]] as const)} onChange={volume => setSounds({ volume })} />
        <div className="settings-actions">
          <button type="button" className="settings-button" onClick={() => setDndNote(testSound() === 'dnd')}>{c.test}</button>
          {dndNote && <span className="settings-note" role="status">{c.dndOn}</span>}
        </div>
        <h4>{c.when}</h4>
        {CATEGORIES.map(k => (
          <label key={k} className="sound-category">
            <input type="checkbox" checked={sounds.categories[k]} onChange={e => setSounds({ categories: { [k]: e.target.checked } })} />{c.categories[k]}
          </label>
        ))}
        <Toggle label={c.behind} hint={c.behindHint} checked={sounds.onlyWhenTerminalBehind} onChange={on => setSounds({ onlyWhenTerminalBehind: on })} />
      </fieldset>
      <p className="settings-note">{c.note}</p>
    </>
  );
}
