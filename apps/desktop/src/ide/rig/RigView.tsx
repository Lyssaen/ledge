import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { reseatRig, useOpenRig, useRigGraph, useRigPermissions, useRigQueue, useRigSnapshots } from '@ledge/fleet/openrig';
import { KERNEL_RIG, type OpenRigAction, type OpenRigDone, type Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { openClick, type NavAction } from '../../nav/state';
import { isRunning, operatorOf, targetOf } from '../../openrig/model';
import { SHELL_ICONS } from '../../shell/icons';
import { RigConfirm, useRigConfirm } from '../rigs/RigConfirm';
import { RigQueue } from './RigQueue';
import { RigSettings } from './RigSettings';
import { RigTopology } from './RigTopology';
import { actionOf } from '../rigs/model';
import { policyOf, type PermLevel } from './model';
import '../../styles/ide-rig.css';

const RESTART = ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'];

export interface RigViewProps {
  client: DaemonClient; machines: readonly MachineState[]; sessions: readonly Session[]; machine: string; rig: string; dispatch(a: NavAction): void;
}

/** The « Rig · name » tab (docs/mockups/ledge-ide-rigs.html `topoPage`): header and confirmation, topology, settings, queue; the kernel has its own variant. */
export function RigView({ client, machines, sessions, machine, rig: name, dispatch }: RigViewProps): JSX.Element {
  const { t } = useI18n();
  const r = t.ide.rigTab, o = t.openrig;
  const shown = machines.find(m => m.id === machine);
  const label = shown?.label ?? machine;
  const isKernel = name === KERNEL_RIG;
  const view = useOpenRig(client, shown?.ready ? machine : null);
  const state = view.state;
  const rig = state?.rigs.find(x => x.name === name);
  const error = view.error ?? (shown && !shown.ready ? 'offline' : undefined);
  const daemonUp = state?.installed === true && state.daemon.state === 'running';
  const running = !!rig && isRunning(rig);

  const asked = shown?.ready && rig ? machine : null;
  const graph = useRigGraph(client, asked, name);
  const permissions = useRigPermissions(client, isKernel ? null : asked, name);
  const snapshots = useRigSnapshots(client, isKernel ? null : asked, name);
  const queue = useRigQueue(client, isKernel ? null : asked, name);
  const policyAvailable = shown?.daemon?.openrigPolicy === true;

  // The graph, permissions and snapshots are read again when the rig's state changes (status, seats), not on a clock; the queue has its own pace.
  const stateKey = rig ? `${rig.status}|${rig.running}|${rig.nodes.length}` : '';
  const seen = useRef(stateKey);
  const reloadAll = () => { graph.reload(); permissions.reload(); snapshots.reload(); };
  useEffect(() => {
    const before = seen.current;
    seen.current = stateKey;
    // The first state (the hooks just asked for themselves) is not a change.
    if (before === '' || before === stateKey) return;
    reloadAll();
  }, [stateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const offered = (a: OpenRigAction): boolean => daemonUp && running && targetOf(a) === name;
  const conf = useRigConfirm(view, offered);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const opener = useRef<HTMLDivElement>(null);
  const headFocus = () => opener.current?.querySelector<HTMLElement>('button:not(:disabled)');

  /** One of the tab's own actions: run it, read again, and drop the stale header failure. */
  const own = async (action: OpenRigAction): Promise<OpenRigDone> => {
    const d = await view.act(action);
    reloadAll();
    if (!conf.confirm) conf.reset();
    return d;
  };
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const seatNames = useMemo(() => rig?.nodes.map(n => n.session) ?? [], [rig]);
  const changeLevel = async (level: PermLevel) => {
    if (seatNames.length === 0) return;
    setPolicyError(null);
    const d = await own({ kind: 'rig.policy', rig: name, policy: policyOf(level), seats: seatNames });
    if (!d.ok) setPolicyError(d.error ?? '');
  };

  const note = (text: string): JSX.Element => <div className="ide-rig ide-rig-state" role="status">{text}</div>;
  if (error) return note(error === 'outdated' ? o.outdated : o.offline);
  if (!state) return note(o.loading);
  if (!state.installed) return <div className="ide-rig ide-rig-state" role="status"><b>{o.notInstalledTitle}</b> {o.notInstalled}</div>;
  if (!rig) return note(r.rigAbsent(name));

  const failure = (): ReactNode => {
    const d = view.last;
    if (!d || d.ok || conf.lastTarget !== name) return null;
    const e = d.error;
    return <div className="ide-rig-fail" role="alert">{e === 'busy' ? o.busy : e === 'not_installed' ? o.notInstalled : e === 'offline' ? o.offline : e === 'outdated' ? o.outdated : o.failed(e ?? '')}</div>;
  };
  const verb = (kind: 'start' | 'restart' | 'stop', glyph: readonly string[], text: string, cls = ''): JSX.Element => (
    <button type="button" className={`ide-rig-btn ${cls}`.trim()} disabled={view.pending !== null}
      onClick={e => conf.ask(actionOf(name, kind), e.currentTarget, headFocus)}><Icon d={glyph} size={13} />{text}</button>
  );
  const seatsCount = rig.nodes.length > 0 ? rig.nodes.length : rig.seats;
  const operator = isKernel ? operatorOf(state, sessions, machine) : undefined;

  return (
    <div className="ide-rig">
      <div ref={opener} className="ide-rig-top">
        <div className="ide-rig-title">
          <i className={`ide-rig-dot ${running ? 'd-idle' : 'd-off'}`} aria-hidden="true" />
          <h3>{name}</h3>
          <span className={`ide-rig-pill ${running ? 'on' : 'off'}`}>{running ? r.running : r.stopped}</span>
          <span className="ide-rig-sub">{r.seatsAt(seatsCount, label)}</span>
          <span className="ide-rig-pw">
            {!daemonUp ? <span className="ide-rig-sub">{r.daemonStopped}</span>
              : running ? <>{verb('restart', RESTART, r.restart)}{verb('stop', SHELL_ICONS.stop, r.stop, 'stop')}</>
              : verb('start', SHELL_ICONS.play, r.start, 'pri')}
          </span>
        </div>
        {conf.confirm && <RigConfirm action={conf.confirm} state={state} sessions={sessions} machine={machine} label={label} onConfirm={() => conf.run(conf.confirm!)} onCancel={conf.close} />}
        {failure()}
      </div>
      <div className="ide-rig-grid">
        <RigTopology graph={graph.graph} status={graph.status} {...(graph.error ? { error: graph.error } : {})} sessions={sessions} machine={machine} running={running} dispatch={dispatch} />
        {isKernel ? (
          <section className="ide-rig-block">
            <header className="ide-rig-head"><b>{r.role}</b></header>
            <div className="ide-rig-body">
              <span className="ide-rig-sub">{r.roleBody.map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</span>
              <div className="ide-rig-go">
                <button type="button" className="ide-rig-btn pri" disabled={!operator} title={operator ? undefined : o.operatorNotYet}
                  onClick={e => operator && dispatch(openClick(operator.id, e))}>{r.talkToOperator}</button>
              </div>
            </div>
          </section>
        ) : (
          <div className="ide-rig-side">
            <RigSettings rig={rig} running={running} permissions={permissions} snapshots={snapshots} policyAvailable={policyAvailable} busy={view.pending !== null} policyError={policyError}
              onPolicy={l => void changeLevel(l)} snapshotError={snapshotError}
              onSnapshot={() => { setSnapshotError(null); void own({ kind: 'rig.snapshot', rig: name }).then(d => { if (!d.ok) setSnapshotError(d.error ?? ''); }); }}
              onApply={async seats => { const res = await reseatRig(client, machine, name, seats); reloadAll(); view.refresh(); return res; }} />
            <RigQueue rows={queue.rows} truncated={queue.truncated} sessions={sessions} machine={machine} now={Date.now()} />
          </div>
        )}
      </div>
    </div>
  );
}
