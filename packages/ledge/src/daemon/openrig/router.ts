import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import type { Reply } from '../server.js';
import type { RigAggregate } from './aggregate.js';
import type { AnswerQueue } from './answerQueue.js';
import { INSTALL_COMMAND } from './facts.js';
import type { RemotePeers } from './remote.js';

export type RigCommand = Extract<ClientMessage, { type: 'rig.act' | 'rig.prepare' | 'rig.launch' | 'rig.send' | 'rig.exchanges.request' | 'escalation.answer' }>;

const COMMANDS: ReadonlySet<string> = new Set<RigCommand['type']>(['rig.act', 'rig.prepare', 'rig.launch', 'rig.send', 'rig.exchanges.request', 'escalation.answer']);
export const isRigCommand = (msg: ClientMessage): msg is RigCommand => COMMANDS.has(msg.type);

/** The machine a command is for; null: an escalation or a plan this daemon does not know. */
export function machineOf(msg: RigCommand, ctx: { aggregate: RigAggregate; plans: Map<string, string> }): string | null {
  switch (msg.type) {
    case 'rig.launch': return ctx.plans.get(msg.planId) ?? null;
    case 'escalation.answer': return ctx.aggregate.escalation(msg.id)?.machine ?? null;
    default: return msg.machine;
  }
}

/** Plans remembered (planId → machine), oldest forgotten first; a plan lives 30 min where it was made. */
const PLANS_MAX = 500;

type Result = Extract<ServerMessage, { type: 'rig.result' }>;

/**
 * Sends each rig command to its machine: 'local' to this daemon's handlers (behind their rid memo), another machine to its
 * peer with `machine: 'local'` (the peer's own memo makes a resend idempotent). The peer's rig.result / rig.plan go to the
 * requester of that rid only, its rig.exchanges to the requesters of that rig; a peer that leaves fails what still waits.
 */
export function createRigRouter(opts: { aggregate: RigAggregate; remote: RemotePeers; answers: AnswerQueue;
  local: (msg: RigCommand, reply: Reply) => Promise<void>; labelOf?: (id: string) => string }): { route(msg: RigCommand, reply: Reply): Promise<void>; close(): void } {
  const { aggregate, remote, answers } = opts;
  const labelOf = opts.labelOf ?? ((id: string) => id);
  const plans = new Map<string, string>();
  /** `${machine}\0${rid}` → its requesters (a client may resend the same rid while it waits). */
  const pending = new Map<string, { machine: string; rid: string; replies: Reply[] }>();
  /** `${machine}\0${rigId}` → the requesters of that rig's exchanges (rig.exchanges carries no rid). */
  const exchanges = new Map<string, { machine: string; rigId: string; replies: Reply[] }>();
  const key = (machine: string, x: string) => `${machine}\u0000${x}`;
  const remember = (planId: string, machine: string) => {
    plans.delete(planId); plans.set(planId, machine);
    while (plans.size > PLANS_MAX) plans.delete(plans.keys().next().value as string);
  };
  const unreachable = (machine: string, rid: string): Result => ({ type: 'rig.result', rid, ok: false, code: 'unreachable', reason: `${labelOf(machine)} est injoignable` });

  const offMsg = remote.onMessage((machine, m) => {
    if (m.type === 'rig.result' || m.type === 'rig.plan') {
      const k = key(machine, m.rid); const p = pending.get(k);
      if (!p) return; // not ours (an answer the queue sent, a late duplicate)
      pending.delete(k);
      const out: ServerMessage = m.type === 'rig.plan' ? { ...m, plan: { ...m.plan, machine } } : m;
      if (m.type === 'rig.plan') remember(m.plan.id, machine);
      for (const reply of p.replies) reply(out);
      return;
    }
    if (m.type === 'rig.exchanges') {
      const k = key(machine, m.rigId); const w = exchanges.get(k);
      if (!w) return;
      exchanges.delete(k);
      for (const reply of w.replies) reply(m);
    }
  });
  /** A peer gone or no longer usable: what waits on it will not come back. */
  const offStatus = remote.onStatus((machine, s) => {
    if (s === 'open') return;
    for (const [k, p] of pending) if (p.machine === machine) { pending.delete(k); for (const reply of p.replies) reply(unreachable(machine, p.rid)); }
    for (const [k, w] of exchanges) if (w.machine === machine) {
      exchanges.delete(k);
      for (const reply of w.replies) reply({ type: 'error', message: `${labelOf(machine)} est injoignable`, request: 'rig.exchanges.request', code: 'unreachable' });
    }
    if (s === 'removed') for (const [id, m] of plans) if (m === machine) plans.delete(id);
  });

  async function route(msg: RigCommand, reply: Reply): Promise<void> {
    const known = machineOf(msg, { aggregate, plans });
    // A plan no peer made is this daemon's own (or expired: its handler says so, `failed`).
    const machine = known ?? (msg.type === 'rig.launch' ? 'local' : null);
    if (machine === null) return reply({ type: 'rig.result', rid: (msg as Extract<RigCommand, { type: 'escalation.answer' }>).rid, ok: false, code: 'failed', reason: 'escalade inconnue' });
    if (machine === 'local') return opts.local(msg, reply);
    // The peer's own message: no machine to rewrite for escalation.answer / rig.launch.
    const out = ('machine' in msg ? { ...msg, machine: 'local' } : msg) as ClientMessage;

    if (msg.type === 'rig.exchanges.request') {
      const status = remote.status(machine);
      if (status !== 'open' || !remote.send(machine, out)) {
        return reply({ type: 'error', message: status === 'unsupported' ? `Ledge sur ${labelOf(machine)} ne connaît pas OpenRig : mets-le à jour` : `${labelOf(machine)} est injoignable`,
          request: msg.type, code: status === 'unsupported' ? 'unsupported' : 'unreachable' });
      }
      const k = key(machine, msg.rigId); const w = exchanges.get(k);
      if (w) w.replies.push(reply); else exchanges.set(k, { machine, rigId: msg.rigId, replies: [reply] });
      return;
    }

    const rid = msg.rid;
    const queue = () => {
      if (msg.type !== 'escalation.answer') return reply(unreachable(machine, rid));
      answers.enqueue({ rid, machine, id: msg.id, answers: msg.answers, by: msg.by, at: new Date().toISOString() }, reply);
    };
    const status = remote.status(machine);
    if (status === 'unsupported') return reply({ type: 'rig.result', rid, ok: false, code: 'unsupported', reason: `Ledge sur ${labelOf(machine)} ne connaît pas OpenRig : mets-le à jour` });
    if (status !== 'open') return queue();
    if (msg.type === 'rig.prepare' || msg.type === 'rig.launch') {
      const st = aggregate.statuses().find(x => x.machine === machine);
      if (st?.state === 'absent') return reply({ type: 'rig.result', rid, ok: false, code: 'openrig_down', reason: `OpenRig n'est pas installé sur ${labelOf(machine)} : ${st.install ?? INSTALL_COMMAND}` });
    }
    const k = key(machine, rid); const p = pending.get(k);
    if (p) { p.replies.push(reply); return; } // already relayed: this requester gets the same outcome
    if (!remote.send(machine, out)) return queue();
    pending.set(k, { machine, rid, replies: [reply] });
  }

  return { route, close() { offMsg(); offStatus(); pending.clear(); exchanges.clear(); } };
}
