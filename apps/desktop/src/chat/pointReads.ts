import type { ChatTurn, ClientMessage } from '@ledge/protocol';
import { newestPointRead } from '@ledge/ui/chat/point';

/** What the reads need of the fleet: which machine owns a turn, which machines answer, and a send to one of them. */
export interface PointReadFleet {
  turnMachine(qid: string): { id: string; ready: boolean } | undefined;
  sendTo(machine: string, msg: ClientMessage): boolean;
}

/**
 * `operator.read` names no conversation: it moves the cursor of the daemon it reaches. So each read goes to the machine owning the
 * point's turn; opening « À toi » sends every ready machine its own newest point's event (spec §5). Returns the reads sent.
 */
export function sendPointReads(turns: readonly ChatTurn[], fleet: PointReadFleet): Array<{ machine: string; eventId: number }> {
  const byMachine = new Map<string, ChatTurn[]>();
  for (const t of turns) {
    const m = fleet.turnMachine(t.qid);
    if (!m?.ready) continue;
    byMachine.set(m.id, [...(byMachine.get(m.id) ?? []), t]);
  }
  const sent: Array<{ machine: string; eventId: number }> = [];
  for (const [machine, list] of byMachine) {
    const r = newestPointRead(list);
    if (r && fleet.sendTo(machine, { type: 'operator.read', eventId: r.eventId })) sent.push({ machine, eventId: r.eventId });
  }
  return sent;
}

/**
 * A point seen in the chat: its read goes to its own machine, once per new event id there. `last` holds the last id sent to each
 * machine; a lower one than the last (a new conversation, a reset journal) is sent too. True when a read went.
 */
export function sendPointSeen(qid: string, eventId: number, fleet: PointReadFleet, last: Map<string, number>): boolean {
  const m = fleet.turnMachine(qid);
  if (!m?.ready || last.get(m.id) === eventId) return false;
  if (!fleet.sendTo(m.id, { type: 'operator.read', eventId })) return false;
  last.set(m.id, eventId);
  return true;
}
