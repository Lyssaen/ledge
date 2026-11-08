import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { useOpenRig, useOpenRigStates, useRigSpecs } from '@ledge/fleet/openrig';
import type { Projects, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import { commandsOf, folderChoices } from '../../openrig/model';
import { SHELL_ICONS } from '../../shell/icons';
import { prefAction, useDaemonPrefs } from '../openrig/prefs';
import { rigErrorText } from '../rig/errors';
import { FromCards, fromKey } from './FromCards';
import { EMPTY_SPEC, fromChoices, pickFrom, type LaunchFrom } from './model';
import { NewRigFields } from './NewRigFields';
import { OperatorFields } from './OperatorFields';
import { MachineSeg, type GoRef } from './parts';
import { RelaunchFields } from './RelaunchFields';
import '../../styles/ide-launch-rig.css';

export interface RigLaunchModalProps {
  client: DaemonClient; machines: readonly MachineState[]; machine: string; projects: Projects | null; sessions: readonly Session[];
  onLaunched(machine: string, rig: string): void; onOperator(sessionId: string | null): void; onClose(): void;
}

/** « Lancer un rig » (docs/mockups/ledge-ide-rigs.html `rigLaunchModal()`, rulings R1–R8): the content of the Modal App.tsx opens.
 *  « Partir de » picks the mode (relaunch a stopped rig, a new rig from a spec or the empty rig, the operator); Ctrl+Enter runs the
 *  mode's main button while it is active. A stopped daemon replaces every mode with its notice and « Démarrer OpenRig » (R5). */
export function RigLaunchModal({ client, machines, machine: first, projects, sessions, onLaunched, onOperator, onClose }: RigLaunchModalProps): JSX.Element {
  const { t } = useI18n();
  const L = t.ide.launchRig, o = t.openrig;
  const [machine, setMachine] = useState(first);
  const shown = machines.find(m => m.id === machine);
  const label = shown?.label ?? machine;
  const ready = shown?.ready === true;
  const view = useOpenRig(client, ready ? machine : null);
  const state = view.state;
  const error = view.error ?? (shown && !ready ? 'offline' : undefined);
  const daemonUp = state?.installed === true && state.daemon.state === 'running';
  const kernelReady = daemonUp && state.kernel.state === 'ready';
  // Nothing is asked of a stopped daemon (`daemon_stopped`): the specs are read once it runs.
  const specs = useRigSpecs(client, ready && daemonUp ? machine : null);
  const [prefs] = useDaemonPrefs(machine);
  const startAction = prefAction('daemon', 'start', prefs);

  // The machines to launch on: the one shown, and every connected one where OpenRig is installed.
  const seen = useOpenRigStates(client, useMemo(() => machines.filter(m => m.ready).map(m => m.id), [machines]));
  const offered = machines.filter(m => m.id === machine || (m.ready && seen.get(m.id)?.state?.installed === true));

  const choices = useMemo(() => (state && daemonUp && specs.status === 'ready' && !specs.error ? fromChoices(specs.specs, state, kernelReady) : []),
    [state, daemonUp, kernelReady, specs.status, specs.error, specs.specs]);
  const [from, setFrom] = useState<LaunchFrom | null>(null);
  // A choice greyed since it was made stays chosen, its button off: Ctrl+Enter never runs another card's action unasked. A choice
  // gone (another machine) gives way to the first active card.
  const kept = from ? choices.find(c => fromKey(c.from) === fromKey(from)) : undefined;
  const firstActive = pickFrom(choices, null);
  const chosen = kept ?? choices.find(c => fromKey(c.from) === fromKey(firstActive));
  useEffect(() => { if (chosen && fromKey(chosen.from) !== fromKey(from)) setFrom(chosen.from); }, [chosen, from]);

  const go: GoRef = useRef(null);
  const root = useRef<HTMLDivElement>(null);
  // On the whole dialog: the Modal focuses its box at opening, before any field of the modal holds the focus.
  useEffect(() => {
    const box = root.current?.closest<HTMLElement>('[role="dialog"]') ?? root.current;
    const keys = (e: globalThis.KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go.current?.(); } };
    box?.addEventListener('keydown', keys);
    return () => box?.removeEventListener('keydown', keys);
  }, []);
  const pick = (id: string) => { setMachine(id); setFrom(null); };
  const folders = useMemo(() => folderChoices(projects, machine), [projects, machine]);
  const machineRow = <MachineSeg machines={offered} current={machine} onPick={pick} />;

  const note = (text: ReactNode, role: 'status' | 'alert' = 'status') => <><span /><div className="ide-rl-state" role={role}>{text}</div></>;
  const body = (): ReactNode => {
    if (error) return <>{machineRow}{note(rigErrorText(t, error))}</>;
    if (!state) return <>{machineRow}{note(o.loading)}</>;
    if (!state.installed) return <>{machineRow}{note(<><b>{o.notInstalledTitle}</b> {o.notInstalled}</>)}</>;
    if (!daemonUp) {
      const failed = view.last && !view.last.ok ? view.last.error ?? '' : null;
      return <>
        {machineRow}
        <span />
        <div className="ide-rl-state ide-rl-stopped" role="status">
          <b>{L.daemonStopped(label)}</b>
          <code className="ide-rl-cmd">{commandsOf(startAction).join(' && ')}</code>
          <span className="ide-rl-go">
            <Button variant="primary" disabled={view.pending !== null} onClick={() => void view.act(startAction)}><Icon d={SHELL_ICONS.play} size={13} />{t.ide.rigsView.startOpenrig}</Button>
            <Button variant="outline" onClick={onClose}>{L.cancel}</Button>
          </span>
          {failed !== null && <span className="ide-rl-alert" role="alert">{rigErrorText(t, failed)}</span>}
        </div>
      </>;
    }
    if (specs.status !== 'ready') return <>{machineRow}{note(o.launch.loadingSpecs)}</>;
    if (specs.error) return <>{machineRow}{note(o.launch.errors[specs.error] ?? rigErrorText(t, specs.error), 'alert')}</>;
    if (!chosen) return null;
    const key = `${machine}|${fromKey(chosen.from)}`;
    const off = chosen.disabled !== false;
    const c = chosen.from;
    if (c.kind === 'operator') return <OperatorFields key={key} client={client} machine={machine} state={state} sessions={sessions} off={off} go={go} onOperator={onOperator} onClose={onClose} />;
    if (c.kind === 'rig') {
      const rig = state.rigs.find(r => r.name === c.rig);
      return rig ? <RelaunchFields key={key} client={client} machine={machine} rig={rig} off={off} policyAvailable={shown?.daemon?.openrigPolicy === true} startAction={startAction}
        act={view.act} busy={view.pending !== null} machineRow={machineRow} go={go} onLaunched={onLaunched} onClose={onClose} /> : null;
    }
    const spec = specs.specs.find(s => s.name === (c.kind === 'spec' ? c.spec : EMPTY_SPEC));
    return spec ? <NewRigFields key={key} client={client} machine={machine} machineLabel={label} state={state} spec={spec} empty={c.kind === 'empty'} folders={folders}
      level={prefs.perm} startAction={startAction} machineRow={machineRow} go={go} onLaunched={onLaunched} onClose={onClose} /> : null;
  };

  return (
    <div ref={root} className="ide-rl">
      <p className="ide-rl-sub">{L.sub(label)}</p>
      <div className="ide-rl-fld">
        {choices.length > 0 && daemonUp && <FromCards choices={choices} chosen={chosen?.from ?? null} onPick={setFrom} />}
        {body()}
      </div>
    </div>
  );
}

