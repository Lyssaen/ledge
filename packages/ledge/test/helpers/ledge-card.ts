import type { ChatTaskProposal } from '@ledge/protocol';
import type { Chat } from '../../src/chat/service.js';
import type { Client } from '../../src/client.js';

/** The qid of the card `ledgeCard` holds. */
export const LEDGE_CARD = 'lc';

/**
 * A chat whose one task card gives in Ledge's name: since #142 a client gives as `ledge` only through such a card
 * (`task.cmd { by: ledge, op: give, qid, row }`), as the fronts do. `give` adds a row and sends it; its `task.result` follows.
 */
export function ledgeCard(): { chat: Chat; give(c: Client, rid: string, row: Pick<ChatTaskProposal, 'to' | 'title' | 'team' | 'text'>): void } {
  const rows: ChatTaskProposal[] = [];
  const chat: Chat = {
    async ask() {}, attachmentIds: () => [], cancel() {}, async reset() {}, history: () => [], proposal: () => undefined, markLaunched() {}, markFailed() {},
    relay: () => undefined, markRelay() {}, queuedRelays: () => [], close: () => undefined, markClosed() {}, markCloseFailed() {}, idle: async () => {},
    team: () => undefined, markTeam() {}, followTask() {}, action: () => undefined, markAction() {}, ignore: () => null, ignored: () => false,
    task: (qid, row) => (qid === LEDGE_CARD ? rows[row] : undefined),
    markTask(qid, row, patch) { if (qid === LEDGE_CARD && rows[row]) rows[row] = { ...rows[row], ...patch }; }
  };
  return { chat, give(c, rid, row) { rows.push({ ...row }); c.send({ type: 'task.cmd', rid, by: 'ledge', op: 'give', qid: LEDGE_CARD, row: rows.length - 1 }); } };
}
