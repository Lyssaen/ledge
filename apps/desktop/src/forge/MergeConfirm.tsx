import { useEffect, useState, type JSX } from 'react';
import type { Fleet, FleetPullRequest } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import '../styles/forge.css';

/** A merge's confirmation on the spot (docs/mockups/ledge-ide-prs-states.html, states 7 and 8), in a request's tab and on the
 *  page « À toi »: the machine and the daemon's exact command; « Fusion… » while it goes; done, a toast and `onDone`. It keeps
 *  the head shown when it opened and sends it, so the daemon's `stale` check guards what the person read; a push while it is
 *  open turns it to « Relire » at once (`onReload`). Refused by the forge: its reason as is, to try again or cancel. Its
 *  « Fusionner » is off while `blocked` (a condition fails, the machine is down: the review of lot 8b). */
export function MergeConfirm({ pr, fleet, command, machine, notify, onDone, onReload, onCancel, blocked = false, why }: {
  pr: Pick<FleetPullRequest, 'id' | 'machineId' | 'ref' | 'target' | 'headSha' | 'forge'>; fleet: Pick<Fleet, 'prAct'>; command: string; machine: string;
  notify(text: string): void; onDone(): void; onReload(): void; onCancel(): void; blocked?: boolean; why?: string;
}): JSX.Element {
  const { t } = useI18n();
  const f = t.forge;
  const [seen] = useState(pr.headSha);
  const [state, setState] = useState<{ s: 'open' | 'sending' } | { s: 'stale'; sha: string } | { s: 'refused'; reason: string }>({ s: 'open' });
  useEffect(() => {
    if (pr.headSha !== seen && state.s !== 'sending' && state.s !== 'stale') setState({ s: 'stale', sha: pr.headSha.slice(0, 7) });
  }, [pr.headSha, seen, state.s]);
  const go = () => {
    setState({ s: 'sending' });
    fleet.prAct(pr.id, pr.machineId, { kind: 'merge', headSha: seen }).then(
      () => { notify(f.mergedToast(pr.ref)); onDone(); },
      (e: { code?: string; message?: string }) => setState(e?.code === 'stale' ? { s: 'stale', sha: pr.headSha.slice(0, 7) }
        : { s: 'refused', reason: e?.code === 'busy' ? f.busy : e?.code === 'offline' ? f.machineOffline(machine) : e?.message ?? '' }));
  };
  return (
    <div className="fg-confirm" role="group" aria-label={f.confirm(pr.ref, pr.target)}>
      <b>{f.confirm(pr.ref, pr.target)}</b>
      <span>{f.runsOn(machine)}</span>
      <code>{command}</code>
      {state.s === 'stale' && <span className="e">{f.stale(state.sha)}</span>}
      {state.s === 'refused' && <span className="e">{f.forgeRefused(f.host[pr.forge], state.reason)}</span>}
      <div className="fg-go">
        {state.s === 'stale'
          ? <button type="button" className="fg-btn pri" onClick={onReload}>{f.reload}</button>
          : <button type="button" className="fg-btn pri" disabled={state.s === 'sending' || blocked} title={why} onClick={go}>{state.s === 'sending' ? f.merging : f.merge}</button>}
        <button type="button" className="fg-btn" disabled={state.s === 'sending'} onClick={onCancel}>{f.cancel}</button>
      </div>
    </div>
  );
}
