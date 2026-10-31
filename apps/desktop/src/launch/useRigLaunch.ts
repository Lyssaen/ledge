import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, RigLaunchWhere, RigPlan, RigResultCode, ServerMessage } from '@ledge/protocol';

/** Where the window is: the form, a plan asked (`then`: shown, or launched at once), the plan, its launch, a refusal at the step it came
 *  (`back`, with the plan when it came there), or launched. */
export type RigLaunchState =
  | { step: 'form' }
  | { step: 'preparing'; from: 'form' | 'plan'; plan?: RigPlan }
  | { step: 'plan'; plan: RigPlan }
  | { step: 'launching'; from: 'form' | 'plan'; plan: RigPlan }
  | { step: 'error'; reason: string; code?: RigResultCode; back: 'form' | 'plan'; plan?: RigPlan }
  | { step: 'launched' };

interface Pending { rid: string; kind: 'prepare' | 'launch'; machine: string; then: 'plan' | 'launch'; from: 'form' | 'plan'; plan?: RigPlan }
let next = 0;

/** The rig launch exchange (spec §4.6): `rig.prepare` → `rig.plan` (or a refusal `rig.result`), then `rig.launch` → `rig.result`.
 *  `rig.prepare` goes to its machine by the fleet's routing; `rig.launch` names no machine, so it is sent to the one that made the plan.
 *  A failed launch keeps its plan taken by the daemon: launching it again asks a new plan first, never resends the old one. */
export function useRigLaunch(client: DaemonClient, onLaunched?: () => void): {
  state: RigLaunchState;
  prepare(machine: string, spec: string, goal: string, where: RigLaunchWhere, o?: { then?: 'plan' | 'launch' }): void;
  launch(plan: RigPlan): void;
  back(): void;
} {
  const [state, setState] = useState<RigLaunchState>({ step: 'form' });
  const pending = useRef<Pending | null>(null);
  // The fleet machine that made each plan (its daemon calls itself 'local' in `plan.machine`), and the plans a launch already took.
  const machines = useRef(new Map<string, string>());
  const taken = useRef(new Set<string>());
  const shown = useRef<RigLaunchState>(state);
  shown.current = state;
  const launched = useRef(onLaunched);
  launched.current = onLaunched;

  const fail = useCallback((p: Pending, reason: string, code?: RigResultCode) => {
    pending.current = null;
    setState({ step: 'error', reason, ...(code ? { code } : {}), back: p.from, ...(p.plan ? { plan: p.plan } : {}) });
  }, []);

  const sendLaunch = useCallback((plan: RigPlan, from: 'form' | 'plan') => {
    const machine = machines.current.get(plan.id) ?? plan.machine;
    const rid = `rig-launch-${++next}`;
    const p: Pending = { rid, kind: 'launch', machine, then: 'launch', from, plan };
    pending.current = p;
    taken.current.add(plan.id);
    setState({ step: 'launching', from, plan });
    const msg: ClientMessage = { type: 'rig.launch', rid, planId: plan.id };
    const ok = client.fleet ? client.fleet.sendTo(machine, msg) : (client.send(msg), true);
    if (!ok) fail(p, `${machine} offline`, 'unreachable');
  }, [client, fail]);

  useEffect(() => {
    const handle = (m: ServerMessage) => {
      const p = pending.current;
      if (!p) return;
      if (m.type === 'error') {
        if (m.request === (p.kind === 'prepare' ? 'rig.prepare' : 'rig.launch')) fail(p, m.message);
        return;
      }
      if ((m.type !== 'rig.plan' && m.type !== 'rig.result') || m.rid !== p.rid) return;
      if (m.type === 'rig.plan') {
        if (p.kind !== 'prepare') return;
        pending.current = null;
        machines.current.set(m.plan.id, p.machine);
        if (p.then === 'launch') sendLaunch(m.plan, p.from);
        else setState({ step: 'plan', plan: m.plan });
        return;
      }
      if (p.kind === 'launch' && m.ok) {
        pending.current = null;
        setState({ step: 'launched' });
        launched.current?.();
        return;
      }
      fail(p, m.reason ?? m.code ?? 'failed', m.code);
    };
    // A machine's answers come through onMachineMessage (the fleet relays only the local daemon's rig.* to onMessage);
    // a refusal the fleet makes itself (machine offline) only through onMessage. The rid keeps one answer from counting twice.
    const offs = [client.onMessage(handle), ...(client.fleet ? [client.fleet.onMachineMessage((_, m) => handle(m))] : [])];
    return () => { for (const off of offs) off(); };
  }, [client, fail, sendLaunch]);

  const prepare = useCallback((machine: string, spec: string, goal: string, where: RigLaunchWhere, o: { then?: 'plan' | 'launch' } = {}) => {
    const now = shown.current;
    const from: 'form' | 'plan' = now.step === 'plan' || (now.step === 'error' && now.back === 'plan') || (now.step === 'preparing' && now.from === 'plan') ? 'plan' : 'form';
    const plan = now.step === 'plan' || now.step === 'error' || now.step === 'preparing' || now.step === 'launching' ? now.plan : undefined;
    const rid = `rig-prepare-${++next}`;
    pending.current = { rid, kind: 'prepare', machine, then: o.then ?? 'plan', from, ...(plan ? { plan } : {}) };
    setState({ step: 'preparing', from, ...(plan ? { plan } : {}) });
    client.send({ type: 'rig.prepare', rid, machine, spec, goal, where });
  }, [client]);

  const launch = useCallback((plan: RigPlan) => {
    if (pending.current) return;
    // A plan a launch already took (even a failed one) cannot be launched again: a new one is made, then launched.
    if (taken.current.has(plan.id)) { prepare(machines.current.get(plan.id) ?? plan.machine, plan.spec, plan.goal, plan.where, { then: 'launch' }); return; }
    sendLaunch(plan, shown.current.step === 'form' ? 'form' : 'plan');
  }, [prepare, sendLaunch]);

  // A launch in flight is kept: dropping it would ignore its answer (a rig launched, the window still open).
  const back = useCallback(() => { if (pending.current?.kind === 'launch') return; pending.current = null; setState({ step: 'form' }); }, []);

  return { state, prepare, launch, back };
}
