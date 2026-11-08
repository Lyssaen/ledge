import { useState, type JSX, type ReactNode } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { useRigGraph, useRigPermissions, useRigSnapshots } from '@ledge/fleet/openrig';
import { seatsByRole, type OpenRigAction, type OpenRigDone, type Rig } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import { tilde } from '../../openrig/roles/model';
import { PermSegment } from '../PermSegment';
import { rigErrorText } from '../rig/errors';
import { permLevelOf, type PermLevel } from '../rig/model';
import { snapshotAt } from '../rig/RigSettings';
import { liveCommand, relaunchActions } from './model';
import { Command, GoRow, Row, useGo, type GoRef } from './parts';

export interface RelaunchFieldsProps {
  client: DaemonClient; machine: string; rig: Rig;
  /** The card is greyed now (the rig started elsewhere): nothing to send. */ off: boolean;
  /** The machine's daemon applies `rig.policy` (`openrigPolicy`). */ policyAvailable: boolean;
  startAction: OpenRigAction; act(a: OpenRigAction): Promise<OpenRigDone>; busy: boolean;
  machineRow: ReactNode; go: GoRef; onLaunched(machine: string, rig: string): void; onClose(): void;
}

/** A stopped rig started again (R2): its name, its seats as role chips, its permission level (another one is set before the start),
 *  and whether it resumes from its last snapshot or starts its seats fresh. */
export function RelaunchFields({ client, machine, rig, off, policyAvailable, startAction, act, busy, machineRow, go, onLaunched, onClose }: RelaunchFieldsProps): JSX.Element {
  const { t, lang } = useI18n();
  const L = t.ide.launchRig;
  const graph = useRigGraph(client, machine, rig.name);
  const perms = useRigPermissions(client, machine, rig.name);
  const snaps = useRigSnapshots(client, machine, rig.name);
  const [level, setLevel] = useState<PermLevel | null>(null);
  const [resume, setResume] = useState(true);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const seats = graph.graph?.seats.map(s => s.logicalId) ?? [];
  const current = perms.status === 'ready' && !perms.error ? permLevelOf(perms.seats) : null;
  const last = snaps.snapshots[0];
  const read = graph.status === 'ready' && perms.status === 'ready' && snaps.status === 'ready';
  // Without a snapshot there is nothing to resume: `rig up --existing` starts every seat fresh by itself.
  const actions = relaunchActions(rig.name, level, current, seats, last ? resume : true);
  const blocked = off || !read || busy || running;
  const send = async () => {
    if (blocked) return;
    setRunning(true); setFailed(null);
    for (const a of actions) {
      const d = await act(a);
      if (!d.ok) { setRunning(false); setFailed(d.error ?? ''); return; }
    }
    setRunning(false);
    onLaunched(machine, rig.name);
  };
  useGo(go, blocked ? null : () => void send());

  const roles = [...seatsByRole(graph.graph?.seats ?? [])];
  return <>
    <Row label={L.name}><span className="ide-rl-fixed mono"><b>{rig.name}</b>{rig.specPath && <span className="ide-rl-mut">· {tilde(rig.specPath)}</span>}</span></Row>
    {machineRow}
    <Row label={<>{L.seats} <span className="mono">{seats.length || rig.seats}</span></>}>
      <div className="ide-rl-chips">{roles.map(([role, ids]) => <span key={role} className="ide-rl-chip"><span className="mono">{role}</span>{ids.length > 1 && <b>{ids.length}</b>}</span>)}</div>
    </Row>
    <Row label={L.permissions}>
      <div className="ide-rl-perm">
        <PermSegment value={level ?? (current === 'mixed' ? null : current)} label={L.permissions} disabled={!policyAvailable || seats.length === 0 || blocked}
          levelOff={l => l === 'spec' && perms.policy === undefined} onChange={l => { setLevel(l); setFailed(null); }} />
        {current === 'mixed' && level === null && <span className="ide-rl-mut">{L.mixed}</span>}
        {!policyAvailable && <span className="ide-rl-mut">{t.openrig.outdated}</span>}
      </div>
    </Row>
    <Row label={L.resume}>
      <label className="ide-rl-check">
        <input type="checkbox" checked={!!last && resume} disabled={!last || blocked} onChange={e => { setResume(e.target.checked); setFailed(null); }} />
        {last ? L.resumeLast(snapshotAt(last.createdAt, lang)) : snaps.status === 'ready' ? L.noSnapshot : L.resumeLast('…')}
      </label>
    </Row>
    <Command text={liveCommand({ daemonUp: true, startAction, actions })} />
    <GoRow text={running ? t.openrig.launch.launching : L.go} disabled={blocked} onGo={() => void send()} onClose={onClose}
      alert={failed !== null ? rigErrorText(t, failed) : off ? L.running : null} note={L.opensTab(rig.name)} />
  </>;
}
