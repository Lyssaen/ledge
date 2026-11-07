import { useId, type JSX } from 'react';
import { useI18n } from '../i18n/lang';
import { useOpenSession, type OpenSession } from '../workspace/openPrefs';
import { useWebglMax } from '../term/webglPrefs';
import { WEBGL_MAX, WEBGL_MIN } from '../term/webgl';
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
  const [webgl, setWebgl] = useWebglMax();
  const step = (d: number) => { const n = Math.max(WEBGL_MIN, Math.min(WEBGL_MAX, webgl + d)); if (n === webgl) return; setWebgl(n); ctx.saved(w.webglSaved(n)); };
  return (
    <>
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
    <Card title={w.terminals}>
      <Row label={w.webglBefore}>
        <span className="set-step-line">
          <span className="set-step" role="group" aria-label={w.webglBefore}>
            <button type="button" aria-label={w.webglLess} disabled={webgl <= WEBGL_MIN} onClick={() => step(-1)}>−</button>
            <output aria-live="polite">{webgl}</output>
            <button type="button" aria-label={w.webglMore} disabled={webgl >= WEBGL_MAX} onClick={() => step(1)}>+</button>
          </span>
          {w.webglAfter}
        </span>
      </Row>
    </Card>
    </>
  );
}
