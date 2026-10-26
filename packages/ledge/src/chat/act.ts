// Applies the rows of a chat's generic card (spec 2026-10-26 action registry §9.2), for the PC's overlays and for a phone alike.
import { MAX_PROPOSALS, type ChatAction } from '@ledge/protocol';
import type { Resolved } from '../daemon/actions.js';
import type { Chat, ChatMessage } from './service.js';
import { log } from '../log.js';

export interface ActDeps {
  chat: Pick<Chat, 'action' | 'markAction'>;
  /** The row against the state now (`resolveAction`): the same row, a changed one, or why it is no longer possible. */
  resolve: (row: ChatAction) => Resolved;
  /** Applies the row through the daemon's own handler; throws (or rejects with) the reason. */
  apply: (row: ChatAction) => Promise<void>;
  emit: (m: ChatMessage) => void;
  /** The `qid#row` actions under way, shared by every caller: a second click is passed over until the first one has answered. */
  inFlight: Set<string>;
  now?: () => string;
}

/** Thrown when nothing is applied: no such row, nothing left to apply, or a destructive row without the confirmation. */
export class ActRefused extends Error {
  constructor(message: string, readonly code?: 'confirm_required') { super(message); }
}

/**
 * A plan's rows apply one after the other, in the card's order, and stop at the first failure (spec §9.2): the next rows stay as
 * they were, to be tried again. A done row, or one in flight, is passed over. Each row is resolved again first: a row whose target
 * changed since the card (a request answered meanwhile, say) is `refused`, nothing sent; one the daemon's handler turned down is
 * `failed`. One confirmation covers every destructive row.
 */
export async function actFromChat(deps: ActDeps, qid: string, rows?: number[], confirmed?: true): Promise<{ done: number[]; failed: Array<{ row: number; message: string; refused?: true }> }> {
  const { chat, inFlight } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const safe = (m: ChatMessage) => { try { deps.emit(m); } catch (e) { log(`act: emit failed: ${(e as Error).message}`); } };
  const known = [...new Set(rows ?? [...Array(MAX_PROPOSALS).keys()])].filter(r => chat.action(qid, r)).sort((a, b) => a - b);
  if (known.length === 0) throw new ActRefused('unknown action');
  const todo = known.filter(r => chat.action(qid, r)!.state !== 'done' && !inFlight.has(`${qid}#${r}`));
  if (todo.length === 0) throw new ActRefused('already done');
  if (!confirmed && todo.some(r => chat.action(qid, r)!.risk === 'destructive')) throw new ActRefused('confirm before applying a destructive action', 'confirm_required');
  for (const r of todo) inFlight.add(`${qid}#${r}`);
  const done: number[] = [];
  const failed: Array<{ row: number; message: string; refused?: true }> = [];
  try {
    for (const r of todo) {
      const row = chat.action(qid, r)!;
      chat.markAction(qid, r, { state: 'running' }, safe);
      let refused = true;
      try {
        const current = deps.resolve(row);
        if ('refused' in current) throw new Error(current.refused);
        if (JSON.stringify(current.args) !== JSON.stringify(row.args)) throw new Error(row.action === 'session.decide' ? 'the request has changed since the card' : 'the target has changed since the card');
        refused = false;
        await deps.apply(row);
      } catch (e) {
        const message = (e as Error).message;
        failed.push({ row: r, message, ...(refused ? { refused: true as const } : {}) });
        chat.markAction(qid, r, { state: refused ? 'refused' : 'failed', error: message }, safe);
        break;
      } finally { inFlight.delete(`${qid}#${r}`); }
      done.push(r);
      try { chat.markAction(qid, r, { state: 'done', doneAt: now() }, safe); } catch (e) { log(`act ${qid}: marking row ${r} failed: ${(e as Error).message}`); }
    }
  } finally { for (const r of todo) inFlight.delete(`${qid}#${r}`); }
  return { done, failed };
}
