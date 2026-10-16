import type { ReactNode } from 'react';
import type { MachineState } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { useStored } from '../state/useStored';
import { loadLaunch, saveLaunch } from './form';
import { LaunchFormView } from './LaunchFormView';
import { LaunchProgress } from './LaunchProgress';
import type { LaunchApi, LaunchFleet } from './useLaunch';

/** The launch screen in place of the sessions (mockup launch.js): its heading, the Shell's notices, then a scrolled body. */
export function LaunchScreen({ launch, machines, fleet, notices }: { launch: LaunchApi; machines: MachineState[]; fleet: LaunchFleet; notices?: ReactNode }) {
  const { t } = useI18n(); const l = t.launch;
  // Loaded when the screen opens; written on each edit; cleared by the Shell when a launch succeeds.
  const [draft, setDraft] = useStored(loadLaunch, saveLaunch);
  const { flow } = launch;
  if (flow.stage === 'closed') return null;
  return (
    <>
      <header className="view-heading settings-heading">
        <div><h2>{l.title}</h2><p>{l.subtitle}</p></div>
        <button type="button" className="settings-button" data-launch-back onClick={launch.close}>{flow.stage === 'starting' ? l.cancel : l.back}</button>
      </header>
      {notices}
      <div className="launch-scroll">
        {flow.stage === 'form'
          ? <LaunchFormView draft={draft} onDraft={setDraft} machines={machines} fleet={fleet} onLaunch={launch.launch} />
          : <LaunchProgress flow={flow} machines={machines} onEdit={launch.edit} onRetry={launch.retry} />}
      </div>
    </>
  );
}
