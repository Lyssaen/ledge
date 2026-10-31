import { useCallback, useId, useMemo, useState, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Projects, Rig, RigSeat, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { Modal } from '../shell/Modal';
import { AdoptRig } from './AdoptRig';
import { proposeProject } from './proposal';
import { useRigActions, type RigControls } from './useRigActions';

/** « Arrêter… » (spec §4.5): what stops (« Ses n sièges s'arrêtent… »), « Arrêter le rig », « Seulement ce siège » when asked from a
 *  seat, and « Annuler », which has the focus (Escape and the backdrop cancel too). */
export function StopRig(p: { rig: Rig; seat?: RigSeat; onStopRig(): void; onStopSeat(): void; onCancel(): void }): JSX.Element {
  const { t } = useI18n();
  const a = t.rigActions;
  const body = useId();
  const n = p.rig.seats.filter(s => s.state !== 'stopped').length;
  return (
    <Modal title={a.stopTitle(p.rig.name)} role="alertdialog" describedBy={body} className="confirm-modal" onClose={p.onCancel}>
      <div className="confirm-content" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); p.onCancel(); } }}>
        <p id={body}>{a.stopBody(n)}</p>
        <div className="confirm-actions">
          <Button autoFocus onClick={p.onCancel}>{a.cancel}</Button>
          {p.seat && <Button onClick={p.onStopSeat}>{a.stopSeat}</Button>}
          <Button variant="primary" className="danger-btn" onClick={p.onStopRig}>{a.stopRig}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The app's rig gestures (once per window): `useRigActions`, the « Arrêter… » confirmation it shows (`dialog`, rendered by the caller
 *  beside its other dialogs; `blocking` while it shows), « Ranger dans un projet… » (`AdoptRig`, over the projects) and a session's seat.
 *  « Dépôts · n » leads to Rigs › En cours, where the card lists them. */
export function useRigControlsHost(o: { client: DaemonClient; notify(text: string): void; rigs: readonly Rig[]; projects?: Projects | null; dispatch(a: NavAction): void }): {
  controls: RigControls; dialog: JSX.Element | null; blocking: boolean;
} {
  const { client, notify, rigs, projects = null, dispatch } = o;
  const actions = useRigActions(client, notify);
  const [stopping, setStopping] = useState<{ machine: string; rigId: string; seatRef?: string } | null>(null);
  const askStop = useCallback((rig: Rig, seat?: RigSeat) => setStopping({ machine: rig.machine, rigId: rig.id, ...(seat ? { seatRef: seat.ref } : {}) }), []);
  const [adopting, setAdopting] = useState<{ machine: string; rigId: string } | null>(null);
  const askAdopt = useCallback((rig: Rig) => setAdopting({ machine: rig.machine, rigId: rig.id }), []);
  const paired = useCallback((s: Session) => {
    if (!s.rig) return null;
    const { machine, rigId, seat: seatRef } = s.rig;
    const rig = rigs.find(r => r.machine === machine && r.id === rigId) ?? null;
    return { machine, rigId, seatRef, rig, seat: rig?.seats.find(x => x.ref === seatRef) ?? null };
  }, [rigs]);
  const toLive = useCallback(() => dispatch({ type: 'ledge', tab: 'rigs', rigs: 'live' }), [dispatch]);
  const controls = useMemo<RigControls>(() => ({ ...actions, askStop, paired, showRepos: toLive, askAdopt }), [actions, askStop, askAdopt, paired, toLive]);

  // The rig as listed now (a later update shows); gone from the list, the dialog goes with it.
  const rig = stopping ? rigs.find(r => r.machine === stopping.machine && r.id === stopping.rigId) : undefined;
  const seat = rig && stopping?.seatRef ? rig.seats.find(s => s.ref === stopping.seatRef) : undefined;
  const adoptee = adopting ? rigs.find(r => r.machine === adopting.machine && r.id === adopting.rigId) : undefined;
  const dialog = adopting && adoptee && projects
    ? <AdoptRig rig={adoptee} projects={projects} proposed={proposeProject(adoptee, projects)?.projectId ?? null} onCancel={() => setAdopting(null)}
        onAdopt={projectId => { void actions.adopt(adoptee.machine, adoptee.id, projectId).then(r => { if (r.ok) setAdopting(null); }); }} />
    : stopping && rig
    ? <StopRig rig={rig} {...(seat ? { seat } : {})} onCancel={() => setStopping(null)}
        onStopRig={() => { setStopping(null); void actions.act(rig.machine, 'down', { rigId: rig.id }); }}
        onStopSeat={() => { setStopping(null); if (seat) void actions.act(rig.machine, 'stop', { rigId: rig.id, seatRef: seat.ref }); }} />
    : null;
  return { controls, dialog, blocking: dialog !== null };
}
