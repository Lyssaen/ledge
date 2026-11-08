import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { useOpenRig, useOpenRigStates } from '@ledge/fleet/openrig';
import type { HumanAsk, OpenRigAction, OpenRigDone, Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { openClick, type NavAction } from '../../nav/state';
import { targetOf } from '../../openrig/model';
import { SIDEBAR_POLL_MS } from '../../openrig/sidebarState';
import { menuPoint } from '../../shell/sidebar/menuPoint';
import { SHELL_ICONS } from '../../shell/icons';
import { keyOf, type Tab } from '../../workspace/model';
import { useRigsFold, useRigsMachine } from '../../workspace/prefs';
import { providerOf } from '../../workspace/sessionTab';
import { openrigTab, rigTab } from '../../workspace/store';
import { ProviderLogo } from '../ProviderLogo';
import { useDaemonPrefs, prefAction } from '../openrig/prefs';
import { rigErrorText } from '../rig/errors';
import { MachineMenu } from './MachineMenu';
import { RigConfirm, useRigConfirm } from './RigConfirm';
import { machineEntries, powerOf, rigsViewOf, type RigDot, type RigLine, type SeatLine } from './model';
import '../../styles/ide-rigs.css';

const RESTART = ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'];
type Verb = 'start' | 'restart' | 'stop';
const GLYPH: Record<Verb, readonly string[]> = { start: SHELL_ICONS.play, restart: RESTART, stop: SHELL_ICONS.stop };

const Dot = ({ dot }: { dot: RigDot }): JSX.Element => <i className={`ide-rigs-dot d-${dot}`} aria-hidden="true" />;

/** The Rigs sidebar view of the IDE (docs/mockups/ledge-ide-rigs.html): one machine's kernel, rigs and daemon, and their actions. */
export interface RigsViewProps {
  client: DaemonClient; machines: readonly MachineState[]; sessions: readonly Session[]; asks: readonly HumanAsk[]; activeTab: Tab | null;
  dispatch(a: NavAction): void; onTab(t: Tab, where?: 'right'): void; onMenu?(id: string, at: { x: number; y: number }, opener: HTMLElement | null): void;
}

export function RigsView({ client, machines, sessions, asks, activeTab, dispatch, onTab, onMenu }: RigsViewProps): JSX.Element {
  const { t } = useI18n();
  const v = t.ide.rigsView, o = t.openrig;
  const [machine, setMachine] = useRigsMachine(machines);
  const fold = useRigsFold();
  const shown = machines.find(m => m.id === machine);
  const label = shown?.label ?? machine;
  // Nothing is asked of a machine that is not connected yet: an ask sent before the connection is lost, and the next one is a poll away.
  const view = useOpenRig(client, shown?.ready ? machine : null, SIDEBAR_POLL_MS);
  const seen = useOpenRigStates(client, useMemo(() => machines.filter(m => m.ready).map(m => m.id), [machines]), SIDEBAR_POLL_MS);
  const entries = useMemo(() => {
    const states = new Map<string, NonNullable<typeof view.state>>(), errors = new Set<string>(), old = new Set<string>();
    for (const [id, s] of seen) { if (s.state) states.set(id, s.state); if (s.error) errors.add(id); if (s.error === 'outdated') old.add(id); }
    return { list: machineEntries(machines, states, errors), outdated: old };
  }, [machines, seen]);
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);

  const error = view.error ?? (shown && !shown.ready ? 'offline' : undefined);
  const rv = rigsViewOf({ state: view.state ?? undefined, ...(error ? { error } : {}), machine, sessions, asks });
  const up = rv.status === 'running';

  // A confirmation lives only while its action is still offered: the daemon, kernel or rig it is about must still be running.
  const offered = (a: OpenRigAction): boolean => {
    const target = targetOf(a);
    return up && (target === 'daemon' || (target === 'kernel' ? rv.kernel?.running === true : rv.rigs.find(r => r.name === target)?.running === true));
  };
  const [prefs] = useDaemonPrefs(machine);
  const conf = useRigConfirm(view, offered, { prefs, state: view.state });
  useEffect(() => { conf.reset(); }, [machine]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeMenu = () => { setMenu(false); trigger.current?.focus(); };
  const pendingOn = (target: string) => view.pending !== null && targetOf(view.pending) === target;
  const ask = (target: string, verb: Verb, button: HTMLElement | null) => conf.ask(prefAction(target, verb, prefs), button,
    () => [...(root.current?.querySelectorAll<HTMLElement>('.ide-rigs-row.rig') ?? [])].find(r => r.dataset.target === target)?.querySelector<HTMLElement>('.ide-rigs-name'));

  const what = (target: string) => target === 'daemon' ? v.whatDaemon : target === 'kernel' ? v.whatKernel : target;
  const power = (target: string, running: boolean): JSX.Element => (
    <span className="ide-rigs-pw">
      {powerOf(running).map(verb => {
        const name = v[verb](what(target));
        return <button key={verb} type="button" className={`ide-rigs-ib ${verb}`} title={name} aria-label={name} disabled={pendingOn(target)} onClick={e => ask(target, verb, e.currentTarget)}><Icon d={GLYPH[verb]} size={13} /></button>;
      })}
    </span>
  );

  const confirmBox = (target: string): ReactNode => conf.confirm && targetOf(conf.confirm) === target && view.state
    ? <RigConfirm action={conf.confirm} state={view.state} sessions={sessions} machine={machine} label={label} onConfirm={() => conf.run(conf.confirm!)} onCancel={conf.close} /> : null;
  const failure = (target: string): ReactNode => {
    const d: OpenRigDone | null = view.last;
    if (!d || d.ok || conf.lastTarget !== target) return null;
    const e = d.error;
    return <div className="ide-rigs-err" role="alert">{rigErrorText(t, e ?? '')}</div>;
  };

  const seatRow = (s: SeatLine): JSX.Element => s.session ? (
    <div key={s.logicalId} className="ide-rigs-row seat" onContextMenu={onMenu ? e => { e.preventDefault(); onMenu(s.session!.id, menuPoint(e, e.currentTarget), e.currentTarget.querySelector<HTMLElement>('.ide-rigs-name')); } : undefined}>
      <Dot dot={s.dot} /><ProviderLogo provider={providerOf(s.session.tool)} size={12} />
      <button type="button" className="ide-rigs-name" onClick={e => dispatch(openClick(s.session!.id, e))}><b>{s.name}</b></button>
      <span className="ide-rigs-meta">{s.ctx !== undefined ? `${s.ctx} %` : ''}</span>
    </div>
  ) : (
    <div key={s.logicalId} className="ide-rigs-row seat off"><Dot dot={s.dot} /><span className="ide-rigs-name"><b>{s.name}</b></span><span className="ide-rigs-meta" /></div>
  );

  const rigRow = (r: RigLine, isKernel: boolean): JSX.Element => {
    const target = isKernel ? 'kernel' : r.name;
    const open = r.running && r.seats.length > 0, unfolded = isKernel || fold.rig(r.name);
    return (
      <div key={r.name}>
        <div className={`ide-rigs-row rig${activeTab !== null && keyOf(activeTab) === keyOf(rigTab(machine, r.name)) ? ' sel' : ''}`} data-target={target}>
          {isKernel ? <span className="ide-rigs-chev">·</span>
            : <button type="button" className="ide-rigs-chev" disabled={!open} aria-label={(unfolded ? v.fold : v.unfold)(r.name)} onClick={() => fold.toggle(`r:${r.name}`)}>{open ? (unfolded ? '▾' : '▸') : '·'}</button>}
          <Dot dot={r.dot} />
          <button type="button" className="ide-rigs-name" onClick={e => { const t = rigTab(machine, r.name); if (e.ctrlKey || e.metaKey) onTab(t, 'right'); else onTab(t); }}><b>{r.name}</b></button>
          <span className="ide-rigs-meta">{r.running ? r.count : ''}</span>
          {power(target, r.running)}
        </div>
        {confirmBox(target)}{failure(target)}
        {open && unfolded && r.seats.map(seatRow)}
      </div>
    );
  };

  const pane = (k: 'kernel' | 'rigs' | 'openrig', title: string, count: number | null, body: ReactNode): JSX.Element => {
    const open = fold.pane(k);
    return (
      <section className={`ide-rigs-pane${open ? ' open' : ''}`}>
        <div className="ide-rigs-ph">
          <button type="button" className="ide-rigs-ptog" aria-expanded={open} onClick={() => fold.toggle(`p:${k}`)}>
            <span className="ide-rigs-pchev" aria-hidden="true">{open ? '▾' : '▸'}</span>{title}{count !== null && <span className="ide-rigs-n">{count}</span>}
          </button>
        </div>
        {open && <div className="ide-rigs-pb">{body}</div>}
      </section>
    );
  };

  const note = (text: string, role?: 'status'): JSX.Element => <div className="ide-rigs-note" {...(role ? { role } : {})}>{text}</div>;
  const unavailable = rv.status === 'loading' ? note(o.loading, 'status')
    : rv.status === 'offline' ? note(error === 'outdated' ? o.outdated : o.offline, 'status')
    : rv.status === 'absent' ? <div className="ide-rigs-empty" role="status"><b>{o.notInstalledTitle}</b><span>{o.notInstalled}</span></div> : null;

  const rigsBody = unavailable ?? (rv.status === 'stopped'
    ? <div className="ide-rigs-empty"><b>{v.stoppedTitle}</b><span>{v.stoppedBody}</span>
        <button type="button" className="pri" disabled={pendingOn('daemon')} onClick={e => ask('daemon', 'start', e.currentTarget)}><Icon d={SHELL_ICONS.play} size={13} />{v.startOpenrig}</button>{failure('daemon')}</div>
    : rv.rigs.map(r => rigRow(r, false)));
  const kernelBody = rv.status === 'stopped' ? note(v.kernelStopped)
    : rv.status === 'running' ? (rv.kernel ? <>{rigRow(rv.kernel, true)}{!rv.kernel.running && note(v.noOperator)}</> : note(o.kernelState.absent)) : null;
  const daemonOn = activeTab !== null && keyOf(activeTab) === keyOf(openrigTab(machine));
  const daemonRow = (
    <div className={`ide-rigs-row rig daemon${daemonOn ? ' sel' : ''}`} data-target="daemon">
      <span className="ide-rigs-chev">·</span><Dot dot={up ? 'idle' : 'off'} />
      <button type="button" className="ide-rigs-name" onClick={() => onTab(openrigTab(machine))}><b>{v.daemon}</b></button>
      <span className="ide-rigs-meta">{up ? rv.version ?? '' : ''}</span>
      {rv.status === 'running' || rv.status === 'stopped' ? power('daemon', up) : <span className="ide-rigs-pw" />}
    </div>
  );

  return (
    <aside ref={root} className="ide-rigs" aria-label={t.side.rigs}>
      <div className="ide-rigs-h">
        <span>{t.side.rigs}</span>
        <button ref={trigger} type="button" className={`ide-rigs-mach${menu ? ' open' : ''}`} aria-haspopup="menu" aria-expanded={menu} title={v.machine(label)} aria-label={v.shownMachine(label)} onClick={() => setMenu(m => !m)}>
          <Dot dot={up ? 'idle' : 'off'} /><span>{label}</span><span className="car" aria-hidden="true">▾</span>
        </button>
        <button type="button" className="ide-rigs-launch" title={v.launchTitle} onClick={() => dispatch({ type: 'modal', modal: { kind: 'rigLaunch', machine } })}><Icon d={ICONS.plus.d} size={13} />{v.launch}</button>
        {menu && <MachineMenu entries={entries.list} outdated={entries.outdated} current={machine} onClose={closeMenu}
          onPick={id => { setMachine(id); closeMenu(); }} onManage={() => { closeMenu(); dispatch({ type: 'settings', section: 'machines' }); }} />}
      </div>
      <div className="ide-rigs-main">
        {pane('kernel', t.side.kernel, null, kernelBody)}
        {pane('rigs', t.side.rigs, rv.status === 'running' ? rv.rigs.length : null, rigsBody)}
      </div>
      <div className="ide-rigs-foot">{pane('openrig', o.side, null, <>{daemonRow}{confirmBox('daemon')}{rv.status === 'stopped' ? null : failure('daemon')}</>)}</div>
    </aside>
  );
}
