import type { JSX } from 'react';
import { openPrs, type FleetPullRequest } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { PipeDot } from './PipeGraph';
import { PrIcon } from './PrIcon';
import '../styles/forge.css';

/** The status bar's count (mockup statusbar): the open requests, the failed pipelines, those running; a click shows the
 *  sidebar's « MR et PR ». Nothing at zero (docs/mockups/ledge-ide-prs-states.html, state 10). */
export function PrsStatus({ prs, onShow }: { prs: readonly FleetPullRequest[]; onShow(): void }): JSX.Element | null {
  const { t } = useI18n();
  const f = t.forge;
  const open = openPrs(prs);
  if (!open.length) return null;
  const fail = open.filter(p => p.pipeline === 'fail').length;
  const run = open.filter(p => p.pipeline === 'run').length;
  return (
    <button type="button" className="ide-status-prs" title={f.statusTip} onClick={onShow}>
      <PrIcon size={12} />{f.status(open.length)}
      {fail > 0 && <> · <PipeDot status="fail" />{f.statusFail(fail)}</>}
      {run > 0 && <> · <PipeDot status="run" />{f.statusRun(run)}</>}
    </button>
  );
}
