import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, Rig, RigResultCode, RigSeat, RigVerb, ServerMessage, Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';

/** A daemon's answer to `rig.act` / `rig.adopt`. */
export interface RigResult { ok: boolean; code?: RigResultCode; reason?: string }

interface Waiting { kind: 'rig.act' | 'rig.adopt'; machine: string; target: string; resolve(r: RigResult): void }
let next = 0;

export interface RigActions {
  act(machine: string, verb: RigVerb, target: { rigId?: string; seatRef?: string }): Promise<RigResult>;
  adopt(machine: string, rigId: string, projectId: string): Promise<RigResult>;
  /** The rids in flight: their buttons wait. */
  pending: ReadonlySet<string>;
  /** Whether an action on that rig (or one of its seats) is in flight. */
  busy(machine: string, rigId: string): boolean;
}

/** Acting on a rig or a seat (spec §4.5): one `rig.act` / `rig.adopt` per gesture, its `rig.result` matched by rid. The fleet routes each to
 *  the rig's machine. A refusal is said in a toast with its reason (`openrig_down`: « OpenRig ne répond pas sur {machine} »). */
export function useRigActions(client: DaemonClient, notify: (text: string) => void): RigActions {
  const { t } = useI18n();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const waiting = useRef(new Map<string, Waiting>());
  const say = useRef({ notify, t });
  say.current = { notify, t };

  useEffect(() => {
    const finish = (rid: string, r: RigResult) => {
      const w = waiting.current.get(rid);
      if (!w) return;
      waiting.current.delete(rid);
      setPending(p => { const n = new Set(p); n.delete(rid); return n; });
      if (!r.ok) {
        const { notify: tell, t: words } = say.current;
        tell(r.code === 'openrig_down' ? words.rigActions.openrigDown(w.machine) : words.rigActions.refused(r.reason ?? r.code ?? 'failed'));
      }
      w.resolve(r);
    };
    const handle = (m: ServerMessage) => {
      if (m.type === 'rig.result') { finish(m.rid, { ok: m.ok, ...(m.code ? { code: m.code } : {}), ...(m.reason ? { reason: m.reason } : {}) }); return; }
      // A refusal the fleet makes itself (machine offline) names the request, not the rid: it answers the oldest one of that kind.
      if (m.type === 'error' && (m.request === 'rig.act' || m.request === 'rig.adopt')) {
        const first = [...waiting.current].find(([, w]) => w.kind === m.request);
        if (first) finish(first[0], { ok: false, code: 'unreachable', reason: m.message });
      }
    };
    // As useRigLaunch: a machine's answers come through onMachineMessage, the fleet's own refusals through onMessage; the rid counts once.
    const offs = [client.onMessage(handle), ...(client.fleet ? [client.fleet.onMachineMessage((_, m) => handle(m))] : [])];
    return () => { for (const off of offs) off(); };
  }, [client]);

  const send = useCallback((kind: Waiting['kind'], machine: string, target: string, build: (rid: string) => ClientMessage) => new Promise<RigResult>(resolve => {
    const rid = `${kind}-${++next}`;
    waiting.current.set(rid, { kind, machine, target, resolve });
    setPending(p => new Set(p).add(rid));
    client.send(build(rid));
  }), [client]);

  const act = useCallback<RigActions['act']>((machine, verb, target) => send('rig.act', machine, `${machine}/${target.rigId ?? ''}`,
    rid => ({ type: 'rig.act', rid, machine, verb, ...(target.rigId !== undefined ? { rigId: target.rigId } : {}), ...(target.seatRef !== undefined ? { seatRef: target.seatRef } : {}) })), [send]);
  const adopt = useCallback<RigActions['adopt']>((machine, rigId, projectId) => send('rig.adopt', machine, `${machine}/${rigId}`,
    rid => ({ type: 'rig.adopt', rid, machine, rigId, projectId })), [send]);
  const busy = useCallback((machine: string, rigId: string) => [...pending].some(rid => waiting.current.get(rid)?.target === `${machine}/${rigId}`), [pending]);

  return useMemo(() => ({ act, adopt, pending, busy }), [act, adopt, pending, busy]);
}

/** A session paired with a rig's seat: where it lives, and the rig and seat when the rig is listed. */
export interface PairedSeat { machine: string; rigId: string; seatRef: string; rig: Rig | null; seat: RigSeat | null }

/** What the app's rig gestures share (the Rigs tab's cards, the atelier's rig rooms, the top bar, a paired session's menu). */
export interface RigControls extends RigActions {
  /** « Arrêter… »: the confirmation, for the rig or (from a seat) for that seat. */
  askStop(rig: Rig, seat?: RigSeat): void;
  /** The rig seat a session is paired with, or null for a session on its own. */
  paired(s: Session): PairedSeat | null;
  /** « Dépôts · n » and « Ranger dans un projet… » of an off-project rig (the repos and the filing dialog are lot 5 task 13's). */
  showRepos(rig: Rig): void;
  askAdopt(rig: Rig): void;
}

export const RigControlsContext = createContext<RigControls | null>(null);
/** The app's rig gestures, or null where none is provided (a read-only view). */
export const useRigControls = (): RigControls | null => useContext(RigControlsContext);
