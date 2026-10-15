import type { MachineState } from '@ledge/fleet';
import { useI18n, type Messages } from '../i18n/lang';
import { useUpdate, type Updater, type UpdateSnapshot } from '../update/store';
import type { DaemonStep, DaemonUpdate } from '../update/daemon';
import { Toggle } from './controls';

/** Settings › About (spec §9.4, §11; decisions 1 and 2): versions, the 6-hour check, the app update on click only, and
 *  the local daemon's update with its journal. The machines' versions come from each daemon's `DaemonInfo`. */
export function AboutPanel({ machines, updater, daemon }: { machines: readonly MachineState[]; updater: Updater; daemon: DaemonUpdate }) {
  const { t, lang } = useI18n();
  const c = t.settings.about;
  const s = useUpdate(updater);
  const local = machines.find(m => m.id === 'local');
  const phase = s.phase;
  const busy = phase.kind === 'checking' || phase.kind === 'installing';
  const canInstall = phase.kind === 'available' || (phase.kind === 'failed' && phase.during === 'install');
  const when = s.checkedAt === null ? null : new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(s.checkedAt);
  const stepText = (step: DaemonStep): string => {
    switch (step.kind) {
      case 'sent': return c.step.sent(step.version);
      case 'installing': return c.step.installing;
      case 'restarting': return c.step.restarting;
      case 'done': return c.step.done(step.version);
      case 'failed': return c.failed[step.reason];
    }
  };
  const latest = (snap: UpdateSnapshot) => snap.latest ?? (snap.phase.kind === 'current' ? c.latestCurrent : c.latestUnknown);
  const row = (id: string, term: string, value: string) => (
    <div key={id}><dt id={`about-${id}`}>{term}</dt><dd aria-labelledby={`about-${id}`}>{value}</dd></div>
  );

  return (
    <>
      <h3>{c.title}</h3>
      <dl className="version-list">
        {row('app', c.app, s.app ?? c.unknown)}
        {machines.map(m => row(`daemon-${m.id}`, c.daemon(m.label), m.daemon ? `${m.daemon.version} · ${c.install[m.daemon.install]}` : m.version ?? c.unknown))}
        {row('latest', c.latest, latest(s))}
      </dl>
      <Toggle label={c.auto} hint={c.autoHint} checked={s.auto} onChange={on => updater.setAuto(on)} />
      <div className="setting-row">
        <span><strong>{when ? c.checkedAt(when) : c.never}</strong><small>{phaseText(phase, c.phase)}</small></span>
        <button type="button" className="settings-button" disabled={busy} onClick={() => void updater.check()}>{c.check}</button>
      </div>
      <div className="settings-actions">
        <button type="button" className="settings-button" disabled={!canInstall} onClick={() => void updater.install()}>
          {phase.kind === 'installing' ? c.installing(phase.percent) : c.updateApp}
        </button>
        {daemon.offer === 'offer' && <button type="button" className="settings-button" disabled={daemon.running} onClick={daemon.start}>{c.updateDaemon}</button>}
      </div>
      {daemon.offer === 'manual' && local?.daemon && (
        <div className="settings-note">
          <p>{c.failed[local.daemon.install === 'git' ? 'git-install' : 'no-systemd']}</p>
          {local.daemon.manual && <code>{local.daemon.manual}</code>}
        </div>
      )}
      {daemon.journal.length > 0 && (
        <ol className="update-journal" aria-label={c.log}>
          {daemon.journal.map((step, i) => (
            <li key={i} className={step.kind === 'failed' ? 'setting-error' : undefined}>
              {stepText(step)}
              {step.kind === 'failed' && (step.command ?? (step.reason === 'timeout' ? c.timeoutCommand : null)) && <code>{step.command ?? c.timeoutCommand}</code>}
              {step.kind === 'failed' && step.detail && <small>{step.detail}</small>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

type PhaseCopy = Messages['settings']['about']['phase'];
function phaseText(p: UpdateSnapshot['phase'], c: PhaseCopy): string {
  switch (p.kind) {
    case 'idle': return c.idle;
    case 'checking': return c.checking;
    case 'current': return c.current;
    case 'available': return c.available(p.version);
    case 'installing': return c.installing(p.version);
    case 'failed': return p.during === 'check' ? c.failedCheck : c.failedInstall;
  }
}
