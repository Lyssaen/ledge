import { useId, type JSX } from 'react';
import { useI18n } from '../i18n/lang';
import { useOpenSession, type OpenSession } from '../workspace/openPrefs';
import { Card, Row } from './controls';
import type { SettingsContext } from './SettingsPage';

const WHERE: readonly OpenSession[] = ['active', 'right'];

/** Settings › Workspace (mockup settingsPage(), IDE only): « Ouvrir une session », in the active group or to its right, as radios.
 *  « Nouvelle fenêtre » waits for lot 9; the start-up, layouts, status bar and terminals rows for later lots. */
export function WorkspaceSection({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const w = t.settings.workspace;
  const [where, setWhere] = useOpenSession();
  const name = useId();
  return (
    <Card>
      <Row label={w.openSession}>
        {describedBy => (
          <div className="set-radios" role="radiogroup" aria-label={w.openSession} aria-describedby={describedBy}>
            {WHERE.map(v => (
              <label key={v}>
                <input type="radio" name={name} value={v} checked={where === v} onChange={() => { setWhere(v); ctx.saved(w.saved(w[v])); }} />{w[v]}
              </label>
            ))}
          </div>
        )}
      </Row>
    </Card>
  );
}
