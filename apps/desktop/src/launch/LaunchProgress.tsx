import { useEffect, useRef } from 'react';
import type { MachineState } from '@ledge/fleet';
import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';
import { TOOL_NAMES } from '../shell/Person';
import type { Flow } from './flow';

/** The mockup's « Démarrage » and « Échec » screens: the request as sent, then either the steps or the reason and the way back. */
export function LaunchProgress({ flow, machines, onEdit, onRetry }: { flow: Flow; machines: MachineState[]; onEdit(): void; onRetry(): void }) {
  const { t } = useI18n(); const l = t.launch; const theme = useTheme();
  const title = useRef<HTMLHeadingElement>(null);
  // The mockup moves focus to the title on each screen; a retry is a new start.
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [flow.stage, flow.attempt]);
  const r = flow.request;
  if (!r) return null;
  const m = machines.find(x => x.id === r.machine);
  const where = m ? l.machineName(m.label, !!m.ssh) : r.machine;
  const failed = flow.stage === 'failed';
  const e = flow.error;
  const reason = !e ? '' : e.kind === 'daemon' ? l.failed.daemon(e.message) : e.kind === 'offline' ? l.failed.offline(where)
    : e.kind === 'lost' ? l.failed.lost(where) : l.failed.timeout;
  const state = failed ? 'error' : 'starting';
  return (
    <section className={failed ? 'launch-progress launch-failed' : 'launch-progress'} aria-label={failed ? l.failed.label : l.starting.label}>
      <div className="launch-mascot" aria-hidden="true"><Bot tool={r.tool} state={state} pose={poseFor('launch', state)} size={56} theme={theme} seed="launch" /></div>
      <h3 ref={title} tabIndex={-1}>{failed ? l.failed.title : l.starting.title}</h3>
      {failed ? <p role="alert">{reason}</p> : <p role="status">{l.starting.text(where)}</p>}
      <dl className="launch-summary">
        <div><dt>{l.summary.machine}</dt><dd>{where}</dd></div>
        <div><dt>{l.summary.agent}</dt><dd>{TOOL_NAMES[r.tool]}</dd></div>
        <div><dt>{l.summary.folder}</dt><dd>{r.cwd}</dd></div>
      </dl>
      <blockquote className="launch-prompt">{r.prompt}</blockquote>
      {failed ? (
        <>
          <div className="launch-actions">
            <button type="button" className="settings-button" onClick={onEdit}>{l.failed.edit}</button>
            <button type="button" className="primary" onClick={onRetry}>{l.failed.retry}</button>
          </div>
          <p className="launch-note">{l.failed.kept}</p>
        </>
      ) : (
        <ol className="launch-steps">
          <li>✓ {l.starting.connected}</li>
          <li>✓ {l.starting.folder}</li>
          <li aria-current="step"><span className="launch-spinner" aria-hidden="true" />{l.starting.tool(TOOL_NAMES[r.tool])}</li>
        </ol>
      )}
    </section>
  );
}
