import { useEffect, useMemo, type JSX, type ReactNode } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { useOpenRig, useOpenRigRoles } from '@ledge/fleet/openrig';
import type { HumanAsk, OpenRigAction, OpenRigDone, Projects, Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { OPENRIG_SECTIONS, type NavAction, type OpenRigSection } from '../../nav/state';
import { OPENRIG_INSTALL_URL } from '../../openrig/OpenRigPage';
import { targetOf } from '../../openrig/model';
import type { RigOutputEntry } from '../../openrig/rigOutput';
import { SIDEBAR_POLL_MS } from '../../openrig/sidebarState';
import { SHELL_ICONS } from '../../shell/icons';
import { openUrl } from '../../tauri/bridge';
import type { Tab } from '../../workspace/model';
import { rigErrorText } from '../rig/errors';
import { RigConfirm, useRigConfirm } from '../rigs/RigConfirm';
import { powerOf } from '../rigs/model';
import { prefAction, useDaemonPrefs } from './prefs';
import { navCounts } from './model';
import '../../styles/ide-openrig.css';

const RESTART = ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'];
type Verb = 'start' | 'restart' | 'stop';
const GLYPH: Record<Verb, readonly string[]> = { start: SHELL_ICONS.play, restart: RESTART, stop: SHELL_ICONS.stop };

/** The OpenRig page of the IDE (docs/mockups/ledge-ide-rigs.html `orPageB`): a rail (daemon, sections, launch) and the section's body. */
export interface OpenRigViewProps {
  client: DaemonClient; machines: readonly MachineState[]; machine: string; section: OpenRigSection; role?: string | undefined; seat?: string | undefined;
  projects: Projects | null; sessions: readonly Session[]; asks: readonly HumanAsk[]; output: readonly RigOutputEntry[];
  dispatch(a: NavAction): void; onTab(tab: Tab): void; onLaunch(machine: string): void;
}

export function OpenRigView({ client, machines, machine, section, sessions, output, dispatch, onLaunch }: OpenRigViewProps): JSX.Element {
  const { t } = useI18n();
  const o = t.openrig, v = t.ide.rigsView, p = t.ide.openrigPage;
  const shown = machines.find(m => m.id === machine);
  const label = shown?.label ?? machine;
  const ready = shown?.ready === true;
  const view = useOpenRig(client, ready ? machine : null, SIDEBAR_POLL_MS);
  const roles = useOpenRigRoles(client, ready ? machine : null);
  const [prefs] = useDaemonPrefs(machine);
  const state = view.state;
  const error = view.error ?? (shown && !shown.ready ? 'offline' : undefined);
  const installed = state?.installed === true;
  const up = installed && state.daemon.state === 'running';

  // A confirmation lives only while its action is still offered: here, the daemon is still running.
  const offered = (a: OpenRigAction): boolean => up && targetOf(a) === 'daemon';
  const conf = useRigConfirm(view, offered, { prefs, state });
  useEffect(() => { conf.reset(); }, [machine]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = view.pending !== null && targetOf(view.pending) === 'daemon';

  const counts = useMemo(() => navCounts(state, roles.status === 'ready' && !roles.error ? roles.roles.length : null, machines.length, output.length), [state, roles.status, roles.error, roles.roles, machines.length, output.length]);

  const power = (): ReactNode => !installed ? null : (
    <span className="ide-orp-pw">
      {powerOf(up).map(verb => {
        const name = v[verb](v.whatDaemon);
        // The decision (confirm or send) is made at the click, from the latest state of useOpenRig.
        return <button key={verb} type="button" className={`ide-orp-ib ${verb}`} title={name} aria-label={name} disabled={pending}
          onClick={e => conf.ask(prefAction('daemon', verb, prefs), e.currentTarget)}><Icon d={GLYPH[verb]} size={13} />{t.ide.rigTab[verb]}</button>;
      })}
    </span>
  );
  const failure = (): ReactNode => {
    const d: OpenRigDone | null = view.last;
    return !d || d.ok || conf.lastTarget !== 'daemon' ? null : <div className="ide-orp-err" role="alert">{rigErrorText(t, d.error ?? '')}</div>;
  };

  const absent = (
    <section className="ide-orp-absent" aria-label={o.notInstalledTitle}>
      <b>{o.notInstalledTitle}</b><p>{o.notInstalled}</p>
      <button type="button" onClick={() => openUrl(OPENRIG_INSTALL_URL)}>{o.howToInstall}</button>
    </section>
  );
  // What does not depend on this machine's OpenRig (the machines, the output, the roles' own read) shows whatever its state.
  const needsState = section === 'overview' || section === 'rigs' || section === 'daemon';
  const unavailable: ReactNode = !needsState ? null
    : error ? <p className="ide-orp-note" role="status">{error === 'outdated' ? o.outdated : o.offline}</p>
    : !state ? <p className="ide-orp-note" role="status">{o.loading}</p>
    : !installed ? absent : null;
  const title = p.sections[section];

  return (
    <div className="ide-orp" role="region" aria-label={p.rail(label)}>
      <aside className="ide-orp-rail">
        <div className="ide-orp-status">
          <i className={`ide-orp-dot ${up ? 'on' : 'off'}`} aria-hidden="true" /><b>OpenRig</b><span className="ide-orp-mach">{label}</span>
          {power()}
        </div>
        {conf.confirm && state && <RigConfirm action={conf.confirm} state={state} sessions={sessions} machine={machine} label={label} onConfirm={() => conf.run(conf.confirm!)} onCancel={conf.close} />}
        {failure()}
        <nav aria-label={p.nav}>
          {OPENRIG_SECTIONS.map(k => (
            <button key={k} type="button" className={section === k ? 'on' : ''} aria-current={section === k ? 'page' : undefined}
              onClick={() => dispatch({ type: 'openrig', machine, section: k })}>
              {p.sections[k]}{counts[k] !== undefined && <span className="ide-orp-n">{counts[k]}</span>}
            </button>
          ))}
        </nav>
        <button type="button" className="ide-orp-launch" title={v.launchTitle} onClick={() => onLaunch(machine)}><Icon d={ICONS.plus.d} size={13} /><span>{v.launchTitle}</span></button>
      </aside>
      <div className="ide-orp-main">
        <div className="ide-orp-top"><h3>{title}</h3></div>
        {unavailable ?? <section className="ide-orp-body" role="region" aria-label={title} />}
      </div>
    </div>
  );
}
