import { useId, type JSX } from 'react';
import { useUsage } from '@ledge/fleet';
import { USAGE_ALERT_MAX, USAGE_ALERT_MIN } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { usageThreshold } from '../usage/model';
import { useShowUsage } from '../workspace/prefs';
import { useOpenSession, type OpenSession } from '../workspace/openPrefs';
import { useWebglMax } from '../term/webglPrefs';
import { WEBGL_MAX, WEBGL_MIN } from '../term/webgl';
import { EDITORS, EDITOR_NAMES, useEditor, useEditorsInstalled } from '../ide/openIn';
import { Card, Row } from './controls';
import type { SettingsContext } from './SettingsPage';

const WHERE: readonly OpenSession[] = ['active', 'right'];

const ALERT_MIN = Math.round(USAGE_ALERT_MIN * 100);
const ALERT_MAX = Math.round(USAGE_ALERT_MAX * 100);

/** Settings › Workspace (mockup settingsPage(), IDE only): « Ouvrir une session », in the active group or to its right, as radios;
 *  the status bar (the usage limits shown or not, the alert threshold the daemons keep, General's own); the terminals' WebGL budget.
 *  « Ouvrir dans… » (lot 11, docs/mockups/ledge-ide-open-in.html states 3 and 5): Cursor, VS Code or Zed; « non installé » in grey after an
 *  editor this PC lacks, once known (nothing before), and « pas les dossiers WSL » after Zed, always. « Nouvelle fenêtre » waits for lot 9,
 *  the start-up and layouts rows for lot 10. */
export function WorkspaceSection({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const w = t.settings.workspace;
  const [where, setWhere] = useOpenSession();
  const name = useId();
  const editorName = useId();
  const [editor, setEditor] = useEditor();
  const installed = useEditorsInstalled();
  const [webgl, setWebgl] = useWebglMax();
  const [showUsage, setShowUsage] = useShowUsage();
  // The usage alert: the same threshold as General's (one for every window and harness, kept by each machine's daemon), by 5 %.
  const usage = useUsage(ctx.client);
  const alert = Math.round(usageThreshold(usage) * 100);
  const known = usage.size > 0;
  const stepAlert = (d: number) => {
    const pct = Math.max(ALERT_MIN, Math.min(ALERT_MAX, alert + d));
    if (!known || pct === alert) return;
    try { ctx.fleet.setUsageAlert(pct / 100); ctx.saved(t.settings.general.usageAlertSaved(pct)); }
    catch (e) { ctx.notify((e as Error).message); }
  };
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
    <Card title={w.statusBar}>
      <Row label={w.usage}>
        <input type="checkbox" aria-label={w.usage} checked={showUsage} onChange={e => { setShowUsage(e.target.checked); ctx.saved(w.usageSaved(e.target.checked)); }} />
      </Row>
      <Row label={w.alertBefore} hint={known ? undefined : t.settings.general.usageAlertUnknown}>
        {describedBy => (
          <span className="set-step-line">
            <span className="set-step" role="group" aria-label={w.alertBefore} aria-describedby={describedBy}>
              <button type="button" aria-label={w.alertLess} aria-disabled={!known || alert <= ALERT_MIN} onClick={() => stepAlert(-5)}>−</button>
              <output aria-live="polite">{alert}</output>
              <button type="button" aria-label={w.alertMore} aria-disabled={!known || alert >= ALERT_MAX} onClick={() => stepAlert(5)}>+</button>
            </span>
            {w.alertAfter}
          </span>
        )}
      </Row>
    </Card>
    <Card>
      <Row label={w.openIn}>
        {describedBy => (
          <div className="set-radios" role="radiogroup" aria-label={w.openIn} aria-describedby={describedBy}>
            {EDITORS.map(e => {
              const notes = [installed && !installed[e] ? w.notInstalled : null, e === 'zed' ? w.zedNoWsl : null].filter(Boolean).join(' · ');
              return (
                <label key={e}>
                  <input type="radio" name={editorName} value={e} checked={editor === e} onChange={() => { setEditor(e); ctx.saved(w.openInSaved(EDITOR_NAMES[e])); }} />
                  {EDITOR_NAMES[e]}{notes && <span className="set-radio-note">{notes}</span>}
                </label>
              );
            })}
          </div>
        )}
      </Row>
    </Card>
    <Card title={w.terminals}>
      <Row label={w.webglBefore}>
        <span className="set-step-line">
          <span className="set-step" role="group" aria-label={w.webglBefore}>
            <button type="button" aria-label={w.webglLess} aria-disabled={webgl <= WEBGL_MIN} onClick={() => step(-1)}>−</button>
            <output aria-live="polite">{webgl}</output>
            <button type="button" aria-label={w.webglMore} aria-disabled={webgl >= WEBGL_MAX} onClick={() => step(1)}>+</button>
          </span>
          {w.webglAfter}
        </span>
      </Row>
    </Card>
    </>
  );
}
