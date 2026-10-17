import type { JSX } from 'react';
import type { MachineState } from '@ledge/fleet';
import { SEMVER } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { compareVersions } from '@ledge/ui/semver';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { daemonTarget, type DaemonStep } from '../update/daemon';
import { useUpdate } from '../update/store';
import { Card, Row } from './controls';
import { UpdatesCard } from './General';
import type { SettingsContext } from './SettingsPage';

const versionOf = (m: MachineState): string | undefined => m.daemon?.version ?? m.version;

/** Settings › About (settings.tsx, `about`; origin/feat/desktop's AboutPanel for the daemon): Ledge, then the versions (Desktop,
 *  each machine's daemon with its install and « À mettre à jour » when it is behind the version the daemons follow, the latest
 *  version), the local daemon's update (the button for an npm service, the manual note otherwise) and its log; then the app's
 *  updates, the card of General. */
export function About({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.about;
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const update = useUpdate();
  // The daemons follow Desktop: the release on offer, else the running app (as useDaemonUpdate does).
  const target = daemonTarget(update);
  const behind = (v: string | undefined) => !!v && !!target && SEMVER.test(v) && SEMVER.test(target) && compareVersions(v, target) < 0;
  const late = ctx.machines.filter(m => behind(versionOf(m)));
  const latest = update.latest ?? (update.phase.kind === 'current' && update.app ? update.app : c.latestUnknown);
  const { offer, journal, running, start } = ctx.daemonUpdate;
  const local = ctx.machines.find(m => m.id === 'local')?.daemon;
  const stepText = (step: DaemonStep): string => {
    switch (step.kind) {
      case 'sent': return c.step.sent(step.version);
      case 'installing': return c.step.installing;
      case 'restarting': return c.step.restarting;
      case 'done': return c.step.done(step.version);
      case 'failed': return c.failed[step.reason];
    }
  };

  return (
    <>
      <Card>
        <div className="about-hero">
          <ResidentMascot size={56} theme={theme} paused={ctx.paused} reducedMotion={reduced} />
          <div><strong>Ledge</strong><span className="set-hint">{c.tagline}</span></div>
        </div>
      </Card>
      <Card title={c.versions} hint={late.length > 0 ? <span className="set-warn">{c.behind(late.map(m => m.label))}</span> : undefined}>
        <dl className="version-list">
          <div><dt>{c.app}</dt><dd className="mono">{update.app ?? c.unknown}</dd></div>
          {ctx.machines.map(m => {
            const v = versionOf(m);
            return (
              <div key={m.id}>
                <dt>{c.daemon(m.label)}</dt>
                <dd className="mono">
                  {v ?? c.unknown}
                  {v && m.daemon && <span className="set-hint">· {c.install[m.daemon.install]}</span>}
                  {behind(v) && <span className="set-tag warn">{c.behindTag}</span>}
                </dd>
              </div>
            );
          })}
          <div><dt>{c.latest}</dt><dd className="mono">{latest}</dd></div>
        </dl>
        {offer === 'offer' && target && (
          <Row label={c.updateDaemon} hint={c.updateDaemonHint(target)}>
            <Button size="sm" variant="primary" disabled={running} onClick={start}>{c.update}</Button>
          </Row>
        )}
        {offer === 'manual' && local && (
          <div className="set-well warn">
            <span>{local.install === 'git' ? c.failed['git-install'] : local.install === 'unknown' ? c.manualUnknown : c.failed['no-systemd']}</span>
            {local.manual && <code>{local.manual}</code>}
          </div>
        )}
        {/* A polite live region, there before the first step: each step that comes is read out. */}
        <div className="update-live" aria-live="polite">
          {journal.length > 0 && (
            <ol className="set-well steps update-log" aria-label={c.log}>
              {journal.map((step, i) => {
                const command = step.kind === 'failed' ? step.command ?? (step.reason === 'timeout' ? c.timeoutCommand : null) : null;
                return (
                  <li key={i} className={step.kind === 'failed' ? 'set-error' : undefined}>
                    {stepText(step)}
                    {command && <code>{command}</code>}
                    {step.kind === 'failed' && step.detail && <small>{step.detail}</small>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </Card>
      <UpdatesCard saved={ctx.saved} />
    </>
  );
}
