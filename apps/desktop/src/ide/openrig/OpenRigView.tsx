import { useEffect, useMemo, type JSX, type ReactNode } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { useOpenRig, useOpenRigRoles } from '@ledge/fleet/openrig';
import type { HumanAsk, OpenRigAction, OpenRigDone, Projects, Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { OPENRIG_SECTIONS, type NavAction, type OpenRigSection } from '../../nav/state';
import { OPENRIG_INSTALL_URL } from '../../openrig/OpenRigPage';
import { isRunning, kernelRig, listedRigs, targetOf } from '../../openrig/model';
import type { RigOutputEntry } from '../../openrig/rigOutput';
import { RolesView } from '../../openrig/roles/RolesView';
import { SIDEBAR_POLL_MS } from '../../openrig/sidebarState';
import { openUrl } from '../../tauri/bridge';
import type { Tab } from '../../workspace/model';
import { OutputView } from '../OutputView';
import { rigErrorText } from '../rig/errors';
import { RigConfirm, useRigConfirm } from '../rigs/RigConfirm';
import { powerOf } from '../rigs/model';
import { POWER_GLYPH } from './glyphs';
import { prefAction, useDaemonPrefs } from './prefs';
import { navCounts } from './model';
import { Daemon } from './sections/Daemon';
import { Machines } from './sections/Machines';
import { Overview } from './sections/Overview';
import { Rigs } from './sections/Rigs';
import '../../styles/ide-openrig.css';

/** The OpenRig page of the IDE (docs/mockups/ledge-ide-rigs.html `orPageB`): a rail (daemon, sections, launch) and the section's body. */
export interface OpenRigViewProps {
  client: DaemonClient; machines: readonly MachineState[]; machine: string; section: OpenRigSection; role?: string | undefined; seat?: string | undefined;
  projects: Projects | null; sessions: readonly Session[]; asks: readonly HumanAsk[]; output: readonly RigOutputEntry[];
  dispatch(a: NavAction): void; onTab(tab: Tab): void; onLaunch(machine: string): void;
}

export function OpenRigView({ client, machines, machine, section, role, seat, sessions, asks, output, dispatch, onTab, onLaunch }: OpenRigViewProps): JSX.Element {
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

  // ONE confirmation for the page, shared by the rail (the daemon) and the Rigs section (the kernel, the rigs): one at a time, and the
  // last action's failure (`view.last`, shared) shows under its own target only. It lives while its action is still offered: the
  // daemon, or the rig it is about, still runs.
  const offered = (a: OpenRigAction): boolean => {
    if (!up || !state) return false;
    const target = targetOf(a);
    if (target === 'daemon') return true;
    const r = target === 'kernel' ? kernelRig(state) : listedRigs(state).find(x => x.name === target);
    return !!r && isRunning(r);
  };
  const conf = useRigConfirm(view, offered, { prefs, state });
  useEffect(() => { conf.reset(); }, [machine, section]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = view.pending !== null && targetOf(view.pending) === 'daemon';

  const counts = useMemo(() => navCounts(state, roles.status === 'ready' && !roles.error ? roles.roles.length : null, machines.length, output.length), [state, roles.status, roles.error, roles.roles, machines.length, output.length]);

  const power = (): ReactNode => !installed ? null : (
    <span className="ide-orp-pw">
      {powerOf(up).map(verb => {
        const name = v[verb](v.whatDaemon);
        // The decision (confirm or send) is made at the click, from the latest state of useOpenRig.
        return <button key={verb} type="button" className={`ide-orp-ib ${verb}`} title={name} aria-label={name} disabled={pending}
          onClick={e => conf.ask(prefAction('daemon', verb, prefs), e.currentTarget)}><Icon d={POWER_GLYPH[verb]} size={13} />{t.ide.rigTab[verb]}</button>;
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
  // What does not depend on this machine (the machines, the output) shows whatever its state. The roles have their own read, and say
  // themselves why they cannot show (stopped, not installed…) once the machine answers.
  const note = (text: string): ReactNode => <p className="ide-orp-note" role="status">{text}</p>;
  const ofMachine = section !== 'machines' && section !== 'output';
  const needsState = section === 'overview' || section === 'rigs' || section === 'daemon';
  const unavailable: ReactNode = !ofMachine ? null
    // A machine removed while its tab was open: nothing will ever answer for it.
    : !shown ? note(p.unknownMachine)
    : error ? note(error === 'outdated' ? o.outdated : o.offline)
    : !needsState ? null
    : !state ? note(o.loading)
    : !installed ? absent : null;
  const title = p.sections[section];
  // A role picked in the Roles section stays on this tab's machine: an `openrig` action without one would land on the local machine's tab.
  const onMachine = (a: NavAction) => dispatch(a.type === 'openrig' && a.machine === undefined ? { ...a, machine } : a);

  const content = (): ReactNode => {
    if (section === 'machines') return <Machines client={client} machines={machines} dispatch={dispatch} onTab={onTab} />;
    if (section === 'output') return (
      <section className="ide-orp-blk">
        <div className="ide-orp-blk-h"><b>{p.sections.output}</b><span className="ide-orp-mut">{p.outputSub}</span></div>
        <div className="ide-orp-term"><OutputView entries={output} /></div>
      </section>
    );
    if (section === 'roles') return <div className="or-page ide-orp-roles"><RolesView client={client} machine={machine} machineLabel={label} roles={roles} {...(role !== undefined ? { roleId: role } : {})} {...(seat !== undefined ? { seat } : {})} dispatch={onMachine} /></div>;
    if (!state) return null;
    if (section === 'rigs') return <Rigs client={client} view={view} conf={conf} state={state} machine={machine} label={label} prefs={prefs} sessions={sessions} asks={asks} onTab={onTab} onLaunch={onLaunch} />;
    if (section === 'daemon') return <Daemon state={state} machine={machine} />;
    return <Overview state={state} machine={machine} label={label} sessions={sessions} asks={asks} output={output} dispatch={dispatch} onTab={onTab} />;
  };

  return (
    <div className="ide-orp" role="region" aria-label={p.rail(label)}>
      <aside className="ide-orp-rail">
        <div className="ide-orp-status">
          <i className={`ide-orp-dot ${up ? 'on' : 'off'}`} aria-hidden="true" /><b>OpenRig</b><span className="ide-orp-mach">{label}</span>
          {power()}
        </div>
        {conf.confirm && targetOf(conf.confirm) === 'daemon' && state && <RigConfirm action={conf.confirm} state={state} sessions={sessions} machine={machine} label={label} onConfirm={() => conf.run(conf.confirm!)} onCancel={conf.close} />}
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
        {unavailable ?? <section className={`ide-orp-body s-${section}`} role="region" aria-label={title}>{content()}</section>}
      </div>
    </div>
  );
}
