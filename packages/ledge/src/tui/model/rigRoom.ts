import { contextShare, type Escalation, type Exchange, type Rig, type RigSeat, type Session } from '@ledge/protocol';
import { runtimeLabel } from '@ledge/ui/rigs/model';
import { seatName } from '@ledge/ui/chat/ledge/threadModel';
import { HUMAN_ADDRESS } from '../../daemon/openrig/facts.js';
import type { Glyphs } from '../glyphs.js';
import { fr } from '../i18n/fr.js';
import type { Messages } from '../i18n/lang.js';
import { mentionCandidates } from './mention.js';
import { seatStateLabel } from './left.js';

/** A row of a rig's seat table: its state as the left column reads it, its agent, its context (percent) and what it works on. */
export interface SeatRow { seat: RigSeat; session?: Session; state: { glyph: keyof Glyphs; color: string; label: string }; agent: string; ctx?: number; topic: string }

/** The seats of `rig` in the graph's order (as OpenRig lists them): « Attend Ledge » while an escalation of the seat is open; the
 *  context the seat reports, else its paired session's; the paired session's topic, else « — ». */
export function seatRows(rig: Rig, byId: ReadonlyMap<string, Session>, escalations: readonly Escalation[], words: Messages['seat'] = fr.seat): SeatRow[] {
  const mine = escalations.filter(e => e.machine === rig.machine);
  return rig.seats.map(seat => {
    const session = seat.sessionId ? byId.get(seat.sessionId) : undefined;
    const share = contextShare(session?.context);
    const ctx = seat.contextPct ?? (share === undefined ? undefined : Math.round(share * 100));
    return {
      seat, ...(session ? { session } : {}), state: seatStateLabel(seat, mine, words),
      agent: `${runtimeLabel(seat.runtime)}${seat.model ? ` · ${seat.model}` : ''}`,
      ...(ctx === undefined ? {} : { ctx }), topic: session?.topic || '—'
    };
  });
}

export type QueueState = 'en cours' | 'à toi' | 'fait';
/** `at`: when the task was handed or the escalation raised (the kernel sorts every rig's queue by it). */
export interface QueueItem { id: string; glyph: 'task' | 'approval' | 'ok'; to: string; title: string; state: QueueState; at: string }

const isOpen = (e: Escalation) => e.state === 'pending' || e.state === 'grace';

/**
 * OpenRig's queue for `rig`, newest first: the tasks and handoffs between its seats, and its escalations still open (to Ledge,
 * « à toi »). An exchange carries no state of its own: a task is « en cours » while it is the latest one handed to its seat and that
 * seat works, « fait » otherwise. `long`: the seats under their ref (`qa@factory`) and Ledge under its OpenRig address, for the
 * kernel's queue of every rig.
 */
export function queueOf(rig: Rig, exchanges: readonly Exchange[], escalations: readonly Escalation[], o: { long?: boolean } = {}): QueueItem[] {
  const tasks = exchanges.filter(x => x.machine === rig.machine && x.rigId === rig.id && (x.kind === 'task' || x.kind === 'handoff'));
  const latest = new Map<string, Exchange>();
  for (const x of tasks) { const l = latest.get(x.to); if (!l || l.at <= x.at) latest.set(x.to, x); }
  const working = new Set(rig.seats.filter(s => s.state === 'working').map(s => s.ref));
  const items: QueueItem[] = [
    ...tasks.map(x => {
      const doing = latest.get(x.to) === x && working.has(x.to);
      return { id: x.id, glyph: doing ? 'task' as const : 'ok' as const, to: o.long ? x.to : seatName(x.to), title: x.text, state: doing ? 'en cours' as const : 'fait' as const, at: x.at };
    }),
    ...escalations.filter(e => isOpen(e) && e.machine === rig.machine && e.rigId === rig.id)
      .map(e => ({ id: e.id, glyph: 'approval' as const, to: o.long ? HUMAN_ADDRESS : 'ledge', title: e.summary, state: 'à toi' as const, at: e.createdAt }))
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** What `w` writes in Ledge's field for `seat`: the address the `@` completion would insert (`@build`, `@build@factory` for a
 *  homonym); a seat the completion leaves out (stopped, crashed) still gets its address, long when another seat answers to it. */
export function seatAddress(rig: Rig, seat: RigSeat, rigs: readonly Rig[]): string {
  // The completion offers this machine's seats only: the rig's name and the seat's ref name it there.
  const offered = rig.machine === 'local' ? mentionCandidates('', rigs).find(m => m.seat.ref === seat.ref && m.rig === rig.name) : undefined;
  if (offered) return offered.address;
  const shared = rigs.some(r => r.machine === rig.machine && r.seats.some(s => s.address === seat.address && !(r.id === rig.id && s.ref === seat.ref)));
  return shared ? `${seat.address}@${rig.name}` : seat.address;
}
